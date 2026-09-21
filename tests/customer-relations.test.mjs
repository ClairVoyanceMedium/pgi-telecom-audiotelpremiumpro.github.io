import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {relationActionPolicy,relationNextActions,sanitizeRelationPayload,safeAgentContext,relationCaseDeadlines} from "../backend/src/customer-relations-policy.mjs";

const migration=fs.readFileSync("database/migrations/051_customer_relations_offboarding.sql","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const adminApi=fs.readFileSync("assets/api-client.js","utf8");
const customerApi=fs.readFileSync("assets/client-portal-api.js","utf8");
const adminUi=fs.readFileSync("assets/customer-relations.js","utf8");
const customerUi=fs.readFileSync("assets/client-relations.js","utf8");
const mobile=fs.readFileSync("assets/client-mobile.js","utf8");

test("customer relations schema is append-only and models disputes plus safe exit",()=>{
  for(const table of ["tenant_relation_cases","tenant_relation_case_events","tenant_relation_evidence","tenant_dispute_collection_holds","tenant_exit_requests","tenant_exit_lines","tenant_relation_actions"]){
    assert.match(migration,new RegExp("CREATE TABLE "+table));
  }
  assert.match(migration,/disputed_amount_only/);
  assert.match(migration,/number_quarantine_until/);
  assert.match(migration,/rio_status/);
  assert.match(migration,/portability_service_level/);
  assert.match(migration,/return_back/);
  assert.match(migration,/security_barrier=true/);
  assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("agent policy separates automatic analysis from money movement and irreversible actions",()=>{
  assert.deepEqual(relationActionPolicy("collect_evidence").execution_mode,"automatic");
  assert.deepEqual(relationActionPolicy("reconcile_billing").execution_mode,"automatic");
  assert.deepEqual(relationActionPolicy("issue_refund").execution_mode,"approval_required");
  assert.deepEqual(relationActionPolicy("release_number").execution_mode,"customer_confirmation");
  assert.deepEqual(relationActionPolicy("submit_port_out").execution_mode,"external_confirmation");
  assert.deepEqual(relationActionPolicy("revoke_access").execution_mode,"external_confirmation");
  assert.equal(relationActionPolicy("release_number").risk_class,"irreversible");
});

test("agent context is privacy-minimised and never receives raw RIO or credentials",()=>{
  const cleaned=sanitizeRelationPayload({
    message:"ok",rio:"secret-rio",password:"secret",card_number:"4111111111111111",
    nested:{authorization:"Bearer x",safe:"kept"}
  });
  assert.equal(cleaned.message,"ok");
  assert.equal(cleaned.rio,undefined);
  assert.equal(cleaned.password,undefined);
  assert.equal(cleaned.card_number,undefined);
  assert.equal(cleaned.nested.authorization,undefined);
  assert.equal(cleaned.nested.safe,"kept");
  const context=safeAgentContext({public_id:"c",case_kind:"port_out",description:"sortie"},[],[],{public_id:"e",port_out_requested:true},[]);
  assert.equal(context.guardrails.no_money_movement_without_approval,true);
  assert.equal(context.guardrails.no_port_out_completion_without_operator_confirmation,true);
  assert.equal(context.guardrails.do_not_use_rio_request_for_retention_marketing,true);
  assert.equal(context.guardrails.raw_rio_or_credentials_forbidden,true);
});

test("next actions cover billing disputes, final account and consumer mediation",()=>{
  const billing=relationNextActions({case_kind:"billing_dispute",disputed_amount:12,customer_capacity:"consumer"});
  const billingTypes=billing.map(x=>x.action_type);
  assert.ok(billingTypes.includes("collect_evidence"));
  assert.ok(billingTypes.includes("reconcile_billing"));
  assert.ok(billingTypes.includes("place_dispute_hold"));
  assert.ok(billingTypes.includes("prepare_mediation"));
  const exit=relationNextActions({case_kind:"port_out",customer_capacity:"business"},{port_out_requested:true});
  const exitTypes=exit.map(x=>x.action_type);
  for(const action of ["prepare_exit","generate_data_export","request_final_invoice","reconcile_final_settlement","check_portability","request_outbound_rio"])assert.ok(exitTypes.includes(action));
});

test("consumer mediation clock is independent from service deadlines",()=>{
  const start=new Date("2026-09-21T10:00:00Z");
  const x=relationCaseDeadlines("billing_dispute","normal","consumer",start);
  assert.equal(x.first_response_due_at,"2026-09-22T10:00:00.000Z");
  assert.equal(x.target_resolution_at,"2026-10-01T10:00:00.000Z");
  assert.equal(x.mediation_eligible_at,"2026-11-21T10:00:00.000Z");
  assert.equal(start.toISOString(),"2026-09-21T10:00:00.000Z");
});

test("customer and staff APIs expose the full complaint and exit workflow",()=>{
  assert.match(server,/\/api\/v1\/customer\/relations\/disputes/);
  assert.match(server,/\/api\/v1\/customer\/relations\/exits/);
  assert.match(server,/customer\.relations\.action_confirm/);
  assert.match(server,/platform\.customer_relations\.agent_action/);
  assert.match(server,/platform\.customer_relations\.external_confirm/);
  assert.match(store,/createCustomerRelationCase/);
  assert.match(store,/createCustomerExitRequest/);
  assert.match(store,/completeRelationExternalAction/);
  assert.match(adminApi,/completeRelationExternalAction/);
  assert.match(customerApi,/createRelationDispute/);
  assert.match(customerApi,/createExitRequest/);
});

test("interfaces are lazy, mobile-accessible and explicit about non-automatic irreversible effects",()=>{
  assert.match(adminUi,/Litiges, réclamations & départs/);
  assert.match(adminUi,/remboursements, avoirs, libérations définitives/);
  assert.match(customerUi,/Réclamations & départ/);
  assert.match(customerUi,/Aucun numéro n’est libéré avant confirmation/);
  assert.match(customerUi,/Une demande de portabilité ne sert pas à déclencher une offre commerciale/);
  assert.match(mobile,/Réclamations & départ/);
  assert.match(fs.readFileSync("assets/client-portal.js","utf8"),/import\("\.\/client-relations\.js"\)/);
  assert.match(fs.readFileSync("assets/tenant-control-detail.js","utf8"),/import\("\.\/customer-relations\.js"\)/);
});
