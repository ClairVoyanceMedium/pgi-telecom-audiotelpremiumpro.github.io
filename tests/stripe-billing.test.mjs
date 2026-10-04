import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifyStripeWebhook,normalizeStripeSubscriptionEvent,normalizeStripeBillingEvent,normalizeStripeRefundEvent,createStripeCheckout,createStripePortabilityPriorityCheckout,createStripeCustomerBalanceCredit,currentMonthOfferTrialEnd,stripeProviderState,stripeProviderReadiness,invalidateStripeProviderReadiness} from "../backend/src/stripe-billing.mjs";

test("Stripe provider state fails closed until API and webhook are both configured",()=>{
  assert.deepEqual(stripeProviderState({externalBillingEnabled:false}),{api:false,webhook:false,connected:false});
  assert.deepEqual(stripeProviderState({externalBillingEnabled:true,stripeSecretKey:"sk_test_x",publicBaseUrl:"https://example.test"}),{api:true,webhook:false,connected:false});
  assert.deepEqual(stripeProviderState({externalBillingEnabled:true,stripeSecretKey:"sk_test_x",stripeWebhookSecret:"whsec_x",publicBaseUrl:"https://example.test"}),{api:true,webhook:true,connected:true});
});



test("Stripe live readiness blocks checkout semantics until charges are enabled",async()=>{
  const config={externalBillingEnabled:true,stripeSecretKey:"sk_live_not_ready_"+ "a".repeat(24),stripeWebhookSecret:"whsec_live",publicBaseUrl:"https://example.test",stripeLiveMode:true,stripeApiVersion:"2026-08-26.dahlia"};
  const fetchImpl=async(url)=>{
    assert.equal(String(url),"https://api.stripe.com/v1/account");
    return {ok:true,status:200,json:async()=>({charges_enabled:false,payouts_enabled:false,details_submitted:false,requirements:{disabled_reason:"requirements.past_due"}})};
  };
  const state=await stripeProviderReadiness(config,{fetchImpl,cacheTtlMs:0});
  assert.equal(state.api,true);
  assert.equal(state.webhook,true);
  assert.equal(state.account_checked,true);
  assert.equal(state.account_ready,false);
  assert.equal(state.connected,false);
  assert.equal(state.fully_operational,false);
  assert.equal(state.readiness_reason,"account_activation_required");
});

test("Stripe live readiness distinguishes charges from payouts",async()=>{
  const config={externalBillingEnabled:true,stripeSecretKey:"sk_live_ready_"+ "b".repeat(24),stripeWebhookSecret:"whsec_live",publicBaseUrl:"https://example.test",stripeLiveMode:true,stripeApiVersion:"2026-08-26.dahlia"};
  const fetchImpl=async()=>({ok:true,status:200,json:async()=>({charges_enabled:true,payouts_enabled:false,details_submitted:true})});
  const state=await stripeProviderReadiness(config,{fetchImpl,cacheTtlMs:0});
  assert.equal(state.account_ready,true);
  assert.equal(state.connected,true);
  assert.equal(state.charges_enabled,true);
  assert.equal(state.payouts_enabled,false);
  assert.equal(state.fully_operational,false);
  assert.equal(state.readiness_reason,"payouts_pending");
});

test("Stripe Checkout live fails closed before price lookup when account activation is incomplete",async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    if(String(url)==="https://api.stripe.com/v1/account")return {ok:true,status:200,json:async()=>({charges_enabled:false,payouts_enabled:false,details_submitted:false})};
    throw new Error("checkout must not reach price or session APIs");
  };
  try{
    await assert.rejects(
      ()=>createStripeCheckout(
        {externalBillingEnabled:true,stripeSecretKey:"sk_live_checkout_block_"+ "c".repeat(24),stripeWebhookSecret:"whsec_live",stripeLiveMode:true,stripeApiVersion:"2026-08-26.dahlia",publicBaseUrl:"https://pgi.example",stripePriceLookupKey:"pgi_audiotel_premium_pro_monthly_eur"},
        {tenant:{id:"22222222-2222-4222-8222-222222222222",billing_email:"client@example.com"},offer:{price_version_id:42,plan_key:"external-sva-access",currency:"EUR",amount_minor:300,tax_behavior:"inclusive",billing_interval:"month",interval_count:1,market_id:null},subscription:null},
        "idem-live-blocked"
      ),
      e=>e.code==="PAYMENT_ACCOUNT_NOT_READY"&&e.status===503
    );
    assert.deepEqual(calls,["https://api.stripe.com/v1/account"]);
  }finally{globalThis.fetch=original;}
});

test("Stripe account.updated can invalidate cached live readiness immediately",async()=>{
  invalidateStripeProviderReadiness();
  const config={externalBillingEnabled:true,stripeSecretKey:"sk_live_cache_refresh_"+ "e".repeat(24),stripeWebhookSecret:"whsec_live",publicBaseUrl:"https://example.test",stripeLiveMode:true,stripeApiVersion:"2026-08-26.dahlia"};
  let ready=false,calls=0;
  const fetchImpl=async()=>{calls++;return {ok:true,status:200,json:async()=>({charges_enabled:ready,payouts_enabled:ready,details_submitted:ready})};};
  const first=await stripeProviderReadiness(config,{fetchImpl,nowMs:1000,cacheTtlMs:300000});
  assert.equal(first.account_ready,false);
  ready=true;
  const cached=await stripeProviderReadiness(config,{fetchImpl,nowMs:2000,cacheTtlMs:300000});
  assert.equal(cached.account_ready,false);
  assert.equal(calls,1);
  invalidateStripeProviderReadiness();
  const refreshed=await stripeProviderReadiness(config,{fetchImpl,nowMs:3000,cacheTtlMs:300000});
  assert.equal(refreshed.account_ready,true);
  assert.equal(refreshed.fully_operational,true);
  assert.equal(calls,2);
});

test("Stripe webhook signature is verified before JSON is trusted",async()=>{
  const secret="whsec_test_signature_secret",event={id:"evt_test_1",type:"customer.subscription.updated",created:Math.floor(Date.now()/1000),data:{object:{}}};
  const raw=Buffer.from(JSON.stringify(event)),t=Math.floor(Date.now()/1000);
  const sig=createHmac("sha256",secret).update(String(t)+".").update(raw).digest("hex");
  const req={headers:{"stripe-signature":"t="+t+",v1="+sig},async *[Symbol.asyncIterator](){yield raw;}};
  const verified=await verifyStripeWebhook(req,{stripeWebhookSecret:secret,bodyLimitBytes:262144,stripeWebhookToleranceSeconds:300});
  assert.equal(verified.id,event.id);

  const bad={headers:{"stripe-signature":"t="+t+",v1="+"0".repeat(64)},async *[Symbol.asyncIterator](){yield raw;}};
  await assert.rejects(()=>verifyStripeWebhook(bad,{stripeWebhookSecret:secret,bodyLimitBytes:262144,stripeWebhookToleranceSeconds:300}),e=>e.code==="STRIPE_SIGNATURE_INVALID");
});

test("Stripe subscription events preserve tenant and price binding",()=>{
  const now=Math.floor(Date.now()/1000),periodEnd=now+30*86400;
  const event={
    id:"evt_sub_1",type:"customer.subscription.updated",created:now,
    data:{object:{
      id:"sub_123",customer:"cus_123",status:"active",cancel_at_period_end:false,
      metadata:{tenant_public_id:"22222222-2222-4222-8222-222222222222",price_version_id:"42",market_id:"7"},
      items:{data:[{current_period_start:now,current_period_end:periodEnd,price:{id:"price_123",unit_amount:300,currency:"eur",recurring:{interval:"month",interval_count:1}}}]}
    }}
  };
  const n=normalizeStripeSubscriptionEvent(event);
  assert.equal(n.provider,"stripe");
  assert.equal(n.provider_event_id,"evt_sub_1");
  assert.equal(n.tenant_public_id,"22222222-2222-4222-8222-222222222222");
  assert.equal(n.price_version_id,42);
  assert.equal(n.provider_price_reference,"price_123");
  assert.equal(n.provider_price_amount_minor,300);
  assert.equal(n.provider_price_currency,"EUR");
  assert.equal(n.provider_billing_interval,"month");
  assert.equal(n.status,"active");
  assert.ok(Date.parse(n.current_period_end)>Date.parse(n.event_time));
});

test("Stripe renewal invoices refresh the subscription before changing billing access",async()=>{
  const original=globalThis.fetch,now=Math.floor(Date.now()/1000),periodEnd=now+30*86400;
  globalThis.fetch=async(url)=>{
    assert.match(String(url),/\/v1\/subscriptions\/sub_Invoice123$/);
    return {ok:true,status:200,json:async()=>({
      id:"sub_Invoice123",customer:"cus_invoice_1",status:"active",cancel_at_period_end:false,
      metadata:{tenant_public_id:"22222222-2222-4222-8222-222222222222",price_version_id:"42"},
      items:{data:[{current_period_start:now,current_period_end:periodEnd,price:{id:"price_123",unit_amount:300,currency:"eur",recurring:{interval:"month",interval_count:1}}}]}
    })};
  };
  try{
    const paid=await normalizeStripeBillingEvent({
      id:"evt_invoice_paid",type:"invoice.paid",created:now,
      data:{object:{id:"in_paid",customer:"cus_invoice_1",parent:{subscription_details:{subscription:"sub_Invoice123"}}}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(paid.event_type,"invoice.paid");
    assert.equal(paid.provider_event_id,"evt_invoice_paid");
    assert.equal(paid.last_payment_status,"paid");
    assert.equal(paid.status,"active");
    assert.equal(paid.provider_subscription_reference,"sub_Invoice123");

    const failed=await normalizeStripeBillingEvent({
      id:"evt_invoice_failed",type:"invoice.payment_failed",created:now+1,
      data:{object:{id:"in_failed",customer:"cus_invoice_1",attempt_count:1,next_payment_attempt:now+3600,parent:{subscription_details:{subscription:"sub_Invoice123"}}}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(failed.event_type,"invoice.payment_failed");
    assert.equal(failed.last_payment_status,"failed");
    assert.equal(failed.status,"past_due");
    assert.equal(failed.provider_invoice_reference,"in_failed");
    assert.equal(failed.payment_attempt_count,1);
    assert.ok(Date.parse(failed.next_payment_attempt)>Date.parse(failed.event_time));

    const action=await normalizeStripeBillingEvent({
      id:"evt_invoice_action",type:"invoice.payment_action_required",created:now+2,
      data:{object:{id:"in_action",customer:"cus_invoice_1",parent:{subscription_details:{subscription:"sub_Invoice123"}}}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(action.last_payment_status,"action_required");
    assert.equal(action.status,"past_due");

    const retryUpdate=await normalizeStripeBillingEvent({
      id:"evt_invoice_updated",type:"invoice.updated",created:now+3,
      data:{object:{id:"in_failed",customer:"cus_invoice_1",attempt_count:2,next_payment_attempt:now+7200,parent:{subscription_details:{subscription:"sub_Invoice123"}}}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(retryUpdate.last_payment_status,"retry_scheduled");
    assert.equal(retryUpdate.payment_attempt_count,2);
    assert.equal(retryUpdate.status,"past_due");
  }finally{globalThis.fetch=original;}
});

test("Stripe invoice events without a subscription are ignored without an API fetch",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("fetch must not run");};
  try{
    const result=await normalizeStripeBillingEvent(
      {id:"evt_standalone",type:"invoice.paid",created:Math.floor(Date.now()/1000),data:{object:{id:"in_standalone"}}},
      {stripeSecretKey:"sk_test_example"}
    );
    assert.equal(result,null);
  }finally{globalThis.fetch=original;}
});

test("Stripe Checkout verifies the remote price before creating a hosted subscription",async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    if(String(url).includes("/v1/prices?")){
      return {ok:true,status:200,json:async()=>({data:[{id:"price_live_match",active:true,type:"recurring",currency:"eur",unit_amount:300,tax_behavior:"inclusive",recurring:{interval:"month",interval_count:1}}]})};
    }
    if(String(url).endsWith("/v1/checkout/sessions")){
      return {ok:true,status:200,json:async()=>({id:"cs_test_123",url:"https://checkout.stripe.com/c/pay/cs_test_123"})};
    }
    throw new Error("unexpected Stripe request");
  };
  try{
    const result=await createStripeCheckout(
      {stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia",publicBaseUrl:"https://pgi.example",stripePriceLookupKey:"pgi_audiotel_premium_pro_monthly_eur"},
      {
        tenant:{id:"22222222-2222-4222-8222-222222222222",billing_email:"client@example.com"},
        offer:{price_version_id:42,plan_key:"external-sva-access",currency:"EUR",amount_minor:300,tax_behavior:"inclusive",billing_interval:"month",interval_count:1,market_id:null},
        subscription:null
      },
      "idem-test-1",
      {client_id:"123456789.987654321",session_id:"1790630000"}
    );
    assert.equal(result.provider,"stripe");
    assert.equal(result.price_id,"price_live_match");
    assert.equal(calls.length,2);
    const body=String(calls[1].init.body);
    assert.match(body,/mode=subscription/);
    assert.match(body,/line_items%5B0%5D%5Bprice%5D=price_live_match/);
    assert.match(body,/subscription_data%5Bmetadata%5D%5Btenant_public_id%5D/);
    assert.match(body,/subscription_data%5Bdescription%5D=/);
    assert.match(body,/custom_text%5Bsubmit%5D%5Bmessage%5D=/);
    const checkoutForm=new URLSearchParams(body);
    assert.match(checkoutForm.get("custom_text[submit][message]")||"",/mois en cours est offert/i);
    assert.match(checkoutForm.get("custom_text[submit][message]")||"",/à partir du mois suivant/i);
    assert.ok(Number(checkoutForm.get("subscription_data[trial_end]"))>Math.floor(Date.now()/1000));
    assert.match(checkoutForm.get("custom_text[submit][message]")||"",/résiliable à tout moment/i);
    assert.equal(checkoutForm.get("payment_method_collection"),"always");
    assert.equal(checkoutForm.get("metadata[contract_model]"),"indefinite_monthly_advance");
    assert.equal(checkoutForm.get("subscription_data[metadata][legal_version]"),"2026-09-26-b2b-b2c-v4");
    assert.equal(checkoutForm.get("metadata[ga_client_id]"),"123456789.987654321");
    assert.equal(checkoutForm.get("subscription_data[metadata][ga_client_id]"),"123456789.987654321");
    assert.equal(checkoutForm.get("subscription_data[metadata][ga_session_id]"),"1790630000");
    assert.equal(calls[1].init.headers["Idempotency-Key"],"idem-test-1");
  }finally{globalThis.fetch=original;}
});


test("Stripe paid invoice exposes only GA identifiers and verified payment facts",async()=>{
  const original=globalThis.fetch,now=Math.floor(Date.now()/1000);
  globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({
    id:"sub_ga4",customer:"cus_ga4",status:"active",cancel_at_period_end:false,
    metadata:{tenant_public_id:"22222222-2222-4222-8222-222222222222",price_version_id:"42",ga_client_id:"123456789.987654321",ga_session_id:"1790630000"},
    items:{data:[{current_period_start:now,current_period_end:now+2592000,price:{id:"price_ga4",unit_amount:300,currency:"eur",recurring:{interval:"month",interval_count:1}}}]}
  })});
  try{
    const paid=await normalizeStripeBillingEvent({
      id:"evt_ga4_paid",type:"invoice.paid",created:now,
      data:{object:{id:"in_ga4_paid",amount_paid:300,currency:"eur",billing_reason:"subscription_create",parent:{subscription_details:{subscription:"sub_ga4"}}}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(paid.ga_client_id,"123456789.987654321");
    assert.equal(paid.ga_session_id,"1790630000");
    assert.equal(paid.provider_invoice_amount_paid_minor,300);
    assert.equal(paid.provider_invoice_currency,"EUR");
    assert.equal(paid.provider_invoice_billing_reason,"subscription_create");
  }finally{globalThis.fetch=original;}
});

test("Stripe successful refund resolves the original invoice and consented GA context",async()=>{
  const original=globalThis.fetch,now=Math.floor(Date.now()/1000),calls=[];
  globalThis.fetch=async(url)=>{
    calls.push(String(url));
    if(String(url).endsWith("/v1/charges/ch_refund"))return {ok:true,status:200,json:async()=>({id:"ch_refund",invoice:"in_refund"})};
    if(String(url).endsWith("/v1/invoices/in_refund"))return {ok:true,status:200,json:async()=>({id:"in_refund",billing_reason:"subscription_create",parent:{subscription_details:{subscription:"sub_refund"}}})};
    if(String(url).endsWith("/v1/subscriptions/sub_refund"))return {ok:true,status:200,json:async()=>({id:"sub_refund",metadata:{ga_client_id:"123456789.987654321",ga_session_id:"1790630000"}})};
    throw new Error("unexpected Stripe request "+url);
  };
  try{
    const refund=await normalizeStripeRefundEvent({
      id:"evt_refund",type:"refund.created",created:now,
      data:{object:{id:"re_refund",status:"succeeded",amount:150,currency:"eur",charge:"ch_refund"}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(refund.refund_id,"re_refund");
    assert.equal(refund.transaction_id,"in_refund");
    assert.equal(refund.amount_minor,150);
    assert.equal(refund.currency,"EUR");
    assert.equal(refund.ga_client_id,"123456789.987654321");
    assert.equal(calls.length,3);
  }finally{globalThis.fetch=original;}
});

test("current month offer starts paid billing in the following month",()=>{
  const now=Date.UTC(2026,8,15,12,0,0);
  const end=currentMonthOfferTrialEnd(now);
  const parisOct1Midnight=Math.floor(Date.UTC(2026,8,30,22,0,0)/1000);
  assert.ok(end>=parisOct1Midnight);
  assert.ok(end<=parisOct1Midnight+1);
});

test("current month offer follows the Europe Paris calendar around midnight",()=>{
  const parisOct1JustAfterMidnight=Date.UTC(2026,8,30,22,30,0);
  const end=currentMonthOfferTrialEnd(parisOct1JustAfterMidnight);
  const endDate=new Date(end*1000);
  assert.equal(endDate.getUTCMonth(),9);
  assert.ok(endDate.getUTCDate()>=31||endDate.getUTCDate()===1);
});


test("Stripe priority checkout is a one-time 9.90 EUR PGI payment with portability metadata",async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init={})=>{
    calls.push({url:String(url),body:String(init.body||"")});
    assert.match(String(url),/\/v1\/checkout\/sessions$/);
    const body=String(init.body||"");
    assert.match(body,/mode=payment/);
    assert.match(body,/unit_amount=990/);
    assert.match(body,/pgi_payment_kind=portability_priority/);
    assert.match(body,/portability_request_id=77/);
    return {ok:true,status:200,json:async()=>({id:"cs_test_priority77",url:"https://checkout.stripe.com/c/pay/cs_test_priority77"})};
  };
  try{
    const result=await createStripePortabilityPriorityCheckout(
      {stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia",publicBaseUrl:"https://pgi.example",stripeLiveMode:false},
      {tenant:{id:"22222222-2222-4222-8222-222222222222",billing_email:"client@example.test"},subscription:{provider_customer_reference:"cus_priority77"}},
      {id:77,priority_fee_minor:990,priority_currency:"EUR"},
      "priority-test-77"
    );
    assert.equal(result.session_id,"cs_test_priority77");
    assert.equal(result.amount_minor,990);
    assert.equal(result.currency,"EUR");
    assert.equal(calls.length,1);
  }finally{globalThis.fetch=original;}
});

test("Stripe referral reward creates a negative customer balance transaction credit",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    assert.match(String(url),/\/v1\/customers\/cus_referrer1\/balance_transactions$/);
    const body=String(init.body||"");
    assert.match(body,/amount=-300/);
    assert.match(body,/currency=eur/);
    assert.match(body,/reward_kind=one_month_free/);
    return {ok:true,status:200,json:async()=>({id:"cbtxn_referral1",ending_balance:-300})};
  };
  try{
    const result=await createStripeCustomerBalanceCredit(
      {stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"},
      "cus_referrer1",300,"EUR",{reward_kind:"one_month_free",referral_id:"12"},"referral-reward/12"
    );
    assert.equal(result.reference,"cbtxn_referral1");
    assert.equal(result.amount_minor,300);
    assert.equal(result.currency,"EUR");
    assert.equal(result.ending_balance,-300);
  }finally{globalThis.fetch=original;}
});
