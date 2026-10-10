import test from "node:test";
import assert from "node:assert/strict";
import {auditDirectSvaFinancialEvidence as audit} from "../backend/src/direct-sva-financial-evidence-audit.mjs";
const base={business_unit:"direct_sva",source_adapter:"network",event_reference:"CDR-AUDIT-0001",
 currency:"EUR",expected_minor:100,confirmed_minor:80,paid_minor:40,
 source_payload_digest:"f".repeat(64),source_verification_state:"verified"};
test("duplicate exact operator evidence is counted once, no payout authorized",()=>{
 const x=audit([base,{...base}]);
 assert.equal(x.received_events,2);
 assert.equal(x.unique_external_events,1);
 assert.equal(x.exact_duplicates,1);
 assert.equal(x.totals_for_review.expected_minor,100);
 assert.equal(x.customer_payout_authorized,false);
 assert.equal(x.external_payment_executed,false);
 assert.equal(x.posting_authorized,false);
});
test("contradictory replay and cross-business records are rejected",()=>{
 for(const change of [{paid_minor:41},{confirmed_minor:79},{source_payload_digest:"a".repeat(64)},
  {source_verification_state:"pending"}]){
  assert.throws(()=>audit([base,{...base,...change}]),{code:"DIRECT_SVA_CONFLICTING_EXTERNAL_EVENT"});
 }
 assert.throws(()=>audit([{...base,business_unit:"audiotel_platform"}]),{code:"DIRECT_SVA_CROSS_BUSINESS_EVIDENCE"});
});
test("unverified external evidence is quarantined rather than counted as paid",()=>{
 const r=audit([{...base,source_verification_state:"pending"}]);
 assert.equal(r.unverified_unique_events,1);
 assert.equal(r.totals_for_review.expected_minor,0);
 assert.equal(r.totals_for_review.confirmed_minor,0);
 assert.equal(r.totals_for_review.paid_minor,0);
});
test("currency, numeric types, digest, source adapters and amounts fail closed",()=>{
 for(const change of [{currency:"USD"},{paid_minor:81},{confirmed_minor:101},
  {expected_minor:true,confirmed_minor:1,paid_minor:0},
  {paid_minor:"40"},{expected_minor:-1},{source_payload_digest:"weak"},
  {source_adapter:"audiotel"},{event_reference:"foo"}]){
  assert.throws(()=>audit([{...base,...change}]));
 }
});
test("1000 deterministic mixed-source financial records preserve integer sums without executing payouts",()=>{
 let z=71245,expected=0,confirmed=0,paid=0;const events=[];
 const rng=()=>((z=Math.imul(z,1664525)+1013904223>>>0),z);
 for(let i=0;i<1000;i++){
  const e=rng()%100000,conf=rng()%(e+1),p=rng()%(conf+1);
  expected+=e;confirmed+=conf;paid+=p;
  events.push({...base,event_reference:"DSVA-VALID-"+i+"-RECORD",
   source_adapter:["network","bank","payment_psp"][i%3],
   expected_minor:e,confirmed_minor:conf,paid_minor:p,
   source_payload_digest:i.toString(16).padStart(64,"0")});
 }
 const result=audit([...events,...events]);
 assert.equal(result.received_events,2000);
 assert.equal(result.unique_external_events,1000);
 assert.equal(result.exact_duplicates,1000);
 assert.equal(result.totals_for_review.expected_minor,expected);
 assert.equal(result.totals_for_review.confirmed_minor,confirmed);
 assert.equal(result.totals_for_review.paid_minor,paid);
 assert.equal(result.customer_payout_authorized,false);
});
test("empty provider pipeline cannot be certified live",()=>{
 const r=audit([]);
 assert.equal(r.production_ready,false);
 assert.equal(r.live_bank_settlement_verified,false);
 assert.equal(r.network_sources_authorized,false);
});
