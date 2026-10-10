// Preparation-only evidence checklist for PGI's potential direct SVA operator role.
// This module is deliberately not wired into a route, worker, billing or numbering flow.
// It cannot authorize number allocation, direct operation or third-party fund transfers.

const GATES=Object.freeze([
  {key:"legal_entity",label:"Identite juridique et responsabilites",issuer:"pgi"},
  {key:"regulatory_analysis",label:"Analyse des obligations d'operateur",issuer:"legal_reviewer"},
  {key:"ce_identifier",label:"Identifiant CE Arcep",issuer:"arcep"},
  {key:"number_attribution",label:"Decision d'attribution Arcep pour les blocs SVA",issuer:"arcep"},
  {key:"af2m_cgs",label:"Contrat de services et exigences AF2M",issuer:"af2m"},
  {key:"apnf_rsva",label:"Adhesion APNF, code operateur et dispositif RSVA",issuer:"apnf"},
  {key:"interconnection",label:"Convention d'interconnexion et collecte SVA",issuer:"carrier"},
  {key:"technical_acceptance",label:"Recette SIP, CDR, bascule et antifraude",issuer:"carrier"},
  {key:"portability",label:"Portabilite entrante et sortante, tests operateurs",issuer:"apnf"},
  {key:"publisher_compliance",label:"Identite editeurs, tarifs, transparence et reclamations",issuer:"pgi"},
  {key:"publisher_territory",label:"Etablissement des editeurs SVA majores dans l EEE ou l AELE, justificatifs controles",issuer:"pgi"},
  {key:"publisher_service_information",label:"Nom et description du service, identite du fournisseur et canal de reclamation",issuer:"pgi"},
  {key:"tariff_disclosure_mgit",label:"Tarification C+S, signaletique et message gratuit d information tarifaire avant facturation",issuer:"carrier"},
  {key:"af2m_2026_rules",label:"Application des recommandations deontologiques AF2M en vigueur depuis septembre 2026",issuer:"af2m"},
  {key:"payment_compliance",label:"Cadre PSP ou agent autorise pour fonds de tiers",issuer:"psp"},
  {key:"financial_reconciliation",label:"Reglement, rapprochement et piste d'audit",issuer:"pgi"},
  {key:"security_resilience",label:"Securite, donnees, reprise et surveillance",issuer:"pgi"},
  {key:"independent_review",label:"Revue juridique et technique preproduction",issuer:"external_reviewer"}
]);

function safeDate(value){
  if(typeof value!=="string"||!value.trim())return null;
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date:null;
}

function evidenceStatus(spec,record,now){
  if(!record||typeof record!=="object"||Array.isArray(record))return {status:"missing",reason:"Aucune preuve fournie"};
  if(record.status==="failed")return {status:"failed",reason:"Controle declare en echec"};
  if(record.status==="expired")return {status:"expired",reason:"Preuve declaree expiree"};
  if(record.status!=="verified")return {status:"pending",reason:"Validation manquante"};
  if(record.issuer!==spec.issuer)return {status:"pending",reason:"Emetteur de preuve non conforme"};
  if(typeof record.reference!=="string"||record.reference.trim().length<6)return {status:"pending",reason:"Reference documentaire manquante"};
  const verifiedAt=safeDate(record.verified_at);
  if(!verifiedAt||verifiedAt.getTime()>now.getTime())return {status:"pending",reason:"Date de validation absente ou future"};
  if(record.expires_at!==undefined&&record.expires_at!==null&&record.expires_at!==""){
    const expiresAt=safeDate(record.expires_at);
    if(!expiresAt)return {status:"pending",reason:"Date d'expiration invalide"};
    if(expiresAt.getTime()<=now.getTime())return {status:"expired",reason:"Preuve perimee"};
  }
  return {status:"verified",reason:"Preuve referencee, verification humaine toujours requise"};
}

export function evaluateDirectSvaOperatorPreparation(input={},asOf=new Date()){
  const now=asOf instanceof Date?asOf:new Date(asOf);
  if(!Number.isFinite(now.getTime()))throw new TypeError("Invalid evaluation date");
  const evidences=input&&typeof input==="object"&&input.evidence&&typeof input.evidence==="object"
    ?input.evidence:{};
  const gates=GATES.map(spec=>{
    const decision=evidenceStatus(spec,evidences[spec.key],now);
    return Object.freeze({key:spec.key,label:spec.label,expected_issuer:spec.issuer,...decision});
  });
  const verified=gates.filter(gate=>gate.status==="verified").length;
  const blockers=gates.filter(gate=>gate.status!=="verified").map(gate=>gate.key);
  return Object.freeze({
    schema_version:"pgi-direct-sva-operator-preparation/1",
    operating_role:"prospective_direct_sva_operator",
    purpose:"internal_documentary_preparation_only",
    evidence_checked_at:now.toISOString(),
    evidence_verified:verified,
    evidence_required:gates.length,
    completion_percent:Math.round(100*verified/gates.length),
    eligible_for_independent_go_no_go_review:blockers.length===0,
    activation_authorized:false,
    number_allocation_authorized:false,
    client_payout_authorized:false,
    automatic_provisioning_enabled:false,
    production_configuration_changed:false,
    blockers:Object.freeze(blockers),
    gates:Object.freeze(gates)
  });
}

export const DIRECT_SVA_OPERATOR_GATES=GATES;
