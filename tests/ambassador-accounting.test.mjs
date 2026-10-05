import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(file,"utf8");
const store=read("backend/src/store-postgres.mjs");
const server=read("backend/server.mjs");
const migration=read("database/migrations/067_ambassador_accounting.sql");
const admin=read("assets/referral-admin.js");
const client=read("assets/client-referral.js");
const accounting=read("assets/accounting-cockpit.js");
const cockpit=read("index.html");
const dispatcher=read("backend/src/email-dispatcher.mjs");
const resend=read("backend/src/resend-email.mjs");

test("Ambassador rewards are fixed server side and qualify after three distinct paid invoices",()=>{
  assert.match(store,/REFERRAL_PAID_MONTHS_REQUIRED=3/);
  assert.match(store,/min:1,max:4,reward_minor:1000/);
  assert.match(store,/min:5,max:9,reward_minor:1200/);
  assert.match(store,/min:10,max:24,reward_minor:1500/);
  assert.match(store,/min:25,max:null,reward_minor:2000/);
  assert.match(store,/rank:1,bonus_minor:500/);
  assert.match(store,/rank:5,bonus_minor:2000/);
  assert.match(store,/rank:10,bonus_minor:5000/);
  assert.match(store,/count\(DISTINCT COALESCE\(NULLIF\(normalized_details->>'provider_invoice_reference',''\),provider_event_id\)\)/);
  assert.match(store,/event_type='invoice\.paid'/);
  assert.match(store,/event_time>=\$2::timestamptz/);
  assert.match(store,/referral\.progress/);
  assert.match(store,/referral-rank:/);
  assert.match(store,/ON CONFLICT\(referral_id\) DO NOTHING/);
});

test("Ambassador admin can toggle the program but cannot edit the reward schedule",()=>{
  assert.doesNotMatch(admin,/pa-referral-reward/);
  assert.match(admin,/barème est verrouillé/i);
  assert.match(admin,/3 mensualités réellement encaissées/i);
  assert.match(admin,/updateReferralProgram\(\{enabled\}/);
  assert.match(client,/10 € du 1er au 4e filleul qualifié/i);
  assert.match(client,/20 € à partir du 25e/i);
  assert.match(client,/qualified_payments/);
});

test("Accounting stays management-only and separates known tax bases",()=>{
  assert.match(server,/\/api\/v1\/platform\/accounting/);
  assert.match(store,/async platformAccounting\(params=\{\}\)/);
  assert.match(store,/statutory_ledger:false/);
  assert.match(store,/tax_conversion_invented:false/);
  assert.match(store,/mixed_tax_bases:true/);
  assert.match(accounting,/Aucune conversion HT\/TTC n’est inventée/);
  assert.match(accounting,/Exporter CSV/);
  assert.match(cockpit,/data-view="accounting"/);
  assert.match(cockpit,/admin-bottom-dock/);
});

test("Ambassador notifications distinguish claim, earned reward and recorded payout",()=>{
  for(const event of ["referral.claimed","referral.progress","referral.reward.earned","referral.reward.paid"])assert.match(dispatcher,new RegExp(event.replaceAll(".","\\.")));
  for(const template of ["referral_claimed","referral_progress","referral_reward_earned","referral_reward_paid"])assert.match(resend,new RegExp(template));
  assert.match(resend,/Une récompense acquise n’est pas présentée comme payée/);
  assert.match(resend,/Référence de paiement/);
});

test("Ambassador migration locks the published commercial schedule",()=>{
  assert.match(migration,/ambassador-2026-10-05-v1/);
  assert.match(migration,/"qualification_payments_required":3/);
  for(const value of [1000,1200,1500,2000])assert.match(migration,new RegExp('"reward_minor":'+value));
  for(const value of [500,2000,5000])assert.match(migration,new RegExp('"bonus_minor":'+value));
});
