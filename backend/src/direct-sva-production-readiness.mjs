// Read-only release dashboard. No external credential, invented compliance
// status, side effect or commercial launch capability.
function failure(status,code){const e=new Error(code);e.status=status;e.code=code;return e;}
const REVIEW_REQUIREMENTS=Object.freeze([
 {key:"arcep_resources",label:"Droits en numerotation et decision Arcep",owner:"reglementaire"},
 {key:"af2m_apnf_rsva",label:"AF2M, APNF, RSVA et obligations de portabilite",owner:"reglementaire"},
 {key:"collection_contract",label:"Contrat de collecte et interconnexion SVA",owner:"operateur"},
 {key:"sip_cdr_acceptance",label:"Recette SIP, acheminement, CDR et continuite",owner:"technique"},
 {key:"editor_compliance",label:"Identite editeurs, territoire, service, tarifs et reclamations",owner:"conformite"},
 {key:"financial_psp",label:"Conformite des fonds de tiers et prestataire habilite",owner:"juridique"},
 {key:"tax_accounting",label:"TVA, PCG, rapprochements, sous-journal et FEC unique",owner:"expert_comptable"},
 {key:"privacy_security",label:"RGPD, acces, retention, sauvegardes et audit",owner:"securite"},
 {key:"carrier_portability",label:"Preuves du portage, RIO ou mandat et restitution",owner:"operateur"},
 {key:"hubspot",label:"Pipeline et proprietes dedies verifies",owner:"crm"},
 {key:"ga4",label:"Propriete GA4 et consentement dedies verifies",owner:"analytics"},
 {key:"gsc",label:"Sitemap et indexation uniquement apres ouverture",owner:"seo"},
 {key:"customer_experience",label:"Compte, numero et Business Live preserves",owner:"experience"},
 {key:"full_acceptance",label:"Recette complete, incidents, fraude et reprise",owner:"technique"},
 {key:"owner_approval",label:"Decision explicite du proprietaire",owner:"direction"}
]);
const REQUIRED_CONNECTORS=Object.freeze(["ga4","gsc","hubspot","statutory_accounting","network","payment_psp"]);
function step(key,label,ok,detail,kind="internal"){
 return Object.freeze({key,label,status:ok?"observed":"blocked",proof_type:kind,detail});
}
function safeCount(row,key){const n=Number(row?.[key]);return Number.isSafeInteger(n)&&n>=0?n:0;}
export async function directSvaProductionReadiness(store){
 if(!store?.readSql?.unsafe)throw failure(503,"DIRECT_SVA_POSTGRES_REQUIRED");
 const sql=store.readSql;
 // Probe table existence before running subsequent reads. Unapplied migrations
 // must be surfaced clearly, not accidentally treated as zero activity.
 const [schema]=await sql.unsafe(
  "SELECT to_regclass('public.direct_sva_admin_switches') IS NOT NULL AS switches,"+
  " to_regclass('public.direct_sva_operator_controls') IS NOT NULL AS operator_ready,"+
  " to_regclass('public.direct_sva_integration_readiness') IS NOT NULL AS integrations,"+
  " to_regclass('public.direct_sva_existing_customer_transition_plans') IS NOT NULL AS transitions,"+
  " to_regclass('public.direct_sva_automation_jobs') IS NOT NULL AS automation");
 const migrations=Object.freeze({
  controls:schema?.switches===true,operator:schema?.operator_ready===true,
  integrations:schema?.integrations===true,transitions:schema?.transitions===true,
  automations:schema?.automation===true
 });
 const complete=Object.values(migrations).every(Boolean);
 let switchState=null,control=null,connectorRows=[],pendingJobs=null,transitionCount=null;
 if(complete){
  const [switches,operator,integrations,jobs,transitions]=await Promise.all([
   sql.unsafe("SELECT interface_preview_enabled,commercial_operation_enabled FROM direct_sva_admin_switches WHERE id=1"),
   sql.unsafe("SELECT operator_mode,number_activation_enabled,payouts_enabled FROM direct_sva_operator_controls WHERE id=1"),
   sql.unsafe("SELECT integration_key,activation_status,can_send_data FROM direct_sva_integration_readiness ORDER BY integration_key"),
   sql.unsafe("SELECT count(*)::int AS pending_count FROM direct_sva_automation_jobs"),
   sql.unsafe("SELECT count(*)::int AS prepared_count FROM direct_sva_existing_customer_transition_plans")
  ]);
  switchState=switches[0]||null;control=operator[0]||null;connectorRows=integrations;
  pendingJobs=safeCount(jobs[0],"pending_count");transitionCount=safeCount(transitions[0],"prepared_count");
 }
 const connectorInventoryComplete=connectorRows.length===REQUIRED_CONNECTORS.length&&
  REQUIRED_CONNECTORS.every(k=>connectorRows.filter(x=>x.integration_key===k).length===1);
 const connectorsDisabled=connectorInventoryComplete&&connectorRows.every(
  r=>r.activation_status==="disabled"&&r.can_send_data===false);
 const safetyOk=complete&&switchState?.commercial_operation_enabled===false&&
  control?.operator_mode==="preparation"&&control?.number_activation_enabled===false&&
  control?.payouts_enabled===false&&connectorsDisabled;
 const checks=[
  step("schema","Migrations preparatoires disponibles",complete,
   complete?"Registres presents, recette PostgreSQL independante encore requise":
   "Migrations 073 a 077 non integralement appliquees"),
  step("isolation","Isolation de la nouvelle activite",safetyOk,
   complete?(safetyOk?"Interruptions commerciales, numeros et paiements effectivement bloques":
    "Derive de configuration detectee, inspection immediate requise"):
    "Non verifiable tant que les tables n'existent pas"),
  step("external_connections","Six connexions directes sous controle",connectorsDisabled,
   connectorsDisabled?"Aucune transmission directe activee":
    "Registre absent, incomplet ou etat non conforme")
 ];
 return Object.freeze({
  schema_version:"pgi-direct-sva-production-readiness/1",
  business_unit:"direct_sva",mode:"prelaunch_observability_only",
  generated_at:new Date().toISOString(),
  migration_registry:migrations,
  technical_controls:checks,
  external_gates:REVIEW_REQUIREMENTS.map(r=>({...r,status:"external_proof_required",
   source:"external_signed_document_or_independent_review"})),
  transition_plans_prepared:transitionCount,
  automation_jobs_pending:pendingJobs,
  internal_safety_controls_ok:safetyOk,
  // Checking internal locks does not prove legal clearance or successful network service.
  legal_and_commercial_readiness_verified:false,
  external_evidence_independently_verified:false,
  end_to_end_acceptance_verified:false,
  commercial_switch_locked:true,
  production_launch_authorized:false,
  customer_number_changes_authorized:false,
  funds_transfer_authorized:false,
  deployment_permitted_by_this_report:false,
  next_action:"Recette sur base isolee, contrats operateurs, cadre PSP, controles fiscaux, revue juridique et ordre de lancement"
 });
}
export const DIRECT_SVA_RELEASE_REVIEW_REQUIREMENTS=REVIEW_REQUIREMENTS;
