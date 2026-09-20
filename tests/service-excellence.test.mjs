import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [migration,store,workers,server,clientApi,adminApi,clientPortal,clientService,tenantDetail,tenantService,buildStatic,checkStatic,sizeCheck]=await Promise.all([
  readFile(new URL("../database/migrations/032_service_excellence.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/workers.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal-api.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/api-client.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-service-center.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/tenant-control-detail.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/tenant-service-admin.js",import.meta.url),"utf8"),
  readFile(new URL("../scripts/build-static.mjs",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-static.mjs",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-size.mjs",import.meta.url),"utf8")
]);

test("service excellence schema is additive, tenant scoped and traceable",()=>{
  for(const token of [
    "CREATE TABLE tenant_service_incidents",
    "CREATE TABLE tenant_service_incident_events",
    "CREATE TABLE tenant_service_incident_notes",
    "CREATE TABLE tenant_operational_alerts",
    "CREATE VIEW tenant_scoped_service_incidents",
    "CREATE VIEW tenant_scoped_service_incident_events",
    "CREATE VIEW tenant_scoped_service_incident_notes",
    "CREATE VIEW tenant_scoped_operational_alerts",
    "security_barrier=true"
  ])assert.ok(migration.includes(token),token);
  assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im);
  assert.match(migration,/diagnostic_snapshot jsonb/);
});

test("customer and PGI use one shared incident lifecycle",()=>{
  assert.match(server,/\/api\/v1\/customer\/incidents/);
  assert.match(server,/\/api\/v1\/platform\/tenants\/:id\/incidents/);
  assert.match(server,/\/api\/v1\/platform\/incidents\/:id\/status/);
  assert.match(server,/\/api\/v1\/platform\/incidents\/:id\/notes/);
  assert.match(clientApi,/createIncident:function/);
  assert.match(clientApi,/addIncidentNote:function/);
  assert.match(adminApi,/createServiceIncident:function/);
  assert.match(adminApi,/updateServiceIncident:function/);
  assert.match(adminApi,/addServiceIncidentNote:function/);
  assert.match(store,/async createCustomerServiceIncident/);
  assert.match(store,/async createTenantServiceIncident/);
  assert.match(store,/async updateServiceIncident/);
  assert.match(store,/async addCustomerServiceIncidentNote/);
  assert.match(store,/async addServiceIncidentNote/);
});

test("NOC incidents automatically create and resolve customer service cases",()=>{
  assert.match(workers,/scanTenantServiceIncidents/);
  assert.match(store,/async scanTenantServiceIncidents/);
  assert.match(store,/source_telecom_incident_id/);
  assert.match(store,/Incident réseau détecté automatiquement par PGI/);
  assert.match(store,/Incident réseau résolu automatiquement/);
  assert.match(store,/first_response_due/);
  assert.match(store,/resolution_due/);
});

test("routing simulation is explicitly dry run and never mutates destinations",()=>{
  const start=store.indexOf("async simulateTenantRoutingById");
  const end=store.indexOf("async scanTenantServiceIncidents",start);
  assert.ok(start>=0&&end>start);
  const source=store.slice(start,end);
  assert.match(source,/dry_run:true/);
  assert.match(source,/safe_to_activate/);
  assert.match(source,/FROM tenant_call_destinations/);
  assert.doesNotMatch(source,/UPDATE tenant_call_destinations/);
  assert.doesNotMatch(source,/INSERT INTO tenant_call_destinations/);
  assert.match(server,/customer\/routing\/simulate/);
  assert.match(server,/tenants\/:id\/routing\/simulate/);
});

test("automatic diagnostic snapshot excludes sensitive raw credentials",()=>{
  const start=store.indexOf("async function tenantDiagnosticSnapshot");
  const end=store.indexOf("function problem",start);
  assert.ok(start>=0&&end>start);
  const source=store.slice(start,end);
  assert.match(source,/calls_1h/);
  assert.match(source,/destinations/);
  assert.match(source,/automation_state/);
  assert.doesNotMatch(source,/rio_ciphertext|rio_fingerprint|caller_masked|caller_hash|authorization|password|token|secret/i);
});

test("service center remains lazy and outside the critical PWA shell",()=>{
  assert.match(clientPortal,/import\("\.\/client-service-center\.js"\)/);
  assert.match(tenantDetail,/tenant-service-admin\.js/);
  assert.match(clientService,/Centre de service|CENTRE DE SERVICE/);
  assert.match(tenantService,/Centre de service & incidents/);
  assert.match(buildStatic,/client-service-center\.js/);
  assert.match(buildStatic,/tenant-service-admin\.js/);
  assert.match(checkStatic,/client-service-center\.js/);
  assert.match(checkStatic,/tenant-service-admin\.js/);
  assert.match(sizeCheck,/client-service-center\.js/);
  assert.match(sizeCheck,/tenant-service-admin\.js/);
});
