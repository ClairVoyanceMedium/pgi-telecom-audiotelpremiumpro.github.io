import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {normalizePortabilityPriorityEvent,PORTABILITY_PRIORITY_FEE_MINOR} from "../backend/src/stripe-billing.mjs";

const migration=fs.readFileSync("database/migrations/065_portability_priority_payment.sql","utf8");
const stripe=fs.readFileSync("backend/src/stripe-billing.mjs","utf8");
const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const api=fs.readFileSync("assets/client-portal-api.js","utf8");
const ui=fs.readFileSync("assets/client-portability.js","utf8");
const html=fs.readFileSync("client.html","utf8");

test("priority portability is a separate optional 9.90 EUR service",()=>{
  assert.equal(PORTABILITY_PRIORITY_FEE_MINOR,990);
  assert.match(migration,/handling_tier text NOT NULL DEFAULT 'standard'/);
  assert.match(migration,/amount_minor integer NOT NULL DEFAULT 990 CHECK \(amount_minor=990\)/);
  assert.match(migration,/currency char\(3\) NOT NULL DEFAULT 'EUR' CHECK \(currency='EUR'\)/);
  assert.match(migration,/standard free portability/i);
  assert.match(migration,/internal handling tier only/i);
  assert.match(stripe,/mode:"payment"/);
  assert.match(stripe,/standard remains free|standard reste gratuite/i);
  assert.match(stripe,/does not guarantee|ne garantit aucun délai/i);
  assert.match(html,/9,90 € TTC/);
  assert.match(html,/portabilité standard reste gratuite/i);
  assert.match(html,/ne garantit aucun délai/i);
});

test("standard portability is created before optional priority checkout",()=>{
  const standard=ui.indexOf("PGICustomerApi.createPortability(payload");
  const dialog=ui.indexOf("openPriority(created.id)");
  assert.ok(standard>=0&&dialog>standard);
  assert.match(ui,/Votre portabilité reste en traitement standard gratuit/);
  assert.match(api,/createPortabilityPriorityCheckout/);
  assert.match(api,/priority-checkout/);
});

test("priority checkout requires CSRF, billing permission, versioned consent and idempotency",()=>{
  const route=server.indexOf('/api/v1/customer/portability/:id/priority-checkout');
  assert.ok(route>=0);
  const slice=server.slice(route,route+8500);
  assert.match(slice,/requireCustomerCsrf/);
  assert.match(slice,/requireCustomerPermission\(context,"billing\.manage"\)/);
  assert.match(slice,/IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(slice,/priority_terms_accepted/);
  assert.match(slice,/immediate_performance_requested/);
  assert.match(slice,/2026-10-04-portability-priority-v1/);
  assert.match(slice,/amount_minor:990/);
  assert.match(slice,/standard_portability_remains_free:true/);
  assert.match(slice,/external_operator_delay_guaranteed:false/);
});

test("only a verified paid provider event promotes the work item to priority",()=>{
  const paid=store.indexOf('if(status==="paid"');
  const tier=store.indexOf("SET handling_tier='priority'");
  const queue=store.indexOf("SET priority=LEAST(priority,5)");
  assert.ok(paid>=0&&tier>paid&&queue>tier);
  const prepare=store.slice(store.indexOf("async preparePortabilityPriorityPayment"),paid);
  assert.doesNotMatch(prepare,/handling_tier='priority'/);
  assert.match(store,/portability_priority_provider_events/);
  assert.match(store,/ON CONFLICT\(provider,provider_event_id\) DO NOTHING/);
});

test("Stripe paid, expired and partial refund events normalize deterministically",()=>{
  const id="11111111-2222-4333-8444-555555555555";
  const paid=normalizePortabilityPriorityEvent({
    id:"evt_paid",type:"checkout.session.completed",created:1700000000,
    data:{object:{id:"cs_test_123",payment_status:"paid",amount_total:990,currency:"eur",payment_intent:"pi_123",metadata:{payment_kind:"portability_priority",priority_payment_public_id:id,amount_minor:"990",currency:"EUR"}}}
  });
  assert.equal(paid.status,"paid");
  assert.equal(paid.amount_minor,990);
  assert.equal(paid.currency,"EUR");
  assert.equal(paid.payment_public_id,id);

  const expired=normalizePortabilityPriorityEvent({
    id:"evt_expired",type:"checkout.session.expired",created:1700000001,
    data:{object:{id:"cs_test_124",payment_status:"unpaid",amount_total:990,currency:"eur",metadata:{payment_kind:"portability_priority",priority_payment_public_id:id,amount_minor:"990",currency:"EUR"}}}
  });
  assert.equal(expired.status,"expired");

  const partial=normalizePortabilityPriorityEvent({
    id:"evt_refund",type:"charge.refunded",created:1700000002,
    data:{object:{id:"ch_123",amount:990,amount_refunded:400,currency:"eur",payment_intent:"pi_123",metadata:{payment_kind:"portability_priority",priority_payment_public_id:id}}}
  });
  assert.equal(partial.status,"partially_refunded");
  assert.equal(partial.amount_minor,990);
  assert.equal(partial.refunded_amount_minor,400);
});

test("priority failures never cancel or downgrade the underlying portability request",()=>{
  const applyStart=store.indexOf("async applyPortabilityPriorityProviderEvent");
  const applyEnd=store.indexOf("async createCustomerPortabilityRequest",applyStart);
  const apply=store.slice(applyStart,applyEnd);
  assert.doesNotMatch(apply,/status='cancelled'/);
  assert.doesNotMatch(apply,/handling_tier='standard'/);
  assert.match(apply,/status='failed'/);
  assert.match(apply,/status='expired'/);
});
