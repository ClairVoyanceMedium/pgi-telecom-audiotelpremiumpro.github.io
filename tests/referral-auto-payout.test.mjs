import test from "node:test";
import assert from "node:assert/strict";
import {runReferralRewardPayouts} from "../backend/src/referral-payouts.mjs";

const config={externalBillingEnabled:true,stripeLiveMode:true,stripeSecretKey:"sk_live_"+"x".repeat(32)};

test("automatic referral payout uses a stable idempotency key and confirms only after provider success",async()=>{
  const completed=[],failed=[],transfers=[];
  const store={
    async claimReferralRewardPayoutBatch(){return {account_blocked:0,items:[{id:7,public_id:"11111111-1111-4111-8111-111111111111",tenant_public_id:"22222222-2222-4222-8222-222222222222",amount_minor:3200,currency:"EUR",provider_destination_reference:"acct_Referral123"}]};},
    async completeReferralRewardPayout(id,payload){completed.push({id,payload});return {already_paid:false};},
    async failReferralRewardPayout(id,code,options){failed.push({id,code,options});}
  };
  const transfer=async(_cfg,input)=>{
    transfers.push(input);
    return {provider_transfer_reference:"tr_referral_123",created_at:"2026-10-05T18:00:00.000Z"};
  };
  const result=await runReferralRewardPayouts({store,config,transfer});
  assert.equal(result.paid,1);
  assert.equal(result.retry,0);
  assert.equal(failed.length,0);
  assert.equal(completed.length,1);
  assert.equal(transfers[0].idempotency_key,"pgi-referral-reward:11111111-1111-4111-8111-111111111111");
  assert.equal(completed[0].payload.provider_transfer_reference,"tr_referral_123");
});

test("provider failure leaves the reward outstanding and schedules a retry",async()=>{
  const failed=[];
  const store={
    async claimReferralRewardPayoutBatch(){return {items:[{id:8,public_id:"33333333-3333-4333-8333-333333333333",tenant_public_id:"44444444-4444-4444-8444-444444444444",amount_minor:1500,currency:"EUR",provider_destination_reference:"acct_Referral456"}]};},
    async completeReferralRewardPayout(){throw new Error("must not complete");},
    async failReferralRewardPayout(id,code,options){failed.push({id,code,options});}
  };
  const error=Object.assign(new Error("temporary Stripe failure"),{code:"STRIPE_CONNECT_UNAVAILABLE"});
  const result=await runReferralRewardPayouts({store,config,transfer:async()=>{throw error;}});
  assert.equal(result.paid,0);
  assert.equal(result.retry,1);
  assert.equal(failed[0].id,8);
  assert.equal(failed[0].options.blocked,false);
});

test("recipient account errors are blocked for onboarding instead of losing the reward",async()=>{
  const failed=[];
  const store={
    async claimReferralRewardPayoutBatch(){return {items:[{id:9,public_id:"55555555-5555-4555-8555-555555555555",tenant_public_id:"66666666-6666-4666-8666-666666666666",amount_minor:1000,currency:"EUR",provider_destination_reference:"acct_Referral789"}]};},
    async completeReferralRewardPayout(){throw new Error("must not complete");},
    async failReferralRewardPayout(id,code,options){failed.push({id,code,options});}
  };
  const error=Object.assign(new Error("destination unavailable"),{code:"DESTINATION_ACCOUNT_INVALID"});
  const result=await runReferralRewardPayouts({store,config,transfer:async()=>{throw error;}});
  assert.equal(result.blocked,1);
  assert.equal(result.retry,0);
  assert.equal(failed[0].options.blocked,true);
});

test("automatic payouts fail closed outside live Stripe configuration",async()=>{
  let claimed=false;
  const store={async claimReferralRewardPayoutBatch(){claimed=true;return {items:[]};}};
  const result=await runReferralRewardPayouts({store,config:{...config,stripeLiveMode:false}});
  assert.equal(result.enabled,false);
  assert.equal(result.reason,"stripe_live_not_ready");
  assert.equal(claimed,false);
});
