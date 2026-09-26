import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=p=>fs.readFileSync(p,"utf8");
const legalSlugs=["mentions-legales","conditions-utilisation","conditions-abonnement","confidentialite","accord-traitement-donnees","cookies-traceurs","resilier-contrat","retractation"];

test("complete legal corpus is published and cross-linked",()=>{
  for(const slug of legalSlugs){
    const html=read("site/seo/"+slug+".html");
    assert.match(html,/26 septembre 2026/);
    assert.match(html,/\/conditions-utilisation\//);
    assert.match(html,/\/confidentialite\//);
    assert.match(html,/\/resilier-contrat\//);
    assert.match(html,/\/retractation\//);
  }
  assert.match(read("site/seo/resilier-contrat.html"),/>Résilier votre contrat</);
  assert.match(read("site/seo/retractation.html"),/14 jours/);
  const dpa=read("site/seo/accord-traitement-donnees.html");
  assert.match(dpa,/Instructions documentées/);
  assert.match(dpa,/Sous-traitants ultérieurs/);
  assert.match(dpa,/Violations de données/);
  assert.match(dpa,/Audit/);
  const legalNotice=read("site/seo/mentions-legales.html");
  assert.match(legalNotice,/À compléter avant ouverture commerciale/);
  assert.match(legalNotice,/440 N Barranca Avenue #4133/);
  assert.match(legalNotice,/numéro de téléphone légal de l’hébergeur/);
});

test("registration requires current legal documents and keeps privacy acknowledgement separate from authority",()=>{
  const audience=read("assets/client-audience.js"),portal=read("assets/client-portal.js"),server=read("backend/server.mjs");
  assert.match(audience,/id="register-legal"/);
  assert.match(audience,/conditions-utilisation/);
  assert.match(portal,/legal_terms_accepted/);
  assert.match(portal,/privacy_notice_acknowledged/);
  assert.match(portal,/legal_version:"2026-09-26-b2b-b2c-v4"/);
  const terms=read("site/seo/conditions-abonnement.html"),cgu=read("site/seo/conditions-utilisation.html");
  assert.match(terms,/Partie B2C : informations avant engagement/);
  assert.match(terms,/Partie B2B : socle commercial/);
  assert.match(terms,/garantie légale de conformité/i);
  assert.match(terms,/commande et obligation de paiement/i);
  assert.match(terms,/2026-09-26-b2b-b2c-v4/);
  assert.match(terms,/durée indéterminée/i);
  assert.match(terms,/facturé par périodes mensuelles successives/i);
  assert.match(terms,/résiliation à tout moment/i);
  assert.match(terms,/Absence de prorata en cas de résiliation volontaire/);
  assert.match(terms,/Tableaux de bord, appels et données provisoires/);
  assert.match(terms,/Routage et studio vocal/);\n  assert.match(terms,/Modifications du service numérique B2C/);\n  assert.match(terms,/Coopération, contrôle et audit B2B/);\n  assert.match(terms,/Clause de juridiction entre commerçants/);\n  assert.match(terms,/accord-traitement-donnees/);
  assert.match(cgu,/Règles particulières aux consommateurs/);
  assert.match(cgu,/Règles particulières aux professionnels/);
  assert.match(server,/customer\/auth\/register/);
});

test("checkout requires terms and explicit immediate performance request",()=>{
  const billing=read("assets/client-billing.js"),server=read("backend/server.mjs");
  assert.match(billing,/client-billing-immediate/);
  assert.match(billing,/immediate_performance_requested:true/);
  assert.match(billing,/Souscrire avec obligation de paiement/);
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

test("consumer paid checkout stays fail-closed until B2C prerequisites are genuinely operational",()=>{
  const config=read("backend/src/config.mjs");
  const postgres=read("backend/src/store-postgres.mjs");
  const server=read("backend/server.mjs");
  const billing=read("assets/client-billing.js");
  const withdrawal=read("site/seo/retractation.html");
  assert.match(config,/PGI_B2C_COMMERCIAL_READY/);
  assert.match(config,/onlineWithdrawalReady=transactionalEmailEnabled&&resendApiKey/);
  assert.match(config,/b2cCommercialReady=b2cCommercialRequested&&legalOperatorConfigured&&consumerMediatorConfigured&&onlineWithdrawalReady/);
  assert.match(postgres,/AS customer_type/);
  assert.match(server,/B2C_COMMERCIAL_NOT_READY/);
  assert.match(server,/b2c_commercial_ready/);
  assert.match(billing,/Souscription particulier indisponible/);
  assert.match(withdrawal,/n’accepte une déclaration que lorsque son enregistrement durable/);
  assert.match(withdrawal,/souscription payante des comptes particuliers reste bloquée côté serveur/);
});

test("online consumer withdrawal is direct, explicit, durable and acknowledged",()=>{
  const html=read("site/seo/retractation.html");
  const client=read("assets/withdrawal.js");
  const server=read("backend/server.mjs");
  const postgres=read("backend/src/store-postgres.mjs");
  const dispatcher=read("backend/src/email-dispatcher.mjs");
  const email=read("backend/src/resend-email.mjs");
  const migration=read("database/migrations/060_customer_withdrawal_requests.sql");
  assert.match(html,/Renoncer au contrat ici/);
  assert.match(html,/Confirmer la rétractation/);
  assert.match(html,/acknowledgement_email/);
  assert.match(client,/\/public\/withdrawal\/status/);
  assert.match(client,/available=response\.ok&&data\.available===true/);
  assert.match(client,/Idempotency-Key/);
  assert.match(server,/\/api\/v1\/public\/withdrawal\/status/);
  assert.match(server,/customerWithdrawalFeatureReady/);
  assert.match(server,/\/api\/v1\/public\/withdrawal/);
  assert.match(server,/WITHDRAWAL_CONFIRMATION_REQUIRED/);
  assert.match(server,/requester_ip_sha256/);
  assert.match(postgres,/consumer\.withdrawal\.received/);
  assert.match(dispatcher,/withdrawal_received/);
  assert.match(email,/Date et heure de la déclaration/);
  assert.match(migration,/CREATE TABLE customer_withdrawal_requests/);
  assert.doesNotMatch(migration,/requester_ip\s+text/);
});
