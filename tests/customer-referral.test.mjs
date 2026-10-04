import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const store=fs.readFileSync(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8");
const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
const admin=fs.readFileSync(new URL("../assets/platform-referral-admin.js",import.meta.url),"utf8");
const commands=fs.readFileSync(new URL("../assets/command-palette.js",import.meta.url),"utf8");
const customer=fs.readFileSync(new URL("../assets/client-referrals.js",import.meta.url),"utf8");
const migration=fs.readFileSync(new URL("../database/migrations/065_customer_referral_program.sql",import.meta.url),"utf8");

test("referral program is fail-closed and freezes the commercial attribution",()=>{
  assert.match(migration,/customer_referral',false/);
  assert.match(store,/REFERRAL_REWARD_REQUIRED/);
  assert.match(store,/reward_snapshot:true/);
  assert.match(store,/attribution_locked/);
  assert.match(store,/self_referral/);
  assert.match(store,/too_late/);\n  assert.match(store,/existing_dossier/);\n  assert.match(store,/randomBytes\\(10\\)/);
  assert.match(store,/ON CONFLICT\(referred_tenant_id\) DO NOTHING/);
});

test("referral reward qualifies only from a confirmed paid active invoice",()=>{
  assert.match(store,/eventType==="invoice\.paid"/);
  assert.match(store,/lastPaymentStatus==="paid"/);
  assert.match(store,/providerInvoiceReference/);
  assert.match(store,/status='rewarded'/);
  assert.match(store,/customer_referral_rewards/);
});

test("admin can stop new referrals without erasing already registered rights",()=>{
  assert.match(server,/\/api\/v1\/platform\/referral-program/);
  assert.match(commands,/platform-referral-admin\.js/);
  assert.match(admin,/Désactiver les nouveaux parrainages/);
  assert.match(admin,/droits déjà enregistrés/);
  assert.match(customer,/nouveaux parrainages sont actuellement désactivés/);
});

test("customer referral code requires the referrer to have a paid active subscription",()=>{
  assert.match(store,/REFERRAL_REFERRER_NOT_ELIGIBLE/);
  assert.match(store,/s\.last_payment_status IN \('paid','succeeded','success'\)/);
  assert.match(server,/customer\.referral_code\.create/);
});

test("reward settlement is explicit and does not pretend to initiate a transfer",()=>{
  assert.match(admin,/Aucun virement n’est déclenché automatiquement/);
  assert.match(store,/REFERRAL_PAYMENT_REFERENCE_REQUIRED/);
  assert.match(store,/paid_reference/);
});
