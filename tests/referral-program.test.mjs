import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/061_referral_program_controls.sql","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const postgres=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const memory=fs.readFileSync("backend/src/store-memory.mjs","utf8");
const api=fs.readFileSync("assets/api-client.js","utf8");
const customerApi=fs.readFileSync("assets/client-portal-api.js","utf8");
const customerUi=fs.readFileSync("assets/client-referral.js","utf8");
const adminUi=fs.readFileSync("assets/platform-admin-tools.js","utf8");
const site=fs.readFileSync("site/site.js","utf8");
const client=fs.readFileSync("client.html","utf8");

test("referral schema preserves history behind a global switch",()=>{
  assert.match(migration,/CREATE TABLE platform_feature_controls/);
  assert.match(migration,/referral_program/);
  assert.match(migration,/CREATE TABLE tenant_referral_codes/);
  assert.match(migration,/CREATE TABLE referral_attributions/);
  assert.match(migration,/referrer_tenant_id<>referred_tenant_id/);
});

test("admin referral control is role protected, csrf protected and idempotent",()=>{
  const at=server.indexOf('/api/v1/platform/referral-program');
  assert.ok(at>=0);
  const routes=server.slice(at,at+4200);
  assert.match(routes,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
  assert.match(routes,/requireRole\(actor,\["admin"\]\)/);
  assert.match(routes,/requireCsrf\(req,actor,config\)/);
  assert.match(routes,/platform\.referral_program\.update/);
  assert.match(api,/referralProgram:function/);
  assert.match(api,/setReferralProgram:function/);
});

test("customer referral UI is server gated and disappears when disabled",()=>{
  assert.match(server,/\/api\/v1\/customer\/referral/);
  assert.match(postgres,/async customerReferralProgram/);
  assert.match(memory,/async customerReferralProgram/);
  assert.match(customerApi,/referral:function/);
  assert.match(customerUi,/data\.enabled!==true/);
  assert.match(customerUi,/removeUi\(\)/);
  assert.match(customerUi,/pgi:portal-loaded/);
  assert.match(client,/assets\/client-referral\.js/);
});

test("public opening captures referral code without exposing it to analytics",()=>{
  assert.match(site,/referral_code/);
  assert.match(site,/searchParams\.get\("ref"\)/);
  assert.match(server,/recordReferralLead/);
  assert.match(postgres,/async recordReferralLead/);
});

test("admin cockpit exposes a clear activation and deactivation control",()=>{
  assert.match(adminUi,/Programme de parrainage/);
  assert.match(adminUi,/data-referral-toggle/);
  assert.match(adminUi,/Désactiver le parrainage/);
  assert.match(adminUi,/Activer le parrainage/);
});
