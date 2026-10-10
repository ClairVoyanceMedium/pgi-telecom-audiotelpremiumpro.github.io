// PGI Telecom Distribution only. PREVIEW of unverified operator/bank evidence.
// No Stripe API, no bank account access, no accounting write and no payouts.
// Account assignment is a provisional intermediary model for expert review.
import {createHash} from "node:crypto";
import {analyzeDirectSvaSettlement} from "./direct-sva-reconciliation.mjs";

function fail(code){const e=new Error(code);e.code=code;e.status=400;throw e;}
function ref(value,label){
 const s=String(value??"").trim();
 if(s.length<8||s.length>120||!/^[A-Za-z0-9_.:/-]+$/.test(s))fail("DSVA_COLLECTION_INVALID_"+label);
 return s;
}
function day(value,label){
 const s=String(value??"").trim();
 if(!/^20[2-9]\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)||
    !Number.isFinite(Date.parse(s+"T00:00:00Z"))||
    new Date(s+"T00:00:00Z").toISOString().slice(0,10)!==s)
  fail("DSVA_COLLECTION_INVALID_"+label);
 return s;
}
function cents(value,label,allowZero=false){
 if(!Number.isSafeInteger(value)||value<0||(!allowZero&&value===0)||value>1000000000000)
  fail("DSVA_COLLECTION_INVALID_"+label);
 return value;
}
function sha(value){return createHash("sha256").update(JSON.stringify(value)).digest("hex");}
function line(account_code,label,debit_minor,credit_minor){
 if((debit_minor>0)===(credit_minor>0))fail("DSVA_COLLECTION_INVALID_BOOKING_LINE");
 return Object.freeze({account_code,label,debit_minor,credit_minor});
}
function journal(reference,date,evidence,description,lines,origin){
 const debit=lines.reduce((n,v)=>n+v.debit_minor,0),credit=lines.reduce((n,v)=>n+v.credit_minor,0);
 if(!Number.isSafeInteger(debit)||debit<=0||debit!==credit)
  fail("DSVA_COLLECTION_UNBALANCED_JOURNAL");
 return Object.freeze({
  business_unit:"direct_sva",source_reference:"DSVA-"+reference,
  source_system:"manual_evidence",entry_date:date,currency:"EUR",
  description,evidence_reference:evidence,lines,
  total_minor:debit,origin,entry_type:"draft_proposal_only",
  allowed_to_create_accounting_draft:false,allowed_to_post:false
 });
}

/**
 * Pure preparatory matching. All supplied bank evidence is UNTRUSTED.
 * To recognize operator income / publisher liability, the contractual
 * principal-vs-agent model, VAT and PCG mapping must first be approved.
 * A customer's statement cannot independently attest bank settlement.
 */
export function prepareDirectSvaCollectionAccounting(input={}){
 if(!input||typeof input!=="object"||Array.isArray(input))fail("DSVA_COLLECTION_INVALID_PAYLOAD");
 const allowed=new Set(["statement","receipts","recognition_date","contract_model"]);
 if(Object.keys(input).some(k=>!allowed.has(k)))fail("DSVA_COLLECTION_UNKNOWN_FIELD");
 if(input.contract_model!=="intermediary_net_preview")
  fail("DSVA_COLLECTION_CONTRACT_MODEL_NOT_REVIEWED");
 const recognitionDate=day(input.recognition_date,"RECOGNITION_DATE");
 const settlement=analyzeDirectSvaSettlement(input.statement);
 if(settlement.business_unit!=="direct_sva"||!settlement.balanced||
    settlement.rejected_rows!==0||settlement.accepted_rows===0)
  fail("DSVA_COLLECTION_SETTLEMENT_NOT_BALANCED");
 // Prevent previewing a statement for a different accounting period.
 if(recognitionDate.slice(0,7)!==settlement.period)
  fail("DSVA_COLLECTION_RECOGNITION_PERIOD_MISMATCH");
 const rows=input.receipts??[];
 if(!Array.isArray(rows)||rows.length>50)fail("DSVA_COLLECTION_RECEIPTS_INVALID");
 const seen=new Set(),receipts=[];
 let reported=0;
 for(const raw of rows){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))fail("DSVA_COLLECTION_RECEIPT_INVALID");
  const supported=["reference","operator_reference","statement_reference","bank_statement_reference",
    "booking_date","amount_minor","currency"];
  if(Object.keys(raw).some(k=>!supported.includes(k)))fail("DSVA_COLLECTION_RECEIPT_UNEXPECTED_FIELD");
  const reference=ref(raw.reference,"RECEIPT_REFERENCE");
  const operatorReference=ref(raw.operator_reference,"OPERATOR_REFERENCE");
  const statementReference=ref(raw.statement_reference,"STATEMENT_REFERENCE");
  const bankStatementReference=ref(raw.bank_statement_reference,"BANK_STATEMENT_REFERENCE");
  const bookingDate=day(raw.booking_date,"BOOKING_DATE");
  const amount=cents(raw.amount_minor,"RECEIPT_AMOUNT");
  if(String(raw.currency??"").toUpperCase()!=="EUR")fail("DSVA_COLLECTION_CURRENCY_INVALID");
  if(operatorReference!==settlement.operator_reference||statementReference!==settlement.statement_reference)
   fail("DSVA_COLLECTION_WRONG_OPERATOR_OR_STATEMENT");
  // Uniqueness per operator statement: replaying a payment line may double-count cash.
  if(seen.has(reference))fail("DSVA_COLLECTION_DUPLICATE_RECEIPT");
  seen.add(reference);
  reported+=amount;
  if(!Number.isSafeInteger(reported)||reported>settlement.total_upstream_net_minor)
   fail("DSVA_COLLECTION_REPORTED_FUNDS_EXCEED_RECEIVABLE");
  receipts.push(Object.freeze({
   reference,operator_reference:operatorReference,statement_reference:statementReference,
   bank_statement_reference:bankStatementReference,booking_date:bookingDate,amount_minor:amount
  }));
 }
 receipts.sort((a,b)=>a.reference.localeCompare(b.reference,"en"));
 const sourceHash=sha({business_unit:"direct_sva",operator_reference:settlement.operator_reference,
  statement_reference:settlement.statement_reference,period:settlement.period,
  settlement_digest:settlement.source_fingerprint});
 // An accounting DRAFT proposal is not evidence of bank funds.
 const journals=[
  journal("VENTE-"+sourceHash.slice(0,24),recognitionDate,settlement.statement_reference,
   "Ventilation SVA à revoir avant comptabilisation",[
    line("411100","Créance opérateur selon relevé à authentifier",settlement.total_upstream_net_minor,0),
    ...(settlement.total_publisher_due_minor>0
     ?[line("467200","Part éditeurs conditionnelle",0,settlement.total_publisher_due_minor)]:[]),
    ...(settlement.total_pgi_margin_minor>0
     ?[line("706100","Marge PGI selon contrat à valider",0,settlement.total_pgi_margin_minor)]:[])
   ],"statement_untrusted")
 ];
 // Bank receipt projections are individually traceable and independently replay-safe.
 for(const receipt of receipts){
  const digest=sha({sourceHash,reference:receipt.reference,bank_statement_reference:receipt.bank_statement_reference,
   booking_date:receipt.booking_date,amount_minor:receipt.amount_minor});
  journals.push(journal("BANQUE-"+digest.slice(0,24),receipt.booking_date,receipt.bank_statement_reference,
   "Encaissement bancaire signalé non vérifié",[
    line("512100","Banque à confirmer par extrait bancaire authentifié",receipt.amount_minor,0),
    line("411100","Extinction conditionnelle de créance opérateur",0,receipt.amount_minor)
   ],"bank_receipt_untrusted"));
 }
 return Object.freeze({
  schema_version:"pgi-direct-sva-collection-preview/1",
  business_unit:"direct_sva",source:"untrusted_manual_documents",
  operator_reference:settlement.operator_reference,
  statement_reference:settlement.statement_reference,
  period:settlement.period,currency:"EUR",
  total_operator_reported_minor:settlement.total_upstream_net_minor,
  total_pgi_margin_preview_minor:settlement.total_pgi_margin_minor,
  total_publisher_liability_preview_minor:settlement.total_publisher_due_minor,
  receipts_reported_minor:reported,
  outstanding_reported_minor:settlement.total_upstream_net_minor-reported,
  receipt_count:receipts.length,
  receipt_status:reported===0?"none_reported":reported===settlement.total_upstream_net_minor
    ?"reported_in_full_not_verified":"partially_reported_not_verified",
  evidence_fingerprint:sha({sourceHash,receipts}),
  journal_proposals:Object.freeze(journals),
  accounting_method:"intermediary_net_provisional_mapping_expert_required",
  bank_confirmation_verified:false,operator_statement_verified:false,
  rights_to_collect_verified:false,customer_kyc_verified:false,
  tax_treatment_verified:false,ledger_write_authorized:false,
  posting_authorized:false,payout_authorized:false,stripe_transfer_authorized:false,
  bank_transfer_authorized:false,external_actions_executed:false,
  next_action:"Confirmer les sources opérateur et banque, mandat de collecte, TVA, rôle mandataire/principal et approbation de l'expert-comptable"
 });
}
