import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {normalizeDirectSvaWebsiteState,readDirectSvaWebsiteVisibility,setDirectSvaWebsiteNavigation} from "../backend/src/direct-sva-website-visibility.mjs";
import {isDirectSvaPath,isDirectSvaPublicAsset,directSvaPublicPagePath,visibleDistributionMarketingHome,publishedDistributionHtml,publishedDistributionSitemap,publishedDistributionRobots} from "../backend/src/direct-sva-public-site.mjs";
import {createStaticSiteHandler} from "../backend/src/static-site.mjs";

const waiting={public_content_authorized:false,navigation_enabled:false,commercial_calls_to_action_enabled:false,changed_at:null};
const released={...waiting,public_content_authorized:true};
const normalizedReleased={business_unit:"direct_sva",publication_authorized:true,navigation_visible:false,commercial_requests_enabled:false};

test("unreleased content is never publicly accessible even if admin has toggled navigation",()=>{
 assert.equal(normalizeDirectSvaWebsiteState({...waiting,navigation_enabled:true}).navigation_visible,false);
 assert.equal(publishedDistributionHtml('<meta name="robots" content="noindex,nofollow,noarchive">',waiting),null);
 assert.equal(publishedDistributionSitemap(waiting),null);
 assert.equal(normalizeDirectSvaWebsiteState(waiting).sitemap_active,false);
 assert.equal(normalizeDirectSvaWebsiteState(waiting).commercial_requests_enabled,false);
});
test("hiding navigation NEVER changes a published page's SEO, canonical or sitemap",()=>{
 const page='<html><head><meta name="robots" content="noindex,nofollow,noarchive"><link rel="canonical" href="https://audiotel-premium-pro.com/distribution-sva/en/"></head><body><main><h1>Telecom</h1></main></body></html>';
 const home='<a class="header-distribution-link" href="/distribution-sva/" hidden>Pôle Télécom &amp; Réseau</a>';
 const hide=normalizeDirectSvaWebsiteState(released);
 const show=normalizeDirectSvaWebsiteState({...released,navigation_enabled:true});
 assert.equal(hide.navigation_visible,false);
 assert.equal(hide.seo_pages_accessible,true);
 assert.equal(hide.sitemap_active,true);
 assert.match(publishedDistributionHtml(page,hide),/content="index,follow,max-snippet:-1"/);
 assert.match(publishedDistributionHtml(page,hide),/<link rel="canonical" href="https:\/\/audiotel-premium-pro.com\/distribution-sva\/en\/">/);
 assert.equal(publishedDistributionHtml(page,hide).includes('<h1>Telecom</h1>'),true);
 assert.ok(!visibleDistributionMarketingHome(home,hide).includes(' href="/distribution-sva/">'));
 assert.match(visibleDistributionMarketingHome(home,show),/href="\/distribution-sva\/">/);
 assert.match(publishedDistributionHtml(page,show),/content="index,follow,max-snippet:-1"/);
 assert.equal(publishedDistributionHtml(page,show),publishedDistributionHtml(page,hide),"menu visibility must not modify indexed content");
 assert.equal(publishedDistributionSitemap(hide),publishedDistributionSitemap(show));
 assert.equal((publishedDistributionSitemap(hide).match(/<url>/g)||[]).length,35);
});
test("only explicitly known pages and public assets can be published",()=>{
 assert.equal(directSvaPublicPagePath("/distribution-sva/en/faq/"),"/site/distribution-sva/en/faq/index.html");
 assert.equal(directSvaPublicPagePath("/distribution-sva/questions-frequentes/"),"/site/distribution-sva/questions-frequentes/index.html");
 assert.equal(directSvaPublicPagePath("/distribution-sva/espace-client/"),null);
 assert.equal(directSvaPublicPagePath("/distribution-sva/en/faq/../../"),null);
 assert.equal(directSvaPublicPagePath("/distribution-sva/en/faq/%2e%2e/"),null);
 assert.equal(isDirectSvaPublicAsset("/site/distribution-sva/site.js"),true);
 assert.equal(isDirectSvaPublicAsset("/site/distribution-sva/index.html"),false);
 assert.equal(isDirectSvaPath("/distribution-sva/en/faq/"),true);
 assert.equal(isDirectSvaPath("/site/distribution-sva/en/faq/"),true);
});
test("informational publication cannot link to the unavailable private customer portal",()=>{
 const input='<html lang="fr"><head><meta name="robots" content="noindex,nofollow,noarchive"></head><body><main><a class="service" href="/distribution-sva/espace-client/">Espace client direct</a></main></body></html>';
 const prelaunch=publishedDistributionHtml(input,normalizedReleased);
 assert.ok(!prelaunch.includes('href="/distribution-sva/espace-client/"'));
 assert.ok(!prelaunch.includes('href="/client.html"'));
 assert.match(prelaunch,/Espace client Distribution en préparation/);
 const permitted=publishedDistributionHtml(input,{...normalizedReleased,commercial_requests_enabled:true});
 assert.match(permitted,/href="\/client\.html"/);
 assert.ok(!permitted.includes('href="/distribution-sva/espace-client/"'));
 const translated=input.replace('lang="fr"','lang="en"');
 assert.match(publishedDistributionHtml(translated,normalizedReleased),/Distribution client area coming later/);
});
test("robots.txt announces Distribution sitemap only after publication, regardless of navigation",()=>{
 const robots="User-agent: *\nAllow: /\nSitemap: https://audiotel-premium-pro.com/sitemap.xml\n";
 assert.equal(publishedDistributionRobots(robots,waiting),null);
 const off=publishedDistributionRobots(robots,normalizedReleased);
 const on=publishedDistributionRobots(robots,{...normalizedReleased,navigation_visible:true});
 assert.equal(off,on);
 assert.match(off,/Sitemap: https:\/\/audiotel-premium-pro\.com\/sitemap\.xml/);
 assert.match(off,/Sitemap: https:\/\/audiotel-premium-pro\.com\/distribution-sva\/sitemap\.xml/);
 assert.equal((off.match(/Sitemap: https:\/\/audiotel-premium-pro\.com\/distribution-sva\/sitemap\.xml/g)||[]).length,1);
 assert.equal(publishedDistributionRobots(off,normalizedReleased),off,"must be idempotent");
});
test("admin toggle first publishes editorial pages and later hides only link without losing SEO",async()=>{
 const state={...waiting};const writes=[];
 const store={sql:{unsafe:async()=>[state],begin:async fn=>fn({unsafe:async (q,args=[])=>{
  writes.push({q,args});
  if(q.startsWith("UPDATE direct_sva_website_visibility")){state.navigation_enabled=args[0];state.public_content_authorized=args[1];}
  return q.startsWith("SELECT")?[{...state}]:[];
 }})}};
 const admin={role:"admin",sub:"operator-123"};
 const input={enabled:true,expected_enabled:false,evidence_reference:"ADMIN-WEBSITE-123456"};
 await assert.rejects(()=>setDirectSvaWebsiteNavigation(store,{role:"readonly",sub:"x"},input),{status:403});
 await assert.rejects(()=>setDirectSvaWebsiteNavigation(store,admin,{...input,enabled:"true"}),{status:400});
 const enabled=await setDirectSvaWebsiteNavigation(store,admin,input);
 assert.equal(enabled.navigation_preference,true);
 assert.equal(enabled.publication_authorized,true);
 assert.equal(enabled.navigation_visible,true);
 assert.equal(enabled.first_publication,true);
 assert.equal(enabled.commercial_requests_enabled,false);
 assert.equal(enabled.seo_indexation_changed,true);
 assert.equal(enabled.next_step,"editorial_content_published");
 await assert.rejects(()=>setDirectSvaWebsiteNavigation(store,admin,input),{status:409});
 const disabled=await setDirectSvaWebsiteNavigation(store,admin,{enabled:false,expected_enabled:true,evidence_reference:"ADMIN-WEBSITE-654321"});
 assert.equal(disabled.navigation_preference,false);
 assert.equal(disabled.publication_authorized,true);
 assert.equal(disabled.seo_pages_accessible,true);
 assert.equal(disabled.first_publication,false);
 assert.equal(disabled.seo_indexation_changed,false);
 assert.equal(writes.filter(x=>x.q.startsWith("INSERT INTO direct_sva_website_visibility_audit")).length,3);
 assert.equal(writes.filter(x=>x.q.startsWith("UPDATE direct_sva_website_visibility")).length,2);
});
test("HTTP publication never breaks indexing when nav is turned off; private pages stay blocked",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pgi-dsva-seo-"));
 const home='<html><head></head><body><a class="header-distribution-link" href="/distribution-sva/" hidden>Pôle Télécom &amp; Réseau</a></body></html>';
 const html='<html><head><meta name="robots" content="noindex,nofollow,noarchive"><link rel="canonical" href="https://audiotel-premium-pro.com/distribution-sva/"></head><body><main><h1>PGI Telecom Distribution</h1></main></body></html>';
 fs.mkdirSync(path.join(root,"site","distribution-sva"),{recursive:true});
 fs.writeFileSync(path.join(root,"index.html"),home);
 fs.writeFileSync(path.join(root,"robots.txt"),"User-agent: *\nAllow: /\nSitemap: https://audiotel-premium-pro.com/sitemap.xml\n");
 fs.writeFileSync(path.join(root,"site","distribution-sva","index.html"),html);
 fs.writeFileSync(path.join(root,"site","distribution-sva","style.css"),"body{}");
 let status=waiting;const handler=createStaticSiteHandler(root,{getDirectSvaWebsiteState:async()=>normalizeDirectSvaWebsiteState(status)});
 const server=http.createServer(async(req,res)=>{
  try{
   if(await handler(req,res,new URL(req.url,"http://local").pathname))return;
   res.writeHead(404);res.end("not found");
  }catch(e){res.writeHead(500);res.end("error:"+e.message);}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const base="http://127.0.0.1:"+server.address().port;
 try{
  let r=await fetch(base+"/distribution-sva/");
  assert.equal(r.status,404);
  const robotsBefore=await (await fetch(base+"/robots.txt")).text();
  assert.doesNotMatch(robotsBefore,/distribution-sva\/sitemap\.xml/);
  status=released;
  r=await fetch(base+"/distribution-sva/");
  assert.equal(r.status,200);
  let body=await r.text();
  assert.match(body,/content="index,follow,max-snippet:-1"/);
  assert.match(body,/rel="canonical"/);
  assert.doesNotMatch(body,/temporairement indisponible/);
  const sitemap=await fetch(base+"/distribution-sva/sitemap.xml");
  assert.equal(sitemap.status,200);
  const xml=await sitemap.text();
  assert.equal((xml.match(/<url>/g)||[]).length,35);
  const robotsAfter=await (await fetch(base+"/robots.txt")).text();
  assert.match(robotsAfter,/distribution-sva\/sitemap\.xml/);
  assert.match(robotsAfter,/Sitemap: https:\/\/audiotel-premium-pro\.com\/sitemap\.xml/);
  const homeOff=await (await fetch(base+"/")).text();
  assert.match(homeOff,/href="\/distribution-sva\/" hidden>/);
  status={...released,navigation_enabled:true};
  assert.equal(await (await fetch(base+"/robots.txt")).text(),robotsAfter,"turning on the link must not alter sitemap discovery");
  const homeOn=await (await fetch(base+"/")).text();
  assert.match(homeOn,/href="\/distribution-sva\/">/);
  status=released;
  assert.equal((await fetch(base+"/distribution-sva/")).status,200);
  assert.equal((await fetch(base+"/distribution-sva/sitemap.xml")).status,200);
  assert.equal((await fetch(base+"/distribution-sva/espace-client/")).status,404);
  assert.equal((await fetch(base+"/site/distribution-sva/index.html")).status,404);
  assert.equal((await fetch(base+"/distribution-sva/non-existent")).status,404);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(root,{recursive:true,force:true});
 }
});
test("editorial release belongs to the admin and commercial operation stays separate",()=>{
 const sql=fs.readFileSync("database/migrations/084_direct_sva_website_visibility.sql","utf8");
 assert.match(sql,/public_content_authorized boolean NOT NULL DEFAULT false CHECK\(public_content_authorized=false\)/);
 const unlock=fs.readFileSync("database/migrations/085_direct_sva_admin_editorial_release.sql","utf8");
 assert.match(unlock,/DROP CONSTRAINT IF EXISTS direct_sva_website_visibility_public_content_authorized_check/);
 assert.match(unlock,/public_content_authorized/);
 assert.match(sql,/commercial_calls_to_action_enabled boolean NOT NULL DEFAULT false CHECK\(commercial_calls_to_action_enabled=false\)/);
 assert.match(sql,/direct_sva_website_visibility_audit_immutable/);
 const ui=fs.readFileSync("assets/direct-sva-switches.js","utf8");
 const server=fs.readFileSync("backend/server.mjs","utf8");
 assert.match(ui,/data-dss-website/);
 assert.match(ui,/seo_continuity_when_hidden/);
 assert.match(server,/\/api\/v1\/platform\/direct-sva-website\/navigation/);
 assert.match(server,/requireRole\(actor,\["admin"\]\);requireCsrf/);
 assert.match(ui,/window\.confirm/);
 const build=fs.readFileSync("scripts/build-static.mjs","utf8");
 assert.match(build,/fs\.cpSync\(path\.join\(root,"site","distribution-sva"\)/);
});
