import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(file,"utf8");
const index=read("index.html");
const app=read("assets/app.js");
const api=read("assets/api-client.js");
const dataClient=read("assets/data-client.js");
const demoData=read("assets/demo-data.js");
const commands=read("assets/command-palette.js");
const workspace=read("assets/workspace.js");
const css=read("assets/styles.css");
const sw=read("service-worker.js");
const buildStatic=read("scripts/build-static.mjs");

test("le nom officiel et les vues principales sont présents",()=>{
  assert.match(index,/PGI • Telecom - Audiotel Premium Pro/);
  assert.match(index,/data-view="overview"><span>⌂<\/span>Cockpit/);
  assert.match(index,/data-view="system"><span>⌁<\/span>Supervision/);
  for(const view of ["calls","finance","experts","carriers","wholesale","settings"]){
    assert.match(index,new RegExp('data-view="'+view+'"'));
  }
});

test("les périodes et métriques métier critiques sont présentes",()=>{
  for(const label of ["Aujourd’hui","7 jours","Semaine","Mois","Année"])assert.ok(index.includes(label));
  for(const label of ["CA généré","Reversement attendu","Reversement encaissé","Marge estimée"])assert.ok(index.includes(label));
});

test("la remise à zéro reste non destructive",()=>{
  assert.match(index,/ne supprime jamais les CDR/i);
  assert.match(app,/baseline/i);
});

test("le thème fonctionnel et le design mobile restent verrouillés",()=>{
  for(const token of ["--cyan","--green","--amber","--red","--purple"])assert.ok(css.includes(token));
  assert.match(index,/viewport-fit=cover/);
  assert.match(index,/mobile-web-app-capable/);
  assert.match(index,/apple-mobile-web-app-capable/);
  assert.match(css,/100dvh/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/min-height:44px/);
  assert.match(css,/font-size:16px/);
  assert.match(css,/-webkit-overflow-scrolling:touch/);
  assert.match(css,/orientation:landscape/);
  assert.match(css,/pointer:coarse/);
});

test("le cockpit premium et le centre SVA sont présents",()=>{
  for(const id of [
    "ops-score","traffic-heatmap","call-funnel","quality-mos","overview-expert-ranking",
    "network-donut","finance-waterfall","expert-best","noc-voice-grade",
    "activation-title","activation-progress-bar","gate-carrier","gate-number","gate-sip",
    "gate-compliance","priority-action-title","priority-action-btn"
  ])assert.ok(index.includes('id="'+id+'"'),"missing #"+id);
  assert.match(index,/CENTRE DE LANCEMENT SVA/);
  assert.match(app,/Finaliser l’opérateur SVA amont/);
  assert.match(app,/Configurer le premier numéro de service/);
  assert.match(app,/Activer le trunk SIP et la route/);
});

test("le cockpit analytique 1.15 reste complet",()=>{
  for(const id of [
    "cockpit-volume-chart","cockpit-conversion-chart","cockpit-hour-bars",
    "cockpit-weekday-bars","cockpit-status-donut","cockpit-duration-bars",
    "cockpit-expert-bars","cockpit-carrier-bars","cockpit-peak-hour",
    "cockpit-peak-day","cockpit-value-call","cockpit-value-minute",
    "cockpit-margin-call","cockpit-average-duration"
  ])assert.ok(index.includes('id="'+id+'"'),"missing #"+id);
  assert.match(css,/PGI 1\.15 — Cockpit Intelligence Layer/);
  assert.match(app,/renderCockpitIntelligence/);
  assert.match(app,/serverAnalytics/);
  assert.match(app,/AGRÉGATS SERVEUR/);
});

test("la fondation hyperscale reste visible",()=>{
  for(const id of [
    "wh-scale-clusters","wh-scale-clusters-state","wh-scale-buckets",
    "wh-scale-partitions","wh-scale-read","wh-scale-role",
    "wh-scale-regions","wh-scale-dr","wh-scale-dr-drills",
    "noc-regions-ready","noc-work-pending","noc-work-dead","noc-dr-targets"
  ])assert.ok(index.includes('id="'+id+'"'),"missing #"+id);
  assert.match(app,/bucket_capacity/);
  assert.match(app,/call_fact_partitions/);
  assert.match(app,/read_replica_enabled/);
  assert.match(app,/HYPERSCALE 1\.16/);
});

test("la production exige une authentification et peut se déconnecter",()=>{
  for(const id of ["auth-dialog","auth-form","auth-username","auth-password","auth-submit","logout-btn"]){
    assert.ok(index.includes('id="'+id+'"'),"missing #"+id);
  }
  assert.match(dataClient,/api\.me\(\)/);
  assert.match(app,/logoutProduction/);
  assert.match(app,/pgi:auth-required/);
  assert.match(app,/stopProductionEvents/);
});

test("la production ne fabrique aucun faux CDR local",()=>{
  assert.match(app,/RUNTIME\.mode==="production"\?\[\]/);
  assert.match(app,/PGIDemoData\.buildCalls/);
  assert.match(demoData,/function buildCalls/);
  assert.doesNotMatch(dataClient,/serviceRate|payoutRate/);
});

test("les données de production sont modularisées et bornées",()=>{
  assert.match(dataClient,/loadCalls/);
  assert.match(dataClient,/maxPages=Math\.max\(1,Math\.min\(4/);
  assert.match(dataClient,/loadAppBootstrap/);
  assert.match(dataClient,/loadDashboardBootstrap/);
  assert.match(dataClient,/appBootstrapCache/);
  assert.match(api,/appBootstrap:function/);
  assert.match(api,/dashboardBootstrap:function/);
});

test("la synchronisation temps réel est incrémentale et économe",()=>{
  assert.match(app,/call\.ingested/);
  assert.match(app,/scheduleProductionSync\("incremental"\)/);
  assert.match(app,/mode==="dashboard"/);
  assert.match(app,/mode==="incremental"\?1:4/);
  assert.match(app,/document\.hidden/);
  assert.match(app,/handleVisibilityChange/);
  assert.match(app,/hiddenFor>30000\?"full"/);
  assert.match(app,/pendingSyncMode/);
});

test("seule la vue active est recalculée",()=>{
  assert.match(app,/function renderActiveView/);
  for(const name of ["calls","finance","experts","carriers","wholesale","system","settings","overview"]){
    assert.match(app,new RegExp('case "'+name+'"' + (name==="overview"?"|default:":"")));
  }
  assert.match(app,/renderActiveView\(rows\)/);
});

test("la palette universelle accélère la navigation",()=>{
  for(const id of ["command-palette-btn","quick-actions-fab","command-palette-dialog","command-search","command-results"]){
    assert.ok(index.includes('id="'+id+'"'),"missing #"+id);
  }
  assert.match(commands,/ctrlKey\|\|e\.metaKey/);
  assert.match(commands,/pgi:command/);
  assert.match(commands,/Ouvrir Finance/);
  assert.match(commands,/Exporter les appels en CSV/);
  assert.match(css,/PGI 1\.16 — Operator Efficiency Layer/);
});

test("le workspace mémorise la dernière vue et période",()=>{
  assert.match(workspace,/pgi_ui_preferences/);
  assert.match(workspace,/pgi_operating_market/);
  assert.match(workspace,/pgi_mobile_overview_expanded/);
  assert.match(workspace,/restoreInto/);
  assert.match(app,/PGIWorkspace\.restoreInto/);
  assert.match(app,/PGIWorkspace\.save/);
});

test("la vue mobile essentielle reste disponible",()=>{
  assert.ok(index.includes('id="mobile-overview-toggle"'));
  assert.match(app,/applyMobileOverviewMode/);
  assert.match(app,/PGIWorkspace\.readMobileOverview/);
  assert.match(app,/PGIWorkspace\.saveMobileOverview/);
});

test("le NOC distingue API, CDR, queue et résilience",()=>{
  assert.match(app,/function cdrPipelineState/);
  assert.match(app,/AUCUN CDR REÇU/);
  assert.match(app,/DERNIER CDR ANCIEN/);
  assert.match(app,/CDR REÇUS/);
  assert.match(app,/dead_lettered/);
  assert.match(app,/oldest_pending_seconds/);
});

test("les alertes du Cockpit sont actionnables",()=>{
  assert.match(app,/Écart de reversement détecté/);
  assert.match(app,/ASR sous le seuil cible/);
  assert.match(app,/Qualité voix à contrôler/);
  assert.match(app,/Retard CDR important/);
  assert.match(app,/Jobs en dead-letter/);
  assert.match(app,/File de traitements ralentie/);
});

test("experts opérateurs et réconciliation utilisent les agrégats serveur",()=>{
  assert.match(app,/analytics\.experts/);
  assert.match(app,/analytics\.carriers/);
  assert.match(app,/serverReconciliation/);
  assert.match(app,/dashboard\.reconciliation/);
});

test("la PWA met en cache tous les modules du shell",()=>{
  for(const file of [
    "assets/demo-data.js","assets/api-client.js","assets/data-client.js",
    "assets/command-palette.js","assets/workspace.js","assets/app.js"
  ])assert.ok(sw.includes(file),"service worker missing "+file);
  assert.match(sw,/pgi-telecom-shell-v19/);
});

test("la release Git exacte reste visible et obligatoire",()=>{
  assert.ok(index.includes('id="runtime-release"'));
  assert.match(app,/RUNTIME\.releaseId/);
  assert.match(buildStatic,/PGI_RELEASE_ID/);
  assert.match(buildStatic,/40-character Git SHA/);
});

test("le produit garde son identité et ne contient pas l’ancien nom",()=>{
  assert.match(index,/PGI • Telecom - Audiotel Premium Pro/);
  assert.doesNotMatch(index,/PGI Telecom • Audiotel Premium Pro/);
  assert.match(index,/TOUR DE CONTRÔLE/);
  assert.match(index,/CENTRE DE PILOTAGE PGI/);
});
