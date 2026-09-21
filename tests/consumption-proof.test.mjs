import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(p,"utf8");
const migration=read("database/migrations/052_consumption_receipts.sql");
const store=read("backend/src/store-postgres.mjs");
const server=read("backend/server.mjs");
const client=read("assets/client-account-proof.js");
const admin=read("assets/tenant-consumption-check.js");
const clientHtml=read("client.html");

test("consumption receipts are immutable aggregate-only tenant evidence",()=>{
  assert.match(migration,/CREATE TABLE tenant_consumption_receipts/);
  assert.match(migration,/snapshot_sha256 char\(64\)/);
  assert.match(migration,/metric_ranges jsonb/);
  assert.match(migration,/WITH \(security_barrier=true\)/);
  assert.match(migration,/tenant_id=pgi_require_tenant_context\(\)/);
  assert.match(migration,/BEFORE UPDATE OR DELETE ON tenant_consumption_receipts/);
  assert.match(migration,/tenant consumption receipts are immutable/);
  assert.match(migration,/aggregate evidence only/);
  assert.doesNotMatch(migration,/caller_number\s+(text|varchar)|caller_hash\s+(text|varchar)|card_number|cvv|cvc/i);
});

test("receipt hash freezes exact dashboard range baselines and financial aggregates",()=>{
  assert.match(store,/CONSUMPTION_RECEIPT_SCHEMA="audiotel-consumption-receipt\/1"/);
  for(const key of ["calls_total","calls_connected","calls_abandoned","calls_failed","billable_seconds","generated_revenue_ttc","net_payout_ht"])assert.ok(store.includes(key),key);
  assert.match(store,/normalizeConsumptionRanges/);
  assert.match(store,/snapshot_sha256/);
  assert.match(store,/createHash\("sha256"\)/);
  assert.match(store,/effectiveMetricRanges\(new Date\(start\)\.toISOString\(\),new Date\(end\)\.toISOString\(\),id\)/);
  assert.match(store,/customerPortalOverview\(Number\(tenant\.id\),from,to,row\.metric_ranges\)/);
  assert.match(store,/status:currentHash===row\.snapshot_sha256&&differences\.length===0\?"match":"difference"/);
  assert.match(store,/authoritative_call_facts_and_validated_tenant_distributions/);
});

test("customer creates its own receipt while staff reconciliation remains role-gated",()=>{
  const customerAt=server.indexOf('/api/v1/customer/consumption-receipts');
  assert.ok(customerAt>=0);
  const customerSlice=server.slice(customerAt,customerAt+1800);
  assert.match(customerSlice,/requireActor\(customerActor\)/);
  assert.match(customerSlice,/requireCustomerCsrf\(req,customerActor,config\)/);
  assert.match(customerSlice,/idempotent/);
  assert.match(customerSlice,/createCustomerConsumptionReceipt/);

  const adminAt=server.indexOf('/api/v1/platform/tenants/:id/consumption-receipts');
  assert.ok(adminAt>=0);
  const adminSlice=server.slice(adminAt,adminAt+1600);
  assert.match(adminSlice,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
  assert.match(adminSlice,/reconcileTenantConsumptionReceipt/);
});

test("client exposes validated assigned number and support proof without raw CDR data",()=>{
  assert.match(clientHtml,/PGI Telecom/);
  assert.match(clientHtml,/Audiotel Premium Pro/);
  assert.doesNotMatch(clientHtml,/PGI • Telecom - Audiotel Premium Pro/);
  assert.match(client,/String\(x\.assignment_status\|\|x\.status\)===\"active\"/);
  assert.match(client,/String\(x\.kyc_status\)===\"verified\"/);
  assert.match(client,/VOTRE NUMÉRO AUDIOTEL VALIDÉ/);
  assert.match(client,/Copier le numéro/);
  assert.match(client,/Créer un relevé horodaté/);
  assert.match(client,/empreinte SHA‑256/);
  assert.doesNotMatch(client,/caller_number|caller_hash|\bpan\b|\bcvv\b|\bcvc\b/i);
  assert.match(admin,/CONFORME/);
  assert.match(admin,/ÉCART DÉTECTÉ/);
  assert.match(admin,/Copier le récapitulatif support/);
});
