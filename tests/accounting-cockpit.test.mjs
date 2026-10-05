import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(new URL("../"+file,import.meta.url),"utf8");
const index=read("index.html");
const app=read("assets/app.js");
const ui=read("assets/accounting-cockpit.js");
const css=read("assets/accounting-cockpit.css");
const api=read("assets/api-client.js");
const server=read("backend/server.mjs");
const postgres=read("backend/src/store-postgres.mjs");
const memory=read("backend/src/store-memory.mjs");
const worker=read("service-worker.js");
const build=read("scripts/build-static.mjs");

test("cockpit exposes a dedicated accounting view and black bottom dock",()=>{
  assert.match(index,/data-view="accounting"/);
  assert.match(index,/id="view-accounting"/);
  assert.match(index,/cockpit-bottom-dock/);
  assert.match(index,/>Comptabilité<\/strong>/);
  assert.match(css,/background:rgba\(2,3,5,\.96\)/);
  assert.match(app,/accounting:"Comptabilité"/);
  assert.match(app,/case "accounting"/);
});

test("accounting endpoint is private and backed by authoritative financial sources",()=>{
  assert.match(server,/\/api\/v1\/platform\/accounting/);
  assert.match(server,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
  assert.match(postgres,/async platformAccounting/);
  for(const token of ["subscription_billing_events","tenant_portability_requests","tenant_card_payment_requests","carrier_settlements","tenant_revenue_distributions","customer_referral_rewards"])assert.match(postgres,new RegExp(token));
  assert.match(postgres,/application_fee_minor/);
  assert.match(postgres,/platform_fee_ht/);
  assert.match(postgres,/provider_invoice_amount_paid_minor/);
  assert.match(memory,/audiotel-platform-accounting\/1/);
});

test("accounting UI separates PGI card commission from customer payment volume",()=>{
  assert.match(ui,/Seule la commission PGI/);
  assert.match(ui,/Marge SVA encaissée/);
  assert.match(ui,/Primes ambassadeurs à payer/);
  assert.match(ui,/Exporter CSV/);
  assert.match(postgres,/Cette vue est un pilotage comptable d’exploitation/);
  assert.doesNotMatch(ui,/volume_paid_minor[^\n]{0,80}Contribution PGI/);
});

test("accounting assets are published and cached",()=>{
  for(const file of ["assets/accounting-cockpit.js","assets/accounting-cockpit.css"]){
    assert.ok(build.includes(file),file);
    assert.ok(worker.includes(file),file);
  }
  assert.match(api,/platformAccounting:function/);
});
