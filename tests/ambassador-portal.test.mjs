import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/071_ambassador_portal.sql","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const html=fs.readFileSync("ambassadeur.html","utf8");
const api=fs.readFileSync("assets/ambassador-api.js","utf8");
const app=fs.readFileSync("assets/ambassador-portal.js","utf8");
const css=fs.readFileSync("assets/ambassador-portal.css","utf8");
const referralPage=fs.readFileSync("site/seo/parrainage-audiotel.html","utf8");
const tracking=fs.readFileSync("site/hubspot-tracking.js","utf8");
const admin=fs.readFileSync("assets/referral-admin.js","utf8");
const adminView=fs.readFileSync("assets/referral-admin-view.js","utf8");
const resend=fs.readFileSync("backend/src/resend-email.mjs","utf8");
const build=fs.readFileSync("scripts/build-static.mjs","utf8");
const docker=fs.readFileSync("Dockerfile","utf8");
const dockerVercel=fs.readFileSync("Dockerfile.vercel","utf8");
const dockerPlatform=fs.readFileSync("infra/Dockerfile.platform","utf8");

test("ambassador profiles are durable and distinct from subscriptions",()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS customer_ambassador_profiles/);
  assert.match(migration,/CHECK \(status IN \('pending','active','suspended','rejected'\)\)/);
  assert.match(migration,/tenant_id bigint NOT NULL UNIQUE REFERENCES tenants/);
  assert.match(store,/account_scope:"ambassador_only"/);
  assert.match(store,/async ensureAmbassadorApplication/);
  assert.match(store,/async setAmbassadorProfileStatus/);
  assert.doesNotMatch(migration,/tenant_subscriptions/);
});

test("public ambassador application has a dedicated server workflow",()=>{
  assert.match(server,/\/api\/v1\/public\/ambassador\/apply/);
  assert.match(server,/ensureAmbassadorApplication/);
  assert.match(server,/ambassador_application_received/);
  assert.match(tracking,/\/api\/v1\/public\/ambassador\/apply/);
  assert.match(referralPage,/href="\/ambassadeur\.html"/);
});

test("ambassador approval creates dedicated access without a paid subscription gate",()=>{
  assert.match(server,/\/api\/v1\/platform\/ambassadors/);
  assert.match(server,/setAmbassadorProfileStatus/);
  assert.match(server,/sendAmbassadorAccessInvitation/);
  assert.match(server,/ambassadeur\.html\?invite=/);
  assert.match(store,/if\(status==="active"&&row\.tenant_status!=="active"\)await tx\.unsafe\("UPDATE tenants SET status='active'/);
  assert.doesNotMatch(store.slice(store.indexOf("async setAmbassadorProfileStatus"),store.indexOf("async customerReferralOverview")),/PAID_SUBSCRIPTION_REQUIRED_FOR_ACTIVATION/);
});

test("dedicated ambassador portal exposes tracking, rewards, payout and security",()=>{
  assert.match(html,/noindex,nofollow,noarchive/);
  assert.match(html,/Espace ambassadeur/);
  for(const id of ["amb-kpi-visits","amb-kpi-prospects","amb-kpi-claimed","amb-kpi-rewarded","amb-kpi-earned","amb-kpi-paid","amb-kpi-payable","amb-referrals","amb-rewards-body","amb-password-form"])assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/Exporter CSV/);
  assert.match(html,/Imprimer \/ PDF/);
  assert.match(api,/\/ambassador\/dashboard/);
  assert.match(api,/\/ambassador\/referral\/code/);
  assert.match(api,/\/ambassador\/payout-account/);
  assert.match(app,/factures mensuelles distinctes réellement payées/);
  assert.match(app,/exportCsv/);
  assert.match(app,/connectPayout/);
  assert.match(css,/amb-kpis/);
});

test("ambassador dashboard remains referral-only and does not expose client Audiotel operations",()=>{
  assert.match(store,/async ambassadorDashboard/);
  assert.match(server,/ambassador\.dashboard/);
  for(const forbidden of ["customer/portability","customer/card-payments","customer/billing/checkout-session","customer/voice"])assert.doesNotMatch(api,new RegExp(forbidden.replaceAll("/","\\/")));
});

test("cockpit can approve suspend and reject ambassador applications",()=>{
  assert.match(admin,/ambassadorProfiles/);
  assert.match(admin,/updateAmbassadorStatus/);
  assert.match(adminView,/CANDIDATURES/);
  assert.match(adminView,/Ambassadeurs non-clients/);
  assert.match(adminView,/Valider l’accès/);
  assert.match(adminView,/Suspendre/);
  assert.match(adminView,/Refuser/);
});

test("ambassador transactional emails and static publishing are present",()=>{
  assert.match(resend,/ambassador_application_received/);
  assert.match(resend,/ambassador_access_invitation/);
  assert.match(resend,/Activez votre espace ambassadeur/);
  assert.ok(build.includes('"ambassadeur.html"'));
  assert.ok(build.includes('"assets/ambassador-api.js"'));
  assert.ok(build.includes('"assets/ambassador-portal.js"'));
  assert.ok(build.includes('"assets/ambassador-portal.css"'));
});

test("container images include the ambassador portal source required by static build",()=>{
  for(const [name,content] of [["Dockerfile",docker],["Dockerfile.vercel",dockerVercel],["infra/Dockerfile.platform",dockerPlatform]]){
    assert.match(content,/client\.html ambassadeur\.html paiement-cb-result\.html/,name);
  }
});

test("new ambassador surfaces contain no em dash",()=>{
  for(const [name,content] of [["html",html],["api",api],["app",app],["css",css],["migration",migration]])assert.equal(content.includes("—"),false,name);
});
