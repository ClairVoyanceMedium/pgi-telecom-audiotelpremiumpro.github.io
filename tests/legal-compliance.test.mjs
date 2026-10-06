import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {customerCommercialReadinessBlock} from "../backend/server.mjs";

const read=p=>fs.readFileSync(p,"utf8");
const legalSlugs=["mentions-legales","conditions-utilisation","conditions-abonnement","confidentialite","accord-traitement-donnees","cookies-traceurs","resilier-contrat","retractation"];

test("complete legal corpus is published and cross-linked",()=>{
  for(const slug of legalSlugs){
    const html=read("site/seo/"+slug+".html");
    assert.match(html,/6 octobre 2026/);
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
  assert.match(read("site/seo/mentions-legales.html"),/À compléter avant ouverture commerciale/);
});

test("registration requires current legal documents and keeps privacy acknowledgement separate from authority",()=>{
  const audience=read("assets/client-audience.js"),portal=read("assets/client-portal.js"),server=read("backend/server.mjs"),postgres=read("backend/src/store-postgres.mjs");
  assert.match(audience,/id="register-legal"/);
  assert.match(audience,/conditions-utilisation/);
  assert.match(portal,/legal_terms_accepted/);
  assert.match(portal,/privacy_notice_acknowledged/);
  assert.match(portal,/legal_version:"2026-10-06-b2b-b2c-v5"/);
  assert.match(postgres,/2026-10-06-b2b-b2c-v5/);
  assert.doesNotMatch(postgres,/2026-09-26-b2b-b2c-v3/);
  assert.doesNotMatch(postgres,/2026-09-26-b2b-b2c-v4/);
  const terms=read("site/seo/conditions-abonnement.html"),cgu=read("site/seo/conditions-utilisation.html");
  assert.match(terms,/Partie B2C : informations avant engagement/);
  assert.match(terms,/Partie B2B : socle commercial/);
  assert.match(terms,/garantie légale de conformité/i);
  assert.match(terms,/commande et obligation de paiement/i);
  assert.match(terms,/2026-10-06-b2b-b2c-v5/);
  assert.match(terms,/durée indéterminée/i);
  assert.match(terms,/facturé par périodes mensuelles successives/i);
  assert.match(terms,/résiliation à tout moment/i);
  assert.match(terms,/Absence de prorata en cas de résiliation volontaire/);
  assert.match(terms,/Tableaux de bord, appels et données provisoires/);
  assert.match(terms,/Routage et studio vocal/);
  assert.match(terms,/Modifications du service numérique B2C/);
  assert.match(terms,/Coopération, contrôle et audit B2B/);
  assert.match(terms,/Clause de juridiction entre commerçants/);
  assert.match(terms,/accord-traitement-donnees/);
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
  assert.match(postgres,/customer_type:tenant\.customer_type/);
  assert.match(server,/B2C_COMMERCIAL_NOT_READY/);
  assert.match(server,/b2c_commercial_ready/);
  assert.match(billing,/Dossier particulier en attente/);
  assert.match(withdrawal,/n’accepte une déclaration que lorsque son enregistrement durable/);
  assert.match(withdrawal,/souscription payante des comptes particuliers reste bloquée côté serveur/);
});

test("all production paid flows fail closed until the verified legal operator identity is complete",async()=>{
  const store={customerWithdrawalFeatureReady:async()=>true};
  const business={tenant:{customer_type:"business"}};
  const individual={tenant:{customer_type:"individual"}};
  const base={mode:"production",legalOperatorConfigured:false,consumerMediatorConfigured:false,b2cCommercialReady:false,onlineWithdrawalReady:true};

  let block=await customerCommercialReadinessBlock(base,store,business);
  assert.equal(block.code,"COMMERCIAL_LEGAL_IDENTITY_NOT_READY");
  assert.equal(block.readiness.legal_operator,false);

  block=await customerCommercialReadinessBlock({...base,legalOperatorConfigured:true},store,business);
  assert.equal(block,null);

  block=await customerCommercialReadinessBlock({...base,legalOperatorConfigured:true},store,individual);
  assert.equal(block.code,"B2C_COMMERCIAL_NOT_READY");

  block=await customerCommercialReadinessBlock({...base,legalOperatorConfigured:true,consumerMediatorConfigured:true,b2cCommercialReady:true},store,individual);
  assert.equal(block,null);

  const config=read("backend/src/config.mjs");
  for(const key of ["PGI_LEGAL_OPERATOR_NAME","PGI_LEGAL_OPERATOR_STATUS","PGI_LEGAL_OPERATOR_ADDRESS","PGI_LEGAL_OPERATOR_REGISTRATION","PGI_PUBLICATION_DIRECTOR","PGI_CONSUMER_MEDIATOR_NAME","PGI_CONSUMER_MEDIATOR_CONTACT","PGI_CONSUMER_MEDIATOR_URL"])assert.ok(config.includes(key),key+" missing");
  const server=read("backend/server.mjs");
  assert.equal((server.match(/const commercialBlock=await customerCommercialReadinessBlock\(config,store,billing\)/g)||[]).length,4);
  assert.match(server,/COMMERCIAL_LEGAL_IDENTITY_NOT_READY/);
  assert.match(server,/commercial_legal_ready/);
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

test("subscription terms state no minimum commitment consistently",()=>{
  const terms=read("site/seo/conditions-abonnement.html");
  assert.match(terms,/sans engagement de durée/i);
  assert.match(terms,/résiliation à tout moment/i);
});

test("subscription terms state that the current month is free and billing starts the following month",()=>{
  const terms=read("site/seo/conditions-abonnement.html");
  assert.match(terms,/mois civil .* souscription .* offert/i);
  assert.match(terms,/À compter du mois suivant/i);
  assert.match(terms,/4,90€ TTC par mois/i);
});


test("v5 terms contractually cover priority portability and ambassador rewards",()=>{
  const terms=read("site/seo/conditions-abonnement.html");
  assert.match(terms,/portabilité prioritaire facturée 9,90 € TTC en paiement unique/i);
  assert.match(terms,/portabilité entrante standard demeure facturée <strong>0 €/i);
  assert.match(terms,/ne garantit aucune date de portage/i);
  assert.match(terms,/clients et non-clients/i);
  assert.match(terms,/trois factures mensuelles distinctes ont été réellement payées/i);
  for(const amount of ["10 € par filleul","12 € par filleul","15 € par filleul","20 € par filleul"])assert.match(terms,new RegExp(amount));
  assert.match(terms,/\+5 € au 1er filleul qualifié/);
  assert.match(terms,/\+20 € au 5e/);
  assert.match(terms,/\+50 € au 10e/);
  assert.match(terms,/ne revalorise pas rétroactivement/i);
  assert.match(terms,/ne crée ni contrat de travail, ni société, ni mandat général/i);
  assert.match(terms,/messages électroniques non sollicités/i);
});

test("ambassador application captures current terms and privacy evidence",()=>{
  const page=read("site/seo/parrainage-audiotel.html");
  const tracking=read("site/hubspot-tracking.js");
  const server=read("backend/server.mjs");
  const postgres=read("backend/src/store-postgres.mjs");
  assert.match(page,/id="ambassador-legal"/);
  assert.match(page,/conditions-abonnement/);
  assert.match(page,/politique de confidentialité/i);
  assert.match(tracking,/ambassador_terms_accepted:true/);
  assert.match(tracking,/privacy_notice_acknowledged:true/);
  assert.match(tracking,/legal_version:"2026-10-06-b2b-b2c-v5"/);
  assert.match(server,/AMBASSADOR_LEGAL_TERMS_REQUIRED/);
  assert.match(postgres,/terms_accepted_at/);
  assert.match(postgres,/ambassador_terms_accepted:true/);
});

test("priority portability checkout requires legal acceptance and immediate performance request",()=>{
  const ui=read("assets/client-portability-priority.js");
  const api=read("assets/client-portal-api.js");
  const server=read("backend/server.mjs");
  const stripe=read("backend/src/stripe-billing.mjs");
  const migration=read("database/migrations/072_legal_v5_services.sql");
  assert.match(ui,/portability-priority-legal-dialog/);
  assert.match(ui,/service_terms_accepted:true/);
  assert.match(ui,/immediate_performance_requested:true/);
  assert.match(ui,/2026-10-06-b2b-b2c-v5/);
  assert.match(api,/createPortabilityPriorityCheckout:function\(id,payload,idempotencyKey\)/);
  assert.match(server,/PORTABILITY_PRIORITY_LEGAL_TERMS_REQUIRED/);
  assert.match(server,/PORTABILITY_PRIORITY_IMMEDIATE_PERFORMANCE_REQUIRED/);
  assert.match(server,/acceptance_type:"portability_priority_checkout"/);
  assert.match(stripe,/legal_version:String\(input\.legal_version/);
  assert.match(migration,/portability_priority_checkout/);
});

test("privacy and traceur notices disclose referral attribution and ambassador data",()=>{
  const privacy=read("site/seo/confidentialite.html");
  const cookies=read("site/seo/cookies-traceurs.html");
  assert.match(privacy,/Données du programme ambassadeur/);
  assert.match(privacy,/Attribution d’un parrainage/);
  assert.match(privacy,/identifiant technique de visite ou de session/);
  assert.match(cookies,/Attribution de parrainage/);
  assert.match(cookies,/stockage de session/);
  assert.match(cookies,/n’est pas utilisé pour la publicité comportementale/);
});

test("legal v5 keeps commercial launch blockers explicit",()=>{
  const legal=read("site/seo/mentions-legales.html");
  const terms=read("site/seo/conditions-abonnement.html");
  assert.match(legal,/À compléter avant ouverture commerciale/);
  assert.match(legal,/Médiation de la consommation/);
  assert.match(terms,/Avant toute conclusion de contrats B2C/);
  assert.match(terms,/médiateur de la consommation effectivement choisi/i);
});
