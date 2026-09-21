import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/048_customer_internal_notes.sql","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const api=fs.readFileSync("assets/api-client.js","utf8");
const detail=fs.readFileSync("assets/tenant-control-detail.js","utf8");
const notesUi=fs.readFileSync("assets/customer-internal-notes.js","utf8");
const clientApi=fs.readFileSync("assets/client-portal-api.js","utf8");
const clientPortal=fs.readFileSync("assets/client-portal.js","utf8");

test("internal client notes are persistent, private and soft-archived",()=>{
  assert.match(migration,/CREATE TABLE tenant_internal_notes/);
  assert.match(migration,/body text NOT NULL CHECK \(char_length\(body\) BETWEEN 1 AND 2000\)/);
  assert.match(migration,/archived_at timestamptz/);
  assert.match(migration,/WHERE archived_at IS NULL/);
  assert.match(migration,/Never exposed to customer portal or public exports/);
});

test("internal note endpoints are admin-only and CSRF protected for writes",()=>{
  const listAt=server.indexOf('/api/v1/platform/tenants/:id/internal-notes');
  assert.ok(listAt>=0);
  const routes=server.slice(listAt,listAt+2200);
  assert.match(routes,/requireRole\(actor,\["admin"\]\)/);
  assert.match(routes,/requireCsrf\(req,actor,config\)/);
  assert.match(routes,/body_hash:createHash\("sha256"\)/);
  assert.match(routes,/tenant\.internal_note\.create/);
  assert.match(routes,/tenant\.internal_note\.archive/);
});

test("note bodies are not duplicated into audit or customer export",()=>{
  assert.match(store,/body_logged:false/);
  assert.match(store,/tenant\.internal_note\.create/);
  assert.match(store,/tenant\.internal_note\.archive/);
  const exportStart=store.indexOf("async tenantAdminExport(");
  const exportEnd=store.indexOf("async operationalPolicyEvaluation(",exportStart);
  const exportMethod=store.slice(exportStart,exportEnd);
  assert.doesNotMatch(exportMethod,/tenantInternalNotes|tenant_internal_notes|internal_notes/);
});

test("Customer 360 exposes notes while customer portal has no note capability",()=>{
  assert.match(api,/tenantInternalNotes/);
  assert.match(api,/addTenantInternalNote/);
  assert.match(api,/archiveTenantInternalNote/);
  assert.match(detail,/customer-internal-notes\.js/);
  assert.match(notesUi,/Notes internes/);
  assert.match(notesUi,/Privé • jamais visible par le client/);
  assert.match(notesUi,/data-internal-note-add/);
  assert.match(notesUi,/data-internal-note-archive/);
  assert.doesNotMatch(clientApi,/tenantInternalNotes|addTenantInternalNote|archiveTenantInternalNote|customer-internal-notes/);
  assert.doesNotMatch(clientPortal,/tenantInternalNotes|addTenantInternalNote|archiveTenantInternalNote|customer-internal-notes/);
});
