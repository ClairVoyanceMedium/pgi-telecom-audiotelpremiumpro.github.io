import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [migration,priceMigration,store,memory,server,adminUi,productionCheck]=await Promise.all([
  readFile(new URL("../database/migrations/037_regulatory_trust_center.sql",import.meta.url),"utf8"),
  readFile(new URL("../database/migrations/038_subscription_price_300.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-memory.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../assets/platform-admin-tools.js",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-production-contract.mjs",import.meta.url),"utf8")
]);

test("regulatory trust center is fail closed and evidence is append only",()=>{
  for(const token of [
    "CREATE TABLE sva_regulatory_profiles",
    "CREATE TABLE platform_regulatory_controls",
    "CREATE TABLE sva_regulatory_evidence_events",
    "CREATE TABLE sva_abuse_cases",
    "pgi_sva_regulatory_ready",
    "verified regulatory trust profile required before external SVA activation",
    "regulatory assignor and upstream assignment reference required",
    "sva_regulatory_evidence_no_update",
    "digest(",
    "pg_advisory_xact_lock",
    "zzz_tenant_number_assignments_regulatory_gate"
  ])assert.ok(migration.includes(token),token);
  assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("regulatory readiness covers France SVA trust controls without claiming compliance",()=>{
  for(const token of [
    "numbering_rights","editor_identity","rsva","tariff_transparency","mgit",
    "complaint_process","fraud_monitoring","ce_identifier","apnf_rsva_access",
    "af2m_cgs","man_caller_authentication","fraud_route_traceability",
    "incident_notification","33700_process","'not_started'"
  ])assert.ok(migration.includes(token),token);
  assert.ok(migration.includes("France controls are created in a truthful not_started state"));
});

test("cockpit exposes regulatory trust evidence and abuse state",()=>{
  for(const token of ["regulatory_trust","numbers_ready","evidence_events","abuse_open","abuse_critical","platform_controls_verified"])assert.ok(store.includes(token),token);
  assert.ok(memory.includes("regulatory_trust"));
  assert.ok(adminUi.includes("Regulatory Trust Center"));
  assert.ok(adminUi.includes("Preuves chaînées"));
  assert.ok(adminUi.includes("Activation externe fail-closed"));
});


test("private regulatory operations are authenticated, idempotent and audited",()=>{
  for(const token of ["upsertSvaRegulatoryProfile","recordSvaRegulatoryEvidence","createSvaAbuseCase","regulatory.profile.update","regulatory.evidence.append","regulatory.abuse.open"])assert.ok(store.includes(token),token);
  for(const path of [
    "/api/v1/platform/tenant-number-assignments/:id/regulatory-profile",
    "/api/v1/platform/tenant-number-assignments/:id/regulatory-evidence",
    "/api/v1/platform/tenant-number-assignments/:id/abuse-cases"
  ])assert.ok(server.includes(path),path);
  assert.match(server,/requireRole\(actor,\["admin"\]\);requireCsrf/);
  assert.ok(store.includes("REGULATORY_EVIDENCE_REFERENCE_REQUIRED"));
  assert.ok(store.includes("INSERT INTO audit_log"));
  assert.ok(store.includes("INSERT INTO outbox_events"));
});

test("evidence pack is private, hashed, privacy-minimised and exportable",()=>{
  for(const token of ["regulatoryEvidencePack","audiotel-regulatory-evidence-pack/1","pack_sha256","evidence_links_valid","raw_rio_included:false","regulatory.evidence_pack.export"])assert.ok(store.includes(token),token);
  assert.ok(server.includes("/api/v1/platform/tenant-number-assignments/:id/regulatory-evidence-pack"));
  assert.ok(adminUi.includes("Evidence Pack"));
  assert.ok(adminUi.includes("evidence-pack-"));
});

test("current external subscription reference price is 3 EUR without rewriting the historical 2 EUR migration",()=>{
  assert.ok(priceMigration.includes("300"));
  assert.ok(priceMigration.includes("2026-09-20T19:33:00Z"));
  assert.ok(priceMigration.includes("pgi_publish_service_plan_price"));
  assert.ok(memory.includes("amount_minor:300"));
});

test("production verification protects regulatory trust center",()=>{
  assert.ok(productionCheck.includes("regulatoryTrustMigration"));
  assert.ok(productionCheck.includes("regulatory trust center"));
});
