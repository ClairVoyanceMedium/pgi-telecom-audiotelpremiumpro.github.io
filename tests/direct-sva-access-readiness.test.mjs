import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {evaluateDirectSvaAccessReadiness,directSvaAccessReadiness} from "../backend/src/direct-sva-access-readiness.mjs";

const tables=["direct_sva_customer_accounts","direct_sva_customer_cases","direct_sva_number_inventory","direct_sva_admin_switches","direct_sva_operator_controls","direct_sva_website_visibility"];
const constraints=["CHECK ((business_unit = 'direct_sva'::text))",
 "CHECK ((dashboard_enabled = false))","CHECK ((client_contract_accepted = false))"]
 .map(definition=>({table_name:"direct_sva_customer_accounts",definition}));
function fixture(overrides={}){return {
 tables,constraints,customerAccounts:0,cases:0,activeNumbers:0,
 switches:{commercial_operation_enabled:false},
 operator:{operator_mode:"preparation",number_activation_enabled:false,payouts_enabled:false},
 website:{public_content_authorized:false},...overrides
};}
test("diagnostic reports actual locks and never claims real production customer readiness",()=>{
 const result=evaluateDirectSvaAccessReadiness(fixture());
 assert.equal(result.business_unit,"direct_sva");
 assert.equal(result.schema_complete,true);
 assert.equal(result.protective_constraints_verified,true);
 assert.equal(result.preparation_controls_safe,true);
 assert.equal(result.postgres_rls_defense_verified,false);
 assert.ok(result.postgres_rls_unprotected_tables.length>=5);
 assert.ok(result.checks.some(x=>x.key==="rls"&&x.status==="not_configured"));
 assert.equal(result.production_ready,false);
 assert.equal(result.customer_portal_released,false);
 assert.equal(result.live_business_live_verified,false);
 assert.equal(result.existing_audiotel_customer_records_queried,false);
 assert.equal(result.existing_audiotel_billing_queried,false);
 assert.ok(result.checks.some(c=>c.key==="real_client"&&c.status==="not_tested"));
});
test("unverified constraints, unexpected customer accounts or unlocked payments fail safely",()=>{
 const variants=[
 fixture({constraints:[]}),
 fixture({customerAccounts:1}),
 fixture({cases:1}),
 fixture({activeNumbers:1}),
 fixture({switches:{commercial_operation_enabled:true}}),
 fixture({operator:{operator_mode:"operational",number_activation_enabled:true,payouts_enabled:true}}),
 fixture({website:{public_content_authorized:true}}),
 fixture({tables:tables.slice(1)})
 ];
 for(const item of variants){
  const result=evaluateDirectSvaAccessReadiness(item);
  assert.equal(result.preparation_controls_safe,false);
  assert.equal(result.production_ready,false);
 }
});
test("missing PostgreSQL always results in unavailable, not ready",async()=>{
 const result=await directSvaAccessReadiness({});
 assert.equal(result.schema_complete,false);
 assert.equal(result.production_ready,false);
 assert.equal(result.customer_portal_public_access_authorized,false);
});
test("read-only diagnostic never queries Audiotel client, billing, CRM or payments",async()=>{
 const statements=[];
 const fake={readSql:{unsafe:async(sql,args=[])=>{
  statements.push(sql);
  if(sql.includes("information_schema.tables"))return tables.map(table_name=>({table_name}));
  if(sql.includes("pg_constraint"))return constraints;
  if(sql.includes("FROM pg_class"))return [];
  if(sql.includes("count(*)")&&sql.includes("customer_accounts"))return [{total:0}];
  if(sql.includes("count(*)")&&sql.includes("customer_cases"))return [{total:0}];
  if(sql.includes("count(*)")&&sql.includes("number_inventory"))return [{total:0}];
  if(sql.includes("FROM direct_sva_admin_switches"))return [{commercial_operation_enabled:false}];
  if(sql.includes("FROM direct_sva_operator_controls"))return [{operator_mode:"preparation",number_activation_enabled:false,payouts_enabled:false}];
  if(sql.includes("FROM direct_sva_website_visibility"))return [{public_content_authorized:false}];
  throw Error("Unexpected query");
 }}};
 const result=await directSvaAccessReadiness(fake);
 assert.equal(result.preparation_controls_safe,true);
 assert.equal(statements.length,9);
 assert.ok(statements.every(query=>!/\bFROM\s+(?:calls|tenants|billing|ledger|invoices|customers)\b/i.test(query)));
 assert.ok(statements.every(query=>!/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i.test(query)));
});
test("cockpit provides a dedicated admin access diagnostics tab, never public customer route",()=>{
 const ui=fs.readFileSync("assets/direct-sva-cockpit.js","utf8");
 const server=fs.readFileSync("backend/server.mjs","utf8");
 assert.match(ui,/\["access","Sécurité des accès"\]/);
 assert.match(ui,/\/platform\/direct-sva\/access-readiness/);
 assert.match(ui,/existing_audiotel_customer_records_queried!==false/);
 assert.match(server,/pathname==="\/api\/v1\/platform\/direct-sva\/access-readiness"/);
 assert.match(server,/requireRole\(actor,\["admin"\]\)/);
});

test("RLS is only reported secure when every tenant-owned table enforces its policy",()=>{
 const base=fixture();
 const guarded=["direct_sva_customer_accounts","direct_sva_customer_cases",
  "direct_sva_number_inventory","direct_sva_journal_entries","direct_sva_journal_lines"]
  .map(table_name=>({table_name,rls_enabled:true,rls_forced:true}));
 const result=evaluateDirectSvaAccessReadiness({...base,rowPolicies:guarded});
 assert.equal(result.postgres_rls_defense_verified,true);
 assert.deepEqual(result.postgres_rls_unprotected_tables,[]);
 assert.ok(result.checks.some(x=>x.key==="rls"&&x.status==="observed"));
 const missing=evaluateDirectSvaAccessReadiness({...base,rowPolicies:guarded.slice(1)});
 assert.equal(missing.postgres_rls_defense_verified,false);
 assert.ok(missing.postgres_rls_unprotected_tables.includes("direct_sva_customer_accounts"));
});
