import test from "node:test";
import assert from "node:assert/strict";
import {
  STRIPE_CONNECT_APPLICATION_FEE_BPS,
  calculateApplicationFee,
  normalizeStripeConnectedAccount,
  normalizeStripeConnectPaymentEvent,
  stripeConnectState,
  createStripeConnectedAccount,
  createStripeReferralTransfer
} from "../backend/src/stripe-connect.mjs";

const requestId="11111111-1111-4111-8111-111111111111";
const accountId="acct_ConnectTest123";

test("Stripe Connect state exposes the fixed PGI fee and webhook readiness",()=>{
  const state=stripeConnectState({stripeSecretKey:"sk_live_"+"x".repeat(24),stripeConnectWebhookSecret:"whsec_ConnectTest1234567890"});
  assert.equal(STRIPE_CONNECT_APPLICATION_FEE_BPS,490);
  assert.equal(state.configured,true);
  assert.equal(state.api_configured,true);
  assert.equal(state.webhook_configured,true);
  assert.equal(state.application_fee_percent,4.9);
  assert.equal(state.pricing_model,"direct_charges_stripe_owned_pricing");
  assert.equal(state.processing_fees_paid_by,"connected_account");
  assert.equal(state.webhook_configured,true);
  assert.equal(calculateApplicationFee(10000),490);
});

test("v2 connected-account capability is the readiness source of truth",()=>{
  const ready=normalizeStripeConnectedAccount({
    id:accountId,
    configuration:{merchant:{capabilities:{card_payments:{status:"active"}}}},
    requirements:{summary:{minimum_deadline:{status:""}}}
  });
  assert.equal(ready.status,"active");
  assert.equal(ready.charges_enabled,true);

  const restricted=normalizeStripeConnectedAccount({
    id:accountId,
    configuration:{merchant:{capabilities:{card_payments:{status:"inactive"}}}},
    requirements:{summary:{minimum_deadline:{status:"currently_due"}}}
  });
  assert.equal(restricted.status,"onboarding");
  assert.equal(restricted.charges_enabled,false);
});

test("payment-intent events update the matching Connect request without trusting a return page",async()=>{
  const succeeded=await normalizeStripeConnectPaymentEvent({},{
    id:"evt_pi_success",account:accountId,type:"payment_intent.succeeded",created:1760000000,
    data:{object:{id:"pi_123",latest_charge:"ch_123",metadata:{pgi_card_payment_request:requestId}}}
  });
  assert.equal(succeeded.status,"paid");
  assert.equal(succeeded.request_public_id,requestId);
  assert.equal(succeeded.provider_payment_intent_reference,"pi_123");

  const failed=await normalizeStripeConnectPaymentEvent({},{
    id:"evt_pi_failed",account:accountId,type:"payment_intent.payment_failed",created:1760000001,
    data:{object:{id:"pi_124",metadata:{pgi_card_payment_request:requestId}}}
  });
  assert.equal(failed.status,"failed");
});

test("Checkout delayed-payment lifecycle stays open until Stripe confirms payment",async()=>{
  const pending=await normalizeStripeConnectPaymentEvent({},{
    id:"evt_checkout_pending",account:accountId,type:"checkout.session.completed",created:1760000000,
    data:{object:{id:"cs_test_1",payment_status:"unpaid",payment_intent:"pi_125",client_reference_id:requestId,metadata:{pgi_card_payment_request:requestId}}}
  });
  assert.equal(pending.status,"open");

  const paid=await normalizeStripeConnectPaymentEvent({},{
    id:"evt_checkout_async",account:accountId,type:"checkout.session.async_payment_succeeded",created:1760000010,
    data:{object:{id:"cs_test_1",payment_status:"paid",payment_intent:"pi_125",metadata:{pgi_card_payment_request:requestId}}}
  });
  assert.equal(paid.status,"paid");
});

test("full refunds and won disputes resolve to the correct request state",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const value=String(url);
    if(value.includes("/v1/charges/ch_refund"))return {ok:true,json:async()=>({
      id:"ch_refund",amount:10000,amount_refunded:10000,refunded:true,payment_intent:"pi_refund",metadata:{pgi_card_payment_request:requestId}
    })};
    if(value.includes("/v1/charges/ch_dispute"))return {ok:true,json:async()=>({
      id:"ch_dispute",payment_intent:"pi_dispute",metadata:{pgi_card_payment_request:requestId}
    })};
    throw new Error("unexpected Stripe URL "+value);
  };
  try{
    const refund=await normalizeStripeConnectPaymentEvent({stripeSecretKey:"sk_test_"+"x".repeat(24),stripeApiVersion:"2026-08-26.dahlia"},{
      id:"evt_refund",account:accountId,type:"refund.updated",created:1760000020,
      data:{object:{id:"re_123",status:"succeeded",charge:"ch_refund",payment_intent:"pi_refund"}}
    });
    assert.equal(refund.status,"refunded");
    assert.equal(refund.refund_full,true);

    const won=await normalizeStripeConnectPaymentEvent({stripeSecretKey:"sk_test_"+"x".repeat(24),stripeApiVersion:"2026-08-26.dahlia"},{
      id:"evt_dispute",account:accountId,type:"charge.dispute.closed",created:1760000030,
      data:{object:{id:"dp_123",status:"won",charge:"ch_dispute"}}
    });
    assert.equal(won.status,"paid");
    assert.equal(won.dispute_status,"won");
  }finally{globalThis.fetch=original;}
});

test("connected accounts are created with Accounts v2 merchant configuration",async()=>{
  const original=globalThis.fetch;
  let captured=null;
  globalThis.fetch=async(url,init)=>{
    captured={url:String(url),init};
    return {ok:true,json:async()=>({
      id:accountId,
      configuration:{merchant:{capabilities:{card_payments:{status:"inactive"}}}},
      requirements:{summary:{minimum_deadline:{status:"currently_due"}}}
    })};
  };
  try{
    const account=await createStripeConnectedAccount(
      {stripeSecretKey:"sk_test_"+"x".repeat(24),publicBaseUrl:"https://example.test",stripeApiVersion:"2026-08-26.dahlia"},
      {email:"merchant@example.test",country_code:"FR",idempotency_key:"connect-account/test"}
    );
    assert.equal(account.id,accountId);
    assert.match(captured.url,/\/v2\/core\/accounts$/);
    const body=JSON.parse(captured.init.body);
    assert.equal(body.dashboard,"full");
    assert.equal(body.defaults.responsibilities.fees_collector,"stripe");
    assert.equal(body.defaults.responsibilities.losses_collector,"stripe");
    assert.equal(body.configuration.merchant.capabilities.card_payments.requested,true);
  }finally{globalThis.fetch=original;}
});


test("Stripe Connect fails closed until the dedicated webhook secret is configured",()=>{
  const withoutWebhook=stripeConnectState({stripeSecretKey:"sk_live_"+"x".repeat(24)});
  assert.equal(withoutWebhook.api_configured,true);
  assert.equal(withoutWebhook.webhook_configured,false);
  assert.equal(withoutWebhook.configured,false);
});

test("referral rewards use an idempotent platform-to-connected-account Transfer",async()=>{
  const original=globalThis.fetch;let captured=null;
  globalThis.fetch=async(url,init)=>{captured={url:String(url),init};return {ok:true,json:async()=>({id:"tr_Referral123",amount:1500,currency:"eur",destination:accountId})}};
  try{
    const transfer=await createStripeReferralTransfer({stripeSecretKey:"sk_test_"+"x".repeat(24),stripeApiVersion:"2026-08-26.dahlia"},{destination_account:accountId,amount_minor:1500,currency:"EUR",reward_public_id:"11111111-1111-4111-8111-111111111111",tenant_public_id:"22222222-2222-4222-8222-222222222222",idempotency_key:"referral-reward:11111111-1111-4111-8111-111111111111"});
    assert.equal(transfer.provider_transfer_reference,"tr_Referral123");assert.match(captured.url,/\/v1\/transfers$/);assert.equal(captured.init.headers["Idempotency-Key"],"referral-reward:11111111-1111-4111-8111-111111111111");
    const form=new URLSearchParams(captured.init.body);assert.equal(form.get("amount"),"1500");assert.equal(form.get("currency"),"eur");assert.equal(form.get("destination"),accountId);assert.equal(form.get("metadata[pgi_referral_reward]"),"11111111-1111-4111-8111-111111111111");
  }finally{globalThis.fetch=original;}
});
