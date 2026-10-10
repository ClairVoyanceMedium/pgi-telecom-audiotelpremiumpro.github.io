import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const schema=JSON.parse(fs.readFileSync("config/pgi-direct-sva-hubspot-manifest.json","utf8"));
test("HubSpot Distribution is a separate prepared namespace, never existing default pipeline",()=>{
 assert.equal(schema.business_unit,"direct_sva");
 assert.equal(schema.production_status,"not_provisioned");
 assert.equal(schema.proposed_pipelines.deals.id,null);
 assert.equal(schema.proposed_pipelines.tickets.id,null);
 assert.equal(schema.proposed_pipelines.deals.not_default,true);
 assert.equal(schema.proposed_pipelines.tickets.not_default,true);
 assert.deepEqual(schema.current_verified.deals_pipeline,["default"]);
 assert.equal(schema.rules.no_reuse_audiotel_default_pipeline,true);
 assert.equal(schema.rules.no_fictitious_contacts,true);
 assert.equal(schema.rules.no_default_on_existing_contacts,true);
 assert.equal(schema.rules.do_not_overwrite_existing_audiotel_records,true);
});
test("HubSpot direct contact/deal/ticket fields are explicit, no auto writes",()=>{
 assert.equal(schema.proposed_properties.length,11);
 const known=new Set(schema.proposed_properties.map(p=>p.object_type+":"+p.name));
 assert.equal(known.size,schema.proposed_properties.length);
 for(const type of ["contacts","deals","tickets"]){
  assert.ok(known.has(type+":pgi_business_unit"));
 }
 assert.ok(known.has("contacts:pgi_content_language"));
 assert.ok(known.has("deals:pgi_content_language"));
 assert.ok(known.has("tickets:pgi_complaint_reference"));
 for(const p of schema.proposed_properties){
  assert.equal(p.write_during_prelaunch,false);
  assert.equal(p.default_value,null);
  assert.ok(p.name.startsWith("pgi_"));
 }
});
test("every business unit and language uses a bounded enumeration",()=>{
 const property=schema.proposed_properties.find(p=>p.object_type==="contacts"&&p.name==="pgi_business_unit");
 assert.deepEqual(property.options.map(x=>x.value),["audiotel_platform","direct_sva"]);
 const langs=schema.proposed_properties.find(p=>p.object_type==="contacts"&&p.name==="pgi_content_language");
 assert.deepEqual(langs.options.map(x=>x.value),["fr","en","es","pt","de","it"]);
});
test("no external HubSpot writes or leaking contact data to GA4",()=>{
 assert.equal(schema.rules.no_live_records_in_preparation,true);
 assert.equal(schema.rules.do_not_send_without_processing_basis,true);
 assert.equal(schema.rules.no_tracking_personal_data_sent_to_ga4,true);
 assert.equal(schema.rules.ga4_and_hubspot_must_not_share_preconsent_leads,true);
});
