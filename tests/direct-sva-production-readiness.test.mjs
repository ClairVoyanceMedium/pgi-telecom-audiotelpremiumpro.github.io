import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {directSvaProductionReadiness,DIRECT_SVA_RELEASE_REVIEW_REQUIREMENTS}
 from "../backend/src/direct-sva-production-readiness.mjs";

const db=(migration,overrides={})=>{
 const commands=[];
 const readSql={unsafe:async sql=>{
  commands.push(sql);
  if(sql.includes("to_regclass"))return [{...migration}];
  if(sql.includes("FROM direct_sva_admin_switches"))return [{interface_preview_enabled:false,commercial_operation_enabled:false}];
  if(sql.includes("FROM direct_sva_operator_controls"))return [{operator_mode:"preparation",number_activation_enabled:false,payouts_enabled:false}];
  if(sql.includes("FROM direct_sva_integration_readiness"))
   return overrides.integrations||["ga4","gsc","hubspot","statutory_accounting","network","payment_psp"].map(
    integration_key=>({integration_key,activation_status:"disabled",can_send_data:false}));
  if(sql.includes("FROM direct_sva_automation_jobs"))return [{pending_count:13}];
  if(sql.includes("FROM direct_sva_existing_customer_transition_plans"))return [{prepared_count:2}];
  throw Error("unexpected query");
 }};
 return {store:{readSql},commands};
};
const full={switches:true,operator_ready:true,integrations:true,transitions:true,automation:true};

test("without migrations, readiness reports blocked instead of zero or green",async()=>{
 const {store,commands}=db({switches:false,operator_ready:false,integrations:false,transitions:false,automation:false});
 const out=await directSvaProductionReadiness(store);
 assert.equal(out.internal_safety_controls_ok,false);
 assert.equal(out.production_launch_authorized,false);
 assert.equal(out.external_evidence_independently_verified,false);
 assert.equal(out.technical_controls[0].status,"blocked");
 assert.equal(out.transition_plans_prepared,null);
 assert.equal(commands.length,1);
});
test("complete safety inventory is observable, but it never authorizes trading or money transfers",async()=>{
 const {store}=db(full);
 const out=await directSvaProductionReadiness(store);
 assert.equal(out.internal_safety_controls_ok,true);
 assert.equal(out.technical_controls.filter(c=>c.status==="observed").length,3);
 assert.equal(out.transition_plans_prepared,2);
 assert.equal(out.automation_jobs_pending,13);
 assert.equal(out.production_launch_authorized,false);
 assert.equal(out.funds_transfer_authorized,false);
 assert.equal(out.customer_number_changes_authorized,false);
 assert.equal(out.external_gates.length,DIRECT_SVA_RELEASE_REVIEW_REQUIREMENTS.length);
 assert.ok(out.external_gates.every(g=>g.status==="external_proof_required"));
});
test("any active, duplicate or missing connector is a release blocker",async()=>{
 const baseline=["ga4","gsc","hubspot","statutory_accounting","network","payment_psp"].map(
  integration_key=>({integration_key,activation_status:"disabled",can_send_data:false}));
 const variants=[
  baseline.slice(0,-1), [...baseline,baseline[0]],
  baseline.map((x,i)=>i===0?{...x,can_send_data:true}:x),
  baseline.map((x,i)=>i===2?{...x,activation_status:"active"}:x)
 ];
 for(const integrations of variants){
  const {store}=db(full,{integrations});
  const out=await directSvaProductionReadiness(store);
  assert.equal(out.internal_safety_controls_ok,false);
  assert.equal(out.technical_controls.find(x=>x.key==="external_connections").status,"blocked");
  assert.equal(out.production_launch_authorized,false);
 }
});
test("release report uses no credentials or mutation calls",()=>{
 const code=fs.readFileSync(new URL("../backend/src/direct-sva-production-readiness.mjs",import.meta.url),"utf8");
 assert.match(code,/to_regclass/);
 assert.doesNotMatch(code,/(?:\.begin\(|sql\.unsafe\("\s*(?:INSERT|UPDATE|DELETE|DROP)|resend|secret_ref|stripe_secret|auth_token)/i);
 const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
 const segment=server.slice(server.indexOf('pathname==="/api/v1/platform/direct-sva-release-readiness"'),
  server.indexOf('pathname==="/api/v1/platform/direct-sva-switches"'));
 assert.match(segment,/requireRole\(actor,\["admin"\]\)/);
 assert.match(segment,/directSvaProductionReadiness\(store\)/);
});
