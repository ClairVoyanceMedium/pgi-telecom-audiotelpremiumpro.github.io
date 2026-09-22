import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {loadConfig} from "../backend/src/config.mjs";
import {createStaticSiteHandler} from "../backend/src/static-site.mjs";
import {clientIp,securityHeaders} from "../backend/src/http.mjs";

test("production config accepts PaaS PORT DATABASE_URL and release SHA",()=>{
  const secret="x".repeat(48);
  const config=loadConfig({
    PGI_BACKEND_MODE:"production",
    PGI_AUTH_MODE:"session",
    PORT:"4321",
    DATABASE_URL:"postgresql://user:password@postgres.internal:5432/pgi",
    RAILWAY_GIT_COMMIT_SHA:"a".repeat(40),
    PGI_STATIC_DIR:"/app/dist",
    PGI_SESSION_SECRET:secret,
    PGI_ADMIN_PASSWORD_HASH:"scrypt$16384$8$1$placeholder$placeholder",
    PGI_INGEST_TOKEN:secret,
    PGI_TELEPHONY_USER:"pgi-telephony",
    PGI_TELEPHONY_PASSWORD:secret,
    PGI_CALLER_HASH_KEY:secret,
    PGI_PORTABILITY_SECRET_KEY:secret
  });
  assert.equal(config.port,4321);
  assert.equal(config.databaseUrl,"postgresql://user:password@postgres.internal:5432/pgi");
  assert.equal(config.releaseId,"a".repeat(40));
  assert.equal(config.staticDir,"/app/dist");
});

test("same-origin static handler serves marketing at root and keeps private UI non-indexed",async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"pgi-static-"));
  fs.mkdirSync(path.join(root,"site"),{recursive:true});
  fs.writeFileSync(path.join(root,"index.html"),"marketing");
  fs.writeFileSync(path.join(root,"cockpit.html"),"cockpit");
  fs.writeFileSync(path.join(root,"client.html"),"client");
  fs.writeFileSync(path.join(root,"site","index.html"),"marketing-old");
  const handler=createStaticSiteHandler(root);
  const server=http.createServer(async(req,res)=>{
    const pathname=new URL(req.url,"http://local").pathname;
    if(await handler(req,res,pathname))return;
    res.writeHead(404,{"Content-Type":"text/plain"});res.end("not found");
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const address=server.address(),base="http://127.0.0.1:"+address.port;
    const marketing=await fetch(base+"/");
    assert.equal(marketing.status,200);
    assert.equal(await marketing.text(),"marketing");
    const legacy=await fetch(base+"/site/",{redirect:"manual"});
    assert.equal(legacy.status,308);
    assert.equal(legacy.headers.get("location"),"/");
    const cockpit=await fetch(base+"/cockpit");
    assert.equal(cockpit.status,200);
    assert.equal(await cockpit.text(),"cockpit");
    assert.match(cockpit.headers.get("x-robots-tag")||"",/noindex/);
    const client=await fetch(base+"/client.html",{method:"HEAD"});
    assert.equal(client.status,200);
    assert.match(client.headers.get("x-robots-tag")||"",/noindex/);
    const api=await fetch(base+"/api/v1/health");
    assert.equal(api.status,404);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test("security headers preserve Google popup compatibility without allowing cross-domain policy files",()=>{
  const headers=new Map();
  securityHeaders({setHeader:(name,value)=>headers.set(String(name).toLowerCase(),String(value))},"req-test");
  assert.equal(headers.get("cross-origin-opener-policy"),"same-origin-allow-popups");
  assert.equal(headers.get("cross-origin-resource-policy"),"same-origin");
  assert.equal(headers.get("x-permitted-cross-domain-policies"),"none");
  assert.equal(headers.get("x-frame-options"),"DENY");
});

test("trusted proxy mode uses the forwarded visitor IP for abuse controls",()=>{
  const req={socket:{remoteAddress:"10.0.0.8"},headers:{"x-forwarded-for":"203.0.113.24, 10.0.0.8"}};
  assert.equal(clientIp(req,false),"10.0.0.8");
  assert.equal(clientIp(req,true),"203.0.113.24");
});

test("Railway deployment keeps app and database private-by-reference",()=>{
  const railway=JSON.parse(fs.readFileSync("railway.json","utf8"));
  const docker=fs.readFileSync("infra/Dockerfile.platform","utf8");
  const rootDocker=fs.readFileSync("Dockerfile","utf8");
  const start=fs.readFileSync("scripts/start-platform.sh","utf8");
  const bootstrap=fs.readFileSync("scripts/bootstrap-database.mjs","utf8");
  assert.equal(railway.build.builder,"DOCKERFILE");
  assert.equal(railway.build.dockerfilePath,"infra/Dockerfile.platform");
  assert.equal(railway.deploy.healthcheckPath,"/api/v1/ready");
  assert.ok(rootDocker.includes('CMD ["sh","scripts/start-platform.sh"]'));
  assert.match(rootDocker,/COPY backend \.\/backend/);
  assert.match(start,/DATABASE_URL/);
  assert.match(start,/PGI_STATIC_DIR/);
  assert.match(start,/bootstrap-database\.mjs/);
  assert.match(bootstrap,/to_regclass\('public\.calls'\)/);
  assert.match(bootstrap,/refusing destructive bootstrap/);
  assert.doesNotMatch(start,/DATABASE_PUBLIC_URL/);
  assert.doesNotMatch(docker,/DATABASE_PUBLIC_URL/);
  assert.doesNotMatch(rootDocker,/DATABASE_PUBLIC_URL/);
});
