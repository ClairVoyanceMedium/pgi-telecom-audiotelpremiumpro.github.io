import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
 validDirectSvaMonth,normalizeDirectSvaJournalDraft,directSvaBusinessSnapshot,
 createDirectSvaDraft,approveDirectSvaDraft
} from "../backend/src/direct-sva-business.mjs";

function validPayload(){
 return {
  source_reference:"DSVA-PIECE-00001",
  entry_date:"2026-10-10",
  currency:"EUR",
  description:"Frais directs sur justificatif",
  evidence_reference:"FACTURE-DIRECT-001",
  lines:[
   {account_code:"622610",label:"Frais de collecte SVA",debit_minor:12500,credit_minor:0},
   {account_code:"512100",label:"Tresorerie directe",debit_minor:0,credit_minor:12500}
  ]
 };
}

test("direct SVA draft validates balanced postings in integer cents",()=>{
 const result=normalizeDirectSvaJournalDraft(validPayload());
 assert.equal(result.total_minor,12500);
 assert.equal(result.source_system,"manual_evidence");
 assert.equal(result.lines.length,2);
 assert.equal(result.currency,"EUR");
});

test("reject unbalanced entries, decimals, negatives and invented currencies",()=>{
 const changes=[
  x=>{x.lines[1].credit_minor=12501},
  x=>{x.lines[0].debit_minor=1.5},
  x=>{x.lines[0].debit_minor=-100},
  x=>{x.currency="USD"},
  x=>{x.entry_date="2026-02-30"},
  x=>{x.source_reference="WRONG"}
 ];
 for(const mutate of changes){
  const p=validPayload();mutate(p);
  assert.throws(()=>normalizeDirectSvaJournalDraft(p),{status:400});
 }
});

test("posting requires documentary references and a valid date",()=>{
 const p=validPayload();p.evidence_reference="";assert.throws(()=>normalizeDirectSvaJournalDraft(p),{code:"DIRECT_SVA_EVIDENCE_REQUIRED"});
 const q=validPayload();q.entry_date="2026-13-32";assert.throws(()=>normalizeDirectSvaJournalDraft(q),{code:"DIRECT_SVA_ENTRY_DATE_INVALID"});
});

test("monthly reporting does not silently accept wrong dates",()=>{
 assert.equal(validDirectSvaMonth("2026-10"),"2026-10");
 assert.throws(()=>validDirectSvaMonth("2026-00"),{status:400});
 assert.throws(()=>validDirectSvaMonth("2026-13"),{status:400});
});

test("no direct business summary is generated from simulator values",async()=>{
 await assert.rejects(()=>directSvaBusinessSnapshot({}, {month:"2026-10"}),{status:503});
});

test("direct business snapshot reads only its own tables and computes separate margins",async()=>{
 const sqls=[];
 const responses=[
  [{operator_mode:"preparation",number_activation_enabled:false,payouts_enabled:false}],
  [{allocation_status:"planned",count:2,capacity:"2000"}],
  [{number_status:"planned",count:5}],
  [{contract_status:"planned",count:1}],
  [{posted_entries:1,revenue_minor:"32000",expenses_minor:"12000",receivables_change_minor:"0",publisher_liabilities_change_minor:"14000",suspense_change_minor:"0"}],
  [{account_code:"706100",account_label:"Produit",account_kind:"revenue",requires_expert_review:true}],
  [{id:1,entry_date:"2026-10-10",currency:"EUR",source_reference:"DSVA-TEST-001",description:"Validation documentee",status:"posted",evidence_reference:"PIECE-DOCUMENT-2026",line_count:2,total_debit_minor:"32000",total_credit_minor:"32000"}],
  [{month:"2026-10",revenue_minor:"32000",expenses_minor:"12000"}],
  [{period_key:"2026-10",state:"open"}],
  [{count:2}]
 ];
 let pointer=0;
 const store={sql:{begin:async()=>{}},readSql:{unsafe:async(query,values=[])=>{
   sqls.push({query,values});
   return responses[pointer++];
 }}};
 const result=await directSvaBusinessSnapshot(store,{month:"2026-10"});
 assert.equal(sqls.length,10);
 assert.equal(result.accounting.revenue_minor,32000);
 assert.equal(result.accounting.expenses_minor,12000);
 assert.equal(result.accounting.operating_result_minor,20000);
 assert.equal(result.accounting.draft_entries,2);
 assert.equal(result.accounting.entries[0].date,"2026-10-10");
 assert.equal(result.business_unit,"direct_sva");
 assert.equal(result.activation_authorized,false);
 assert.equal(result.payout_authorized,false);
 for(const row of sqls){
   assert.match(row.query,/direct_sva_/);
   assert.doesNotMatch(row.query,/platform_accounting_entries|tenant_revenue_distributions|subscription_billing_events/i);
 }
});

test("posting a draft cannot be self-approved",async()=>{
 const store={
   sql:{begin:async fn=>fn({unsafe:async query=>{
     if(query.includes("SELECT id,status,created_by"))return [{id:4,status:"draft",created_by:3,entry_date:"2026-10-10"}];
     throw Error("No write should occur");
   }})},
   readSql:{unsafe:async()=>[]}
 };
 await assert.rejects(()=>approveDirectSvaDraft(store,4,{sub:"3"},{approval_evidence:"REVUE-001"}),{code:"DIRECT_SVA_TWO_PERSON_APPROVAL_REQUIRED"});
});

test("draft entry creates an audit event but has no effect on payouts",async()=>{
 const statements=[];
 const store={
  sql:{begin:async fn=>fn({unsafe:async(query,params=[])=>{
   statements.push(query);
   if(query.startsWith("SELECT account_code"))return [{account_code:"622610"},{account_code:"512100"}];
   if(query.startsWith("SELECT state"))return [];
   if(query.startsWith("INSERT INTO direct_sva_journal_entries"))return [{id:23,status:"draft"}];
   return [];
  }})},
  readSql:{unsafe:async()=>[]}
 };
 const result=await createDirectSvaDraft(store,validPayload(),{sub:"3"});
 assert.equal(result.status,"draft");
 assert.equal(result.payout_authorized,false);
 assert.equal(result.activation_authorized,false);
 assert.ok(statements.some(x=>x.includes("direct_sva_journal_audit")));
 assert.ok(statements.every(x=>!x.includes("platform_accounting_entries")));
});

test("the migration is additive with immutable posted entries and no activation",()=>{
 const text=fs.readFileSync(new URL("../database/migrations/073_direct_sva_operator_business_unit.sql",import.meta.url),"utf8");
 assert.match(text,/number_activation_enabled boolean NOT NULL DEFAULT false CHECK \(number_activation_enabled=false\)/);
 assert.match(text,/payouts_enabled boolean NOT NULL DEFAULT false CHECK \(payouts_enabled=false\)/);
 assert.match(text,/CREATE TABLE IF NOT EXISTS direct_sva_journal_entries/);
 assert.match(text,/posted direct SVA accounting entries are immutable/);
 assert.match(text,/direct SVA entry must have at least two balanced lines/);
 assert.match(text,/direct SVA maker-checker approval required/);
 assert.match(text,/direct_sva_guard_audit_append_only/);
 assert.doesNotMatch(text,/\b(?:DROP|TRUNCATE)\b/i);
 assert.doesNotMatch(text,/\b(?:ALTER|UPDATE|DELETE)\s+(?:TABLE\s+)?platform_accounting_/i);
});

test("navigation and API remain distinct from legacy Audiotel flows",()=>{
 const html=fs.readFileSync(new URL("../index.html",import.meta.url),"utf8");
 const app=fs.readFileSync(new URL("../assets/app.js",import.meta.url),"utf8");
 const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
 const ui=fs.readFileSync(new URL("../assets/direct-sva-cockpit.js",import.meta.url),"utf8");
 assert.match(html,/data-view="direct-sva"/);
 assert.match(html,/id="view-direct-sva"/);
 assert.match(html,/id="accounting-cockpit-root"/);
 assert.match(app,/case "direct-sva":/);
 assert.match(server,/pathname==="\/api\/v1\/platform\/direct-sva\/overview"/);
 assert.match(server,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
 assert.match(server,/platform\.direct_sva\.accounting_draft/);
 assert.match(server,/platform\.direct_sva\.accounting_approve/);
 assert.match(ui,/Comptabilité directe/);
 assert.match(ui,/Exporter CSV du distributeur/);
 assert.doesNotMatch(ui,/\/platform\/accounting(?:\/|\?|")/);
});
