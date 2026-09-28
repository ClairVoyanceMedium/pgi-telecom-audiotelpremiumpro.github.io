import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tracking=fs.readFileSync("site/hubspot-tracking.js","utf8");
const site=fs.readFileSync("site/site.js","utf8");
const client=fs.readFileSync("client.html","utf8");
const portal=fs.readFileSync("assets/client-portal.js","utf8");
const billing=fs.readFileSync("assets/client-billing.js","utf8");
const verification=fs.readFileSync("assets/customer-email-verification.js","utf8");
const backend=fs.readFileSync("backend/server.mjs","utf8");
const ga4Server=fs.readFileSync("backend/src/ga4-measurement.mjs","utf8");
const config=fs.readFileSync("backend/src/config.mjs","utf8");

test("analytics defaults to denied and respects GPC",()=>{
  for(const key of ["analytics_storage","ad_storage","ad_user_data","ad_personalization"])assert.match(tracking,new RegExp(key+':"denied"'));
  assert.match(tracking,/navigator\.globalPrivacyControl===true/);
  assert.match(tracking,/clearCookies\(\)/);
  assert.match(tracking,/\["doNotTrack",\{track:true\}\]/);
});

test("GTM and HubSpot load only through the unified consent controller",()=>{
  assert.match(tracking,/GTM-5L6NW5JZ/);
  assert.match(tracking,/G-SZY50J75N7/);
  assert.match(tracking,/149417663/);
  assert.match(tracking,/function accept\(\)/);
  assert.match(client,/\/site\/hubspot-tracking\.js/);
  assert.doesNotMatch(client,/googletagmanager\.com/);
});

test("private surfaces and automatic client page views stay excluded",()=>{
  assert.match(tracking,/cockpit/);
  assert.match(tracking,/admin/);
  assert.match(tracking,/CLIENT_RE/);
  assert.match(tracking,/send_page_view:false/);
});

test("business events fire only after successful milestones",()=>{
  assert.match(site,/PGIAnalytics\?\.track\("generate_lead"/);
  assert.match(tracking,/wrapped\.register=/);
  assert.match(tracking,/wrapped\.login=/);
  assert.match(tracking,/wrapped\.google=/);
  assert.match(verification,/PGIAnalytics\.track\("sign_up"/);
  assert.match(billing,/kind==="start"\)window\.PGIAnalytics\?\.beginCheckout\(offer\)/);
  assert.doesNotMatch(billing,/PGIAnalytics\.track\("purchase"/);
});

test("the Google payload allowlist excludes direct identifiers",()=>{
  assert.match(tracking,/generate_lead:\["account_type","service_intent","lead_source"\]/);
  assert.match(tracking,/purchase:\["transaction_id","currency","value"\]/);
  assert.match(tracking,/account_type:new Set\(\["business","individual"\]\)/);
  assert.match(tracking,/advice:"commercial_information"/);
  assert.match(tracking,/\^\[A-Za-z0-9_-\]\{1,128\}\$/);
  for(const pii of ["email","phone","first_name","last_name","company_name","password"])assert.doesNotMatch(tracking,new RegExp("[\\\"']"+pii+"[\\\"']\\\\s*:"));
});


test("direct GA4 loader sends the first page_view after consent",()=>{
  assert.match(tracking,/GA_SCRIPT_ID="pgi-ga4-loader"/);
  assert.match(tracking,/googletagmanager\.com\/gtag\/js\?id=/);
  assert.match(tracking,/gtag\("config",MEASUREMENT_ID,\{/);
  assert.match(tracking,/send_page_view:true/);
  assert.match(tracking,/content_group/);
  assert.match(tracking,/allow_google_signals:false/);
  assert.match(tracking,/loadGa4\(\);loadGtm\(\);loadHubSpot\(\);flush\(\)/);
  assert.match(tracking,/analytics_storage:granted\?"granted":"denied"/);
});


test("consented Checkout passes only GA technical identifiers for server revenue attribution",()=>{
  assert.match(tracking,/function measurementContext\(\)/);
  assert.match(tracking,/gaField\("client_id"/);
  assert.match(tracking,/gaField\("session_id"/);
  assert.match(tracking,/read\(\)!=="accepted"/);
  assert.match(billing,/PGIAnalytics\?\.measurementContext/);
  assert.match(billing,/\.\.\.\(analytics\|\|\{\}\)/);
  assert.doesNotMatch(billing,/ga_client_id.*email|ga_session_id.*email/i);
});

test("GA4 API secret stays server-only and server purchase/refund use verified Stripe webhooks",()=>{
  assert.match(config,/PGI_GA4_API_SECRET/);
  assert.match(ga4Server,/region1\.google-analytics\.com\/mp\/collect/);
  assert.match(backend,/verifyStripeWebhook/);
  assert.match(backend,/buildGa4PurchaseFromStripe/);
  assert.match(backend,/buildGa4RefundFromStripe/);
  assert.match(backend,/deliverGa4StripeEvent/);
  for(const browserSource of [tracking,site,billing,portal,verification])assert.doesNotMatch(browserSource,/PGI_GA4_API_SECRET|api_secret=/i);
});
