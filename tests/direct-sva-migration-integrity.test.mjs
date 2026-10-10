import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationDir=new URL("../database/migrations/",import.meta.url);
const names=["073_direct_sva_operator_business_unit.sql","074_single_company_two_business_units.sql","075_direct_sva_customer_and_automation_foundation.sql"];

function stripSqlComments(sql){
 return sql.replace(/\/\*[\s\S]*?\*\//g," ").replace(/--[^\n]*/g," ");
}

// Balance basic structural tokens while ignoring quoted SQL strings, dollar-quoted bodies and comments.
// This is a defensive lint pass, not a substitute for a PostgreSQL migration on an isolated test branch.
function scanSql(sql){
 let state="code",depth=0;
 for(let i=0;i<sql.length;i++){
  const ch=sql[i],next=sql[i+1];
  if(state==="code"){
   if(ch==="-"&&next==="-"){state="line";i++;continue;}
   if(ch==="/"&&next==="*"){state="comment";i++;continue;}
   if(ch==="'"){state="single";continue;}
   if(ch==='"'){state="double";continue;}
   if(ch==="$"&&next==="$"){state="dollar";i++;continue;}
   if(ch==="(")depth++;
   else if(ch===")"){depth--;if(depth<0)throw Error("Orphan SQL closing parenthesis at "+i);}
  }else if(state==="line"){
   if(ch==="\n")state="code";
  }else if(state==="comment"){
   if(ch==="*"&&next==="/"){state="code";i++;}
  }else if(state==="single"){
   if(ch==="'"&&next==="'"){i++;continue;}
   if(ch==="'")state="code";
  }else if(state==="double"){
   if(ch==='"'&&next==='"'){i++;continue;}
   if(ch==='"')state="code";
  }else if(state==="dollar"){
   if(ch==="$"&&next==="$"){state="code";i++;}
  }
 }
 if(depth!==0||!["code","line"].includes(state))throw Error("SQL has unclosed parentheses or quoted body: "+JSON.stringify({depth,state}));
}

test("the three direct SVA migrations have intact statement boundaries and exactly one table definition",()=>{
 for(const name of names){
  const sql=fs.readFileSync(new URL(name,migrationDir),"utf8");
  assert.doesNotThrow(()=>scanSql(sql),name);
  assert.ok(sql.endsWith(";\n"),name+": expected SQL end");
  const declarations=[...stripSqlComments(sql).matchAll(/\bCREATE TABLE IF NOT EXISTS (\w+)/gi)].map(m=>m[1]);
  assert.ok(declarations.length>=3,name+": empty or truncated migration");
  assert.equal(new Set(declarations).size,declarations.length,name+": duplicate table definitions");
  assert.ok(!/^\s*\),\s*$/m.test(sql),name+": unexpected detached closing column definition");
 }
});

test("accounting migration 073 preserves direct-number syntax and full audit triggers",()=>{
 const sql=fs.readFileSync(new URL(names[0],migrationDir),"utf8");
 assert.match(sql,/e164 text NOT NULL UNIQUE CHECK \(e164 ~ '\^\\\+33\(81\|82\|89\)\[0-9\]\{7\}\$'\)/);
 assert.match(sql,/CHECK \(number_status NOT IN \('assigned','testing','active'\)\)/);
 assert.match(sql,/CHECK \(number_activation_enabled=false\)/);
 assert.match(sql,/CHECK \(payouts_enabled=false\)/);
 assert.equal((sql.match(/CREATE FUNCTION direct_sva_guard_posted_entry\(\)/g)||[]).length,1);
 assert.equal((sql.match(/CREATE TABLE IF NOT EXISTS direct_sva_journal_entries \(/g)||[]).length,1);
 assert.match(sql,/FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_audit_append_only\(\);\s*$/);
 assert.doesNotMatch(sql,/^\),\s*editor_tenant_id\b/m);
});

test("one legal entity and CRM/analytics sync disabled by database constraints",()=>{
 const sql=fs.readFileSync(new URL(names[1],migrationDir),"utf8");
 assert.match(sql,/legal_accounting_profile_id=1/);
 assert.match(sql,/CHECK\(separate_legal_fec=false\)/);
 assert.match(sql,/CHECK\(can_send_data=false\)/);
 assert.match(sql,/CHECK\(send_enabled=false\)/);
 assert.match(sql,/CHECK\(statutory_entry_id IS NULL\)/);
});

test("customer enrolment and all automations stay inaccessible or blocked",()=>{
 const sql=fs.readFileSync(new URL(names[2],migrationDir),"utf8");
 assert.match(sql,/CHECK\(dashboard_enabled=false\)/);
 assert.match(sql,/CHECK\(client_contract_accepted=false\)/);
 assert.match(sql,/CHECK\(external_execution_enabled=false\)/);
 assert.match(sql,/CHECK\(financial_transfer_enabled=false\)/);
 assert.match(sql,/idempotency_key text NOT NULL UNIQUE/);
 assert.match(sql,/direct_sva_guard_automation_events/);
});
