import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [migration,store,memory,adminUi,clientUi,readme]=await Promise.all([
  readFile(new URL("../database/migrations/042_subscription_price_tax_inclusive.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-memory.mjs",import.meta.url),"utf8"),
  readFile(new URL("../assets/subscription-billing-ui.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-billing.js",import.meta.url),"utf8"),
  readFile(new URL("../README.md",import.meta.url),"utf8")
]);

test("subscription amount is explicitly tax inclusive",()=>{
  assert.ok(migration.includes("tax_behavior text NOT NULL DEFAULT 'inclusive'"));
  assert.ok(migration.includes("'customer_price_basis','TTC'"));
  assert.ok(migration.includes("3.00 EUR TTC/month"));
  assert.ok(migration.includes("subscription price tax behavior is immutable"));
  assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("billing API and demo expose inclusive tax behavior",()=>{
  for(const token of ["v.tax_behavior","tax_behavior:\"inclusive\""])assert.ok(store.includes(token),token);
  assert.ok(memory.includes('tax_behavior:"inclusive"'));
});

test("customer and admin interfaces display TTC explicitly",()=>{
  assert.ok(adminUi.includes("TTC/mois"));
  assert.ok(clientUi.includes("TTC / "));
  assert.ok(readme.includes("3,00 EUR TTC par mois"));
});
