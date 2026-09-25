import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(p,"utf8");
const legalSlugs=["mentions-legales","conditions-utilisation","conditions-abonnement","confidentialite","cookies-traceurs","resilier-contrat","retractation"];

test("complete legal corpus is published and cross-linked",()=>{
  for(const slug of legalSlugs){
    const html=read("site/seo/"+slug+".html");
    assert.match(html,/25 septembre 2026/);
    assert.match(html,/\/conditions-utilisation\//);
    assert.match(html,/\/confidentialite\//);
    assert.match(html,/\/resilier-contrat\//);
    assert.match(html,/\/retractation\//);
  }
  assert.match(read("site/seo/resilier-contrat.html"),/>Résilier votre contrat</);
  assert.match(read("site/seo/retractation.html"),/14 jours/);
  assert.match(read("site/seo/mentions-legales.html"),/À compléter avant ouverture commerciale/);
});

test("registration requires current legal documents and keeps privacy acknowledgement separate from authority",()=>{
  const audience=read("assets/client-audience.js"),portal=read("assets/client-portal.js"),server=read("backend/server.mjs");
  assert.match(audience,/id="register-legal"/);
  assert.match(audience,/conditions-utilisation/);
  assert.match(portal,/legal_terms_accepted/);
  assert.match(portal,/privacy_notice_acknowledged/);
  assert.match(portal,/legal_version:"2026-09-25"/);
  assert.match(server,/customer\/auth\/register/);
});

test("checkout requires terms and explicit immediate performance request",()=>{
  const billing=read("assets/client-billing.js"),server=read("backend/server.mjs");
  assert.match(billing,/client-billing-immediate/);
  assert.match(billing,/immediate_performance_requested:true/);
  assert.match(server,/SUBSCRIPTION_LEGAL_TERMS_REQUIRED/);
  assert.match(server,/IMMEDIATE_PERFORMANCE_REQUEST_REQUIRED/);
  assert.match(server,/LEGAL_DOCUMENT_VERSION_OUTDATED/);
  assert.match(server,/recordCustomerLegalAcceptance/);
});

test("legal acceptance evidence is immutable and tenant scoped",()=>{
  const migration=read("database/migrations/059_customer_legal_acceptances.sql");
  assert.match(migration,/CREATE TABLE customer_legal_acceptances/);
  assert.match(migration,/append-only/);
  assert.match(migration,/BEFORE UPDATE OR DELETE ON customer_legal_acceptances/);
  assert.match(migration,/security_barrier=true/);
  assert.match(migration,/pgi_require_tenant_context/);
});

test("customer API POST helper always delegates to request and cannot recurse",()=>{
  const api=read("assets/client-portal-api.js");
  assert.match(api,/function post\(path,body,idempotencyKey\)\{return request\(path,\{method:"POST"/);
  assert.doesNotMatch(api,/function post\(path,body,idempotencyKey\)\{return post\(/);
});

test("Google identity SDK is user-triggered rather than loaded during init",()=>{
  const google=read("assets/client-google.js");
  assert.match(google,/data-google-enable/);
  assert.match(google,/activate\(el,options,clientId\)/);
  const init=google.slice(google.indexOf("async function init(options)"));
  assert.doesNotMatch(init,/await load\(\)/);
});

test("build publishes all legal routes and injects global legal navigation",()=>{
  const build=read("scripts/build-static.mjs");
  for(const slug of legalSlugs)assert.match(build,new RegExp('"'+slug+'"'));
  assert.match(build,/injectLegalNavigation/);
});
