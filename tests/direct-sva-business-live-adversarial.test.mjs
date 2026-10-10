import test from "node:test";
import assert from "node:assert/strict";
import {consolidateProviderNeutralBusinessLive as consolidate} from "../backend/src/direct-sva-business-live-continuity.mjs";

const context={
 tenant_id:101,sva_number_id:201,source_host_carrier_id:301,target_host_carrier_id:302,
 operator_cutover_verified:true,cdr_source_verified:true,
 actual_cutover_at:"2026-10-10T12:00:00Z",business_live_reset_at:"2026-10-09T00:00:00Z"
};
const record={
 tenant_id:101,sva_number_id:201,host_carrier_id:302,canonical_call_key:"CALL-2026-0000001",
 started_at:"2026-10-10T13:00:00Z",ended_at:"2026-10-10T13:02:00Z",
 active:false,billable_seconds:120,expected_client_net_minor:100,
 confirmed_client_net_minor:80,paid_client_net_minor:60
};
test("a truly identical CDR replay is idempotent, including the recorded end time",()=>{
 const one=consolidate([record],context),twice=consolidate([record,{...record}],context);
 assert.deepEqual(twice.client_view,one.client_view);
 assert.equal(twice.client_view.calls,1);
 assert.equal(twice.client_view.confirmed_client_net_minor,80);
 assert.equal(twice.client_view.paid_client_net_minor,60);
 assert.equal(twice.administrator_view.deduplicated_cdr,1);
});
test("the same canonical CDR identifier cannot silently change its end time",()=>{
 const changed={...record,ended_at:"2026-10-10T13:03:00Z"};
 assert.throws(()=>consolidate([record,changed],context),{code:"CONTINUITY_CONFLICTING_DUPLICATE_CDR"});
});
test("a contradictory source contract epoch cannot bypass CDR replay conflict checks",()=>{
 const changed={...record,contract_epoch_reference:"CONTRACT-EPOCH-CHANGED"};
 assert.throws(()=>consolidate([record,changed],context),{code:"CONTINUITY_CONFLICTING_DUPLICATE_CDR"});
});
test("CDR identifiers reject booleans, arrays, scientific strings and non-integral values",()=>{
 const one={...context,tenant_id:1,sva_number_id:1,source_host_carrier_id:2,target_host_carrier_id:3};
 const r={...record,tenant_id:1,sva_number_id:1,host_carrier_id:3};
 for(const invalid of [true,false,[],[1],{},"1e0","01"," 1 ","+1",1.5,0,-1,null,undefined]){
  assert.throws(()=>consolidate([{...r,tenant_id:invalid}],one),{code:"CONTINUITY_INVALID_ROW_TENANT"});
  assert.throws(()=>consolidate([{...r,sva_number_id:invalid}],one),{code:"CONTINUITY_INVALID_ROW_NUMBER"});
  assert.throws(()=>consolidate([r],{...one,tenant_id:invalid}),{code:"CONTINUITY_INVALID_TENANT"});
 }
 assert.equal(consolidate([r],one).client_view.calls,1);
});
test("cross-tenant or cross-number CDR facts are never merged",()=>{
 for(const field of ["tenant_id","sva_number_id"]){
  assert.throws(()=>consolidate([{...record,[field]:999}],context),{code:"CONTINUITY_CROSS_TENANT_OR_NUMBER"});
 }
});
test("cutover timing is enforced against both carriers, including spanning calls",()=>{
 const before={...record,canonical_call_key:"CALL-2026-BEFORE1",host_carrier_id:301,
  started_at:"2026-10-10T11:45:00Z",ended_at:"2026-10-10T11:47:00Z"};
 assert.equal(consolidate([before,record],context).client_view.calls,2);
 assert.throws(()=>consolidate([{...before,host_carrier_id:302}],context),{code:"CONTINUITY_CDR_WRONG_PROVIDER_EPOCH"});
 assert.throws(()=>consolidate([{...before,ended_at:"2026-10-10T12:01:00Z"}],context),{code:"CONTINUITY_CALL_SPANS_CUTOVER_NEEDS_SEGMENT"});
 assert.throws(()=>consolidate([record],{...context,operator_cutover_verified:false}),{code:"CONTINUITY_UNVERIFIED_PROVIDER_HANDOVER"});
});
test("contract epochs must be distinct for the same physical provider",()=>{
 const same={...context,source_host_carrier_id:302,target_host_carrier_id:302};
 assert.throws(()=>consolidate([record],same),{code:"CONTINUITY_DISTINCT_CONTRACT_EPOCHS_REQUIRED"});
 const verified={...same,source_contract_epoch:"CONTRACT-2026-OLD",target_contract_epoch:"CONTRACT-2026-NEW"};
 assert.equal(consolidate([{...record,contract_epoch_reference:"CONTRACT-2026-NEW"}],verified).client_view.calls,1);
 assert.throws(()=>consolidate([record],verified),{code:"CONTINUITY_CDR_CONTRACT_EPOCH_UNVERIFIED"});
});
test("paid money cannot exceed confirmed amounts and other invalid CDR values are blocked",()=>{
 assert.throws(()=>consolidate([{...record,paid_client_net_minor:81}],context),{code:"CONTINUITY_PAID_UNCONFIRMED"});
 assert.throws(()=>consolidate([{...record,confirmed_client_net_minor:null,paid_client_net_minor:10}],context),{code:"CONTINUITY_PAID_UNCONFIRMED"});
 assert.throws(()=>consolidate([{...record,billable_seconds:-1}],context),{code:"CONTINUITY_INVALID_SECONDS"});
 assert.throws(()=>consolidate([{...record,billable_seconds:86401}],context),{code:"CONTINUITY_BILLABLE_SECONDS_RANGE"});
 assert.throws(()=>consolidate([{...record,active:true}],context),{code:"CONTINUITY_ACTIVE_CALL_HAS_END_TIME"});
});
test("1000 deterministic multi-call trials conserve exact sums and neutral replay",()=>{
 let state=0x12345678;
 function rand(){state^=state<<13;state^=state>>>17;state^=state<<5;return state>>>0;}
 for(let trial=0;trial<1000;trial++){
  const batch=[];
  const len=1+(rand()%10);
  let expected=0,confirmed=0,paid=0,seconds=0;
  for(let i=0;i<len;i++){
   const value=rand()%100000,conf=rand()%(value+1),pay=rand()%(conf+1),sec=rand()%7200;
   const started=new Date(Date.UTC(2026,9,10,13,0,0)+i*30*60*1000);
   const ended=new Date(started.getTime()+sec*1000);
   batch.push({...record,canonical_call_key:"CALL-ROBUST-"+trial+"-"+i,
    started_at:started.toISOString(),ended_at:ended.toISOString(),
    billable_seconds:sec,expected_client_net_minor:value,
    confirmed_client_net_minor:conf,paid_client_net_minor:pay});
   expected+=value;confirmed+=conf;paid+=pay;seconds+=sec;
  }
  const report=consolidate([...batch,...batch],context);
  assert.equal(report.client_view.calls,len,"trial "+trial);
  assert.equal(report.client_view.billable_seconds,seconds,"trial "+trial);
  assert.equal(report.client_view.expected_client_net_minor,expected,"trial "+trial);
  assert.equal(report.client_view.confirmed_client_net_minor,confirmed,"trial "+trial);
  assert.equal(report.client_view.paid_client_net_minor,paid,"trial "+trial);
  assert.equal(report.administrator_view.deduplicated_cdr,len);
  assert.equal(report.external_network_switch_executed,false);
  assert.equal(report.existing_customer_number_changed,false);
 }
});
test("500 deterministic cross-tenant injections never reach a client total",()=>{
 for(let i=0;i<500;i++){
  const injected={...record,canonical_call_key:"CALL-ATTACK-"+i+"-01",
   tenant_id:102+(i%100),expected_client_net_minor:i*100};
  assert.throws(()=>consolidate([record,injected],context),{code:"CONTINUITY_CROSS_TENANT_OR_NUMBER"});
 }
});
test("500 conflicting end-time replays always halt reconciliation",()=>{
 for(let i=0;i<500;i++){
  const source={...record,canonical_call_key:"CALL-END-"+i+"-REF"};
  const diff={...source,ended_at:new Date(Date.parse(source.ended_at)+1000*(i+1)).toISOString()};
  assert.throws(()=>consolidate([source,diff],context),{code:"CONTINUITY_CONFLICTING_DUPLICATE_CDR"});
 }
});
