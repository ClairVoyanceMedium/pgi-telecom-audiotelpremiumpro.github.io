import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [html,portal,customerApi,adminApi,adminUi,server,store,workers,migration,migrationTariff,migrationRio,migrationAutomation,identity,automation]=await Promise.all([
  readFile(new URL("../client.html",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal-api.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/api-client.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/tenant-portability-admin.js",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/workers.mjs",import.meta.url),"utf8"),
  readFile(new URL("../database/migrations/027_customer_number_portability.sql",import.meta.url),"utf8"),
  readFile(new URL("../database/migrations/028_portability_tariff_completion.sql",import.meta.url),"utf8"),
  readFile(new URL("../database/migrations/030_portability_rio_contract_boundary.sql",import.meta.url),"utf8"),
  readFile(new URL("../database/migrations/031_automatic_portability_orchestration.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/portability-identity.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/portability-automation.mjs",import.meta.url),"utf8")
]);

test("customer portability UI is wired end to end without changing the number",()=>{
  assert.match(html,/id="client-portability-form"/);
  assert.match(html,/id="portability-number"/);
  assert.match(html,/id="portability-rate"/);
  assert.match(html,/id="portability-rio"/);
  assert.match(html,/id="portability-source-contract"/);
  assert.match(portal,/client-portability\.js/);
  assert.match(customerApi,/createPortability/);
  assert.match(customerApi,/cancelPortability/);
  assert.match(store,/normalizePortabilityNumber/);
});

test("customer portability remains tenant scoped and fail closed",()=>{
  assert.match(server,/\/api\/v1\/customer\/portability/);
  assert.match(server,/requireCustomerCsrf/);
  assert.match(server,/customerSessionContext/);
  assert.match(migration,/tenant_id bigint NOT NULL REFERENCES tenants/);
  assert.match(migration,/ownership_status text NOT NULL DEFAULT 'pending'/);
  assert.match(migration,/status <> 'ported'/);
  assert.match(migration,/pgi_require_tenant_context/);
});

test("portability intake does not itself activate routing",()=>{
  assert.doesNotMatch(migration,/logical_carrier_routes/);
  assert.doesNotMatch(migration,/active_connection_id/);
  assert.match(html,/La demande ne coupe pas votre ligne actuelle/);
  assert.match(html,/sans transfert de ses obligations antérieures à PGI/);
});

test("French SVA port-in requires a verified encrypted RIO and never transfers the donor contract",()=>{
  assert.match(migrationRio,/rio_ciphertext bytea/);
  assert.match(migrationRio,/rio_validation_status text NOT NULL DEFAULT/);
  assert.match(migrationRio,/source_contract_transfer_mode text NOT NULL DEFAULT/);
  assert.match(migrationRio,/source_contract_liability_acknowledged boolean NOT NULL DEFAULT false/);
  assert.match(identity,/aes-256-gcm/);
  assert.match(identity,/normalizeFrenchSvaRio/);
  assert.match(store,/PORTABILITY_RIO_REQUIRED/);
  assert.match(store,/PORTABILITY_RIO_VERIFICATION_REQUIRED/);
  assert.match(store,/PORTABILITY_SOURCE_CONTRACT_ACK_REQUIRED/);
  assert.match(store,/tenant_scoped_portability_requests_v4/);
  assert.doesNotMatch(migrationRio,/CREATE\s+OR\s+REPLACE/i);
});

test("verified tariff is required and copied unchanged on completion",()=>{
  assert.match(migrationTariff,/tariff_verification_status text NOT NULL DEFAULT 'pending'/);
  assert.match(migrationTariff,/service_rate_ttc_per_min numeric\(10,6\)/);
  assert.match(migrationTariff,/tenant_portability_requests_ported_guard/);
  assert.match(migrationTariff,/status <> 'ported'/);
  assert.doesNotMatch(migrationTariff,/CREATE\s+OR\s+REPLACE/i);
  assert.match(store,/PORTABILITY_TARIFF_VERIFICATION_REQUIRED/);
  assert.match(store,/INSERT INTO sva_numbers\(e164,display_number,tariff_code,service_rate_ttc_per_min/);
  assert.match(store,/current\.tariff_code,rate/);
  assert.match(store,/public_tariff_locked:true/);
  assert.match(store,/tariff_preserved:true/);
});

test("port-in completion is a dedicated guarded atomic server action",()=>{
  assert.match(server,/\/api\/v1\/platform\/portability\/:id\/complete/);
  assert.match(adminApi,/completePortability:function/);
  assert.match(adminApi,/setPortabilityStatus:function/);
  assert.match(adminUi,/data-portability-complete/);
  assert.match(store,/PORTABILITY_USE_COMPLETION_ENDPOINT/);
  assert.match(store,/async completePortabilityRequest/);
  assert.match(store,/pgi_tenant_has_premium_call_access/);
  assert.match(store,/PORTABILITY_KYC_REQUIRED/);
  assert.match(store,/PORTABILITY_TARGET_ROUTE_NOT_ACTIVE/);
  assert.match(store,/PORTABILITY_CARRIER_CONTRACT_REQUIRED/);
  assert.match(store,/carrier_contracts/);
  assert.match(store,/INSERT INTO sva_numbers/);
  assert.match(store,/INSERT INTO tenant_number_assignments/);
  assert.match(store,/INSERT INTO number_carrier_assignments/);
  assert.match(store,/INSERT INTO number_portability_events/);
  assert.match(store,/portability\.completed/);
});

test("PGI automatically orchestrates operator portability with retries and recovery",()=>{
  assert.match(migrationAutomation,/automation_state text NOT NULL DEFAULT 'queued'/);
  assert.match(migrationAutomation,/portability_operator_events/);
  assert.match(migrationAutomation,/tenant_scoped_portability_requests_v4/);
  assert.doesNotMatch(migrationAutomation,/rio_ciphertext.*tenant_scoped_portability_requests_v4/s);
  assert.match(store,/INSERT INTO work_queue\(queue_name,tenant_id,dedupe_key,priority,payload,available_at,max_attempts\)/);
  assert.match(store,/async scanPortabilityAutomation/);
  assert.match(workers,/scanPortabilityAutomation/);
  assert.match(server,/createPortabilityQueueHandlers/);
  assert.match(automation,/createPortabilityQueueHandlers/);
  assert.match(automation,/PORTABILITY_OPERATOR_API_NOT_READY/);
  assert.match(automation,/portability_eligibility_url/);
  assert.match(automation,/portability_submit_url/);
  assert.match(automation,/portability_status_url/);
  assert.match(automation,/portability_cancel_url/);
  assert.match(automation,/decryptPortabilityCredential/);
  assert.match(automation,/sanitizePayload/);
  assert.match(automation,/store\.completePortabilityRequest/);
});
