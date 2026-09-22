import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {execFileSync} from "node:child_process";

test("production static build publishes marketing root and private cockpit",()=>{
  fs.rmSync("dist",{recursive:true,force:true});
  try{
    execFileSync(process.execPath,["scripts/build-static.mjs"],{
      env:{
        ...process.env,
        PGI_RUNTIME_MODE:"production",
        PGI_API_BASE_URL:"/api/v1",
        PGI_RELEASE_ID:"c".repeat(40),
        VERCEL_PROJECT_PRODUCTION_URL:"pgi-test.vercel.app"
      },
      stdio:"pipe"
    });

    const root=fs.readFileSync("dist/index.html","utf8");
    const cockpit=fs.readFileSync("dist/cockpit.html","utf8");
    const legacy=fs.readFileSync("dist/site/index.html","utf8");
    const robots=fs.readFileSync("dist/robots.txt","utf8");
    const sitemap=fs.readFileSync("dist/sitemap.xml","utf8");

    assert.match(root,/Vos appels peuvent devenir une/);
    assert.doesNotMatch(root,/Cockpit \/ PGI Telecom/);
    assert.match(root,/href="site\/site\.css"/);
    assert.match(root,/src="site\/site\.js"/);
    assert.doesNotMatch(root,/\.\.\/assets\//);
    assert.match(root,/rel="canonical" href="https:\/\/pgi-test\.vercel\.app\/"/);
    assert.match(root,/property="og:url" content="https:\/\/pgi-test\.vercel\.app\/"/);

    assert.match(cockpit,/Cockpit \/ PGI Telecom/);
    assert.match(cockpit,/noindex,nofollow,noarchive/);

    assert.match(legacy,/rel="canonical" href="https:\/\/pgi-test\.vercel\.app\/"/);
    assert.match(robots,/Disallow: \/cockpit/);
    assert.match(robots,/Sitemap: https:\/\/pgi-test\.vercel\.app\/sitemap\.xml/);
    assert.match(sitemap,/<loc>https:\/\/pgi-test\.vercel\.app\/<\/loc>/);
  }finally{
    fs.rmSync("dist",{recursive:true,force:true});
  }
});
