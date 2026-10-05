import test from "node:test";
import assert from "node:assert/strict";
import {retrieveStripeTransferRecipient,createStripeReferralTransfer} from "../backend/src/stripe-connect.mjs";
import {createReferralPayoutQueueHandlers} from "../backend/src/referral-payout.mjs";

const config={stripeSecretKey:"sk_test_abcdefghijklmnopqrstuvwxyz",stripeApiVersion:"2026-08-26.dahlia",referralAutopayoutEnabled:true};

test("Stripe recipient readiness requires transfers and external payouts",async()=>{
  const previous=global.fetch;
  global.fetch=async()=>new Response(JSON.stringify({
    id:"acct_ready123",
    capabilities:{transfers:"active"},
    payouts_enabled:true,
    requirements:{disabled_reason:null}
  }),{status:200,headers:{"content-type":"application/json"}});
  try{
    const state=await retrieveStripeTransferRecipient(config,"acct_ready123");
    assert.equal(state.transfer_capability,"active");
    assert.equal(state.payouts_enabled,true);
    assert.equal(state.transfer_ready,true);
  }finally{global.fetch=previous}
});

test("referral transfer uses one deterministic Stripe idempotency key",async()=>{
  const previous=global.fetch;
  let captured=null;
  global.fetch=async(_url,options)=>{
    captured=options;
    return new Response(JSON.stringify({id:"tr_reward123",object:"transfer",amount:2000,currency:"eur",destination:"acct_ready123",balance_transaction:"txn_123"}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const transfer=await createStripeReferralTransfer(config,{
      connected_account_reference:"acct_ready123",
      amount_minor:2000,
      currency:"EUR",
      reward_public_id:"11111111-1111-4111-8111-111111111111",
      payout_public_id:"22222222-2222-4222-8222-222222222222",
      idempotency_key:"pgi-referral-reward:11111111-1111-4111-8111-111111111111"
    });
    assert.equal(transfer.id,"tr_reward123");
    assert.equal(captured.headers["Idempotency-Key"],"pgi-referral-reward:11111111-1111-4111-8111-111111111111");
    const body=new URLSearchParams(captured.body);
    assert.equal(body.get("amount"),"2000");
    assert.equal(body.get("currency"),"eur");
    assert.equal(body.get("destination"),"acct_ready123");
    assert.equal(body.get("metadata[pgi_referral_reward_id]"),"11111111-1111-4111-8111-111111111111");
  }finally{global.fetch=previous}
});

test("queue handler never transfers when recipient is not ready",async()=>{
  const previous=global.fetch;
  let requests=0,blocked=null,processing=0,completed=0;
  global.fetch=async()=>{requests++;return new Response(JSON.stringify({id:"acct_pending123",capabilities:{transfers:"pending"},payouts_enabled:true}),{status:200,headers:{"content-type":"application/json"}})};
  const store={
    async referralPayoutContext(){return {done:false,provider_account_reference:"acct_pending123",account_status:"active",payouts_enabled:true,amount_minor:1500,currency:"EUR",reward_public_id:"11111111-1111-4111-8111-111111111111",idempotency_key:"pgi-referral-reward:11111111-1111-4111-8111-111111111111"}},
    async markReferralPayoutRecipientMissing(_id,value){blocked=value},
    async markReferralPayoutFailure(){throw new Error("unexpected failure")},
    async markReferralPayoutProcessing(){processing++},
    async completeReferralPayout(){completed++}
  };
  try{
    const handler=createReferralPayoutQueueHandlers({store,config}).referral_payout;
    const result=await handler({payload:{payout_public_id:"22222222-2222-4222-8222-222222222222"},attempts:1,max_attempts:20},{heartbeat:async()=>{}});
    assert.equal(requests,1);
    assert.equal(result.blocked,true);
    assert.equal(blocked.code,"STRIPE_TRANSFERS_NOT_ACTIVE");
    assert.equal(processing,0);
    assert.equal(completed,0);
  }finally{global.fetch=previous}
});
