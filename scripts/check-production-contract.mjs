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
const restoreDrill=fs.readFileSync("scripts/restore-drill.sh","utf8");
const migrationRunner=fs.readFileSync("backend/migrate.mjs","utf8");
const migrationSafety=fs.readFileSync("scripts/check-migrations.mjs","utf8");
const apiClient=fs.readFileSync("assets/api-client.js","utf8");
const buildStatic=fs.readFileSync("scripts/build-static.mjs","utf8");
const security=fs.readFileSync("backend/src/security.mjs","utf8");
const staticRelease=fs.readFileSync("scripts/static-release.sh","utf8");

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
