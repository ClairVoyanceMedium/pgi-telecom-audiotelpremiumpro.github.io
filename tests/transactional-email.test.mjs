import test from "node:test";
import assert from "node:assert/strict";
import {buildTransactionalMessage,emailHash,normalizeEmail} from "../backend/src/resend-email.mjs";

const config={publicBaseUrl:"https://audiotel-premium-pro.com"};

test("transactional templates include text and mobile responsive HTML without personal data in links",()=>{
  const m=buildTransactionalMessage(config,"payment_failed",{name:"Client Test"});
  assert.match(m.subject,/paiement/i);
  assert.match(m.text,/https:\/\/audiotel-premium-pro\.com\/client\.html\?billing=payment-required/);
  assert.match(m.html,/name="viewport"/);
  assert.match(m.html,/@media only screen and \(max-width:600px\)/);
  assert.doesNotMatch(m.html,/password=/i);
});

test("transactional recipient normalization is strict and hashing is deterministic",()=>{
  assert.equal(normalizeEmail("  TEST@example.com "),"test@example.com");
  assert.match(emailHash("TEST@example.com"),/^[a-f0-9]{64}$/);
  assert.equal(emailHash("TEST@example.com"),emailHash("test@example.com"));
  assert.throws(()=>normalizeEmail("not-an-email"),e=>e.code==="INVALID_EMAIL_RECIPIENT");
});

test("all production service templates render both plain text and html",()=>{
  const keys=[
    "registration_received","registration_internal","account_activated","account_suspended",
    "subscription_created","payment_succeeded","payment_recovered","payment_failed","payment_action_required",
    "payment_reminder","subscription_suspended","subscription_cancelled","payout_available","portability_received","portability_internal",
    "support_received","support_opened","support_internal","support_customer_reply","support_response","support_resolved"
  ];
  for(const key of keys){
    const m=buildTransactionalMessage(config,key,{name:"Client",tenant_name:"Société",country_code:"FR",severity:"normal"});
    assert.ok(m.subject.length>3,key);
    assert.ok(m.text.includes("PGI Telecom"),key);
    assert.match(m.html,/Audiotel Premium Pro/,key);
  }
});
