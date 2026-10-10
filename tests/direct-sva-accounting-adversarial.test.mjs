import test from "node:test";
import assert from "node:assert/strict";
import {normalizeDirectSvaJournalDraft as draft} from "../backend/src/direct-sva-business.mjs";

function entry(debit=1000,credit=1000){
 return {source_reference:"DSVA-BOOK-VALID0001",description:"Vérification du journal direct",
  evidence_reference:"PROOF-FINANCE-2026",entry_date:"2026-10-10",currency:"EUR",lines:[
   {account_code:"411100",label:"Compte client",debit_minor:debit,credit_minor:0},
   {account_code:"706100",label:"Revenu contractuel",debit_minor:0,credit_minor:credit}
  ]};
}
test("valid business-unit financial journal remains balanced in integer cents",()=>{
 const result=draft(entry());
 assert.equal(result.total_minor,1000);
 assert.equal(result.lines[0].debit_minor,1000);
 assert.equal(result.lines[1].credit_minor,1000);
 assert.equal(result.currency,"EUR");
 assert.equal(result.source_system,"manual_evidence");
});
test("mis-typed booleans and scientific notation never create unnoticed 1-cent or 1000-cent entries",()=>{
 for(const value of [true,false,"1e3"," 1000 ","+1000","0x3e8",[],[1000],{},"1000.0",1.1,"01000","\t1000","Infinity"]){
  assert.throws(()=>draft(entry(value,value)),{code:"DIRECT_SVA_AMOUNT_INVALID"});
 }
});
test("zero, unsigned numeric form strings and large safe integer amounts remain supported",()=>{
 for(const value of [1,10,1000,999999999999,1000000000000,"1","10","1000","999999999999","1000000000000"]){
  const result=draft(entry(value,value));
  assert.equal(result.total_minor,Number(value));
 }
 assert.throws(()=>draft(entry(1000000000001,1000000000001)),{code:"DIRECT_SVA_AMOUNT_INVALID"});
});
test("unbalanced or side-invalid lines never become accounting drafts",()=>{
 for(const x of [
  entry(1000,999),entry(-1000,-1000),
  {...entry(),lines:[entry().lines[0]]},
  {...entry(),lines:[{...entry().lines[0],credit_minor:10},entry().lines[1]]},
  {...entry(),lines:[{...entry().lines[0],debit_minor:0},entry().lines[1]]}
 ]){
  assert.throws(()=>draft(x));
 }
});
test("preview identifiers and fake evidence are never postable",()=>{
 assert.throws(()=>draft({...entry(),source_reference:"DSVA-PREV-INTERNAL"}),{code:"DIRECT_SVA_PREVIEW_NOT_POSTABLE"});
 assert.throws(()=>draft({...entry(),evidence_reference:"x"}),{code:"DIRECT_SVA_EVIDENCE_REQUIRED"});
 assert.throws(()=>draft({...entry(),currency:"USD"}),{code:"DIRECT_SVA_CURRENCY_UNSUPPORTED"});
 assert.throws(()=>draft({...entry(),entry_date:"2026-02-30"}),{code:"DIRECT_SVA_ENTRY_DATE_INVALID"});
});
test("1000 deterministic balanced accounting samples preserve exact totals",()=>{
 let rand=123456789;
 for(let i=0;i<1000;i++){
  rand=(rand*1664525+1013904223)>>>0;
  const value=1+rand%100000000;
  const x=entry(value,value);
  x.source_reference="DSVA-STRESS-"+String(i).padStart(5,"0");
  const result=draft(x);
  assert.equal(result.total_minor,value);
  assert.equal(result.lines.reduce((a,l)=>a+l.debit_minor-l.credit_minor,0),0);
  assert.equal(result.lines.length,2);
 }
});
