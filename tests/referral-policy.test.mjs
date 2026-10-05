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

const read=file=>fs.readFileSync(file,"utf8");

test("les primes de parrainage sont versées automatiquement avec idempotence et reprise",()=>{
  const migration=read("database/migrations/068_automatic_referral_reward_payouts.sql");
  const stripe=read("backend/src/stripe-connect.mjs");
  const store=read("backend/src/store-postgres.mjs");
  const workers=read("backend/src/workers.mjs");
  const client=read("assets/client-referral.js");
  const admin=read("assets/referral-admin-view.js");
  for(const state of ["processing","action_required","retry","paid"])assert.ok(migration.includes(state),state);
  assert.match(migration,/payout_transfer_reference/);
  assert.match(migration,/CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_transfer_ref_uidx/);
  assert.match(stripe,/stripe_transfers:\{requested:true\}/);
  assert.match(stripe,/idempotencyKey:"referral-reward\/"\+rewardId/);
  assert.match(store,/FOR UPDATE SKIP LOCKED/);
  assert.match(store,/async completeReferralRewardPayout/);
  assert.match(workers,/claimReferralRewardPayoutBatch/);
  assert.match(workers,/createStripeReferralTransfer/);
  assert.match(workers,/REFERRAL_PAYOUT_STRIPE_ONBOARDING_REQUIRED/);
  assert.match(client,/activateCardPayments/);
  assert.match(client,/transfers_enabled/);
  assert.match(admin,/Versements automatiques/);
  assert.doesNotMatch(admin,/data-referral-paid/);
});
