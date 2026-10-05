import test from "node:test";
import assert from "node:assert/strict";
import {
  REFERRAL_POLICY_VERSION,
  REFERRAL_QUALIFICATION_PAID_INVOICES,
  REFERRAL_AMBASSADOR_FROM_RANK,
  referralRewardForRank,
  referralPolicyPublicState
} from "../backend/src/referral-policy.mjs";

test("barème fixe par rang et bonus de paliers",()=>{
  assert.deepEqual(referralRewardForRank(1),{
    rank:1,base_reward_minor:1000,milestone_bonus_minor:500,total_reward_minor:1500,
    ambassador:false,tier_from:1,tier_to:4
  });
  assert.equal(referralRewardForRank(4).total_reward_minor,1000);
  assert.equal(referralRewardForRank(5).base_reward_minor,1200);
  assert.equal(referralRewardForRank(5).milestone_bonus_minor,2000);
  assert.equal(referralRewardForRank(5).total_reward_minor,3200);
  assert.equal(referralRewardForRank(9).total_reward_minor,1200);
  assert.equal(referralRewardForRank(10).base_reward_minor,1500);
  assert.equal(referralRewardForRank(10).milestone_bonus_minor,5000);
  assert.equal(referralRewardForRank(10).total_reward_minor,6500);
  assert.equal(referralRewardForRank(24).total_reward_minor,1500);
});

test("statut Ambassadeur fixe à partir du 25e filleul",()=>{
  const r25=referralRewardForRank(25),r26=referralRewardForRank(26),r250=referralRewardForRank(250);
  for(const row of [r25,r26,r250]){
    assert.equal(row.base_reward_minor,2000);
    assert.equal(row.milestone_bonus_minor,0);
    assert.equal(row.total_reward_minor,2000);
    assert.equal(row.ambassador,true);
    assert.equal(row.tier_from,25);
    assert.equal(row.tier_to,null);
  }
});

test("totaux cumulés du barème publié",()=>{
  const cumulative=n=>Array.from({length:n},(_,i)=>referralRewardForRank(i+1).total_reward_minor).reduce((a,b)=>a+b,0);
  assert.equal(cumulative(1),1500);
  assert.equal(cumulative(5),7700);
  assert.equal(cumulative(10),19000);
  assert.equal(cumulative(25),42000);
});

test("politique publique verrouillée et qualification à trois mensualités",()=>{
  const state=referralPolicyPublicState();
  assert.equal(state.policy_version,REFERRAL_POLICY_VERSION);
  assert.equal(state.qualification_paid_invoices,REFERRAL_QUALIFICATION_PAID_INVOICES);
  assert.equal(state.qualification_paid_invoices,3);
  assert.equal(state.ambassador_from_rank,REFERRAL_AMBASSADOR_FROM_RANK);
  assert.equal(state.ambassador_from_rank,25);
  assert.equal(state.admin_editable_amounts,false);
});
