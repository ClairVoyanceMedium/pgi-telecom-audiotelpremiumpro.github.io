import test from "node:test";
import assert from "node:assert/strict";
import {analyzeDirectSvaSettlement} from "../backend/src/direct-sva-reconciliation.mjs";

function validBatch(){
 return {operator_reference:"COLLECTEUR-001",statement_reference:"RELEVE-2026-10",period:"2026-10",currency:"EUR",
  rows:[
   {cdr_reference:"CDR-01-A",called_number:"+33891234567",billable_seconds:60,upstream_net_minor:100,pgi_margin_minor:20,publisher_due_minor:80},
   {cdr_reference:"CDR-01-B",called_number:"+33891234567",billable_seconds:40,upstream_net_minor:200,pgi_margin_minor:40,publisher_due_minor:160}
  ]};
}

test("direct SVA preview balances margins and client amounts without posting",()=>{
 const result=analyzeDirectSvaSettlement(validBatch());
 assert.equal(result.balanced,true);
 assert.equal(result.accepted_rows,2);
 assert.equal(result.total_upstream_net_minor,300);
 assert.equal(result.total_pgi_margin_minor,60);
 assert.equal(result.total_publisher_due_minor,240);
 assert.equal(result.by_number.length,1);
 assert.equal(result.by_number[0].calls,2);
 assert.equal(result.accounting_write_authorized,false);
 assert.equal(result.bank_payout_authorized,false);
 assert.equal(result.number_activation_authorized,false);
 assert.equal(result.cdr_reconciled_with_trusted_source,false);
 assert.match(result.source_fingerprint,/^[0-9a-f]{64}$/);
});

test("duplicate CDR references are rejected rather than counted twice",()=>{
 const payload=validBatch();payload.rows[1].cdr_reference=payload.rows[0].cdr_reference;
 const result=analyzeDirectSvaSettlement(payload);
 assert.equal(result.balanced,false);
 assert.equal(result.accepted_rows,1);
 assert.equal(result.rejected_rows,1);
 assert.ok(result.issues.some(x=>x.code==="DUPLICATE_CDR_REFERENCE"));
});

test("non-balanced publisher and platform shares are blocked",()=>{
 const payload=validBatch();payload.rows[0].pgi_margin_minor=99;
 const result=analyzeDirectSvaSettlement(payload);
 assert.equal(result.balanced,false);
 assert.equal(result.accepted_rows,1);
 assert.ok(result.issues.some(x=>x.code==="UNBALANCED_DISTRIBUTION"));
});

test("a wrong currency or negative fees cannot become a payable settlement",()=>{
 const payload=validBatch();payload.currency="USD";
 assert.throws(()=>analyzeDirectSvaSettlement(payload),{code:"DIRECT_SVA_CURRENCY_REQUIRES_REVIEW"});
 const different=validBatch();different.rows[0].pgi_margin_minor=-20;
 const result=analyzeDirectSvaSettlement(different);
 assert.equal(result.balanced,false);
 assert.equal(result.rejected_rows,1);
});

test("the preview excludes caller and other extraneous PII fields",()=>{
 const batch=validBatch();
 batch.rows[0].caller_number="+33601020304";
 batch.rows[0].private_customer_name="Non public";
 const result=analyzeDirectSvaSettlement(batch);
 const json=JSON.stringify(result);
 assert.ok(!json.includes("+33601020304"));
 assert.ok(!json.includes("Non public"));
 assert.equal(result.approved_by_operator,false);
 assert.equal(result.funds_collected_verified,false);
});
