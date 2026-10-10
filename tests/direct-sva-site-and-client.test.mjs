import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createStaticSiteHandler} from "../backend/src/static-site.mjs";
import {loadConfig} from "../backend/src/config.mjs";
import {
 directSvaCustomerOverview,DIRECT_SVA_CUSTOMER_FEATURES,
 inspectDirectSvaWorkflows,directSvaWorkflowOverview
} from "../backend/src/direct-sva-customer.mjs";

const root=path.resolve(import.meta.dirname||path.dirname(new URL(import.meta.url).pathname),"..");

test("future direct SVA public pages and customer area are entirely staged and not packaged",()=>{
 const builder=fs.readFileSync(path.join(root,"scripts/build-static.mjs"),"utf8");
 const staged=[
  "site/distribution-sva/index.html",
  "site/distribution-sva/solutions/index.html",
  "site/distribution-sva/conformite/index.html",
  "site/distribution-sva/espace-client/index.html",
  "site/distribution-sva/style.css",
  "site/distribution-sva/site.js",
  "site/distribution-sva/client-portal.js",
  "site/distribution-sva/measurement.js",
  "site/direct-sva-tracking.js"
 ];
 for(const file of staged){
  assert.equal(fs.existsSync(path.join(root,file)),true,file);
  assert.ok(!builder.includes('"'+file+'"'),"Unexpected public bundle inclusion: "+file);
 }
});

test("future marketing pages have a separated menu, prelaunch status, noindex and correct canonical",()=>{
 for(const p of ["index.html","solutions/index.html","conformite/index.html"]){
  const source=fs.readFileSync(path.join(root,"site/distribution-sva",p),"utf8");
  assert.match(source,/name="robots" content="noindex,nofollow,noarchive"/);
  assert.match(source,/href="https:\/\/audiotel-premium-pro\.com\/distribution-sva\//);
  assert.match(source,/Navigation de la distribution directe/);
  assert.match(source,/href="\/distribution-sva\/espace-client\/"/);
  assert.match(source,/site\/distribution-sva\/measurement\.js/);
  assert.doesNotMatch(source,/G-SZY50J75N7|4,90.?€.*distributeur/);
 }
});

test("existing site remains free of direct SVA public navigation and its current CTA stays Audiotel",()=>{
 const home=fs.readFileSync(path.join(root,"site/index.html"),"utf8");
 const cockpit=fs.readFileSync(path.join(root,"index.html"),"utf8");
 assert.ok(!home.includes('href="/distribution-sva/"'));
 assert.match(home,/Audiotel Premium Pro/);
 assert.ok(!cockpit.includes('id="view-direct-sva"'));
});

test("static server returns 404 even if direct SVA files are copied accidentally",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"dsva-stage-"));
 try{
  fs.mkdirSync(path.join(dir,"distribution-sva"),{recursive:true});
  fs.writeFileSync(path.join(dir,"distribution-sva","index.html"),"<p>Must not appear</p>");
  const handle=createStaticSiteHandler(dir);
  for(const url of ["/distribution-sva/","/distribution-sva/index.html","/site/distribution-sva/index.html","/%64istribution-sva/","/site/distribution%2Dsva/index.html","/distribution-sva%2Findex.html"]){
   const state={status:0,headers:{},ended:false};
   const res={writeHead(status,headers){state.status=status;state.headers=headers||{};},end(){state.ended=true;}};
   const handled=await handle({method:"GET",url},res,url);
   assert.equal(handled,true);
   assert.equal(state.status,404);
   assert.match(state.headers["X-Robots-Tag"],/noindex/);
   assert.equal(state.ended,true);
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test("customer overview does not query other tenant data if no direct SVA enrollment exists",async()=>{
 const calls=[];
 const store={readSql:{unsafe:async(q,params)=>{calls.push({q,params});return [];}}};
 await assert.rejects(()=>directSvaCustomerOverview(store,{tenant_id:14}),{code:"DIRECT_SVA_CUSTOMER_ACCESS_NOT_ASSIGNED"});
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,[14]);
 assert.match(calls[0].q,/direct_sva_customer_accounts/);
});

test("customer overview requires explicit access flag and cannot expose Audiotel figures",async()=>{
 const calls=[];
 const store={readSql:{unsafe:async(q,params)=>{calls.push({q,params});return [{tenant_id:14,dashboard_enabled:false,access_state:"preparation"}];}}};
 await assert.rejects(()=>directSvaCustomerOverview(store,{tenant_id:14}),{code:"DIRECT_SVA_CUSTOMER_NOT_RELEASED"});
 assert.equal(calls.length,1);
});

test("customer viewer uses same authenticated tenant ID for every query when authorized in a later schema",async()=>{
 const args=[];
 const store={readSql:{unsafe:async(q,params)=>{
  args.push({q,params});
  if(q.includes("direct_sva_customer_accounts"))return [{tenant_id:14,dashboard_enabled:true,access_state:"preparation"}];
  if(q.includes("direct_sva_customer_cases"))return [{public_reference:"DSVA-CASE-0001",request_kind:"portability",status:"prepared",initiated_at:"2026-10-10T10:00:00Z"}];
  if(q.includes("direct_sva_number_inventory"))return [];
  return [];
 }}};
 const out=await directSvaCustomerOverview(store,{tenant_id:14});
 assert.equal(out.business_unit,"direct_sva");
 assert.equal(out.source,"direct_sva_only");
 assert.equal(out.service_active,false);
 assert.equal(out.client_payouts_enabled,false);
 assert.equal(out.cases[0].reference,"DSVA-CASE-0001");
 assert.equal(args.length,3);
 assert.ok(args.every(r=>JSON.stringify(r.params)==="[14]"));
 assert.ok(DIRECT_SVA_CUSTOMER_FEATURES.length>=7);
});

test("workflow planning protects all thirteen stages and never authorizes external payments",async()=>{
 const count=13;
 const m=fs.readFileSync(path.join(root,"backend/src/direct-sva-customer.mjs"),"utf8");
 assert.match(m,/publisher_payout/);
 assert.match(m,/number_assignment/);
 assert.match(m,/analytics_delivery/);
 const plan=inspectDirectSvaWorkflows([{workflow_key:"publisher_payout",count:8}]);
 assert.equal(plan.jobs.length,13);
 assert.equal(plan.jobs.every(x=>x.execution_authorized===false),true);
 assert.equal(plan.transfers_enabled,false);
 assert.equal(plan.automation_ready,false);
 assert.ok(plan.jobs.find(x=>x.workflow==="publisher_payout").required_evidence.includes("psp_mandate"));
 const response=await directSvaWorkflowOverview({readSql:{unsafe:async()=>[]}});
 assert.equal(response.jobs.length,13);
 assert.equal(response.jobs.every(x=>x.count===0),true);
 assert.equal(response.external_execution_enabled,false);
});

test("migration locks customer launch and enforces idempotent automation queue",()=>{
 const source=fs.readFileSync(path.join(root,"database/migrations/075_direct_sva_customer_and_automation_foundation.sql"),"utf8");
 assert.match(source,/dashboard_enabled=false/);
 assert.match(source,/client_contract_accepted=false/);
 assert.match(source,/external_execution_enabled=false/);
 assert.match(source,/financial_transfer_enabled=false/);
 assert.match(source,/idempotency_key text NOT NULL UNIQUE/);
 assert.match(source,/direct_sva_guard_automation_events/);
 assert.doesNotMatch(source,/\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b|\bALTER TABLE\b/i);
});

test("new customer and workflow endpoints require session, tenant permissions or admin role",()=>{
 const server=fs.readFileSync(path.join(root,"backend/server.mjs"),"utf8");
 const customer=server.slice(server.indexOf('pathname==="/api/v1/customer/direct-sva/overview"'),server.indexOf('pathname==="/api/v1/customer/auth/me"'));
 assert.match(customer,/requireActor\(customerActor\)/);
 assert.match(customer,/store\.customerSessionContext\(customerActor\)/);
 assert.match(customer,/requireCustomerPermission\(context,"overview.read"\)/);
 assert.match(customer,/directSvaCustomerOverview\(store,context\)/);
 const admin=server.slice(server.indexOf('pathname==="/api/v1/platform/direct-sva/automation"'),server.indexOf('pathname==="/api/v1/platform/direct-sva/overview"'));
 assert.match(admin,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
 assert.match(admin,/directSvaWorkflowOverview\(store\)/);
});

test("future private customer portal has no signup, fake SVA figures or exported customer secrets",()=>{
 const html=fs.readFileSync(path.join(root,"site/distribution-sva/espace-client/index.html"),"utf8");
 const js=fs.readFileSync(path.join(root,"site/distribution-sva/client-portal.js"),"utf8");
 assert.match(html,/name="robots" content="noindex/);
 assert.match(html,/Accès réservé aux clients autorisés/);
 assert.match(js,/credentials:"same-origin"/);
 assert.match(js,/cache:"no-store"/);
 assert.match(js,/\/api\/v1\/customer\/direct-sva\/overview/);
 assert.doesNotMatch(html,/Créer mon compte|Inscription libre|MODE DÉMO/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|generated_revenue_ttc|subscription_billing_events/);
});

test("GA4 distributor tracking is not bootstrapped without independent property and consent",()=>{
 const module=fs.readFileSync(path.join(root,"site/distribution-sva/measurement.js"),"utf8");
 assert.match(module,/measurementId!=="G-SZY50J75N7"/);
 assert.match(module,/navigator\.globalPrivacyControl!==true/);
 assert.match(module,/consentGranted:true/);
 assert.match(module,/legalApproved===true/);
 assert.match(module,/directReleaseApproved===true/);
 assert.match(module,/dsva_navigation_click/);
 assert.match(module,/dsva_section_view/);
 assert.match(module,/dsva_faq_open/);
 assert.doesNotMatch(module,/email.*window\.gtag|phone.*window\.gtag|fetch\(.*hubspot/);
});

test("future direct SVA APIs and admin UI are default-deny even during first Audiotel launch",()=>{
 const config=loadConfig({PGI_BACKEND_MODE:"simulator"});
 assert.equal(config.directSvaOperatorApiEnabled,false);
 const explicit=loadConfig({PGI_BACKEND_MODE:"simulator",PGI_DIRECT_SVA_API_PREVIEW_ENABLED:"true"});
 assert.equal(explicit.directSvaOperatorApiEnabled,true);
 const server=fs.readFileSync(path.join(root,"backend/server.mjs"),"utf8");
 assert.match(server,/!config\.directSvaOperatorApiEnabled/);
 assert.match(server,/pathname\.startsWith\("\/api\/v1\/platform\/direct-sva\/"\)/);
 assert.match(server,/pathname\.startsWith\("\/api\/v1\/customer\/direct-sva\/"\)/);
 assert.match(server,/DIRECT_SVA_PREPARATION_DISABLED/);
 const admin=fs.readFileSync(path.join(root,"assets/accounting-cockpit.js"),"utf8");
 assert.match(admin,/PGI_CONFIG\?\.directSvaOperatorUiEnabled===true/);
 assert.match(admin,/if\(!directSvaTabReleased\(\)\)return "";/);
 assert.match(admin,/if\(next==="direct"&&!directSvaTabReleased\(\)\)return;/);
 assert.doesNotMatch(admin,/unitTabs\(\)\+unitTabs\(\)/);
 assert.match(admin,/root\.innerHTML='<div class="acc">'\+unitTabs\(\)\+/);
 const builder=fs.readFileSync(path.join(root,"scripts/build-static.mjs"),"utf8");
 assert.match(builder,/"assets\/direct-sva-cockpit\.js"/);
 assert.ok(!builder.includes('"site/distribution-sva/index.html"'));
});
