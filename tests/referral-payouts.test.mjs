import test from "node:test";
import assert from "node:assert/strict";
import {drainReferralRewardPayouts} from "../backend/src/referral-payouts.mjs";
const reward={id:7,public_id:"11111111-1111-4111-8111-111111111111",tenant_public_id:"22222222-2222-4222-8222-222222222222",amount_minor:1500,currency:"EUR",provider_account_reference:"acct_ReferralTest123",account_status:"active",payouts_enabled:true,details_submitted:true,payout_attempt_count:0};
test("automatic referral payout confirms the Stripe transfer without manual settlement",async()=>{
  const original=globalThis.fetch,confirmed=[],deferred=[];globalThis.fetch=async()=>({ok:true,json:async()=>({id:"tr_AutoReferral123",amount:1500,currency:"eur",destination:reward.provider_account_reference})});
  const store={openReferralRewardPayoutBatch:async()=>[reward],confirmCustomerReferralRewardPayout:async(id,input)=>confirmed.push({id,input}),deferCustomerReferralRewardPayout:async(id,input)=>deferred.push({id,input})};
  try{const r=await drainReferralRewardPayouts({store,config:{stripeSecretKey:"sk_test_"+"x".repeat(24),stripeApiVersion:"2026-08-26.dahlia"}});assert.deepEqual({processed:r.processed,paid:r.paid,deferred:r.deferred},{processed:1,paid:1,deferred:0});assert.equal(confirmed[0].input.transfer_reference,"tr_AutoReferral123");assert.equal(deferred.length,0)}finally{globalThis.fetch=original}
});
test("missing payout destination is deferred automatically instead of being marked paid",async()=>{
  const deferred=[],store={openReferralRewardPayoutBatch:async()=>[{...reward,provider_account_reference:null,account_status:null,payouts_enabled:false,details_submitted:false}],confirmCustomerReferralRewardPayout:async()=>assert.fail("must not confirm"),deferCustomerReferralRewardPayout:async(id,input)=>deferred.push({id,input})};
  const r=await drainReferralRewardPayouts({store,config:{stripeSecretKey:"sk_test_"+"x".repeat(24)}});assert.equal(r.deferred,1);assert.equal(deferred[0].input.state,"destination_missing");assert.equal(deferred[0].input.error_code,"REFERRAL_PAYOUT_DESTINATION_MISSING");
});
test("insufficient Stripe balance schedules a durable automatic retry",async()=>{
  const original=globalThis.fetch,deferred=[];globalThis.fetch=async()=>({ok:false,status:400,json:async()=>({error:{code:"balance_insufficient"}})});
  const store={openReferralRewardPayoutBatch:async()=>[reward],confirmCustomerReferralRewardPayout:async()=>assert.fail("must not confirm"),deferCustomerReferralRewardPayout:async(id,input)=>deferred.push({id,input})};
  try{const r=await drainReferralRewardPayouts({store,config:{stripeSecretKey:"sk_test_"+"x".repeat(24),stripeApiVersion:"2026-08-26.dahlia"}});assert.equal(r.deferred,1);assert.equal(deferred[0].input.state,"retry_scheduled");assert.equal(deferred[0].input.error_code,"BALANCE_INSUFFICIENT");assert.ok(Date.parse(deferred[0].input.next_attempt_at)>Date.now())}finally{globalThis.fetch=original}
});
