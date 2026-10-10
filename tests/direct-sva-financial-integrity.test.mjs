// Regression suite: distributor-only financial integrity, operator transition
// and dry-run automation. No real customer, Stripe payment or CDR ingestion.
import test from "node:test";
import assert from "node:assert/strict";
import {consolidateProviderNeutralBusinessLive} from "../backend/src/direct-sva-business-live-continuity.mjs";
import {directSvaAccountingExport} from "../backend/src/direct-sva-business.mjs";
import {makeDirectSvaWorkflowSimulation} from "../backend/src/direct-sva-automation-rehearsal.mjs";

const tenant=42,number=73;
const context={
 tenant_id:tenant,sva_number_id:number,source_host_carrier_id:11,target_host_carrier_id:12,
 actual_cutover_at:"2026-10-10T12:00:00Z",business_live_reset_at:"2026-10-01T00:00:00Z",
 operator_cutover_verified:true,cdr_source_verified:true
};
const call={
 tenant_id:tenant,sva_number_id:number,host_carrier_id:11,
 canonical_call_key:"TESTCALL-OCT2026-01",started_at:"2026-10-10T11:55:00Z",
 ended_at:"2026-10-10T11:59:00Z",billable_seconds:240,
 expected_client_net_minor:300,confirmed_client_net_minor:300,paid_client_net_minor:null,active:false
};

test("a call entirely before cutover remains attributable to its original operator",()=>{
 const out=consolidateProviderNeutralBusinessLive([call],context);
 assert.equal(out.client_view.calls,1);
 assert.equal(out.administrator_view.by_carrier[0].calls,1);
 assert.equal(out.administrator_view.by_carrier[1].calls,0);
});
test("a call spanning the cutover requires verified split CDRs, never invented income",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive(
  [{...call,ended_at:"2026-10-10T12:02:00Z"}],context
 ),{code:"CONTINUITY_CALL_SPANS_CUTOVER_NEEDS_SEGMENT"});
});
test("a still-active call from the old provider cannot silently be priced after cutover",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive(
  [{...call,ended_at:null,active:true}],context
 ),{code:"CONTINUITY_CALL_SPANS_CUTOVER_NEEDS_SEGMENT"});
});
test("CDR with an end time earlier than its start is rejected",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive(
  [{...call,ended_at:"2026-10-10T11:54:59Z"}],context
 ),{code:"CONTINUITY_CDR_END_BEFORE_START"});
});
test("CDR cannot be marked active while also having a final end timestamp",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive(
  [{...call,active:true}],context
 ),{code:"CONTINUITY_ACTIVE_CALL_HAS_END_TIME"});
});
test("a call crossing the Business Live reset boundary must be source-segmented",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive(
  [{...call,started_at:"2026-09-30T23:59:00Z",ended_at:"2026-10-01T00:01:00Z"}],context
 ),{code:"CONTINUITY_CALL_SPANS_RESET_NEEDS_SEGMENT"});
});

function row(line_no,debit_minor,credit_minor){
 return {journal_entry_id:"501",entry_date:"2026-10-10",source_reference:"DSVA-FAKE-501",
  source_system:"manual_evidence",source_digest:"f".repeat(64),
  description:"Ecriture fictive de recette",status:"draft",evidence_reference:"DOC-SIMULATION-501",
  line_no,account_code:line_no===1?"411100":"467200",
  line_label:"Ligne "+line_no,debit_minor:String(debit_minor),credit_minor:String(credit_minor)};
}
function storeWith(rows){
 const queries=[];
 return {queries,store:{sql:{begin:async()=>{}},readSql:{unsafe:async(query,params)=>{
  queries.push({query,params});return rows;
 }}}};
}
test("a balanced, sequential entry is exportable only as non-FEC",async()=>{
 const {store,queries}=storeWith([row(1,850,0),row(2,0,850)]);
 const out=await directSvaAccountingExport(store,{month:"2026-10"});
 assert.equal(out.complete_for_period,true);
 assert.equal(out.exported_entries,1);
 assert.equal(out.exported_lines,2);
 assert.equal(out.document_type,"management_subledger_not_legal_fec");
 assert.match(queries[0].query,/LEFT JOIN direct_sva_journal_lines/);
 assert.match(queries[0].query,/e\.business_unit='direct_sva'/);
});
test("a journal header with no child lines cannot be certified as a complete export",async()=>{
 const {store}=storeWith([{...row(null,0,0),line_no:null,account_code:null}]);
 await assert.rejects(()=>directSvaAccountingExport(store,{month:"2026-10"}),{
  code:"DIRECT_SVA_EXPORT_ENTRY_WITHOUT_LINES"
 });
});
test("an entry with missing sequence number two is rejected",async()=>{
 const {store}=storeWith([row(1,850,0),row(3,0,850)]);
 await assert.rejects(()=>directSvaAccountingExport(store,{month:"2026-10"}),{
  code:"DIRECT_SVA_EXPORT_LINE_SEQUENCE_INVALID"
 });
});
test("an entry containing only one line is never marked as a complete export",async()=>{
 const {store}=storeWith([row(1,850,0)]);
 await assert.rejects(()=>directSvaAccountingExport(store,{month:"2026-10"}),{
  code:"DIRECT_SVA_EXPORT_CONTAINS_UNBALANCED_ENTRIES"
 });
});

const job={
 workflow_key:"publisher_payout",source_reference:"DSVA-SIM-PAYOUTTEST20261010",
 idempotency_key:"DSVA-SIM-KEY-PAYOUTTEST20261010",
 facts:{psp_mandate:true,editor_kyc:true,collected_funds:true,approved_statement:true}
};
const clock=new Date("2026-10-10T13:00:00Z");
test("a fully evidenced automation is still a simulation, never a publisher payment",()=>{
 const out=makeDirectSvaWorkflowSimulation(job,clock);
 assert.equal(out.result_status,"ready_for_simulation");
 assert.equal(out.external_action_executed,false);
 assert.equal(out.payout_executed,false);
 assert.equal(out.crm_synced,false);
 assert.equal(out.analytics_emitted,false);
 assert.equal(out.next_step,"SIMULATED_ONLY");
});
test("missing PSP evidence prevents payout automation even inside a mock",()=>{
 const out=makeDirectSvaWorkflowSimulation({...job,facts:{...job.facts,psp_mandate:false}},clock);
 assert.equal(out.result_status,"missing_inputs");
 assert.ok(out.missing_checks.includes("psp_mandate"));
 assert.equal(out.payout_executed,false);
});
test("temporary network error produces bounded retry in preparation, not an executed payout",()=>{
 const out=makeDirectSvaWorkflowSimulation({...job,failure_mode:"timeout",attempt_number:2},clock);
 assert.equal(out.result_status,"retry_planned");
 assert.ok(out.next_simulation_at);
 assert.equal(out.external_action_executed,false);
});
test("after five failed attempts the automation requires review rather than retry forever",()=>{
 const out=makeDirectSvaWorkflowSimulation({...job,failure_mode:"rate_limit",attempt_number:5},clock);
 assert.equal(out.result_status,"manual_review");
 assert.equal(out.review_needed,true);
 assert.equal(out.next_simulation_at,null);
});
test("unexpected workflow fields are refused instead of propagated to downstream systems",()=>{
 assert.throws(()=>makeDirectSvaWorkflowSimulation({...job,bank_account:"FR_FAKE"},clock),{
  code:"DSVA_SIMULATION_INPUT_UNEXPECTED"
 });
});
