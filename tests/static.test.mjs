import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(file,"utf8");
const index=read("index.html");
const app=read("assets/app.js");
const api=read("assets/api-client.js");
const dataClient=read("assets/data-client.js");
const demoData=read("assets/demo-data.js");
const commandLoader=read("assets/command-palette-loader.js");
const commands=read("assets/command-palette.js");
const workspace=read("assets/workspace.js");
const cockpitPro=read("assets/cockpit-pro.js");
const performanceRadar=read("assets/performance-radar.js");
const subscriptionBillingUi=read("assets/subscription-billing-ui.js");
const customerAdmin=read("assets/customer-admin.js");
const tenantControlDetail=read("assets/tenant-control-detail.js");
const platformAdmin=read("assets/platform-admin-tools.js");
const callTools=read("assets/call-tools.js");
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
  assert.match(css,/\.cockpit-intelligence\{/);
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
  assert.doesNotMatch(dataClient,/computeCallFinancials|CONFIG\.serviceRate|CONFIG\.payoutRate/);
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
  assert.match(app,/scheduledSyncMode=mergeSyncMode/);
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
  assert.match(commandLoader,/import\("\.\/command-palette\.js"\)/);
  assert.doesNotMatch(index,/src="assets\/command-palette\.js"/);
  assert.match(css,/\.command-palette-btn\{/);
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

test("le moteur analytique avancé est chargé à la demande",()=>{
  assert.match(app,/import\("\.\/cockpit-pro\.js"\)/);
  assert.doesNotMatch(index,/src="assets\/cockpit-pro\.js"/);
  assert.doesNotMatch(sw,/assets\/cockpit-pro\.js/);
});

test("le Cockpit expose l'expérience appelant sans faux SLA",()=>{
  for(const id of ["exp-wait","exp-fast-answer","exp-abandon-wait","exp-short-abandon","exp-ivr","exp-queue","exp-network-affected","exp-low-mos"])assert.ok(index.includes('id="'+id+'"'));
  assert.match(cockpitPro,/answered_le_20s_percent/);
  assert.match(cockpitPro,/affected_samples/);
  assert.match(cockpitPro,/experience-trend-chart/);
  assert.doesNotMatch(index,/SLA garanti/i);
});

test("le Performance Radar est chargé à la demande et reste hors du shell critique",()=>{
  assert.ok(index.includes('id="performance-radar"'));
  assert.match(cockpitPro,/performance-radar\.js/);
  assert.match(cockpitPro,/import\(RU\)/);
  assert.match(performanceRadar,/DÉTECTION STATISTIQUE/);
  assert.match(performanceRadar,/MATRICE VOLUME × ASR/);
  assert.match(performanceRadar,/Performance experts/);
  assert.match(performanceRadar,/Performance opérateurs/);
  assert.doesNotMatch(sw,/assets\/performance-radar\.js/);
});

test("la Plateforme SVA distingue abonnement externe et usage interne exempté",()=>{
  for(const id of ["wh-sub-price","wh-sub-active","wh-sub-access","wh-sub-blocked","wh-sub-internal"])assert.ok(index.includes('id="'+id+'"'));
  assert.match(app,/subscription_access_blocked/);
  assert.match(app,/Activer les abonnements SVA externes/);
  assert.match(api,/subscriptionBilling:function/);
  assert.match(api,/createSubscriptionPrice:function/);
  assert.match(app,/subscription-billing-ui\.js/);
  assert.match(subscriptionBillingUi,/subscription_price_minor/);
  assert.doesNotMatch(sw,/assets\/subscription-billing-ui\.js/);
});

test("le contrôle clients permet recherche pays impayés et suspension depuis le cockpit",()=>{
  assert.ok(index.includes('id="customer-admin-root"'));
  assert.match(subscriptionBillingUi,/customer-admin\.js/);
  assert.match(customerAdmin,/ADMINISTRATION CLIENTS/);
  assert.match(customerAdmin,/ca-country/);
  assert.match(customerAdmin,/ca-billing/);
  assert.match(customerAdmin,/ca-kyc/);\n  assert.match(customerAdmin,/ca-kpis/);\n  assert.match(customerAdmin,/customer-admin\\.css/);\n  assert.match(customerAdmin,/data-tenant-action/);
  assert.match(customerAdmin,/data-line-action/);
  assert.match(customerAdmin,/Alertes impayés/);
  assert.match(api,/setTenantStatus:function/);
  assert.match(api,/setTenantAssignmentStatus:function/);
  assert.match(api,/billingAlerts:function/);
  assert.match(subscriptionBillingUi,/Abonnement client impayé/);
  assert.match(css,/\.product-name\{display:block/);
  assert.match(css,/\.nav-item\[data-view="settings"\]/);
  assert.doesNotMatch(sw,/assets\/customer-admin\.js/);
});

test("le dossier client 1.22 centralise les opérations sans alourdir le shell",()=>{
  assert.match(customerAdmin,/tenant-control-detail\.js/);
  assert.match(customerAdmin,/data-dossier/);
  assert.match(customerAdmin,/p\.number=compact/);
  assert.match(customerAdmin,/Nouveau client/);
  assert.match(customerAdmin,/Créer en attente/);
  assert.match(api,/createTenant:function/);
  assert.match(api,/tenantControlDetail:function/);
  assert.match(api,/setExpertStatus:function/);
  for(const label of ["DOSSIER CLIENT CENTRALISÉ","Lignes SVA","Experts du client","Reversements récents","Historique & audit"])assert.ok(tenantControlDetail.includes(label));
  assert.match(tenantControlDetail,/data-tenant-status/);
  assert.match(tenantControlDetail,/data-line-status/);
  assert.match(tenantControlDetail,/data-expert-apply/);
  assert.match(tenantControlDetail,/data-alert-id/);
  assert.doesNotMatch(sw,/assets\/tenant-control-detail\.js/);
});

test("les outils CDR sont chargés à la demande pour préserver app.js",()=>{
  assert.match(app,/import\("\.\/call-tools\.js"\)/);
  assert.match(callTools,/export function exportCsv/);
  assert.match(callTools,/export function showDetail/);
  assert.doesNotMatch(sw,/assets\/call-tools\.js/);
});

test("l’administration plateforme 1.22 pilote tarifs et bascules avec confirmations",()=>{
  assert.match(commands,/platform-admin-tools\.js/);
  assert.match(commands,/Administrer la plateforme/);
  assert.match(index,/data-platform-admin/);
  assert.match(api,/carrierSwitchOptions:function/);
  assert.match(api,/planCarrierSwitch:function/);
  assert.match(api,/activateCarrierSwitch:function/);
  assert.match(api,/rollbackCarrierSwitch:function/);
  assert.match(platformAdmin,/Publier une nouvelle version/);
  assert.match(platformAdmin,/Préparer la bascule/);
  assert.match(platformAdmin,/data-switch-activate/);
  assert.match(platformAdmin,/data-switch-rollback/);
  assert.match(platformAdmin,/confirm\(/);
  assert.doesNotMatch(sw,/assets\/platform-admin-tools\.js/);
});

test("la PWA met en cache uniquement le shell critique",()=>{
  for(const file of [
    "assets/api-client.js","assets/data-client.js",
    "assets/command-palette-loader.js","assets/workspace.js","assets/app.js"
  ])assert.ok(sw.includes(file),"service worker missing "+file);
  assert.doesNotMatch(sw,/assets\/demo-data\.js/);
  assert.doesNotMatch(index,/src="assets\/demo-data\.js"/);
  assert.match(app,/loadDemoCalls/);
  assert.doesNotMatch(sw,/assets\/command-palette\.js/);
  assert.doesNotMatch(sw,/assets\\/customer-admin\\.css/);\n  assert.match(sw,/pgi-telecom-shell-v27/);
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
