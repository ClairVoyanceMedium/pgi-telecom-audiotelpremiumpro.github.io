import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const admin=fs.readFileSync("assets/customer-admin.js","utf8");
const detail=fs.readFileSync("assets/tenant-control-detail.js","utf8");
const api=fs.readFileSync("assets/api-client.js","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const migration=fs.readFileSync("database/migrations/047_customer_360.sql","utf8");

test("Customer 360 exposes recent registrations without creating a public customer file",()=>{
  assert.match(admin,/NOUVELLES INSCRIPTIONS/);
  assert.match(admin,/created_since/);
  assert.match(admin,/ca-kpi-new/);
  assert.match(admin,/tenantDuplicateCandidates/);
  assert.match(api,/\/platform\/tenants\/duplicates/);
  assert.match(migration,/tenants_external_created_idx/);
  assert.match(migration,/tenants_external_billing_email_idx/);
});

test("Customer 360 enriches the dossier with real identities and signup metadata",()=>{
  assert.match(store,/metadata->>'phone' AS phone/);
  assert.match(store,/metadata->>'signup_source' AS signup_source/);
  assert.match(detail,/Identité & inscription/);
  assert.match(detail,/E-mail facturation/);
  assert.match(detail,/Dernière connexion/);
  assert.match(detail,/Inscrit /);
});

test("self-service registration blocks high-confidence duplicates",()=>{
  assert.match(store,/CUSTOMER_ACCOUNT_EXISTS/);
  assert.match(store,/CUSTOMER_REGISTRATION_EXISTS/);
  assert.match(store,/tenant_kyc_registration_lookup_idx|registration_country=\$1 AND k\.registration_number=\$2/);
});

test("administrative customer export is explicit, admin-only and audited",()=>{
  assert.match(server,/\/api\/v1\/platform\/tenants\/:id\/export/);
  assert.match(server,/platform\.tenant_admin_export/);
  assert.match(api,/tenantAdminExport/);
  assert.match(detail,/Exporter le dossier CSV/);
  const start=store.indexOf("async tenantAdminExport("),end=store.indexOf("async operationalPolicyEvaluation(",start);
  assert.ok(start>=0&&end>start);
  const exportMethod=store.slice(start,end);
  assert.match(exportMethod,/tenant\.admin_export/);
  assert.match(exportMethod,/schema_version:"audiotel-customer-admin-export\/1"/);
  assert.doesNotMatch(exportMethod,/password_hash|token_hash|credential_hash|public_key_spki/);
  const routeStart=server.indexOf('/api/v1/platform/tenants/:id/export');
  const routeSlice=server.slice(routeStart,routeStart+500);
  assert.match(routeSlice,/requireRole\(actor,\["admin"\]\)/);
  assert.match(routeSlice,/requireCsrf/);
});
