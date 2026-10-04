import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(p,"utf8");
const referralSql=read("database/migrations/065_customer_referral_program.sql");
const prioritySql=read("database/migrations/066_priority_portability.sql");
const dailySql=read("database/migrations/067_daily_internal_report.sql");
const store=read("backend/src/store-postgres.mjs");
const server=read("backend/server.mjs");
const stripe=read("backend/src/stripe-billing.mjs");
const resend=read("backend/src/resend-email.mjs");
const clientPortability=read("assets/client-portability.js");
const clientReferral=read("assets/client-referrals.js");
const clientHtml=read("client.html");
const site=read("site/site.js");
const audience=read("assets/client-audience.js");
const vercel=JSON.parse(read("vercel.json"));

test("referral program is globally gated and paid-subscription qualified",()=>{
  assert.match(referralSql,/customer_referral/);
  assert.match(referralSql,/enabled boolean NOT NULL DEFAULT false/);
  assert.match(store,/updateReferralProgramSettings/);
  assert.match(store,/ensureCustomerReferralCode/);
  assert.match(store,/referralPaymentConfirmed/);
  assert.match(store,/eventType==="invoice\.paid"/);
  assert.match(server,/\/api\/v1\/platform\/referrals\/settings/);
  assert.match(server,/\/api\/v1\/customer\/referrals/);
  assert.match(clientReferral,/Programme actuellement désactivé/);
  assert.match(site,/referral_code:REFERRAL_CODE\|\|null/);
  assert.match(audience,/referral_code:referral\|\|null/);
});

test("priority portability is paid once and never gains priority before payment",()=>{
  assert.match(prioritySql,/priority_fee_minor/);
  assert.match(prioritySql,/service_level='priority' AND priority_fee_minor=990/);
  assert.match(stripe,/mode:"payment"/);
  assert.match(stripe,/amountMinor=990/);
  assert.match(stripe,/checkout_kind:"portability_priority"/);
  assert.match(store,/serviceLevel==="priority"\?990:0/);
  assert.match(store,/priority_payment_status='paid'/);
  assert.match(store,/priority=LEAST\(priority,5\)/);
  assert.match(store,/CASE WHEN p\.service_level='priority' AND p\.priority_payment_status='paid' THEN 5 ELSE 20 END/);
  assert.match(server,/normalizePriorityPortabilityCheckoutEvent/);
  assert.match(server,/PORTABILITY_PRIORITY_PAYMENT_PROCESSING/);
  assert.match(clientHtml,/Standard gratuite/);
  assert.match(clientHtml,/Prioritaire, 9,90 € TTC/);
  assert.match(clientPortability,/service_level:\$\("portability-service-level"\)\.value/);
});

test("daily report is durable, timezone aware, deduplicated and has a retry window",()=>{
  assert.match(dailySql,/PRIMARY KEY/);
  assert.match(dailySql,/Europe\/Paris/);
  assert.match(store,/claimDailyInternalReport/);
  assert.match(store,/state='sending'/);
  assert.match(store,/completeDailyInternalReport/);
  assert.match(server,/parisDailyReportWindow/);
  assert.match(server,/\[20,21\]\.includes\(window\.localHour\)/);
  assert.match(server,/sendInternalDailyReport/);
  assert.match(resend,/daily-report\/\+date/);
  const cron=vercel.crons.find(x=>x.path==="/api/v1/internal/reports/daily");
  assert.ok(cron);
  assert.equal(cron.schedule,"0 18,19,20 * * *");
});

test("current commercial values stay aligned",()=>{
  assert.match(clientHtml,/9,90 € TTC/);
  assert.match(read("assets/client-card-payments.js"),/4,9 %/);
  assert.match(read("assets/platform-admin-tools.js"),/placeholder="4\.90"/);
  assert.equal(JSON.parse(read("package.json")).version,"1.32.0");
});
