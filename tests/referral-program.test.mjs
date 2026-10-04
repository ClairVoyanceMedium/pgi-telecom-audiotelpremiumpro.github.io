import assert from "node:assert/strict";
import fs from "node:fs";
import {MemoryStore} from "../backend/src/store-memory.mjs";

const migration=fs.readFileSync("database/migrations/064_referral_program.sql","utf8");
const postgres=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const memory=fs.readFileSync("backend/src/store-memory.mjs","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const site=fs.readFileSync("site/site.js","utf8");
const portal=fs.readFileSync("assets/client-portal.js","utf8");
const customerApi=fs.readFileSync("assets/client-portal-api.js","utf8");
const adminApi=fs.readFileSync("assets/api-client.js","utf8");
const adminUi=fs.readFileSync("assets/platform-admin-tools.js","utf8");

test("referral schema is reversible without destructive history loss",()=>{
  assert.match(migration,/CREATE TABLE referral_program_settings/);
  assert.match(migration,/enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration,/CREATE TABLE tenant_referral_codes/);
  assert.match(migration,/CREATE TABLE tenant_referrals/);
  assert.match(migration,/reward_policy_status text NOT NULL DEFAULT 'unconfigured'/);
  assert.match(migration,/pgi_qualify_referral_when_tenant_activates/);
  assert.match(migration,/referral\.qualified/);
  assert.doesNotMatch(migration,/DELETE FROM tenant_referrals/i);
  assert.doesNotMatch(migration,/DROP TABLE/i);
});

test("server enforces referral activation on the authoritative backend",()=>{
  assert.match(server,/\/api\/v1\/customer\/referral/);
  assert.match(server,/\/api\/v1\/platform\/referrals/);
  assert.match(server,/\/api\/v1\/platform\/referrals\/settings/);
  assert.match(server,/requireRole\(actor,\["admin"\]\);requireCsrf/);
  assert.match(server,/referral\.program\.settings/);
  assert.match(postgres,/SELECT enabled FROM referral_program_settings WHERE singleton=true/);
  assert.match(postgres,/t\.status='active'/);
  assert.match(postgres,/ON CONFLICT\(referred_tenant_id\) DO NOTHING/);
  assert.match(postgres,/reward_status:"pending_qualification"/);
  assert.match(postgres,/commercial_benefit:"pending_policy"/);
});

test("public opening funnel carries only a sanitized referral code into dossier automation",()=>{
  assert.match(site,/function referralCode\(\)/);
  assert.match(site,/\^\[A-Z0-9\]\{20\}\$/);
  assert.match(site,/referral_code:referralCode\(\)/);
  assert.match(postgres,/async ensureLeadTenant/);
  assert.match(postgres,/referralRaw=String\(input\.referral_code/);
  assert.match(portal,/\/demande-ouverture\/\?ref=/);
  assert.doesNotMatch(portal,/mois gratuit/i);
  assert.doesNotMatch(portal,/3\s*€.*parrain/i);
});

test("client and cockpit surfaces respect the global switch",()=>{
  assert.match(customerApi,/\/customer\/referral/);
  assert.match(adminApi,/\/platform\/referrals\/settings/);
  assert.match(portal,/!x\.program_enabled\|\|!x\.eligible\|\|!x\.code/);
  assert.match(adminUi,/Désactiver le parrainage/);
  assert.match(adminUi,/anciens liens/);
  assert.match(adminUi,/Historique conservé/);
  assert.match(memory,/history_preserved:true/);
});

test("simulator switch hides old referral codes without deleting state",async()=>{
  const events=[];
  const store=new MemoryStore({}, {publish:(type,payload)=>events.push({type,payload})});
  let view=await store.customerReferralOverview(1);
  assert.equal(view.program_enabled,false);
  assert.equal(view.code,null);
  await store.setReferralProgramEnabled(true,{sub:"1"});
  view=await store.customerReferralOverview(1);
  assert.equal(view.program_enabled,true);
  assert.equal(view.eligible,true);
  assert.match(view.code,/^[A-Z0-9]{20}$/);
  await store.setReferralProgramEnabled(false,{sub:"1"});
  view=await store.customerReferralOverview(1);
  assert.equal(view.program_enabled,false);
  assert.equal(view.code,null);
});
