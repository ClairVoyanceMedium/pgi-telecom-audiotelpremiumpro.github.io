import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {buildTransactionalMessage,forwardInboundEmailToInternal} from "../backend/src/resend-email.mjs";

const config={publicBaseUrl:"https://audiotel-premium-pro.com"};

test("les emails transactionnels portent automatiquement la référence dossier",()=>{
  const ref="APP-2026-00K8M4P2Q";
  const message=buildTransactionalMessage(config,"registration_received",{name:"Client Test",dossier_ref:ref,locale:"fr-FR"});
  assert.match(message.subject,new RegExp(ref));
  assert.match(message.text,/Référence dossier/);
  assert.match(message.text,new RegExp(ref));
  assert.match(message.html,new RegExp(ref));
});

test("un email entrant reconnu est préclassé avec le dossier et reste directement répondable",async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(input,init={})=>{
    const url=typeof input==="string"?input:String(input?.url||input);
    calls.push({url,method:init.method||"GET",body:init.body||""});
    if(url==="https://api.resend.com/emails"&&init.method==="POST")return Response.json({id:"forward-recognized"},{status:200});
    throw new Error("Unexpected request "+String(init.method||"GET")+" "+url);
  };
  try{
    let resolved=null;
    const result=await forwardInboundEmailToInternal({
      resendApiKey:"send-key",
      transactionalDomain:"audiotel-premium-pro.com",
      internalNotificationEmail:"ops@example.com",
      transactionalFromName:"Audiotel Premium Pro",
      resendTimeoutMs:1000
    },{
      email_id:"email_recognized_123",
      message_id:"<incoming-123@example.test>",
      from:"Client Test <client@example.test>",
      to:["support@audiotel-premium-pro.com"],
      subject:"Question sur mon abonnement",
      text:"Bonjour, pouvez-vous vérifier mon abonnement ?"
    },{
      resolveCustomer:async input=>{
        resolved=input;
        return {matched:true,ambiguous:false,match_method:"email",tenant_public_id:"11111111-1111-4111-8111-111111111111",display_name:"Client Test",dossier_ref:"APP-2026-00K8M4P2Q"};
      }
    });
    assert.equal(resolved.email,"client@example.test");
    assert.equal(result.customer_matched,true);
    assert.equal(result.dossier_ref,"APP-2026-00K8M4P2Q");
    assert.equal(result.match_method,"email");
    const body=JSON.parse(calls.at(-1).body);
    assert.equal(body.reply_to,"client@example.test");
    assert.match(body.subject,/^\[APP-2026-00K8M4P2Q\]/);
    assert.equal(body.headers["X-PGI-Dossier"],"APP-2026-00K8M4P2Q");
    assert.match(body.text,/Client reconnu automatiquement : oui/);
  }finally{
    globalThis.fetch=originalFetch;
  }
});

test("le code conserve le numéro de dossier comme indice et non comme authentification",()=>{
  const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
  assert.match(store,/async resolveInboundCustomer\(/);
  assert.match(store,/finalize\(\[\.\.\.unique\.values\(\)\]\[0\],"thread"\)/);
  assert.match(store,/finalize\(hinted,"email_dossier"\)/);
  assert.match(store,/finalize\(candidates\[0\],"email"\)/);
  assert.match(store,/reason:"unknown_sender"/);
  const resolverStart=store.indexOf("async resolveInboundCustomer(");
  const resolverEnd=store.indexOf("\n  async tenantDuplicateCandidates",resolverStart);
  const resolver=store.slice(resolverStart,resolverEnd);
  assert.match(resolver,/if\(!candidates\.length\)return \{matched:false,ambiguous:false,reason:"unknown_sender"/);
  assert.doesNotMatch(resolver,/if\(hints\.length\).*return finalize\([^\n]*"email_dossier"\);\s*if\(!candidates\.length/);
});

test("la corrélation par fil repose sur Message-ID et ne stocke pas le contenu reçu",()=>{
  const store=fs.readFileSync("backend/src/store-postgres.mjs","utf8");
  const migration=fs.readFileSync("database/migrations/063_email_customer_identity.sql","utf8");
  const dispatcher=fs.readFileSync("backend/src/email-dispatcher.mjs","utf8");
  assert.match(store,/provider_message_id=ANY/);
  assert.match(store,/emailThreadReferences/);
  assert.match(dispatcher,/providerMessageId/);
  assert.match(migration,/inbound_email_customer_links/);
  assert.match(migration,/sender_hash/);
  assert.doesNotMatch(migration,/\bsubject\b|message_body|\bbody\b/i);
});
