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
const dataClient=fs.readFileSync("assets/data-client.js","utf8");
const commandPalette=fs.readFileSync("assets/command-palette.js","utf8");
const commandPaletteLoader=fs.readFileSync("assets/command-palette-loader.js","utf8");
const workspace=fs.readFileSync("assets/workspace.js","utf8");
const indexSource=fs.readFileSync("index.html","utf8");
const appSource=fs.readFileSync("assets/app.js","utf8");
const customerAdmin=fs.readFileSync("assets/customer-admin.js","utf8");
const platformAdminTools=fs.readFileSync("assets/platform-admin-tools.js","utf8");
const platformRegulatoryTools=fs.readFileSync("assets/platform-regulatory-tools.js","utf8");
const controlTowerUi=fs.readFileSync("assets/control-tower.js","utf8");
const operationalPolicySource=fs.readFileSync("backend/src/operational-policy.mjs","utf8");
const digitalTwinSource=fs.readFileSync("backend/src/digital-twin.mjs","utf8");
const serviceWorker=fs.readFileSync("service-worker.js","utf8");
const manifestSource=fs.readFileSync("manifest.webmanifest","utf8");
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
const b2bDestinationMigration=fs.readFileSync("database/migrations/022_b2b_call_destinations.sql","utf8");
const customerPortalMigration=fs.readFileSync("database/migrations/023_customer_portal.sql","utf8");
const customerGoogleMigration=fs.readFileSync("database/migrations/024_customer_google_identity.sql","utf8");
const voiceIntelligenceMigration=fs.readFileSync("database/migrations/026_voice_intelligence.sql","utf8");
const pgiRevenueMigration=fs.readFileSync("database/migrations/029_pgi_collected_revenue_distribution.sql","utf8");
const portabilityAutomationMigration=fs.readFileSync("database/migrations/031_automatic_portability_orchestration.sql","utf8");
const portabilityAutomationSource=fs.readFileSync("backend/src/portability-automation.mjs","utf8");
const serviceExcellenceMigration=fs.readFileSync("database/migrations/032_service_excellence.sql","utf8");
const serviceOperationsMigration=fs.readFileSync("database/migrations/033_service_operations_queue.sql","utf8");
const serviceIntegrityMigration=fs.readFileSync("database/migrations/034_service_incident_tenant_integrity.sql","utf8");
const regulatoryTrustMigration=fs.readFileSync("database/migrations/037_regulatory_trust_center.sql","utf8");
const subscriptionPrice300Migration=fs.readFileSync("database/migrations/038_subscription_price_300.sql","utf8");
const regulatoryEvidencePackExportMigration=fs.readFileSync("database/migrations/039_regulatory_evidence_pack_exports.sql","utf8");
const arcep2026Migration=fs.readFileSync("database/migrations/040_arcep_2026_number_guardrails.sql","utf8");
const arcep2026EvidencePackMigration=fs.readFileSync("database/migrations/041_arcep_2026_evidence_pack.sql","utf8");
const subscriptionTaxInclusiveMigration=fs.readFileSync("database/migrations/042_subscription_price_tax_inclusive.sql","utf8");
const regulatoryReviewMonitoringMigration=fs.readFileSync("database/migrations/043_regulatory_review_monitoring.sql","utf8");
const operationalAssuranceMigration=fs.readFileSync("database/migrations/044_operational_assurance.sql","utf8");
const svaEcosystemMigration=fs.readFileSync("database/migrations/045_sva_ecosystem_compliance.sql","utf8");
const premiumPlusSecurityMigration=fs.readFileSync("database/migrations/046_premium_plus_security.sql","utf8");
const customer360Migration=fs.readFileSync("database/migrations/047_customer_360.sql","utf8");
const customerInternalNotesMigration=fs.readFileSync("database/migrations/048_customer_internal_notes.sql","utf8");
const customerInternalNotesUi=fs.readFileSync("assets/customer-internal-notes.js","utf8");
const customerProfitabilityMigration=fs.readFileSync("database/migrations/049_customer_profitability.sql","utf8");
const customerProfitabilityUi=fs.readFileSync("assets/customer-profitability.js","utf8");
const performanceLabMigration=fs.readFileSync("database/migrations/050_performance_resilience_lab.sql","utf8");
const performanceLabUi=fs.readFileSync("assets/performance-resilience-lab.js","utf8");
const performanceLoad=fs.readFileSync("scripts/performance-load.mjs","utf8");
const syntheticProbe=fs.readFileSync("scripts/synthetic-probe.mjs","utf8");
const resilienceDrillScript=fs.readFileSync("scripts/resilience-drill.mjs","utf8");
const qualityWorkflow=fs.readFileSync(".github/workflows/quality.yml","utf8");
const webauthnSource=fs.readFileSync("backend/src/webauthn.mjs","utf8");
const premiumPlusUi=fs.readFileSync("assets/premium-plus.js","utf8");
const clientPremiumPlusUi=fs.readFileSync("assets/client-premium-plus.js","utf8");
const premiumPlusCore=fs.readFileSync("assets/premium-plus-core.js","utf8");
const passkeyClient=fs.readFileSync("assets/passkey-client.js","utf8");
const svaComplianceUi=fs.readFileSync("assets/sva-compliance-center.js","utf8");
const shadowBillingSource=fs.readFileSync("backend/src/shadow-billing.mjs","utf8");
const riskEngineSource=fs.readFileSync("backend/src/risk-engine.mjs","utf8");
const sloAssuranceSource=fs.readFileSync("backend/src/slo-assurance.mjs","utf8");
const controlTowerAssuranceUi=fs.readFileSync("assets/control-tower-assurance.js","utf8");
const clientServiceCenter=fs.readFileSync("assets/client-service-center.js","utf8");
const tenantServiceAdmin=fs.readFileSync("assets/tenant-service-admin.js","utf8");
const googleIdSource=fs.readFileSync("backend/src/google-id.mjs","utf8");
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
  "PGI_CALLER_HASH_KEY",
  "PGI_PORTABILITY_SECRET_KEY"
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
if(!/PGI_REQUIRE_CARRIER_CONTRACT:\s*\$\{PGI_REQUIRE_CARRIER_CONTRACT:-true\}/.test(compose))failures.push("production must require explicit carrier commercial terms by default");
if(!/PGI_PAYOUT_RATE_HT_PER_MIN:\s*\$\{PGI_PAYOUT_RATE_HT_PER_MIN:-0\}/.test(compose))failures.push("production must not use a fictional fallback carrier payout rate");
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
if(!/PGI_RELEASE_ID/.test(backendRelease)||!/expected_release/.test(backendRelease)||!/grep -F/.test(backendRelease))failures.push("backend deployment must inject and verify the Git SHA");
if(!/lock_timeout/.test(migrationRunner)||!/statement_timeout/.test(migrationRunner))failures.push("migration runner must bound lock and statement time");
if(!/CREATE OR REPLACE behavioral object/.test(migrationSafety))failures.push("migration safety must preserve rollback-compatible behavioral objects");
if(!/CREATE TABLE tenants/.test(wholesaleMigration)||!/tenant_number_assignments/.test(wholesaleMigration)||!/tenant_settlements/.test(wholesaleMigration))failures.push("wholesale migration must preserve tenant, number assignment and settlement foundations");
if(!/tenant_kyc_profiles/.test(wholesaleComplianceMigration)||!/payment_compliance_profiles/.test(wholesaleComplianceMigration)||!/regulatory_assignor_carrier_id/.test(wholesaleComplianceMigration))failures.push("wholesale compliance migration must preserve KYC, payment and regulatory assignor controls");
if(!/SVA_NUMBER_NOT_ROUTABLE/.test(postgresStore)||!/EXPERT_TENANT_MISMATCH/.test(postgresStore)||!/tenant_id/.test(postgresStore))failures.push("PostgreSQL routing must remain tenant-bound");
if(!/tenant_call_destinations/.test(b2bDestinationMigration)||!/call_destination_id/.test(b2bDestinationMigration)||!/tenant_scoped_call_destinations/.test(b2bDestinationMigration))failures.push("B2B destination migration must preserve tenant-bound call routing");
if(!/selectCallDestination/.test(postgresStore)||!/next-destination/.test(backendServer)||!/CALL_DESTINATION_TENANT_MISMATCH/.test(postgresStore))failures.push("B2B telephony routing must prefer tenant destinations and reject cross-tenant CDRs");
if(!/tenant_scoped_portal_calls/.test(customerPortalMigration)||!/tenant_scoped_metric_rollups_daily/.test(customerPortalMigration)||!/customer_password_credentials/.test(customerPortalMigration))failures.push("customer portal must remain tenant-scoped with separate customer credentials");
if(!/customer_federated_identities/.test(customerGoogleMigration)||!/provider_subject/.test(customerGoogleMigration))failures.push("Google identities must be stored as federated subjects");
if(!/RS256/.test(googleIdSource)||!/audienceMatches/.test(googleIdSource)||!/accounts\.google\.com/.test(googleIdSource))failures.push("Google ID tokens must be cryptographically validated server-side");
if(!/\/api\/v1\/customer\/portal/.test(backendServer)||!/customerPortalOverview/.test(postgresStore)||!/withTenantReadContext/.test(postgresStore))failures.push("customer portal must use a tenant-scoped read path");
if(!/\/api\/v1\/customer\/comparison/.test(backendServer)||!/customerPortalComparison/.test(postgresStore))failures.push("customer comparison must remain tenant-scoped");
if(!/INVALID_CALL_STATUS/.test(postgresStore)||!/min_duration/.test(postgresStore)||!/min_amount/.test(postgresStore))failures.push("customer call filters must be validated and server-side");
if(!/__Host-pgi_customer_session/.test(security)||!/__Host-pgi_customer_csrf/.test(security))failures.push("customer portal must use cookies isolated from PGI staff sessions");
if(!/tenants_external_created_idx/.test(customer360Migration)||!/tenant_kyc_registration_lookup_idx/.test(customer360Migration))failures.push("Customer 360 must keep indexed recent-signup and registration duplicate lookups");
if(!/\/api\/v1\/platform\/tenants\/duplicates/.test(backendServer)||!/tenantDuplicateCandidates/.test(apiClient))failures.push("Customer 360 must expose server-side duplicate detection");
if(!/\/api\/v1\/platform\/tenants\/:id\/export/.test(backendServer)||!/tenantAdminExport/.test(postgresStore)||!/tenant\.admin_export/.test(postgresStore))failures.push("Customer 360 exports must be admin-gated and audited");
if(!/NOUVELLES INSCRIPTIONS/.test(customerAdmin)||!/created_since/.test(customerAdmin))failures.push("Customer admin must surface recent self-service registrations");
if(!/CREATE TABLE tenant_internal_notes/.test(customerInternalNotesMigration)||!/archived_at timestamptz/.test(customerInternalNotesMigration)||!/Private PGI staff notes/.test(customerInternalNotesMigration))failures.push("Customer internal notes must stay private, persistent and soft-archivable");
if(!/\/api\/v1\/platform\/tenants\/:id\/internal-notes/.test(backendServer)||!/tenant-internal-notes\/:id\/archive/.test(backendServer)||!/\/platform\/tenants\//.test(customerInternalNotesUi)||!/internal-notes/.test(customerInternalNotesUi))failures.push("Customer internal notes must use dedicated lazy admin APIs");
if(!/body_logged:false/.test(postgresStore)||!/tenant\.internal_note\.create/.test(postgresStore)||!/tenant\.internal_note\.archive/.test(postgresStore))failures.push("Customer internal notes must be audited without copying note bodies");
if(!/Privé • jamais visible par le client/.test(customerInternalNotesUi)||!/customer-internal-notes\.js/.test(fs.readFileSync("assets/tenant-control-detail.js","utf8")))failures.push("Customer 360 must expose a clearly private internal-note module");
if(/customer-internal-notes|tenantInternalNotes|addTenantInternalNote|archiveTenantInternalNote/.test(fs.readFileSync("assets/client-portal-api.js","utf8")+fs.readFileSync("assets/client-portal.js","utf8")))failures.push("Customer portal must not expose internal-note APIs");
if(!/tenant_revenue_distributions_profitability_idx/.test(customerProfitabilityMigration)||!/INCLUDE \(platform_fee_ht,net_payout_ht,upstream_payout_ht/.test(customerProfitabilityMigration))failures.push("Customer profitability must keep an indexed authoritative margin path");
if(!/\/api\/v1\/platform\/customer-profitability/.test(backendServer)||!/customerProfitability/.test(postgresStore)||!/platform_fee_ht/.test(postgresStore)||!/paid_amount_ht\/cs\.confirmed_amount_ht/.test(postgresStore))failures.push("Customer profitability must use PGI margin and actual upstream paid ratio");
if(!/Marge PGI encaissée/.test(customerProfitabilityUi)||!/Clients qui rapportent le plus/.test(customerProfitabilityUi)||!/Répartition du reversement opérateur/.test(customerProfitabilityUi))failures.push("Customer cockpit must expose professional profitability ranking and composition");
if(!/general_platform_overhead/.test(postgresStore)||!/unconnected_subscription_cash/.test(postgresStore))failures.push("Profitability API must disclose excluded overhead and unconnected subscription cash");
if(!/CREATE TABLE performance_lab_runs/.test(performanceLabMigration)||!/CREATE TABLE synthetic_probe_results/.test(performanceLabMigration))failures.push("Performance Lab must persist measured load and synthetic evidence");
if(!/\/api\/v1\/platform\/performance-lab/.test(backendServer)||!/performanceResilienceLab/.test(postgresStore)||!/capacity_proof/.test(postgresStore)||!/preproduction_gate/.test(postgresStore))failures.push("Performance Lab must expose evidence-backed preproduction readiness");
if(!/PGI_HEAVY_READ_RATE_LIMIT_PER_MINUTE/.test(envExample)||!/PGI_WRITE_RATE_LIMIT_PER_MINUTE/.test(envExample)||!/routeClassRateLimit/.test(backendServer)||!/pgi_rate_limited_class_total/.test(backendServer))failures.push("Production must keep route-class saturation guards");
if(!/PGI_PERF_ALLOW_REMOTE=true/.test(performanceLoad)||!/method:"GET"/.test(performanceLoad)||!/p95_ms/.test(performanceLoad)||!/p99_ms/.test(performanceLoad))failures.push("Load harness must be opt-in for remote targets and measure p95/p99");
if(!/api\.health/.test(syntheticProbe)||!/api\.ready/.test(syntheticProbe)||!/https:\/\//.test(syntheticProbe))failures.push("Synthetic probe must validate health/readiness and require HTTPS remotely");
if(!/expired lease takeover/.test(resilienceDrillScript)||!/dead-letter isolation/.test(resilienceDrillScript)||!/post-failure progress/.test(resilienceDrillScript))failures.push("Resilience drill must validate lease takeover, dead-letter isolation and recovery");
if(!/Performance and resilience tool smoke/.test(qualityWorkflow)||!/npm run perf:load/.test(qualityWorkflow)||!/npm run resilience:drill/.test(qualityWorkflow))failures.push("Quality CI must execute Performance Lab smoke drills");
if(!/PROUVÉ/.test(performanceLabUi)||!/Gate préproduction/.test(performanceLabUi)||!/PostgreSQL/.test(performanceLabUi))failures.push("Control Tower must surface proven throughput and preproduction blockers");
if(!/observed_rpo_seconds/.test(restoreDrill)||!/observed_rto_seconds/.test(restoreDrill)||!/disaster_recovery_drills/.test(restoreDrill))failures.push("Restore drill must record observed RPO/RTO evidence");
if(!/PGIRouteClassRateLimiting/.test(prometheusAlerts))failures.push("Prometheus alerts must detect sustained saturation limiting");


if(!/CREATE TABLE webauthn_credentials/.test(premiumPlusSecurityMigration)||!/owner_type IN \('staff','customer'\)/.test(premiumPlusSecurityMigration)||!/customer_principal_id uuid REFERENCES customer_principals/.test(premiumPlusSecurityMigration))failures.push("Premium+ passkeys must keep staff and customer identities isolated");
if(!/WEBAUTHN_USER_VERIFICATION_REQUIRED/.test(webauthnSource)||!/WEBAUTHN_RP_ID_MISMATCH/.test(webauthnSource)||!/WEBAUTHN_SIGNATURE_INVALID/.test(webauthnSource)||!/timingSafeEqual/.test(webauthnSource))failures.push("WebAuthn must verify RP ID origin user verification signed state and assertion signature");
if(!/PGI_WEBAUTHN_RP_ID/.test(envExample)||!/PGI_WEBAUTHN_ORIGIN/.test(envExample)||!/PGI_WEBAUTHN_RP_ID/.test(compose)||!/PGI_WEBAUTHN_ORIGIN/.test(compose))failures.push("production contract must expose optional WebAuthn RP ID and HTTPS origin");
if(!/\/api\/v1\/security\/passkeys/.test(backendServer)||!/\/api\/v1\/customer\/security\/passkeys/.test(backendServer)||!/PASSKEY_REAUTH_REQUIRED/.test(backendServer))failures.push("staff and customer passkey enrollment must stay server-verified and password-reauthenticated");
if(!/navigator\.credentials\.create/.test(passkeyClient)||!/navigator\.credentials\.get/.test(passkeyClient))failures.push("browser passkey client must use the WebAuthn Credentials API");
if(!/Notifications/.test(premiumPlusUi)||!/Confort/.test(premiumPlusUi)||!/Qualité UX/.test(premiumPlusUi)||!/Sécurité/.test(premiumPlusUi))failures.push("admin Premium+ center must retain notifications accessibility security and UX quality");
if(!/Préférences/.test(clientPremiumPlusUi)||!/Confiance/.test(clientPremiumPlusUi)||!/pgi_client_locale/.test(fs.readFileSync("assets/client-i18n.js","utf8")))failures.push("client Premium+ must retain preferences Trust Center and explicit language choice");
if(!/beforeinstallprompt/.test(premiumPlusCore)||!/largest-contentful-paint/.test(premiumPlusCore)||!/layout-shift/.test(premiumPlusCore)||!/durationThreshold/.test(premiumPlusCore))failures.push("Premium+ must retain install UX and local Core Web Vitals measurement");

if(!/SVA_ROUTING_CONTEXT_REQUIRED/.test(backendServer)||!/resolveTelephonyRoutingContext/.test(backendServer))failures.push("production telephony must require an SVA routing context");
if(!/\/api\/v1\/platform\/overview/.test(backendServer)||!/platform\.overview/.test(backendServer))failures.push("backend must expose the read-only wholesale overview");
if(!/wholesaleOverview/.test(apiClient))failures.push("frontend API client must expose the wholesale overview");
if(!/upstream_payout_ht/.test(postgresStore)||!/platform_fee_ht/.test(postgresStore)||!/net_payout_ht/.test(postgresStore))failures.push("wholesale overview must expose authoritative settlement totals");
if(!/sva_regulatory_profiles/.test(regulatoryTrustMigration)||!/pgi_sva_regulatory_ready/.test(regulatoryTrustMigration)||!/zzz_tenant_number_assignments_regulatory_gate/.test(regulatoryTrustMigration))failures.push("regulatory trust center must fail closed before external SVA activation");
if(!/sva_regulatory_evidence_events/.test(regulatoryTrustMigration)||!/sva_regulatory_evidence_no_update/.test(regulatoryTrustMigration)||!/digest\(/.test(regulatoryTrustMigration))failures.push("regulatory trust center must retain append-only cryptographic evidence");
if(!/man_caller_authentication/.test(regulatoryTrustMigration)||!/fraud_route_traceability/.test(regulatoryTrustMigration)||!/33700_process/.test(regulatoryTrustMigration))failures.push("regulatory trust center must retain caller-authentication and abuse controls");
if(!/upsertSvaRegulatoryProfile/.test(postgresStore)||!/recordSvaRegulatoryEvidence/.test(postgresStore)||!/createSvaAbuseCase/.test(postgresStore)||!/regulatory-evidence/.test(backendServer))failures.push("regulatory trust center must retain private evidence and abuse operations");
if(!/regulatoryEvidencePack/.test(postgresStore)||!/regulatory-evidence-pack/.test(backendServer)||!/pack_sha256/.test(postgresStore)||!/raw_rio_included:false/.test(postgresStore))failures.push("regulatory trust center must retain privacy-minimised hashed evidence pack export");
if(!/sva_regulatory_evidence_pack_exports/.test(regulatoryEvidencePackExportMigration)||!/sva_regulatory_evidence_pack_exports_no_mutation/.test(regulatoryEvidencePackExportMigration)||!/append-only/.test(regulatoryEvidencePackExportMigration))failures.push("regulatory Evidence Pack exports must retain an immutable dedicated register");
if(!/ARCEP 2025-2215/.test(arcep2026Migration)||!/exclusive_stable_assignee/.test(arcep2026Migration)||!/single_service/.test(arcep2026Migration)||!/portability_offered/.test(arcep2026Migration)||!/tariff_ceiling/.test(arcep2026Migration))failures.push("ARCEP 2026 premium-number core guardrails must remain explicit");
if(!/caller_id_block/.test(arcep2026Migration)||!/parental_control_classification/.test(arcep2026Migration)||!/no_temporary_contact_use/.test(arcep2026Migration)||!/public_body_eligibility/.test(arcep2026Migration))failures.push("ARCEP 2026 misuse and 089/0895 controls must remain explicit");
if(!/pgi_arcep_2026_number_ready/.test(arcep2026Migration)||!/zzzz_tenant_number_assignments_arcep_2026_gate/.test(arcep2026Migration)||!/pg_advisory_xact_lock/.test(arcep2026Migration))failures.push("ARCEP 2026 activation gate must remain fail closed and concurrency safe");
if(!/sva_arcep_2026_evidence_events/.test(arcep2026Migration)||!/sva_arcep_2026_evidence_no_mutation/.test(arcep2026Migration)||!/digest\(/.test(arcep2026Migration))failures.push("ARCEP 2026 evidence must remain append-only and cryptographically chained");
if(!/arcep_2026_chain_head/.test(arcep2026EvidencePackMigration)||!/arcep_2026_links_valid/.test(arcep2026EvidencePackMigration)||!/arcep_2026_evidence_events/.test(arcep2026EvidencePackMigration))failures.push("Evidence Pack registry must retain ARCEP 2026 chain metadata");
if(!/arcep_2026_evidence_ledger/.test(postgresStore)||!/pgi_arcep_2026_number_ready/.test(postgresStore)||!/activation_ready/.test(postgresStore))failures.push("runtime and cockpit data must include ARCEP 2026 readiness and evidence");
if(!/CREATE TABLE regulatory_framework_registry/.test(svaEcosystemMigration)||!/apnf_rsva/.test(svaEcosystemMigration)||!/af2m_sva_2026/.test(svaEcosystemMigration)||!/dgccrf_consumer/.test(svaEcosystemMigration)||!/cnil_privacy/.test(svaEcosystemMigration)||!/acpr_dsp2_scope/.test(svaEcosystemMigration))failures.push("SVA compliance must retain explicit multi-framework governance without certification claims");
if(!/pgi_sva_ecosystem_ready/.test(svaEcosystemMigration)||!/zzzzz_tenant_number_assignments_sva_ecosystem_gate/.test(svaEcosystemMigration)||!/verified SVA ecosystem readiness required/.test(svaEcosystemMigration))failures.push("new French external SVA activation must remain fail closed on ecosystem readiness");
if(!/sva_ecosystem_evidence_events/.test(svaEcosystemMigration)||!/sva_ecosystem_evidence_no_mutation/.test(svaEcosystemMigration)||!/digest\(/.test(svaEcosystemMigration)||!/ecosystem_chain_head/.test(svaEcosystemMigration))failures.push("SVA ecosystem evidence must remain append-only, SHA-256 chained and exported");
if(!/per_call_price_ttc<=24/.test(svaEcosystemMigration)||!/monthly_user_cap_ttc<=300/.test(svaEcosystemMigration)||!/max_billable_duration_seconds<=1800/.test(svaEcosystemMigration)||!/mgit_duration_seconds BETWEEN 10 AND 20/.test(svaEcosystemMigration))failures.push("AF2M 2026 pricing and MGIT technical guardrails must remain explicit");
if(!/extract\(day FROM effective_on\)=1/.test(svaEcosystemMigration)||!/created_at::date<=effective_on-7/.test(svaEcosystemMigration))failures.push("RSVA tariff-change planning must retain first-of-month and seven-day lead-time guardrails");
if(!/svaComplianceOverview/.test(postgresStore)||!/recordSvaEcosystemEvidence/.test(postgresStore)||!/planSvaTariffChange/.test(postgresStore)||!/pgi_sva_ecosystem_ready/.test(postgresStore))failures.push("backend must expose SVA compliance, evidence and tariff planning");
if(!/\/api\/v1\/platform\/sva-compliance/.test(backendServer)||!/sva-compliance-profile/.test(backendServer)||!/sva-compliance-evidence/.test(backendServer)||!/sva-tariff-change/.test(backendServer))failures.push("private SVA Compliance Center APIs must remain available");
if(!/SVA Compliance Center/.test(svaComplianceUi)||!/AF2M/.test(svaComplianceUi)||!/RSVA/.test(svaComplianceUi)||!/DGCCRF/.test(commandPalette)||!/CNIL/.test(commandPalette)||!/Aucune déclaration RSVA envoyée/.test(svaComplianceUi))failures.push("cockpit must retain the lazy SVA multi-organism center and never pretend to declare externally");
if(!/SVA_ECOSYSTEM_REQUIRED/.test(operationalPolicySource)||!/ecosystem_ready/.test(operationalPolicySource))failures.push("Policy Engine must retain SVA ecosystem readiness before activation");
if(!/data-regulatory-open/.test(platformAdminTools)||!/platform-regulatory-tools\.js/.test(platformAdminTools))failures.push("cockpit must lazy-load the ARCEP 2026 evidence editor");
if(!/Conformité ARCEP 2026/.test(platformRegulatoryTools)||!/data-arcep-evidence-save/.test(platformRegulatoryTools)||!/cockpit_arcep_2026/.test(platformRegulatoryTools)||!/status==="verified"&&!reference/.test(platformRegulatoryTools))failures.push("cockpit must keep explicit manual ARCEP 2026 evidence controls and never auto-verify them");
if(!/CREATE TABLE regulatory_review_alerts/.test(regulatoryReviewMonitoringMigration)||!/review_schedule_missing/.test(regulatoryReviewMonitoringMigration)||!/review_due_today/.test(regulatoryReviewMonitoringMigration)||!/review_overdue/.test(regulatoryReviewMonitoringMigration)||!/control_blocking/.test(regulatoryReviewMonitoringMigration))failures.push("regulatory review monitoring must preserve persistent urgency states");
if(!/scanRegulatoryReviews/.test(postgresStore)||!/listRegulatoryReviewAlerts/.test(postgresStore)||!/acknowledgeRegulatoryReviewAlert/.test(postgresStore)||!/scanRegulatoryReviews\(1000\)/.test(workersSource))failures.push("regulatory review monitoring must remain active in the distributed alert worker");
if(!/\/platform\/regulatory-review-alerts/.test(backendServer)||!/data-regulatory-attention/.test(platformAdminTools)||!/Échéances réglementaires/.test(platformRegulatoryTools)||!/pa-arcep-next-review/.test(platformRegulatoryTools))failures.push("cockpit must expose actionable regulatory deadlines and next-review planning");
if(!/\/api\/v1\/platform\/control-tower/.test(backendServer)||!/controlTowerOverview/.test(postgresStore)||!/audiotel-control-tower\/2/.test(postgresStore))failures.push("production must retain the Control Tower aggregate");
if(!/\/api\/v1\/platform\/policy\/evaluate/.test(backendServer)||!/evaluateOperationalPolicy/.test(postgresStore)||!/BLOCKED/.test(operationalPolicySource)||!/ACTION_REQUIRED/.test(operationalPolicySource)||!/mutates_state:false/.test(operationalPolicySource))failures.push("Policy Engine must remain centralized, explainable and dry-run");
if(!/\/api\/v1\/platform\/digital-twin\/simulate/.test(backendServer)||!/simulateDigitalTwin/.test(postgresStore)||!/carrier_outage/.test(digitalTwinSource)||!/traffic_spike/.test(digitalTwinSource)||!/region_failure/.test(digitalTwinSource)||!/mutates_state:false/.test(digitalTwinSource))failures.push("Digital Twin must retain bounded dry-run operational scenarios");
if(!/Control Tower/.test(controlTowerUi)||!/Policy Engine/.test(controlTowerUi)||!/Digital Twin/.test(controlTowerUi)||!/AUCUN BRANCHEMENT EXTERNE/.test(controlTowerUi))failures.push("cockpit must retain the lazy premium Control Tower without pretending external connections exist");
if(!/CREATE TABLE platform_change_requests/.test(operationalAssuranceMigration)||!/CREATE TABLE platform_change_approval_events/.test(operationalAssuranceMigration)||!/approved_by<>requested_by/.test(operationalAssuranceMigration)||!/platform_change_requests_no_delete/.test(operationalAssuranceMigration)||!/append-only/.test(operationalAssuranceMigration))failures.push("critical changes must retain four-eyes control and immutable approval history");
if(!/staff_password_credentials/.test(operationalAssuranceMigration)||!/app_users_login_name_unique/.test(operationalAssuranceMigration))failures.push("PGI staff must retain distinct internal login identities");
if(!/staffLoginIdentity/.test(postgresStore)||!/ensureLegacyStaffIdentity/.test(postgresStore)||!/createStaffUser/.test(postgresStore))failures.push("backend must retain backward-compatible multi-staff authentication");
if(!/\/api\/v1\/platform\/staff-users/.test(backendServer)||!/password_sha256/.test(backendServer))failures.push("staff account administration must remain private and must not persist raw passwords in idempotency metadata");
if(!/Comptes staff PGI/.test(controlTowerAssuranceUi)||!/Mot de passe initial/.test(controlTowerAssuranceUi))failures.push("Control Tower must retain staff provisioning for four-eyes operation");
if(!/DUAL_CONTROL_APPROVAL_REQUIRED/.test(postgresStore)||!/FOUR_EYES_SECOND_APPROVER_REQUIRED/.test(postgresStore)||!/appendChangeApprovalEvent/.test(postgresStore))failures.push("carrier switch activation must retain independent four-eyes approval");
if(!/\/api\/v1\/platform\/change-requests/.test(backendServer)||!/change-requests\/:id\/approve/.test(backendServer)||!/change-requests\/:id\/reject/.test(backendServer))failures.push("private change-approval API must remain available");
if(!/audiotel-shadow-billing\/1/.test(shadowBillingSource)||!/external_settlement_required:true/.test(shadowBillingSource)||!/mutates_state:false/.test(shadowBillingSource))failures.push("shadow billing must remain currency-aware and non-mutating");
if(!/aggregate_only/.test(riskEngineSource)||!/mutates_state:false/.test(riskEngineSource)||!/FINANCIAL_VARIANCE_CRITICAL/.test(riskEngineSource))failures.push("Risk Engine must remain aggregate-only and non-mutating");
if(!/target_percent:99\.9/.test(sloAssuranceSource)||!/prometheus_burn_rate/.test(sloAssuranceSource)||!/current_percent:null/.test(sloAssuranceSource))failures.push("SLO snapshot must preserve the 99.9 target without inventing measured availability");
if(!/Risk Engine/.test(controlTowerAssuranceUi)||!/Shadow billing/.test(controlTowerAssuranceUi)||!/Validations 4 yeux/.test(controlTowerAssuranceUi))failures.push("Control Tower assurance center must expose risk SLO finance and four-eyes workflow");
for(const scenario of ["database_failure","worker_backlog","settlement_mismatch","hyperscale_growth"]){if(!digitalTwinSource.includes(scenario))failures.push("Digital Twin missing advanced scenario "+scenario);}
if(!/audiotel-digital-twin\/2/.test(digitalTwinSource)||!/mutates_state:false/.test(digitalTwinSource))failures.push("advanced Digital Twin must remain bounded and non-mutating");
if(!/pgi_publish_service_plan_price/.test(subscriptionPrice300Migration)||!/300/.test(subscriptionPrice300Migration)||!/3\.00 EUR\/month/.test(subscriptionPrice300Migration))failures.push("current external subscription reference price must remain versioned at 3 EUR/month");
if(!/tax_behavior text NOT NULL DEFAULT 'inclusive'/.test(subscriptionTaxInclusiveMigration)||!/3\.00 EUR TTC\/month/.test(subscriptionTaxInclusiveMigration)||!/customer_price_basis','TTC'/.test(subscriptionTaxInclusiveMigration))failures.push("external subscription price must remain explicitly tax-inclusive at the customer-facing layer");
if(!/tax_behavior IS DISTINCT FROM OLD\.tax_behavior/.test(subscriptionTaxInclusiveMigration)||!/subscription price tax behavior is immutable/.test(subscriptionTaxInclusiveMigration))failures.push("subscription tax behavior must remain immutable once published");
if(!/v\.tax_behavior/.test(postgresStore)||!/tax_behavior:"inclusive"/.test(postgresStore))failures.push("billing API must expose inclusive tax behavior");
if(!/tenant_payout_terms/.test(pgiRevenueMigration)||!/tenant_revenue_distributions/.test(pgiRevenueMigration)||!/pgi_collects/.test(pgiRevenueMigration))failures.push("production must retain PGI-collected SVA revenue distribution");
if(!/tenant_number_assignments_payout_terms_gate/.test(pgiRevenueMigration)||!/pgi_tenant_has_payout_terms/.test(pgiRevenueMigration))failures.push("external SVA activation must require PGI payout terms");
if(!/rebuildTenantRevenueDistributions/.test(postgresStore)||!/PORTABILITY_PAYOUT_TERMS_REQUIRED/.test(postgresStore))failures.push("carrier settlements and port-ins must enforce PGI revenue distribution");
if((postgresStore.match(/SVA_PAYOUT_TERMS_REQUIRED/g)||[]).length<2)failures.push("every external SVA routing path must require PGI payout terms");
if(!/sva_payout_flow:"carrier_to_pgi_to_customer"/.test(backendServer)||!/pgi_margin_retained:true/.test(backendServer))failures.push("backend contract must declare operator to PGI to client SVA flow");
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
if(!/automation_state/.test(portabilityAutomationMigration)||!/portability_operator_events/.test(portabilityAutomationMigration)||!/tenant_scoped_portability_requests_v4/.test(portabilityAutomationMigration))failures.push("portability automation migration must retain orchestration state, sanitized operator events and safe tenant view");
if(!/createPortabilityQueueHandlers/.test(portabilityAutomationSource)||!/scanPortabilityAutomation/.test(postgresStore)||!/createPortabilityQueueHandlers/.test(backendServer)||!/scanPortabilityAutomation/.test(workersSource))failures.push("portability must remain automatic through the distributed work queue");
if(!/sanitizePayload/.test(portabilityAutomationSource)||!/decryptPortabilityCredential/.test(portabilityAutomationSource)||!/PORTABILITY_OPERATOR_HTTPS_REQUIRED/.test(portabilityAutomationSource))failures.push("portability automation must protect RIO and operator credentials in production");
if(!/tenant_service_incidents/.test(serviceExcellenceMigration)||!/tenant_service_incident_events/.test(serviceExcellenceMigration)||!/tenant_service_incident_notes/.test(serviceExcellenceMigration)||!/tenant_operational_alerts/.test(serviceExcellenceMigration))failures.push("service excellence must retain one traceable customer incident lifecycle");
if(!/tenant_service_incidents_ops_queue_idx/.test(serviceOperationsMigration)||!/tenant_service_incident_attachments/.test(serviceOperationsMigration)||!/tenant_scoped_service_incident_attachments/.test(serviceOperationsMigration))failures.push("service operations must retain scalable queue indexes and provider-agnostic attachment linkage");
if(!/tenant_service_incident_events_tenant_fk/.test(serviceIntegrityMigration)||!/tenant_service_incident_notes_tenant_fk/.test(serviceIntegrityMigration)||!/tenant_service_incident_attachment_tenant_guard/.test(serviceIntegrityMigration))failures.push("service incident children must retain hard database tenant integrity");
if(!/security_barrier=true/.test(serviceExcellenceMigration)||!/tenant_scoped_service_incidents/.test(serviceExcellenceMigration)||!/tenant_scoped_operational_alerts/.test(serviceExcellenceMigration))failures.push("service excellence views must remain tenant scoped");
if(!/scanTenantServiceIncidents/.test(postgresStore)||!/scanTenantServiceIncidents/.test(workersSource)||!/source_telecom_incident_id/.test(postgresStore))failures.push("NOC incidents must remain automatically correlated to customer service cases");
if(!/listServiceIncidents/.test(postgresStore)||!/platform\/service-incidents/.test(backendServer)||!/serviceIncidentOutbox/.test(postgresStore))failures.push("service operations must retain a central queue and durable event outbox");
if(!/routing_unavailable/.test(postgresStore)||!/portability_attention/.test(postgresStore))failures.push("service operations must retain proactive routing and portability attention detection");
if(!/simulateTenantRoutingById/.test(postgresStore)||!/dry_run:true/.test(postgresStore)||!/routing\/simulate/.test(backendServer))failures.push("routing preview must remain a dry-run before real activation");
if(!/CENTRE DE SERVICE/.test(clientServiceCenter)||!/Dossier créé/.test(clientServiceCenter)||!/Centre de service & incidents/.test(tenantServiceAdmin))failures.push("customer and admin service-center interfaces must remain available");
if(!/platform_regions/.test(multiRegionMigration)||!/tenant_residency_policies/.test(multiRegionMigration)||!/disaster_recovery_targets/.test(multiRegionMigration)||!/region_failover_events/.test(multiRegionMigration))failures.push("multi-region DR foundation must retain region, residency and failover controls");
if(!/traceparent/.test(backendServer)||!/pgi_http_request_duration_ms_bucket/.test(backendServer)||!/pgi_work_queue_dead_lettered/.test(backendServer))failures.push("backend must retain trace correlation, latency histograms and queue metrics");
if(!/PGIApiFastErrorBudgetBurn/.test(prometheusAlerts)||!/PGIWorkQueueDeadLetter/.test(prometheusAlerts))failures.push("Prometheus SLO rules must retain burn-rate and dead-letter alerts");
if(!/pgi_service_incidents_open/.test(backendServer)||!/pgi_service_resolution_overdue/.test(backendServer)||!/pgi_routing_unavailable/.test(backendServer)||!/pgi_portability_attention/.test(backendServer))failures.push("Prometheus endpoint must expose service operations health");
if(!/PGIServiceCriticalIncident/.test(prometheusAlerts)||!/PGIServiceResolutionOverdue/.test(prometheusAlerts)||!/PGIRoutingUnavailable/.test(prometheusAlerts)||!/PGIPortabilityAttention/.test(prometheusAlerts))failures.push("Prometheus rules must alert on critical service operations conditions");
if(!/RPO/.test(resilienceDoc)||!/RTO/.test(resilienceDoc)||!/tenant_scoped_/.test(resilienceDoc))failures.push("resilience runbook must document DR targets and tenant SQL isolation");
if(!/tenant_usage_events/.test(usageLedgerMigration)||!/prevent_usage_event_mutation/.test(usageLedgerMigration)||!/tenant_billing_cycles/.test(usageLedgerMigration))failures.push("metered billing must retain immutable usage and billing-cycle foundations");
if(!/object_assets/.test(objectLifecycleMigration)||!/data_retention_policies/.test(objectLifecycleMigration)||!/data_subject_requests/.test(objectLifecycleMigration)||!/legal_hold/.test(objectLifecycleMigration))failures.push("object storage lifecycle must retain retention, privacy and legal-hold controls");
if(!/dashboard_dimension_rollups_daily/.test(dashboardDimensionMigration)||!/dimension_type/.test(dashboardDimensionMigration)||!/duration/.test(dashboardDimensionMigration))failures.push("dashboard analytics must retain bounded dimension rollups");
if(!/\/api\/v1\/dashboard\/analytics/.test(backendServer)||!/dashboardAnalytics/.test(postgresStore))failures.push("backend must expose scalable dashboard analytics");
if(!/analytics:function/.test(apiClient))failures.push("frontend API client must expose dashboard analytics");
if(!/\/api\/v1\/app\/bootstrap/.test(backendServer)||!/\/api\/v1\/dashboard\/bootstrap/.test(backendServer))failures.push("dashboard startup must retain consolidated bootstrap endpoints");
if(!/appBootstrap:function/.test(apiClient)||!/dashboardBootstrap:function/.test(apiClient))failures.push("frontend API client must retain bootstrap methods");
if(!/loadAppBootstrap/.test(dataClient)||!/loadDashboardBootstrap/.test(dataClient)||!/appBootstrapCache/.test(dataClient))failures.push("data client must retain bootstrap fallback and metadata cache");
if(!/maxPages=Math\.max\(1,Math\.min\(4/.test(dataClient))failures.push("CDR browser loading must remain hard-bounded");
if(!/scheduleProductionSync\("incremental"\)/.test(appSource)||!/mode==="dashboard"/.test(appSource)||!/document\.hidden/.test(appSource)||!/scheduledSyncMode=mergeSyncMode/.test(appSource))failures.push("realtime sync must remain incremental, priority-preserving and visibility-aware");
if(!/function renderActiveView/.test(appSource)||!/renderActiveView\(rows\)/.test(appSource))failures.push("dashboard must render only the active workspace");
if(!/pgi:command/.test(commandPalette)||!/ctrlKey\|\|e\.metaKey/.test(commandPalette))failures.push("universal command palette must retain keyboard access");
if(!/import\("\.\/command-palette\.js"\)/.test(commandPaletteLoader))failures.push("command palette must remain lazy-loaded through its shell loader");
if(serviceWorker.includes("assets/command-palette.js"))failures.push("full command palette must remain outside the PWA shell precache");
if(serviceWorker.includes("assets/cockpit-pro.js"))failures.push("advanced cockpit analytics must remain outside the PWA shell precache");
if(!/pgi_ui_preferences/.test(workspace)||!/pgi_operating_market/.test(workspace))failures.push("workspace preferences must remain persistent");
if(!manifestSource.includes("Cockpit / PGI Telecom • Audiotel Premium Pro")||!indexSource.includes('apple-mobile-web-app-title" content="Cockpit / PGI Telecom • Audiotel Premium Pro"'))failures.push("PWA must retain the exact cockpit install label");
for(const token of ["data-control-tower","data-sva-compliance","data-platform-admin"]){if(!indexSource.includes(token))failures.push("cockpit must expose visible admin center "+token);}
if(!/\[data-control-tower\]/.test(commandPaletteLoader)||!/\[data-sva-compliance\]/.test(commandPaletteLoader))failures.push("visible admin centers must lazy-load their tools directly");
for(const file of ["assets/data-client.js","assets/command-palette-loader.js","assets/workspace.js"]){
  if(!serviceWorker.includes(file))failures.push("PWA shell missing "+file);
}
if(serviceWorker.includes("assets/demo-data.js"))failures.push("demo generator must remain outside the PWA shell precache");
if(indexSource.includes('src="assets/demo-data.js"'))failures.push("demo generator must be loaded only on demand");
if(!/loadDemoCalls/.test(appSource))failures.push("demo mode must lazy-load its generator");
if(!/customer-admin\.css/.test(customerAdmin))failures.push("customer admin stylesheet must remain lazy-loaded");
if(serviceWorker.includes("assets/customer-admin.css"))failures.push("customer admin stylesheet must stay outside the critical shell");
if(!/quality_rollups_hourly_sharded/.test(qualityRollupMigration)||!/mos_sum/.test(qualityRollupMigration)||!/packet_loss_sum/.test(qualityRollupMigration))failures.push("quality analytics must retain bounded RTP rollups");
if(!/writeQualityRollup/.test(postgresStore)||!/quality:quality\[0\]/.test(postgresStore))failures.push("backend must write and expose scalable voice-quality aggregates");
if(!/voice_carrier_health_hourly_sharded/.test(voiceIntelligenceMigration)||!/tenant_voice_daily_sharded/.test(voiceIntelligenceMigration)||!/voice_sip_code_hourly_sharded/.test(voiceIntelligenceMigration)||!/telecom_incidents/.test(voiceIntelligenceMigration))failures.push("voice intelligence must retain scalable carrier, tenant, SIP and incident foundations");
if(!/writeVoiceCarrierHealthRollup/.test(postgresStore)||!/writeTenantVoiceDailyRollup/.test(postgresStore)||!/writeSipCodeRollup/.test(postgresStore)||!/scanVoiceIncidents/.test(postgresStore))failures.push("voice intelligence runtime writers and incident scanner are required");
if(!/\/api\/v1\/dashboard\/voice-intelligence/.test(backendServer)||!/voiceIntelligence:function/.test(apiClient))failures.push("voice intelligence must remain exposed to the admin cockpit");
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
    PGI_PORTABILITY_SECRET_KEY:secret,
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
