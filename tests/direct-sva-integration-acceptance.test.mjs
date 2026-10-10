import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {assessDirectSvaIntegrationAcceptance as audit} from "../backend/src/direct-sva-integration-acceptance.mjs";
const snapshot=()=>JSON.parse(fs.readFileSync("config/pgi-direct-sva-integrations-audit-2026-10-10.json","utf8"));
test("real read-only connector evidence blocks unfinished Distribution rollout",()=>{
 const result=audit(snapshot());
 assert.equal(result.evidence_complete,false);
 assert.equal(result.production_activation_permitted,false);
 assert.equal(result.existing_audiotel_untouched,true);
 for(const x of ["ga4","gsc","hubspot","financial","network"])assert.equal(result.checks.find(v=>v.key===x).ready,false);
});
test("existing Audiotel GA4 must not be mistaken for a Distribution property",()=>{
 const base=snapshot();
 base.distribution_ga4={property_id:base.existing_audiotel_ga4.property_id,measurement_id:"G-SZY50J75N7",
  custom_dimensions_registered:["pgi_business_unit","pgi_funnel_stage","pgi_service_type"],consent_live_verification:true};
 assert.equal(audit(base).checks.find(x=>x.key==="ga4").ready,false);
});
test("HubSpot's current default pipeline can never satisfy separation",()=>{
 const x=snapshot();
 x.hubspot.distribution_deal_pipeline="default";
 x.hubspot.distribution_ticket_pipeline="0";
 x.hubspot.distribution_properties_provisioned=true;
 x.hubspot.verified_fields=["pgi_business_unit","pgi_source_reference","pgi_content_language","pgi_operator_onboarding_status"];
 assert.equal(audit(x).checks.find(y=>y.key==="hubspot").ready,false);
});
test("even complete future proofs do not automatically authorize any live action",()=>{
 const x=snapshot();
 x.distribution_ga4={property_id:"properties/700000001",measurement_id:"G-AAA12345678",
  custom_dimensions_registered:["pgi_business_unit","pgi_funnel_stage","pgi_service_type"],consent_live_verification:true};
 x.gsc.sitemap_submitted=true;x.gsc.pages_live=true;
 x.hubspot={portal_id:"149417663",distribution_deal_pipeline:"direct_sva_verified",distribution_ticket_pipeline:"direct_tickets_verified",
  distribution_properties_provisioned:true,verified_fields:["pgi_business_unit","pgi_source_reference","pgi_content_language","pgi_operator_onboarding_status"]};
 x.payment_psp={authorized:true,financial_live_test:true};x.network={operator_contract_verified:true,cdr_source_live:true};
 const r=audit(x);
 assert.equal(r.evidence_complete,true);
 assert.equal(r.production_activation_permitted,false);
 assert.equal(r.ga4_emission_permitted,false);
 assert.equal(r.hubspot_write_permitted,false);
 assert.equal(r.bank_transfer_permitted,false);
});
test("all launch gate dimensions require individually verified proof",()=>{
 const clean=audit(snapshot());
 for(const check of clean.checks)assert.ok(check.reason.length>15);
 assert.ok(clean.checks.some(x=>x.status==="not_verified"));
});
