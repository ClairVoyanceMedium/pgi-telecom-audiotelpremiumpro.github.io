import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/049_customer_profitability.sql","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const ui=fs.readFileSync("assets/customer-profitability.js","utf8");
const customerAdmin=fs.readFileSync("assets/customer-admin.js","utf8");
const detail=fs.readFileSync("assets/tenant-control-detail.js","utf8");

test("profitability uses the authoritative PGI commercial margin",()=>{
  assert.match(store,/tenant_revenue_distributions/);
  assert.match(store,/platform_fee_ht/);
  assert.match(store,/margin_booked_ht/);
  assert.match(store,/margin_collected_ht/);
  assert.match(store,/paid_amount_ht\/cs\.confirmed_amount_ht/);
  assert.match(store,/accounting_basis:"tenant_revenue_distributions\.platform_fee_ht"/);
  assert.match(store,/general_platform_overhead/);
  assert.match(store,/unconnected_subscription_cash/);
});

test("profitability never mixes currencies in the ranking",()=>{
  assert.match(store,/d\.currency=\$2/);
  assert.match(store,/currencies/);
  assert.match(store,/INVALID_CURRENCY/);
  assert.match(store,/PROFITABILITY_CURRENCY_NOT_FOUND/);
});

test("cockpit exposes top customers and per-customer profitability lazily",()=>{
  assert.match(server,/\/api\/v1\/platform\/customer-profitability/);
  assert.match(server,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
  assert.match(customerAdmin,/ca-profitability/);
  assert.match(customerAdmin,/customer-profitability\.js/);
  assert.match(detail,/td-profitability/);
  assert.match(detail,/mountTenantProfitability/);
  assert.match(ui,/Clients qui rapportent le plus/);
  assert.match(ui,/Marge PGI encaissée/);
  assert.match(ui,/Marge PGI comptabilisée/);
  assert.match(ui,/Répartition du reversement opérateur/);
});

test("profitability scan stays index-supported",()=>{
  assert.match(migration,/tenant_revenue_distributions_profitability_idx/);
  assert.match(migration,/currency,period_end DESC,tenant_id/);
  assert.match(migration,/INCLUDE \(platform_fee_ht,net_payout_ht,upstream_payout_ht,unallocated_amount_ht,upstream_settlement_id\)/);
});
