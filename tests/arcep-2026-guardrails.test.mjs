import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [migration,packMigration,store,adminUi,regulatoryUi,productionCheck,doc]=await Promise.all([
  readFile(new URL("../database/migrations/040_arcep_2026_number_guardrails.sql",import.meta.url),"utf8"),
  readFile(new URL("../database/migrations/041_arcep_2026_evidence_pack.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../assets/platform-admin-tools.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/platform-regulatory-tools.js",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-production-contract.mjs",import.meta.url),"utf8"),
  readFile(new URL("../docs/REGULATORY-TRUST.md",import.meta.url),"utf8")
]);

test("ARCEP 2026 guardrails cover the current premium-number invariants",()=>{
  for(const token of [
    "ARCEP 2025-2215",
    "exclusive_stable_assignee",
    "single_service",
    "portability_offered",
    "tariff_ceiling",
    "no_temporary_contact_use",
    "public_body_eligibility",
    "caller_id_block",
    "parental_control_classification",
    "^33(81|82|89)",
    "^33895",
    "pgi_arcep_2026_number_ready",
    "zzzz_tenant_number_assignments_arcep_2026_gate"
  ])assert.ok(migration.includes(token),token);
});

test("ARCEP 2026 activation remains fail closed and concurrency safe",()=>{
  assert.ok(migration.includes("verified ARCEP 2026 number-plan guardrails required"));
  assert.ok(migration.includes("exclusive stable assignee rule blocks multiple active assignments"));
  assert.ok(migration.includes("pg_advisory_xact_lock"));
  assert.ok(migration.includes("status='active'"));
  assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("ARCEP 2026 evidence remains append only and cryptographically chained",()=>{
  for(const token of [
    "sva_arcep_2026_evidence_events",
    "digest(",
    "previous_hash",
    "event_hash",
    "sva_arcep_2026_evidence_no_mutation",
    "append-only"
  ])assert.ok(migration.includes(token),token);
  assert.ok(migration.includes("status<>'verified'"));
  assert.ok(migration.includes("evidence_reference"));
});

test("regulatory documentation references the effective 2026 guardrails",()=>{
  assert.ok(doc.includes("2025-2215"));
  assert.ok(doc.includes("0895"));
  assert.ok(doc.includes("identifiant de l’appelant"));
  assert.ok(doc.includes("portabilité"));
});

test("ARCEP 2026 state is carried into the Evidence Pack and cockpit",()=>{
  for(const token of ["arcep_2026_chain_head","arcep_2026_links_valid","arcep_2026_evidence_events"])assert.ok(packMigration.includes(token),token);
  for(const token of ["arcep_2026_evidence_ledger","arcep_2026_ready","activation_ready","sva_arcep_2026_evidence_events"])assert.ok(store.includes(token),token);
  assert.ok(adminUi.includes("ARCEP 2026"));
  assert.ok(adminUi.includes("activation_ready"));
  assert.ok(adminUi.includes("data-regulatory-open"));
  assert.ok(adminUi.includes('import("./platform-regulatory-tools.js")'));
  for(const token of ["Conformité ARCEP 2026","data-arcep-evidence-save","recorded_from:\"cockpit_arcep_2026\"","Aucun contrôle n’est validé automatiquement"])assert.ok(regulatoryUi.includes(token),token);
  assert.ok(regulatoryUi.includes("status===\"verified\"&&!reference"));
  assert.ok(productionCheck.includes("arcep2026Migration"));
  assert.ok(productionCheck.includes("ARCEP 2026 activation gate"));
});
