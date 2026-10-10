import {evaluateDirectSvaOperatorPreparation} from "./direct-sva-operator-readiness.mjs";
import {directSvaIntegrationReadiness} from "./direct-sva-integrations.mjs";

export const DIRECT_SVA_RELEASE_SEQUENCE=Object.freeze([
 Object.freeze({step:"legal_and_licensing",label:"Documents Arcep, AF2M, APNF et qualifications juridiques",requires:[]}),
 Object.freeze({step:"contractual_setup",label:"Interconnexion, collecte, tarifs et prestataire financier",requires:["legal_and_licensing"]}),
 Object.freeze({step:"schema_and_security",label:"Base directe, isolation client et recette securite",requires:["contractual_setup"]}),
 Object.freeze({step:"financial_acceptance",label:"Rapprochements, TVA et jonction au FEC legal unique",requires:["schema_and_security"]}),
 Object.freeze({step:"marketing_staging",label:"Verification des pages reservees, conditions et contenu SEO",requires:["schema_and_security"]}),
 Object.freeze({step:"external_crm_analytics",label:"GA4 dediee, GSC de chemin et HubSpot separe",requires:["marketing_staging"]}),
 Object.freeze({step:"end_to_end_rehearsal",label:"Parcours complet de test, paiements simules et reprise",requires:["financial_acceptance","external_crm_analytics"]}),
 Object.freeze({step:"owner_top_depart",label:"Ordre de lancement explicite apres recette",requires:["end_to_end_rehearsal"]})
]);

export function evaluateDirectSvaReleasePlan(input={},when=new Date()){
 const legal=evaluateDirectSvaOperatorPreparation({evidence:input.operator_evidence||{}},when);
 const integrations=directSvaIntegrationReadiness(input.integration_evidence||{});
 const tasks=DIRECT_SVA_RELEASE_SEQUENCE.map(step=>{
  const record=input.completed_steps?.[step.step];
  const proof=record&&record.approved===true&&typeof record.reference==="string"&&record.reference.trim().length>=6;
  return Object.freeze({step:step.step,label:step.label,prerequisites:step.requires,
   documented:Boolean(proof),depends_on:step.requires.filter(dep=>{
    const match=input.completed_steps?.[dep];
    return !(match?.approved===true&&typeof match.reference==="string"&&match.reference.trim().length>=6);
   })
  });
 });
 const explicitTopDepart=input.owner_approval?.explicit===true&&
   typeof input.owner_approval?.reference==="string"&&input.owner_approval.reference.trim().length>=8;
 const legalReviewed=legal.eligible_for_independent_go_no_go_review===true;
 const technicalDocumentsComplete=tasks.every(t=>t.documented&&t.depends_on.length===0);
 const externalMarketingReady=integrations.checks.every(t=>t.status==="documented");
 return Object.freeze({
  schema_version:"pgi-direct-sva-release-plan/1",
  business_unit:"direct_sva",legal_entity_count:1,
  current_status:"preparation",
  legal_review_proofs_complete:legalReviewed,
  crm_analytics_proofs_complete:externalMarketingReady,
  technical_steps_documented:technicalDocumentsComplete,
  owner_top_depart_recorded:explicitTopDepart,
  eligible_for_external_final_review:legalReviewed&&externalMarketingReady&&technicalDocumentsComplete&&explicitTopDepart,
  site_publication_permitted:false,
  customer_portal_activation_permitted:false,
  direct_numbers_activation_permitted:false,
  finance_transfer_permitted:false,
  crm_write_permitted:false,
  production_deployment_permitted:false,
  existing_audiotel_operation_unchanged:true,
  steps:tasks
 });
}
