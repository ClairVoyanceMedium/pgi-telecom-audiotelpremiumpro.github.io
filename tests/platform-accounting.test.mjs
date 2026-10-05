import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(file,"utf8");
const index=read("index.html");
const app=read("assets/app.js");
const accounting=read("assets/accounting-cockpit.js");
const server=read("backend/server.mjs");
const store=read("backend/src/store-postgres.mjs");
const build=read("scripts/build-static.mjs");
const palette=read("assets/command-palette.js");
const packageJson=JSON.parse(read("package.json"));

test("le cockpit expose une vraie vue Comptabilité dans la navigation principale et mobile",()=>{
  assert.match(index,/data-view="accounting"/);
  assert.match(index,/id="view-accounting"/);
  assert.match(index,/id="accounting-cockpit-root"/);
  assert.match(index,/<nav class="mobile-nav"[^>]*>[\s\S]*data-view="accounting"[\s\S]*<small>Comptabilité<\/small>/);
  assert.match(index,/mobile-sheet-grid[\s\S]*data-view="finance"[\s\S]*<strong>Finance<\/strong>/);
  assert.match(app,/accounting:"Comptabilité"/);
  assert.match(app,/import\("\.\/accounting-cockpit\.js"\)/);
  assert.match(app,/case "accounting":\s*renderAccounting\(\)/);
  assert.match(palette,/view-accounting/);
});

test("la comptabilité consolide uniquement des sources financières faisant foi",()=>{
  assert.match(server,/\/api\/v1\/platform\/accounting/);
  assert.match(server,/store\.platformAccounting\(params\)/);
  assert.match(store,/async platformAccounting\(params=\{\}\)/);
  for(const source of [
    "subscription_billing_events",
    "tenant_portability_requests",
    "tenant_card_payment_requests",
    "tenant_revenue_distributions",
    "carrier_settlements",
    "customer_referral_rewards"
  ])assert.ok(store.includes(source),source);
  assert.match(store,/provider_invoice_amount_paid_minor/);
  assert.match(store,/application_fee_minor/);
  assert.match(store,/platform_fee_ht/);
  assert.match(store,/paid_amount_ht\/cs\.confirmed_amount_ht/);
  assert.match(store,/tax_basis_separated:true/);
  assert.match(store,/no_fx_conversion:true/);
  assert.match(store,/statutory_ledger:false/);
});

test("la vue sépare TTC, HT, dettes et créances au lieu de fabriquer un faux bénéfice",()=>{
  for(const label of [
    "Abonnements encaissés TTC",
    "Portabilité prioritaire TTC",
    "Commissions paiement CB PGI",
    "Marge SVA encaissée HT",
    "Reversements clients payés HT",
    "Primes parrainage à verser",
    "Créances opérateurs HT",
    "12 mois de pilotage comptable"
  ])assert.ok(accounting.includes(label),label);
  assert.match(accounting,/bases fiscales/);
  assert.doesNotMatch(accounting,/bénéfice net/i);
  assert.match(accounting,/Exporter CSV/);
  assert.match(accounting,/data-acc-print/);
  assert.match(accounting,/window\.print\(\)/);
});

test("le module Comptabilité est publié et contrôlé à chaque vérification",()=>{
  assert.ok(build.includes('"assets/accounting-cockpit.js"'));
  assert.match(packageJson.scripts["check:js"],/assets\/accounting-cockpit\.js/);
  assert.match(packageJson.scripts["verify:vercel"],/platform-accounting\.test\.mjs/);
});
