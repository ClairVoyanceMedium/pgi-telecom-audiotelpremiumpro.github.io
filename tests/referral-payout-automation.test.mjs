import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/069_automatic_referral_payouts.sql","utf8");
const stripe=fs.readFileSync("backend/src/stripe-connect.mjs","utf8");
const automation=fs.readFileSync("backend/src/referral-payouts.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const client=fs.readFileSync("assets/client-referral.js","utf8");
const admin=fs.readFileSync("assets/referral-admin-view.js","utf8");
const accounting=fs.readFileSync("assets/accounting-cockpit.js","utf8");
const vercel=JSON.parse(fs.readFileSync("vercel.json","utf8"));

test("les primes ambassadeurs disposent d un état de versement durable",()=>{
  assert.match(migration,/tenant_referral_payout_accounts/);
  assert.match(migration,/provider_transfer_reference/);
  assert.match(migration,/payout_next_attempt_at/);
  assert.match(store,/ensureReferralPayoutSchema/);
  assert.match(store,/scanReferralPayoutAutomation/);
  assert.match(store,/completeCustomerReferralPayout/);
});

test("le transfert prestataire est idempotent au delà de la fenêtre d idempotence",()=>{
  assert.match(stripe,/findStripeReferralTransfer/);
  assert.match(stripe,/transfer_group/);
  assert.match(stripe,/createStripeReferralTransfer/);
  assert.match(automation,/PGI_REFERRAL_/);
  assert.match(automation,/validateRecoveredTransfer/);
  assert.match(automation,/PLATFORM_BALANCE_INSUFFICIENT/);
});

test("aucun règlement manuel de prime n est exposé",()=>{
  assert.doesNotMatch(server,/\/api\/v1\/platform\/referral-rewards\/:id\/paid/);
  assert.doesNotMatch(admin,/Enregistrer comme versée/);
  assert.match(server,/\/api\/v1\/platform\/referral-rewards\/:id\/retry/);
  assert.match(admin,/Relancer/);
});

test("le bénéficiaire configure son versement sans coordonnées bancaires PGI",()=>{
  assert.match(stripe,/configuration:\{recipient:/);
  assert.match(client,/Configurer mes versements/);
  assert.match(client,/ne sont jamais stockées par Audiotel Premium Pro/);
  assert.match(server,/customer\/referral\/payout-account/);
});

test("Vercel et le cockpit couvrent l automatisation et l export humain",()=>{
  assert.ok(vercel.crons.some(x=>x.path==="/api/v1/internal/referral-payouts/run"&&x.schedule==="* * * * *"));
  assert.match(accounting,/data-acc-print/);
  assert.match(accounting,/printAccounting/);
});
