import test from "node:test";
import assert from "node:assert/strict";
import {DIRECT_SVA_OPERATOR_GATES,evaluateDirectSvaOperatorPreparation} from "../backend/src/direct-sva-operator-readiness.mjs";

const fixedNow=new Date("2026-10-10T10:00:00.000Z");

function evidenceFor(spec){
  return {
    status:"verified",
    issuer:spec.issuer,
    reference:"DOC-VALIDATED-2026-0001",
    verified_at:"2026-10-09T10:00:00.000Z",
    expires_at:"2027-10-09T10:00:00.000Z"
  };
}

test("direct SVA operator preparation defaults to all gates missing and never enables production",()=>{
  const result=evaluateDirectSvaOperatorPreparation({},fixedNow);
  assert.equal(result.evidence_verified,0);
  assert.equal(result.evidence_required,DIRECT_SVA_OPERATOR_GATES.length);
  assert.equal(result.eligible_for_independent_go_no_go_review,false);
  assert.equal(result.activation_authorized,false);
  assert.equal(result.number_allocation_authorized,false);
  assert.equal(result.client_payout_authorized,false);
  assert.equal(result.automatic_provisioning_enabled,false);
  assert.equal(result.production_configuration_changed,false);
  assert.ok(result.blockers.includes("number_attribution"));
  assert.ok(result.blockers.includes("payment_compliance"));
});

test("an unverified or fictional Arcep attribution is never treated as verified",()=>{
  const result=evaluateDirectSvaOperatorPreparation({evidence:{
    number_attribution:{status:"verified",issuer:"pgi",reference:"UNISSUED-2026",verified_at:"2026-10-09T10:00:00.000Z"}
  }},fixedNow);
  assert.equal(result.gates.find(g=>g.key==="number_attribution").status,"pending");
  assert.ok(result.blockers.includes("number_attribution"));
});

test("a date in the future, missing reference or malformed expiry blocks readiness",()=>{
  const result=evaluateDirectSvaOperatorPreparation({evidence:{
    ce_identifier:{status:"verified",issuer:"arcep",reference:"CE-XYZ",verified_at:"2026-10-11T10:00:00.000Z"},
    af2m_cgs:{status:"verified",issuer:"af2m",reference:"",verified_at:"2026-10-09T10:00:00.000Z"},
    apnf_rsva:{status:"verified",issuer:"apnf",reference:"APNF-CONTRACT-001",verified_at:"2026-10-09T10:00:00.000Z",expires_at:"unrecognized"}
  }},fixedNow);
  for(const key of ["ce_identifier","af2m_cgs","apnf_rsva"]){
    assert.equal(result.gates.find(g=>g.key===key).status,"pending");
  }
});

test("expired proofs are rejected, even when they were previously verified",()=>{
  const result=evaluateDirectSvaOperatorPreparation({evidence:{
    interconnection:{...evidenceFor({issuer:"carrier"}),expires_at:"2026-10-10T09:59:59.000Z"}
  }},fixedNow);
  assert.equal(result.gates.find(g=>g.key==="interconnection").status,"expired");
  assert.equal(result.eligible_for_independent_go_no_go_review,false);
});

test("even a complete documentary fixture cannot authorize direct operation",()=>{
  const evidence=Object.fromEntries(DIRECT_SVA_OPERATOR_GATES.map(spec=>[spec.key,evidenceFor(spec)]));
  const result=evaluateDirectSvaOperatorPreparation({evidence},fixedNow);
  assert.equal(result.evidence_verified,DIRECT_SVA_OPERATOR_GATES.length);
  assert.equal(result.completion_percent,100);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.eligible_for_independent_go_no_go_review,true);
  assert.equal(result.activation_authorized,false);
  assert.equal(result.number_allocation_authorized,false);
  assert.equal(result.client_payout_authorized,false);
  assert.equal(result.automatic_provisioning_enabled,false);
});

test("preparation output does not copy evidence references or confidential source files",()=>{
  const evidence={legal_entity:{...evidenceFor({issuer:"pgi"}),reference:"PRIVATE-CONTRACT-REFERENCE-2026",document_contents:"confidential"}};
  const result=evaluateDirectSvaOperatorPreparation({evidence},fixedNow);
  assert.ok(!JSON.stringify(result).includes("PRIVATE-CONTRACT-REFERENCE-2026"));
  assert.ok(!JSON.stringify(result).includes("confidential"));
  assert.equal(result.evidence_verified,1);
});

test("invalid reference date is rejected",()=>{
  assert.throws(()=>evaluateDirectSvaOperatorPreparation({},"invalid"),TypeError);
});
