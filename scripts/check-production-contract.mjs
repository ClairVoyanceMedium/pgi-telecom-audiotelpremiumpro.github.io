import fs from "node:fs";
import {loadConfig} from "../backend/src/config.mjs";

const failures=[];
const compose=fs.readFileSync("infra/docker-compose.production.yml","utf8");
const runtime=fs.readFileSync("assets/config.production.example.js","utf8");
const envExample=fs.readFileSync("infra/production.env.example.txt","utf8");
const caddy=fs.readFileSync("infra/Caddyfile.production.example","utf8");
const preflight=fs.readFileSync("scripts/preflight.sh","utf8");
const deploy=fs.readFileSync(".github/workflows/deploy-production.yml","utf8");

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
if(!/@internalMachine path \/api\/v1\/internal\/\* \/api\/v1\/ingest\/freeswitch/.test(caddy))failures.push("public proxy must block internal machine endpoints");
if(!/handle @internalMachine\s*\{\s*respond 404/.test(caddy))failures.push("internal machine endpoints must not be publicly proxied");
if(!/PGI_REQUIRE_OPERATOR/.test(preflight))failures.push("preflight must separate operator go-live checks");
if(!/PGI_BACKEND_MODE/.test(preflight)||!/PGI_AUTH_MODE/.test(preflight))failures.push("preflight must validate backend production mode");
for(const name of requiredCompose){
  if(!preflight.includes("need_env "+name))failures.push("preflight missing "+name);
}
if(!/npm ci --ignore-scripts --no-audit --no-fund/.test(deploy))failures.push("production deploy must install locked dependencies");
if(!/npm run verify/.test(deploy))failures.push("production deploy must verify before publishing");


try{
  const secret="x".repeat(48);
  loadConfig({
    PGI_BACKEND_MODE:"production",
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
