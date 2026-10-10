// Synthetic cross-activity acceptance tests.
// NO real customer, NO carrier, NO Stripe mutation, NO external network.
// This test is picked up automatically by "npm test" and "npm run verify".
import test from "node:test";
import assert from "node:assert/strict";

import {consolidateProviderNeutralBusinessLive} from "../backend/src/direct-sva-business-live-continuity.mjs";
import {directSvaCustomerOverview,inspectDirectSvaWorkflows} from "../backend/src/direct-sva-customer.mjs";
import {PGI_BUSINESS_UNITS,planDirectSvaGa4Event,directSvaHubspotPlan} from "../backend/src/direct-sva-integrations.mjs";
import {directSvaProductionReadiness} from "../backend/src/direct-sva-production-readiness.mjs";
import {analyzeDirectSvaSettlement} from "../backend/src/direct-sva-reconciliation.mjs";
import {normalizeDirectSvaJournalDraft} from "../backend/src/direct-sva-business.mjs";
import {stripeProviderReadiness,stripeProviderState} from "../backend/src/stripe-billing.mjs";
import {normalizeStripeReferralRecipientAccount,calculateApplicationFee} from "../backend/src/stripe-connect.mjs";
import {normalizeBusinessLiveSchedule} from "../backend/src/business-live-schedule.mjs";

const tenant=42,number=99;
const ctx={tenant_id:tenant,sva_number_id:number,source_host_carrier_id:11,target_host_carrier_id:12,
 actual_cutover_at:"2026-10-09T12:00:00Z",business_live_reset_at:"2026-10-01T00:00:00Z",
 operator_cutover_verified:true,cdr_source_verified:true};
const prior={tenant_id:tenant,sva_number_id:number,host_carrier_id:11,canonical_call_key:"fake:call:before:001",
 started_at:"2026-10-08T10:00:00Z",billable_seconds:60,expected_client_net_minor:120,
 confirmed_client_net_minor:120,paid_client_net_minor:100,active:false};
const after={tenant_id:tenant,sva_number_id:number,host_carrier_id:12,canonical_call_key:"fake:call:after:002",
 started_at:"2026-10-09T13:00:00Z",billable_seconds:120,expected_client_net_minor:300,
 confirmed_client_net_minor:280,paid_client_net_minor:null,active:false};
const journal={source_reference:"DSVA-FAKE-20261010",description:"Écriture de recette fictive",
 evidence_reference:"FAKE-EVIDENCE-20261010",entry_date:"2026-10-10",
 lines:[{account_code:"411100",label:"Créance fictive",debit_minor:1500,credit_minor:0},
 {account_code:"706100",label:"Produit fictif",debit_minor:0,credit_minor:1500}]};
const statement={operator_reference:"OPERATOR-FAKE-001",statement_reference:"STATEMENT-FAKE-001",
 currency:"EUR",period:"2026-10",rows:[{cdr_reference:"CDR-FAKE-000001",called_number:"+33891234567",
 billable_seconds:120,upstream_net_minor:1000,pgi_margin_minor:200,publisher_due_minor:800}]};

test("the existing Audiotel brand is unchanged and Distribution has its own brand",()=>{
 assert.equal(PGI_BUSINESS_UNITS.audiotel_platform.label,"Audiotel Premium Pro");
 assert.equal(PGI_BUSINESS_UNITS.direct_sva.label,"PGI Telecom Distribution");
 assert.notEqual(PGI_BUSINESS_UNITS.audiotel_platform.analytic_cost_center,PGI_BUSINESS_UNITS.direct_sva.analytic_cost_center);
});

test("Business Live preserves two sides of the cutover without leaking carrier IDs",()=>{
 const out=consolidateProviderNeutralBusinessLive([prior,after],ctx);
 assert.equal(out.client_view.calls,2);
 assert.equal(out.client_view.billable_seconds,180);
 assert.equal(out.client_view.expected_client_net_minor,420);
 assert.equal(out.client_view.confirmed_client_net_minor,400);
 assert.equal(out.client_view.paid_client_net_minor,100);
 assert.ok(!Object.hasOwn(out.client_view,"source_host_carrier_id"));
 assert.equal(out.existing_customer_account_changed,false);
 assert.equal(out.existing_reset_schedule_changed,false);
});
test("Business Live ignores exact replay of a call",()=>{
 assert.equal(consolidateProviderNeutralBusinessLive([prior,prior,after],ctx).client_view.calls,2);
});
test("Business Live rejects another customer",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive([{...prior,tenant_id:tenant+1}],ctx),{code:"CONTINUITY_CROSS_TENANT_OR_NUMBER"});
});
test("Business Live rejects conflicting duplicate CDR",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive([prior,{...prior,expected_client_net_minor:200}],ctx),{code:"CONTINUITY_CONFLICTING_DUPLICATE_CDR"});
});
test("Business Live rejects wrong provider after cutover",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive([{...after,host_carrier_id:11}],ctx),{code:"CONTINUITY_CDR_WRONG_PROVIDER_EPOCH"});
});
test("Business Live refuses unverified carrier handover",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive([prior],{...ctx,operator_cutover_verified:false}),{code:"CONTINUITY_UNVERIFIED_PROVIDER_HANDOVER"});
});
test("Business Live refuses payments exceeding confirmed revenue",()=>{
 assert.throws(()=>consolidateProviderNeutralBusinessLive([{...prior,paid_client_net_minor:130}],ctx),{code:"CONTINUITY_PAID_UNCONFIRMED"});
});

test("the future customer space rejects a missing enrollment without another tenant query",async()=>{
 const calls=[];const store={readSql:{unsafe:async(query,args)=>{calls.push({query,args});return [];}}};
 await assert.rejects(()=>directSvaCustomerOverview(store,{tenant_id:tenant}),{code:"DIRECT_SVA_CUSTOMER_ACCESS_NOT_ASSIGNED"});
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].args,[tenant]);
});
test("the future customer space rejects a non-released account",async()=>{
 const store={readSql:{unsafe:async()=>[{tenant_id:tenant,access_state:"preparation",dashboard_enabled:false}]}};
 await assert.rejects(()=>directSvaCustomerOverview(store,{tenant_id:tenant}),{code:"DIRECT_SVA_CUSTOMER_NOT_RELEASED"});
});
test("synthetic customer data are always queried using the same tenant scope",async()=>{
 const seen=[];const store={readSql:{unsafe:async(query,args)=>{
  seen.push(args);
  if(query.includes("direct_sva_customer_accounts"))return [{tenant_id:tenant,access_state:"preparation",dashboard_enabled:true}];
  if(query.includes("direct_sva_customer_cases"))return [{public_reference:"DSVA-SIM-20261010",request_kind:"portability",status:"prepared",initiated_at:"2026-10-10T12:00:00Z"}];
  return [];
 }}};
 const out=await directSvaCustomerOverview(store,{tenant_id:tenant});
 assert.equal(out.business_unit,"direct_sva");
 assert.equal(out.source,"direct_sva_only");
 assert.equal(out.service_active,false);
 assert.equal(out.client_payouts_enabled,false);
 assert.equal(seen.length,3);
 assert.ok(seen.every(params=>JSON.stringify(params)===JSON.stringify([tenant])));
});
test("all 13 automation jobs remain non-executable in preparation",()=>{
 const out=inspectDirectSvaWorkflows([{workflow_key:"publisher_payout",count:1}]);
 assert.equal(out.jobs.length,13);
 assert.ok(out.jobs.every(job=>job.execution_authorized===false));
 assert.equal(out.automation_ready,false);
});
test("GA4 direct events are stopped before release",()=>{
 assert.equal(planDirectSvaGa4Event("dsva_operator_interest",
  {service_type:"distribution",funnel_stage:"interest"}).permitted,false);
});
test("GA4 direct events allowlist only three non-personal dimensions",()=>{
 const out=planDirectSvaGa4Event("dsva_operator_interest",
  {service_type:"distribution",funnel_stage:"interest",email:"fiction@example.test"},
  {directSvaReleased:true,ga4Consent:true,legalNetworkApproved:true});
 assert.equal(out.permitted,true);
 assert.deepEqual(Object.keys(out.payload.params).sort(),["pgi_business_unit","pgi_funnel_stage","pgi_service_type"].sort());
 assert.ok(!JSON.stringify(out).includes("fiction@example.test"));
});
test("HubSpot direct plan never writes to the current Audiotel pipeline",()=>{
 const out=directSvaHubspotPlan({source_reference:"DSVA-SIM-20261010",service_type:"distribution"},
  {schemaVerified:true,pipelineVerified:true,directSvaReleased:true,processingAuthorized:true});
 assert.equal(out.can_create_record,false);
 assert.equal(out.create_request,null);
 assert.equal(out.existing_deal_pipeline_untouched,true);
});

test("balanced distributor subledger entry is normalized with exact minor units",()=>{
 assert.equal(normalizeDirectSvaJournalDraft(journal).total_minor,1500);
});
test("unbalanced distributor entry is rejected",()=>{
 assert.throws(()=>normalizeDirectSvaJournalDraft({...journal,lines:[journal.lines[0],{...journal.lines[1],credit_minor:1400}]}),
  {code:"DIRECT_SVA_ENTRY_UNBALANCED"});
});
test("USD cannot leak into EUR distributor ledger",()=>{
 assert.throws(()=>normalizeDirectSvaJournalDraft({...journal,currency:"USD"}),{code:"DIRECT_SVA_CURRENCY_UNSUPPORTED"});
});
test("invalid distributor accounting date is refused",()=>{
 assert.throws(()=>normalizeDirectSvaJournalDraft({...journal,entry_date:"2026-02-31"}),{code:"DIRECT_SVA_ENTRY_DATE_INVALID"});
});
test("operator settlement split adds up with zero authorized payouts",()=>{
 const out=analyzeDirectSvaSettlement(statement);
 assert.equal(out.balanced,true);
 assert.equal(out.total_upstream_net_minor,1000);
 assert.equal(out.total_pgi_margin_minor,200);
 assert.equal(out.total_publisher_due_minor,800);
 assert.equal(out.bank_payout_authorized,false);
 assert.equal(out.funds_collected_verified,false);
});
test("operator settlement CDR replay is refused",()=>{
 const out=analyzeDirectSvaSettlement({...statement,rows:[statement.rows[0],statement.rows[0]]});
 assert.equal(out.balanced,false);
 assert.ok(out.issues.some(x=>x.code==="DUPLICATE_CDR_REFERENCE"));
});
test("operator settlement cannot overpay a publisher",()=>{
 const out=analyzeDirectSvaSettlement({...statement,rows:[{...statement.rows[0],publisher_due_minor:900}]});
 assert.equal(out.balanced,false);
 assert.ok(out.issues.some(x=>x.code==="UNBALANCED_DISTRIBUTION"));
});
test("operator settlement rejects non-SVA destination",()=>{
 const out=analyzeDirectSvaSettlement({...statement,rows:[{...statement.rows[0],called_number:"+33612345678"}]});
 assert.equal(out.balanced,false);
 assert.ok(out.issues.some(x=>x.code==="INVALID_DIRECT_SVA_NUMBER"));
});

test("Audiotel Stripe provider reports unconfigured without performing a request",()=>{
 assert.equal(stripeProviderState({externalBillingEnabled:false}).connected,false);
});
const fakeStripeConfig={externalBillingEnabled:true,stripeSecretKey:"sk_test_NO_NETWORK",stripeWebhookSecret:"whsec_NO_NETWORK",
 publicBaseUrl:"https://example.test",stripeLiveMode:true};
test("Audiotel Stripe account mock blocks charges-disabled state",async()=>{
 const out=await stripeProviderReadiness(fakeStripeConfig,{cacheTtlMs:0,fetchImpl:async()=>({ok:true,json:async()=>({
  charges_enabled:false,payouts_enabled:true,details_submitted:true
 })})});
 assert.equal(out.fully_operational,false);
 assert.equal(out.account_ready,false);
});
test("Audiotel Stripe account mock distinguishes charge rights and payouts",async()=>{
 const out=await stripeProviderReadiness(fakeStripeConfig,{cacheTtlMs:0,fetchImpl:async()=>({ok:true,json:async()=>({
  charges_enabled:true,payouts_enabled:false,details_submitted:true
 })})});
 assert.equal(out.account_ready,true);
 assert.equal(out.fully_operational,false);
});
test("Audiotel Stripe account mock fails closed when unavailable",async()=>{
 const out=await stripeProviderReadiness(fakeStripeConfig,{cacheTtlMs:0,fetchImpl:async()=>{throw Error("fake network failure")}});
 assert.equal(out.fully_operational,false);
 assert.equal(out.connected,false);
});
test("recipient Connect capability must really be active",()=>{
 const out=normalizeStripeReferralRecipientAccount({id:"acct_fake",configuration:{recipient:{capabilities:{
  stripe_balance:{stripe_transfers:{status:"pending"}}
 }}},requirements:{summary:{minimum_deadline:{status:"currently_due"}}}});
 assert.equal(out.transfers_enabled,false);
 assert.notEqual(out.status,"active");
});
test("Audiotel application fee calculator keeps minor amounts exact",()=>{
 assert.equal(calculateApplicationFee(10000,490),490);
});
test("existing Business Live can schedule a 120-day reset",()=>{
 const out=normalizeBusinessLiveSchedule({frequency:"interval_days",interval_days:120,anchor_date:"2026-10-10",time:"09:00"},
  {now:new Date("2026-10-10T08:00:00Z")});
 assert.equal(out.interval_days,120);
 assert.equal(out.timezone,"Europe/Paris");
});
test("existing Business Live refuses invalid monthly dates",()=>{
 assert.throws(()=>normalizeBusinessLiveSchedule({frequency:"monthly",month_day:32}),{code:"BUSINESS_LIVE_MONTH_DAY_INVALID"});
});

function mockReadiness({missingSchema=false,badConnector=false}={}){
 return{readSql:{unsafe:async sql=>{
  if(sql.includes("to_regclass("))return [{
   switches:!missingSchema,operator_ready:!missingSchema,integrations:!missingSchema,
   transitions:!missingSchema,automation:!missingSchema
  }];
  if(sql.includes("direct_sva_admin_switches"))return [{interface_preview_enabled:false,commercial_operation_enabled:false}];
  if(sql.includes("direct_sva_operator_controls"))return [{operator_mode:"preparation",number_activation_enabled:false,payouts_enabled:false}];
  if(sql.includes("direct_sva_integration_readiness"))return ["ga4","gsc","hubspot","statutory_accounting","network","payment_psp"]
   .map((integration_key,i)=>({integration_key,activation_status:"disabled",can_send_data:badConnector&&i===0}));
  if(sql.includes("direct_sva_automation_jobs"))return [{pending_count:0}];
  if(sql.includes("direct_sva_existing_customer_transition_plans"))return [{prepared_count:0}];
  throw Error("Unexpected in-memory SQL fixture");
 }}};
}
test("safety-only readiness never reports commercial clearance",async()=>{
 const out=await directSvaProductionReadiness(mockReadiness());
 assert.equal(out.internal_safety_controls_ok,true);
 assert.equal(out.production_launch_authorized,false);
 assert.equal(out.funds_transfer_authorized,false);
 assert.equal(out.external_gates.length,15);
});
test("simulated prematurely active connector fails release control",async()=>{
 const out=await directSvaProductionReadiness(mockReadiness({badConnector:true}));
 assert.equal(out.internal_safety_controls_ok,false);
 assert.equal(out.production_launch_authorized,false);
});
test("simulated missing migrations fail release control",async()=>{
 const out=await directSvaProductionReadiness(mockReadiness({missingSchema:true}));
 assert.equal(out.internal_safety_controls_ok,false);
 assert.equal(out.production_launch_authorized,false);
});
