import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {evaluateOperationalPolicy} from "../backend/src/operational-policy.mjs";

const migration=await readFile(new URL("../database/migrations/045_sva_ecosystem_compliance.sql",import.meta.url),"utf8");
const store=await readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8");
const server=await readFile(new URL("../backend/server.mjs",import.meta.url),"utf8");
const ui=await readFile(new URL("../assets/sva-compliance-center.js",import.meta.url),"utf8");
const commands=await readFile(new URL("../assets/command-palette.js",import.meta.url),"utf8");

test("SVA ecosystem registry covers the relevant French control frameworks",()=>{
  for(const token of [
    "regulatory_framework_registry","apnf_rsva","af2m_sva_2026","dgccrf_consumer","cnil_privacy",
    "af2m_33700","consumer_mediation","acpr_dsp2_scope","2026-09-01"
  ])assert.ok(migration.includes(token),token);
  assert.match(migration,/Presence does not imply certification, membership or approval/);
});

test("SVA evidence is append-only and conditional controls cannot be waived silently",()=>{
  for(const token of [
    "CREATE TABLE sva_ecosystem_evidence_events","pgi_sva_ecosystem_evidence_hash_chain",
    "sva_ecosystem_evidence_no_mutation","digest(","allow_not_applicable",
    "SVA ecosystem evidence ledger is append-only"
  ])assert.ok(migration.includes(token),token);
  assert.ok(store.includes("SVA_CONTROL_NOT_APPLICABLE_FORBIDDEN"));
  assert.ok(store.includes("SVA_NOT_APPLICABLE_REASON_REQUIRED"));
});

test("AF2M 2026 and RSVA guardrails are explicit and fail closed for new French activation",()=>{
  for(const token of [
    "per_call_price_ttc<=24","monthly_user_cap_ttc<=300","max_billable_duration_seconds<=1800",
    "mgit_duration_seconds BETWEEN 10 AND 20","mgit_tariff_first","mgit_optout_instruction",
    "mgit_no_background_music","mgit_beep_before_billing",
    "extract(day FROM effective_on)=1","created_at::date<=effective_on-7",
    "pgi_sva_ecosystem_ready","zzzzz_tenant_number_assignments_sva_ecosystem_gate"
  ])assert.ok(migration.includes(token),token);
  assert.match(migration,/Existing active lines are not suspended/);
  assert.match(migration,/does not declare anything to RSVA/);
});

test("Policy Engine blocks activation without the SVA ecosystem layer",()=>{
  const base={
    tenant_active:true,assignment_exists:true,subscription_active:true,payout_terms_ready:true,kyc_verified:true,
    regulatory_ready:true,arcep_2026_ready:true,destination_ready:true,operator_adapter_connected:true
  };
  const blocked=evaluateOperationalPolicy("activate_number",{...base,ecosystem_ready:false});
  assert.equal(blocked.decision,"BLOCKED");
  assert.ok(blocked.blockers.some(x=>x.code==="SVA_ECOSYSTEM_REQUIRED"));
  const allowed=evaluateOperationalPolicy("activate_number",{...base,ecosystem_ready:true});
  assert.equal(allowed.decision,"ALLOWED");
});

test("SVA Compliance Center stays private, lazy, evidence-based and non-certifying",()=>{
  for(const path of [
    "/api/v1/platform/sva-compliance",
    "/api/v1/platform/tenant-number-assignments/:id/sva-compliance-profile",
    "/api/v1/platform/tenant-number-assignments/:id/sva-compliance-evidence",
    "/api/v1/platform/tenant-number-assignments/:id/sva-tariff-change"
  ])assert.ok(server.includes(path),path);
  for(const token of ["svaComplianceOverview","upsertSvaServiceComplianceProfile","recordSvaEcosystemEvidence","planSvaTariffChange"])assert.ok(store.includes(token),token);
  assert.ok(commands.includes("sva-compliance"));
  assert.ok(commands.includes("import(SVA_URL)"));
  for(const token of ["SVA Compliance Center","AF2M","RSVA","Planifier sans déclarer au RSVA","Aucune déclaration RSVA envoyée","certification"])assert.ok(ui.includes(token),token);
  assert.ok(ui.includes("/platform/sva-compliance"));
});

test("Evidence Pack includes the SVA ecosystem chain without sensitive call data",()=>{
  for(const token of [
    "sva_ecosystem_profile","sva_ecosystem_control_states","sva_ecosystem_evidence_ledger",
    "ecosystem_chain_head","ecosystem_links_valid","ecosystem_evidence_events",
    "raw_rio_included:false","caller_numbers_included:false","call_content_included:false"
  ])assert.ok(store.includes(token),token);
});
