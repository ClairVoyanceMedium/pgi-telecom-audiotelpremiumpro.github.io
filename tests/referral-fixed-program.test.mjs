import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(new URL("../"+file,import.meta.url),"utf8");
const store=read("backend/src/store-postgres.mjs");
const server=read("backend/server.mjs");
const admin=read("assets/referral-admin.js");
const client=read("assets/client-referral.js");
const dispatcher=read("backend/src/email-dispatcher.mjs");
const resend=read("backend/src/resend-email.mjs");
const migration=read("database/migrations/067_fixed_ambassador_referral_program.sql");

test("ambassador rewards use the immutable fixed schedule",()=>{
  assert.match(store,/REFERRAL_REWARD_TIERS=Object\.freeze/);
  assert.match(store,/from:1,to:4,reward_minor:1000/);
  assert.match(store,/from:5,to:9,reward_minor:1200/);
  assert.match(store,/from:10,to:24,reward_minor:1500/);
  assert.match(store,/from:25,to:null,reward_minor:2000/);
  assert.match(store,/REFERRAL_MILESTONE_BONUSES=Object\.freeze\(\{1:500,5:2000,10:5000\}\)/);
  assert.match(migration,/"permanent_from":25/);
  assert.match(migration,/"permanent_reward_minor":2000/);
});

test("a referral qualifies only after three distinct paid monthly invoices",()=>{
  assert.match(store,/REFERRAL_QUALIFYING_PAID_MONTHS=3/);
  assert.match(store,/three_paid_monthly_subscriptions/);
  assert.match(store,/count\(DISTINCT COALESCE\(NULLIF\(normalized_details->>'provider_invoice_reference'/);
  assert.match(store,/subscription_create/);
  assert.match(store,/subscription_cycle/);
  assert.match(store,/provider_invoice_amount_paid_minor/);
  assert.match(store,/REFERRAL_SELF_CLAIM/);
  assert.match(store,/REFERRAL_ALREADY_CLAIMED/);
});

test("admin can toggle the program but cannot negotiate reward amounts",()=>{
  assert.match(server,/const payload=\{enabled:body\.enabled===true\}/);
  assert.doesNotMatch(admin,/id="pa-referral-reward"/);
  assert.doesNotMatch(admin,/reward_minor:Math\.round/);
  assert.match(admin,/barème est verrouillé/i);
  assert.match(admin,/Enregistrer comme versée/);
  assert.match(admin,/mensualité\(s\) encaissée\(s\)/);
});

test("client sees fixed tiers and automatic three-payment progress",()=>{
  assert.match(client,/3 mensualités/i);
  assert.match(client,/À partir du 25e filleul qualifié, la prime de base reste fixée à 20 €/);
  assert.match(client,/paid_months/);
  assert.match(client,/next_reward/);
});

test("earned rewards are emailed transactionally",()=>{
  assert.match(dispatcher,/referral\.reward\.earned/);
  assert.match(dispatcher,/referral_reward_earned/);
  assert.match(resend,/referral_reward_earned/);
  assert.match(resend,/3\)+" mensualités d’abonnement distinctes réellement encaissées/);
});
