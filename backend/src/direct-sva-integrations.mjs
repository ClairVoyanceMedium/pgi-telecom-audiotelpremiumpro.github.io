// Shared company, two independently controlled business activities.
// Preparation metadata only. No GA4 calls, CRM writes, Search Console submissions or activation.
export const PGI_LEGAL_ENTITY_KEY="pgi_primary";

export const PGI_BUSINESS_UNITS=Object.freeze({
 audiotel_platform:Object.freeze({
  key:"audiotel_platform",label:"Audiotel Premium Pro",
  legal_entity_key:PGI_LEGAL_ENTITY_KEY,
  current_role:"existing_platform_business",
  crm_namespace:"audiotel",
  analytic_cost_center:"APP",
  direct_sva_authorized:false
 }),
 direct_sva:Object.freeze({
  key:"direct_sva",label:"PGI Telecom Distribution",
  legal_entity_key:PGI_LEGAL_ENTITY_KEY,
  current_role:"future_direct_sva_operator",
  crm_namespace:"distribution_directe",
  analytic_cost_center:"DSVA",
  direct_sva_authorized:false
 })
});

export const DIRECT_SVA_INTEGRATIONS=Object.freeze([
 Object.freeze({key:"google_analytics",label:"Google Analytics 4",target:"dedicated_direct_sva_property_not_created",requires:["separate_business_unit_parameter","custom_dimension_registration","consent_audit","conversion_deduplication"]}),
 Object.freeze({key:"google_search_console",label:"Google Search Console",target:"existing_domain_property_with_distinct_paths",requires:["dedicated_public_pages","sitemap_segment","indexability_review","verified_ownership"]}),
 Object.freeze({key:"hubspot",label:"HubSpot",target:"same_portal_distinct_pipeline_and_properties",requires:["business_unit_property","dedicated_deal_pipeline","dedicated_forms","contact_deduplication","consent_compliance"]}),
 Object.freeze({key:"accounting",label:"Comptabilite legale",target:"single_company_ledger_with_separate_cost_centers",requires:["expert_accountant_account_mapping","single_fec_export","source_reconciliation","tax_review"]}),
 Object.freeze({key:"sva_network",label:"Interconnexion et numerotation",target:"direct_operator_only_when_authorized",requires:["arcep_attribution","apnf_rsva","carrier_contract","cdr_reconciliation"]}),
 Object.freeze({key:"payments",label:"Flux financiers SVA",target:"approved_payment_structure_only",requires:["psp_authorization","kyc_audit","carrier_payment_confirmation","publisher_entitlements"]})
]);

// Stable, generic metadata. Never contains email, phone, IP, dossier IDs, CDR IDs or user-provided text.
export const DIRECT_SVA_GA4_EVENTS=Object.freeze({
 dsva_operator_interest:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_navigation_click:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_section_view:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_faq_open:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_portal_access_attempt:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_form_error:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_number_request_started:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_number_request_submitted:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_portability_request_submitted:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_contract_accepted:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
 dsva_number_activated:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"])
});

export const DIRECT_SVA_HUBSPOT_FIELDS=Object.freeze({
 business_unit:"pgi_business_unit",
 origin_reference:"pgi_source_reference",
 dossier_reference:"pgi_dossier_ref",
 number_type:"pgi_sva_product_type",
 operator_status:"pgi_operator_onboarding_status"
});

export const DIRECT_SVA_SEARCH_STRUCTURE=Object.freeze({
 country:"FR",
 canonical_host:"audiotel-premium-pro.com",
 reserved_prefix:"/distribution-sva/",
 direct_business_prefix:"/distribution-sva/",
 public_pages_active:false,
 sitemap_submitted:false,
 indexation_requested:false,
 current_audiotel_paths_unchanged:true,
 site_property:"sc-domain:audiotel-premium-pro.com"
});

const SAFE_TYPES=new Set(["numero_sva","portabilite","interconnexion","distribution"]);
const SAFE_STAGES=new Set(["interest","request_started","request_submitted","contract_accepted","number_activated"]);

export function planDirectSvaGa4Event(name,data={},options={}){
 if(!Object.hasOwn(DIRECT_SVA_GA4_EVENTS,name))throw new TypeError("Unknown direct SVA GA4 event");
 if(options?.directSvaReleased!==true||options?.ga4Consent!==true||options?.legalNetworkApproved!==true){
  return {permitted:false,payload:null,reason:"DIRECT_SVA_ANALYTICS_NOT_RELEASED"};
 }
 const service=String(data.service_type||"").trim();
 const stage=String(data.funnel_stage||"").trim();
 if(!SAFE_TYPES.has(service)||!SAFE_STAGES.has(stage))throw new TypeError("Invalid direct SVA event context");
 const expectedStage={
  dsva_operator_interest:"interest",
  dsva_navigation_click:"interest",
  dsva_section_view:"interest",
  dsva_faq_open:"interest",
  dsva_portal_access_attempt:"interest",
  dsva_form_error:"request_started",
  dsva_number_request_started:"request_started",
  dsva_number_request_submitted:"request_submitted",
  dsva_portability_request_submitted:"request_submitted",
  dsva_contract_accepted:"contract_accepted",
  dsva_number_activated:"number_activated"
 }[name];
 if(stage!==expectedStage)throw new TypeError("Direct SVA event-stage mismatch");
 // Construct from exact allowlist. No arbitrary browser parameters or personal data are passed through.
 return Object.freeze({permitted:true,reason:"SCHEMA_READY_ONLY_NO_TRANSMISSION",
  payload:Object.freeze({event:name,params:Object.freeze({
   pgi_business_unit:"direct_sva",pgi_funnel_stage:stage,pgi_service_type:service
  })})});
}

export function directSvaHubspotPlan(input={},options={}){
 // CRM writes must remain disabled until an approved schema, dedicated pipeline and owner are confirmed.
 const ref=String(input.source_reference||"").trim();
 if(!/^DSVA-[A-Za-z0-9_-]{6,80}$/.test(ref))throw new TypeError("Invalid direct SVA CRM source reference");
 const safeType=String(input.service_type||"").trim();
 if(!SAFE_TYPES.has(safeType))throw new TypeError("Invalid direct SVA CRM product");
 const linkedCompany=String(input.legal_entity_key||PGI_LEGAL_ENTITY_KEY);
 if(linkedCompany!==PGI_LEGAL_ENTITY_KEY)throw new TypeError("Cannot link two legal entities");
 return Object.freeze({
  business_unit:"direct_sva",legal_entity_key:PGI_LEGAL_ENTITY_KEY,
  hubspot_object:"deal",deal_pipeline:"not_created",
  source_reference:ref,product_type:safeType,
  target_fields:DIRECT_SVA_HUBSPOT_FIELDS,
  existing_contact_preserved:true,
  existing_deal_pipeline_untouched:true,
  eligible_for_later_schema_review:options?.schemaVerified===true&&options?.pipelineVerified===true&&
   options?.directSvaReleased===true&&options?.processingAuthorized===true,
  can_create_record:false,
  create_request:null // No write request is generated, even if all planning gates are set.
 });
}

export function directSvaIntegrationReadiness(evidence={}){
 const checks=DIRECT_SVA_INTEGRATIONS.map(s=>{
  const provided=evidence?.[s.key];
  const verified=provided?.status==="verified" && typeof provided?.reference==="string" && provided.reference.trim().length>=6;
  return Object.freeze({
   key:s.key,label:s.label,target:s.target,
   status:verified?"documented":"not_verified",
   evidence_expected:s.requires,
   ready_to_activate:false
  });
 });
 return Object.freeze({
  schema_version:"pgi-direct-sva-integration-readiness/1",
  legal_entity_key:PGI_LEGAL_ENTITY_KEY,
  business_units:Object.keys(PGI_BUSINESS_UNITS),
  distribution_directe_status:"preparation",
  one_legal_entity:true,
  single_legal_ledger_required:true,
  gsc_domain_property_kept:true,
  direct_gsc_prefix_property_required_before_launch:true,
  dedicated_ga4_property_required_before_launch:true,
  ga4_emission_enabled:false,
  hubspot_synchronization_enabled:false,
  search_index_submission_enabled:false,
  accounting_merge_enabled:false,
  direct_operator_activation_enabled:false,
  checks
 });
}

const INTEGRATION_TO_DB=Object.freeze({
 google_analytics:"ga4",google_search_console:"gsc",hubspot:"hubspot",
 accounting:"statutory_accounting",sva_network:"network",payments:"payment_psp"
});

export function assessPgiLegalAccountingProfile(profile){
 const record=profile&&typeof profile==="object"?profile:{};
 const legalName=typeof record.legal_name==="string"&&record.legal_name.trim().length>=2;
 const siren=typeof record.siren==="string"&&/^[0-9]{9}$/.test(record.siren.trim());
 const regime=String(record.vat_regime||"unconfigured");
 const vatRegime=["normal","simplified","franchise","exempt"].includes(regime);
 const vatRate=["normal","simplified"].includes(regime)
  ? Number.isInteger(record.vat_rate_bps)&&record.vat_rate_bps>=0&&record.vat_rate_bps<=10000:true;
 const mapping=record.account_map&&typeof record.account_map==="object"&&!Array.isArray(record.account_map)&&
  Object.keys(record.account_map).length>0;
 const checklist=[
  {key:"legal_name",ok:legalName,label:"Dénomination juridique"},
  {key:"siren",ok:siren,label:"SIREN de la société"},
  {key:"vat_regime",ok:vatRegime,label:"Régime fiscal et TVA"},
  {key:"vat_rate",ok:vatRate,label:"Taux TVA adapté au régime"},
  {key:"account_mapping",ok:Boolean(mapping),label:"Affectation des comptes comptables"}
 ];
 return Object.freeze({
  single_legal_accounting_profile:true,
  legal_profile_criteria:checklist,
  legal_profile_ready_for_expert_review:checklist.every(c=>c.ok),
  fec_active:record.fec_enabled===true,
  direct_sva_included_in_fec:false,
  legal_fec_operational:false,
  note:"Le FEC unique n'est possible qu'après le rapprochement du journal distributeur et une validation comptable et fiscale."
 });
}

export async function directSvaIntegrationOverview(store){
 if(!store?.readSql?.unsafe)throw Object.assign(new Error("DIRECT_SVA_POSTGRES_REQUIRED"),{status:503,code:"DIRECT_SVA_POSTGRES_REQUIRED"});
 const [units,checks,legalProfiles]=await Promise.all([
  store.readSql.unsafe("SELECT unit_code,legal_accounting_profile_id,analytics_namespace,cost_center,display_name,lifecycle_status,separate_legal_fec FROM pgi_company_business_units ORDER BY unit_code"),
  store.readSql.unsafe("SELECT integration_key,readiness_status,activation_status,can_send_data,evidence_reference,last_review_at FROM direct_sva_integration_readiness ORDER BY integration_key"),
  store.readSql.unsafe("SELECT legal_name,siren,vat_regime,vat_rate_bps,account_map,fec_enabled FROM platform_accounting_settings WHERE id=1")
 ]);
 if(units.length!==2||!units.every(x=>Number(x.legal_accounting_profile_id)===1&&x.separate_legal_fec===false))throw Object.assign(new Error("DIRECT_SVA_ENTITY_STRUCTURE_INVALID"),{status:503,code:"DIRECT_SVA_ENTITY_STRUCTURE_INVALID"});
 const plan=directSvaIntegrationReadiness();
 const expected=new Set(Object.values(INTEGRATION_TO_DB));
 const observed=checks.map(x=>x.integration_key);
 // A missing integration, unexpected row or unauthorized data-sending state
 // is a configuration incident, not a healthy disabled connector.
 if(checks.length!==expected.size||new Set(observed).size!==expected.size||
    checks.some(x=>!expected.has(x.integration_key)||x.activation_status!=="disabled"||
                   x.can_send_data!==false))
   throw Object.assign(new Error("DIRECT_SVA_INTEGRATION_CONTROL_DRIFT"),
    {status:503,code:"DIRECT_SVA_INTEGRATION_CONTROL_DRIFT"});
 const ledger=Object.fromEntries(checks.map(x=>[x.integration_key,x]));
 return Object.freeze({
  ...plan,
  units:units.map(u=>({code:u.unit_code,label:u.display_name,analytic_cost_center:u.cost_center,
   shared_accounting_profile_id:Number(u.legal_accounting_profile_id),lifecycle:u.lifecycle_status})),
  checks:plan.checks.map(c=>{
   const state=ledger[INTEGRATION_TO_DB[c.key]];
   return {...c,
    recorded_state:state?.readiness_status||"unregistered",
    activation_status:"disabled",data_sending_enabled:false,
    evidence_reference_present:Boolean(state?.evidence_reference)
   };
  }),
  all_direct_integrations_disabled:checks.every(x=>x.activation_status==="disabled"&&x.can_send_data===false),
  shared_legal_accounting:assessPgiLegalAccountingProfile(legalProfiles[0]),
  legal_fec_separated:false
 });
}

const DIRECT_DEAL_STAGE_SET=new Set(["new","qualification","proposal","contract_signed","closedwon","closedlost"]);

export function prepareDirectSvaHubspotDeal(input={},configuration={}){
 const planned=directSvaHubspotPlan(input,{schemaVerified:false,pipelineVerified:false});
 const stage=String(input.stage||"").trim();
 if(!DIRECT_DEAL_STAGE_SET.has(stage))throw new TypeError("Invalid direct SVA deal stage");
 const pipe=String(configuration.pipelineId||"").trim(),stageId=configuration.stageIds?.[stage];
 if(!pipe||pipe==="default"||!stageId||typeof stageId!=="string")return Object.freeze({
  eligible:false,reason:"DIRECT_SVA_DEDICATED_PIPELINE_UNVERIFIED",business_unit:"direct_sva",payload:null
 });
 if(configuration.verifiedForDirectSva!==true||configuration.customFieldsVerified!==true||
    configuration.consentVerified!==true||configuration.directOperationReleased!==true){
  return Object.freeze({eligible:false,reason:"DIRECT_SVA_CRM_CONFIGURATION_NOT_APPROVED",
   business_unit:"direct_sva",payload:null});
 }
 return Object.freeze({
  eligible:true,reason:"PAYLOAD_READY_FOR_SEPARATE_EXTERNAL_APPROVAL",
  business_unit:"direct_sva",
  // Only a business-level reference, not an individual's name, email, phone or a numbered call.
  payload:Object.freeze({properties:Object.freeze({
   dealname:"PGI Telecom Distribution "+planned.source_reference,
   pipeline:pipe,dealstage:stageId,
   [DIRECT_SVA_HUBSPOT_FIELDS.business_unit]:"direct_sva",
   [DIRECT_SVA_HUBSPOT_FIELDS.origin_reference]:planned.source_reference,
   [DIRECT_SVA_HUBSPOT_FIELDS.number_type]:planned.product_type
  })}),
  transmission_authorized:false
 });
}
