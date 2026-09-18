import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/005_hyperscale_foundation.sql","utf8");
const identityEntitlements=fs.readFileSync("database/migrations/006_hyperscale_identity_entitlements.sql","utf8");
const externalIdentity=fs.readFileSync("database/migrations/007_external_customer_identity.sql","utf8");
const tenantDirectoryMigration=fs.readFileSync("database/migrations/008_scalable_tenant_directory.sql","utf8");
const schema=fs.readFileSync("database/schema.sql","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const workers=fs.readFileSync("backend/src/workers.mjs","utf8");
const config=fs.readFileSync("backend/src/config.mjs","utf8");
const index=fs.readFileSync("index.html","utf8");
const app=fs.readFileSync("assets/app.js","utf8");
const hpa=fs.readFileSync("infra/scale/api-hpa.example.yaml","utf8");
const docs=fs.readFileSync("docs/HYPERSCALE.md","utf8");

test("le placement client est stable sur 4096 buckets",()=>{
  assert.ok(migration.includes("placement_bucket"));
  assert.ok(migration.includes("id % 4096"));
  assert.ok(migration.includes("generate_series(0,4095)"));
  assert.ok(migration.includes("CREATE TABLE routing_buckets"));
  assert.ok(migration.includes("CREATE TABLE tenant_data_placement"));
});

test("le data plane appels est partitionné",()=>{
  assert.ok(migration.includes("CREATE TABLE call_facts"));
  assert.ok(migration.includes("PARTITION BY HASH (tenant_bucket)"));
  assert.ok(migration.includes("FOR i IN 0..63 LOOP"));
  assert.ok(migration.includes("call_facts_started_brin"));
  assert.ok(store.includes("INSERT INTO call_facts("));
  assert.ok(store.includes("FROM call_facts"));
});

test("les traitements distribués ont une queue et des leases",()=>{
  assert.ok(migration.includes("CREATE TABLE worker_leases"));
  assert.ok(migration.includes("CREATE TABLE work_queue"));
  assert.ok(store.includes("acquireWorkerLease"));
  assert.ok(workers.includes('acquireWorkerLease("alerts"'));
  assert.ok(store.includes("FOR UPDATE SKIP LOCKED"));
});

test("API et workers peuvent évoluer indépendamment",()=>{
  assert.ok(config.includes('["all","api","worker"]'));
  assert.ok(server.includes('config.processRole==="api"'));
  assert.ok(server.includes("disabledWorkers"));
  assert.ok(hpa.includes("autoscaling/v2"));
  assert.ok(hpa.includes("maxReplicas: 100"));
});

test("une réplique de lecture peut être ajoutée sans changer le métier",()=>{
  assert.ok(config.includes("PGI_DATABASE_READ_URL"));
  assert.ok(store.includes("this.readSql"));
  assert.ok(store.includes("read_replica_enabled"));
});

test("le schéma neuf et le cockpit exposent la fondation 1.13",()=>{
  assert.ok(schema.includes("005_hyperscale_foundation"));
  assert.ok(schema.includes("8e4766de0773b9cc49e540514407feeba2a8405d7fcf3099dc3e91ab87942c69"));
  assert.ok(index.includes('id="wh-scale-buckets"'));
  assert.ok(app.includes("call_fact_partitions"));
  assert.ok(docs.includes("4096 buckets"));
});


test("les identités clients externes sont isolées du staff PGI",()=>{
  assert.ok(identityEntitlements.includes("CREATE TABLE identity_providers"));
  assert.ok(identityEntitlements.includes("CREATE TABLE service_accounts"));
  assert.ok(externalIdentity.includes("CREATE TABLE customer_principals"));
  assert.ok(externalIdentity.includes("CREATE TABLE customer_tenant_memberships"));
  assert.ok(externalIdentity.includes("authorization_version"));
  assert.ok(!externalIdentity.includes("REFERENCES app_users(id) ON DELETE CASCADE"));
});

test("les plans et quotas sont configurables sans code métier",()=>{
  assert.ok(identityEntitlements.includes("CREATE TABLE service_plans"));
  assert.ok(identityEntitlements.includes("CREATE TABLE plan_entitlements"));
  assert.ok(identityEntitlements.includes("CREATE TABLE tenant_subscriptions"));
  assert.ok(identityEntitlements.includes("CREATE TABLE tenant_quota_policies"));
  assert.ok(identityEntitlements.includes("CREATE TABLE tenant_usage_counters"));
  assert.ok(identityEntitlements.includes("PARTITION BY HASH (tenant_bucket)"));
});


test("l'annuaire client reste indexé et paginé à grande échelle",()=>{
  assert.ok(tenantDirectoryMigration.includes("tenants_slug_prefix_idx"));
  assert.ok(tenantDirectoryMigration.includes("tenants_display_name_prefix_idx"));
  assert.ok(tenantDirectoryMigration.includes("tenants_directory_cursor_idx"));
  assert.ok(store.includes("async listTenants(params={})"));
  assert.ok(store.includes("decodeNumericCursor"));
  assert.ok(server.includes("/api/v1/platform/tenants"));
});
