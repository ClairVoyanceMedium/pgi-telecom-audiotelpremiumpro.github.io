// Offline / read-only go-live evidence gate. Never sends CRM, Google, bank or
// Stripe requests. All verification bits must be backed by real external evidence.
const TRACKED=["pgi_business_unit","pgi_funnel_stage","pgi_service_type"];
const HUBSPOT_FIELDS=["pgi_business_unit","pgi_source_reference","pgi_content_language","pgi_operator_onboarding_status"];
export function assessDirectSvaIntegrationAcceptance(evidence={}){
 const ga4=evidence.distribution_ga4||{},main=evidence.existing_audiotel_ga4||{},h=evidence.hubspot||{},g=evidence.gsc||{},
  bank=evidence.payment_psp||{},network=evidence.network||{},separation=evidence.separation||{};
 const checks=[
  {key:"ga4",ready:typeof ga4.property_id==="string"&&/^properties\/[0-9]+$/.test(ga4.property_id)&&
    ga4.property_id!==main.property_id&&/^G-[A-Z0-9]{8,}$/.test(ga4.measurement_id||"")&&
    ga4.measurement_id!=="G-SZY50J75N7"&&TRACKED.every(k=>(ga4.custom_dimensions_registered||[]).includes(k))&&
    ga4.consent_live_verification===true,
    reason:"GA4 dédiée distincte, définitions personnalisées et consentement prouvés"},
  {key:"gsc",ready:g.property_url==="https://audiotel-premium-pro.com/distribution-sva/"&&
    g.property_known===true&&g.sitemap_submitted===true&&g.pages_live===true,
    reason:"Propriété spécifique GSC, sitemap et pages réellement publiées"},
  {key:"hubspot",ready:h.portal_id==="149417663"&&
    typeof h.distribution_deal_pipeline==="string"&&h.distribution_deal_pipeline!=="default"&&
    h.distribution_deal_pipeline.length>0&&typeof h.distribution_ticket_pipeline==="string"&&
    h.distribution_ticket_pipeline!=="0"&&h.distribution_ticket_pipeline.length>0&&
    h.distribution_properties_provisioned===true&&
    HUBSPOT_FIELDS.every(k=>(h.verified_fields||[]).includes(k)),
    reason:"Pipelines et propriétés indépendants vérifiés dans HubSpot"},
  {key:"financial",ready:bank.authorized===true&&bank.financial_live_test===true,
    reason:"PSP autorisé et encaissements/retours webhook réels vérifiés"},
  {key:"network",ready:network.operator_contract_verified===true&&network.cdr_source_live===true,
    reason:"Contrat opérateur et relevés CDR réels vérifiés"},
  {key:"separation",ready:separation.audiotel_platform_unchanged===true&&
    separation.live_external_transfers_enabled===false,
    reason:"Audiotel inchangé, aucun flux externe automatique déclenché"}
 ];
 return Object.freeze({schema_version:"pgi-dsva-integrations-acceptance/1",business_unit:"direct_sva",
  checks:Object.freeze(checks.map(x=>Object.freeze({...x,status:x.ready?"evidence_present":"not_verified"}))),
  evidence_complete:checks.every(x=>x.ready),
  distribution_external_integrations_live:false,
  hubspot_write_permitted:false,ga4_emission_permitted:false,
  bank_transfer_permitted:false,production_activation_permitted:false,
  existing_audiotel_untouched:true});
}
