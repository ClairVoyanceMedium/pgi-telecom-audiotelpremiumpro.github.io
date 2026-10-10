import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {directSvaFinancialReadiness} from "../backend/src/direct-sva-financial-readiness.mjs";
import {assertDirectSvaCockpitPayload} from "../assets/direct-sva-cockpit.js";
import {planDirectSvaFinancialCycle} from "../backend/src/direct-sva-financial-cycle.mjs";

function schemaSql(){return [{t0:true,t1:true,t2:true,t3:true,t4:true,t5:true}];}
function healthyStore({missing=false,drift=false}={}){
 const queries=[];
 return {queries,store:{readSql:{unsafe:async sql=>{
  queries.push(sql);
  if(sql.startsWith("SELECT to_regclass("))return missing?[{t0:true,t1:false,t2:false,t3:false,t4:false,t5:false}]:schemaSql();
  if(sql.includes("FROM direct_sva_financial_cycle_previews"))return [{n:0}];
  if(sql.includes("FROM direct_sva_financial_publisher_previews"))return [{n:0}];
  if(sql.includes("FROM direct_sva_bank_event_previews"))return [{n:0}];
  if(sql.includes("FROM direct_sva_financial_exception_previews"))return [{n:0}];
  if(sql.includes("FROM direct_sva_operator_controls"))return [{
   operator_mode:"preparation",number_activation_enabled:false,payouts_enabled:false
  }];
  if(sql.includes("FROM direct_sva_integration_readiness"))
   return ["network","payment_psp","statutory_accounting"].map(key=>({
    integration_key:key,activation_status:drift&&key==="payment_psp"?"enabled":"disabled",
    can_send_data:false
   }));
  throw Error("UNEXPECTED_SQL");
 }}}};
}
test("readiness fails safely without the new migrations",async()=>{
 const {store}=healthyStore({missing:true});
 const result=await directSvaFinancialReadiness(store);
 assert.equal(result.status,"migration_pending");
 assert.equal(result.production_ready,false);
 assert.equal(result.automatic_processing_enabled,false);
 assert.ok(result.missing_tables.length>=1);
});
test("readiness reports disabled connectors even with full preparatory schema",async()=>{
 const {store}=healthyStore();
 const result=await directSvaFinancialReadiness(store);
 assert.equal(result.status,"preparation_locked");
 assert.equal(result.finance_previews,0);
 assert.equal(result.reported_bank_events,0);
 assert.equal(result.integration_inventory.length,3);
 assert.equal(result.real_bank_connection_verified,false);
 assert.equal(result.business_live_finance_release_authorized,false);
 assert.equal(result.payout_execution_enabled,false);
});
test("unexpected PSP activation is a blocking configuration incident",async()=>{
 const {store}=healthyStore({drift:true});
 await assert.rejects(()=>directSvaFinancialReadiness(store),{code:"DSVA_FINANCE_PRELAUNCH_CONTROL_DRIFT"});
});
test("financial readiness refuses missing persistent SQL",async()=>{
 await assert.rejects(()=>directSvaFinancialReadiness({}),{code:"DSVA_FINANCE_DATABASE_REQUIRED"});
});
test("new financial cycle is accepted by cockpit only as a locked simulation",()=>{
 const statement={operator_reference:"OPERATOR-1234",statement_reference:"STATEMENT-5678",period:"2026-10",currency:"EUR",rows:[
  {cdr_reference:"CDR-EXAMPLE-0001",called_number:"+33891234567",billable_seconds:60,
   publisher_reference:"EDITEUR-00001",upstream_net_minor:1000,pgi_margin_minor:200,publisher_due_minor:800}
 ]};
 const result=planDirectSvaFinancialCycle({statement,receipts:[],recognition_date:"2026-10-10",
  contract_model:"intermediary_net_preview",holds:[]});
 assert.equal(assertDirectSvaCockpitPayload(result,"financial_cycle"),result);
 assert.throws(()=>assertDirectSvaCockpitPayload({...result,payout_authorized:true},"financial_cycle"),
  {message:"DIRECT_SVA_COCKPIT_RESPONSE_INVALID"});
});
test("only protected admin and finance can preview finance, and readonly can see readiness",()=>{
 const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
 assert.match(server,/pathname==="\/api\/v1\/platform\/direct-sva\/financial-cycle\/preview"/);
 assert.match(server,/requireRole\(actor,\["admin","finance"\]\);requireCsrf\(req,actor,config\)/);
 assert.match(server,/planDirectSvaFinancialCycle\(body\)/);
 assert.match(server,/pathname==="\/api\/v1\/platform\/direct-sva\/financial-cycle\/readiness"/);
 assert.match(server,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
});
test("distribution financial UI is isolated and has no button that executes a payout",()=>{
 const cockpit=fs.readFileSync(new URL("../assets/direct-sva-cockpit.js",import.meta.url),"utf8");
 assert.match(cockpit,/\["financial_cycle","Cycle financier"\]/);
 assert.match(cockpit,/showFinancialCycle\(assertDirectSvaCockpitPayload\(result,"financial_cycle"\)\)/);
 assert.match(cockpit,/data-ds-financial-readiness-refresh/);
 assert.doesNotMatch(cockpit,/data-ds-execute-financial-payout/);
});
test("immutable schema fences payment intent, bank movement confirmation and external execution",()=>{
 const v82=fs.readFileSync(new URL("../database/migrations/082_direct_sva_financial_cycle_fences.sql",import.meta.url),"utf8");
 const v83=fs.readFileSync(new URL("../database/migrations/083_direct_sva_bank_event_deduplication.sql",import.meta.url),"utf8");
 assert.match(v82,/CHECK \(payout_authorized=false\)/);
 assert.match(v82,/CHECK \(external_delivery_enabled=false\)/);
 assert.match(v82,/direct_sva_guard_financial_preparation_immutable/);
 assert.match(v83,/UNIQUE\(source_adapter,external_movement_reference\)/);
 assert.match(v83,/CHECK\(bank_money_confirmed=false\)/);
 assert.match(v83,/CHECK\(payout_allowed=false\)/);
});
