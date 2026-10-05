import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {referralRewardForOrdinal,referralCumulativeRewardForCount,referralPublicPolicy} from "../backend/src/referral-policy.mjs";

test("fixed referral tiers and milestones are exact",()=>{
  assert.deepEqual(referralRewardForOrdinal(1),{
    ordinal:1,currency:"EUR",base_minor:1000,bonus_minor:500,total_minor:1500,
    tier:{from:1,to:4,reward_minor:1000,label:"1 à 4"},
    milestone:{ordinal:1,bonus_minor:500,label:"1er filleul"}
  });
  assert.equal(referralRewardForOrdinal(4).total_minor,1000);
  assert.equal(referralRewardForOrdinal(5).total_minor,3200);
  assert.equal(referralRewardForOrdinal(9).total_minor,1200);
  assert.equal(referralRewardForOrdinal(10).total_minor,6500);
  assert.equal(referralRewardForOrdinal(24).total_minor,1500);
  assert.equal(referralRewardForOrdinal(25).total_minor,2000);
  assert.equal(referralRewardForOrdinal(250).total_minor,2000);
  assert.equal(referralCumulativeRewardForCount(5).total_minor,7700);
});

test("referral public policy requires three paid monthly invoices and fixes 25+ at 20 EUR",()=>{
  const p=referralPublicPolicy();
  assert.equal(p.qualification_paid_invoices,3);
  assert.equal(p.permanent_from_ordinal,25);
  assert.equal(p.permanent_reward_minor,2000);
  assert.equal(p.policy_version,"2026-10-05-fixed-v1");
});


test("earned referral rewards are paid automatically through an idempotent Stripe transfer",()=>{
  const server=fs.readFileSync("backend/server.mjs","utf8");
  const stripe=fs.readFileSync("backend/src/stripe-connect.mjs","utf8");
  const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
  const view=fs.readFileSync("assets/referral-admin-view.js","utf8");
  const admin=fs.readFileSync("assets/referral-admin.js","utf8");
  const vercel=JSON.parse(fs.readFileSync("vercel.json","utf8"));
  assert.match(server,/processAutomaticReferralPayouts/);
  assert.match(server,/\/api\/v1\/internal\/referral-payouts\/run/);
  assert.match(stripe,/createStripeReferralRecipientAccount/);
  assert.match(stripe,/stripe_transfers:\{requested:true\}/);
  assert.match(stripe,/createStripeReferralTransfer/);
  assert.match(stripe,/referral-reward\//);
  assert.match(store,/referralRewardsForAutomaticPayout/);
  assert.match(store,/recordReferralAutomaticPayoutState/);
  assert.doesNotMatch(admin,/settleReferralReward|data-referral-paid/);
  assert.doesNotMatch(view,/data-referral-paid/);
  assert.match(view,/Versements automatiques/);
  assert.ok(vercel.crons.some(x=>x.path==="/api/v1/internal/referral-payouts/run"&&x.schedule==="*/10 * * * *"));
});
