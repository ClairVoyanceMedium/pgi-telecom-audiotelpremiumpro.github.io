// Cockpit response-source boundary: no real account, no payment or network calls.
// Protects Audiotel Premium Pro against any cross-activity data rendered in DSVA.
import test from "node:test";
import assert from "node:assert/strict";
import {assertDirectSvaCockpitPayload} from "../assets/direct-sva-cockpit.js";

function snapshot(){
 return {
  business_unit:"direct_sva",source:"independent_direct_sva_tables",
  separated_from:"audiotel_platform",currency:"EUR",operator_mode:"preparation",
  activation_authorized:false,payout_authorized:false,
  number_activation_enabled:false,automatic_payout_enabled:false,
  number_blocks:[],number_inventory:[],interconnections:[],
  accounting:{
   revenue_minor:1000,expenses_minor:300,operating_result_minor:700,
   receivables_change_minor:200,publisher_liabilities_change_minor:800,
   suspense_change_minor:0,entries:[]
  }
 };
}
const error={message:"DIRECT_SVA_COCKPIT_RESPONSE_INVALID"};
test("a strictly distributor-only financial report can render",()=>{
 const data=snapshot();
 assert.equal(assertDirectSvaCockpitPayload(data),data);
});
test("the Audiotel activity never renders in PGI Telecom Distribution cockpit",()=>{
 assert.throws(()=>assertDirectSvaCockpitPayload({...snapshot(),business_unit:"audiotel_platform"}),error);
});
test("unexpected payout activation invalidates the whole cockpit report",()=>{
 assert.throws(()=>assertDirectSvaCockpitPayload({...snapshot(),automatic_payout_enabled:true}),error);
});
test("invalid or missing financial amounts never silently become zero in cockpit",()=>{
 for(const amount of [null,undefined,NaN,Infinity,"1000"]){
  assert.throws(()=>assertDirectSvaCockpitPayload({
   ...snapshot(),accounting:{...snapshot().accounting,revenue_minor:amount}
  }),error);
 }
});
test("an arithmetic inconsistency invalidates the report",()=>{
 assert.throws(()=>assertDirectSvaCockpitPayload({
  ...snapshot(),accounting:{...snapshot().accounting,operating_result_minor:701}
 }),error);
});
test("a preview of carrier settlement cannot claim a bank payout occurred",()=>{
 const plan={business_unit:"direct_sva",analysis_mode:"untrusted_source_preview",
  approved_by_operator:false,accounting_write_authorized:false,bank_payout_authorized:false,
  number_activation_authorized:false,issues:[],input_rows:1,accepted_rows:1,rejected_rows:0,total_upstream_net_minor:1000,total_pgi_margin_minor:200,total_publisher_due_minor:800};
 assert.equal(assertDirectSvaCockpitPayload(plan,"settlement"),plan);
 assert.throws(()=>assertDirectSvaCockpitPayload({...plan,bank_payout_authorized:true},"settlement"),error);
});
test("a direct CRM or payment integration cannot be displayed as disabled when transmitting",()=>{
 const record={all_direct_integrations_disabled:true,ga4_emission_enabled:false,hubspot_synchronization_enabled:false,search_index_submission_enabled:false,direct_operator_activation_enabled:false,
  units:[{code:"audiotel_platform",label:"Audiotel Premium Pro"},
   {code:"direct_sva",label:"PGI Telecom Distribution"}],
  checks:Array.from({length:6},()=>({data_sending_enabled:false}))};
 assert.equal(assertDirectSvaCockpitPayload(record,"integrations"),record);
 assert.throws(()=>assertDirectSvaCockpitPayload({...record,
  checks:[{data_sending_enabled:true},...record.checks.slice(1)]},"integrations"),error);
});
test("13 automation workflows must all remain non-executing",()=>{
 const plan={business_unit:"direct_sva",mode:"preparation",
  external_execution_enabled:false,transfers_enabled:false,automatic_number_activation:false,
  jobs:Array.from({length:13},()=>({execution_authorized:false}))};
 assert.equal(assertDirectSvaCockpitPayload(plan,"automation"),plan);
 assert.throws(()=>assertDirectSvaCockpitPayload({...plan,
  jobs:[{execution_authorized:true},...plan.jobs.slice(1)]},"automation"),error);
});
test("the complaints tab cannot show unapproved Gmail/HubSpot sending",()=>{
 const record={business_unit:"direct_sva",public_form_enabled:false,payments_enabled:false,operator_actions_active:false,
  gmail_delivery_active:false,hubspot_delivery_active:false};
 assert.equal(assertDirectSvaCockpitPayload(record,"complaints"),record);
 assert.throws(()=>assertDirectSvaCockpitPayload({...record,gmail_delivery_active:true},"complaints"),error);
});
