import test from "node:test";
import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import {createBackend} from "../backend/server.mjs";
import {PostgresStore} from "../backend/src/store-postgres.mjs";
import {EventBus} from "../backend/src/event-bus.mjs";
import {hashPassword} from "../backend/src/security.mjs";
import {verificationTokenHash,emailVerificationCodeHash} from "../backend/src/resend-email.mjs";

const url=process.env.PGI_TEST_DATABASE_URL;
const run=Boolean(url);

function storeConfig(){
  return {
    mode:"production",databaseUrl:url,databasePoolMax:4,databaseSsl:"disable",
    callerHashKey:"k".repeat(32),requireCarrierContract:true,
    serviceRateTtcPerMin:.8,payoutRateHtPerMin:.46,expertCostHtPerMin:.18,reconciliationToleranceHt:.01
  };
}

function backendConfig(){
  return {
    mode:"production",processRole:"api",authMode:"session",host:"127.0.0.1",port:0,
    sessionSecret:"s".repeat(48),adminUsername:"admin",adminPasswordHash:hashPassword("admin-password-123456"),
    ingestToken:"",bodyLimitBytes:262144,rateLimitPerMinute:10000,heavyReadRateLimitPerMinute:10000,writeRateLimitPerMinute:10000,
    authMaxFailures:8,authFailureWindowSeconds:900,sessionTtlSeconds:3600,
    serviceRateTtcPerMin:.8,payoutRateHtPerMin:.46,expertCostHtPerMin:.18,reconciliationToleranceHt:.01,
    version:"customer-journey-postgres-test",releaseId:"f".repeat(40),
    emailVerificationEnabled:true,emailVerificationPepper:"p".repeat(48),emailVerificationTtlMinutes:10,
    emailVerificationResendSeconds:60,emailVerificationMaxAttempts:5,
    transactionalEmailEnabled:true,resendApiKey:"re_test_customer_journey",transactionalDomain:"audiotel-premium-pro.com",
    transactionalFromName:"Audiotel Premium Pro",resendTimeoutMs:2000,internalNotificationEmail:"ops@example.test",cronSecret:"c".repeat(40),
    externalBillingEnabled:true,stripeSecretKey:"sk_test_customer_journey_"+ "x".repeat(24),
    stripeWebhookSecret:"whsec_customer_journey_"+ "y".repeat(24),stripeLiveMode:false,
    stripeApiVersion:"2026-08-26.dahlia",stripeWebhookToleranceSeconds:300,
    stripePriceLookupKey:"pgi_audiotel_premium_pro_monthly_eur",
    publicBaseUrl:"https://audiotel-premium-pro.com",
    legalOperatorConfigured:false,consumerMediatorConfigured:false,b2cCommercialReady:false,onlineWithdrawalReady:true
  };
}

function cookiesFrom(headers){
  const rows=typeof headers.getSetCookie==="function"?headers.getSetCookie():[headers.get("set-cookie")||""];
  const map=new Map();
  for(const row of rows){
    for(const part of String(row).split(/,(?=\s*__Host-)/)){
      const first=part.trim().split(";")[0],eq=first.indexOf("=");
      if(eq>0)map.set(first.slice(0,eq),first.slice(eq+1));
    }
  }
  return map;
}
function cookieHeader(map){return [...map].map(([k,v])=>k+"="+v).join("; ");}

function mockProviders(originalFetch,state){
  return async(input,init={})=>{
    const u=typeof input==="string"?input:String(input?.url||input);
    if(u.startsWith("http://127.0.0.1:"))return originalFetch(input,init);

    if(u.startsWith("https://api.hsforms.com/submissions/v3/integration/submit/")){
      state.hubspotFormSubmissions++;
      return new Response("",{status:200});
    }

    if(u.startsWith("https://api.hubapi.com")){
      const path=new URL(u).pathname+new URL(u).search;
      const body=init.body?JSON.parse(String(init.body)):{};
      if(path==="/crm/v3/objects/contacts/search"&&init.method==="POST"){
        return Response.json({results:state.contact?[
          {id:"1001",properties:{...state.contact}}
        ]:[]},{status:200});
      }
      if(path==="/crm/v3/objects/contacts"&&init.method==="POST"){
        state.contact={...body.properties};
        return Response.json({id:"1001",properties:{...state.contact}},{status:201});
      }
      if(path==="/crm/v3/objects/contacts/1001"&&init.method==="PATCH"){
        state.contact={...state.contact,...body.properties};
        return Response.json({id:"1001",properties:{...state.contact}},{status:200});
      }
      if(path.startsWith("/crm/v3/objects/contacts/1001?associations=deals")){
        return Response.json({id:"1001",associations:{deals:{results:state.deal?[{id:"2001"}]:[]}}},{status:200});
      }
      if(path==="/crm/v4/associations/deals/contacts/labels"){
        return Response.json({results:[{category:"HUBSPOT_DEFINED",typeId:3,label:null}]},{status:200});
      }
      if(path==="/crm/v3/objects/deals"&&init.method==="POST"){
        state.deal={...body.properties};
        return Response.json({id:"2001",properties:{...state.deal}},{status:201});
      }
      if(path.startsWith("/crm/v3/objects/deals/2001?")){
        return Response.json({id:"2001",properties:{...state.deal}},{status:200});
      }
      if(path==="/crm/v3/objects/deals/2001"&&init.method==="PATCH"){
        state.deal={...state.deal,...body.properties};
        return Response.json({id:"2001",properties:{...state.deal}},{status:200});
      }
      throw new Error("Unexpected HubSpot request "+init.method+" "+path);
    }

    if(u==="https://api.resend.com/emails"){
      const body=JSON.parse(String(init.body||"{}"));
      state.emails.push(body);
      if(String(body.subject||"").includes("code de vérification")){
        const match=String(body.text||"").match(/\b(\d{6})\b/);
        if(match)state.verificationCode=match[1];
      }
      return Response.json({id:"email_"+state.emails.length},{status:200});
    }

    if(u.startsWith("https://api.stripe.com/v1/prices?")){
      return Response.json({data:[{
        id:"price_test_300",active:true,type:"recurring",currency:"eur",unit_amount:300,tax_behavior:"inclusive",
        recurring:{interval:"month",interval_count:1}
      }]},{status:200});
    }
    if(u==="https://api.stripe.com/v1/checkout/sessions"&&init.method==="POST"){
      state.stripeCheckoutBody=String(init.body||"");
      return Response.json({id:"cs_test_customer_journey",url:"https://checkout.stripe.com/c/pay/cs_test_customer_journey"},{status:200});
    }

    throw new Error("Unexpected external request "+init.method+" "+u);
  };
}

test("full customer journey works without a real operator and remains fail-closed for SVA activation",{skip:!run},async()=>{
  const bus=new EventBus();
  const store=await PostgresStore.connect(storeConfig(),bus);
  // Isolate this end-to-end journey from e-mail outbox events produced by earlier integration suites.
  await store.sql.unsafe("INSERT INTO transactional_email_event_receipts(outbox_event_id,disposition,error_code,processed_at) SELECT id,'ignored',NULL,now() FROM outbox_events ON CONFLICT(outbox_event_id) DO NOTHING");
  const cfg=backendConfig();
  const app=createBackend({config:cfg,store,eventBus:bus});
  const address=await app.listen();
  const base="http://127.0.0.1:"+address.port;
  const originalFetch=globalThis.fetch;
  const previousToken=process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN;
  const state={hubspotFormSubmissions:0,contact:null,deal:null,emails:[],verificationCode:null,stripeCheckoutBody:null};
  globalThis.fetch=mockProviders(originalFetch,state);
  process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN="pat-test-"+ "h".repeat(40);

  const email="journey."+Date.now()+"@example.test";
  let tenantPublicId=null;

  try{
    let response=await fetch(base+"/api/v1/public/hubspot/lead",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        first_name:"Camille",last_name:"Martin",account_type:"business",company_name:"Cabinet Parcours",
        country_code:"FR",phone:"+33600000000",email,service_intent:"new_number",
        processing_consent:true,privacy_notice_acknowledged:true,preferred_locale:"fr-FR",website:""
      })
    });
    assert.equal(response.status,202);
    let payload=await response.json();
    assert.equal(payload.accepted,true);
    assert.equal(payload.commercial_sync,true);
    assert.equal(state.contact.statut_commercial_pgi,"Nouveau prospect");
    assert.equal(state.deal.dealstage,"appointmentscheduled");
    assert.ok(state.emails.some(x=>x.subject==="Nous avons bien reçu votre demande"));

    response=await fetch(base+"/api/v1/customer/auth/register",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        first_name:"Camille",last_name:"Martin",account_type:"business",company_name:"Cabinet Parcours",country_code:"FR",
        registration_number:"",phone:"+33600000000",email,password:"long-password-12345",
        service_intent:"new_number",acquisition_source:"public_marketing_site",
        authority_confirmed:true,legal_terms_accepted:true,privacy_notice_acknowledged:true,
        legal_version:"2026-09-26-b2b-b2c-v4",website:"",preferred_locale:"fr-FR",timezone:"Europe/Paris"
      })
    });
    assert.equal(response.status,201);
    payload=await response.json();
    assert.equal(payload.account_created,true);
    assert.equal(payload.email_verification_required,true);
    assert.match(payload.verification_token,/^[A-Za-z0-9_-]{32,}$/);
    tenantPublicId=payload.user.tenant.id;
    const metadataRow=(await store.sql.unsafe("SELECT jsonb_typeof(metadata) AS metadata_type,metadata->>'first_name' AS first_name,metadata->>'last_name' AS last_name FROM customer_principals WHERE email_normalized=$1",[email]))[0];
    assert.equal(metadataRow.metadata_type,"object");
    assert.equal(metadataRow.first_name,"Camille");
    assert.equal(metadataRow.last_name,"Martin");
    assert.equal(state.contact.statut_commercial_pgi,"Dossier en préparation");
    assert.equal(state.deal.dealstage,"contractsent");
    assert.match(state.verificationCode||"",/^\d{6}$/);
    const storedVerification=(await store.sql.unsafe(
      "SELECT metadata#>>'{email_verification,token_hash}' AS token_hash,metadata#>>'{email_verification,code_hash}' AS code_hash FROM customer_principals WHERE email_normalized=$1",
      [email]
    ))[0];
    assert.equal(storedVerification.token_hash,verificationTokenHash(payload.verification_token));
    assert.equal(storedVerification.code_hash,emailVerificationCodeHash(cfg,payload.verification_token,state.verificationCode));

    response=await fetch(base+"/api/v1/customer/auth/email/verify",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({token:payload.verification_token,code:state.verificationCode})
    });
    assert.equal(response.status,200);
    const verified=await response.json();
    assert.equal(verified.email_verified,true);
    const customerCookies=cookiesFrom(response.headers);
    assert.ok(customerCookies.has("__Host-pgi_customer_session"));
    assert.ok(customerCookies.has("__Host-pgi_customer_csrf"));

    response=await fetch(base+"/api/v1/customer/portal",{headers:{Cookie:cookieHeader(customerCookies)}});
    assert.equal(response.status,200);
    const portal=await response.json();
    assert.equal(portal.user.tenant.id,tenantPublicId);
    assert.equal(portal.billing_offer.amount_minor,300);
    assert.equal(portal.billing_provider.checkout_available,true);

    response=await fetch(base+"/api/v1/customer/billing/checkout-session",{
      method:"POST",
      headers:{
        "Content-Type":"application/json","Idempotency-Key":randomUUID(),
        "X-CSRF-Token":customerCookies.get("__Host-pgi_customer_csrf"),
        Cookie:cookieHeader(customerCookies)
      },
      body:JSON.stringify({
        subscription_terms_accepted:true,privacy_notice_acknowledged:true,immediate_performance_requested:true,
        legal_version:"2026-09-26-b2b-b2c-v4"
      })
    });
    assert.equal(response.status,201);
    const checkout=await response.json();
    assert.equal(checkout.provider,"stripe");
    assert.equal(checkout.session_id,"cs_test_customer_journey");
    assert.match(checkout.url,/^https:\/\/checkout\.stripe\.com\//);
    assert.match(state.stripeCheckoutBody||"",/line_items%5B0%5D%5Bprice%5D=price_test_300/);

    const billingStatusResponse=await fetch(base+"/api/v1/customer/billing/status",{headers:{Cookie:cookieHeader(customerCookies)}});
    assert.equal(billingStatusResponse.status,200);
    const billingStatus=await billingStatusResponse.json();
    const priceVersionId=Number(billingStatus.offer.price_version_id);
    assert.ok(Number.isInteger(priceVersionId)&&priceVersionId>0);

    const now=Math.floor(Date.now()/1000);
    const stripeEvent={
      id:"evt_customer_journey_"+Date.now(),type:"customer.subscription.created",created:now,
      data:{object:{
        id:"sub_test_customer_journey",customer:"cus_test_customer_journey",status:"active",
        metadata:{
          tenant_public_id:tenantPublicId,price_version_id:String(priceVersionId),
          plan_key:"external-sva-access",legal_version:"2026-09-26-b2b-b2c-v4"
        },
        items:{data:[{
          current_period_start:now,current_period_end:now+31*86400,
          price:{id:"price_test_300",unit_amount:300,currency:"eur",recurring:{interval:"month",interval_count:1}}
        }]},
        current_period_start:now,current_period_end:now+31*86400,cancel_at_period_end:false
      }}
    };
    const raw=JSON.stringify(stripeEvent),timestamp=Math.floor(Date.now()/1000);
    const signature=createHmac("sha256",cfg.stripeWebhookSecret).update(String(timestamp)+".").update(raw).digest("hex");
    response=await fetch(base+"/api/v1/billing/stripe/webhook",{
      method:"POST",headers:{"Content-Type":"application/json","Stripe-Signature":"t="+timestamp+",v1="+signature},body:raw
    });
    assert.equal(response.status,200);
    const webhook=await response.json();
    assert.equal(webhook.received,true);
    assert.equal(webhook.duplicate,false);
    const subscriptionOutbox=(await store.sql.unsafe(
      "SELECT o.id,o.payload FROM outbox_events o JOIN tenants t ON t.id=o.tenant_id WHERE t.public_id=$1::uuid AND o.event_type='subscription.changed' ORDER BY o.id DESC LIMIT 1",
      [tenantPublicId]
    ))[0];
    assert.ok(subscriptionOutbox,"subscription.changed outbox event missing");
    assert.equal(subscriptionOutbox.payload?.event_type,"customer.subscription.created",JSON.stringify(subscriptionOutbox.payload));
    assert.equal(state.contact.statut_commercial_pgi,"En attente d’ouverture");
    assert.equal(state.contact.lifecyclestage,"opportunity");
    assert.equal(state.deal.dealstage,"6144336106");

    response=await fetch(base+"/api/v1/internal/email/dispatch",{
      headers:{Authorization:"Bearer "+cfg.cronSecret}
    });
    assert.equal(response.status,200);
    const dispatch=await response.json();
    assert.equal(dispatch.ok,true);
    assert.ok(dispatch.delivery.accepted>=1);
    const subscriptionDeliveries=await store.sql.unsafe(
      "SELECT template_key,state,last_error_code FROM transactional_email_deliveries WHERE outbox_event_id=$1 ORDER BY id",
      [subscriptionOutbox.id]
    );
    assert.ok(subscriptionDeliveries.some(x=>x.template_key==="subscription_created"&&["accepted","sent","delivered","clicked"].includes(String(x.state))),
      "subscription_created delivery missing: "+JSON.stringify(subscriptionDeliveries));
    const emailSubjects=state.emails.map(x=>x.subject);
    assert.ok(emailSubjects.includes("Votre demande d’ouverture a bien été reçue"),JSON.stringify(emailSubjects));
    assert.ok(emailSubjects.includes("Abonnement Audiotel Premium Pro créé"),JSON.stringify(emailSubjects));

    const policy=await store.operationalPolicyEvaluation({intent:"activate_number",tenant_public_id:tenantPublicId});
    assert.notEqual(policy.decision,"ALLOWED");
    assert.equal(policy.dry_run,true);

    const detail=await store.tenantControlDetail(tenantPublicId);
    assert.equal(detail.tenant.status,"pending");
    assert.equal(detail.lines.length,0);
    assert.ok(detail.subscriptions.some(x=>x.status==="active"));

    assert.ok(state.hubspotFormSubmissions>=2);
    assert.ok(state.emails.length>=3);
  }finally{
    globalThis.fetch=originalFetch;
    if(previousToken===undefined)delete process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN;
    else process.env.PGI_HUBSPOT_PRIVATE_APP_TOKEN=previousToken;
    await app.close();
    await store.close();
  }
});
