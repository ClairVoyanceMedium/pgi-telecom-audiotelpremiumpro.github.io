import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createBackend} from "../backend/server.mjs";
import {hashPassword} from "../backend/src/security.mjs";

function config(overrides={}){
  return {
    mode:"simulator",authMode:"session",host:"127.0.0.1",port:0,
    sessionSecret:"s".repeat(48),adminUsername:"admin",adminPasswordHash:hashPassword("admin-password-123456"),
    ingestToken:"",bodyLimitBytes:262144,rateLimitPerMinute:10000,heavyReadRateLimitPerMinute:10000,writeRateLimitPerMinute:10000,
    authMaxFailures:8,authFailureWindowSeconds:900,sessionTtlSeconds:3600,
    serviceRateTtcPerMin:.8,payoutRateHtPerMin:.46,expertCostHtPerMin:.18,reconciliationToleranceHt:.01,
    version:"journey-test",protectMachineEndpoints:true,emailVerificationEnabled:false,
    externalBillingEnabled:false,stripeLiveMode:false,transactionalEmailEnabled:false,
    legalOperatorConfigured:false,consumerMediatorConfigured:false,b2cCommercialReady:false,onlineWithdrawalReady:true,
    ...overrides
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

test("critical staff and B2B customer journey remains fail-closed at external dependencies",async()=>{
  const app=createBackend({config:config()});
  const address=await app.listen(),base="http://127.0.0.1:"+address.port;
  try{
    let response=await fetch(base+"/api/v1/auth/login",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:"admin",password:"admin-password-123456"})
    });
    assert.equal(response.status,200);
    const staffCookies=cookiesFrom(response.headers);
    response=await fetch(base+"/api/v1/platform/launch-readiness",{headers:{Cookie:cookieHeader(staffCookies)}});
    assert.equal(response.status,200);
    const readiness=await response.json();
    assert.equal(readiness.ready_for_b2b,false);
    assert.ok(readiness.blockers.b2b.includes("billing"));
    assert.ok(readiness.blockers.b2b.includes("operator"));

    response=await fetch(base+"/api/v1/customer/auth/register",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        first_name:"Camille",last_name:"Martin",account_type:"business",company_name:"Cabinet Martin",country_code:"FR",
        phone:"+33600000000",email:"camille.journey@example.test",password:"long-password-12345",
        authority_confirmed:true,legal_terms_accepted:true,privacy_notice_acknowledged:true,
        legal_version:"2026-09-26-b2b-b2c-v3",website:"",preferred_locale:"fr-FR",timezone:"Europe/Paris"
      })
    });
    assert.equal(response.status,201);
    const customerCookies=cookiesFrom(response.headers);
    assert.ok(customerCookies.has("__Host-pgi_customer_session"));
    assert.ok(customerCookies.has("__Host-pgi_customer_csrf"));

    response=await fetch(base+"/api/v1/customer/billing/status",{headers:{Cookie:cookieHeader(customerCookies)}});
    assert.equal(response.status,200);
    const billing=await response.json();
    assert.equal(billing.billing_provider.checkout_available,false);

    response=await fetch(base+"/api/v1/customer/billing/checkout-session",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Idempotency-Key":randomUUID(),
        "X-CSRF-Token":customerCookies.get("__Host-pgi_customer_csrf"),
        Cookie:cookieHeader(customerCookies)
      },
      body:JSON.stringify({
        subscription_terms_accepted:true,privacy_notice_acknowledged:true,
        immediate_performance_requested:true,legal_version:"2026-09-26-b2b-b2c-v3"
      })
    });
    assert.equal(response.status,503);
    assert.equal((await response.json()).error.code,"PAYMENT_PROVIDER_NOT_CONNECTED");
  }finally{await app.close();}
});

test("consumer withdrawal journey is direct, idempotent and durably queued in the simulator contract",async()=>{
  const app=createBackend({config:config({onlineWithdrawalReady:true})});
  const address=await app.listen(),base="http://127.0.0.1:"+address.port;
  try{
    let response=await fetch(base+"/api/v1/public/withdrawal/status");
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{available:true});

    const key=randomUUID(),payload={
      confirmed:true,website:"",first_name:"Alice",last_name:"Durand",
      contract_email:"alice@example.test",acknowledgement_email:"alice@example.test",
      contract_reference:"CMD-123",contract_details:"Abonnement plateforme",
      contract_date:"2026-09-26",legal_version:"2026-09-26-b2b-b2c-v3"
    };
    const send=()=>fetch(base+"/api/v1/public/withdrawal",{
      method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":key},
      body:JSON.stringify(payload)
    });
    response=await send();
    assert.equal(response.status,201);
    const first=await response.json();
    assert.match(first.reference,/^RET-/);
    assert.equal(first.replayed,false);

    response=await send();
    assert.equal(response.status,201);
    const second=await response.json();
    assert.equal(second.reference,first.reference);
    assert.equal(second.replayed,true);
    assert.equal(app.store.customerWithdrawalRequests.length,1);
    assert.ok(app.store.outbox.some(x=>x.event_type==="consumer.withdrawal.received"));
  }finally{await app.close();}
});
