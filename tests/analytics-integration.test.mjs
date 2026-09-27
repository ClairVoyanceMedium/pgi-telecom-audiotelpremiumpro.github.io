import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const tracking=fs.readFileSync("site/hubspot-tracking.js","utf8");
const site=fs.readFileSync("site/site.js","utf8");
const client=fs.readFileSync("client.html","utf8");
const portal=fs.readFileSync("assets/client-portal.js","utf8");
const billing=fs.readFileSync("assets/client-billing.js","utf8");
const verification=fs.readFileSync("assets/customer-email-verification.js","utf8");

test("analytics defaults to denied and respects GPC",()=>{
  for(const key of ["analytics_storage","ad_storage","ad_user_data","ad_personalization"])assert.match(tracking,new RegExp(key+':"denied"'));
  assert.match(tracking,/navigator\.globalPrivacyControl===true/);
  assert.match(tracking,/clearCookies\(\)/);
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
  assert.match(site,/PGIAnalytics\.track\("generate_lead"/);
  assert.match(tracking,/wrapped\.register=/);
  assert.match(tracking,/wrapped\.login=/);
  assert.match(tracking,/wrapped\.google=/);
  assert.match(verification,/PGIAnalytics\.track\("sign_up"/);
  assert.match(billing,/PGIAnalytics\.beginCheckout\(offer\)/);
  assert.doesNotMatch(billing,/PGIAnalytics\.track\("purchase"/);
});

test("the Google payload allowlist excludes direct identifiers",()=>{
  assert.match(tracking,/generate_lead:\["account_type","service_intent","lead_source"\]/);
  assert.match(tracking,/purchase:\["transaction_id","currency","value"\]/);
  for(const pii of ["email","phone","first_name","last_name","company_name","password"])assert.doesNotMatch(tracking,new RegExp("[\\\"']"+pii+"[\\\"']\\\\s*:"));
});
