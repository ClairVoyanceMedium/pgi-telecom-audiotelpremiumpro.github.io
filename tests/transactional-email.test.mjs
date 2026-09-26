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
    "email_verification","password_reset","password_changed","email_change_confirmation","email_changed","email_change_notice_old","passkey_added",
    "registration_received","registration_internal","account_activated","account_suspended",
    "subscription_created","payment_succeeded","payment_recovered","payment_failed","payment_action_required",
    "payment_reminder","subscription_suspended","subscription_cancelled","subscription_cancellation_received","consumer_withdrawal_ack","consumer_withdrawal_internal","payout_available","portability_received","portability_internal",
    "support_received","support_opened","support_internal","support_customer_reply","support_response","support_resolved"
  ];
  for(const key of keys){
    const m=buildTransactionalMessage(config,key,{name:"Client",tenant_name:"Société",country_code:"FR",severity:"normal"});
    assert.ok(m.subject.length>3,key);
    assert.ok(m.text.includes("Audiotel Premium Pro"),key);
    assert.match(m.html,/Audiotel Premium Pro/,key);
    assert.match(m.html,/https:\/\/audiotel-premium-pro\.com\/assets\/audiotel-brand-logo-v33\.png/,key);
    assert.match(m.html,/alt="Audiotel Premium Pro"/,key);
    assert.match(m.text,/Audiotel Premium Pro \| Une solution PGI Telecom/,key);
    assert.match(m.html,/Audiotel Premium Pro \| Une solution PGI Telecom/,key);
    assert.doesNotMatch(m.subject,/PGI Telecom/,key);
    assert.doesNotMatch(m.subject,/e-mail|E-Mail|E-mail/,key);
    assert.doesNotMatch(m.text,/e-mail|E-Mail|E-mail/,key);
    assert.doesNotMatch(m.html,/e-mail|E-Mail|E-mail/,key);
  }
});


test("customer templates support all portal languages",()=>{
  const keys=["password_reset","password_changed","email_change_confirmation","payment_succeeded","payment_failed","subscription_suspended","support_response"];
  for(const locale of ["fr-FR","en-GB","es-ES","it-IT","pt-PT","de-DE","sv-SE"]){
    for(const key of keys){
      const m=buildTransactionalMessage(config,key,{name:"Client Test",locale,action_url:"https://audiotel-premium-pro.com/client.html#password-reset=test-token",invoice_url:"https://invoice.stripe.com/i/test",invoice_pdf_url:"https://invoice.stripe.com/i/test.pdf"});
      assert.ok(m.subject.length>4,locale+" "+key);
      assert.match(m.html,/Audiotel Premium Pro/,locale+" "+key);
      assert.match(m.html,/confidentialite/,locale+" "+key);
      assert.match(m.html,/conditions-abonnement/,locale+" "+key);
    }
  }
});

test("security action links stay on the production origin",()=>{
  const ok=buildTransactionalMessage(config,"password_reset",{name:"Client",action_url:"https://audiotel-premium-pro.com/client.html#password-reset=abc"});
  assert.match(ok.html,/password-reset=abc/);
  const blocked=buildTransactionalMessage(config,"password_reset",{name:"Client",action_url:"https://evil.example/reset"});
  assert.doesNotMatch(blocked.html,/evil\.example/);
});
