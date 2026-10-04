import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/064_referral_program.sql","utf8");
const domain=fs.readFileSync("backend/src/referral-program.mjs","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const clientApi=fs.readFileSync("assets/client-portal-api.js","utf8");
const adminApi=fs.readFileSync("assets/api-client.js","utf8");
const clientUi=fs.readFileSync("assets/client-referrals.js","utf8");
const adminUi=fs.readFileSync("assets/referral-admin.js","utf8");
const publicSite=fs.readFileSync("site/site.js","utf8");
const audience=fs.readFileSync("assets/client-audience.js","utf8");

test("referral schema preserves attribution and snapshotted reward terms",()=>{
  for(const token of ["platform_referral_program","tenant_referral_codes","tenant_referrals","tenant_referral_rewards","reward_amount_minor","terms_version","UNIQUE (referred_tenant_id)"]){
    assert.ok(migration.includes(token),token);
  }
});

test("global switch blocks all new referral attribution when disabled",()=>{
  assert.ok(domain.includes('reason:"program_disabled"'));
  assert.ok(domain.includes("REFERRAL_PROGRAM_DISABLED"));
  assert.ok(domain.includes("captureReferralAttribution"));
  assert.ok(domain.includes("program.enabled"));
});

test("reward requires an active tenant and an active SVA assignment",()=>{
  for(const token of ["tenant_number_assignments","a.status='active'","service_not_effectively_active","tenant_referral_rewards"]){
    assert.ok(domain.includes(token),token);
  }
  assert.ok(server.includes("qualifyReferralForTenant"));
  assert.ok(server.includes('trigger:"assignment_active"'));
});

test("admin and customer referral APIs are separate and protected",()=>{
  assert.ok(server.includes("/api/v1/platform/referral-program"));
  assert.ok(server.includes("/api/v1/customer/referrals"));
  assert.ok(server.includes("requireCustomerCsrf"));
  assert.ok(adminApi.includes("referralProgram:function"));
  assert.ok(adminApi.includes("updateReferralProgram:function"));
  assert.ok(clientApi.includes("referrals:function"));
  assert.ok(clientApi.includes("createReferralCode:function"));
});

test("public funnel carries the code and client surface hides when disabled",()=>{
  assert.ok(publicSite.includes("referral_code:referralCode()"));
  assert.ok(audience.includes("referral_code"));
  assert.ok(clientUi.includes("if(!data?.program?.enabled)"));
  assert.ok(clientUi.includes("activation réelle"));
  assert.ok(adminUi.includes("Désactiver bloque immédiatement toute nouvelle attribution"));
});
