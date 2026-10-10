import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
 PGI_BUSINESS_UNITS,PGI_LEGAL_ENTITY_KEY,DIRECT_SVA_GA4_EVENTS,
 DIRECT_SVA_HUBSPOT_FIELDS,DIRECT_SVA_SEARCH_STRUCTURE,
 planDirectSvaGa4Event,directSvaHubspotPlan,directSvaIntegrationReadiness,
 directSvaIntegrationOverview,prepareDirectSvaHubspotDeal,assessPgiLegalAccountingProfile
} from "../backend/src/direct-sva-integrations.mjs";
import {createDirectSvaTracker} from "../site/direct-sva-tracking.js";

test("same legal entity and two separately named business units",()=>{
 assert.equal(PGI_BUSINESS_UNITS.audiotel_platform.legal_entity_key,PGI_LEGAL_ENTITY_KEY);
 assert.equal(PGI_BUSINESS_UNITS.direct_sva.legal_entity_key,PGI_LEGAL_ENTITY_KEY);
 assert.notEqual(PGI_BUSINESS_UNITS.audiotel_platform.crm_namespace,PGI_BUSINESS_UNITS.direct_sva.crm_namespace);
 assert.notEqual(PGI_BUSINESS_UNITS.audiotel_platform.analytic_cost_center,PGI_BUSINESS_UNITS.direct_sva.analytic_cost_center);
 assert.equal(DIRECT_SVA_SEARCH_STRUCTURE.public_pages_active,false);
 assert.equal(DIRECT_SVA_SEARCH_STRUCTURE.indexation_requested,false);
 assert.match(DIRECT_SVA_SEARCH_STRUCTURE.reserved_prefix,/^\/distribution-sva\/$/);
});

test("all direct SVA systems remain disabled until real approval",()=>{
 const result=directSvaIntegrationReadiness();
 assert.equal(result.one_legal_entity,true);
 assert.equal(result.single_legal_ledger_required,true);
 assert.equal(result.dedicated_ga4_property_required_before_launch,true);
 assert.equal(result.ga4_emission_enabled,false);
 assert.equal(result.hubspot_synchronization_enabled,false);
 assert.equal(result.direct_operator_activation_enabled,false);
 assert.equal(result.checks.length,6);
});

test("fake documented evidence never activates an external integration",()=>{
 const evidence=Object.fromEntries(["google_analytics","google_search_console","hubspot","accounting","sva_network","payments"].map(key=>[key,{status:"verified",reference:"SIGNED-123456"}]));
 const r=directSvaIntegrationReadiness(evidence);
 assert.equal(r.checks.every(x=>x.status==="documented"),true);
 assert.equal(r.checks.every(x=>x.ready_to_activate===false),true);
 assert.equal(r.hubspot_synchronization_enabled,false);
});

test("GA4 future events are allowlisted and no personal data can leak",()=>{
 const result=planDirectSvaGa4Event("dsva_number_request_submitted",
  {service_type:"numero_sva",funnel_stage:"request_submitted",email:"private@example.test",phone:"+33612345678"},
  {directSvaReleased:true,ga4Consent:true,legalNetworkApproved:true});
 assert.equal(result.permitted,true);
 assert.deepEqual(Object.keys(result.payload.params).sort(),["pgi_business_unit","pgi_funnel_stage","pgi_service_type"].sort());
 assert.equal(result.payload.params.pgi_business_unit,"direct_sva");
 assert.ok(!JSON.stringify(result).includes("private@example.test"));
 assert.ok(!JSON.stringify(result).includes("+33612345678"));
 assert.ok(DIRECT_SVA_GA4_EVENTS.dsva_contract_accepted);
 assert.throws(()=>planDirectSvaGa4Event("purchase",{service_type:"numero_sva",funnel_stage:"request_submitted"},{directSvaReleased:true,ga4Consent:true,legalNetworkApproved:true}),TypeError);
});

test("GA4 events stay disabled in preparation despite valid event schema",()=>{
 const r=planDirectSvaGa4Event("dsva_operator_interest",{service_type:"numero_sva",funnel_stage:"interest"});
 assert.equal(r.permitted,false);
 assert.equal(r.payload,null);
});

test("HubSpot direct deals cannot be sent or mixed with existing pipeline",()=>{
 const r=directSvaHubspotPlan({source_reference:"DSVA-00000001",service_type:"distribution"});
 assert.equal(r.business_unit,"direct_sva");
 assert.equal(r.deal_pipeline,"not_created");
 assert.equal(r.can_create_record,false);
 assert.equal(r.create_request,null);
 assert.equal(r.existing_deal_pipeline_untouched,true);
 assert.equal(DIRECT_SVA_HUBSPOT_FIELDS.dossier_reference,"pgi_dossier_ref");
 const forced=directSvaHubspotPlan({source_reference:"DSVA-00000001",service_type:"distribution"},
  {schemaVerified:true,pipelineVerified:true,directSvaReleased:true,processingAuthorized:true});
 assert.equal(forced.can_create_record,false);
});

test("future GA4 tracker stays dormant and rejects the original property",()=>{
 const calls=[];
 const base={documentRef:{},locationRef:{pathname:"/distribution-sva/offre/"},
  navigatorRef:{globalPrivacyControl:false},scriptLoader:url=>calls.push(url)};
 const disabled=createDirectSvaTracker({ga4:{enabled:false},...base});
 assert.equal(disabled.start().enabled,false);
 const duplicate=createDirectSvaTracker({ga4:{
  enabled:true,measurementId:"G-SZY50J75N7",consentGranted:true,legalApproved:true,
  dedicatedPropertyConfirmed:true,customDimensionRegistered:true,gtag:()=>{}
 },...base});
 assert.equal(duplicate.start().enabled,false);
 assert.equal(calls.length,0);
});

test("future GA4 tracker permits only enumerated events on approved direct pages",()=>{
 const calls=[],gtag=(...args)=>calls.push(args);
 const config={enabled:true,measurementId:"G-ABC1234567",consentGranted:true,legalApproved:true,
  dedicatedPropertyConfirmed:true,customDimensionRegistered:true,gtag};
 const make=(path,gpc=false)=>createDirectSvaTracker({
  ga4:config,documentRef:{},locationRef:{pathname:path},navigatorRef:{globalPrivacyControl:gpc},
  scriptLoader:url=>calls.push(["script",url])
 });
 assert.equal(make("/").start().enabled,false);
 assert.equal(make("/distribution-sva/",true).start().enabled,false);
 const tracker=make("/distribution-sva/numero-sva/");
 assert.equal(tracker.event("dsva_operator_interest","numero_sva").accepted,false);
 assert.equal(tracker.start().enabled,true);
 assert.equal(tracker.event("purchase","numero_sva").accepted,false);
 assert.equal(tracker.event("dsva_operator_interest","numero_sva").accepted,true);
 assert.equal(calls.filter(x=>x[0]==="event").length,1);
 assert.deepEqual(calls.find(x=>x[0]==="event")[2],{
  pgi_business_unit:"direct_sva",pgi_funnel_stage:"interest",pgi_service_type:"numero_sva"
 });
});

test("database-backed integration registry remains disabled and stays one legal company",async()=>{
 const queryTexts=[];
 const rows=[
  [{unit_code:"audiotel_platform",legal_accounting_profile_id:1,analytics_namespace:"audiotel",cost_center:"APP",display_name:"Audiotel Premium Pro",lifecycle_status:"existing",separate_legal_fec:false},
   {unit_code:"direct_sva",legal_accounting_profile_id:1,analytics_namespace:"distribution_directe",cost_center:"DSVA",display_name:"Distribution directe",lifecycle_status:"preparation",separate_legal_fec:false}],
  ["ga4","gsc","hubspot","statutory_accounting","network","payment_psp"].map(integration_key=>({integration_key,readiness_status:"planned",activation_status:"disabled",can_send_data:false})),
  [{legal_name:null,siren:null,vat_regime:"unconfigured",vat_rate_bps:null,account_map:{},fec_enabled:false}]
 ];
 let i=0;const store={readSql:{unsafe:async q=>{queryTexts.push(q);return rows[i++];}}};
 const result=await directSvaIntegrationOverview(store);
 assert.equal(result.units.length,2);
 assert.equal(result.all_direct_integrations_disabled,true);
 assert.equal(result.legal_fec_separated,false);
 assert.equal(result.checks.length,6);
 assert.equal(result.checks.every(x=>x.data_sending_enabled===false),true);
 assert.equal(queryTexts.length,3);
 assert.equal(result.shared_legal_accounting.legal_profile_ready_for_expert_review,false);
 assert.equal(result.shared_legal_accounting.legal_fec_operational,false);
 assert.equal(result.shared_legal_accounting.legal_profile_criteria.filter(x=>!x.ok).length,4);
 assert.ok(queryTexts.every(q=>/direct_sva_integration_readiness|pgi_company_business_units|platform_accounting_settings/.test(q)));
});

test("migration stores identical legal accounting profile and locks future network and CRM",()=>{
 const sql=fs.readFileSync(new URL("../database/migrations/074_single_company_two_business_units.sql",import.meta.url),"utf8");
 assert.match(sql,/REFERENCES platform_accounting_settings\(id\) CHECK\(legal_accounting_profile_id=1\)/);
 assert.match(sql,/separate_legal_fec boolean NOT NULL DEFAULT false CHECK\(separate_legal_fec=false\)/);
 assert.match(sql,/CHECK\(can_send_data=false\)/);
 assert.match(sql,/CHECK\(send_enabled=false\)/);
 assert.match(sql,/CHECK\(statutory_entry_id IS NULL\)/);
 assert.doesNotMatch(sql,/\bDROP\b|\bTRUNCATE\b|\bALTER\s+TABLE\b/i);
});

test("future direct URLs cannot emit existing Audiotel tag and GA4 Stripe remains attributed to Audiotel",()=>{
 const tracker=fs.readFileSync(new URL("../site/hubspot-tracking.js",import.meta.url),"utf8");
 const ga4=fs.readFileSync(new URL("../backend/src/ga4-measurement.mjs",import.meta.url),"utf8");
 const future=fs.readFileSync(new URL("../site/direct-sva-tracking.js",import.meta.url),"utf8");
 assert.match(tracker,/directDistributionPage/);
 assert.match(tracker,/if\(directDistributionPage\)return;/);
 assert.match(tracker,/pgi_business_unit:"audiotel_platform"/);
 assert.match(ga4,/pgi_business_unit:"audiotel_platform"/);
 assert.match(future,/RESERVED_PLATFORM_MEASUREMENT_ID="G-SZY50J75N7"/);
 assert.match(future,/pgi_business_unit:"direct_sva"/);
 const html=fs.readFileSync(new URL("../site/index.html",import.meta.url),"utf8");
 assert.ok(!html.includes('src="direct-sva-tracking.js"'));
});

test("HubSpot direct pipeline adapter refuses to reuse Audiotel default pipeline",()=>{
 const data={source_reference:"DSVA-00000123",service_type:"numero_sva",stage:"qualification"};
 const unsafe=prepareDirectSvaHubspotDeal(data,{pipelineId:"default",
  stageIds:{qualification:"stage_a"},verifiedForDirectSva:true,customFieldsVerified:true,
  consentVerified:true,directOperationReleased:true});
 assert.equal(unsafe.eligible,false);
 assert.equal(unsafe.payload,null);
 const notReady=prepareDirectSvaHubspotDeal(data,{pipelineId:"direct-pipeline",stageIds:{qualification:"stage_a"}});
 assert.equal(notReady.eligible,false);
 const candidate=prepareDirectSvaHubspotDeal(data,{pipelineId:"direct-pipeline",
  stageIds:{qualification:"direct-qualification"},verifiedForDirectSva:true,customFieldsVerified:true,
  consentVerified:true,directOperationReleased:true});
 assert.equal(candidate.eligible,true);
 assert.equal(candidate.payload.properties.pipeline,"direct-pipeline");
 assert.equal(candidate.payload.properties.pgi_business_unit,"direct_sva");
 assert.equal(candidate.payload.properties.pgi_source_reference,"DSVA-00000123");
 assert.equal(candidate.transmission_authorized,false);
 assert.ok(!JSON.stringify(candidate).includes("email"));
});

test("legal accounting readiness does not expose company identity or enable FEC prematurely",()=>{
 const incomplete=assessPgiLegalAccountingProfile({
  legal_name:null,siren:null,vat_regime:"unconfigured",vat_rate_bps:null,
  account_map:{},fec_enabled:false
 });
 assert.equal(incomplete.legal_profile_ready_for_expert_review,false);
 assert.equal(incomplete.fec_active,false);
 const completed=assessPgiLegalAccountingProfile({
  legal_name:"Societe exemple",siren:"123456789",vat_regime:"normal",vat_rate_bps:2000,
  account_map:{DSVA:"706100"},fec_enabled:true
 });
 assert.equal(completed.legal_profile_ready_for_expert_review,true);
 assert.equal(completed.legal_fec_operational,false);
 assert.equal(completed.direct_sva_included_in_fec,false);
 assert.ok(!JSON.stringify(completed).includes("123456789"));
 assert.ok(!JSON.stringify(completed).includes("Societe exemple"));
});

test("database connector drift is an incident, never masked as 'disabled'",async()=>{
 const units=[
  {unit_code:"audiotel_platform",legal_accounting_profile_id:1,separate_legal_fec:false},
  {unit_code:"direct_sva",legal_accounting_profile_id:1,separate_legal_fec:false}
 ];
 const base=["ga4","gsc","hubspot","statutory_accounting","network","payment_psp"].map(integration_key=>({
  integration_key,readiness_status:"planned",activation_status:"disabled",can_send_data:false
 }));
 for(const mutations of [
  x=>{x[0].can_send_data=true;},
  x=>{x[1].activation_status="enabled";},
  x=>{x.pop();},
  x=>{x.push({...x[0]});}
 ]){
  const checks=base.map(x=>({...x}));mutations(checks);
  let index=0;
  const rows=[units,checks,[{}]];
  const store={readSql:{unsafe:async()=>rows[index++]}};
  await assert.rejects(()=>directSvaIntegrationOverview(store),{
   status:503,code:"DIRECT_SVA_INTEGRATION_CONTROL_DRIFT"
  });
 }
});
