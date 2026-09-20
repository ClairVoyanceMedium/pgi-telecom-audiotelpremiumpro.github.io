import http from "node:http";
import {pathToFileURL} from "node:url";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {verifyGoogleIdToken} from "./src/google-id.mjs";
import {loadConfig} from "./src/config.mjs";
import {EventBus} from "./src/event-bus.mjs";
import {MemoryStore} from "./src/store-memory.mjs";
import {parseCookies,hashPassword,verifyPassword,issueSession,verifySession,constantTimeTokenEqual,sessionCookie,csrfCookie,clearSessionCookies,customerSessionCookie,customerCsrfCookie,clearCustomerSessionCookies} from "./src/security.mjs";
import {securityHeaders,readJson,json,text,problemJson,routeMatch,clientIp} from "./src/http.mjs";
import {normalizeFreeSwitchCdr} from "./src/cdr-freeswitch.mjs";
import {startWorkers} from "./src/workers.mjs";

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

  const metrics={
    requests:0,errors:0,rateLimited:0,authFailures:0,authRateLimited:0,
    startedAt:Date.now(),byStatus:new Map(),byRoute:new Map(),latencyByRoute:new Map()
  };
  const rateBuckets=new Map();
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

      if(method==="GET"&&pathname==="/api/v1/health"){
        return done(res,metrics,started,"health",200,{
          status:"ok",timestamp:new Date().toISOString(),version:config.version,release:config.releaseId||null,mode:config.mode
        });
      }
      if(method==="GET"&&pathname==="/api/v1/ready"){
        const snapshot=await store.systemSnapshot();
        const readiness=evaluateReadiness(snapshot,workers,config);
        return done(res,metrics,started,"ready",readiness.ready?200:503,{
          status:readiness.ready?"ready":"degraded",
          timestamp:new Date().toISOString(),
          checks:readiness.checks
        });
      }
      if(method==="GET"&&pathname==="/metrics"){
        res.pgiRoute="metrics";
        return metricsResponse(res,metrics,store,workers);
      }

      if(method==="POST"&&pathname==="/api/v1/auth/login"){
        if(config.authMode!=="session")return done(res,metrics,started,"auth.login",404,{error:{code:"AUTH_DISABLED"}});
        requireSameOriginBrowser(req);
        const authKey=enforceAuthLoginRate(req,config,authBuckets,metrics);
        const body=await readJson(req,config.bodyLimitBytes);
        const usernameOk=constantTimeTokenEqual(String(body.username||""),config.adminUsername);
        const passwordOk=verifyPassword(String(body.password||""),config.adminPasswordHash);
        const ok=usernameOk&&passwordOk;
        if(!ok){
          metrics.authFailures++;
          recordAuthFailure(authKey,config,authBuckets);
          const e=new Error("Invalid credentials");e.status=401;e.code="INVALID_CREDENTIALS";throw e;
        }
        authBuckets.delete(authKey);
        const issued=issueSession({
          secret:config.sessionSecret,
          user:{id:"admin",role:"admin",name:"Administrator"},
          ttlSeconds:config.sessionTtlSeconds
        });
        return done(res,metrics,started,"auth.login",200,{user:{id:"admin",role:"admin",name:"Administrator"}},{
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
        const issued=issueSession({
          secret:config.sessionSecret,
          user:{id:registered.id,role:"customer",name:registered.display_name||registered.email,actor_type:"customer",tenant_id:Number(registered.tenant_id),tenant_public_id:registered.tenant_public_id,customer_role:registered.customer_role,authorization_version:Number(registered.authorization_version),session_version:Number(registered.session_version)},
          ttlSeconds:config.sessionTtlSeconds
        });
        return done(res,metrics,started,"customer.auth.register",201,{
          account_created:true,onboarding:true,email_verification_required:registered.email_verified!==true,
          user:{id:registered.id,name:registered.display_name,email:registered.email,role:registered.customer_role,tenant:{id:registered.tenant_public_id,name:registered.tenant_name,status:registered.tenant_status}}
        },{"Set-Cookie":[customerSessionCookie(issued.token,config.sessionTtlSeconds),customerCsrfCookie(issued.csrf,config.sessionTtlSeconds)]});
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
      if(method==="POST"&&pathname==="/api/v1/customer/auth/logout"){
        requireCustomerCsrf(req,customerActor,config);
        return done(res,metrics,started,"customer.auth.logout",200,{ok:true},{"Set-Cookie":clearCustomerSessionCookies()});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/auth/me"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.auth.me",200,{user:publicCustomerActor(customerActor,context)});
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
        return done(res,metrics,started,"customer.auth.change_password",200,{ok:true,relogin_required:true},{"Set-Cookie":clearCustomerSessionCookies()});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/portal"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        const range=rangeParams(url);
        const data=await store.customerPortalOverview(context.tenant_id,range.from,range.to);
        return done(res,metrics,started,"customer.portal",200,{user:publicCustomerActor(customerActor,context),...data,billing_provider:billingProviderStatus(config),server_time:new Date().toISOString()});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/billing/status"){
        requireActor(customerActor);
        await store.customerSessionContext(customerActor);
        return done(res,metrics,started,"customer.billing.status",200,billingProviderStatus(config));
      }
      if(method==="POST"&&pathname==="/api/v1/customer/billing/checkout-session"){
        requireCustomerCsrf(req,customerActor,config);
        await store.customerSessionContext(customerActor);
        const provider=billingProviderStatus(config);
        return done(res,metrics,started,"customer.billing.checkout",503,{error:{code:"PAYMENT_PROVIDER_NOT_CONNECTED"},billing_provider:provider});
      }
      if(method==="POST"&&pathname==="/api/v1/customer/billing/portal-session"){
        requireCustomerCsrf(req,customerActor,config);
        await store.customerSessionContext(customerActor);
        const provider=billingProviderStatus(config);
        return done(res,metrics,started,"customer.billing.portal",503,{error:{code:"PAYMENT_PROVIDER_NOT_CONNECTED"},billing_provider:provider});
      }
      if(method==="GET"&&pathname==="/api/v1/customer/comparison"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        const range=rangeParams(url);
        return done(res,metrics,started,"customer.comparison",200,await store.customerPortalComparison(context.tenant_id,range.from,range.to));
      }
      if(method==="GET"&&pathname==="/api/v1/customer/calls"){
        requireActor(customerActor);
        const context=await store.customerSessionContext(customerActor);
        const range=rangeParams(url);
        const params={...Object.fromEntries(url.searchParams.entries()),from:range.from,to:range.to};
        return done(res,metrics,started,"customer.calls",200,await store.customerPortalCalls(context.tenant_id,params));
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
        const range=rangeParams(url);
        const market=url.searchParams.get("market")||null;
        const previousFrom=url.searchParams.get("previous_from")||null;
        const previousTo=url.searchParams.get("previous_to")||null;
        if((previousFrom&&!previousTo)||(!previousFrom&&previousTo)||
           (previousFrom&&(!Number.isFinite(Date.parse(previousFrom))||!Number.isFinite(Date.parse(previousTo))||Date.parse(previousTo)<Date.parse(previousFrom)))){
          const e=new Error("Invalid previous range");e.status=400;e.code="INVALID_PREVIOUS_RANGE";throw e;
        }
        const [summary,previousSummary,analytics,voiceIntelligence,experts,system,route,reconciliation]=await Promise.all([
          store.summary(range.from,range.to,market),
          previousFrom?store.summary(previousFrom,previousTo,market):Promise.resolve(null),
          store.dashboardAnalytics(range.from,range.to,market),
          typeof store.voiceIntelligence==="function"?store.voiceIntelligence(range.from,range.to,market):Promise.resolve(null),
          store.listExperts(),
          store.systemSnapshot(),
          store.carrierRouting(),
          store.reconciliation(range.from,range.to,market)
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
          server_time:new Date().toISOString()
        });
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/summary"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        const range=rangeParams(url);
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"dashboard.summary",200,await store.summary(range.from,range.to,market));
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/analytics"){
        requireRole(actor,["admin","finance","readonly"]);
        const range=rangeParams(url);
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"dashboard.analytics",200,await store.dashboardAnalytics(range.from,range.to,market));
      }

      if(method==="GET"&&pathname==="/api/v1/dashboard/voice-intelligence"){
        requireRole(actor,["admin","finance","readonly"]);
        const range=rangeParams(url);
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"dashboard.voice_intelligence",200,await store.voiceIntelligence(range.from,range.to,market));
      }

      if(method==="GET"&&pathname==="/api/v1/calls"){
        requireRole(actor,["admin","finance","expert","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        if(actor.role==="expert")params.expert_id=actor.expert_id||actor.sub;
        return done(res,metrics,started,"calls.list",200,await store.listCalls(params));
      }

      if(method==="GET"&&pathname==="/api/v1/experts"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"experts.list",200,{data:await store.listExperts()});
      }

      let match=routeMatch(pathname,"/api/v1/experts/:id/status");
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

      if(method==="GET"&&pathname==="/api/v1/finance/reconciliation"){
        requireRole(actor,["admin","finance","readonly"]);
        const range=rangeParams(url);
        const market=url.searchParams.get("market")||null;
        return done(res,metrics,started,"finance.reconciliation",200,{data:await store.reconciliation(range.from,range.to,market)});
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

      if(method==="GET"&&pathname==="/api/v1/platform/tenants/summary"){
        requireRole(actor,["admin","finance","readonly"]);
        return done(res,metrics,started,"platform.tenant_summary",200,await store.customerAdminSummary());
      }

      if(method==="GET"&&pathname==="/api/v1/platform/tenants"){
        requireRole(actor,["admin","finance","readonly"]);
        const params=Object.fromEntries(url.searchParams.entries());
        return done(res,metrics,started,"platform.tenants",200,await store.listTenants(params));
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

      match=routeMatch(pathname,"/api/v1/platform/tenants/:id/call-destinations");
      if(method==="POST"&&match){requireRole(actor,["admin"]);requireCsrf(req,actor,config);const body=await readJson(req,config.bodyLimitBytes);const result=await store.idempotent(req.headers["idempotency-key"],"call_destination.create",{tenant:match.id,...body},()=>store.createCallDestination(match.id,body,actor));return done(res,metrics,started,"platform.call_destination_create",201,{...result.value,replayed:result.replayed});}
      match=routeMatch(pathname,"/api/v1/platform/call-destinations/:id/status");
      if(method==="POST"&&match){requireRole(actor,["admin"]);requireCsrf(req,actor,config);const body=await readJson(req,config.bodyLimitBytes);const payload={id:match.id,status:body.status,reason:body.reason||""};const result=await store.idempotent(req.headers["idempotency-key"],"call_destination.status",payload,()=>store.setCallDestinationStatus(match.id,body.status,actor,body.reason||""));return done(res,metrics,started,"platform.call_destination_status",200,{...result.value,replayed:result.replayed});}

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

  const workers=config.processRole==="api"
    ?disabledWorkers()
    :startWorkers({store,eventBus,config,queueHandlers:options.queueHandlers||{}});

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
  const ingestion=Boolean(config?.externalBillingEnabled);
  return Object.freeze({
    architecture_ready:true,
    target_provider:"stripe",
    connection_state:ingestion?"event_ingest_enabled":"not_connected",
    external_billing_enabled:ingestion,
    checkout_available:false,
    customer_portal_available:false,
    webhook_ingest_enabled:ingestion,
    subscription_funds_flow:"customer_to_pgi",
    sva_payout_flow:"carrier_to_customer",
    funds_held_by_pgi:false
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
    if(!isLoopback(clientIp(req))){const e=new Error("Telephony endpoint restricted to loopback");e.status=403;e.code="TELEPHONY_FORBIDDEN";throw e;}
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
    if(!isLoopback(clientIp(req))){const e=new Error("Ingest restricted to loopback");e.status=403;e.code="INGEST_FORBIDDEN";throw e;}
    return;
  }
  const token=String(req.headers["x-pgi-ingest-token"]||"");
  if(!config.ingestToken||!constantTimeTokenEqual(token,config.ingestToken)){
    const e=new Error("Invalid ingest token");e.status=401;e.code="INGEST_AUTH_FAILED";throw e;
  }
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
  const key=clientIp(req);
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
  const key=clientIp(req),now=Date.now(),windowMs=Math.max(300000,Number(config.authFailureWindowSeconds||900)*1000);
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
  return {id:a.sub,role:context.customer_role,name:context.display_name||a.name,email:context.email,email_verified:context.email_verified===true,tenant:{id:context.tenant_public_id,name:context.tenant_name,status:context.tenant_status,currency:context.default_currency,country_code:context.country_code}};
}
function rateLimit(req,config,buckets,metrics){
  const key=clientIp(req);
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
function openEventStream(req,res,eventBus,requestId,config,clients){
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
    res.write("event: "+safeEventName(event.type)+"\ndata: "+JSON.stringify(event)+"\n\n");
  });
  const heartbeat=setInterval(()=>{if(!res.destroyed)res.write(": ping\n\n");},15000);
  heartbeat.unref?.();
  req.on("close",()=>{clearInterval(heartbeat);unsubscribe();clients?.delete(res);});
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
