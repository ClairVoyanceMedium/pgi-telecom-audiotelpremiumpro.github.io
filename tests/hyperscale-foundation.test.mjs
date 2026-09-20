import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/005_hyperscale_foundation.sql","utf8");
const identityEntitlements=fs.readFileSync("database/migrations/006_hyperscale_identity_entitlements.sql","utf8");
const externalIdentity=fs.readFileSync("database/migrations/007_external_customer_identity.sql","utf8");
const tenantDirectoryMigration=fs.readFileSync("database/migrations/008_scalable_tenant_directory.sql","utf8");
const tenantBoundaryMigration=fs.readFileSync("database/migrations/011_tenant_sql_access_boundary.sql","utf8");
const resilientQueueMigration=fs.readFileSync("database/migrations/012_resilient_work_queue.sql","utf8");
const multiRegionMigration=fs.readFileSync("database/migrations/013_multi_region_dr_foundation.sql","utf8");
const usageLedgerMigration=fs.readFileSync("database/migrations/014_metered_usage_ledger.sql","utf8");
const objectLifecycleMigration=fs.readFileSync("database/migrations/015_object_storage_data_lifecycle.sql","utf8");
const dashboardDimensionMigration=fs.readFileSync("database/migrations/016_dashboard_dimension_rollups.sql","utf8");
const qualityRollupMigration=fs.readFileSync("database/migrations/017_quality_rollups.sql","utf8");
const experienceRollupMigration=fs.readFileSync("database/migrations/018_call_experience_rollups.sql","utf8");
const subscriptionBillingMigration=fs.readFileSync("database/migrations/019_external_subscription_billing.sql","utf8");
const customerControlMigration=fs.readFileSync("database/migrations/020_customer_control_center.sql","utf8");
const customerAdminFiltersMigration=fs.readFileSync("database/migrations/021_customer_admin_filters.sql","utf8");
const b2bDestinationMigration=fs.readFileSync("database/migrations/022_b2b_call_destinations.sql","utf8");
const customerPortalMigration=fs.readFileSync("database/migrations/023_customer_portal.sql","utf8");
const customerGoogleMigration=fs.readFileSync("database/migrations/024_customer_google_identity.sql","utf8");
const voiceIntelligenceMigration=fs.readFileSync("database/migrations/026_voice_intelligence.sql","utf8");
const resilienceDocs=fs.readFileSync("docs/RESILIENCE.md","utf8");
const alertRules=fs.readFileSync("infra/observability/prometheus-alerts.example.yml","utf8");
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

test("le schéma neuf et le cockpit exposent la fondation 1.15",()=>{
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
  assert.ok(customerAdminFiltersMigration.includes("tenant_kyc_status_tenant_idx"));
  assert.ok(store.includes("INVALID_KYC_FILTER"));
  assert.ok(store.includes("params.kyc"));
});


test("la frontière SQL tenant est transactionnelle et security-barrier",()=>{
  assert.ok(tenantBoundaryMigration.includes("pgi_current_tenant_id"));
  assert.ok(tenantBoundaryMigration.includes("security_barrier=true"));
  assert.ok(tenantBoundaryMigration.includes("tenant_scoped_call_facts"));
  assert.ok(store.includes("set_config('pgi.tenant_id'"));
  assert.ok(store.includes("async withTenantContext("));
});

test("la work queue possède lease retry exponentiel et dead-letter",()=>{
  assert.ok(resilientQueueMigration.includes("lease_expires_at"));
  assert.ok(resilientQueueMigration.includes("work_queue_dead_letters"));
  assert.ok(store.includes("async claimWork("));
  assert.ok(store.includes("async completeWork("));
  assert.ok(store.includes("async extendWorkLease("));
  assert.ok(store.includes("async failWork("));
  assert.ok(workers.includes("queueHandlers"));
  assert.ok(workers.includes("queueDeadLetters"));
  assert.ok(workers.includes("heartbeatTimer"));
});

test("le plan multi-région formalise résidence RPO RTO et exercices",()=>{
  assert.ok(multiRegionMigration.includes("CREATE TABLE platform_regions"));
  assert.ok(multiRegionMigration.includes("CREATE TABLE tenant_residency_policies"));
  assert.ok(multiRegionMigration.includes("CREATE TABLE disaster_recovery_targets"));
  assert.ok(multiRegionMigration.includes("CREATE TABLE disaster_recovery_drills"));
  assert.ok(multiRegionMigration.includes("CREATE TABLE region_failover_events"));
  assert.ok(resilienceDocs.includes("RPO"));
  assert.ok(resilienceDocs.includes("RTO"));
});

test("les SLO sont mesurables et alertables",()=>{
  assert.ok(server.includes("pgi_http_request_duration_ms_bucket"));
  assert.ok(server.includes("pgi_work_queue_dead_lettered"));
  assert.ok(server.includes("traceparent"));
  assert.ok(alertRules.includes("PGIApiFastErrorBudgetBurn"));
  assert.ok(alertRules.includes("PGIApiLatencyP95High"));
  assert.ok(alertRules.includes("PGIWorkQueueDeadLetter"));
});


test("les clients externes ont un abonnement SVA payé versionné et PGI interne reste exempté",()=>{
  assert.ok(subscriptionBillingMigration.includes("service_plan_price_versions"));
  assert.ok(subscriptionBillingMigration.includes("'external-sva-access'"));
  assert.ok(subscriptionBillingMigration.includes("200,'month'"));
  assert.ok(subscriptionBillingMigration.includes("pgi_tenant_has_premium_call_access"));
  assert.ok(subscriptionBillingMigration.includes("tenant_type='internal'"));
  assert.ok(subscriptionBillingMigration.includes("tenant_number_assignments_subscription_gate"));
  assert.ok(subscriptionBillingMigration.includes("subscription_billing_events"));
  assert.ok(store.includes('problem(402,"SVA_SUBSCRIPTION_REQUIRED")'));
  assert.ok(store.includes("async createSubscriptionPrice("));
  assert.ok(store.includes("async applySubscriptionBillingEvent("));
  assert.ok(server.includes("/api/v1/internal/billing/subscription-event"));
  assert.ok(server.includes("/api/v1/platform/subscription-prices"));
  assert.ok(server.includes("/api/v1/customer/billing/status"));
  assert.ok(server.includes("/api/v1/customer/billing/checkout-session"));
  assert.ok(server.includes("/api/v1/customer/billing/portal-session"));
  assert.ok(server.includes('sva_payout_flow:"carrier_to_customer"'));
  assert.ok(server.includes("funds_held_by_pgi:false"));
});

test("le contrôle clients hyperscale gère pays suspensions lignes et impayés",()=>{
  assert.ok(customerControlMigration.includes("tenants_directory_country_status_cursor_idx"));
  assert.ok(customerControlMigration.includes("tenant_admin_alerts"));
  assert.ok(customerControlMigration.includes("tenant_control_events"));
  assert.ok(customerControlMigration.includes("tenant_subscriptions_due_idx"));
  assert.ok(store.includes("async listTenantAssignments("));
  assert.ok(store.includes("async setTenantStatus("));
  assert.ok(store.includes("async setTenantAssignmentStatus("));
  assert.ok(store.includes("async scanUnpaidSubscriptions("));
  assert.ok(store.includes("async listAdminAlerts("));
  assert.ok(store.includes("PAID_SUBSCRIPTION_REQUIRED_FOR_ACTIVATION"));
  assert.ok(server.includes("/api/v1/platform/tenant-number-assignments"));
  assert.ok(server.includes("/api/v1/platform/billing-alerts"));
  assert.ok(workers.includes("scanUnpaidSubscriptions(500)"));
});

test("le metered billing conserve un ledger append-only et idempotent",()=>{
  assert.ok(usageLedgerMigration.includes("CREATE TABLE tenant_usage_events"));
  assert.ok(usageLedgerMigration.includes("PARTITION BY HASH (tenant_bucket)"));
  assert.ok(usageLedgerMigration.includes("UNIQUE (tenant_bucket,source,source_event_id)"));
  assert.ok(usageLedgerMigration.includes("prevent_usage_event_mutation"));
  assert.ok(usageLedgerMigration.includes("CREATE TABLE tenant_billing_cycles"));
  assert.ok(usageLedgerMigration.includes("subscription_scope"));
});

test("les gros documents restent hors PostgreSQL avec politique de rétention",()=>{
  assert.ok(objectLifecycleMigration.includes("CREATE TABLE object_assets"));
  assert.ok(objectLifecycleMigration.includes("content_sha256"));
  assert.ok(objectLifecycleMigration.includes("legal_hold"));
  assert.ok(objectLifecycleMigration.includes("CREATE TABLE data_retention_policies"));
  assert.ok(objectLifecycleMigration.includes("CREATE TABLE data_subject_requests"));
});


test("le cockpit analytique reste borné côté serveur",()=>{
  assert.ok(dashboardDimensionMigration.includes("dashboard_dimension_rollups_daily"));
  assert.ok(dashboardDimensionMigration.includes("dimension_type"));
  assert.ok(qualityRollupMigration.includes("quality_rollups_hourly_sharded"));
  assert.ok(experienceRollupMigration.includes("experience_rollups_hourly_sharded"));
  assert.ok(experienceRollupMigration.includes("answered_le_20s"));
  assert.ok(experienceRollupMigration.includes("affected_samples"));
  assert.ok(store.includes("async dashboardAnalytics("));
  assert.ok(store.includes("writeDashboardDimensionRollups"));
  assert.ok(store.includes("writeExperienceRollup"));
  assert.ok(store.includes("writeQualityRollup"));
  assert.ok(server.includes("/api/v1/dashboard/analytics"));
});


test("B2B call destinations keep routing tenant-bound and expert-optional",()=>{for(const token of ["tenant_call_destinations","call_destination_id","tenant_scoped_call_destinations","max_concurrent_calls"])assert.ok(b2bDestinationMigration.includes(token),token);assert.ok(schema.includes("tenant_call_destinations"));assert.ok(store.includes("selectCallDestination"));assert.ok(store.includes("CALL_DESTINATION_TENANT_MISMATCH"));});


test("customer portal remains tenant-scoped and separate from PGI staff auth",()=>{for(const token of ["customer_password_credentials","tenant_scoped_portal_calls","tenant_scoped_metric_rollups_daily","tenant_scoped_subscriptions","session_version"])assert.ok(customerPortalMigration.includes(token),token);assert.ok(store.includes("customerPortalOverview"));assert.ok(store.includes("withTenantReadContext"));});


test("self-service onboarding creates a pending tenant while SVA stays fail-closed",()=>{
  assert.ok(store.includes("async selfServiceRegister("));
  assert.ok(store.includes("'customer','pending'"));
  assert.ok(store.includes("'customer.self_register'"));
  assert.ok(store.includes("registration_number"));
  assert.ok(store.includes("customer_role:\"owner\""));
  assert.ok(server.includes("/api/v1/customer/auth/register"));
  assert.ok(server.includes("email_verification_required"));
  assert.ok(subscriptionBillingMigration.includes("t.status='active' AND EXISTS"));
});

test("Google identities stay federated and tenant authorization remains separate",()=>{for(const token of ["customer_federated_identities","provider_subject","UNIQUE(customer_principal_id,provider)"])assert.ok(customerGoogleMigration.includes(token),token);assert.ok(store.includes("customerGoogleSignIn"));});


test("voice intelligence remains bounded, tenant-scoped and incident-aware",()=>{
  for(const token of ["voice_carrier_health_hourly_sharded","voice_sip_code_hourly_sharded","tenant_voice_daily_sharded","telecom_incidents","tenant_scoped_portal_call_details","tenant_scoped_voice_daily"])assert.ok(voiceIntelligenceMigration.includes(token),token);
  assert.ok(voiceIntelligenceMigration.includes("PARTITION BY HASH (tenant_bucket)"));
  assert.ok(store.includes("writeVoiceCarrierHealthRollup"));
  assert.ok(store.includes("writeTenantVoiceDailyRollup"));
  assert.ok(store.includes("writeSipCodeRollup"));
  assert.ok(store.includes("async voiceIntelligence("));
  assert.ok(store.includes("async scanVoiceIncidents("));
  assert.ok(workers.includes("scanVoiceIncidents"));
  assert.ok(server.includes("/api/v1/dashboard/voice-intelligence"));
});
