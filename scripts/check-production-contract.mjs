import fs from "node:fs";
import {loadConfig} from "../backend/src/config.mjs";

const failures=[];
const compose=fs.readFileSync("infra/docker-compose.production.yml","utf8");
const runtime=fs.readFileSync("assets/config.production.example.js","utf8");
const envExample=fs.readFileSync("infra/production.env.example.txt","utf8");
const caddy=fs.readFileSync("infra/Caddyfile.production.example","utf8");

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
