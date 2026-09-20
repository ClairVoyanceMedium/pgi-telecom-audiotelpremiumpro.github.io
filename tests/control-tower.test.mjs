import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {evaluateOperationalPolicy} from "../backend/src/operational-policy.mjs";
import {simulateDigitalTwin} from "../backend/src/digital-twin.mjs";

test("Policy Engine blocks unsafe activation and explains every blocker",()=>{
  const r=evaluateOperationalPolicy("activate_number",{
    tenant_active:true,assignment_exists:true,subscription_active:false,payout_terms_ready:true,kyc_verified:true,
    regulatory_ready:true,arcep_2026_ready:true,destination_ready:true,operator_adapter_connected:false
  });
  assert.equal(r.decision,"BLOCKED");
  assert.equal(r.dry_run,true);
  assert.equal(r.mutates_state,false);
  assert.ok(r.blockers.some(x=>x.code==="SUBSCRIPTION_REQUIRED"));
  assert.ok(r.required_actions.some(x=>x.code==="OPERATOR_CONNECTION_PENDING"));
});

test("Policy Engine distinguishes action required from blocking",()=>{
  const r=evaluateOperationalPolicy("activate_number",{
    tenant_active:true,assignment_exists:true,subscription_active:true,payout_terms_ready:true,kyc_verified:true,
    regulatory_ready:true,arcep_2026_ready:true,destination_ready:true,operator_adapter_connected:false
  });
  assert.equal(r.decision,"ACTION_REQUIRED");
  assert.equal(r.blockers.length,0);
  assert.ok(r.required_actions.length>0);
});

test("Digital Twin stays dry-run and detects capacity overload",()=>{
  const baseline={active_assignments:100,active_subscriptions:100,ready_numbers:90,total_numbers:100,route_standby_ready:true,destination_capacity:120,current_concurrent:50,regions_ready:2,regions_total:2,dr_targets:2};
  const before=structuredClone(baseline);
  const r=simulateDigitalTwin("traffic_spike",baseline,{multiplier:3});
  assert.equal(r.severity,"critical");
  assert.equal(r.projections.estimated_concurrent,150);
  assert.equal(r.dry_run,true);
  assert.equal(r.mutates_state,false);
  assert.deepEqual(baseline,before);
});

test("Digital Twin covers carrier, portability, regulatory, billing and DR scenarios",()=>{
  const baseline={active_assignments:50,active_subscriptions:40,ready_numbers:45,total_numbers:50,route_standby_ready:false,destination_capacity:100,current_concurrent:10,regions_ready:1,regions_total:2,dr_targets:0};
  for(const scenario of ["carrier_outage","mass_portability","regulatory_expiry","billing_failure","region_failure"]){
    const r=simulateDigitalTwin(scenario,baseline,{count:6000,percent:25});
    assert.equal(r.scenario,scenario);
    assert.ok(Array.isArray(r.impacts)&&r.impacts.length>0);
    assert.equal(r.mutates_state,false);
  }
});

test("Control Tower is private, lazy-loaded and wired to both engines",async()=>{
  const [server,store,memory,commands,ui,build,size]=await Promise.all([
    readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
    readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
    readFile(new URL("../backend/src/store-memory.mjs",import.meta.url),"utf8"),
    readFile(new URL("../assets/command-palette.js",import.meta.url),"utf8"),
    readFile(new URL("../assets/control-tower.js",import.meta.url),"utf8"),
    readFile(new URL("../scripts/build-static.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/check-size.mjs",import.meta.url),"utf8")
  ]);
  for(const path of ["/api/v1/platform/control-tower","/api/v1/platform/policy/evaluate","/api/v1/platform/digital-twin/simulate"])assert.ok(server.includes(path),path);
  for(const token of ["controlTowerOverview","operationalPolicyEvaluation","digitalTwinSimulation"])assert.ok(store.includes(token),token);
  for(const token of ["controlTowerOverview","operationalPolicyEvaluation","digitalTwinSimulation"])assert.ok(memory.includes(token),token);
  for(const path of ["/platform/control-tower","/platform/policy/evaluate","/platform/digital-twin/simulate"])assert.ok(ui.includes(path),path);
  assert.ok(commands.includes("control-tower"));
  assert.ok(commands.includes('import(TOWER_URL)'));
  for(const token of ["Control Tower","Policy Engine","Digital Twin","AUCUN BRANCHEMENT EXTERNE","AUCUNE MUTATION"])assert.ok(ui.includes(token),token);
  assert.ok(build.includes("assets/control-tower.js"));
  assert.ok(size.includes('"assets/control-tower.js":16*1024'));
});
