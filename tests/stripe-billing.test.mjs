import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifyStripeWebhook,normalizeStripeSubscriptionEvent,normalizeStripeBillingEvent,createStripeCheckout,stripeProviderState} from "../backend/src/stripe-billing.mjs";

test("Stripe provider state fails closed until API and webhook are both configured",()=>{
  assert.deepEqual(stripeProviderState({externalBillingEnabled:false}),{api:false,webhook:false,connected:false});
  assert.deepEqual(stripeProviderState({externalBillingEnabled:true,stripeSecretKey:"sk_test_x",publicBaseUrl:"https://example.test"}),{api:true,webhook:false,connected:false});
  assert.deepEqual(stripeProviderState({externalBillingEnabled:true,stripeSecretKey:"sk_test_x",stripeWebhookSecret:"whsec_x",publicBaseUrl:"https://example.test"}),{api:true,webhook:true,connected:true});
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
      data:{object:{id:"in_failed",customer:"cus_invoice_1",attempt_count:2,next_payment_attempt:now+86400,parent:{subscription_details:{subscription:"sub_Invoice123"}}}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(failed.event_type,"invoice.payment_failed");
    assert.equal(failed.last_payment_status,"failed");
    assert.equal(failed.status,"past_due");
    assert.equal(failed.provider_invoice_reference,"in_failed");
    assert.equal(failed.payment_attempt_count,2);
    assert.equal(failed.next_payment_attempt,new Date((now+86400)*1000).toISOString());

    const action=await normalizeStripeBillingEvent({
      id:"evt_invoice_action",type:"invoice.payment_action_required",created:now+2,
      data:{object:{id:"in_action",customer:"cus_invoice_1",attempt_count:1,parent:{subscription_details:{subscription:"sub_Invoice123"}}}}
    },{stripeSecretKey:"sk_test_example",stripeApiVersion:"2026-08-26.dahlia"});
    assert.equal(action.last_payment_status,"action_required");
    assert.equal(action.status,"past_due");
    assert.equal(action.provider_invoice_reference,"in_action");
    assert.equal(action.payment_attempt_count,1);
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
      "idem-test-1"
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
    assert.match(checkoutForm.get("custom_text[submit][message]")||"",/reversements SVA et leurs conditions restent distincts/i);
    assert.equal(calls[1].init.headers["Idempotency-Key"],"idem-test-1");
  }finally{globalThis.fetch=original;}
});
