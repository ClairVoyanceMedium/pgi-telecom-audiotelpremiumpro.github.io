// PGI Telecom Distribution only: fictitious operator receipts -> bookkeeping preview.
// No real bank transaction, no Stripe call, no customer and no journal posting.
import test from "node:test";
import assert from "node:assert/strict";
import {prepareDirectSvaCollectionAccounting} from "../backend/src/direct-sva-collection-planner.mjs";
import {normalizeDirectSvaJournalDraft} from "../backend/src/direct-sva-business.mjs";

function statement(){
 return {operator_reference:"OPERATEUR-TEST-001",statement_reference:"RELEVE-2026-10-TEST",
  currency:"EUR",period:"2026-10",rows:[
   {cdr_reference:"CDR-TEST-00001",called_number:"+33891234567",billable_seconds:60,
    upstream_net_minor:1000,pgi_margin_minor:200,publisher_due_minor:800},
   {cdr_reference:"CDR-TEST-00002",called_number:"+33891234567",billable_seconds:180,
    upstream_net_minor:500,pgi_margin_minor:100,publisher_due_minor:400}
  ]};
}
function receipt(id="RECU-TEST-0001",amount=600){
 return {reference:id,operator_reference:"OPERATEUR-TEST-001",statement_reference:"RELEVE-2026-10-TEST",
  bank_statement_reference:"EXTRAIT-BANQUE-FAUX-2026",booking_date:"2026-10-10",
  amount_minor:amount,currency:"EUR"};
}
function payload(){return {
 statement:statement(),receipts:[receipt()],recognition_date:"2026-10-09",contract_model:"intermediary_net_preview"
};}
test("receipt preview splits operator net, PGI margin and publisher claims without recognizing funds",()=>{
 const out=prepareDirectSvaCollectionAccounting(payload());
 assert.equal(out.business_unit,"direct_sva");
 assert.equal(out.total_operator_reported_minor,1500);
 assert.equal(out.total_pgi_margin_preview_minor,300);
 assert.equal(out.total_publisher_liability_preview_minor,1200);
 assert.equal(out.receipts_reported_minor,600);
 assert.equal(out.outstanding_reported_minor,900);
 assert.equal(out.receipt_status,"partially_reported_not_verified");
 assert.equal(out.bank_confirmation_verified,false);
 assert.equal(out.operator_statement_verified,false);
 assert.equal(out.ledger_write_authorized,false);
 assert.equal(out.stripe_transfer_authorized,false);
 assert.equal(out.payout_authorized,false);
 assert.equal(out.external_actions_executed,false);
});
test("provisional distributor accounting entries are balanced and source-referenced",()=>{
 const out=prepareDirectSvaCollectionAccounting(payload());
 assert.equal(out.journal_proposals.length,2);
 const [statementDraft,receiptDraft]=out.journal_proposals;
 assert.deepEqual(statementDraft.lines.map(x=>x.account_code),["411100","467200","706100"]);
 assert.deepEqual(receiptDraft.lines.map(x=>x.account_code),["512100","411100"]);
 assert.equal(statementDraft.total_minor,1500);
 assert.equal(receiptDraft.total_minor,600);
 for(const entry of out.journal_proposals){
  assert.equal(entry.business_unit,"direct_sva");
  assert.equal(entry.entry_type,"draft_proposal_only");
  assert.equal(entry.allowed_to_create_accounting_draft,false);
  assert.equal(entry.allowed_to_post,false);
  assert.equal(entry.lines.reduce((a,x)=>a+x.debit_minor,0),entry.total_minor);
  assert.equal(entry.lines.reduce((a,x)=>a+x.credit_minor,0),entry.total_minor);
  assert.match(entry.source_reference,/^DSVA-PREV-/);
  assert.throws(()=>normalizeDirectSvaJournalDraft(entry),{code:"DIRECT_SVA_PREVIEW_NOT_POSTABLE"});
 }
});
test("no receipt is never reported as money in the bank",()=>{
 const out=prepareDirectSvaCollectionAccounting({...payload(),receipts:[]});
 assert.equal(out.receipt_count,0);
 assert.equal(out.receipts_reported_minor,0);
 assert.equal(out.receipt_status,"none_reported");
 assert.equal(out.outstanding_reported_minor,1500);
 assert.equal(out.journal_proposals.length,1);
});
test("multiple partial receipts reconcile by reference without misleading paid status",()=>{
 const out=prepareDirectSvaCollectionAccounting({...payload(),receipts:[
  receipt("RECU-TEST-0001",600),receipt("RECU-TEST-0002",400)
 ]});
 assert.equal(out.receipts_reported_minor,1000);
 assert.equal(out.outstanding_reported_minor,500);
 assert.equal(out.journal_proposals.length,3);
 assert.equal(out.bank_confirmation_verified,false);
});
test("full manually reported receipt still requires independent bank confirmation",()=>{
 const out=prepareDirectSvaCollectionAccounting({...payload(),receipts:[receipt("RECU-TEST-0001",1500)]});
 assert.equal(out.outstanding_reported_minor,0);
 assert.equal(out.receipt_status,"reported_in_full_not_verified");
 assert.equal(out.posting_authorized,false);
 assert.equal(out.payout_authorized,false);
});
test("same receipt imported twice is rejected",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
  receipts:[receipt(),receipt()]}),{code:"DSVA_COLLECTION_DUPLICATE_RECEIPT"});
});
test("bank receipt amount larger than operator receivable is rejected",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
  receipts:[receipt("RECU-TEST-0001",1501)]}),{code:"DSVA_COLLECTION_REPORTED_FUNDS_EXCEED_RECEIVABLE"});
});
test("a valid amount plus an additional receipt cannot overcollect",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
  receipts:[receipt("RECU-TEST-0001",1000),receipt("RECU-TEST-0002",501)]}),
  {code:"DSVA_COLLECTION_REPORTED_FUNDS_EXCEED_RECEIVABLE"});
});
test("receipt for another operator or document is rejected",()=>{
 for(const field of ["operator_reference","statement_reference"]){
  assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
   receipts:[{...receipt(),[field]:"OTHER-UNRELATED-001"}]}),
   {code:"DSVA_COLLECTION_WRONG_OPERATOR_OR_STATEMENT"});
 }
});
test("a currency mismatch is rejected",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
  receipts:[{...receipt(),currency:"USD"}]}),{code:"DSVA_COLLECTION_CURRENCY_INVALID"});
});
test("a missing or invented recognition model is rejected",()=>{
 for(const model of [undefined,"principal_gross","revenue_only"]){
  assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),contract_model:model}),
   {code:"DSVA_COLLECTION_CONTRACT_MODEL_NOT_REVIEWED"});
 }
});
test("receipt with IBAN or caller data in unexpected keys is refused",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
  receipts:[{...receipt(),iban:"FR76-FAKE-NEVER-STORE"}]}),
  {code:"DSVA_COLLECTION_RECEIPT_UNEXPECTED_FIELD"});
});
test("top level unexpected sensitive fields are refused",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),customer_email:"fake@example.test"}),
  {code:"DSVA_COLLECTION_UNKNOWN_FIELD"});
});
test("incomplete settlement report cannot produce bookkeeping proposals",()=>{
 const broken=statement();broken.rows[0].publisher_due_minor=900;
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),statement:broken}),
  {code:"DSVA_COLLECTION_SETTLEMENT_NOT_BALANCED"});
});
test("accounting date must match operator statement period",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),recognition_date:"2026-11-03"}),
  {code:"DSVA_COLLECTION_RECOGNITION_PERIOD_MISMATCH"});
});
test("impossible dates are rejected before suggestions are made",()=>{
 assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
  receipts:[{...receipt(),booking_date:"2026-02-31"}]}),{code:"DSVA_COLLECTION_INVALID_BOOKING_DATE"});
});
test("zero receipt, negative receipt and fractional-cent amount are rejected",()=>{
 for(const amount of [0,-1,1.25]){
  assert.throws(()=>prepareDirectSvaCollectionAccounting({...payload(),
   receipts:[{...receipt(),amount_minor:amount}]}),{code:"DSVA_COLLECTION_INVALID_RECEIPT_AMOUNT"});
 }
});
test("reordered CDRs or nonessential PII cannot change bookkeeping preview identity",()=>{
 const first=prepareDirectSvaCollectionAccounting(payload());
 const stmt=statement();
 stmt.rows.reverse();
 stmt.rows[0].caller_number="+33601020304";
 stmt.rows[1].private_customer_name="FAKE PII";
 const second=prepareDirectSvaCollectionAccounting({...payload(),statement:stmt});
 assert.deepEqual(second.journal_proposals.map(x=>x.source_reference),
  first.journal_proposals.map(x=>x.source_reference));
 assert.equal(second.evidence_fingerprint,first.evidence_fingerprint);
 assert.ok(!JSON.stringify(second).includes("FAKE PII"));
 assert.ok(!JSON.stringify(second).includes("+33601020304"));
});
test("receipt order cannot change idempotent financial proposal IDs",()=>{
 const receipts=[receipt("RECU-TEST-0002",400),receipt("RECU-TEST-0001",600)];
 const first=prepareDirectSvaCollectionAccounting({...payload(),receipts});
 const second=prepareDirectSvaCollectionAccounting({...payload(),receipts:[...receipts].reverse()});
 assert.deepEqual(first.journal_proposals.map(x=>x.source_reference),
  second.journal_proposals.map(x=>x.source_reference));
 assert.equal(first.evidence_fingerprint,second.evidence_fingerprint);
});
test("100% PGI margin or 100% publisher payout still yields two balanced lines",()=>{
 const allPGI=statement();allPGI.rows=[{...allPGI.rows[0],pgi_margin_minor:1000,publisher_due_minor:0}];
 const pgi=prepareDirectSvaCollectionAccounting({...payload(),statement:allPGI,receipts:[]});
 assert.equal(pgi.journal_proposals[0].lines.length,2);
 const allPublisher=statement();allPublisher.rows=[{...allPublisher.rows[0],pgi_margin_minor:0,publisher_due_minor:1000}];
 const editeur=prepareDirectSvaCollectionAccounting({...payload(),statement:allPublisher,receipts:[]});
 assert.equal(editeur.journal_proposals[0].lines.length,2);
});
