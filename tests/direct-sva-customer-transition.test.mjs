import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {eligibleExistingCustomerNumbers,preparedExistingCustomerTransitions,
 prepareExistingCustomerTransition,transitionReadiness}
 from "../backend/src/direct-sva-customer-transition.mjs";
import {consolidateProviderNeutralBusinessLive}
 from "../backend/src/direct-sva-business-live-continuity.mjs";

const admin={role:"admin",sub:"migration-admin-001"};
const sample={assignment_id:40,target_mode:"direct_sva",evidence_reference:"PGI-TRANSITION-2026-001"};

function mocked(){
 const queries=[],writes=[];
 const tx={unsafe:async(q,params=[])=>{
  queries.push(q);
  if(q.includes("FROM direct_sva_admin_switches"))return [{interface_preview_enabled:true,commercial_operation_enabled:false}];
  if(q.includes("FROM tenant_number_assignments a JOIN sva_numbers"))return [{
   id:40,tenant_id:11,sva_number_id:22,status:"active",
   e164:"+33891234567",number_status:"active"
  }];
  if(q.includes("FROM number_carrier_assignments"))return [{carrier_id:33}];
  if(q.includes("max(revision_no)"))return [{next_revision:1}];
  if(q.includes("INSERT INTO direct_sva_existing_customer_transition_plans")){
   writes.push(q);return [{id:57,state:"prepared",created_at:"2026-10-10T11:00:00Z"}];
  }
  if(q.includes("INSERT INTO direct_sva_existing_customer_transition_audit")){writes.push(q);return [];}
  return [];
 }};
 return {store:{sql:{begin:async callback=>callback(tx),unsafe:tx.unsafe},
   readSql:{unsafe:async()=>[]}},queries,writes};
}

test("preparation never authorizes telecom, client contract changes or financial transfer",()=>{
 const ready=transitionReadiness(Object.fromEntries([
  "operator_and_portability_approved","portability_mandate_verified",
  "client_notice_and_contract_reviewed","old_provider_settlement_boundary_verified",
  "new_provider_contract_and_tariffs_verified","inflight_calls_drained",
  "route_and_rsva_verified","cdr_deduplication_verified",
  "business_live_continuity_verified","psp_and_kyc_verified"
 ].map(k=>[k,true])));
 assert.equal(ready.evidences_documented,ready.evidences_required);
 assert.equal(ready.commercial_cutover_authorized,false);
 assert.equal(ready.payout_execution_authorized,false);
});

test("real customer migration creates only a documented, private preparation record",async()=>{
 const {store,queries,writes}=mocked();
 const r=await prepareExistingCustomerTransition(store,admin,sample);
 assert.equal(r.number,"+33891234567");
 assert.equal(r.revision,1);
 assert.equal(r.tenant_id,11);
 assert.equal(r.source_host_carrier_id,33);
 assert.equal(r.existing_audiotel_unchanged,true);
 assert.equal(r.routing_change_executed,false);
 assert.equal(r.portability_executed,false);
 assert.equal(r.payout_executed,false);
 assert.equal(writes.length,2);
 assert.ok(queries.every(q=>!/^\s*(?:UPDATE|DELETE|TRUNCATE|ALTER)\s/i.test(q)));
 assert.ok(queries.every(q=>!/activate_logical_carrier_route|portability_events|tenant_revenue_distributions/.test(q)));
});

test("no admin rights, no target, no documentary proof: fail closed",async()=>{
 const {store}=mocked();
 for(const actor of [null,{role:"finance",sub:"staff"},{role:"admin",sub:""}])
  await assert.rejects(()=>prepareExistingCustomerTransition(store,actor,sample),{status:403});
 await assert.rejects(()=>prepareExistingCustomerTransition(store,admin,{...sample,target_mode:"other"}),{status:400});
 await assert.rejects(()=>prepareExistingCustomerTransition(store,admin,{...sample,evidence_reference:"x"}),{status:400});
 await assert.rejects(()=>prepareExistingCustomerTransition(store,admin,{...sample,target_carrier_id:33}),{status:400});
});

test("source switch OFF blocks plans, regardless of caller role",async()=>{
 const {store}=mocked();
 store.sql.begin=async fn=>fn({unsafe:async q=>{
  if(q.includes("FROM direct_sva_admin_switches"))
   return [{interface_preview_enabled:false,commercial_operation_enabled:false}];
  throw Error("No further DB action permitted");
 }});
 await assert.rejects(()=>prepareExistingCustomerTransition(store,admin,sample),
  {code:"DIRECT_SVA_TRANSITION_PREVIEW_DISABLED"});
});

test("ambiguous or absent hosting carrier blocks transition planning",async()=>{
 for(const rows of [[],[{carrier_id:33},{carrier_id:34}]]){
  const {store}=mocked();
  store.sql.begin=async fn=>fn({unsafe:async q=>{
   if(q.includes("FROM direct_sva_admin_switches"))
    return [{interface_preview_enabled:true,commercial_operation_enabled:false}];
   if(q.includes("FROM tenant_number_assignments"))
    return [{id:40,tenant_id:11,sva_number_id:22,status:"active",e164:"+33891234567",number_status:"active"}];
   if(q.includes("FROM number_carrier_assignments"))return rows;
   throw Error("No unsafe downstream writes");
  }});
  await assert.rejects(()=>prepareExistingCustomerTransition(store,admin,sample),
   {code:"DIRECT_SVA_SOURCE_HOST_AMBIGUOUS_OR_MISSING"});
 }
});

test("no cross-tenant financial or customer data is returned in private candidate listing",async()=>{
 const log=[];
 const store={sql:{begin(){},unsafe(){}},readSql:{unsafe:async(q,params)=>{
  log.push({q,params});return [{
   assignment_id:40,tenant_id:11,sva_number_id:22,e164:"+33891234567",
   number_status:"active",source_host_carrier_id:33,source_host_name:"Source",
   has_preparation_plan:false
  }];}}};
 const eligible=await eligibleExistingCustomerNumbers(store,{tenant_id:11});
 assert.equal(eligible.records[0].eligible_to_prepare,true);
 assert.equal(eligible.records[0].tenant_id,11);
 assert.deepEqual(log[0].params,[11]);
 assert.match(log[0].q,/WHERE a.status='active'/);
 assert.match(log[0].q,/a.tenant_id=\$1::bigint/);
 assert.ok(!JSON.stringify(eligible).includes("customer_email"));
});

test("existing plans expose only preparation, never an executed transition",async()=>{
 const store={sql:{begin(){},unsafe(){}},readSql:{unsafe:async()=>[{
  id:57,tenant_id:11,assignment_id:40,sva_number_id:22,e164_snapshot:"+33891234567",
  source_host_carrier_id:33,target_mode:"direct_sva",state:"prepared"
 }]}};
 const result=await preparedExistingCustomerTransitions(store,{tenant_id:11});
 assert.equal(result.plans[0].commercial_cutover_authorized,false);
 assert.equal(result.financial_changes_executed,false);
 assert.equal(result.client_changes_executed,false);
});

const context={tenant_id:11,sva_number_id:22,source_host_carrier_id:33,
 target_host_carrier_id:34,operator_cutover_verified:true,cdr_source_verified:true,
 actual_cutover_at:"2026-11-01T00:00:00Z",business_live_reset_at:"2026-10-01T00:00:00Z"};
const row=(key,host,date,amount)=>({
 tenant_id:11,sva_number_id:22,host_carrier_id:host,canonical_call_key:key,
 started_at:date,billable_seconds:60,expected_client_net_minor:amount,
 confirmed_client_net_minor:amount,paid_client_net_minor:0,active:false
});

test("Business Live stays on one tenant and one number through the real cutover",()=>{
 const a=row("canonical-call-0001",33,"2026-10-20T12:00:00Z",140);
 const b=row("canonical-call-0002",34,"2026-11-02T12:00:00Z",190);
 const out=consolidateProviderNeutralBusinessLive([a,b],context);
 assert.equal(out.client_view.calls,2);
 assert.equal(out.client_view.expected_client_net_minor,330);
 assert.equal(out.client_view.confirmed_client_net_minor,330);
 assert.equal(out.client_view.paid_client_net_minor,0);
 assert.equal(out.client_view.billable_seconds,120);
 assert.equal(out.administrator_view.by_carrier.length,2);
 assert.equal(out.existing_reset_schedule_changed,false);
 assert.equal(out.external_network_switch_executed,false);
 assert.ok(!JSON.stringify(out.client_view).includes("host_carrier"));
});

test("idempotent CDR replay is counted only once; contradictory duplicates are blocked",()=>{
 const a=row("canonical-call-0001",33,"2026-10-20T12:00:00Z",140);
 const original=consolidateProviderNeutralBusinessLive([a,{...a}],context);
 assert.equal(original.client_view.calls,1);
 assert.throws(()=>consolidateProviderNeutralBusinessLive([a,{...a,expected_client_net_minor:180}],context),
  {code:"CONTINUITY_CONFLICTING_DUPLICATE_CDR"});
});

test("epoch mismatch, missing actual cutover, cross-tenant or invalid settlements are blocked",()=>{
 const old=row("canonical-call-0001",33,"2026-11-02T00:00:00Z",100);
 assert.throws(()=>consolidateProviderNeutralBusinessLive([old],context),{code:"CONTINUITY_CDR_WRONG_PROVIDER_EPOCH"});
 const current=row("canonical-call-0002",34,"2026-11-02T00:00:00Z",100);
 assert.throws(()=>consolidateProviderNeutralBusinessLive([current],{...context,operator_cutover_verified:false}),
  {code:"CONTINUITY_UNVERIFIED_PROVIDER_HANDOVER"});
 assert.throws(()=>consolidateProviderNeutralBusinessLive([{...current,tenant_id:12}],context),
  {code:"CONTINUITY_CROSS_TENANT_OR_NUMBER"});
 assert.throws(()=>consolidateProviderNeutralBusinessLive([{...current,paid_client_net_minor:120}],context),
  {code:"CONTINUITY_PAID_UNCONFIRMED"});
});

test("transition migration cannot change historical customers or routing",()=>{
 const migration=fs.readFileSync(new URL("../database/migrations/077_existing_customer_provider_transition_preparation.sql",import.meta.url),"utf8");
 assert.match(migration,/customer_account_preserved boolean NOT NULL DEFAULT true CHECK\(customer_account_preserved=true\)/);
 assert.match(migration,/routing_authorized boolean NOT NULL DEFAULT false CHECK\(routing_authorized=false\)/);
 assert.match(migration,/money_transfer_authorized boolean NOT NULL DEFAULT false CHECK\(money_transfer_authorized=false\)/);
 assert.match(migration,/direct_sva_transition_immutable/);
 assert.doesNotMatch(migration,/\bDROP\b|\bTRUNCATE\b|\bUPDATE\s+\btenant_number_assignments\b/i);
 const frontend=fs.readFileSync(new URL("../assets/direct-sva-transitions.js",import.meta.url),"utf8");
 const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
 assert.match(frontend,/data-transition-form/);
 assert.match(server,/pathname==="\/api\/v1\/platform\/direct-sva\/transitions\/prepare"/);
 assert.match(server,/requireCsrf\(req,actor,config\)/);
});


test("same technical carrier can serve two verified PGI commercial epochs",()=>{
 const shared={...context,target_host_carrier_id:33,
  source_contract_epoch:"PARTNER-2026-V1",target_contract_epoch:"PGI-DIRECT-2026-V2"};
 const old={...row("canonical-call-0010",33,"2026-10-20T12:00:00Z",100),
  contract_epoch_reference:"PARTNER-2026-V1"};
 const next={...row("canonical-call-0011",33,"2026-11-02T12:00:00Z",160),
  contract_epoch_reference:"PGI-DIRECT-2026-V2"};
 const result=consolidateProviderNeutralBusinessLive([old,next],shared);
 assert.equal(result.client_view.expected_client_net_minor,260);
 assert.equal(result.administrator_view.by_carrier.length,2);
 assert.equal(result.administrator_view.by_carrier[0].epoch,"source");
 assert.equal(result.administrator_view.by_carrier[1].epoch,"target");
 assert.throws(()=>consolidateProviderNeutralBusinessLive([{...next,contract_epoch_reference:"PARTNER-2026-V1"}],shared),
  {code:"CONTINUITY_CDR_CONTRACT_EPOCH_UNVERIFIED"});
 assert.throws(()=>consolidateProviderNeutralBusinessLive([next],{...shared,
  target_contract_epoch:"PARTNER-2026-V1"}),{code:"CONTINUITY_DISTINCT_CONTRACT_EPOCHS_REQUIRED"});
});

test("stale Business Live feeds visibly warn rather than claim fresh calls",()=>{
 const client=fs.readFileSync(new URL("../assets/client-live-finance.js",import.meta.url),"utf8");
 const admin=fs.readFileSync(new URL("../assets/live-finance.js",import.meta.url),"utf8");
 for(const code of [client,admin]){
  assert.match(code,/age>90000/);
  assert.match(code,/Données en cours de synchronisation/);
 }
});
