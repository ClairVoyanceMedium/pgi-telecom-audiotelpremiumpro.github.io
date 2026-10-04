import test from "node:test";
import assert from "node:assert/strict";
import {buildTransactionalMessage,emailHash,normalizeEmail,forwardInboundEmailToInternal,sendPublicContactMessage} from "../backend/src/resend-email.mjs";

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
    "lead_received","registration_received","customer_access_invitation","registration_internal","account_activated","account_suspended",
    "subscription_created","payment_succeeded","payment_recovered","payment_failed","payment_action_required",
    "payment_reminder","subscription_suspended","subscription_cancelled","payout_available","portability_received","portability_internal",
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
  const keys=["lead_received","password_reset","password_changed","email_change_confirmation","payment_succeeded","payment_failed","subscription_suspended","support_response"];
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


test("lead receipt confirmation is transactional, multilingual and does not claim service activation",()=>{
  for(const locale of ["fr-FR","en-GB","es-ES","it-IT","pt-PT","de-DE","sv-SE"]){
    const m=buildTransactionalMessage(config,"lead_received",{name:"Client Test",locale});
    assert.ok(m.subject.length>4,locale);
    assert.match(m.html,/Audiotel Premium Pro/,locale);
    assert.doesNotMatch(m.text,/service SVA.*activé|SVA service.*activated/i,locale);
  }
});


test("inbound forwarding skips content retrieval when no dedicated receiving key is configured",async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(input,init={})=>{
    const url=typeof input==="string"?input:String(input?.url||input);
    calls.push({url,method:init.method||"GET",body:init.body||""});
    if(url==="https://api.resend.com/emails"&&init.method==="POST")return Response.json({id:"forward-test"},{status:200});
    throw new Error("Unexpected request "+String(init.method||"GET")+" "+url);
  };
  try{
    const result=await forwardInboundEmailToInternal({
      resendApiKey:"send-key",
      transactionalDomain:"audiotel-premium-pro.com",
      internalNotificationEmail:"ops@example.com",
      transactionalFromName:"Audiotel Premium Pro",
      resendTimeoutMs:1000
    },{
      email_id:"email_test_123",
      from:"client@example.com",
      to:["support@audiotel-premium-pro.com"],
      received_for:["support@audiotel-premium-pro.com"],
      subject:"Demande client",
      attachments:[{filename:"document.pdf",content_type:"application/pdf"}]
    });
    assert.equal(result.forwarded,true);
    assert.equal(calls.length,1);
    assert.equal(calls[0].url,"https://api.resend.com/emails");
    assert.equal(calls[0].method,"POST");
    const body=JSON.parse(calls[0].body);
    assert.match(body.text,/client@example\.com/);
    assert.match(body.text,/document\.pdf/);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test("inbound forwarding uses a separate key for full received-email content",async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(input,init={})=>{
    const url=typeof input==="string"?input:String(input?.url||input);
    calls.push({url,method:init.method||"GET",authorization:String(init.headers?.authorization||""),body:init.body||""});
    if(url.includes("/emails/receiving/"))return Response.json({
      from:"client@example.com",
      to:["support@audiotel-premium-pro.com"],
      subject:"Message complet",
      text:"Bonjour, ceci est le contenu complet."
    },{status:200});
    if(url==="https://api.resend.com/emails"&&init.method==="POST")return Response.json({id:"forward-full"},{status:200});
    throw new Error("Unexpected request "+String(init.method||"GET")+" "+url);
  };
  try{
    const result=await forwardInboundEmailToInternal({
      resendApiKey:"send-key",
      resendReceivingApiKey:"read-key",
      transactionalDomain:"audiotel-premium-pro.com",
      internalNotificationEmail:"ops@example.com",
      transactionalFromName:"Audiotel Premium Pro",
      resendTimeoutMs:1000
    },{
      email_id:"email_test_456",
      from:"client@example.com",
      to:["support@audiotel-premium-pro.com"],
      subject:"Message complet"
    });
    assert.equal(result.forwarded,true);
    assert.equal(calls.length,2);
    assert.equal(calls[0].authorization,"Bearer read-key");
    assert.equal(calls[1].authorization,"Bearer send-key");
    assert.match(JSON.parse(calls[1].body).text,/contenu complet/);
  }finally{
    globalThis.fetch=originalFetch;
  }
});


test("public contact message is delivered internally with visitor Reply-To and escaped HTML",async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(input,init={})=>{
    const url=typeof input==="string"?input:String(input?.url||input);
    calls.push({url,method:init.method||"GET",body:init.body||""});
    if(url==="https://api.resend.com/emails"&&init.method==="POST")return Response.json({id:"contact-test"},{status:200});
    throw new Error("Unexpected request "+String(init.method||"GET")+" "+url);
  };
  try{
    const result=await sendPublicContactMessage({
      resendApiKey:"send-key",
      transactionalDomain:"audiotel-premium-pro.com",
      internalNotificationEmail:"contact.audiotel.premium.pro@gmail.com",
      transactionalFromName:"Audiotel Premium Pro",
      resendTimeoutMs:1000
    },{
      email:"Client@example.com",
      message:"Bonjour <script>alert(1)</script>\nJ’ai une question.",
      pagePath:"/tarif-numero-sva/",
      pageTitle:"Tarif numéro SVA",
      eventId:"public-contact/test-123"
    });
    assert.equal(result.sent,true);
    assert.equal(calls.length,1);
    const body=JSON.parse(calls[0].body);
    assert.equal(body.to[0],"contact.audiotel.premium.pro@gmail.com");
    assert.equal(body.reply_to,"client@example.com");
    assert.match(body.from,/support@audiotel-premium-pro\.com/);
    assert.match(body.text,/J’ai une question/);
    assert.match(body.text,/\/tarif-numero-sva\//);
    assert.doesNotMatch(body.html,/<script>/i);
    assert.match(body.html,/&lt;script&gt;/i);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test("customer access invitation uses a one-time link and never sends a plaintext password",()=>{
  const m=buildTransactionalMessage(config,"customer_access_invitation",{name:"Client Test",action_url:"https://audiotel-premium-pro.com/client.html?invite=secure-token"});
  assert.match(m.subject,/accès/i);
  assert.match(m.text,/choisir votre mot de passe/i);
  assert.match(m.html,/client\.html\?invite=secure-token/);
  assert.match(m.text,/aucun mot de passe temporaire n’est envoyé/i);
  assert.doesNotMatch(m.text,/votre mot de passe est\s*[:=]|mot de passe temporaire\s*[:=]/i);
});
