import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/057_subscription_revenue_recovery.sql","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const stripe=fs.readFileSync("backend/src/stripe-billing.mjs","utf8");
const portal=fs.readFileSync("assets/client-portal.js","utf8");
const config=fs.readFileSync("backend/src/config.mjs","utf8");

test("dunning separates strict provisioning from bounded established-call routing",()=>{
  assert.match(migration,/pgi_tenant_has_premium_routing_access/);
  assert.match(migration,/recovery_stage IN \('current','grace','retrying','suspended'\)/);
  assert.match(store,/pgi_tenant_has_premium_routing_access\(\$1,\$2,now\(\)\)/);
  assert.match(store,/pgi_tenant_has_premium_call_access\(\$1,NULL,now\(\)\)/);
  assert.match(store,/SVA_SUBSCRIPTION_REQUIRED/);
});

test("recovery defaults align with the Stripe Smart Retries window",()=>{
  assert.match(config,/PGI_DUNNING_GRACE_HOURS,72/);
  assert.match(config,/PGI_DUNNING_WINDOW_DAYS,14/);
  assert.match(store,/recovery_stage='current'/);
  assert.match(store,/recovery_stage='suspended'/);
  assert.match(store,/payment_attempt_count/);
  assert.match(store,/next_payment_attempt/);
});

test("Stripe retry telemetry and customer self-recovery are wired",()=>{
  assert.match(stripe,/invoice\.updated/);
  assert.match(stripe,/attempt_count/);
  assert.match(stripe,/next_payment_attempt/);
  assert.match(portal,/Régulariser mon paiement/);
  assert.match(portal,/relances automatiques en cours/);
});
