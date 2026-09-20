import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [html,portal,api,server,migration]=await Promise.all([
  readFile(new URL("../client.html",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/client-portal-api.js",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../database/migrations/027_customer_number_portability.sql",import.meta.url),"utf8")
]);

test("customer portability UI is wired end to end",()=>{
  assert.match(html,/id="client-portability-form"/);
  assert.match(html,/id="portability-number"/);
  assert.match(portal,/submitPortability/);
  assert.match(portal,/renderPortability/);
  assert.match(portal,/data-portability-cancel/);
  assert.match(api,/createPortability/);
  assert.match(api,/cancelPortability/);
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

test("portability request does not itself activate routing",()=>{
  assert.doesNotMatch(migration,/logical_carrier_routes/);
  assert.doesNotMatch(migration,/active_connection_id/);
  assert.match(html,/Aucune bascule n’est effectuée avant confirmation et planification opérateur/);
});
