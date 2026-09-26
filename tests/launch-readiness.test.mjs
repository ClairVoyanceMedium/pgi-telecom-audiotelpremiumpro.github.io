import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {evaluateLaunchReadiness} from "../backend/src/launch-readiness.mjs";

function fixture(overrides={}){
  const base={
    config:{
      mode:"production",authMode:"session",sessionSecret:"s".repeat(48),protectMachineEndpoints:true,
      transactionalEmailEnabled:true,resendApiKey:"re_"+("x".repeat(32)),resendWebhookSecret:"whsec_"+("x".repeat(32)),
      legalOperatorConfigured:true,consumerMediatorConfigured:true,b2cCommercialReady:true
    },
    system:{
      store:"postgres",work_queue:{dead_lettered:0},service_operations:{service_incidents_critical:0},
      resilience:{regions_total:1,regions_ready:1}
    },
    performance:{preproduction_gate:{ready:true}},
    platform:{
      summary:{assignments_total:1,payment_compliance_active:true},
      regulatory_trust:{summary:{numbers_ready:1,review_blocking:0}},
      scale:{regions_total:1,regions_ready:1}
    },
    billingProvider:{connection_state:"connected",stripe_live_mode:true},
    billingAccount:{reachable:true,charges_enabled:true,payouts_enabled:true,details_submitted:true,requirements_due:[]},
    carrier:{route:{active_carrier_id:1,active_carrier:"Carrier réel",active_connection_state:"active"}},
    withdrawalReady:true
  };
  return {...base,...overrides,config:{...base.config,...(overrides.config||{})},system:{...base.system,...(overrides.system||{})},performance:{...base.performance,...(overrides.performance||{})},platform:{...base.platform,...(overrides.platform||{})},billingProvider:{...base.billingProvider,...(overrides.billingProvider||{})},billingAccount:{...base.billingAccount,...(overrides.billingAccount||{})},carrier:{...base.carrier,...(overrides.carrier||{})}};
}

test("launch readiness becomes green only when every observable commercial gate is ready",()=>{
  const result=evaluateLaunchReadiness(fixture());
  assert.equal(result.ready_for_b2b,true);
  assert.equal(result.ready_for_b2c,true);
  assert.equal(result.score,100);
  assert.deepEqual(result.blockers,{b2b:[],b2c:[]});
});

test("missing consumer mediator blocks B2C without inventing a B2B blocker",()=>{
  const input=fixture({config:{consumerMediatorConfigured:false,b2cCommercialReady:false}});
  const result=evaluateLaunchReadiness(input);
  assert.equal(result.ready_for_b2b,true);
  assert.equal(result.ready_for_b2c,false);
  assert.ok(result.blockers.b2c.includes("b2c_legal"));
  assert.ok(!result.blockers.b2b.includes("b2c_legal"));
});

test("configured Stripe credentials are not enough when the live account is still restricted",()=>{
  const result=evaluateLaunchReadiness(fixture({
    billingAccount:{reachable:true,charges_enabled:false,payouts_enabled:false,details_submitted:false,requirements_due:["external_account","individual.address.line1"]}
  }));
  assert.equal(result.ready_for_b2b,false);
  assert.ok(result.blockers.b2b.includes("billing"));
  assert.equal(result.facts.stripe_account_reachable,true);
  assert.equal(result.facts.stripe_charges_enabled,false);
  assert.equal(result.facts.stripe_requirements_due,2);
});

test("operator and Stripe stay fail-closed until real active connections exist",()=>{
  const input=fixture({
    billingProvider:{connection_state:"not_connected",stripe_live_mode:false},
    billingAccount:{reachable:false,charges_enabled:false,payouts_enabled:false,details_submitted:false,requirements_due:["external_account"]},
    carrier:{route:{active_carrier_id:null,active_carrier:null,active_connection_state:null}}
  });
  const result=evaluateLaunchReadiness(input);
  assert.equal(result.ready_for_b2b,false);
  assert.equal(result.ready_for_b2c,false);
  assert.ok(result.blockers.b2b.includes("billing"));
  assert.ok(result.blockers.b2b.includes("operator"));
  assert.equal(result.sections.find(x=>x.key==="operator").status,"pending_external");
});

test("an administratively active carrier is still blocked when its latest health is explicitly bad",()=>{
  const result=evaluateLaunchReadiness(fixture({
    carrier:{route:{active_carrier_id:1,active_carrier:"Carrier réel",active_connection_state:"active",active_connection_last_health_status:"down"}}
  }));
  assert.equal(result.ready_for_b2b,false);
  assert.equal(result.ready_for_b2c,false);
  assert.ok(result.blockers.b2b.includes("operator"));
  assert.equal(result.sections.find(x=>x.key==="operator").status,"pending_external");
  assert.match(result.sections.find(x=>x.key==="operator").detail,/down/);
});

test("missing carrier telemetry does not create a fictional outage when the active connection itself is ready",()=>{
  const result=evaluateLaunchReadiness(fixture({
    carrier:{route:{active_carrier_id:1,active_carrier:"Carrier réel",active_connection_state:"active",active_connection_last_health_status:null}}
  }));
  assert.equal(result.sections.find(x=>x.key==="operator").status,"ready");
});

test("stale resilience evidence and runtime failures remain explicit blockers",()=>{
  const input=fixture({
    performance:{preproduction_gate:{ready:false,blockers:[{code:"RESTORE_DRILL_STALE"}]}},
    system:{store:"postgres",work_queue:{dead_lettered:2},service_operations:{service_incidents_critical:1},resilience:{regions_total:2,regions_ready:1}}
  });
  const result=evaluateLaunchReadiness(input);
  assert.ok(result.blockers.b2b.includes("runtime"));
  assert.ok(result.blockers.b2b.includes("resilience"));
  assert.equal(result.sections.find(x=>x.key==="runtime").status,"blocked");
});

test("launch readiness evidence is bound to the exact application release",()=>{
  const result=evaluateLaunchReadiness(fixture({config:{version:"1.30.7",releaseId:"a".repeat(40)}}));
  assert.equal(result.application_version,"1.30.7");
  assert.equal(result.release_id,"a".repeat(40));
  assert.match(result.generated_at,/T/);
});

test("launch readiness output never exposes configured secrets",()=>{
  const input=fixture();
  input.config.sessionSecret="session-secret-never-return";
  input.config.resendApiKey="re_secret-never-return";
  input.config.resendWebhookSecret="whsec_secret-never-return";
  const json=JSON.stringify(evaluateLaunchReadiness(input));
  assert.doesNotMatch(json,/session-secret-never-return|re_secret-never-return|whsec_secret-never-return/);
});

test("launch readiness endpoint is authenticated staff-only and read-only",()=>{
  const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
  const ui=fs.readFileSync(new URL("../assets/launch-readiness.js",import.meta.url),"utf8");
  assert.match(server,/pathname==="\/api\/v1\/platform\/launch-readiness"/);
  assert.match(server,/requireRole\(actor,\["admin","finance","readonly"\]\)/);
  assert.match(ui,/request\("\/platform\/launch-readiness"\)/);
  assert.doesNotMatch(ui,/method:"POST"|Idempotency-Key|X-CSRF-Token/);
});
