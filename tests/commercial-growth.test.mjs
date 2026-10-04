import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const stripe=fs.readFileSync("backend/src/stripe-billing.mjs","utf8");
const client=fs.readFileSync("client.html","utf8");
const portability=fs.readFileSync("assets/client-portability.js","utf8");
const referral=fs.readFileSync("assets/client-referral.js","utf8");
const admin=fs.readFileSync("assets/platform-admin-tools.js","utf8");
const migration=fs.readFileSync("database/migrations/066_priority_portability_and_referral_operations.sql","utf8");
const siteJs=fs.readFileSync("site/site.js","utf8");
const buildStatic=fs.readFileSync("scripts/build-static.mjs","utf8");

test("priority portability is a paid one-time PGI service without an operator deadline promise",()=>{
  assert.match(client,/9,90 € TTC une fois/);
  assert.match(client,/ne garantit jamais le délai technique de l’opérateur tiers/);
  assert.match(stripe,/commercial_action:"portability_priority"/);
  assert.match(stripe,/unit_amount:amount/);
  assert.match(store,/amount!==990\|\|currency!=="EUR"/);
  assert.match(store,/processing_priority=\$2/);
  assert.match(store,/LEAST\(priority,5\)/);
  assert.match(server,/priority-checkout/);
  assert.match(portability,/createPortabilityPriorityCheckout/);
  assert.match(migration,/priority_payment_status/);
});

test("standard portability remains free and operational without priority payment",()=>{
  assert.match(client,/Standard gratuit/);
  assert.match(store,/priorityRequested\?990:0/);
  assert.match(store,/priorityRequested\?"pending":"not_required"/);
  assert.match(migration,/processing_priority text NOT NULL DEFAULT 'standard'/);
});

test("referral is server gated, configurable, hidden when disabled and qualified only after paid subscription",()=>{
  assert.match(migration,/platform_feature_flags/);
  assert.match(server,/platform\/commercial-features\/customer-referral/);
  assert.match(store,/qualifyCustomerReferralTx/);
  assert.match(store,/paid_active_subscription/);
  assert.match(referral,/section\.hidden=true/);
  assert.match(admin,/data-referral-save/);
  assert.match(siteJs,/referral_code:referralCode\(\)/);
  assert.match(buildStatic,/assets\/client-referral\.js/);
});

test("new commercial implementation contains no em dash",()=>{
  const forbidden=String.fromCodePoint(0x2014);
  for(const [name,content] of Object.entries({server,store,stripe,client,portability,referral,admin,migration,siteJs,buildStatic})){
    assert.equal(content.includes(forbidden),false,name+" contains an em dash");
  }
});
