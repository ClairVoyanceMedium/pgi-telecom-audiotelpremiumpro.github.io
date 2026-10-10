import test from "node:test";
import assert from "node:assert/strict";
import {planDirectSvaFinancialCycle} from "../backend/src/direct-sva-financial-cycle.mjs";

function statement(){
 return {operator_reference:"COLLECTEUR-2026-01",statement_reference:"RELEVE-2026-10",
  period:"2026-10",currency:"EUR",rows:[
   {cdr_reference:"CDR-DIRECT-0001",called_number:"+33891234567",billable_seconds:60,
    publisher_reference:"EDITEUR-ALPHA-001",upstream_net_minor:1500,
    pgi_margin_minor:300,publisher_due_minor:1200},
   {cdr_reference:"CDR-DIRECT-0002",called_number:"+33891234568",billable_seconds:120,
    publisher_reference:"EDITEUR-BETA-002",upstream_net_minor:2500,
    pgi_margin_minor:500,publisher_due_minor:2000},
   {cdr_reference:"CDR-DIRECT-0003",called_number:"+33891234567",billable_seconds:100,
    publisher_reference:"EDITEUR-ALPHA-001",upstream_net_minor:1000,
    pgi_margin_minor:200,publisher_due_minor:800}
 ]};
}
function receipt(ref="BANK-RECEIPT-0001",amount=2500){
 return {reference:ref,operator_reference:"COLLECTEUR-2026-01",
  statement_reference:"RELEVE-2026-10",bank_statement_reference:"BANK-STATEMENT-202610",
  booking_date:"2026-10-10",amount_minor:amount,currency:"EUR"};
}
function example(){
 return {statement:statement(),receipts:[receipt()],
  recognition_date:"2026-10-10",contract_model:"intermediary_net_preview",holds:[]};
}
test("multi-publisher cycle balances centimes and does not authorize financial movements",()=>{
 const result=planDirectSvaFinancialCycle(example());
 assert.equal(result.business_unit,"direct_sva");
 assert.equal(result.operator_reported_minor,5000);
 assert.equal(result.pgi_margin_estimate_minor,1000);
 assert.equal(result.publisher_liability_estimate_minor,4000);
 assert.equal(result.receipts_reported_unverified_minor,2500);
 assert.equal(result.statement_gap_unverified_minor,2500);
 assert.equal(result.publisher_count,2);
 assert.equal(result.publisher_balances[0].contractual_due_preview_minor,2000);
 assert.equal(result.publisher_balances[1].contractual_due_preview_minor,2000);
 assert.equal(result.publisher_balances[0].bank_allocated_verified_minor,0);
 assert.equal(result.business_live.operator_confirmed_minor,0);
 assert.equal(result.business_live.bank_collected_verified_minor,0);
 assert.equal(result.business_live.bank_paid_verified_minor,0);
 assert.equal(result.external_actions_executed,false);
 assert.equal(result.payout_authorized,false);
 assert.equal(result.automated_execution_enabled,false);
 assert.equal(result.stripe_transfer_authorized,false);
 assert.equal(result.bank_transfer_authorized,false);
 assert.ok(result.steps.length>=10);
 assert.ok(result.steps.every(s=>!s.can_execute));
});
test("full manually declared settlement is not an actual bank confirmation",()=>{
 const plan=planDirectSvaFinancialCycle({...example(),receipts:[receipt("BANK-RECEIPT-0001",5000)]});
 assert.equal(plan.statement_gap_unverified_minor,0);
 assert.equal(plan.real_funds_collected_verified,false);
 assert.equal(plan.payment_instruction_authorized,false);
 assert.ok(plan.publisher_balances.every(x=>x.paid_verified_minor===0));
});
test("declared dispute holds reduce only theoretical distributable preview",()=>{
 const result=planDirectSvaFinancialCycle({...example(),holds:[{
  hold_reference:"DISPUTE-000001",publisher_reference:"EDITEUR-ALPHA-001",
  kind:"dispute",amount_minor:400
 }]});
 assert.equal(result.publisher_balances[0].contractual_due_preview_minor,2000);
 assert.equal(result.publisher_balances[0].hold_preview_minor,400);
 assert.equal(result.publisher_balances[0].due_after_reported_holds_minor,1600);
 assert.equal(result.publisher_balances[0].paid_verified_minor,0);
 assert.ok(result.blockers.includes("UNVERIFIED_DISPUTES_OR_RETAINED_FUNDS"));
});
test("hold greater than publisher entitlement is rejected",()=>{
 const base=example();base.holds=[{hold_reference:"HOLD-OVERLIMIT-00001",
  publisher_reference:"EDITEUR-ALPHA-001",kind:"fraud",amount_minor:2001}];
 assert.throws(()=>planDirectSvaFinancialCycle(base),{code:"DSVA_CYCLE_HOLD_EXCEEDS_PUBLISHER_DUE"});
});
test("duplicate bank entries never double-count receipts",()=>{
 const base=example();base.receipts=[receipt(),receipt()];
 assert.throws(()=>planDirectSvaFinancialCycle(base),{code:"DSVA_COLLECTION_DUPLICATE_RECEIPT"});
});
test("overreported bank receipts are rejected before a payout proposal exists",()=>{
 assert.throws(()=>planDirectSvaFinancialCycle({
  ...example(),receipts:[receipt("BANK-RECEIPT-0001",5001)]
 }),{code:"DSVA_COLLECTION_REPORTED_FUNDS_EXCEED_RECEIVABLE"});
});
test("malformed CDR, amounts and currency do not yield an eligible cycle",()=>{
 const base=example();base.statement.rows[0].publisher_due_minor="1200";
 assert.throws(()=>planDirectSvaFinancialCycle(base),{code:"DSVA_CYCLE_INVALID_PUBLISHER_DUE"});
 const other=example();other.statement.currency="GBP";
 assert.throws(()=>planDirectSvaFinancialCycle(other),{code:"DIRECT_SVA_CURRENCY_REQUIRES_REVIEW"});
});
test("an absent publisher attribution is rejected, not booked into PGI's own revenue",()=>{
 const base=example();delete base.statement.rows[0].publisher_reference;
 assert.throws(()=>planDirectSvaFinancialCycle(base),{code:"DSVA_CYCLE_INVALID_PUBLISHER_REFERENCE"});
});
test("forged source approval and payout fields are rejected",()=>{
 for(const extra of [{bank_verified:true},{payout_authorized:true},{payment_destination:"acct_FAKE"}]){
  assert.throws(()=>planDirectSvaFinancialCycle({...example(),...extra}),
   {code:"DSVA_CYCLE_UNEXPECTED_INPUT"});
 }
 const row=example();row.statement.rows[0].bank_verified=true;
 assert.throws(()=>planDirectSvaFinancialCycle(row),{code:"DSVA_CYCLE_FORGED_EVIDENCE"});
});
test("unknown bank/receipt fields cannot sneak in a fake approval",()=>{
 const ex=example();ex.receipts[0].bank_verified=true;
 assert.throws(()=>planDirectSvaFinancialCycle(ex),{code:"DSVA_COLLECTION_RECEIPT_UNEXPECTED_FIELD"});
});
test("idempotency is unaffected by input ordering, unrelated caller data and hold order",()=>{
 const first=example();
 first.holds=[
  {hold_reference:"HOLD-EXAMPLE-00001",publisher_reference:"EDITEUR-ALPHA-001",
   kind:"dispute",amount_minor:150},
  {hold_reference:"HOLD-EXAMPLE-00002",publisher_reference:"EDITEUR-BETA-002",
   kind:"contract_hold",amount_minor:200}
 ];
 const original=planDirectSvaFinancialCycle(first);
 const second=example();
 second.statement.rows.reverse();
 second.statement.rows[0].caller_number="+33601020304";
 second.holds=[...first.holds].reverse();
 const same=planDirectSvaFinancialCycle(second);
 assert.equal(original.cycle_reference,same.cycle_reference);
 assert.deepEqual(original.publisher_balances,same.publisher_balances);
 assert.ok(!JSON.stringify(same).includes("+33601020304"));
});
test("a changed margin and corresponding publisher share change cycle identity",()=>{
 const original=planDirectSvaFinancialCycle(example());
 const other=example();other.statement.rows[0].pgi_margin_minor=350;
 other.statement.rows[0].publisher_due_minor=1150;
 const changed=planDirectSvaFinancialCycle(other);
 assert.notEqual(changed.cycle_reference,original.cycle_reference);
});
test("hold reference replay cannot reduce the same publisher balance twice",()=>{
 const entry={hold_reference:"HOLD-DUPLICATE-0001",
  publisher_reference:"EDITEUR-ALPHA-001",kind:"dispute",amount_minor:100};
 assert.throws(()=>planDirectSvaFinancialCycle({...example(),holds:[entry,entry]}),
  {code:"DSVA_CYCLE_DUPLICATE_HOLD_REFERENCE"});
});
test("accounting is strictly proposal-only even for a mathematically complete cycle",()=>{
 const result=planDirectSvaFinancialCycle(example());
 assert.equal(result.accounting_posting_authorized,false);
 assert.ok(result.accounting_proposals.length>0);
 assert.ok(result.accounting_proposals.every(p=>p.allowed_to_post===false));
 assert.ok(result.publisher_balances.every(p=>p.eligible_for_payment===false));
});

test("swapping two equal-valued calls across publishers still changes audit identity",()=>{
 const input=example();
 input.statement.rows=[
  {cdr_reference:"CDR-EQUAL-0001",called_number:"+33891234567",billable_seconds:60,
   publisher_reference:"EDITEUR-ALPHA-001",upstream_net_minor:1000,pgi_margin_minor:200,publisher_due_minor:800},
  {cdr_reference:"CDR-EQUAL-0002",called_number:"+33891234568",billable_seconds:60,
   publisher_reference:"EDITEUR-BETA-002",upstream_net_minor:1000,pgi_margin_minor:200,publisher_due_minor:800}
 ];
 input.receipts=[];
 const before=planDirectSvaFinancialCycle(input);
 input.statement.rows[0].publisher_reference="EDITEUR-BETA-002";
 input.statement.rows[1].publisher_reference="EDITEUR-ALPHA-001";
 const after=planDirectSvaFinancialCycle(input);
 assert.notEqual(before.cycle_reference,after.cycle_reference);
});
