import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {loadConfig} from "../backend/src/config.mjs";

test("production config accepts Vercel Git commit SHA",()=>{
  const secret="x".repeat(48);
  const config=loadConfig({
    PGI_BACKEND_MODE:"production",
    PGI_AUTH_MODE:"session",
    PORT:"3000",
    DATABASE_URL:"postgresql://user:password@example.neon.tech/pgi?sslmode=require",
    VERCEL:"1",
    VERCEL_GIT_COMMIT_SHA:"b".repeat(40),
    PGI_STATIC_DIR:"/app/dist",
    PGI_SESSION_SECRET:secret,
    PGI_ADMIN_PASSWORD_HASH:"scrypt$16384$8$1$placeholder$placeholder",
    PGI_INGEST_TOKEN:secret,
    PGI_TELEPHONY_USER:"pgi-telephony",
    PGI_TELEPHONY_PASSWORD:secret,
    PGI_CALLER_HASH_KEY:secret,
    PGI_PORTABILITY_SECRET_KEY:secret
  });
  assert.equal(config.port,3000);
  assert.equal(config.releaseId,"b".repeat(40));
  assert.match(config.databaseUrl,/neon\.tech/);
  assert.equal(config.trustProxy,true);
  assert.equal(config.protectMachineEndpoints,true);
});

test("Vercel container is API-only and never migrates on cold start",()=>{
  const docker=fs.readFileSync("Dockerfile.vercel","utf8");
  const start=fs.readFileSync("scripts/start-vercel.sh","utf8");
  assert.ok(docker.includes('CMD ["sh","scripts/start-vercel.sh"]'));
  assert.match(docker,/ENV PGI_PROCESS_ROLE=api/);
  assert.match(docker,/ENV PGI_DATABASE_SSL=require/);
  assert.match(docker,/ENV PGI_TRUST_PROXY=true/);
  assert.match(docker,/ENV PGI_PROTECT_MACHINE_ENDPOINTS=true/);
  assert.ok(docker.includes("llms.txt llms-full.txt fa0a7deb5d60bdf1260c8174ad8c71db.txt"));
  assert.match(start,/VERCEL_GIT_COMMIT_SHA/);
  assert.match(start,/PGI_PROCESS_ROLE=api/);
  assert.match(start,/DATABASE_URL/);
  assert.match(start,/build-static\.mjs/);
  assert.doesNotMatch(start,/bootstrap-database\.mjs/);
  assert.doesNotMatch(start,/backend\/migrate\.mjs/);
  assert.doesNotMatch(docker,/DATABASE_PUBLIC_URL/);
  const build=fs.readFileSync("scripts/build-static.mjs","utf8");
  const server=fs.readFileSync("backend/server.mjs","utf8");
  assert.match(build,/audiotel-premium-pro\.com/);
  assert.match(build,/PGI_PUBLIC_BASE_URL/);
  assert.doesNotMatch(build,/VERCEL_PROJECT_PRODUCTION_URL|VERCEL_URL/);
  assert.match(build,/marketingRoot/);
  assert.match(build,/cockpit\.html/);
  assert.match(build,/Sitemap:/);
  assert.match(server,/pathname==="\/api\/v1\/ready"\)\{\s*authorizeMachineEndpoint\(req,config\)/);
  assert.match(server,/pathname==="\/metrics"\)\{\s*authorizeMachineEndpoint\(req,config\)/);
});
