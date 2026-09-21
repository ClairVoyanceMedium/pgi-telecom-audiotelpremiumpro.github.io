import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/050_performance_resilience_lab.sql","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const ui=fs.readFileSync("assets/performance-resilience-lab.js","utf8");
const load=fs.readFileSync("scripts/performance-load.mjs","utf8");
const synthetic=fs.readFileSync("scripts/synthetic-probe.mjs","utf8");
const drill=fs.readFileSync("scripts/resilience-drill.mjs","utf8");
const restore=fs.readFileSync("scripts/restore-drill.sh","utf8");

test("Performance Lab stores measured evidence rather than capacity claims",()=>{
  assert.match(migration,/CREATE TABLE performance_lab_runs/);
  assert.match(migration,/CREATE TABLE synthetic_probe_results/);
  assert.match(store,/capacity_proof/);
  assert.match(store,/capacity_guaranteed:false/);
  assert.match(store,/LOAD_PROOF_MISSING/);
  assert.match(store,/SYNTHETIC_PROOF_MISSING/);
  assert.match(store,/RESTORE_DRILL_MISSING/);
});

test("load harness is safe by default and measures decision-grade percentiles",()=>{
  assert.match(load,/method:"GET"/);
  assert.match(load,/PGI_PERF_ALLOW_REMOTE/);
  assert.match(load,/p50_ms/);
  assert.match(load,/p95_ms/);
  assert.match(load,/p99_ms/);
  assert.match(load,/error_rate/);
  assert.match(load,/requests_per_second/);
});

test("synthetic and chaos drills stay bounded and evidence-oriented",()=>{
  assert.match(synthetic,/api\.health/);
  assert.match(synthetic,/api\.ready/);
  assert.match(synthetic,/Remote synthetic probes require HTTPS/);
  assert.match(drill,/expired lease takeover/);
  assert.match(drill,/dead-letter isolation/);
  assert.match(drill,/post-failure progress/);
  assert.match(restore,/observed_rpo_seconds/);
  assert.match(restore,/observed_rto_seconds/);
});

test("Control Tower shows proven throughput and explicit preproduction blockers",()=>{
  assert.match(ui,/Performance & Resilience Lab/);
  assert.match(ui,/PROUVÉ/);
  assert.match(ui,/Gate préproduction/);
  assert.match(ui,/PostgreSQL/);
  assert.match(ui,/Aucun chiffre de capacité n’est présenté comme garanti/);
  assert.match(server,/\/api\/v1\/platform\/performance-lab/);
  assert.match(server,/pgi_rate_limited_class_total/);
});
