// PGI Telecom Distribution only. Deterministic, PREPARATORY settlement-to-payout
// orchestration. No bank API, Stripe API, network access, journal writes or transfers.
// Source documents submitted through an admin form are NEVER authoritative evidence.
import {createHash} from "node:crypto";
import {prepareDirectSvaCollectionAccounting} from "./direct-sva-collection-planner.mjs";

function reject(code){
 const e=new Error(code);e.code=code;e.status=400;throw e;
}
function record(value,code){
 if(!value||typeof value!=="object"||Array.isArray(value))reject(code);
 return value;
}
function restricted(value,fields,code){
 record(value,code);
 if(Object.keys(value).some(k=>!fields.includes(k)))reject(code);
 return value;
}
function reference(value,label){
 if(typeof value!=="string"||!(/^[A-Za-z0-9_.:/-]{8,120}$/).test(value))
  reject("DSVA_CYCLE_INVALID_"+label);
 return value;
}
function money(value,label,zero=true){
 if(!Number.isSafeInteger(value)||value<0||value>1000000000000||(!zero&&value===0))
  reject("DSVA_CYCLE_INVALID_"+label);
 return value;
}
function add(a,b){
 const total=a+b;
 if(!Number.isSafeInteger(total)||total>1000000000000)
  reject("DSVA_CYCLE_AMOUNT_OVERFLOW");
 return total;
}
function digest(data){return createHash("sha256").update(JSON.stringify(data)).digest("hex");}
const HOLD_TYPES=new Set(["dispute","fraud","refund","compliance","contract_hold"]);
const ACTIONS=Object.freeze([
 ["cdr_import","Importer les CDR certifiés","operator_cdr_adapter"],
 ["statement_authenticity","Valider le relevé opérateur signé","operator_document_adapter"],
 ["bank_reconciliation","Rapprocher la banque et les règlements","regulated_bank_feed"],
 ["publisher_identity","Vérifier l'identité et le contrat éditeur","publisher_kyb_registry"],
 ["tax_model","Valider TVA et statut mandataire ou principal","accounting_expert"],
 ["funds_safeguards","Vérifier mandat, ségrégation et PSP","regulated_payment_provider"],
 ["accounting_draft","Proposer un journal non fiscal","accounting_review"],
 ["business_live","Actualiser les indicateurs confirmés","authoritative_cdr_and_bank_sources"],
 ["payout_preparation","Préparer les ordres individuels","approved_beneficiary_registry"],
 ["payout_execution","Exécuter les reversements","independently_authorized_psp"],
 ["payment_confirmation","Rapprocher les paiements sortants","bank_or_psp_confirmation"],
 ["exceptions_and_alerts","Traiter retenues, doublons et écarts","independent_evidence"]
]);

/**
 * Produces a preview even when all amounts seem to match. Verification cannot
 * be asserted by an HTTP caller: real signatures/bank data must come from
 * trusted connectors, not from fields such as "bank_verified": true.
 *
 * The publisher allocation belongs to the source CDR rows only for the
 * purpose of this simulation. A future signed contract must authenticate it.
 */
export function planDirectSvaFinancialCycle(input={}){
 restricted(input,["statement","receipts","recognition_date","contract_model","holds"],
  "DSVA_CYCLE_UNEXPECTED_INPUT");
 const statement=record(input.statement,"DSVA_CYCLE_STATEMENT_REQUIRED");
 if(!Array.isArray(statement.rows)||statement.rows.length<1)
  reject("DSVA_CYCLE_CDR_ROWS_REQUIRED");
 const publisherMap=new Map();
 for(const row of statement.rows){
  record(row,"DSVA_CYCLE_INVALID_CDR");
  if(["bank_verified","publisher_kyc_verified","contract_approved","payment_authorized","transfer_destination"]
      .some(k=>Object.hasOwn(row,k)))reject("DSVA_CYCLE_FORGED_EVIDENCE");
  const publisher=reference(row.publisher_reference,"PUBLISHER_REFERENCE");
  const upstream=money(row.upstream_net_minor,"UPSTREAM");
  const margin=money(row.pgi_margin_minor,"MARGIN");
  const due=money(row.publisher_due_minor,"PUBLISHER_DUE");
  if(add(margin,due)!==upstream)reject("DSVA_CYCLE_UNBALANCED_CDR");
  const existing=publisherMap.get(publisher)||{
   publisher_reference:publisher,calls:0,upstream_minor:0,
   pgi_margin_minor:0,contractual_due_preview_minor:0
  };
  existing.calls=add(existing.calls,1);
  existing.upstream_minor=add(existing.upstream_minor,upstream);
  existing.pgi_margin_minor=add(existing.pgi_margin_minor,margin);
  existing.contractual_due_preview_minor=add(existing.contractual_due_preview_minor,due);
  publisherMap.set(publisher,existing);
 }
 if(publisherMap.size>500)reject("DSVA_CYCLE_TOO_MANY_PUBLISHERS");
 const prepared=prepareDirectSvaCollectionAccounting({
  statement,receipts:input.receipts??[],
  recognition_date:input.recognition_date,
  contract_model:input.contract_model
 });
 // The upstream preview validates unique CDRs, cents and statement totals.
 if(prepared.total_operator_reported_minor<=0)reject("DSVA_CYCLE_EMPTY_SETTLEMENT");
 if([...publisherMap.values()].reduce((n,p)=>add(n,p.contractual_due_preview_minor),0)!==
    prepared.total_publisher_liability_preview_minor)
  reject("DSVA_CYCLE_PUBLISHER_SUM_MISMATCH");
 const holds=Array.isArray(input.holds)?input.holds:[];
 if(holds.length>250)reject("DSVA_CYCLE_TOO_MANY_HOLDS");
 const holdMap=new Map(),holdEvidence=new Set(),canonicalHolds=[];
 for(const hold of holds){
  restricted(hold,["hold_reference","publisher_reference","kind","amount_minor"],
   "DSVA_CYCLE_INVALID_HOLD");
  const id=reference(hold.hold_reference,"HOLD_REFERENCE");
  const publisher=reference(hold.publisher_reference,"HOLD_PUBLISHER");
  if(!publisherMap.has(publisher))reject("DSVA_CYCLE_UNKNOWN_HOLD_PUBLISHER");
  if(!HOLD_TYPES.has(hold.kind))reject("DSVA_CYCLE_INVALID_HOLD_KIND");
  const amount=money(hold.amount_minor,"HOLD_AMOUNT",false);
  if(holdEvidence.has(id))reject("DSVA_CYCLE_DUPLICATE_HOLD_REFERENCE");
  holdEvidence.add(id);
  const reserved=add(holdMap.get(publisher)||0,amount);
  if(reserved>publisherMap.get(publisher).contractual_due_preview_minor)
   reject("DSVA_CYCLE_HOLD_EXCEEDS_PUBLISHER_DUE");
  holdMap.set(publisher,reserved);
  canonicalHolds.push({hold_reference:id,publisher_reference:publisher,
   kind:hold.kind,amount_minor:amount});
 }
 const sorted=[...publisherMap.values()].sort((a,b)=>
  a.publisher_reference.localeCompare(b.publisher_reference,"en"));
 canonicalHolds.sort((a,b)=>a.hold_reference.localeCompare(b.hold_reference,"en"));
 const source=digest({statement_fingerprint:prepared.evidence_fingerprint,
  publishers:sorted,holds:canonicalHolds});
 const publisher_balances=sorted.map(p=>{
  const retained=holdMap.get(p.publisher_reference)||0;
  return Object.freeze({
   ...p,hold_preview_minor:retained,
   due_after_reported_holds_minor:p.contractual_due_preview_minor-retained,
   bank_allocated_verified_minor:0,
   payment_approved_minor:0,paid_verified_minor:0,
   verification:"unverified",payout_status:"blocked",
   payout_draft_reference:"DSVA-DRAFT-"+digest([source,p.publisher_reference]).slice(0,32),
   beneficiary_kyb_verified:false,bank_destination_verified:false,
   eligible_for_payment:false
  });
 });
 const flags=[
  ...((prepared.receipts_reported_minor<prepared.total_operator_reported_minor)
    ?["REPORTED_CASH_LESS_THAN_STATEMENT"]:[]),
  ...(canonicalHolds.length?["UNVERIFIED_DISPUTES_OR_RETAINED_FUNDS"]:[]),
  "OPERATOR_STATEMENT_UNVERIFIED",
  "BANK_RECEIPTS_UNVERIFIED",
  "BENEFICIARIES_AND_CONTRACTS_UNVERIFIED",
  "PAYMENT_AND_ACCOUNTING_RELEASE_NOT_AUTHORIZED"
 ];
 const steps=ACTIONS.map(([key,label,dependency])=>Object.freeze({
  key,label,dependency,state:"awaiting_authoritative_evidence",
  can_execute:false,automatic_when_authorized:false
 }));
 return Object.freeze({
  schema_version:"pgi-direct-sva-financial-cycle/1",
  business_unit:"direct_sva",legal_entity_key:"pgi_primary",
  period:prepared.period,currency:"EUR",
  operator_reference:prepared.operator_reference,
  statement_reference:prepared.statement_reference,
  cycle_reference:"DSVA-CYCLE-"+source.slice(0,32),
  idempotency_fingerprint:source,
  mode:"isolated_preparation_preview",
  amount_source:"operator_and_bank_documents_unverified",
  operator_reported_minor:prepared.total_operator_reported_minor,
  pgi_margin_estimate_minor:prepared.total_pgi_margin_preview_minor,
  publisher_liability_estimate_minor:prepared.total_publisher_liability_preview_minor,
  receipts_reported_unverified_minor:prepared.receipts_reported_minor,
  statement_gap_unverified_minor:prepared.outstanding_reported_minor,
  publisher_count:publisher_balances.length,
  publisher_balances:Object.freeze(publisher_balances),
  holds:Object.freeze(canonicalHolds),
  blockers:Object.freeze(flags),steps:Object.freeze(steps),
  business_live:Object.freeze({
   source:"untrusted_preview_not_customer_display",
   expected_calls:sorted.reduce((n,p)=>add(n,p.calls),0),
   estimated_publisher_due_minor:prepared.total_publisher_liability_preview_minor,
   operator_confirmed_minor:0,bank_collected_verified_minor:0,
   bank_paid_verified_minor:0,customer_publish_authorized:false
  }),
  accounting_proposals:Object.freeze(prepared.journal_proposals),
  accounting_posting_authorized:false,
  external_integration_enabled:false,
  data_emission_authorized:false,
  payment_instruction_authorized:false,
  stripe_transfer_authorized:false,bank_transfer_authorized:false,
  payout_authorized:false,real_funds_collected_verified:false,
  automated_execution_enabled:false,external_actions_executed:false,
  next_action:"Brancher des sources authentifiées et faire valider contrat, bénéficiaires, PSP et TVA avant toute autorisation financière"
 });
}
