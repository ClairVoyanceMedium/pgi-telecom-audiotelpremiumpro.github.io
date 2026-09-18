import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync("index.html","utf8");
const app = fs.readFileSync("assets/app.js","utf8");
const css = fs.readFileSync("assets/styles.css","utf8");
const buildStatic = fs.readFileSync("scripts/build-static.mjs","utf8");

test("le nom officiel est présent", () => {
  assert.match(index, /PGI • Telecom - Audiotel Premium Pro/);
});

test("les périodes métier principales sont présentes", () => {
  for (const label of ["Aujourd’hui","7 jours","Semaine","Mois","Année"]) assert.ok(index.includes(label));
});

test("les métriques financières critiques sont présentes", () => {
  for (const label of ["CA généré","Reversement attendu","Reversement encaissé","Marge estimée"]) assert.ok(index.includes(label));
});

test("la remise à zéro est non destructive conceptuellement", () => {
  assert.match(index, /ne supprime jamais les CDR/i);
  assert.match(app, /baseline/i);
});

test("le thème PGI contient les couleurs fonctionnelles", () => {
  for (const token of ["--cyan","--green","--amber","--red","--purple"]) assert.ok(css.includes(token));
});


test("le cockpit premium avancé est présent", () => {
  for (const id of [
    "ops-score","traffic-heatmap","call-funnel","quality-mos",
    "overview-expert-ranking","network-donut","finance-waterfall",
    "expert-best","noc-voice-grade","mobile-menu-dialog"
  ]) assert.ok(index.includes('id="'+id+'"'), "missing #"+id);
});

test("les états pré-connexion ne prétendent pas que SIP est actif", () => {
  assert.match(index, /SIP non connecté/i);
  assert.match(index, /NON CONNECTÉ/);
});

test("la navigation mobile donne accès aux opérateurs et au système", () => {
  assert.match(index, /data-view="carriers"/);
  assert.match(index, /data-view="system"/);
});


test("le cockpit production exige une authentification explicite", () => {
  for (const id of ["auth-dialog","auth-form","auth-username","auth-password","auth-submit"]) {
    assert.ok(index.includes('id="'+id+'"'), "missing #"+id);
  }
  assert.match(app, /PGIApi\.me\(\)/);
  assert.match(app, /loadAllApiCalls/);
  assert.match(app, /call\.ingested/);
});

test("la production ne génère pas de faux CDR locaux", () => {
  assert.match(app, /RUNTIME\.mode==="production"\?\[\]:buildDemoCalls\(\)/);
});


test("le NOC sépare la santé API du pipeline CDR", () => {
  assert.match(index, /État backend/);
  assert.match(app, /function cdrPipelineState/);
  assert.match(app, /AUCUN CDR REÇU/);
  assert.match(app, /DERNIER CDR ANCIEN/);
  assert.match(app, /CDR REÇUS/);
  assert.doesNotMatch(app, /overviewCdr\.textContent="CONNECTÉ"/);
});


test("la session de production peut être fermée proprement", () => {
  assert.ok(index.includes('id="logout-btn"'));
  assert.match(app, /logoutProduction/);
  assert.match(app, /pgi:auth-required/);
  assert.match(app, /stopProductionEvents/);
});


test("la production ne réutilise pas les taux de démonstration", () => {
  const productionSection=app.slice(app.indexOf("var allCalls="));
  assert.doesNotMatch(productionSection,/CONFIG\.serviceRate/);
  assert.doesNotMatch(productionSection,/CONFIG\.payoutRate/);
  assert.match(app,/PGIApi\.baselines/);
});


test("la release Git exacte est visible et obligatoire en production", () => {
  assert.ok(index.includes('id="runtime-release"'));
  assert.match(app, /RUNTIME\.releaseId/);
  assert.match(buildStatic, /PGI_RELEASE_ID/);
  assert.match(buildStatic, /40-character Git SHA/);
});


test("le design executive premium reste verrouillé", () => {
  for (const id of ["command-system","command-sync","command-period","command-release"]) {
    assert.ok(index.includes('id="'+id+'"'), "missing #"+id);
  }
  assert.match(index, /PGI EXECUTIVE CONTROL/);
  assert.match(css, /PGI Telecom 1\.7 — Executive Premium Design System/);
  assert.match(css, /\.command-deck/);
  assert.match(css, /backdrop-filter:blur/);
  assert.match(app, /commandSystem/);
  assert.match(app, /command-period/);
});


test("le cockpit wholesale 1.9 est verrouillé", () => {
  assert.match(index, /data-view="wholesale"/);
  for (const id of [
    "view-wholesale","wh-foundation-status","wh-tenants-total","wh-numbers-total",
    "wh-kyc-verified","wh-net-payout","wh-tenants-table","wh-numbers-table","wh-settlements-table"
  ]) assert.ok(index.includes('id="'+id+'"'), "missing #"+id);
  assert.match(css, /PGI • Telecom 1\.9 — Wholesale Control Center/);
  assert.match(app, /renderWholesale/);
  assert.match(app, /wholesaleOverview/);
  assert.match(app, /Aucun éditeur réel configuré/);
});

test("le nouveau nom officiel est cohérent dans le cockpit", () => {
  assert.match(index, /PGI • Telecom - Audiotel Premium Pro/);
  assert.doesNotMatch(index, /PGI Telecom • Audiotel Premium Pro/);
});


test("le centre de lancement SVA mobile est verrouillé", () => {
  for (const id of [
    "activation-title","activation-steps","activation-progress-bar",
    "gate-carrier","gate-number","gate-sip","gate-compliance",
    "priority-action-title","priority-action-detail","priority-action-btn",
    "overview-wh-stock","overview-wh-net","overview-wh-payment-state"
  ]) assert.ok(index.includes('id="'+id+'"'), "missing #"+id);
  assert.match(index, /class="mobile-sva" data-view="wholesale"/);
  assert.match(index, /CENTRE DE LANCEMENT SVA/);
  assert.match(app, /Finaliser l’opérateur SVA amont/);
  assert.match(app, /Configurer le premier numéro 089/);
  assert.match(app, /Activer le trunk SIP et la route/);
  assert.match(css, /PGI 1\.10 — SVA Launch Center/);
});


test("le nom produit est visible dans l’en-tête mobile", () => {
  assert.match(index, /class="product-name">PGI • Telecom - Audiotel Premium Pro/);
  assert.match(css, /Product identity in responsive header/);
});


test("l’optimisation mobile Android et iOS est verrouillée", () => {
  assert.match(index, /viewport-fit=cover/);
  assert.match(index, /mobile-web-app-capable/);
  assert.match(index, /apple-mobile-web-app-capable/);
  assert.match(index, /apple-mobile-web-app-title/);
  assert.match(css, /PGI 1\.11 — Mobile Perfection Layer/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /font-size:16px/);
  assert.match(css, /-webkit-overflow-scrolling:touch/);
  assert.match(css, /orientation:landscape/);
  assert.match(css, /pointer:coarse/);
});

test("la vue mobile essentielle reste disponible", () => {
  assert.ok(index.includes('id="mobile-overview-toggle"'));
  assert.match(app, /readMobileOverviewPreference/);
  assert.match(app, /applyMobileOverviewMode/);
  assert.match(app, /pgi_mobile_overview_expanded/);
});
