import http from "node:http";
import {pathToFileURL} from "node:url";
import {randomUUID,randomBytes,createHash,createHmac} from "node:crypto";
import {verifyGoogleIdToken} from "./src/google-id.mjs";
import {loadConfig} from "./src/config.mjs";
import {EventBus} from "./src/event-bus.mjs";
import {MemoryStore} from "./src/store-memory.mjs";
import {parseCookies,hashPassword,verifyPassword,issueSession,verifySession,constantTimeTokenEqual,sessionCookie,csrfCookie,clearSessionCookies,customerSessionCookie,customerCsrfCookie,clearCustomerSessionCookies} from "./src/security.mjs";
import {securityHeaders,readJson,json,text,problemJson,routeMatch,clientIp} from "./src/http.mjs";
import {normalizeFreeSwitchCdr} from "./src/cdr-freeswitch.mjs";
import {startWorkers} from "./src/workers.mjs";
import {createPortabilityQueueHandlers} from "./src/portability-automation.mjs";
import {createOutboundPortabilityQueueHandlers} from "./src/outbound-portability-automation.mjs";
import {webauthnConfigured,publicPasskeyOptions,verifyWebAuthnState,validateWebAuthnRegistration,verifyWebAuthnAssertion} from "./src/webauthn.mjs";
import {customerPermissions,hasCustomerPermission,requireCustomerPermission,scopeCustomerPortalData} from "./src/customer-access.mjs";
import {createStaticSiteHandler} from "./src/static-site.mjs";
import {stripeProviderState,createStripeCheckout,createStripePortalSession,verifyStripeWebhook,normalizeStripeBillingEvent} from "./src/stripe-billing.mjs";
import {createEmailVerificationChallenge,verificationTokenHash,emailVerificationCodeHash,sendResendVerificationCode,sendTransactionalEmail,forwardInboundEmailToInternal,normalizeEmail} from "./src/resend-email.mjs";
import {verifyResendWebhook} from "./src/resend-webhook.mjs";
import {applyResendWebhookEvent,drainTransactionalEmails,drainDunningTransactionalEmails} from "./src/email-dispatcher.mjs";

export async function createDefaultBackend(){
  const config=loadConfig();
  const eventBus=new EventBus();
  if(config.mode==="production"){
    const {PostgresStore}=await import("./src/store-postgres.mjs");
    const store=await PostgresStore.connect(config,eventBus);
    try{
      await eventBus.attachPostgres(store.sql,{listen:config.processRole!=="worker"});
    }catch(error){
      await store.close();
      throw error;
    }
    return createBackend({config,eventBus,store,closeStore:true});
  }
  return createBackend({config,eventBus});
}

export function createBackend(options={}){
  const config=options.config||loadConfig();
  const eventBus=options.eventBus||new EventBus();

  if(config.mode==="production"&&!options.store){
    throw new Error("production requires an explicit persistent store; memory store is simulator-only");
  }

  const store=options.store||new MemoryStore(config,eventBus);
  if(config.mode==="simulator"&&typeof store.seedSimulator==="function")store.seedSimulator();
  const staticSite=createStaticSiteHandler(config.staticDir);

  const metrics={
    requests:0,errors:0,rateLimited:0,authFailures:0,authRateLimited:0,
    startedAt:Date.now(),byStatus:new Map(),byRoute:new Map(),latencyByRoute:new Map(),rateLimitedByClass:new Map()
  };
  const rateBuckets=new Map();
  const classRateBuckets=new Map();
  const authBuckets=new Map();
  const registrationBuckets=new Map();
  const sseClients=new Set();

  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    const trace=traceContext(req);
    const started=performance.now();
    securityHeaders(res,requestId);
    res.setHeader("traceparent",trace.traceparent);
    res.setHeader("X-Trace-Id",trace.traceId);
    res.once("finish",()=>{
      const durationMs=Math.max(0,performance.now()-started);
      observeLatency(metrics,res.pgiRoute||"unclassified",durationMs);
      logHttpRequest(config,{
        requestId,
        traceId:trace.traceId,
        route:res.pgiRoute||"unclassified",
        method:String(req.method||"GET").toUpperCase(),
        status:res.statusCode,
        durationMs
      });
    });

    try{
      metrics.requests++;
      rateLimit(req,config,rateBuckets,metrics);
      const url=new URL(req.url||"/","http://localhost");
      const pathname=url.pathname;
      const method=(req.method||"GET").toUpperCase();
      routeClassRateLimit(req,config,classRateBuckets,metrics,pathname,method);
      let match=null;

      if(method==="GET"&&pathname==="/api/v1/health"){
        return done(res,metrics,started,"health",200,{
          status:"ok",timestamp:new Date().toISOString(),version:config.version,release:config.releaseId||null,mode:config.mode
        });
      }
      if(method==="GET"&&pathname==="/api/v1/ready"){
        authorizeMachineEndpoint(req,config);
        const snapshot=await store.systemSnapshot();
        const readiness=evaluateReadiness(snapshot,workers,config);
        return done(res,metrics,started,"ready",readiness.ready?200:503,{
          status:readiness.ready?"ready":"degraded",
          timestamp:new Date().toISOString(),
          checks:readiness.checks
        });
      }
      if(method==="GET"&&pathname==="/metrics"){
        authorizeMachineEndpoint(req,config);
        res.pgiRoute="metrics";
        return metricsResponse(res,metrics,store,workers);
      }
      if(method==="POST"&&pathname==="/api/v1/billing/stripe/webhook"){
        if(!config.externalBillingEnabled||!config.stripeWebhookSecret)return done(res,metrics,started,"billing.stripe_webhook",404,{error:{code:"STRIPE_WEBHOOK_DISABLED"}});
        const event=await verifyStripeWebhook(req,config);
        const normalized=await normalizeStripeBillingEvent(event,config);
        if(!normalized)return done(res,metrics,started,"billing.stripe_webhook",200,{received:true,ignored:true,type:String(event.type||"")});
        const result=await store.applySubscriptionBillingEvent(normalized);
        return done(res,metrics,started,"billing.stripe_webhook",200,{received:true,duplicate:Boolean(result.duplicate)});
      }
      if(method==="POST"&&pathname==="/api/v1/email/resend/webhook"){
        if(!config.transactionalEmailEnabled||!config.resendWebhookSecret)return done(res,metrics,started,"email.resend_webhook",404,{error:{code:"RESEND_WEBHOOK_DISABLED"}});
        const verified=await verifyResendWebhook(req,config);
        const result=await applyResendWebhookEvent(store,verified);
        let inbound=null;
        if(String(verified.event?.type||"")==="email.received"&&!result.duplicate){
          try{inbound=await forwardInboundEmailToInternal(config,verified.event?.data||{});}
          catch(error){logSecurityEmailFailure("inbound_forward",error);throw error;}
        }
        return done(res,metrics,started,"email.resend_webhook",200,{received:true,duplicate:Boolean(result.duplicate),event_type:result.event_type||verified.event.type,inbound});
      }
      if(method==="GET"&&pathname==="/api/v1/internal/email/dispatch"){
        authorizeEmailCron(req,config);
        if(typeof store.scanUnpaidSubscriptions==="function")await store.scanUnpaidSubscriptions(500);
        const delivery=await drainTransactionalEmails({store,config,limit:100});
        const dunning=await drainDunningTransactionalEmails({store,config,limit:100});
        return done(res,metrics,started,"email.dispatch",200,{ok:true,delivery,dunning});
      }

      if(method==="GET"&&pathname==="/api/v1/public/withdrawal/status"){
        const schemaReady=typeof store.customerWithdrawalFeatureReady==="function"&&await store.customerWithdrawalFeatureReady();
        return done(res,metrics,started,"public.withdrawal_status",200,{available:config.onlineWithdrawalReady===true&&schemaReady});
      }

      if(method==="POST"&&pathname==="/api/v1/public/withdrawal"){
        requireSameOriginBrowser(req);
        const schemaReady=typeof store.customerWithdrawalFeatureReady==="function"&&await store.customerWithdrawalFeatureReady();
        if(config.onlineWithdrawalReady!==true||!schemaReady)return done(res,metrics,started,"public.withdrawal",503,{error:{code:"ONLINE_WITHDRAWAL_UNAVAILABLE"}});
        const idempotencyKey=String(req.headers["idempotency-key"]||"").trim();
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)){const e=new Error("Withdrawal idempotency key required");e.status=400;e.code="IDEMPOTENCY_KEY_REQUIRED";throw e;}
        const body=await readJson(req,config.bodyLimitBytes);
        if(String(body.website||"").trim()){const e=new Error("Invalid withdrawal request");e.status=400;e.code="WITHDRAWAL_REQUEST_REJECTED";throw e;}
        if(body.confirmed!==true){const e=new Error("Withdrawal confirmation required");e.status=400;e.code="WITHDRAWAL_CONFIRMATION_REQUIRED";throw e;}
        if(String(body.legal_version||"")!=="2026-09-26-b2b-b2c-v3"){const e=new Error("Legal document version outdated");e.status=409;e.code="LEGAL_DOCUMENT_VERSION_OUTDATED";throw e;}
        const firstName=String(body.first_name||"").trim(),lastName=String(body.last_name||"").trim();
        if(firstName.length<1||firstName.length>80||lastName.length<1||lastName.length>80){const e=new Error("Name required");e.status=400;e.code="WITHDRAWAL_NAME_REQUIRED";throw e;}
        let contractEmail,acknowledgementEmail;
        try{
          contractEmail=normalizeEmail(body.contract_email);
          acknowledgementEmail=normalizeEmail(body.acknowledgement_email||body.contract_email);
        }catch(_error){const e=new Error("Invalid email");e.status=400;e.code="WITHDRAWAL_EMAIL_INVALID";throw e;}
        const contractReference=String(body.contract_reference||"").trim();
        const contractDetails=String(body.contract_details||"").trim();
        const contractDate=String(body.contract_date||"").trim();
        if(contractReference.length>180){const e=new Error("Contract reference too long");e.status=400;e.code="WITHDRAWAL_REFERENCE_INVALID";throw e;}
        if(contractDetails.length<3||contractDetails.length>1200){const e=new Error("Contract details required");e.status=400;e.code="WITHDRAWAL_CONTRACT_DETAILS_REQUIRED";throw e;}
        if(contractDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(contractDate)||!Number.isFinite(Date.parse(contractDate+"T00:00:00Z")))){const e=new Error("Invalid contract date");e.status=400;e.code="WITHDRAWAL_CONTRACT_DATE_INVALID";throw e;}
        const declaration={first_name:firstName,last_name:lastName,contract_email:contractEmail,acknowledgement_email:acknowledgementEmail,contract_reference:contractReference||null,contract_date:contractDate||null,contract_details:contractDetails,legal_version:"2026-09-26-b2b-b2c-v3",source:"online"};
        const requestSha256=createHash("sha256").update(JSON.stringify(declaration)).digest("hex");
        const evidenceKey=config.sessionSecret||config.callerHashKey||"pgi-withdrawal-simulator";
        const ip=clientIp(req,config.trustProxy),userAgent=String(req.headers["user-agent"]||"");
        const evidence={request_sha256:requestSha256,requester_ip_sha256:ip?createHmac("sha256",evidenceKey).update(ip).digest("hex"):null,user_agent_sha256:userAgent?createHmac("sha256",evidenceKey).update(userAgent).digest("hex"):null};
        const result=await store.idempotent(idempotencyKey,"public.withdrawal.create",declaration,()=>store.createCustomerWithdrawalRequest({...declaration,...evidence}));
        return done(res,metrics,started,"public.withdrawal",201,{reference:result.value.reference,submitted_at:result.value.submitted_at,acknowledgement_delivery:"queued",replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/auth/login"){
        if(config.authMode!=="session")return done(res,metrics,started,"auth.login",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        const authKey=enforceAuthLoginRate(req,config,authBuckets,metrics);
        const body=await readJson(req,config.bodyLimitBytes);
        const username=String(body.username||"").trim(),password=String(body.password||"");
        const staff=typeof store.staffLoginIdentity==="function"?await store.staffLoginIdentity(username):null;
        const staffLocked=Boolean(staff?.locked_until&&Date.now()<Date.parse(staff.locked_until));
        const staffOk=Boolean(staff&&!staffLocked&&staff.enabled!==false&&verifyPassword(password,staff.password_hash));
        const legacyOk=constantTimeTokenEqual(username,config.adminUsername)&&verifyPassword(password,config.adminPasswordHash);
        let user=null;
        if(staffOk)user=staff;
        else if(legacyOk&&typeof store.ensureLegacyStaffIdentity==="function")user=await store.ensureLegacyStaffIdentity(config.adminUsername);
        else if(legacyOk)user={id:"admin",role:"admin",display_name:"Administrator"};
        if(!user){
          if(staff?.id&&typeof store.recordStaffAuthFailure==="function")await store.recordStaffAuthFailure(staff.id,config.authMaxFailures,config.authFailureWindowSeconds);
          metrics.authFailures++;
          recordAuthFailure(authKey,config,authBuckets);
          const e=new Error("Invalid credentials");e.status=401;e.code="INVALID_CREDENTIALS";throw e;
        }
        authBuckets.delete(authKey);
        if(staffOk&&typeof store.recordStaffAuthSuccess==="function")await store.recordStaffAuthSuccess(staff.id);
        const sessionUser={id:String(user.id),role:user.role||"admin",name:user.display_name||"Administrator",session_version:Number(user.session_version||1)};
        const issued=issueSession({secret:config.sessionSecret,user:sessionUser,ttlSeconds:config.sessionTtlSeconds});
        return done(res,metrics,started,"auth.login",200,{user:{id:sessionUser.id,role:sessionUser.role,name:sessionUser.name}},{
          "Set-Cookie":[sessionCookie(issued.token,config.sessionTtlSeconds),csrfCookie(issued.csrf,config.sessionTtlSeconds)]
        });
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/register"){
        if(config.authMode!=="session")return done(res,metrics,started,"customer.auth.register",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        enforceRegistrationRate(req,config,registrationBuckets);
        const body=await readJson(req,config.bodyLimitBytes);
        const password=String(body.password||"");
        if(password.length<12||password.length>256){const e=new Error("Invalid password");e.status=400;e.code="INVALID_NEW_PASSWORD";throw e;}
        if(String(body.website||"").trim()){const e=new Error("Invalid registration");e.status=400;e.code="REGISTRATION_REJECTED";throw e;}
        const registered=await store.selfServiceRegister(body,hashPassword(password));
        const publicUser={id:registered.id,name:registered.display_name,email:registered.email,role:registered.customer_role,tenant:{id:registered.tenant_public_id,name:registered.tenant_name,status:registered.tenant_status}};
        if(config.emailVerificationEnabled){
          const challenge=createEmailVerificationChallenge(config);
          await store.beginCustomerEmailVerification(registered.id,challenge.record);
          try{await sendResendVerificationCode(config,{email:registered.email,name:registered.display_name,code:challenge.code,locale:body.preferred_locale||undefined,idempotencyKey:"email-verification/"+challenge.record.code_hash});}
          catch(_error){return done(res,metrics,started,"customer.auth.register_email",503,{error:{code:"EMAIL_DELIVERY_UNAVAILABLE",message:"Verification email unavailable"},account_created:true,email_verification_required:true,user:publicUser});}
          return done(res,metrics,started,"customer.auth.register",201,{account_created:true,onboarding:true,email_verification_required:true,verification_token:challenge.token,user:publicUser});
        }
        const issued=issueSession({secret:config.sessionSecret,user:{id:registered.id,role:"customer",name:registered.display_name||registered.email,actor_type:"customer",tenant_id:Number(registered.tenant_id),tenant_public_id:registered.tenant_public_id,customer_role:registered.customer_role,authorization_version:Number(registered.authorization_version),session_version:Number(registered.session_version)},ttlSeconds:config.sessionTtlSeconds});
        return done(res,metrics,started,"customer.auth.register",201,{account_created:true,onboarding:true,email_verification_required:registered.email_verified!==true,user:publicUser},{"Set-Cookie":[customerSessionCookie(issued.token,config.sessionTtlSeconds),customerCsrfCookie(issued.csrf,config.sessionTtlSeconds)]});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/email/verify"){
        if(!config.emailVerificationEnabled)return done(res,metrics,started,"customer.auth.email_verify",404,{error:{code:"EMAIL_VERIFICATION_DISABLED"}});
        requireSameOriginBrowser(req);
        const body=await readJson(req,config.bodyLimitBytes),token=String(body.token||"").trim(),code=String(body.code||"").trim();
        if(token.length<32||!/^[0-9]{6}$/.test(code)){const e=new Error("Invalid email verification");e.status=400;e.code="EMAIL_VERIFICATION_INVALID";throw e;}
        const verified=await store.completeCustomerEmailVerification(verificationTokenHash(token),emailVerificationCodeHash(config,token,code),config.emailVerificationMaxAttempts);
        const auth=await store.customerAuthLookup(verified.email);
        const memberships=(auth?.memberships||[]).filter(x=>x.status==="active"&&["active","pending"].includes(x.tenant_status));
        if(memberships.length!==1)return done(res,metrics,started,"customer.auth.email_verify",409,{error:{code:"CUSTOMER_TENANT_REQUIRED"},tenants:memberships.map(x=>({id:x.public_id,slug:x.slug,name:x.display_name,role:x.role}))});
        const membership=memberships[0];await store.recordCustomerAuthSuccess(auth.id);const refreshed=await store.customerAuthLookup(verified.email);
        const current=(refreshed?.memberships||[]).find(x=>Number(x.tenant_id)===Number(membership.tenant_id))||membership;
        const issued=issueSession({secret:config.sessionSecret,user:{id:auth.id,role:"customer",name:auth.display_name||auth.email,actor_type:"customer",tenant_id:Number(current.tenant_id),tenant_public_id:current.public_id,customer_role:current.role,authorization_version:Number(current.authorization_version),session_version:Number(refreshed?.session_version||verified.session_version)},ttlSeconds:config.sessionTtlSeconds});
        return done(res,metrics,started,"customer.auth.email_verify",200,{email_verified:true,user:{id:auth.id,name:auth.display_name||auth.email,email:auth.email,role:current.role,tenant:{id:current.public_id,name:current.display_name}}},{"Set-Cookie":[customerSessionCookie(issued.token,config.sessionTtlSeconds),customerCsrfCookie(issued.csrf,config.sessionTtlSeconds)]});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/email/resend"){
        if(!config.emailVerificationEnabled)return done(res,metrics,started,"customer.auth.email_resend",404,{error:{code:"EMAIL_VERIFICATION_DISABLED"}});
        requireSameOriginBrowser(req);
        const body=await readJson(req,config.bodyLimitBytes),token=String(body.token||"").trim();
        if(token.length<32){const e=new Error("Invalid email verification");e.status=400;e.code="EMAIL_VERIFICATION_INVALID";throw e;}
        const tokenHash=verificationTokenHash(token),target=await store.customerEmailVerificationResendTarget(tokenHash),challenge=createEmailVerificationChallenge(config,token);
        try{await sendResendVerificationCode(config,{email:target.email,name:target.display_name||target.email,code:challenge.code,locale:body.preferred_locale||target.preferred_locale||undefined,idempotencyKey:"email-verification/"+challenge.record.code_hash});}
        catch(_error){return done(res,metrics,started,"customer.auth.email_resend",503,{error:{code:"EMAIL_DELIVERY_UNAVAILABLE",message:"Verification email unavailable"}});}
        await store.refreshCustomerEmailVerification(target.id,tokenHash,challenge.record);
        return done(res,metrics,started,"customer.auth.email_resend",200,{sent:true,resend_after_seconds:config.emailVerificationResendSeconds});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/google"){
        if(config.authMode!=="session")return done(res,metrics,started,"customer.auth.google",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        const authKey=enforceAuthLoginRate(req,config,authBuckets,metrics);
        const body=await readJson(req,config.bodyLimitBytes);
        const identity=await verifyGoogleIdToken(String(body.credential||""),config.googleClientId);
        const rawInvite=String(body.invite||"").trim();
        const inviteHash=rawInvite?createHash("sha256").update(rawInvite).digest("hex"):null;
        const auth=await store.customerGoogleSignIn(identity,inviteHash);
        const memberships=(auth.memberships||[]).filter(x=>x.status==="active"&&["active","pending"].includes(x.tenant_status));
        if(!memberships.length&&auth.account_pending){
          authBuckets.delete(authKey);
          return done(res,metrics,started,"customer.auth.google",202,{account_created:true,pending_contract:true,user:{id:auth.id,name:auth.display_name||auth.email,email:auth.email}});
        }
        let membership=null;
        const requested=String(body.tenant||"").trim();
        if(requested)membership=memberships.find(x=>String(x.public_id)===requested||String(x.slug)===requested)||null;
        else if(memberships.length===1)membership=memberships[0];
        if(!membership){
          authBuckets.delete(authKey);
          return done(res,metrics,started,"customer.auth.google",409,{error:{code:"CUSTOMER_TENANT_REQUIRED"},tenants:memberships.map(x=>({id:x.public_id,slug:x.slug,name:x.display_name,role:x.role}))});
        }
        authBuckets.delete(authKey);
        const issued=issueSession({secret:config.sessionSecret,user:{id:auth.id,role:"customer",name:auth.display_name||auth.email,actor_type:"customer",tenant_id:Number(membership.tenant_id),tenant_public_id:membership.public_id,customer_role:membership.role,authorization_version:Number(membership.authorization_version),session_version:Number(auth.session_version)},ttlSeconds:config.sessionTtlSeconds});
        return done(res,metrics,started,"customer.auth.google",200,{user:{id:auth.id,name:auth.display_name||auth.email,email:auth.email,role:membership.role,tenant:{id:membership.public_id,name:membership.display_name}}},{"Set-Cookie":[customerSessionCookie(issued.token,config.sessionTtlSeconds),customerCsrfCookie(issued.csrf,config.sessionTtlSeconds)]});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/login"){
        if(config.authMode!=="session")return done(res,metrics,started,"customer.auth.login",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        const authKey=enforceAuthLoginRate(req,config,authBuckets,metrics);
        const body=await readJson(req,config.bodyLimitBytes);
        const email=String(body.email||"").trim().toLowerCase();
        const password=String(body.password||"");
        const auth=await store.customerAuthLookup(email);
        const fallbackHash=config.adminPasswordHash||"invalid";
        const passwordOk=verifyPassword(password,auth?.password_hash||fallbackHash);
        const locked=auth?.locked_until&&Date.parse(auth.locked_until)>Date.now();
        if(!auth||!passwordOk||locked||auth.status!=="active"||auth.credential_status!=="active"){
          metrics.authFailures++;recordAuthFailure(authKey,config,authBuckets);
          if(auth?.id)await store.recordCustomerAuthFailure(auth.id);
          const e=new Error("Invalid credentials");e.status=401;e.code="INVALID_CREDENTIALS";throw e;
        }
        if(config.emailVerificationEnabled&&auth.email_verified!==true&&auth.metadata?.email_verification?.required===true){
          const challenge=createEmailVerificationChallenge(config);
          await store.beginCustomerEmailVerification(auth.id,challenge.record);
          try{await sendResendVerificationCode(config,{email:auth.email,name:auth.display_name||auth.email,code:challenge.code,locale:body.preferred_locale||auth?.preferred_locale||undefined,idempotencyKey:"email-verification/"+challenge.record.code_hash});}
          catch(_error){return done(res,metrics,started,"customer.auth.login_email",503,{error:{code:"EMAIL_DELIVERY_UNAVAILABLE",message:"Verification email unavailable"}});}
          authBuckets.delete(authKey);
          return done(res,metrics,started,"customer.auth.login",403,{error:{code:"EMAIL_VERIFICATION_REQUIRED",message:"Email verification required"},email_verification_required:true,verification_token:challenge.token,user:{id:auth.id,name:auth.display_name||auth.email,email:auth.email}});
        }
        const memberships=(auth.memberships||[]).filter(x=>x.status==="active"&&["active","pending"].includes(x.tenant_status));
        let membership=null;
        const requested=String(body.tenant||"").trim();
        if(requested)membership=memberships.find(x=>String(x.public_id)===requested||String(x.slug)===requested)||null;
        else if(memberships.length===1)membership=memberships[0];
        if(!membership){
          authBuckets.delete(authKey);
          return done(res,metrics,started,"customer.auth.login",409,{error:{code:"CUSTOMER_TENANT_REQUIRED"},tenants:memberships.map(x=>({id:x.public_id,slug:x.slug,name:x.display_name,role:x.role}))});
        }
        await store.recordCustomerAuthSuccess(auth.id);authBuckets.delete(authKey);
        const refreshed=await store.customerAuthLookup(email);
        const current=(refreshed?.memberships||[]).find(x=>Number(x.tenant_id)===Number(membership.tenant_id))||membership;
        const issued=issueSession({
          secret:config.sessionSecret,
          user:{id:auth.id,role:"customer",name:auth.display_name||auth.email,actor_type:"customer",tenant_id:Number(current.tenant_id),tenant_public_id:current.public_id,customer_role:current.role,authorization_version:Number(current.authorization_version),session_version:Number(refreshed?.session_version||auth.session_version)},
          ttlSeconds:config.sessionTtlSeconds
        });
        return done(res,metrics,started,"customer.auth.login",200,{user:{id:auth.id,name:auth.display_name||auth.email,email:auth.email,role:current.role,tenant:{id:current.public_id,name:current.display_name}}},{
          "Set-Cookie":[customerSessionCookie(issued.token,config.sessionTtlSeconds),customerCsrfCookie(issued.csrf,config.sessionTtlSeconds)]
        });
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/password/forgot"){
        if(config.authMode!=="session")return done(res,metrics,started,"customer.auth.password_forgot",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        enforceRegistrationRate(req,config,registrationBuckets);
        const body=await readJson(req,config.bodyLimitBytes);
        const email=String(body.email||"").trim().toLowerCase();
        const token=randomBytes(32).toString("base64url"),tokenHash=createHash("sha256").update(token).digest("hex");
        const record={token_hash:tokenHash,requested_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*60000).toISOString()};
        const target=await store.beginCustomerPasswordReset(email,record);
        if(target){
          const actionUrl=config.publicBaseUrl+"/client.html#password-reset="+encodeURIComponent(token);
          try{
            await sendTransactionalEmail(config,{to:target.email,name:target.display_name||target.email,senderRole:"support",templateKey:"password_reset",data:{name:target.display_name||target.email,locale:target.preferred_locale,action_url:actionUrl},idempotencyKey:"password-reset/"+tokenHash,internalEventId:"password-reset/"+tokenHash});
          }catch(error){logSecurityEmailFailure("password_reset",error);}
        }
        return done(res,metrics,started,"customer.auth.password_forgot",202,{ok:true,message:"PASSWORD_RESET_IF_ACCOUNT_EXISTS"});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/password/reset"){
        if(config.authMode!=="session")return done(res,metrics,started,"customer.auth.password_reset",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        enforceRegistrationRate(req,config,registrationBuckets);
        const body=await readJson(req,config.bodyLimitBytes),token=String(body.token||"").trim(),password=String(body.new_password||"");
        if(token.length<32||password.length<12||password.length>256){const e=new Error("Invalid password reset");e.status=400;e.code="PASSWORD_RESET_INVALID";throw e;}
        const tokenHash=createHash("sha256").update(token).digest("hex");
        const target=await store.completeCustomerPasswordReset(tokenHash,hashPassword(password));
        try{
          await sendTransactionalEmail(config,{to:target.email,name:target.display_name||target.email,senderRole:"support",templateKey:"password_changed",data:{name:target.display_name||target.email,locale:target.preferred_locale},idempotencyKey:"password-reset-complete/"+tokenHash,internalEventId:"password-reset-complete/"+tokenHash});
        }catch(error){logSecurityEmailFailure("password_changed",error);}
        return done(res,metrics,started,"customer.auth.password_reset",200,{ok:true,relogin_required:true},{"Set-Cookie":clearCustomerSessionCookies()});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/email/change/confirm"){
        if(config.authMode!=="session")return done(res,metrics,started,"customer.auth.email_change_confirm",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        enforceRegistrationRate(req,config,registrationBuckets);
        const body=await readJson(req,config.bodyLimitBytes),token=String(body.token||"").trim();
        if(token.length<32){const e=new Error("Invalid email change");e.status=400;e.code="EMAIL_CHANGE_INVALID";throw e;}
        const tokenHash=createHash("sha256").update(token).digest("hex"),target=await store.completeCustomerEmailChange(tokenHash);
        try{
          await sendTransactionalEmail(config,{to:target.new_email,name:target.display_name||target.new_email,senderRole:"support",templateKey:"email_changed",data:{name:target.display_name||target.new_email,locale:target.preferred_locale},idempotencyKey:"email-change-complete/new/"+tokenHash,internalEventId:"email-change-complete/new/"+tokenHash});
        }catch(error){logSecurityEmailFailure("email_changed",error);}
        try{
          await sendTransactionalEmail(config,{to:target.old_email,name:target.display_name||target.old_email,senderRole:"support",templateKey:"email_change_notice_old",data:{name:target.display_name||target.old_email,locale:target.preferred_locale},idempotencyKey:"email-change-complete/old/"+tokenHash,internalEventId:"email-change-complete/old/"+tokenHash});
        }catch(error){logSecurityEmailFailure("email_change_notice_old",error);}
        return done(res,metrics,started,"customer.auth.email_change_confirm",200,{ok:true,relogin_required:true,new_email:target.new_email},{"Set-Cookie":clearCustomerSessionCookies()});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/activate"){
        if(config.authMode!=="session")return done(res,metrics,started,"customer.auth.activate",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        const authKey=enforceAuthLoginRate(req,config,authBuckets,metrics);
        const body=await readJson(req,config.bodyLimitBytes);
        const rawToken=String(body.token||"").trim();
        const password=String(body.password||"");
        if(rawToken.length<32||password.length<12){const e=new Error("Invalid activation");e.status=400;e.code="INVALID_ACTIVATION";throw e;}
        const tokenHash=createHash("sha256").update(rawToken).digest("hex");
        const activated=await store.activateCustomerPortalInvitation(tokenHash,String(body.display_name||""),hashPassword(password));
        authBuckets.delete(authKey);
        const issued=issueSession({
          secret:config.sessionSecret,
          user:{id:activated.id,role:"customer",name:activated.display_name||activated.email,actor_type:"customer",tenant_id:Number(activated.tenant_id),tenant_public_id:activated.tenant_public_id,customer_role:activated.customer_role,authorization_version:Number(activated.authorization_version),session_version:Number(activated.session_version)},
          ttlSeconds:config.sessionTtlSeconds
        });
        return done(res,metrics,started,"customer.auth.activate",201,{user:{id:activated.id,name:activated.display_name,email:activated.email,role:activated.customer_role,tenant:{id:activated.tenant_public_id,name:activated.tenant_name}}},{
          "Set-Cookie":[customerSessionCookie(issued.token,config.sessionTtlSeconds),customerCsrfCookie(issued.csrf,config.sessionTtlSeconds)]
        });
      }

      const actor=authenticate(req,config);
      const customerActor=authenticateCustomer(req,config);
      if(method==="GET"&&pathname==="/api/v1/customer/security/passkeys"){
        requireActor(customerActor);
        return done(res,metrics,started,"customer.security.passkeys",200,{configured:webauthnConfigured(config),data:await store.listWebauthnCredentials("customer",customerActor.sub)});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/security/passkeys/register-options"){
        requireCustomerCsrf(req,customerActor,config);
        const credentials=await store.listWebauthnCredentials("customer",customerActor.sub);
        return done(res,metrics,started,"customer.security.passkey_options",200,publicPasskeyOptions(config,"customer:"+customerActor.sub,customerActor.name,credentials,"register"));
      }
      if(method==="POST"&&pathname==="/api/v1/customer/security/passkeys/register"){
        requireCustomerCsrf(req,customerActor,config);
        const body=await readJson(req,config.bodyLimitBytes),context=await store.customerSessionContext(customerActor),auth=await store.customerAuthLookup(context.email);
        if(!auth?.password_hash||!verifyPassword(String(body.current_password||""),auth.password_hash)){const e=new Error("Password reauthentication required");e.status=401;e.code="PASSKEY_REAUTH_REQUIRED";throw e;}
        const subject="customer:"+customerActor.sub,state=verifyWebAuthnState(config,body.state,"register",subject),credential=validateWebAuthnRegistration(config,body,state);
        const registeredCredential=await store.registerWebauthnCredential("customer",customerActor.sub,credential);
        try{
          await sendTransactionalEmail(config,{to:context.email,name:context.display_name||context.email,senderRole:"support",templateKey:"passkey_added",data:{name:context.display_name||context.email,locale:context.preferred_locale},idempotencyKey:"passkey-added/"+context.id+"/"+registeredCredential.id,internalEventId:"passkey-added/"+context.id+"/"+registeredCredential.id});
        }catch(error){logSecurityEmailFailure("passkey_added",error);}
        return done(res,metrics,started,"customer.security.passkey_register",201,{credential:registeredCredential});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/security/passkeys/assert-options"){
        requireCustomerCsrf(req,customerActor,config);
        const credentials=await store.listWebauthnCredentials("customer",customerActor.sub);
        if(!credentials.some(x=>x.enabled!==false)){const e=new Error("No passkey");e.status=409;e.code="WEBAUTHN_CREDENTIAL_REQUIRED";throw e;}
        return done(res,metrics,started,"customer.security.passkey_assert_options",200,publicPasskeyOptions(config,"customer:"+customerActor.sub,customerActor.name,credentials,"assert"));
      }
      if(method==="POST"&&pathname==="/api/v1/customer/security/passkeys/verify"){
        requireCustomerCsrf(req,customerActor,config);
        const body=await readJson(req,config.bodyLimitBytes),subject="customer:"+customerActor.sub,state=verifyWebAuthnState(config,body.state,"assert",subject),credential=await store.webauthnCredential("customer",customerActor.sub,body.credential_id);
        if(!credential){const e=new Error("Passkey not found");e.status=404;e.code="WEBAUTHN_CREDENTIAL_NOT_FOUND";throw e;}
        const verified=verifyWebAuthnAssertion(config,body,state,credential);await store.markWebauthnVerified(credential.id,verified.sign_count);
        return done(res,metrics,started,"customer.security.passkey_verify",200,{verified:true,verified_at:new Date().toISOString()});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/logout"){
        requireCustomerCsrf(req,customerActor,config);
        return done(res,metrics,started,"customer.auth.logout",200,{ok:true},{"Set-Cookie":clearCustomerSessionCookies()});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/auth/me"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.auth.me",200,{user:publicCustomerActor(customerActor,context)});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/auth/email/change/request"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const body=await readJson(req,config.bodyLimitBytes),newEmail=String(body.new_email||"").trim().toLowerCase(),currentPassword=String(body.current_password||"");
        if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(newEmail)||newEmail.length>320){const e=new Error("Invalid email");e.status=400;e.code="INVALID_CUSTOMER_EMAIL";throw e;}
        if(newEmail===String(context.email||"").trim().toLowerCase()){const e=new Error("Email unchanged");e.status=409;e.code="EMAIL_UNCHANGED";throw e;}
        const auth=await store.customerAuthLookup(context.email);
        if(!auth||!verifyPassword(currentPassword,auth.password_hash)){const e=new Error("Invalid current password");e.status=401;e.code="INVALID_CURRENT_PASSWORD";throw e;}
        const token=randomBytes(32).toString("base64url"),tokenHash=createHash("sha256").update(token).digest("hex");
        const record={token_hash:tokenHash,requested_at:new Date().toISOString(),expires_at:new Date(Date.now()+30*60000).toISOString()};
        const target=await store.beginCustomerEmailChange(context.id,newEmail,record);
        const actionUrl=config.publicBaseUrl+"/client.html#email-change="+encodeURIComponent(token);
        try{
          await sendTransactionalEmail(config,{to:newEmail,name:context.display_name||newEmail,senderRole:"support",templateKey:"email_change_confirmation",data:{name:context.display_name||newEmail,locale:context.preferred_locale,action_url:actionUrl},idempotencyKey:"email-change/"+tokenHash,internalEventId:"email-change/"+tokenHash});
        }catch(error){logSecurityEmailFailure("email_change_confirmation",error);const e=new Error("Email delivery unavailable");e.status=503;e.code="EMAIL_DELIVERY_UNAVAILABLE";throw e;}
        return done(res,metrics,started,"customer.auth.email_change_request",202,{ok:true,pending_email:target.new_email});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/auth/change-password"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const body=await readJson(req,config.bodyLimitBytes);
        const currentPassword=String(body.current_password||"");
        const newPassword=String(body.new_password||"");
        if(newPassword.length<12||newPassword.length>256){const e=new Error("Invalid new password");e.status=400;e.code="INVALID_NEW_PASSWORD";throw e;}
        if(currentPassword===newPassword){const e=new Error("New password must differ");e.status=400;e.code="PASSWORD_UNCHANGED";throw e;}
        const auth=await store.customerAuthLookup(context.email);
        if(!auth||!verifyPassword(currentPassword,auth.password_hash)){const e=new Error("Invalid current password");e.status=401;e.code="INVALID_CURRENT_PASSWORD";throw e;}
        await store.updateCustomerPassword(context.id,hashPassword(newPassword));
        const securityEventId="password-changed/"+context.id+"/"+Date.now();
        try{
          await sendTransactionalEmail(config,{to:context.email,name:context.display_name||context.email,senderRole:"support",templateKey:"password_changed",data:{name:context.display_name||context.email,locale:context.preferred_locale},idempotencyKey:securityEventId,internalEventId:securityEventId});
        }catch(error){logSecurityEmailFailure("password_changed",error);}
        return done(res,metrics,started,"customer.auth.change_password",200,{ok:true,relogin_required:true},{"Set-Cookie":clearCustomerSessionCookies()});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/events"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"overview.read");
        const tenantId=Number(context.tenant_id);
        res.pgiRoute="customer.events";
        return openEventStream(req,res,eventBus,requestId,config,sseClients,event=>{
          if(!["live_call.started","live_call.ended","call.ingested","customer.jackpot.reset"].includes(String(event?.type||"")))return false;
          return Number(event?.payload?.tenant_id||0)===tenantId;
        });
      }
      if(method==="GET"&&pathname==="/api/v1/customer/jackpot"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"finance.read");
        const jackpot=await store.customerJackpotSnapshot(context.tenant_id);
        return done(res,metrics,started,"customer.jackpot",200,{...jackpot,can_reset:["owner","admin"].includes(context.customer_role)});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/portal"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"overview.read");
        const requestedRange=rangeParams(url);
        const metricRanges=await store.effectiveMetricRanges(requestedRange.from,requestedRange.to,context.tenant_id);
        const canFinance=hasCustomerPermission(context,"finance.read");
        const [rawData,billing]=await Promise.all([
          store.customerPortalOverview(context.tenant_id,requestedRange.from,requestedRange.to,metricRanges),
          canFinance?store.customerBillingPreparation(context.tenant_id):Promise.resolve(null)
        ]);
        const data=scopeCustomerPortalData(context,rawData);
        return done(res,metrics,started,"customer.portal",200,{user:publicCustomerActor(customerActor,context),...data,metric_resets:Object.fromEntries(Object.entries(metricRanges).map(([k,v])=>[k,v.baseline])),billing_offer:billing?.offer||null,billing_summary:billing?{subscription:billing.subscription,premium_call_access:billing.premium_call_access,premium_routing_access:billing.premium_routing_access,billing_currency:billing.billing_currency,pricing_state:billing.pricing_state,reference_offer:billing.reference_offer,checkout_prefill:billing.checkout_prefill,return_paths:billing.return_paths}:{restricted:true},billing_provider:billing?billingProviderStatus(config):{connection_state:"restricted",checkout_available:false,customer_portal_available:false},server_time:new Date().toISOString()});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/team"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"team.read");
        return done(res,metrics,started,"customer.team",200,await store.customerTeam(context.tenant_id));
      }
      if(method==="POST"&&pathname==="/api/v1/customer/team/invitations"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"team.manage");
        const body=await readJson(req,config.bodyLimitBytes);
        const requestedRole=String(body.role||"readonly").trim().toLowerCase();
        if(requestedRole==="owner"&&context.customer_role!=="owner"){const e=new Error("Only an owner can invite another owner");e.status=403;e.code="CUSTOMER_OWNER_REQUIRED";throw e;}
        const invitationIdempotencyKey=String(req.headers["idempotency-key"]||"").trim();
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationIdempotencyKey)){const e=new Error("Invitation idempotency key required");e.status=400;e.code="IDEMPOTENCY_KEY_REQUIRED";throw e;}
        const token=createHmac("sha256",config.sessionSecret).update("customer-team-invite:"+invitationIdempotencyKey).digest("base64url"),tokenHash=createHash("sha256").update(token).digest("hex");
        const payload={tenant_id:context.tenant_id,email:String(body.email||"").trim().toLowerCase(),role:requestedRole};
        const result=await store.idempotent(invitationIdempotencyKey,"customer.team.invitation.create",payload,()=>store.createCustomerTeamInvitation(context.tenant_id,{...body,role:requestedRole},tokenHash,context.id));
        return done(res,metrics,started,"customer.team.invitation_create",201,{...result.value,activation_path:"client.html?invite="+encodeURIComponent(token),replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/team/members/:id");
      if(method==="PATCH"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"team.manage");
        const body=await readJson(req,config.bodyLimitBytes);
        if(String(body.role||"").trim().toLowerCase()==="owner"&&context.customer_role!=="owner"){const e=new Error("Only an owner can grant ownership");e.status=403;e.code="CUSTOMER_OWNER_REQUIRED";throw e;}
        const updated=await store.updateCustomerTeamMember(context.tenant_id,match.id,body,context.id);
        const nextAuthorization=Number(updated.authorization_version||context.authorization_version);
        const issued=issueSession({secret:config.sessionSecret,user:{id:context.id,role:"customer",name:context.display_name||customerActor.name,actor_type:"customer",tenant_id:Number(context.tenant_id),tenant_public_id:context.tenant_public_id,customer_role:context.customer_role,authorization_version:nextAuthorization,session_version:Number(context.session_version)},ttlSeconds:config.sessionTtlSeconds});
        return done(res,metrics,started,"customer.team.member_update",200,updated,{"Set-Cookie":[customerSessionCookie(issued.token,config.sessionTtlSeconds),customerCsrfCookie(issued.csrf,config.sessionTtlSeconds)]});
      }
      match=routeMatch(pathname,"/api/v1/customer/team/invitations/:id/revoke");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"team.manage");
        return done(res,metrics,started,"customer.team.invitation_revoke",200,await store.revokeCustomerTeamInvitation(context.tenant_id,match.id,context.id));
      }

      if(method==="GET"&&pathname==="/api/v1/customer/experience/preferences"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.experience.preferences",200,await store.customerExperiencePreferences(context.tenant_id,context.id));
      }
      if(method==="PUT"&&pathname==="/api/v1/customer/experience/preferences"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"customer.experience.preferences_update",200,await store.saveCustomerExperiencePreferences(context.tenant_id,context.id,body));
      }

      if(method==="GET"&&pathname==="/api/v1/customer/consumption-receipts"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.consumption_receipts",200,{data:await store.customerConsumptionReceipts(context.tenant_id,10)});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/consumption-receipts"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={tenant_id:context.tenant_id,from:body.from,to:body.to};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.consumption_receipt.create",payload,()=>store.createCustomerConsumptionReceipt(context.tenant_id,context.id,body.from,body.to));
        return done(res,metrics,started,"customer.consumption_receipt_create",201,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/customer/billing/status"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"finance.read");
        const billing=await store.customerBillingPreparation(context.tenant_id);
        const withdrawalReady=config.onlineWithdrawalReady===true&&typeof store.customerWithdrawalFeatureReady==="function"&&await store.customerWithdrawalFeatureReady();
        return done(res,metrics,started,"customer.billing.status",200,{billing_provider:billingProviderStatus(config),b2c_commercial_ready:config.b2cCommercialReady===true&&withdrawalReady,b2c_readiness:{legal_operator:config.legalOperatorConfigured===true,consumer_mediator:config.consumerMediatorConfigured===true,online_withdrawal:withdrawalReady},...billing});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/billing/checkout-session"){
        requireCustomerCsrf(req,customerActor,config);
        const checkoutIdempotencyKey=String(req.headers["idempotency-key"]||"").trim();
        if(!checkoutIdempotencyKey||checkoutIdempotencyKey.length>200){const e=new Error("Checkout idempotency key required");e.status=400;e.code="IDEMPOTENCY_KEY_REQUIRED";throw e;}
        const legal=await readJson(req,config.bodyLimitBytes);
        if(legal.subscription_terms_accepted!==true||legal.privacy_notice_acknowledged!==true){const e=new Error("Legal terms acceptance required");e.status=400;e.code="SUBSCRIPTION_LEGAL_TERMS_REQUIRED";throw e;}
        if(legal.immediate_performance_requested!==true){const e=new Error("Immediate performance request required");e.status=400;e.code="IMMEDIATE_PERFORMANCE_REQUEST_REQUIRED";throw e;}
        if(String(legal.legal_version||"")!=="2026-09-26-b2b-b2c-v3"){const e=new Error("Legal document version outdated");e.status=409;e.code="LEGAL_DOCUMENT_VERSION_OUTDATED";throw e;}
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"billing.manage");
        const billing=await store.customerBillingPreparation(context.tenant_id);
        const provider=billingProviderStatus(config);
        const individual=String(billing.tenant?.customer_type||"business")==="individual";
        const withdrawalReady=!individual||(config.onlineWithdrawalReady===true&&typeof store.customerWithdrawalFeatureReady==="function"&&await store.customerWithdrawalFeatureReady());
        if(individual&&(config.b2cCommercialReady!==true||!withdrawalReady)){
          return done(res,metrics,started,"customer.billing.checkout",409,{error:{code:"B2C_COMMERCIAL_NOT_READY",message:"Consumer checkout is temporarily unavailable until mandatory B2C legal prerequisites and the online withdrawal function are operational."},billing_provider:provider,b2c_readiness:{legal_operator:config.legalOperatorConfigured===true,consumer_mediator:config.consumerMediatorConfigured===true,online_withdrawal:withdrawalReady}});
        }
        if(!billing.offer)return done(res,metrics,started,"customer.billing.checkout",409,{error:{code:"NO_ACTIVE_BILLING_OFFER"},billing_provider:provider});
        if(["active","past_due"].includes(String(billing.subscription?.status||"")))return done(res,metrics,started,"customer.billing.checkout",409,{error:{code:"SUBSCRIPTION_ALREADY_EXISTS"},billing_provider:provider});
        if(!provider.checkout_available)return done(res,metrics,started,"customer.billing.checkout",503,{error:{code:"PAYMENT_PROVIDER_NOT_CONNECTED"},billing_provider:provider,checkout:{offer:billing.offer,prefill:billing.checkout_prefill,return_paths:billing.return_paths}});
        const payload={tenant_id:context.tenant_id,price_version_id:billing.offer.price_version_id,provider:"stripe",legal_version:"2026-09-26-b2b-b2c-v3",immediate_performance_requested:true};
        const result=await store.idempotent(checkoutIdempotencyKey,"customer.billing.checkout",payload,async()=>{
          const session=await createStripeCheckout(config,billing,checkoutIdempotencyKey);
          await store.recordCustomerLegalAcceptance(context.tenant_id,context.id,{
            acceptance_type:"subscription_checkout",document_version:"2026-09-26-b2b-b2c-v3",
            documents:{cgu:"/conditions-utilisation/",conditions:"/conditions-abonnement/",privacy:"/confidentialite/",retractation:"/retractation/",cancellation:"/resilier-contrat/"},
            immediate_performance_requested:true,evidence:{source:"customer_checkout",stripe_checkout_created:true}
          });
          return session;
        });
        return done(res,metrics,started,"customer.billing.checkout",201,{...result.value,replayed:result.replayed,billing_provider:provider});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/billing/portal-session"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"billing.manage");
        const billing=await store.customerBillingPreparation(context.tenant_id);
        const provider=billingProviderStatus(config);
        if(!provider.customer_portal_available)return done(res,metrics,started,"customer.billing.portal",503,{error:{code:"PAYMENT_PROVIDER_NOT_CONNECTED"},billing_provider:provider});
        const session=await createStripePortalSession(config,billing);
        return done(res,metrics,started,"customer.billing.portal",201,{...session,billing_provider:provider});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/portability"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.portability.list",200,{data:await store.customerPortabilityRequests(context.tenant_id)});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/portability"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={tenant_id:context.tenant_id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.portability.create",payload,()=>store.createCustomerPortabilityRequest(context.tenant_id,body));
        return done(res,metrics,started,"customer.portability.create",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/portability/:id/cancel");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const payload={tenant_id:context.tenant_id,request_id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.portability.cancel",payload,()=>store.cancelCustomerPortabilityRequest(context.tenant_id,match.id));
        return done(res,metrics,started,"customer.portability.cancel",200,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/customer/incidents"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"incidents.read");
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"customer.incidents.list",200,await store.customerServiceIncidents(context.tenant_id,params));
      }
      if(method==="POST"&&pathname==="/api/v1/customer/incidents"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"incidents.write");
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={tenant_id:context.tenant_id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.service_incident.create",payload,()=>store.createCustomerServiceIncident(context.tenant_id,body,customerActor.sub));
        return done(res,metrics,started,"customer.incidents.create",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/incidents/:id/notes");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"incidents.write");
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={tenant_id:context.tenant_id,incident_id:match.id,body:body.body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.service_incident.note",payload,()=>store.addCustomerServiceIncidentNote(context.tenant_id,match.id,body.body,customerActor.sub));
        return done(res,metrics,started,"customer.incidents.note",201,{...result.value,replayed:result.replayed});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/relations"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.relations.overview",200,await store.customerRelationsOverview(context.tenant_id));
      }
      if(method==="POST"&&pathname==="/api/v1/customer/relations/disputes"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role))throw Object.assign(new Error("Customer role cannot open financial/legal cases"),{status:403,code:"CUSTOMER_RELATIONS_FORBIDDEN"});
        const body=await readJson(req,config.bodyLimitBytes),payload={tenant_id:context.tenant_id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.relation.create",payload,()=>store.createCustomerRelationCase(context.tenant_id,body,customerActor.sub));
        return done(res,metrics,started,"customer.relations.create",201,{...result.value,replayed:result.replayed});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/relations/exits"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role))throw Object.assign(new Error("Customer role cannot request account exit"),{status:403,code:"CUSTOMER_RELATIONS_FORBIDDEN"});
        const body=await readJson(req,config.bodyLimitBytes),payload={tenant_id:context.tenant_id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.exit.create",payload,()=>store.createCustomerExitRequest(context.tenant_id,body,customerActor.sub));
        return done(res,metrics,started,"customer.exit.create",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/relations/:id/messages");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const body=await readJson(req,config.bodyLimitBytes),payload={tenant_id:context.tenant_id,case_id:match.id,body:body.body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.relation.message",payload,()=>store.addCustomerRelationMessage(context.tenant_id,match.id,body.body,customerActor.sub));
        return done(res,metrics,started,"customer.relations.message",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/relations/:id/cancel");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role))throw Object.assign(new Error("Customer role cannot cancel legal cases"),{status:403,code:"CUSTOMER_RELATIONS_FORBIDDEN"});
        const payload={tenant_id:context.tenant_id,case_id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.relation.cancel",payload,()=>store.cancelCustomerRelationCase(context.tenant_id,match.id,customerActor.sub));
        return done(res,metrics,started,"customer.relations.cancel",200,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/relations/actions/:id/confirm");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role))throw Object.assign(new Error("Customer role cannot confirm legal actions"),{status:403,code:"CUSTOMER_RELATIONS_FORBIDDEN"});
        const payload={tenant_id:context.tenant_id,action_id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.relation.action.confirm",payload,()=>store.confirmCustomerRelationAction(context.tenant_id,match.id,customerActor.sub));
        return done(res,metrics,started,"customer.relations.action_confirm",200,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/routing/simulate"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"routing.read");
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"customer.routing.simulate",200,await store.simulateTenantRoutingById(context.tenant_id,body));
      }

      if(method==="GET"&&pathname==="/api/v1/customer/voice-studio"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.voice_studio.list",200,await store.customerVoiceStudio(context.tenant_id));
      }
      if(method==="POST"&&pathname==="/api/v1/customer/voice-studio/services"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role)){const e=new Error("Customer role cannot configure voice services");e.status=403;e.code="VOICE_STUDIO_FORBIDDEN";throw e;}
        const body=await readJson(req,config.bodyLimitBytes),payload={tenant_id:context.tenant_id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.voice_service.create",payload,()=>store.createCustomerVoiceService(context.tenant_id,body,customerActor.sub));
        return done(res,metrics,started,"customer.voice_service.create",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/voice-studio/services/:id/draft");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role)){const e=new Error("Customer role cannot configure voice services");e.status=403;e.code="VOICE_STUDIO_FORBIDDEN";throw e;}
        const body=await readJson(req,config.bodyLimitBytes),payload={tenant_id:context.tenant_id,service_id:match.id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.voice_service.draft",payload,()=>store.saveCustomerVoiceDraft(context.tenant_id,match.id,body,customerActor.sub));
        return done(res,metrics,started,"customer.voice_service.draft",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/voice-studio/services/:id/simulate");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"customer.voice_service.simulate",200,await store.simulateCustomerVoiceService(context.tenant_id,match.id,body));
      }
      match=routeMatch(pathname,"/api/v1/customer/voice-studio/services/:id/publish");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role)){const e=new Error("Customer role cannot publish voice services");e.status=403;e.code="VOICE_STUDIO_FORBIDDEN";throw e;}
        const payload={tenant_id:context.tenant_id,service_id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.voice_service.publish",payload,()=>store.publishCustomerVoiceService(context.tenant_id,match.id,customerActor.sub));
        return done(res,metrics,started,"customer.voice_service.publish",200,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/customer/voice-studio/services/:id/rollback");
      if(method==="POST"&&match){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role)){const e=new Error("Customer role cannot rollback voice services");e.status=403;e.code="VOICE_STUDIO_FORBIDDEN";throw e;}
        const body=await readJson(req,config.bodyLimitBytes),payload={tenant_id:context.tenant_id,service_id:match.id,version_id:body.version_id};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.voice_service.rollback",payload,()=>store.rollbackCustomerVoiceService(context.tenant_id,match.id,body.version_id,customerActor.sub));
        return done(res,metrics,started,"customer.voice_service.rollback",200,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/jackpot/reset"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"finance.read");
        if(!["owner","admin"].includes(context.customer_role)){const e=new Error("Customer role cannot reset jackpot");e.status=403;e.code="CUSTOMER_JACKPOT_RESET_FORBIDDEN";throw e;}
        const payload={tenant_id:context.tenant_id};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.jackpot.reset",payload,()=>store.createCustomerJackpotReset(context.tenant_id,customerActor.sub));
        return done(res,metrics,started,"customer.jackpot.reset",201,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/customer/metrics/reset"){
        requireCustomerCsrf(req,customerActor,config);
        const context=await store.customerSessionContext(customerActor);
        if(!["owner","admin"].includes(context.customer_role)){const e=new Error("Customer role cannot reset shared metrics");e.status=403;e.code="CUSTOMER_METRIC_RESET_FORBIDDEN";throw e;}
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={tenant_id:context.tenant_id,metric_keys:body.metric_keys};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.metrics.reset",payload,()=>store.createCustomerMetricReset(context.tenant_id,body.metric_keys,customerActor.sub));
        return done(res,metrics,started,"customer.metrics.reset",201,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/customer/comparison"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"analytics.read");
        const requestedRange=rangeParams(url);
        const metricRanges=await store.effectiveMetricRanges(requestedRange.from,requestedRange.to,context.tenant_id);
        return done(res,metrics,started,"customer.comparison",200,{...await store.customerPortalComparison(context.tenant_id,requestedRange.from,requestedRange.to,metricRanges),metric_resets:Object.fromEntries(Object.entries(metricRanges).map(([k,v])=>[k,v.baseline]))});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/calls"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        requireCustomerPermission(context,"calls.read");
        const requestedRange=rangeParams(url);
        const range=(await store.effectiveMetricRanges(requestedRange.from,requestedRange.to,context.tenant_id)).calls;
        if(range.empty)return done(res,metrics,started,"customer.calls",200,{data:[],next_cursor:null,metric_reset_at:range.baseline});
        const params={...Object.fromEntries(url.searchParams.entries()),from:range.from,to:range.to};
        return done(res,metrics,started,"customer.calls",200,{...await store.customerPortalCalls(context.tenant_id,params),metric_reset_at:range.baseline});
      }

      if(method==="GET"&&pathname==="/api/v1/security/passkeys"){
        requireActor(actor);
        return done(res,metrics,started,"security.passkeys",200,{configured:webauthnConfigured(config),data:await store.listWebauthnCredentials("staff",actor.sub)});
      }
      if(method==="POST"&&pathname==="/api/v1/security/passkeys/register-options"){
        requireCsrf(req,actor,config);const credentials=await store.listWebauthnCredentials("staff",actor.sub);
        return done(res,metrics,started,"security.passkey_options",200,publicPasskeyOptions(config,"staff:"+actor.sub,actor.name,credentials,"register"));
      }
      if(method==="POST"&&pathname==="/api/v1/security/passkeys/register"){
        requireCsrf(req,actor,config);const body=await readJson(req,config.bodyLimitBytes),stored=typeof store.staffCredentialById==="function"?await store.staffCredentialById(actor.sub):null;
        const reauthOk=stored?.password_hash?verifyPassword(String(body.current_password||""),stored.password_hash):verifyPassword(String(body.current_password||""),config.adminPasswordHash);
        if(!reauthOk){const e=new Error("Password reauthentication required");e.status=401;e.code="PASSKEY_REAUTH_REQUIRED";throw e;}
        const subject="staff:"+actor.sub,state=verifyWebAuthnState(config,body.state,"register",subject),credential=validateWebAuthnRegistration(config,body,state);
        return done(res,metrics,started,"security.passkey_register",201,{credential:await store.registerWebauthnCredential("staff",actor.sub,credential)});
      }
      if(method==="POST"&&pathname==="/api/v1/security/passkeys/assert-options"){
        requireCsrf(req,actor,config);const credentials=await store.listWebauthnCredentials("staff",actor.sub);
        if(!credentials.some(x=>x.enabled!==false)){const e=new Error("No passkey");e.status=409;e.code="WEBAUTHN_CREDENTIAL_REQUIRED";throw e;}
        return done(res,metrics,started,"security.passkey_assert_options",200,publicPasskeyOptions(config,"staff:"+actor.sub,actor.name,credentials,"assert"));
      }
      if(method==="POST"&&pathname==="/api/v1/security/passkeys/verify"){
        requireCsrf(req,actor,config);const body=await readJson(req,config.bodyLimitBytes),subject="staff:"+actor.sub,state=verifyWebAuthnState(config,body.state,"assert",subject),credential=await store.webauthnCredential("staff",actor.sub,body.credential_id);
        if(!credential){const e=new Error("Passkey not found");e.status=404;e.code="WEBAUTHN_CREDENTIAL_NOT_FOUND";throw e;}
        const verified=verifyWebAuthnAssertion(config,body,state,credential);await store.markWebauthnVerified(credential.id,verified.sign_count);
        return done(res,metrics,started,"security.passkey_verify",200,{verified:true,verified_at:new Date().toISOString()});
      }

      if(method==="POST"&&pathname==="/api/v1/auth/logout"){
        requireActor(actor);
        requireCsrf(req,actor,config);
        return done(res,metrics,started,"auth.logout",200,{ok:true},{"Set-Cookie":clearSessionCookies()});
      }
      if(method==="GET"&&pathname==="/api/v1/auth/me"){
        requireActor(actor);
        return done(res,metrics,started,"auth.me",200,{user:publicActor(actor)});
      }

      if(method==="GET"&&pathname==="/api/v1/app/bootstrap"){
        requireRole(actor,["admin","finance","readonly"]);
        const [baselines,wholesale]=await Promise.all([
          store.listBaselines({scope:"global",limit:20}),
          store.wholesaleOverview()
        ]);
        return done(res,metrics,started,"app.bootstrap",200,{
          user:publicActor(actor),
          baselines:{data:baselines},
          wholesale:{...wholesale,billing_provider:billingProviderStatus(config)},
          server_time:new Date().toISOString()
        });
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/bootstrap"){
        requireRole(actor,["admin","finance","readonly"]);
        const requestedRange=rangeParams(url);
        const metricRanges=await store.effectiveMetricRanges(requestedRange.from,requestedRange.to);
        const market=url.searchParams.get("market")||null;
        const previousFrom=url.searchParams.get("previous_from")||null;
        const previousTo=url.searchParams.get("previous_to")||null;
        if((previousFrom&&!previousTo)||(!previousFrom&&previousTo)||
           (previousFrom&&(!Number.isFinite(Date.parse(previousFrom))||!Number.isFinite(Date.parse(previousTo))||Date.parse(previousTo)<Date.parse(previousFrom)))){
          const e=new Error("Invalid previous range");e.status=400;e.code="INVALID_PREVIOUS_RANGE";throw e;
        }
        const previousRanges=previousFrom?await store.effectiveMetricRanges(previousFrom,previousTo):null;
        const [summary,previousSummary,analytics,voiceIntelligence,experts,system,route,reconciliation]=await Promise.all([
          selectiveSummary(store,metricRanges,market),
          previousRanges?selectiveSummary(store,previousRanges,market):Promise.resolve(null),
          selectiveAnalytics(store,metricRanges,market),
          typeof store.voiceIntelligence==="function"?store.voiceIntelligence(metricRanges.quality.from,metricRanges.quality.to,market):Promise.resolve(null),
          store.listExperts(),
          store.systemSnapshot(),
          store.carrierRouting(),
          store.reconciliation(metricRanges.payout.from,metricRanges.payout.to,market)
        ]);
        return done(res,metrics,started,"dashboard.bootstrap",200,{
          summary,
          previous_summary:previousSummary,
          analytics,
          voice_intelligence:voiceIntelligence,
          experts:{data:experts},
          system:runtimeSystemSnapshot(system,eventBus,workers,config),
          route,
          reconciliation:{data:reconciliation},
          metric_resets:Object.fromEntries(Object.entries(metricRanges).map(([k,v])=>[k,v.baseline])),
          server_time:new Date().toISOString()
        });
      }
      if(method==="GET"&&pathname==="/api/v1/dashboard/summary"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        const requestedRange=rangeParams(url);
        const metricRanges=await store.effectiveMetricRanges(requestedRange.from,requestedRange.to);
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"dashboard.summary",200,{...await selectiveSummary(store,metricRanges,market),metric_resets:Object.fromEntries(Object.entries(metricRanges).map(([k,v])=>[k,v.baseline]))});
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/live-finance"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"dashboard.live_finance",200,await store.liveFinancialByTenant(50));
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/analytics"){
        requireRole(actor,["admin","finance","readonly"]);
        const requestedRange=rangeParams(url);
        const metricRanges=await store.effectiveMetricRanges(requestedRange.from,requestedRange.to);
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"dashboard.analytics",200,{...await selectiveAnalytics(store,metricRanges,market),metric_resets:Object.fromEntries(Object.entries(metricRanges).map(([k,v])=>[k,v.baseline]))});
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/voice-intelligence"){
        requireRole(actor,["admin","finance","readonly"]);
        const requestedRange=rangeParams(url);
        const range=(await store.effectiveMetricRanges(requestedRange.from,requestedRange.to)).quality;
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"dashboard.voice_intelligence",200,{...await store.voiceIntelligence(range.from,range.to,market),metric_reset_at:range.baseline});
      }

      if(method==="GET"&&pathname==="/api/v1/calls"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        const requestedFrom=params.from||new Date(0).toISOString(),requestedTo=params.to||new Date().toISOString();
        const range=(await store.effectiveMetricRanges(requestedFrom,requestedTo)).calls;
        if(range.empty)return done(res,metrics,started,"calls.list",200,{data:[],next_cursor:null,metric_reset_at:range.baseline});
        params.from=range.from;params.to=range.to;
        if(actor.role==="expert")params.expert_id=actor.expert_id||actor.sub;
        return done(res,metrics,started,"calls.list",200,{...await store.listCalls(params),metric_reset_at:range.baseline});
      }

      if(method==="GET"&&pathname==="/api/v1/experts"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"experts.list",200,{data:await store.listExperts()});
      }

      match=routeMatch(pathname,"/api/v1/experts/:id/status");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);
        requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"experts.status",200,await store.setExpertStatus(match.id,body.status));
      }

      if(method==="POST"&&pathname==="/api/v1/routing/next-expert"){
        requireRole(actor,["admin"]);
        requireCsrf(req,actor,config);
        const expert=await store.selectExpert();
        return done(res,metrics,started,"routing.next_expert",expert?200:404,expert||{error:{code:"NO_EXPERT_AVAILABLE"}});
      }

      if(method==="GET"&&pathname==="/api/v1/internal/routing/next-destination/text"){
        authorizeTelephony(req,config);const routingContext=resolveTelephonyRoutingContext(url,config);const route=await store.selectCallDestination(routingContext);
        if(!route?.destination_uri){res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});res.end("");return;}
        text(res,200,[route.destination_uri,String(route.call_destination_id||""),String(route.label||route.display_name||"").replace(/[\t\r\n]/g," "),String(route.destination_type||""),String(route.route_kind||"destination"),String(route.expert_id||"")].join("\t"));return;
      }
      if(method==="GET"&&pathname==="/api/v1/internal/routing/next-destination"){
        authorizeTelephony(req,config);const route=await store.selectCallDestination(resolveTelephonyRoutingContext(url,config));
        return done(res,metrics,started,"routing.destination",route?200:404,route||{error:{code:"NO_CALL_DESTINATION_AVAILABLE"}});
      }

      if(method==="GET"&&pathname==="/api/v1/internal/routing/next-expert/text"){
        authorizeTelephony(req,config);
        const routingContext=resolveTelephonyRoutingContext(url,config);
        const expert=await store.selectExpert(routingContext);
        if(!expert?.destination_uri){
          res.writeHead(404,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
          res.end("");
          return;
        }
        const line=[expert.destination_uri,String(expert.id||""),String(expert.display_name||"").replace(/[\t\r\n]/g," ")].join("\t");
        text(res,200,line);
        return;
      }

      if(method==="GET"&&pathname==="/api/v1/internal/routing/next-expert"){
        authorizeTelephony(req,config);
        const routingContext=resolveTelephonyRoutingContext(url,config);
        const expert=await store.selectExpert(routingContext);
        return done(res,metrics,started,"routing.internal",expert?200:404,expert||{error:{code:"NO_EXPERT_AVAILABLE"}});
      }

      match=routeMatch(pathname,"/api/v1/internal/call-destinations/:id/release");
      if(method==="POST"&&match){authorizeTelephony(req,config);return done(res,metrics,started,"routing.destination_release",200,await store.releaseCallDestination(match.id));}

      match=routeMatch(pathname,"/api/v1/internal/experts/:id/release");
      if(method==="POST"&&match){
        authorizeTelephony(req,config);
        return done(res,metrics,started,"routing.release",200,await store.releaseExpert(match.id));
      }

      if(method==="POST"&&pathname==="/api/v1/internal/live-calls/start"){
        authorizeTelephony(req,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"live_call.start",201,await store.startLiveCallFinancial(body));
      }
      if(method==="POST"&&pathname==="/api/v1/internal/live-calls/stop"){
        authorizeTelephony(req,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"live_call.stop",200,await store.stopLiveCallFinancial(body.external_call_id,body.status,body.ended_at));
      }

      if(method==="GET"&&pathname==="/api/v1/finance/reconciliation"){
        requireRole(actor,["admin","finance","readonly"]);
        const requestedRange=rangeParams(url);
        const range=(await store.effectiveMetricRanges(requestedRange.from,requestedRange.to)).payout;
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"finance.reconciliation",200,{data:await store.reconciliation(range.from,range.to,market),metric_reset_at:range.baseline});
      }

      if(method==="GET"&&pathname==="/api/v1/system/health"){
        requireRole(actor,["admin","readonly"]);
        const system=await store.systemSnapshot();
        return done(res,metrics,started,"system.health",200,runtimeSystemSnapshot(system,eventBus,workers,config));
      }

      if(method==="GET"&&pathname==="/api/v1/carrier-routing"){
        requireRole(actor,["admin","readonly"]);
        return done(res,metrics,started,"carrier.routing",200,await store.carrierRouting());
      }

      if(method==="GET"&&pathname==="/api/v1/carrier-switches/options"){
        requireRole(actor,["admin","readonly"]);
        return done(res,metrics,started,"carrier.switch_options",200,await store.carrierAdminOverview());
      }

      if(method==="GET"&&pathname==="/api/v1/platform/overview"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.overview",200,await store.wholesaleOverview());
      }

      if(method==="GET"&&pathname==="/api/v1/platform/control-tower"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.control_tower",200,await store.controlTowerOverview());
      }

      if(method==="GET"&&pathname==="/api/v1/platform/performance-lab"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.performance_lab",200,await store.performanceResilienceLab());
      }

      if(method==="POST"&&pathname==="/api/v1/platform/performance-lab/runs"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"performance_lab.run.record",body,()=>store.recordPerformanceLabRun(body,actor));
        return done(res,metrics,started,"platform.performance_lab_run",201,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/platform/performance-lab/synthetic"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"performance_lab.synthetic.record",body,()=>store.recordSyntheticProbe(body));
        return done(res,metrics,started,"platform.performance_lab_synthetic",201,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/staff-users"){
        requireRole(actor,["admin"]);
        return done(res,metrics,started,"platform.staff_users",200,{data:await store.listStaffUsers()});
      }

      if(method==="POST"&&pathname==="/api/v1/platform/staff-users"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes),password=String(body.password||"");
        if(password.length<12||password.length>256){const e=new Error("Invalid staff password");e.status=400;e.code="INVALID_STAFF_PASSWORD";throw e;}
        const payload={login_name:body.login_name,email:body.email,display_name:body.display_name,role:body.role||"readonly"};
        const result=await store.idempotent(req.headers["idempotency-key"],"staff_user.create",{...payload,password_sha256:createHash("sha256").update(password).digest("hex")},()=>store.createStaffUser(payload,hashPassword(password),actor));
        return done(res,metrics,started,"platform.staff_user_create",201,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/change-requests"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.change_requests",200,await store.listPlatformChangeRequests(params));
      }

      match=routeMatch(pathname,"/api/v1/platform/change-requests/:id/approve");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={id:match.id,reason:body.reason||""};
        const result=await store.idempotent(req.headers["idempotency-key"],"platform.change.approve",payload,()=>store.approvePlatformChangeRequest(match.id,actor,body));
        return done(res,metrics,started,"platform.change_approve",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/change-requests/:id/reject");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={id:match.id,reason:body.reason||""};
        const result=await store.idempotent(req.headers["idempotency-key"],"platform.change.reject",payload,()=>store.rejectPlatformChangeRequest(match.id,actor,body));
        return done(res,metrics,started,"platform.change_reject",200,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/platform/policy/evaluate"){
        requireRole(actor,["admin","finance","readonly"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"platform.policy_evaluate",200,await store.operationalPolicyEvaluation(body));
      }

      if(method==="POST"&&pathname==="/api/v1/platform/digital-twin/simulate"){
        requireRole(actor,["admin","finance","readonly"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"platform.digital_twin",200,await store.digitalTwinSimulation(body));
      }

      if(method==="GET"&&pathname==="/api/v1/platform/customer-profitability"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.customer_profitability",200,await store.customerProfitability(params));
      }

      if(method==="GET"&&pathname==="/api/v1/platform/tenants/summary"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.tenant_summary",200,await store.customerAdminSummary());
      }

      if(method==="GET"&&pathname==="/api/v1/platform/tenants"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.tenants",200,await store.listTenants(params));
      }

      if(method==="POST"&&pathname==="/api/v1/platform/tenants/duplicates"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"platform.tenant_duplicates",200,await store.tenantDuplicateCandidates(body));
      }

      if(method==="POST"&&pathname==="/api/v1/platform/tenants"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"tenant.create",body,()=>store.createTenant(body,actor));
        return done(res,metrics,started,"platform.tenant_create",201,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/tenant-number-assignments"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.tenant_assignments",200,await store.listTenantAssignments(params));
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/customer-users");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.customer_users",200,{data:await store.customerPortalUsers(match.id)});
      }
      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/customer-invitations");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const token=randomBytes(32).toString("base64url");
        const tokenHash=createHash("sha256").update(token).digest("hex");
        const result=await store.idempotent(req.headers["idempotency-key"],"customer.invitation.create",{tenant:match.id,email:body.email,role:body.role||"readonly"},()=>store.createCustomerPortalInvitation(match.id,body,tokenHash));
        return done(res,metrics,started,"platform.customer_invitation",201,{...result.value,activation_path:"client.html?invite="+encodeURIComponent(token),replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/control-center");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.tenant_control_center",200,await store.tenantControlDetail(match.id));
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/consumption-today");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.tenant_consumption_today",200,await store.tenantConsumptionToday(match.id));
      }
      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/consumption-receipts");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.tenant_consumption_receipts",200,{data:await store.tenantConsumptionReceipts(match.id,10)});
      }
      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/consumption-receipts/:receipt/reconcile");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.tenant_consumption_reconcile",200,await store.reconcileTenantConsumptionReceipt(match.id,match.receipt));
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/export");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        return done(res,metrics,started,"platform.tenant_admin_export",200,await store.tenantAdminExport(match.id,actor));
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/internal-notes");
      if(method==="GET"&&match){
        requireRole(actor,["admin"]);
        return done(res,metrics,started,"platform.tenant_internal_notes",200,await store.tenantInternalNotes(match.id));
      }
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={tenant:match.id,body_hash:createHash("sha256").update(String(body.body||"")).digest("hex")};
        const result=await store.idempotent(req.headers["idempotency-key"],"tenant.internal_note.create",payload,()=>store.createTenantInternalNote(match.id,body,actor));
        return done(res,metrics,started,"platform.tenant_internal_note_create",201,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-internal-notes/:id/archive");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const result=await store.idempotent(req.headers["idempotency-key"],"tenant.internal_note.archive",{id:match.id},()=>store.archiveTenantInternalNote(match.id,actor));
        return done(res,metrics,started,"platform.tenant_internal_note_archive",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/payout-terms");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"tenant.payout_terms.create",{tenant:match.id,...body},()=>store.createTenantPayoutTerms(match.id,body,actor));
        return done(res,metrics,started,"platform.tenant_payout_terms",201,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/status");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={id:match.id,status:body.status,reason:body.reason||""};
        const result=await store.idempotent(req.headers["idempotency-key"],"tenant.status",payload,()=>store.setTenantStatus(match.id,body.status,actor,body.reason||""));
        return done(res,metrics,started,"platform.tenant_status",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/status");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={id:match.id,status:body.status,reason:body.reason||""};
        const result=await store.idempotent(req.headers["idempotency-key"],"assignment.status",payload,()=>store.setTenantAssignmentStatus(match.id,body.status,actor,body.reason||""));
        return done(res,metrics,started,"platform.assignment_status",200,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/sva-compliance"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.sva_compliance",200,await store.svaComplianceOverview());
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/sva-compliance-profile");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"sva.compliance.profile",{id:match.id,...body},()=>store.upsertSvaServiceComplianceProfile(match.id,body,actor));
        return done(res,metrics,started,"platform.sva_compliance_profile",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/sva-compliance-evidence");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"sva.compliance.evidence",{id:match.id,...body},()=>store.recordSvaEcosystemEvidence(match.id,body,actor));
        return done(res,metrics,started,"platform.sva_compliance_evidence",201,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/sva-tariff-change");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"sva.tariff_change.plan",{id:match.id,...body},()=>store.planSvaTariffChange(match.id,body,actor));
        return done(res,metrics,started,"platform.sva_tariff_change",201,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/regulatory-profile");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"regulatory.profile.update",{id:match.id,...body},()=>store.upsertSvaRegulatoryProfile(match.id,body,actor));
        return done(res,metrics,started,"platform.regulatory_profile",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/regulatory-evidence-pack");
      if(method==="POST"&&match){
        requireRole(actor,["admin","finance","readonly"]);requireCsrf(req,actor,config);
        const payload={id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"regulatory.evidence_pack.export",payload,()=>store.regulatoryEvidencePack(match.id,actor));
        return done(res,metrics,started,"platform.regulatory_evidence_pack",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/regulatory-evidence");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"regulatory.evidence.append",{id:match.id,...body},()=>store.recordSvaRegulatoryEvidence(match.id,body,actor));
        return done(res,metrics,started,"platform.regulatory_evidence",201,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/regulatory-review-alerts"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.regulatory_review_alerts",200,await store.listRegulatoryReviewAlerts(params));
      }

      match=routeMatch(pathname,"/api/v1/platform/regulatory-review-alerts/:id/acknowledge");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const payload={id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"regulatory.review_alert.acknowledge",payload,()=>store.acknowledgeRegulatoryReviewAlert(match.id,actor));
        return done(res,metrics,started,"platform.regulatory_review_alert_ack",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenant-number-assignments/:id/abuse-cases");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"regulatory.abuse.open",{id:match.id,...body},()=>store.createSvaAbuseCase(match.id,body,actor));
        return done(res,metrics,started,"platform.regulatory_abuse",201,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/call-destinations");
      if(method==="POST"&&match){requireRole(actor,["admin"]);requireCsrf(req,actor,config);const body=await readJson(req,config.bodyLimitBytes);const result=await store.idempotent(req.headers["idempotency-key"],"call_destination.create",{tenant:match.id,...body},()=>store.createCallDestination(match.id,body,actor));return done(res,metrics,started,"platform.call_destination_create",201,{...result.value,replayed:result.replayed});}
      match=routeMatch(pathname,"/api/v1/platform/call-destinations/:id/status");
      if(method==="POST"&&match){requireRole(actor,["admin"]);requireCsrf(req,actor,config);const body=await readJson(req,config.bodyLimitBytes);const payload={id:match.id,status:body.status,reason:body.reason||""};const result=await store.idempotent(req.headers["idempotency-key"],"call_destination.status",payload,()=>store.setCallDestinationStatus(match.id,body.status,actor,body.reason||""));return done(res,metrics,started,"platform.call_destination_status",200,{...result.value,replayed:result.replayed});}

      match=routeMatch(pathname,"/api/v1/platform/portability/:id/status");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={id:match.id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"portability.status",payload,()=>store.updatePortabilityRequest(match.id,body,actor));
        return done(res,metrics,started,"platform.portability_status",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/portability/:id/complete");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={id:match.id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"portability.complete",payload,()=>store.completePortabilityRequest(match.id,body,actor));
        return done(res,metrics,started,"platform.portability_complete",200,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/service-incidents"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.service_incidents.list",200,await store.listServiceIncidents(params));
      }

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/incidents");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={tenant:match.id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"service_incident.create",payload,()=>store.createTenantServiceIncident(match.id,body,actor));
        return done(res,metrics,started,"platform.service_incident.create",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/platform/incidents/:id");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.service_incident.detail",200,await store.serviceIncidentDetail(match.id));
      }

      match=routeMatch(pathname,"/api/v1/platform/incidents/:id/status");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={incident:match.id,status:body.status||null,severity:body.severity||null};
        const result=await store.idempotent(req.headers["idempotency-key"],"service_incident.update",payload,()=>store.updateServiceIncident(match.id,body,actor));
        return done(res,metrics,started,"platform.service_incident.update",200,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/platform/incidents/:id/notes");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const payload={incident:match.id,body:body.body,customer_visible:body.customer_visible!==false};
        const result=await store.idempotent(req.headers["idempotency-key"],"service_incident.note",payload,()=>store.addServiceIncidentNote(match.id,body,actor));
        return done(res,metrics,started,"platform.service_incident.note",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/routing/simulate");
      if(method==="POST"&&match){
        requireRole(actor,["admin","readonly"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        return done(res,metrics,started,"platform.routing.simulate",200,await store.simulateTenantRouting(match.id,body));
      }

      if(method==="GET"&&pathname==="/api/v1/platform/customer-relations/queue"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.customer_relations.queue",200,await store.listCustomerRelationsQueue(params));
      }
      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/customer-relations");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.customer_relations.tenant",200,await store.tenantCustomerRelations(match.id));
      }
      match=routeMatch(pathname,"/api/v1/platform/customer-relations/:id/agent-context");
      if(method==="GET"&&match){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.customer_relations.agent_context",200,await store.relationAgentContext(match.id));
      }
      match=routeMatch(pathname,"/api/v1/platform/customer-relations/:id/actions");
      if(method==="POST"&&match){
        requireRole(actor,["admin","finance"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes),payload={case_id:match.id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer_relation.agent_action",payload,()=>store.createRelationAgentAction(match.id,body,actor));
        return done(res,metrics,started,"platform.customer_relations.agent_action",201,{...result.value,replayed:result.replayed});
      }
      match=routeMatch(pathname,"/api/v1/platform/customer-relations/actions/:id/approve");
      if(method==="POST"&&match){
        requireRole(actor,["admin","finance"]);requireCsrf(req,actor,config);
        const payload={action_id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer_relation.action_approve",payload,()=>store.approveRelationAction(match.id,actor));
        return done(res,metrics,started,"platform.customer_relations.action_approve",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/platform/customer-relations/actions/:id/external-confirm");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes),payload={action_id:match.id,...body};
        const result=await store.idempotent(req.headers["idempotency-key"],"customer_relation.external_confirm",payload,()=>store.completeRelationExternalAction(match.id,body,actor));
        return done(res,metrics,started,"platform.customer_relations.external_confirm",200,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/billing-alerts"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.billing_alerts",200,await store.listAdminAlerts(params));
      }

      match=routeMatch(pathname,"/api/v1/platform/billing-alerts/:id/acknowledge");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const payload={id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"billing.alert.acknowledge",payload,()=>store.acknowledgeAdminAlert(match.id,actor));
        return done(res,metrics,started,"platform.billing_alert_ack",200,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/platform/subscription-billing"){
        requireRole(actor,["admin","finance","readonly"]);
        const overview=await store.subscriptionBillingOverview();
        return done(res,metrics,started,"platform.subscription_billing",200,{...overview,billing_provider:billingProviderStatus(config)});
      }

      if(method==="POST"&&pathname==="/api/v1/platform/subscription-prices"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"subscription.price.publish",body,()=>store.createSubscriptionPrice(body,actor));
        return done(res,metrics,started,"platform.subscription_price",201,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/carrier-switches"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"carrier.switch.plan",body,()=>store.planCarrierSwitch(body,actor));
        return done(res,metrics,started,"carrier.switch.plan",201,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/carrier-switches/:id/activate");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body={id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"carrier.switch.activate",body,()=>store.activateCarrierSwitch(match.id,actor));
        return done(res,metrics,started,"carrier.switch.activate",200,{...result.value,replayed:result.replayed});
      }

      match=routeMatch(pathname,"/api/v1/carrier-switches/:id/rollback");
      if(method==="POST"&&match){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body={id:match.id};
        const result=await store.idempotent(req.headers["idempotency-key"],"carrier.switch.rollback",body,()=>store.rollbackCarrierSwitch(match.id,actor));
        return done(res,metrics,started,"carrier.switch.rollback",200,{...result.value,replayed:result.replayed});
      }

      if(method==="GET"&&pathname==="/api/v1/metrics/baselines"){
        requireRole(actor,["admin","finance","readonly"]);
        const params={scope:url.searchParams.get("scope")||"global",limit:url.searchParams.get("limit")||20};
        return done(res,metrics,started,"baseline.list",200,{data:await store.listBaselines(params)});
      }

      if(method==="POST"&&pathname==="/api/v1/metrics/baselines"){
        requireRole(actor,["admin"]);requireCsrf(req,actor,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.idempotent(req.headers["idempotency-key"],"baseline.create",body,()=>store.createBaseline(body,actor));
        return done(res,metrics,started,"baseline.create",201,{...result.value,replayed:result.replayed});
      }

      if(method==="POST"&&pathname==="/api/v1/internal/billing/subscription-event"){
        if(!config.externalBillingEnabled)return done(res,metrics,started,"billing.subscription_event",404,{error:{code:"EXTERNAL_BILLING_DISABLED"}});
        authorizeBilling(req,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.applySubscriptionBillingEvent(body);
        return done(res,metrics,started,"billing.subscription_event",result.duplicate?200:201,result);
      }

      if(method==="POST"&&pathname==="/api/v1/ingest/cdr"){
        authorizeIngest(req,config);
        const body=await readJson(req,config.bodyLimitBytes);
        const result=await store.ingestCdr(body);
        return done(res,metrics,started,"cdr.ingest",result.duplicate?200:201,result);
      }

      if(method==="POST"&&pathname==="/api/v1/ingest/freeswitch"){
        authorizeTelephony(req,config);
        const raw=await readJson(req,config.bodyLimitBytes);
        const envelope=normalizeFreeSwitchCdr(raw,{uuid:url.searchParams.get("uuid"),callerHashKey:config.callerHashKey||"simulator-caller-hash-key"});
        const result=await store.ingestCdr(envelope);
        return done(res,metrics,started,"cdr.freeswitch",result.duplicate?200:201,result);
      }

      if(method==="GET"&&pathname==="/api/v1/events"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        res.pgiRoute="events";
        return openEventStream(req,res,eventBus,requestId,config,sseClients);
      }

      if((method==="GET"||method==="HEAD")&&await staticSite(req,res,pathname)){
        res.pgiRoute="static";bump(metrics.byStatus,200);bump(metrics.byRoute,"static");return;
      }
      return done(res,metrics,started,"not_found",404,{error:{code:"NOT_FOUND",request_id:requestId}});
    }catch(error){
      metrics.errors++;
      const status=Number(error?.status)||500;
      res.pgiRoute=res.pgiRoute||"error";
      bump(metrics.byStatus,status);
      problemJson(res,error,requestId);
    }
  });

  server.headersTimeout=15000;
  server.requestTimeout=30000;
  server.keepAliveTimeout=5000;
  server.maxRequestsPerSocket=1000;

  const queueHandlers={
    ...createPortabilityQueueHandlers({store,config}),
    ...createOutboundPortabilityQueueHandlers({store,config}),
    ...(options.queueHandlers||{})
  };
  const workers=config.processRole==="api"
    ?disabledWorkers()
    :startWorkers({store,eventBus,config,queueHandlers});

  return {
    server,store,eventBus,config,metrics,
    async listen(){
      await new Promise((resolve,reject)=>{
        server.once("error",reject);
        server.listen(config.port,config.host,()=>{server.off("error",reject);resolve();});
      });
      return server.address();
    },
    async close(){
      workers.stop();
      for(const client of sseClients){
        try{client.end();}catch{}
      }
      sseClients.clear();
      if(server.listening)await closeHttpServer(server,Number(config.shutdownGraceMs||10000));
      if(options.closeStore&&typeof eventBus.close==="function")await eventBus.close();
      if(options.closeStore&&typeof store.close==="function")await store.close();
    }
  };
}

export function resolveTelephonyRoutingContext(url,config){
  const svaNumber=String(url?.searchParams?.get("sva_number")||"").trim();
  if(svaNumber&&(svaNumber.length>32||!/^[+0-9 .()\-]+$/.test(svaNumber))){
    const e=new Error("Invalid SVA routing context");e.status=400;e.code="INVALID_SVA_ROUTING_CONTEXT";throw e;
  }
  if(config?.mode==="production"&&!svaNumber){
    const e=new Error("SVA number is required for production telephony routing");e.status=400;e.code="SVA_ROUTING_CONTEXT_REQUIRED";throw e;
  }
  return {svaNumber:svaNumber||null};
}

export function billingProviderStatus(config){
  const external=Boolean(config?.externalBillingEnabled),stripe=stripeProviderState(config);
  const state=stripe.connected?"connected":stripe.api?"checkout_ready_webhook_pending":stripe.webhook?"webhook_ready_checkout_pending":external?"event_ingest_enabled":"not_connected";
  return Object.freeze({
    architecture_ready:true,
    target_provider:"stripe",
    connection_state:state,
    external_billing_enabled:external,
    checkout_available:stripe.api,
    customer_portal_available:stripe.api,
    webhook_ingest_enabled:stripe.webhook,
    stripe_live_mode:Boolean(config?.stripeLiveMode),
    checkout_mode:"provider_hosted",
    customer_portal_mode:"provider_hosted",
    payment_data_storage:"provider_only",
    pgi_stores_card_data:false,
    price_versioning:true,
    event_deduplication:true,
    event_collision_detection:true,
    tenant_binding_validation:true,
    checkout_idempotency_required:true,
    normalized_ingest_private:true,
    provider_webhook_adapter_required:true,
    provider_signature_validation_at_adapter:true,
    automatic_access_recovery:true,
    subscription_funds_flow:"customer_to_pgi",
    sva_payout_flow:"carrier_to_pgi_to_customer",
    pgi_margin_retained:true,
    client_payout_compliance_gated:true,
    funds_custody_mode:"payment_compliance_profile"
  });
}

export function evaluateReadiness(snapshot,workers,config,nowMs=Date.now()){
  const productionStore=config?.mode!=="production"||snapshot?.store==="postgres";
  const role=config?.processRole||"all";
  const outboxAge=ageSeconds(workers?.stats?.lastOutboxSuccessAt,nowMs);
  const alertsAge=ageSeconds(workers?.stats?.lastAlertsSuccessAt,nowMs);
  const outboxWorker=Number.isFinite(outboxAge)&&outboxAge<=Number(config?.outboxWorkerStaleSeconds||15);
  const alertsWorker=Number.isFinite(alertsAge)&&alertsAge<=Number(config?.alertsWorkerStaleSeconds||120);
  const checks={database:productionStore};
  if(role!=="api"){
    checks.outbox_worker=outboxWorker;
    checks.alerts_worker=alertsWorker;
  }
  return {
    ready:Object.values(checks).every(Boolean),
    checks,
    process_role:role,
    ages_seconds:{
      outbox_worker:Number.isFinite(outboxAge)?Math.round(outboxAge):null,
      alerts_worker:Number.isFinite(alertsAge)?Math.round(alertsAge):null
    }
  };
}
function runtimeSystemSnapshot(system,eventBus,workers,config){
  const relay=eventBus?.relayStatus||{};
  return {
    ...(system||{}),
    realtime:{
      attached:Boolean(relay.attached),
      listening:Boolean(relay.listening),
      published:Number(relay.published||0),
      received:Number(relay.received||0),
      errors:Number(relay.errors||0),
      subscribers:Number(eventBus?.size||0)
    },
    workers:{
      process_role:config?.processRole||"all",
      disabled:Boolean(workers?.stats?.disabled),
      outbox_runs:Number(workers?.stats?.outboxRuns||0),
      outbox_errors:Number(workers?.stats?.outboxErrors||0),
      alerts_runs:Number(workers?.stats?.alertsRuns||0),
      alerts_errors:Number(workers?.stats?.alertsErrors||0),
      queue_runs:Number(workers?.stats?.queueRuns||0),
      queue_errors:Number(workers?.stats?.queueErrors||0),
      queue_processed:Number(workers?.stats?.queueProcessed||0),
      queue_dead_letters:Number(workers?.stats?.queueDeadLetters||0),
      last_outbox_success_at:workers?.stats?.lastOutboxSuccessAt||null,
      last_alerts_success_at:workers?.stats?.lastAlertsSuccessAt||null,
      last_queue_success_at:workers?.stats?.lastQueueSuccessAt||null
    }
  };
}

function disabledWorkers(){
  return {
    stats:{
      outboxRuns:0,outboxErrors:0,alertsRuns:0,alertsErrors:0,
      queueRuns:0,queueErrors:0,queueProcessed:0,queueDeadLetters:0,
      lastOutboxSuccessAt:null,lastAlertsSuccessAt:null,lastQueueSuccessAt:null,
      lastOutboxErrorAt:null,lastAlertsErrorAt:null,lastQueueErrorAt:null,
      disabled:true
    },
    stop(){}
  };
}
function ageSeconds(value,nowMs){
  const ms=Date.parse(value||"");
  return Number.isFinite(ms)?Math.max(0,(nowMs-ms)/1000):Infinity;
}

function authenticate(req,config){
  if(config.authMode==="disabled"){
    if(config.mode==="production")return null;
    return {sub:"local-admin",role:"admin",name:"Local Simulator",csrf:"disabled"};
  }
  const cookies=parseCookies(req.headers.cookie||"");
  return verifySession(cookies["__Host-pgi_session"],config.sessionSecret);
}
function authenticateCustomer(req,config){
  if(config.authMode!=="session")return null;
  const cookies=parseCookies(req.headers.cookie||"");
  const actor=verifySession(cookies["__Host-pgi_customer_session"],config.sessionSecret);
  return actor?.actor_type==="customer"?actor:null;
}
function requireActor(actor){
  if(!actor){const e=new Error("Authentication required");e.status=401;e.code="AUTH_REQUIRED";throw e;}
}
function requireRole(actor,roles){
  requireActor(actor);
  if(!roles.includes(actor.role)){const e=new Error("Forbidden");e.status=403;e.code="FORBIDDEN";throw e;}
}
function requireCsrf(req,actor,config){
  if(config.authMode==="disabled")return;
  const cookies=parseCookies(req.headers.cookie||"");
  const header=String(req.headers["x-csrf-token"]||"");
  const cookieToken=cookies["__Host-pgi_csrf"]||"";
  if(!header||!cookieToken||!constantTimeTokenEqual(header,cookieToken)||!constantTimeTokenEqual(header,actor.csrf)){
    const e=new Error("CSRF validation failed");e.status=403;e.code="CSRF_FAILED";throw e;
  }
}
function requireCustomerCsrf(req,actor,config){
  requireActor(actor);
  const cookies=parseCookies(req.headers.cookie||"");
  const header=String(req.headers["x-csrf-token"]||"");
  const cookieToken=cookies["__Host-pgi_customer_csrf"]||"";
  if(!header||!cookieToken||!constantTimeTokenEqual(header,cookieToken)||!constantTimeTokenEqual(header,actor.csrf)){
    const e=new Error("Customer CSRF validation failed");e.status=403;e.code="CUSTOMER_CSRF_FAILED";throw e;
  }
}
function authorizeTelephony(req,config){
  if(config.mode==="simulator"&&!config.telephonyUser&&!config.telephonyPassword){
    if(!isLoopback(clientIp(req,config.trustProxy))){const e=new Error("Telephony endpoint restricted to loopback");e.status=403;e.code="TELEPHONY_FORBIDDEN";throw e;}
    return;
  }
  const header=String(req.headers.authorization||"");
  if(!header.startsWith("Basic ")){const e=new Error("Telephony authentication required");e.status=401;e.code="TELEPHONY_AUTH_REQUIRED";throw e;}
  let decoded="";
  try{decoded=Buffer.from(header.slice(6),"base64").toString("utf8");}catch{}
  const i=decoded.indexOf(":");
  const user=i>=0?decoded.slice(0,i):"";
  const pass=i>=0?decoded.slice(i+1):"";
  if(!constantTimeTokenEqual(user,config.telephonyUser)||!constantTimeTokenEqual(pass,config.telephonyPassword)){
    const e=new Error("Invalid telephony credentials");e.status=401;e.code="TELEPHONY_AUTH_FAILED";throw e;
  }
}

function authorizeBilling(req,config){
  const token=String(req.headers["x-pgi-billing-token"]||"");
  if(!config.externalBillingEnabled||!config.billingIngestToken||!constantTimeTokenEqual(token,config.billingIngestToken)){
    const e=new Error("Invalid billing token");e.status=401;e.code="BILLING_AUTH_FAILED";throw e;
  }
}

function authorizeIngest(req,config){
  if(config.mode==="simulator"&&!config.ingestToken){
    if(!isLoopback(clientIp(req,config.trustProxy))){const e=new Error("Ingest restricted to loopback");e.status=403;e.code="INGEST_FORBIDDEN";throw e;}
    return;
  }
  const token=String(req.headers["x-pgi-ingest-token"]||"");
  if(!config.ingestToken||!constantTimeTokenEqual(token,config.ingestToken)){
    const e=new Error("Invalid ingest token");e.status=401;e.code="INGEST_AUTH_FAILED";throw e;
  }
}

function authorizeMachineEndpoint(req,config){
  if(!config.protectMachineEndpoints)return;
  const socketIp=String(req.socket?.remoteAddress||"");
  const effectiveIp=clientIp(req,config.trustProxy);
  if(isLoopback(socketIp)&&isLoopback(effectiveIp))return;
  authorizeIngest(req,config);
}
function isLoopback(ip){return ip==="127.0.0.1"||ip==="::1"||ip==="::ffff:127.0.0.1";}
function requireSameOriginBrowser(req){
  const site=String(req.headers["sec-fetch-site"]||"").toLowerCase();
  if(site==="cross-site"){
    const e=new Error("Cross-site request rejected");e.status=403;e.code="CROSS_SITE_REQUEST";throw e;
  }
  const origin=String(req.headers.origin||"");
  if(!origin)return;
  let originHost="";
  try{originHost=new URL(origin).host;}catch{
    const e=new Error("Invalid Origin header");e.status=403;e.code="INVALID_ORIGIN";throw e;
  }
  const requestHost=String(req.headers.host||"");
  if(!requestHost||!constantTimeTokenEqual(originHost.toLowerCase(),requestHost.toLowerCase())){
    const e=new Error("Origin mismatch");e.status=403;e.code="ORIGIN_MISMATCH";throw e;
  }
}
function enforceAuthLoginRate(req,config,buckets,metrics){
  const key=clientIp(req,config.trustProxy);
  const now=Date.now();
  const windowMs=Number(config.authFailureWindowSeconds||900)*1000;
  const current=buckets.get(key);
  if(current&&now-current.startedAt>=windowMs){
    buckets.delete(key);
    return key;
  }
  if(current&&current.failures>=Number(config.authMaxFailures||8)){
    metrics.authRateLimited++;
    const e=new Error("Too many authentication attempts");e.status=429;e.code="AUTH_RATE_LIMITED";throw e;
  }
  return key;
}
function enforceRegistrationRate(req,config,buckets){
  const key=clientIp(req,config.trustProxy),now=Date.now(),windowMs=Math.max(300000,Number(config.authFailureWindowSeconds||900)*1000);
  let current=buckets.get(key);
  if(!current||now-current.startedAt>=windowMs){current={startedAt:now,count:0};buckets.set(key,current);}
  current.count++;
  if(current.count>5){const e=new Error("Too many registrations");e.status=429;e.code="REGISTRATION_RATE_LIMITED";throw e;}
  if(buckets.size>5000){for(const [k,v] of buckets)if(now-v.startedAt>=windowMs)buckets.delete(k);}
}
function recordAuthFailure(key,config,buckets){
  const now=Date.now();
  const windowMs=Number(config.authFailureWindowSeconds||900)*1000;
  const current=buckets.get(key);
  if(!current||now-current.startedAt>=windowMs)buckets.set(key,{startedAt:now,failures:1});
  else current.failures++;
  if(buckets.size>5000){
    for(const [k,v] of buckets)if(now-v.startedAt>=windowMs)buckets.delete(k);
  }
}

async function selectiveSummary(store,ranges,market){
  const cache=new Map();
  const get=async range=>{
    const key=range.from+"|"+range.to;
    if(!cache.has(key))cache.set(key,store.summary(range.from,range.to,market));
    return cache.get(key);
  };
  const [calls,minutes,revenue,payout]=await Promise.all([get(ranges.calls),get(ranges.minutes),get(ranges.revenue),get(ranges.payout)]);
  return {
    ...calls,
    billable_minutes:minutes.billable_minutes,
    acd_seconds:minutes.acd_seconds,
    generated_revenue_ttc:revenue.generated_revenue_ttc,
    payout_eligible_minutes:payout.payout_eligible_minutes,
    expected_payout_ht:payout.expected_payout_ht,
    confirmed_payout_ht:payout.confirmed_payout_ht,
    paid_payout_ht:payout.paid_payout_ht,
    expert_cost_ht:payout.expert_cost_ht,
    technical_cost_ht:payout.technical_cost_ht,
    estimated_margin_ht:payout.estimated_margin_ht,
    reconciliation_variance_ht:payout.reconciliation_variance_ht,
    currency:revenue.currency||payout.currency||calls.currency,
    currency_count:Math.max(Number(calls.currency_count||0),Number(revenue.currency_count||0),Number(payout.currency_count||0)),
    mixed_currency:Boolean(calls.mixed_currency||revenue.mixed_currency||payout.mixed_currency)
  };
}
function mergeMetricRows(callRows,minuteRows,revenueRows,payoutRows,keyFn){
  const map=new Map();
  function take(rows,kind){
    for(const row of rows||[]){
      const key=keyFn(row),dst=map.get(key)||{
        bucket:row.bucket,hour:row.hour,weekday:row.weekday,
        dimension_type:row.dimension_type,dimension_key:row.dimension_key,dimension_label:row.dimension_label,
        currency:row.currency,currency_count:row.currency_count
      };
      if(kind==="calls"){
        for(const k of ["calls_total","calls_connected","calls_abandoned","calls_failed"])if(k in row)dst[k]=row[k];
      }else if(kind==="minutes"){
        for(const k of ["conversation_seconds","billable_seconds"])if(k in row)dst[k]=row[k];
      }else if(kind==="revenue"){
        if("revenue" in row)dst.revenue=row.revenue;
      }else if(kind==="payout"){
        for(const k of ["payout_eligible_seconds","expected_payout","confirmed_payout","paid_payout","expert_cost","technical_cost","margin","reconciliation_variance"])if(k in row)dst[k]=row[k];
      }
      map.set(key,dst);
    }
  }
  take(callRows,"calls");take(minuteRows,"minutes");take(revenueRows,"revenue");take(payoutRows,"payout");
  return [...map.values()];
}
async function selectiveAnalytics(store,ranges,market){
  const cache=new Map();
  const get=async range=>{
    const key=range.from+"|"+range.to;
    if(!cache.has(key))cache.set(key,store.dashboardAnalytics(range.from,range.to,market));
    return cache.get(key);
  };
  const [calls,minutes,revenue,payout,quality]=await Promise.all([get(ranges.calls),get(ranges.minutes),get(ranges.revenue),get(ranges.payout),get(ranges.quality)]);
  const series=mergeMetricRows(calls.series,minutes.series,revenue.series,payout.series,x=>String(x.bucket));
  const hours=mergeMetricRows(calls.hours,minutes.hours,[],[],x=>String(x.hour));
  const weekdays=mergeMetricRows(calls.weekdays,minutes.weekdays,[],[],x=>String(x.weekday));
  const dimensions=mergeMetricRows(
    [...(calls.experts||[]),...(calls.carriers||[]),...(calls.durations||[])],
    [...(minutes.experts||[]),...(minutes.carriers||[]),...(minutes.durations||[])],
    [...(revenue.experts||[]),...(revenue.carriers||[]),...(revenue.durations||[])],
    [...(payout.experts||[]),...(payout.carriers||[]),...(payout.durations||[])],
    x=>String(x.dimension_type)+"|"+String(x.dimension_key)
  );
  const byType={expert:[],carrier:[],duration:[]};
  for(const row of dimensions)if(byType[row.dimension_type])byType[row.dimension_type].push(row);
  return {
    ...calls,
    series:series.sort((a,b)=>Date.parse(a.bucket)-Date.parse(b.bucket)),
    hours:hours.sort((a,b)=>Number(a.hour)-Number(b.hour)),
    weekdays:weekdays.sort((a,b)=>Number(a.weekday)-Number(b.weekday)),
    quality:quality.quality,quality_series:quality.quality_series,
    experience:quality.experience,experience_series:quality.experience_series,
    experts:byType.expert.slice(0,50),carriers:byType.carrier.slice(0,50),durations:byType.duration
  };
}

function rangeParams(url){
  const now=new Date();
  const from=url.searchParams.get("from")||new Date(now.getTime()-24*3600000).toISOString();
  const to=url.searchParams.get("to")||now.toISOString();
  if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(to)<Date.parse(from)){
    const e=new Error("Invalid range");e.status=400;e.code="INVALID_RANGE";throw e;
  }
  return {from,to};
}
function publicActor(a){return {id:a.sub,role:a.role,name:a.name,expert_id:a.expert_id||null};}
function publicCustomerActor(a,context){
  return {id:a.sub,role:context.customer_role,name:context.display_name||a.name,email:context.email,email_verified:context.email_verified===true,permissions:customerPermissions(context),tenant:{id:context.tenant_public_id,name:context.tenant_name,status:context.tenant_status,currency:context.default_currency,country_code:context.country_code}};
}
function rateLimit(req,config,buckets,metrics){
  const key=clientIp(req,config.trustProxy);
  const minute=Math.floor(Date.now()/60000);
  const current=buckets.get(key);
  if(!current||current.minute!==minute)buckets.set(key,{minute,count:1});
  else{
    current.count++;
    if(current.count>config.rateLimitPerMinute){
      metrics.rateLimited++;
      const e=new Error("Rate limit exceeded");e.status=429;e.code="RATE_LIMITED";throw e;
    }
  }
  if(buckets.size>5000&&Math.random()<.01){
    for(const [k,v] of buckets)if(v.minute<minute-2)buckets.delete(k);
  }
}
function routeClassRateLimit(req,config,buckets,metrics,pathname,method){
  let scope=null,limit=0;
  const authPath=pathname.startsWith("/api/v1/auth/")||pathname.startsWith("/api/v1/customer/auth/");
  if(!authPath&&method!=="GET"&&method!=="HEAD"&&method!=="OPTIONS"){
    scope="write";limit=Number(config.writeRateLimitPerMinute||120);
  }else if(method==="GET"&&/(?:analytics|control-tower|customer-profitability|performance-lab|digital-twin|evidence-pack|regulatory)/.test(pathname)){
    scope="heavy_read";limit=Number(config.heavyReadRateLimitPerMinute||60);
  }
  if(!scope||limit<=0)return;
  const minute=Math.floor(Date.now()/60000),key=clientIp(req,config.trustProxy)+"|"+scope,current=buckets.get(key);
  if(!current||current.minute!==minute)buckets.set(key,{minute,count:1});
  else{
    current.count++;
    if(current.count>limit){
      metrics.rateLimited++;bump(metrics.rateLimitedByClass,scope);
      const e=new Error("Route class rate limit exceeded");e.status=429;e.code="ROUTE_RATE_LIMITED";e.expose=true;throw e;
    }
  }
  if(buckets.size>10000&&Math.random()<.01)for(const [k,v] of buckets)if(v.minute<minute-2)buckets.delete(k);
}
function authorizeEmailCron(req,config){
  if(!config.transactionalEmailEnabled||!config.cronSecret){const e=new Error("Email dispatch disabled");e.status=404;e.code="EMAIL_DISPATCH_DISABLED";e.expose=true;throw e;}
  const authorization=String(req.headers?.authorization||"");
  if(!constantTimeTokenEqual(authorization,"Bearer "+config.cronSecret)){const e=new Error("Unauthorized");e.status=401;e.code="EMAIL_DISPATCH_UNAUTHORIZED";e.expose=true;throw e;}
}
function done(res,metrics,started,route,status,payload,headers={}){
  res.pgiRoute=route;
  bump(metrics.byStatus,status);bump(metrics.byRoute,route);
  headers["Server-Timing"]="app;dur="+Math.max(0,performance.now()-started).toFixed(1);
  json(res,status,payload,headers);
}
function bump(map,key){map.set(String(key),(map.get(String(key))||0)+1);}
async function metricsResponse(res,metrics,store,workers){
  const [m,snapshot,queue]=await Promise.all([
    store.metrics(),
    store.systemSnapshot(),
    typeof store.workQueueHealth==="function"?store.workQueueHealth():Promise.resolve({pending:0,leased:0,dead_lettered:0,oldest_pending_seconds:0})
  ]);
  const lines=[
    "# TYPE pgi_http_requests_total counter",
    "pgi_http_requests_total "+metrics.requests,
    "# TYPE pgi_http_errors_total counter",
    "pgi_http_errors_total "+metrics.errors,
    "# TYPE pgi_rate_limited_total counter",
    "pgi_rate_limited_total "+metrics.rateLimited,
    "# TYPE pgi_auth_failures_total counter",
    "pgi_auth_failures_total "+metrics.authFailures,
    "# TYPE pgi_auth_rate_limited_total counter",
    "pgi_auth_rate_limited_total "+metrics.authRateLimited,
    "# TYPE pgi_calls_total gauge",
    "pgi_calls_total "+m.calls_total,
    "# TYPE pgi_calls_connected gauge",
    "pgi_calls_connected "+m.calls_connected,
    "# TYPE pgi_outbox_pending gauge",
    "pgi_outbox_pending "+m.outbox_pending,
    "# TYPE pgi_service_incidents_open gauge",
    "pgi_service_incidents_open "+Number(m.service_incidents_open||0),
    "# TYPE pgi_service_incidents_critical gauge",
    "pgi_service_incidents_critical "+Number(m.service_incidents_critical||0),
    "# TYPE pgi_service_first_response_overdue gauge",
    "pgi_service_first_response_overdue "+Number(m.service_first_response_overdue||0),
    "# TYPE pgi_service_resolution_overdue gauge",
    "pgi_service_resolution_overdue "+Number(m.service_resolution_overdue||0),
    "# TYPE pgi_routing_unavailable gauge",
    "pgi_routing_unavailable "+Number(m.routing_unavailable||0),
    "# TYPE pgi_portability_attention gauge",
    "pgi_portability_attention "+Number(m.portability_attention||0),
    "# TYPE pgi_cdr_lag_seconds gauge",
    "pgi_cdr_lag_seconds "+Number(snapshot.cdr_lag_seconds||0),
    "# TYPE pgi_experts_available gauge",
    "pgi_experts_available "+Number(snapshot.experts_available||0),
    "# TYPE pgi_event_subscribers gauge",
    "pgi_event_subscribers "+m.event_subscribers,
    "# TYPE pgi_worker_outbox_errors_total counter",
    "pgi_worker_outbox_errors_total "+Number(workers?.stats?.outboxErrors||0),
    "# TYPE pgi_worker_alert_errors_total counter",
    "pgi_worker_alert_errors_total "+Number(workers?.stats?.alertsErrors||0),
    "# TYPE pgi_worker_queue_errors_total counter",
    "pgi_worker_queue_errors_total "+Number(workers?.stats?.queueErrors||0),
    "# TYPE pgi_worker_queue_processed_total counter",
    "pgi_worker_queue_processed_total "+Number(workers?.stats?.queueProcessed||0),
    "# TYPE pgi_worker_queue_dead_letters_total counter",
    "pgi_worker_queue_dead_letters_total "+Number(workers?.stats?.queueDeadLetters||0),
    "# TYPE pgi_worker_outbox_last_success_unixtime gauge",
    "pgi_worker_outbox_last_success_unixtime "+timestampMetric(workers?.stats?.lastOutboxSuccessAt),
    "# TYPE pgi_worker_alerts_last_success_unixtime gauge",
    "pgi_worker_alerts_last_success_unixtime "+timestampMetric(workers?.stats?.lastAlertsSuccessAt),
    "# TYPE pgi_worker_queue_last_success_unixtime gauge",
    "pgi_worker_queue_last_success_unixtime "+timestampMetric(workers?.stats?.lastQueueSuccessAt),
    "# TYPE pgi_work_queue_pending gauge",
    "pgi_work_queue_pending "+Number(queue.pending||0),
    "# TYPE pgi_work_queue_leased gauge",
    "pgi_work_queue_leased "+Number(queue.leased||0),
    "# TYPE pgi_work_queue_dead_lettered gauge",
    "pgi_work_queue_dead_lettered "+Number(queue.dead_lettered||0),
    "# TYPE pgi_work_queue_oldest_pending_seconds gauge",
    "pgi_work_queue_oldest_pending_seconds "+Number(queue.oldest_pending_seconds||0).toFixed(3),
    "# TYPE pgi_process_uptime_seconds gauge",
    "pgi_process_uptime_seconds "+((Date.now()-metrics.startedAt)/1000).toFixed(3)
  ];
  lines.push("# TYPE pgi_rate_limited_class_total counter");
  for(const [scope,count] of metrics.rateLimitedByClass)lines.push('pgi_rate_limited_class_total{class="'+promLabel(scope)+'"} '+count);
  lines.push("# TYPE pgi_http_responses_total counter");
  for(const [status,count] of metrics.byStatus){
    lines.push('pgi_http_responses_total{status="'+promLabel(status)+'"} '+count);
  }
  lines.push("# TYPE pgi_http_route_requests_total counter");
  for(const [route,count] of metrics.byRoute){
    lines.push('pgi_http_route_requests_total{route="'+promLabel(route)+'"} '+count);
  }
  lines.push("# TYPE pgi_http_request_duration_ms histogram");
  for(const [route,h] of metrics.latencyByRoute){
    const label=promLabel(route);
    let cumulative=0;
    for(let i=0;i<LATENCY_BUCKETS_MS.length;i++){
      cumulative+=h.buckets[i]||0;
      lines.push('pgi_http_request_duration_ms_bucket{route="'+label+'",le="'+LATENCY_BUCKETS_MS[i]+'"} '+cumulative);
    }
    lines.push('pgi_http_request_duration_ms_bucket{route="'+label+'",le="+Inf"} '+h.count);
    lines.push('pgi_http_request_duration_ms_sum{route="'+label+'"} '+h.sum.toFixed(3));
    lines.push('pgi_http_request_duration_ms_count{route="'+label+'"} '+h.count);
  }
  const body=lines.join("\n")+"\n";
  res.writeHead(200,{"Content-Type":"text/plain; version=0.0.4; charset=utf-8","Content-Length":Buffer.byteLength(body)});
  res.end(body);
}
function openEventStream(req,res,eventBus,requestId,config,clients,filter=null){
  if(eventBus.size>=Number(config.maxEventSubscribers||32)){
    const e=new Error("Realtime capacity reached");e.status=503;e.code="SSE_CAPACITY_REACHED";e.expose=true;throw e;
  }
  res.writeHead(200,{
    "Content-Type":"text/event-stream; charset=utf-8",
    "Cache-Control":"no-store",
    "Connection":"keep-alive",
    "X-Accel-Buffering":"no",
    "X-Request-Id":requestId
  });
  res.write("event: ready\ndata: {}\n\n");
  clients?.add(res);
  const unsubscribe=eventBus.subscribe(event=>{
    if(res.destroyed)return;
    if(filter&&filter(event)!==true)return;
    res.write("event: "+safeEventName(event.type)+"\ndata: "+JSON.stringify(event)+"\n\n");
  });
  const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(": ping\n\n");},15000);
  heartbeat.unref?.();
  req.on("close",()=>{clearInterval(heartbeat);unsubscribe();clients?.delete(res);});
}
function logSecurityEmailFailure(template,error){
  process.stderr.write(JSON.stringify({level:"warn",event:"security_email_send_failed",template:String(template||"security"),code:String(error?.code||"EMAIL_SEND_FAILED")})+"\n");
}
function logHttpRequest(config,{requestId,traceId,route,method,status,durationMs}){
  if(config?.mode!=="production")return;
  const level=status>=500?"error":status>=400?"warn":"info";
  process.stdout.write(JSON.stringify({
    level,
    event:"http_request",
    request_id:requestId,
    trace_id:traceId||null,
    route:String(route||"unclassified"),
    method:String(method||"GET"),
    status:Number(status)||0,
    duration_ms:Number(durationMs.toFixed(1))
  })+"\n");
}
function closeHttpServer(server,graceMs){
  return new Promise(resolve=>{
    let settled=false;
    let timer=null;
    const finish=()=>{
      if(settled)return;
      settled=true;
      if(timer)clearTimeout(timer);
      resolve();
    };
    server.close(finish);
    timer=setTimeout(()=>{
      server.closeAllConnections?.();
      finish();
    },Math.max(1000,graceMs));
    timer.unref?.();
    server.closeIdleConnections?.();
  });
}
const LATENCY_BUCKETS_MS=[10,25,50,100,250,500,1000,2500,5000];
function observeLatency(metrics,route,durationMs){
  const key=String(route||"unclassified");
  let h=metrics.latencyByRoute.get(key);
  if(!h){
    h={count:0,sum:0,buckets:Array(LATENCY_BUCKETS_MS.length).fill(0)};
    metrics.latencyByRoute.set(key,h);
  }
  h.count++;
  h.sum+=Number(durationMs)||0;
  for(let i=0;i<LATENCY_BUCKETS_MS.length;i++){
    if(durationMs<=LATENCY_BUCKETS_MS[i]){
      h.buckets[i]++;
      break;
    }
  }
}
function promLabel(value){
  return String(value||"").replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/\n/g,"\\n");
}
function traceContext(req){
  const raw=String(req.headers?.traceparent||"").trim().toLowerCase();
  const match=/^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(raw);
  const traceId=match&&match[1]!==("0".repeat(32))?match[1]:randomUUID().replace(/-/g,"");
  const spanId=randomUUID().replace(/-/g,"").slice(0,16);
  return {traceId,traceparent:"00-"+traceId+"-"+spanId+"-01"};
}
function timestampMetric(value){
  const ms=Date.parse(value||"");
  return Number.isFinite(ms)?Math.floor(ms/1000):0;
}
function safeEventName(x){return String(x||"event").replace(/[^a-zA-Z0-9_.-]/g,"_");}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const app=await createDefaultBackend();
  const shutdown=async signal=>{
    process.stdout.write(JSON.stringify({level:"info",event:"shutdown",signal})+"\n");
    await app.close();
    process.exit(0);
  };
  process.on("SIGTERM",()=>shutdown("SIGTERM"));
  process.on("SIGINT",()=>shutdown("SIGINT"));
  app.listen().then(address=>{
    process.stdout.write(JSON.stringify({level:"info",event:"listening",address,mode:app.config.mode,version:app.config.version,release:app.config.releaseId||null})+"\n");
  }).catch(error=>{
    process.stderr.write(JSON.stringify({level:"error",event:"startup_failed",message:error.message})+"\n");
    process.exit(1);
  });
}
