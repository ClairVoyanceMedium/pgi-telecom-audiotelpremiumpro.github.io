import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [migration,server,postgres,memory,adminApi,clientApi,adminUi,referralAdminUi,clientUi,clientHtml,siteScript,siteSearch,productionCheck]=await Promise.all([
  readFile(new URL("../database/migrations/065_customer_referral_program.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-memory.mjs",import.meta.url),"utf8"),
  readFile(new URL("../assets/api-client.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal-api.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/platform-admin-tools.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/platform-referral-admin.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-referral.js",import.meta.url),"utf8"),
  readFile(new URL("../client.html",import.meta.url),"utf8"),
  readFile(new URL("../site/site.js",import.meta.url),"utf8"),
  readFile(new URL("../site/site-search.js",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-production-contract.mjs",import.meta.url),"utf8")
]);

test("referral storage is fail-closed and reward history is persistent",()=>{
  assert.match(migration,/customer_referral',false/);
  assert.match(migration,/referred_tenant_id bigint NOT NULL UNIQUE/);
  assert.match(migration,/reward_minor bigint NOT NULL/);
  assert.match(migration,/customer_referral_rewards/);
  assert.match(migration,/paid_active_subscription/);
});

test("referral service rejects retroactive abuse and qualifies only paid activation",()=>{
  assert.match(postgres,/REFERRAL_PROGRAM_DISABLED/);
  assert.match(postgres,/REFERRAL_MUST_PRECEDE_PAID_ACTIVATION/);
  assert.match(postgres,/REFERRAL_SELF_REFERRAL_FORBIDDEN/);
  assert.match(postgres,/REFERRAL_REFERRER_NOT_ELIGIBLE/);
  assert.match(postgres,/qualifyCustomerReferral/);
  assert.match(postgres,/result\.paid_current/);
  assert.match(memory,/referralProgramOverview/);
});

test("admin and customer surfaces expose controlled referral workflows",()=>{
  assert.match(server,/\/api\/v1\/platform\/referral-program/);
  assert.match(server,/\/api\/v1\/customer\/referrals\/code/);
  assert.match(server,/\/api\/v1\/customer\/referrals\/claim/);
  assert.match(adminApi,/referralProgram:function/);
  assert.match(adminApi,/updateReferralProgram:function/);
  assert.match(clientApi,/createReferralCode:function/);
  assert.match(clientApi,/claimReferral:function/);
  assert.match(adminUi,/Programme de parrainage/);
  assert.match(adminUi,/data-referral-admin/);
  assert.match(referralAdminUi,/referral-admin-save/);
  assert.match(clientHtml,/assets\/client-referral\.js/);
  assert.match(clientUi,/pgi:portal-loaded/);
});

test("referral link continuity is local and historical 3 EUR search wording is gone",()=>{
  assert.match(siteScript,/pgi_referral_code/);
  assert.match(clientUi,/pgi_referral_code/);
  assert.doesNotMatch(siteSearch,/"tarif":\[[^\]]*(?:3 euro|3€)/);
  assert.match(siteSearch,/4,90€/);
  assert.match(productionCheck,/current external subscription price must remain versioned at 4\.90 EUR TTC\/month/);
});
