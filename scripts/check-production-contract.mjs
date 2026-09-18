import fs from "node:fs";
import {loadConfig} from "../backend/src/config.mjs";

const failures=[];
const compose=fs.readFileSync("infra/docker-compose.production.yml","utf8");
const runtime=fs.readFileSync("assets/config.production.example.js","utf8");
const envExample=fs.readFileSync("infra/production.env.example.txt","utf8");
const caddy=fs.readFileSync("infra/Caddyfile.production.example","utf8");
const preflight=fs.readFileSync("scripts/preflight.sh","utf8");
const deploy=fs.readFileSync(".github/workflows/deploy-production.yml","utf8");
const backendDeploy=fs.readFileSync(".github/workflows/deploy-backend-production.yml","utf8");
const backendRelease=fs.readFileSync("scripts/deploy-backend-release.sh","utf8");
const backupScript=fs.readFileSync("scripts/backup-postgres.sh","utf8");
const hostAudit=fs.readFileSync("scripts/host-audit.sh","utf8");
const auditService=fs.readFileSync("infra/systemd/pgi-host-audit.service.example","utf8");
const auditTimer=fs.readFileSync("infra/systemd/pgi-host-audit.timer.example","utf8");
const restoreDrill=fs.readFileSync("scripts/restore-drill.sh","utf8");
const migrationRunner=fs.readFileSync("backend/migrate.mjs","utf8");
const migrationSafety=fs.readFileSync("scripts/check-migrations.mjs","utf8");
const apiClient=fs.readFileSync("assets/api-client.js","utf8");
const buildStatic=fs.readFileSync("scripts/build-static.mjs","utf8");
const security=fs.readFileSync("backend/src/security.mjs","utf8");
const staticRelease=fs.readFileSync("scripts/static-release.sh","utf8");
const wholesaleMigration=fs.readFileSync("database/migrations/002_wholesale_multitenant_foundation.sql","utf8");
const wholesaleComplianceMigration=fs.readFileSync("database/migrations/003_wholesale_compliance_foundation.sql","utf8");
const hyperscaleMigration=fs.readFileSync("database/migrations/005_hyperscale_foundation.sql","utf8");
const identityEntitlementsMigration=fs.readFileSync("database/migrations/006_hyperscale_identity_entitlements.sql","utf8");
const externalIdentityMigration=fs.readFileSync("database/migrations/007_external_customer_identity.sql","utf8");
const tenantDirectoryMigration=fs.readFileSync("database/migrations/008_scalable_tenant_directory.sql","utf8");
const tenantBoundaryMigration=fs.readFileSync("database/migrations/011_tenant_sql_access_boundary.sql","utf8");
const resilientQueueMigration=fs.readFileSync("database/migrations/012_resilient_work_queue.sql","utf8");
const multiRegionMigration=fs.readFileSync("database/migrations/013_multi_region_dr_foundation.sql","utf8");
const usageLedgerMigration=fs.readFileSync("database/migrations/014_metered_usage_ledger.sql","utf8");
const objectLifecycleMigration=fs.readFileSync("database/migrations/015_object_storage_data_lifecycle.sql","utf8");
const dashboardDimensionMigration=fs.readFileSync("database/migrations/016_dashboard_dimension_rollups.sql","utf8");
const qualityRollupMigration=fs.readFileSync("database/migrations/017_quality_rollups.sql","utf8");
const workersSource=fs.readFileSync("backend/src/workers.mjs","utf8");
const resilienceDoc=fs.readFileSync("docs/RESILIENCE.md","utf8");
const prometheusAlerts=fs.readFileSync("infra/observability/prometheus-alerts.example.yml","utf8");
const hyperscaleDoc=fs.readFileSync("docs/HYPERSCALE.md","utf8");
const scaleHpa=fs.readFileSync("infra/scale/api-hpa.example.yaml","utf8");
const postgresStore=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const backendServer=fs.readFileSync("backend/server.mjs","utf8");
const wholesaleDoc=fs.readFileSync("docs/WHOLESALE-SVA.md","utf8");

const requiredCompose=[
  "POSTGRES_PASSWORD",
  "PGI_SESSION_SECRET",
  "PGI_ADMIN_PASSWORD_HASH",
  "PGI_INGEST_TOKEN",
  "PGI_TELEPHONY_USER",
  "PGI_TELEPHONY_PASSWORD",
  "PGI_CALLER_HASH_KEY"
];

for(const name of requiredCompose){
  if(!compose.includes(name+":"))failures.push("docker compose missing "+name);
  if(!envExample.includes(name+"="))failures.push("production env example missing "+name);
}

if(!/mode:\s*"production"/.test(runtime))failures.push("production runtime example must use production mode");
if(!/apiBaseUrl:\s*"\/api\/v1"/.test(runtime))failures.push("production runtime example must use same-origin /api/v1");
if(!/@internalMachine path \/api\/v1\/internal\/\* \/api\/v1\/ingest\/freeswitch \/api\/v1\/ready \/api\/v1\/ingest\/cdr/.test(caddy))failures.push("public proxy must block internal machine and ingest endpoints by default");
if(!/handle @internalMachine\s*\{\s*respond 404/.test(caddy))failures.push("internal machine endpoints must not be publicly proxied");
if(!/PGI_REQUIRE_OPERATOR/.test(preflight))failures.push("preflight must separate operator go-live checks");
if(!/PGI_BACKEND_MODE/.test(preflight)||!/PGI_AUTH_MODE/.test(preflight))failures.push("preflight must validate backend production mode");
for(const name of requiredCompose){
  if(!preflight.includes("need_env "+name))failures.push("preflight missing "+name);
}
if(!/npm ci --ignore-scripts --no-audit --no-fund/.test(deploy))failures.push("production deploy must install locked dependencies");
if(!/npm run verify/.test(deploy))failures.push("production deploy must verify before publishing");
if(/^\s{2}valkey:/m.test(compose))failures.push("default production stack must not start unused Valkey");
if(!/pg_restore --list/.test(backupScript))failures.push("backup must validate dump readability with pg_restore");
if(!/sha256sum --check/.test(backupScript))failures.push("backup must verify its checksum before success");
if(!/PGI_BACKUP_KEEP_COUNT/.test(backupScript)||!/Backup pruned/.test(backupScript))failures.push("backup tooling must enforce bounded retention");
if(!/api\/v1\/ready/.test(hostAudit)||!/pgi_cdr_lag_seconds/.test(hostAudit))failures.push("host audit must verify readiness and CDR freshness");
if(!/PGI_MAX_BACKUP_AGE_HOURS/.test(hostAudit)||!/sha256sum --check/.test(hostAudit))failures.push("host audit must verify backup age and checksum");
if(!/PGI_MIN_FREE_DISK_GB/.test(hostAudit)||!/pgi_outbox_pending/.test(hostAudit))failures.push("host audit must verify disk and outbox health");
if(!/PGI_REQUIRE_RELEASE_ALIGNMENT/.test(hostAudit)||!/front\/backend release mismatch/.test(hostAudit))failures.push("host audit must detect front/backend release drift");
if(!/host-audit\.sh/.test(auditService)||!/NoNewPrivileges=true/.test(auditService))failures.push("systemd host audit service must be hardened");
if(!/OnUnitActiveSec=5min/.test(auditTimer)||!/Persistent=true/.test(auditTimer))failures.push("host audit timer must run every five minutes and survive reboots");
if(!/pg_restore/.test(restoreDrill)||!/pgi_restore_drill_/.test(restoreDrill))failures.push("restore drill must restore into an isolated temporary database");
if(!/migrate:\s*[\s\S]*command: \["node","backend\/migrate\.mjs"\]/.test(compose))failures.push("production stack must run the migration service");
if(!/migrate:\s*\n\s*condition: service_completed_successfully/.test(compose))failures.push("production API must wait for successful migrations");
if(!/schema_migrations/.test(migrationRunner)||!/checksum/.test(migrationRunner))failures.push("migration runner must keep a checksum ledger");
if(!/destructive operation/.test(migrationSafety)||!/TRUNCATE/.test(migrationSafety)||!/ALTER TABLE RENAME/.test(migrationSafety))failures.push("automated migrations must have a destructive-operation denylist");
if(!/__Host-pgi_csrf/.test(apiClient))failures.push("frontend must use Host-only CSRF cookie");
if(!/__Host-pgi_session/.test(security)||!/__Host-pgi_csrf/.test(security))failures.push("backend must issue Host-only session cookies");
if(!/root \* \/srv\/pgi-dashboard\/current/.test(caddy))failures.push("production front must be served from the atomic current symlink");
if(!/static-release\.sh promote/.test(deploy)||!/static-release\.sh rollback/.test(deploy))failures.push("production deploy must support atomic promotion and rollback");
if(!/Smoke test public production/.test(deploy)||!/api\/v1\/health/.test(deploy))failures.push("production deploy must smoke-test the public front and API");
if(!/atomic_link/.test(staticRelease)||!/mv -Tf/.test(staticRelease))failures.push("static release switch must use atomic symlink replacement");
if(!/prune/.test(staticRelease)||!/previous/.test(staticRelease))failures.push("static release tooling must retain rollback state and prune old releases");
if(!/PGI_VPS_BACKEND_DEPLOY_ENABLED/.test(backendDeploy))failures.push("backend deployment must remain explicitly gated");
if(!/npm run verify/.test(backendDeploy))failures.push("backend deployment must verify repository before release");
if(!/backup-postgres\.sh/.test(backendRelease)||!/restore-drill\.sh/.test(backendRelease))failures.push("backend deployment must back up and restore-test PostgreSQL before migration");
if(!/api\/v1\/ready/.test(backendRelease)||!/wait_ready/.test(backendRelease))failures.push("backend deployment must gate promotion on strict readiness");
if(!/rollback_previous/.test(backendRelease))failures.push("backend deployment must support automatic application rollback");
if(!/PGI_RELEASE_ID="\$old_release"/.test(backendRelease)||!/wait_ready "\$old_version" "\$old_release"/.test(backendRelease))failures.push("backend rollback must restore the previous Git release identity");
if(!/PGI_PRODUCTION_URL/.test(backendDeploy)||!/api\/v1\/health/.test(backendDeploy))failures.push("backend deployment must verify the public API path after deployment");
if(!/PGI_RELEASE_ID/.test(buildStatic)||!/40-character Git SHA/.test(buildStatic))failures.push("front production build must require exact Git SHA");
if(!/PGI_RELEASE_ID/.test(deploy)||!/releaseId/.test(deploy))failures.push("front deployment must inject and verify the Git SHA");
if(!/PGI_RELEASE_ID/.test(backendRelease)||!/"release"/.test(backendRelease))failures.push("backend deployment must inject and verify the Git SHA");
if(!/lock_timeout/.test(migrationRunner)||!/statement_timeout/.test(migrationRunner))failures.push("migration runner must bound lock and statement time");
if(!/CREATE OR REPLACE behavioral object/.test(migrationSafety))failures.push("migration safety must preserve rollback-compatible behavioral objects");
if(!/CREATE TABLE tenants/.test(wholesaleMigration)||!/tenant_number_assignments/.test(wholesaleMigration)||!/tenant_settlements/.test(wholesaleMigration))failures.push("wholesale migration must preserve tenant, number assignment and settlement foundations");
if(!/tenant_kyc_profiles/.test(wholesaleComplianceMigration)||!/payment_compliance_profiles/.test(wholesaleComplianceMigration)||!/regulatory_assignor_carrier_id/.test(wholesaleComplianceMigration))failures.push("wholesale compliance migration must preserve KYC, payment and regulatory assignor controls");
if(!/SVA_NUMBER_NOT_ROUTABLE/.test(postgresStore)||!/EXPERT_TENANT_MISMATCH/.test(postgresStore)||!/tenant_id/.test(postgresStore))failures.push("PostgreSQL routing must remain tenant-bound");
if(!/SVA_ROUTING_CONTEXT_REQUIRED/.test(backendServer)||!/resolveTelephonyRoutingContext/.test(backendServer))failures.push("production telephony must require an SVA routing context");
if(!/\/api\/v1\/platform\/overview/.test(backendServer)||!/platform\.overview/.test(backendServer))failures.push("backend must expose the read-only wholesale overview");
if(!/wholesaleOverview/.test(apiClient))failures.push("frontend API client must expose the wholesale overview");
if(!/upstream_payout_ht/.test(postgresStore)||!/platform_fee_ht/.test(postgresStore)||!/net_payout_ht/.test(postgresStore))failures.push("wholesale overview must expose authoritative settlement totals");
if(!/DSP2/.test(wholesaleDoc)||!/opérateur attributaire/i.test(wholesaleDoc)||!/multi-éditeurs/i.test(wholesaleDoc))failures.push("wholesale roadmap must retain regulatory and payment-compliance boundaries");
if(!/PGI_PROCESS_ROLE/.test(compose)||!/PGI_PROCESS_ROLE=/.test(envExample))failures.push("production contract must expose the API/worker process role");
if(!/PGI_DATABASE_READ_URL/.test(compose)||!/PGI_DATABASE_READ_URL=/.test(envExample))failures.push("production contract must support an optional read replica");
if(!/CREATE TABLE data_clusters/.test(hyperscaleMigration)||!/CREATE TABLE routing_buckets/.test(hyperscaleMigration)||!/CREATE TABLE tenant_data_placement/.test(hyperscaleMigration))failures.push("hyperscale migration must preserve multi-cluster tenant placement");
if(!/CREATE TABLE call_facts/.test(hyperscaleMigration)||!/PARTITION BY HASH/.test(hyperscaleMigration)||!/CREATE TABLE worker_leases/.test(hyperscaleMigration)||!/CREATE TABLE work_queue/.test(hyperscaleMigration))failures.push("hyperscale migration must preserve partitioned facts and durable worker coordination");
if(!/CREATE TABLE service_plans/.test(identityEntitlementsMigration)||!/CREATE TABLE tenant_subscriptions/.test(identityEntitlementsMigration)||!/CREATE TABLE tenant_quota_policies/.test(identityEntitlementsMigration))failures.push("hyperscale customer foundation must preserve plans, subscriptions and quotas");
if(!/CREATE TABLE customer_principals/.test(externalIdentityMigration)||!/CREATE TABLE customer_tenant_memberships/.test(externalIdentityMigration))failures.push("external customer identities must remain isolated from PGI staff users");
if(!/tenants_slug_prefix_idx/.test(tenantDirectoryMigration)||!/tenants_display_name_prefix_idx/.test(tenantDirectoryMigration)||!/tenants_directory_cursor_idx/.test(tenantDirectoryMigration))failures.push("tenant directory must stay prefix-indexed and cursor-ready");
if(!/\/api\/v1\/platform\/tenants/.test(backendServer)||!/listTenants/.test(postgresStore))failures.push("backend must expose a scalable tenant directory");
if(!/security_barrier=true/.test(tenantBoundaryMigration)||!/tenant_scoped_call_facts/.test(tenantBoundaryMigration)||!/pgi_require_tenant_context/.test(tenantBoundaryMigration))failures.push("tenant SQL boundary must remain security-barrier scoped");
if(!/set_config\('pgi\.tenant_id'/.test(postgresStore)||!/withTenantContext/.test(postgresStore))failures.push("backend must set tenant SQL context transactionally");
if(!/work_queue_dead_letters/.test(resilientQueueMigration)||!/lease_expires_at/.test(resilientQueueMigration))failures.push("work queue must retain lease recovery and dead-letter storage");
if(!/claimWork/.test(postgresStore)||!/extendWorkLease/.test(postgresStore)||!/failWork/.test(postgresStore)||!/queueHandlers/.test(workersSource)||!/heartbeatTimer/.test(workersSource))failures.push("distributed queue runtime must retain explicit handlers, leases, heartbeats, retries and claims");
if(!/platform_regions/.test(multiRegionMigration)||!/tenant_residency_policies/.test(multiRegionMigration)||!/disaster_recovery_targets/.test(multiRegionMigration)||!/region_failover_events/.test(multiRegionMigration))failures.push("multi-region DR foundation must retain region, residency and failover controls");
if(!/traceparent/.test(backendServer)||!/pgi_http_request_duration_ms_bucket/.test(backendServer)||!/pgi_work_queue_dead_lettered/.test(backendServer))failures.push("backend must retain trace correlation, latency histograms and queue metrics");
if(!/PGIApiFastErrorBudgetBurn/.test(prometheusAlerts)||!/PGIWorkQueueDeadLetter/.test(prometheusAlerts))failures.push("Prometheus SLO rules must retain burn-rate and dead-letter alerts");
if(!/RPO/.test(resilienceDoc)||!/RTO/.test(resilienceDoc)||!/tenant_scoped_/.test(resilienceDoc))failures.push("resilience runbook must document DR targets and tenant SQL isolation");
if(!/tenant_usage_events/.test(usageLedgerMigration)||!/prevent_usage_event_mutation/.test(usageLedgerMigration)||!/tenant_billing_cycles/.test(usageLedgerMigration))failures.push("metered billing must retain immutable usage and billing-cycle foundations");
if(!/object_assets/.test(objectLifecycleMigration)||!/data_retention_policies/.test(objectLifecycleMigration)||!/data_subject_requests/.test(objectLifecycleMigration)||!/legal_hold/.test(objectLifecycleMigration))failures.push("object storage lifecycle must retain retention, privacy and legal-hold controls");
if(!/dashboard_dimension_rollups_daily/.test(dashboardDimensionMigration)||!/dimension_type/.test(dashboardDimensionMigration)||!/duration/.test(dashboardDimensionMigration))failures.push("dashboard analytics must retain bounded dimension rollups");
if(!/\/api\/v1\/dashboard\/analytics/.test(backendServer)||!/dashboardAnalytics/.test(postgresStore))failures.push("backend must expose scalable dashboard analytics");
if(!/analytics:function/.test(apiClient))failures.push("frontend API client must expose dashboard analytics");
if(!/quality_rollups_hourly_sharded/.test(qualityRollupMigration)||!/mos_sum/.test(qualityRollupMigration)||!/packet_loss_sum/.test(qualityRollupMigration))failures.push("quality analytics must retain bounded RTP rollups");
if(!/writeQualityRollup/.test(postgresStore)||!/quality:quality\[0\]/.test(postgresStore))failures.push("backend must write and expose scalable voice-quality aggregates");
for(const name of ["PGI_WORK_QUEUE_BATCH_SIZE","PGI_WORK_QUEUE_LEASE_SECONDS","PGI_WORK_QUEUE_RETRY_BASE_SECONDS","PGI_WORK_QUEUE_POLL_MS"]){
  if(!compose.includes(name+":"))failures.push("docker compose missing "+name);
  if(!envExample.includes(name+"="))failures.push("production env example missing "+name);
}
if(!/4096 tenant buckets/.test(hyperscaleDoc)||!/Control plane et data plane/.test(hyperscaleDoc))failures.push("hyperscale runbook must document bucket routing and plane separation");
if(!/autoscaling\/v2/.test(scaleHpa)||!/maxReplicas: 100/.test(scaleHpa))failures.push("hyperscale API example must retain horizontal autoscaling");



try{
  const secret="x".repeat(48);
  loadConfig({
    PGI_BACKEND_MODE:"production",
    PGI_RELEASE_ID:"0".repeat(40),
    PGI_AUTH_MODE:"session",
    PGI_SESSION_SECRET:secret,
    PGI_ADMIN_PASSWORD_HASH:"scrypt$16384$8$1$placeholder$placeholder",
    PGI_INGEST_TOKEN:secret,
    PGI_TELEPHONY_USER:"pgi-telephony",
    PGI_TELEPHONY_PASSWORD:secret,
    PGI_CALLER_HASH_KEY:secret,
    PGI_DATABASE_URL:"postgresql://user:password@postgres:5432/pgi_telecom",
    PGI_DATABASE_SSL:"disable"
  });
}catch(error){
  failures.push("production config contract rejected: "+error.message);
}

if(failures.length){
  failures.forEach(x=>console.error("FAIL:",x));
  process.exit(1);
}
console.log("Production contract: OK");
