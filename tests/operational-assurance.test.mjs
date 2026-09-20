import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {assessShadowBilling} from "../backend/src/shadow-billing.mjs";
import {assessOperationalRisk} from "../backend/src/risk-engine.mjs";
import {assessOperationalSlo} from "../backend/src/slo-assurance.mjs";
import {simulateDigitalTwin} from "../backend/src/digital-twin.mjs";

test("shadow billing separates missing external settlement from real variance",()=>{
  const waiting=assessShadowBilling([{currency:"EUR",expected_payout_ht:100,confirmed_payout_ht:0,paid_payout_ht:0,confirmed_calls:0,reconciliation_variance_ht:0}]);
  assert.equal(waiting.status,"waiting_external");
  assert.equal(waiting.mutates_state,false);
  const critical=assessShadowBilling([{currency:"EUR",expected_payout_ht:100,confirmed_payout_ht:96,paid_payout_ht:0,confirmed_calls:10,reconciliation_variance_ht:4}]);
  assert.equal(critical.status,"critical");
  assert.equal(critical.currencies[0].variance_ratio,.04);
});

test("Risk Engine is aggregate-only and escalates material conditions",()=>{
  const healthy=assessOperationalRisk({calls_7d:1000,failed_7d:10,expected_7d:1000,variance_7d:1,calls_last_hour:5,avg_hourly_7d:6,service_critical:0,regulatory_blocking:0,queue_dead_lettered:0});
  assert.equal(healthy.level,"healthy");
  assert.equal(healthy.privacy,"aggregate_only");
  const critical=assessOperationalRisk({calls_7d:1000,failed_7d:250,expected_7d:1000,variance_7d:30,calls_last_hour:100,avg_hourly_7d:5,service_critical:1,regulatory_blocking:1,queue_dead_lettered:1});
  assert.equal(critical.level,"critical");
  assert.equal(critical.score,100);
  assert.equal(critical.mutates_state,false);
});

test("operational SLO snapshot is explicit and does not invent API availability",()=>{
  const healthy=assessOperationalSlo({cdr_lag_seconds:20,queue_oldest_seconds:5,queue_dead_lettered:0,service_critical:0,resolution_overdue:0,regions_total:2,regions_ready:2});
  assert.equal(healthy.state,"healthy");
  assert.equal(healthy.score,100);
  assert.equal(healthy.api_availability.target_percent,99.9);
  assert.equal(healthy.api_availability.current_percent,null);
  const critical=assessOperationalSlo({cdr_lag_seconds:900,queue_oldest_seconds:500,queue_dead_lettered:2,service_critical:1,resolution_overdue:1,regions_total:2,regions_ready:1});
  assert.equal(critical.state,"critical");
  assert.ok(critical.score<100);
});

test("advanced Digital Twin chaos scenarios remain bounded and mutation-free",()=>{
  const baseline={active_assignments:1000,active_subscriptions:900,ready_numbers:950,total_numbers:1000,route_standby_ready:true,destination_capacity:2000,current_concurrent:100,regions_ready:2,regions_total:2,dr_targets:2,read_replica_enabled:true,queue_pending:25,queue_dead_lettered:0,bucket_capacity:4096};
  for(const scenario of ["database_failure","worker_backlog","settlement_mismatch","hyperscale_growth"]){
    const r=simulateDigitalTwin(scenario,baseline,{pending:100000000,percent:3,clients:100000000,calls_per_client_day:100000});
    assert.equal(r.schema_version,"audiotel-digital-twin/2");
    assert.equal(r.dry_run,true);
    assert.equal(r.mutates_state,false);
    assert.ok(r.impacts.length>0);
  }
  const scale=simulateDigitalTwin("hyperscale_growth",baseline,{clients:100000000,calls_per_client_day:100000});
  assert.equal(scale.affected,10000000);
  assert.match(scale.impacts[0].detail,/10000000 client/);
  const backlog=simulateDigitalTwin("worker_backlog",baseline,{pending:100000000});
  assert.equal(backlog.affected,10000000);
});

test("four-eyes migration and private APIs retain immutable audit controls",async()=>{
  const [migration,server,store,memory,ui,production]=await Promise.all([
    readFile(new URL("../database/migrations/044_operational_assurance.sql",import.meta.url),"utf8"),
    readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
    readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
    readFile(new URL("../backend/src/store-memory.mjs",import.meta.url),"utf8"),
    readFile(new URL("../assets/control-tower-assurance.js",import.meta.url),"utf8"),
    readFile(new URL("../scripts/check-production-contract.mjs",import.meta.url),"utf8")
  ]);
  for(const token of ["CREATE TABLE platform_change_requests","CREATE TABLE platform_change_approval_events","approved_by<>requested_by","append-only","platform_change_requests_no_delete"])assert.ok(migration.includes(token),token);
  for(const path of ["/api/v1/platform/change-requests","/api/v1/platform/change-requests/:id/approve","/api/v1/platform/change-requests/:id/reject"])assert.ok(server.includes(path),path);
  for(const token of ["DUAL_CONTROL_APPROVAL_REQUIRED","FOUR_EYES_SECOND_APPROVER_REQUIRED","appendChangeApprovalEvent","assessShadowBilling","assessOperationalRisk","assessOperationalSlo"])assert.ok(store.includes(token),token);
  for(const token of ["DUAL_CONTROL_APPROVAL_REQUIRED","FOUR_EYES_SECOND_APPROVER_REQUIRED"])assert.ok(memory.includes(token),token);
  for(const token of ["Risk Engine","Shadow billing","Validations 4 yeux","Le demandeur ne peut jamais approuver sa propre action"])assert.ok(ui.includes(token),token);
  assert.ok(production.includes("044_operational_assurance.sql"));
});
