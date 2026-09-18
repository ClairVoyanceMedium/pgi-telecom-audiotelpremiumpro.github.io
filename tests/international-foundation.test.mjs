import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/004_international_market_foundation.sql","utf8");
const schema=fs.readFileSync("database/schema.sql","utf8");
const migrator=fs.readFileSync("backend/migrate.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const settlement=fs.readFileSync("backend/src/settlement-finance.mjs","utf8");
const app=fs.readFileSync("assets/app.js","utf8");
const index=fs.readFileSync("index.html","utf8");

test("la fondation internationale sépare clients et marchés",()=>{
  for(const token of [
    "CREATE TABLE operating_markets",
    "CREATE TABLE tenant_market_profiles",
    "CREATE TABLE carrier_market_capabilities",
    "CREATE TABLE carrier_connection_markets",
    "CREATE TABLE sva_number_aliases",
    "CREATE TABLE payment_compliance_market_profiles"
  ]) assert.ok(migration.includes(token),token);
  assert.ok(migration.includes("country_code char(2)"));
  assert.ok(migration.includes("default_currency char(3)"));
  assert.ok(migration.includes("default_locale text"));
  assert.ok(migration.includes("timezone text"));
});

test("France reste le seul marché activé automatiquement",()=>{
  assert.ok(migration.includes("'FR','France','active','EUR','fr-FR','Europe/Paris'"));
  assert.ok(!migration.includes("'BE','Belgique','active'"));
  assert.ok(!migration.includes("'CH','Suisse','active'"));
  assert.ok(!migration.includes("'GB','Royaume-Uni','active'"));
});

test("les numéros internationaux restent canoniques et aliasables",()=>{
  assert.ok(migration.includes("normalized_e164"));
  assert.ok(store.includes("sva_number_aliases"));
  assert.ok(store.includes("ORDER BY CASE WHEN sn.e164=$1 THEN 0"));
});

test("les CDR et écritures propagent marché et devise",()=>{
  assert.ok(migration.includes("ALTER TABLE calls"));
  assert.ok(migration.includes("ADD COLUMN market_id"));
  assert.ok(migration.includes("ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'"));
  assert.ok(store.includes("tenant_id,market_id,currency"));
  assert.ok(store.includes("financial_ledger(tenant_id,market_id,call_id,event_type,amount_ht,currency"));
  assert.ok(settlement.includes("currencyCode"));
  assert.ok(settlement.includes("market_id:marketId"));
});

test("le cockpit ne mélange pas les reversements multi-devises",()=>{
  assert.ok(store.includes("settlement_totals_by_currency"));
  assert.ok(store.includes("GROUP BY s.currency"));
  assert.ok(app.includes("moneyIn"));
  assert.ok(app.includes("currencyTotals.length>1"));
  assert.ok(index.includes('id="wh-markets-total"'));
  assert.ok(index.includes('id="wh-currency-count"'));
});

test("une base neuve pré-enregistre uniquement des migrations checksum-vérifiées",()=>{
  assert.ok(schema.includes("CREATE TABLE schema_bootstrap_migrations"));
  assert.ok(schema.includes("004_international_market_foundation"));
  assert.ok(migrator.includes("Bootstrap migration checksum mismatch"));
  assert.ok(migrator.includes("schema_bootstrap_migrations"));
});
