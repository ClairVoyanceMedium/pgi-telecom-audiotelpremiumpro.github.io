import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
 makeDirectSvaWorkflowSimulation,recordDirectSvaWorkflowSimulation,
 directSvaSimulationDashboard
} from "../backend/src/direct-sva-automation-rehearsal.mjs";
import {DIRECT_SVA_WORKFLOW_RULES} from "../backend/src/direct-sva-customer.mjs";

const fixed=new Date("2026-10-10T11:00:00.000Z");
const actor={role:"admin",sub:"admin-internal-test"};

function request(workflow="lead_routing",facts={},changes={}){
 return {
  workflow_key:workflow,
  source_reference:"DSVA-SIM-00000001",
  idempotency_key:"dsva_sim_test_key_00000001",
  facts,attempt_number:1,failure_mode:"none",...changes
 };
}
function sqlMock({enabled=true}={}){
 const history=new Map(),calls=[];
 let id=0;
 const control={interface_preview_enabled:enabled,commercial_operation_enabled:false};
 const tx={
  unsafe:async (query,params=[])=>{
   calls.push(query);
   if(query.includes("FROM direct_sva_admin_switches"))return [control];
   if(query.includes("INSERT INTO direct_sva_automation_rehearsals")){
    const key=params[2];
    if(history.has(key))return [];
    const row={id:++id,workflow_key:params[0],source_reference:params[1],
     input_digest:params[3],result_status:params[4],attempt_number:params[5],
     missing_checks:JSON.parse(params[7]),next_simulation_at:params[9],
     safe_plan:JSON.parse(params[10]),created_at:fixed.toISOString()};
    history.set(key,row);return [row];
   }
   if(query.includes("WHERE idempotency_key=$1"))return [history.get(params[0])].filter(Boolean);
   throw Error("unexpected SQL "+query);
  }
 };
 const sql={unsafe:tx.unsafe,begin:async cb=>cb(tx)};
 const readSql={unsafe:async query=>{
  if(query.includes("GROUP BY workflow_key"))return [...history.values()].map(r=>({
   workflow_key:r.workflow_key,result_status:r.result_status,count:1
  }));
  return [...history.values()].reverse();
 }};
 return {store:{sql,readSql},history,calls};
}

test("all thirteen workflows can be rehearsed with hypothetical facts only",()=>{
 const names=Object.keys(DIRECT_SVA_WORKFLOW_RULES);
 assert.equal(names.length,13);
 for(const name of names){
  const facts=Object.fromEntries(DIRECT_SVA_WORKFLOW_RULES[name].requires.map(k=>[k,true]));
  const p=makeDirectSvaWorkflowSimulation(request(name,facts),fixed);
  assert.equal(p.result_status,"ready_for_simulation");
  assert.equal(p.business_unit,"direct_sva");
  assert.equal(p.simulation_only,true);
  assert.equal(p.external_action_executed,false);
  assert.equal(p.payout_executed,false);
  assert.equal(p.crm_synced,false);
  assert.equal(p.network_changed,false);
  assert.equal(p.analytics_emitted,false);
 }
});

test("missing checks block simulated readiness but do not prevent development",()=>{
 const p=makeDirectSvaWorkflowSimulation(request(),fixed);
 assert.equal(p.result_status,"missing_inputs");
 assert.equal(p.missing_checks.length,2);
 assert.equal(p.next_step,"REVIEW_MISSING_INPUTS");
 assert.equal(p.external_action_executed,false);
});

test("vendor timeout produces bounded retry and a fifth failure escalates",()=>{
 const all={consent:true,contractual_scope:true};
 const first=makeDirectSvaWorkflowSimulation(request("lead_routing",all,{failure_mode:"timeout"}),fixed);
 assert.equal(first.result_status,"retry_planned");
 assert.ok(new Date(first.next_simulation_at).getTime()>fixed.getTime());
 assert.equal(first.next_step,"RETRY_SUGGESTED_NOT_SCHEDULED");
 const fifth=makeDirectSvaWorkflowSimulation(request("lead_routing",all,{failure_mode:"timeout",attempt_number:5}),fixed);
 assert.equal(fifth.result_status,"manual_review");
 assert.equal(fifth.next_simulation_at,null);
 assert.equal(fifth.review_needed,true);
});

test("rate limits and validation errors have different retry paths",()=>{
 const facts={consent:true,contractual_scope:true};
 const rate=makeDirectSvaWorkflowSimulation(request("lead_routing",facts,{failure_mode:"rate_limit",attempt_number:2}),fixed);
 const invalid=makeDirectSvaWorkflowSimulation(request("lead_routing",facts,{failure_mode:"validation_error"}),fixed);
 assert.equal(rate.result_status,"retry_planned");
 assert.equal(invalid.result_status,"manual_review");
 assert.ok(new Date(rate.next_simulation_at).getTime()>fixed.getTime()+120000);
});

test("facts are a strict boolean allowlist and no contact data is permitted",()=>{
 for(const extra of [
  {email:"alice@example.test"}, {phone:"+33601020304"},{consent:"yes"},
  {consent:true,contractual_scope:true,customer_name:"Alice"}
 ]){
  assert.throws(()=>makeDirectSvaWorkflowSimulation(request("lead_routing",extra),fixed),{status:400});
 }
 assert.throws(()=>makeDirectSvaWorkflowSimulation(request("publisher_payout",{psp_mandate:true,editor_kyc:true,collected_funds:true,approved_statement:true},{notes:"send money"}),fixed),{status:400});
});

test("idempotent replay returns original plan without producing another row",async()=>{
 const db=sqlMock(),payload=request();
 const a=await recordDirectSvaWorkflowSimulation(db.store,actor,payload,fixed);
 const b=await recordDirectSvaWorkflowSimulation(db.store,actor,payload,fixed);
 assert.equal(a.replayed,false);assert.equal(b.replayed,true);
 assert.equal(db.history.size,1);
 assert.equal(a.plan.input_digest,b.plan.input_digest);
 assert.equal(a.external_action_executed,false);
 assert.ok(db.calls.every(q=>!/\bUPDATE\b|\bDELETE\b|hubspot|stripe|payout|ga4/i.test(q)));
});

test("idempotency collision fails closed and preserves previous simulation",async()=>{
 const db=sqlMock();
 await recordDirectSvaWorkflowSimulation(db.store,actor,request(),fixed);
 await assert.rejects(
  ()=>recordDirectSvaWorkflowSimulation(db.store,actor,request("lead_routing",{consent:true}),fixed),
  {code:"DSVA_SIMULATION_IDEMPOTENCY_COLLISION"}
 );
 assert.equal(db.history.size,1);
});

test("preview must be enabled; unauthorized staff cannot create rehearsals",async()=>{
 const off=sqlMock({enabled:false});
 await assert.rejects(()=>recordDirectSvaWorkflowSimulation(off.store,actor,request(),fixed),{code:"DSVA_SIMULATION_PREVIEW_DISABLED"});
 const enabled=sqlMock({enabled:true});
 await assert.rejects(()=>recordDirectSvaWorkflowSimulation(enabled.store,{role:"finance",sub:"finance1"},request(),fixed),{status:403});
});

test("dashboard reports only direct rehearsals and no external actions",async()=>{
 const db=sqlMock();
 await recordDirectSvaWorkflowSimulation(db.store,actor,request(),fixed);
 const result=await directSvaSimulationDashboard(db.store);
 assert.equal(result.mode,"dry_run_only");
 assert.equal(result.total_simulation_count,1);
 assert.equal(result.recent.length,1);
 assert.equal(result.registered_workflows,13);
 assert.equal(result.external_actions_executed,false);
 assert.equal(result.real_scheduler_active,false);
 assert.equal(result.recent[0].simulation_only,true);
});

test("migration is append-only and restricted to the separate business unit",()=>{
 const sql=fs.readFileSync(new URL("../database/migrations/079_direct_sva_automation_rehearsals.sql",import.meta.url),"utf8");
 assert.match(sql,/business_unit text NOT NULL DEFAULT 'direct_sva' CHECK \(business_unit='direct_sva'\)/);
 assert.match(sql,/idempotency_key text NOT NULL UNIQUE/);
 assert.match(sql,/CREATE TRIGGER direct_sva_guard_rehearsal_immutable/);
 assert.doesNotMatch(sql,/\bDROP\b|\bTRUNCATE\b|\bALTER TABLE\b|\bDELETE FROM\b/i);
});

test("rehearsal API stays protected by admin role, CSRF, and existing preview switch",()=>{
 const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
 const apiSection=server.slice(server.indexOf('pathname==="/api/v1/platform/direct-sva/automation/rehearsals"'),
  server.indexOf('pathname==="/api/v1/platform/direct-sva/automation"'));
 assert.match(apiSection,/requireRole\(actor,\["admin"\]\)/);
 assert.match(apiSection,/requireCsrf\(req,actor,config\)/);
 assert.match(apiSection,/recordDirectSvaWorkflowSimulation\(store,actor,body\)/);
 assert.match(server,/directSwitchState\.interface_preview_enabled/);
});

test("lazy UI never calls any real external system",()=>{
 const admin=fs.readFileSync(new URL("../assets/direct-sva-automation-lab.js",import.meta.url),"utf8");
 const cockpit=fs.readFileSync(new URL("../assets/direct-sva-cockpit.js",import.meta.url),"utf8");
 assert.match(admin,/Tester automatiquement les 13 scénarios fictifs/);
 assert.match(admin,/import|fetch/);
 assert.match(cockpit,/import\("\.\/direct-sva-automation-lab\.js"\)/);
 assert.doesNotMatch(admin,/https?:\/\/(?:api\.hubapi|api\.stripe|www\.google-analytics)/);
});
