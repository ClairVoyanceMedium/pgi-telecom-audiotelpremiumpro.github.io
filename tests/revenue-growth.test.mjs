import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {normalizeStripePortabilityPriorityEvent} from "../backend/src/stripe-billing.mjs";

const read=path=>fs.readFileSync(path,"utf8");

test("priority portability payment event is normalized safely",()=>{
  const row=normalizeStripePortabilityPriorityEvent({
    id:"evt_priority_paid",
    type:"checkout.session.completed",
    created:1791100000,
    data:{object:{
      id:"cs_priority_1",
      mode:"payment",
      payment_status:"paid",
      amount_total:990,
      currency:"eur",
      payment_intent:"pi_priority_1",
      metadata:{
        order_kind:"portability_priority",
        order_public_id:"11111111-1111-4111-8111-111111111111",
        tenant_public_id:"22222222-2222-4222-8222-222222222222",
        portability_request_id:"42"
      }
    }}
  });
  assert.equal(row.amount_minor,990);
  assert.equal(row.currency,"EUR");
  assert.equal(row.portability_request_id,42);
  assert.equal(row.payment_intent_reference,"pi_priority_1");
});

test("unpaid portability checkout does not activate priority",()=>{
  const row=normalizeStripePortabilityPriorityEvent({
    id:"evt_unpaid",type:"checkout.session.completed",
    data:{object:{mode:"payment",payment_status:"unpaid",metadata:{order_kind:"portability_priority"}}}
  });
  assert.equal(row,null);
});

test("referral program has a server-side global switch",()=>{
  const migration=read("database/migrations/064_revenue_growth_referral.sql");
  const domain=read("backend/src/revenue-growth.mjs");
  const server=read("backend/server.mjs");
  const admin=read("assets/platform-referral-admin.js");
  assert.match(migration,/referral_enabled boolean NOT NULL DEFAULT true/);
  assert.match(domain,/reason:"disabled"/);
  assert.match(domain,/status='qualified'/);
  assert.match(server,/\/api\/v1\/platform\/referral-program/);
  assert.match(admin,/data-referral-toggle/);
});

test("priority portability affects PGI processing without operator SLA promise",()=>{
  const migration=read("database/migrations/064_revenue_growth_referral.sql");
  const domain=read("backend/src/revenue-growth.mjs");
  const store=read("backend/src/store-postgres.mjs");
  const client=read("assets/client-portability.js");
  assert.match(migration,/processing_class IN \('standard','priority'\)/);
  assert.match(store,/p\.processing_class='priority' THEN 15 ELSE 20/);
  assert.match(domain,/operator_sla_guaranteed:false/);
  assert.match(client,/ne garantit ni ne raccourcit les délais imposés par l’opérateur/);
  assert.match(client,/9,90 € TTC/);
});

test("customer payment UI uses neutral provider wording",()=>{
  const growth=read("assets/client-growth-suite.js");
  const cards=read("assets/client-card-payments.js");
  assert.doesNotMatch(growth,/STRIPE CONNECT|Activation Stripe|Frais de traitement Stripe/i);
  assert.doesNotMatch(cards,/STRIPE CONNECT/i);
  assert.match(growth,/PAIEMENT SÉCURISÉ/);
});
