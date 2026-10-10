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
  key:"direct_sva",label:"Distribution SVA directe",
  legal_entity_key:PGI_LEGAL_ENTITY_KEY,
  current_role:"future_direct_sva_operator",
  crm_namespace:"distribution_directe",
  analytic_cost_center:"DSVA",
  direct_sva_authorized:false
 })
});

export const DIRECT_SVA_INTEGRATIONS=Object.freeze([
 Object.freeze({key:"google_analytics",label:"Google Analytics 4",target:"same_company_property_prepared",requires:["separate_business_unit_parameter","custom_dimension_registration","consent_audit","conversion_deduplication"]}),
 Object.freeze({key:"google_search_console",label:"Google Search Console",target:"existing_domain_property_with_distinct_paths",requires:["dedicated_public_pages","sitemap_segment","indexability_review","verified_ownership"]}),
 Object.freeze({key:"hubspot",label:"HubSpot",target:"same_portal_distinct_pipeline_and_properties",requires:["business_unit_property","dedicated_deal_pipeline","dedicated_forms","contact_deduplication","consent_compliance"]}),
 Object.freeze({key:"accounting",label:"Comptabilite legale",target:"single_company_ledger_with_separate_cost_centers",requires:["expert_accountant_account_mapping","single_fec_export","source_reconciliation","tax_review"]}),
 Object.freeze({key:"sva_network",label:"Interconnexion et numerotation",target:"direct_operator_only_when_authorized",requires:["arcep_attribution","apnf_rsva","carrier_contract","cdr_reconciliation"]}),
 Object.freeze({key:"payments",label:"Flux financiers SVA",target:"approved_payment_structure_only",requires:["psp_authorization","kyc_audit","carrier_payment_confirmation","publisher_entitlements"]})
]);

// Stable, generic metadata. Never contains email, phone, IP, dossier IDs, CDR IDs or user-provided text.
export const DIRECT_SVA_GA4_EVENTS=Object.freeze({
 dsva_operator_interest:Object.freeze(["pgi_business_unit","pgi_funnel_stage","pgi_service_type"]),
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
  can_create_record:options?.schemaVerified===true&&options?.pipelineVerified===true&&
   options?.directSvaReleased===true&&options?.processingAuthorized===true,
  create_request:null // Never perform a CRM write from a planning function.
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
  gsc_site_stays_existing:true,
  ga4_emission_enabled:false,
  hubspot_synchronization_enabled:false,
  search_index_submission_enabled:false,
  accounting_merge_enabled:false,
  direct_operator_activation_enabled:false,
  checks
 });
}
