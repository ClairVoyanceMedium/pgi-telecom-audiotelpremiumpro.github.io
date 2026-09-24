import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read=file=>fs.readFileSync(file,"utf8");
const index=read("index.html");
const clientPortal=read("client.html");
const clientPortalApi=read("assets/client-portal-api.js");
const clientPortalJs=read("assets/client-portal.js");
const clientLiveFinance=read("assets/client-live-finance.js");
const adminLiveFinance=read("assets/live-finance.js");
const clientMobile=read("assets/client-mobile.js");
const clientPortalCss=read("assets/client-portal.css");
const clientAdminTheme=read("assets/client-admin-theme.css");
const clientAnalyticsPlus=read("assets/client-analytics-plus.js");
const clientAccountProof=read("assets/client-account-proof.js");
const clientIntelligence=read("assets/client-intelligence.js");
const clientI18n=read("assets/client-i18n.js");
const clientGoogle=read("assets/client-google.js");
const clientConfig=read("assets/client-config.js");
const app=read("assets/app.js");
const api=read("assets/api-client.js");
const dataClient=read("assets/data-client.js");
const demoData=read("assets/demo-data.js");
const commandLoader=read("assets/command-palette-loader.js");
const commands=read("assets/command-palette.js");
const workspace=read("assets/workspace.js");
const cockpitPro=read("assets/cockpit-pro.js");
const performanceRadar=read("assets/performance-radar.js");
const voiceIntelligence=read("assets/voice-intelligence.js");
const subscriptionBillingUi=read("assets/subscription-billing-ui.js");
const customerAdmin=read("assets/customer-admin.js");
const tenantControlDetail=read("assets/tenant-control-detail.js");
const tenantConsumptionCheck=read("assets/tenant-consumption-check.js");
const clientServiceCenter=read("assets/client-service-center.js");
const tenantServiceAdmin=read("assets/tenant-service-admin.js");
const platformAdmin=read("assets/platform-admin-tools.js");
const callTools=read("assets/call-tools.js");
const callList=read("assets/call-list.js");
const metricReset=read("assets/metric-reset.js");
const premiumPlusCore=read("assets/premium-plus-core.js");
const premiumPlus=read("assets/premium-plus.js");
const clientPremiumPlus=read("assets/client-premium-plus.js");
const passkeyClient=read("assets/passkey-client.js");
const css=read("assets/styles.css");
const sw=read("service-worker.js");
const manifest=read("manifest.webmanifest");
const buildStatic=read("scripts/build-static.mjs");

test("la marque client reste Audiotel Premium Pro et la plateforme reste multisectorielle",()=>{
  assert.match(clientPortal,/PGI Telecom/);
  assert.match(clientPortal,/Audiotel Premium Pro/);
  assert.doesNotMatch(clientPortal,/PGI • Telecom - Audiotel Premium Pro/);
  assert.doesNotMatch(clientPortal,/voyance|voyant/i);
  assert.match(clientServiceCenter,/Audiotel Premium Pro/);
  assert.match(index,/Intervenants/);
  assert.match(index,/Services \/ intervenants|services \/ intervenants/i);
  assert.doesNotMatch(index,/voyance|voyant/i);
  assert.match(tenantControlDetail,/Intervenants \/ services \/ postes/);
  assert.doesNotMatch(tenantControlDetail,/Agents \/ postes optionnels/);
  assert.match(clientPortalJs,/Frais de plateforme HT/);
});

test("les cockpits affichent les reversements en direct sans les confondre avec les montants consolidés",()=>{
  const server=read("backend/server.mjs"),store=read("backend/src/store-postgres.mjs"),site=read("site/index.html");
  assert.match(clientPortal,/client-live-finance\.js/);
  assert.match(index,/live-finance\.js/);
  for(const asset of ["client-live-finance.js","client-live-finance.css","live-finance.js","live-finance.css"]){
    assert.ok(buildStatic.includes('"assets/'+asset+'"'),"production build missing "+asset);
  }
  for(const id of ["client-live-money","client-live-amount","client-period-payout-estimate","client-live-recalc","client-jackpot-reset","client-jackpot-rate"])assert.ok(clientLiveFinance.includes('id="'+id+'"'),"missing client live #"+id);
  for(const id of ["live-jackpot-card","live-jackpot","live-jackpot-period","live-jackpot-ranking"])assert.ok(adminLiveFinance.includes('id="'+id+'"'),"missing admin live #"+id);
  assert.match(clientLiveFinance,/client_rate_ht_per_second/);
  assert.match(clientLiveFinance,/customer\.jackpot\.reset/);
  assert.match(clientLiveFinance,/\/customer\/events/);
  assert.match(clientPortalApi,/\/customer\/jackpot/);
  assert.match(adminLiveFinance,/live_upstream_payout_ht/);
  assert.match(adminLiveFinance,/live-jackpot-ranking/);
  assert.match(api,/\/dashboard\/live-finance/);
  assert.match(server,/\/api\/v1\/customer\/events/);
  assert.match(server,/\/api\/v1\/customer\/jackpot/);
  assert.match(server,/can_reset:\["owner","admin"\]\.includes\(context\.customer_role\)/);
  assert.match(server,/CUSTOMER_JACKPOT_RESET_FORBIDDEN/);
  assert.match(server,/\/api\/v1\/dashboard\/live-finance/);
  assert.match(server,/live_call\.started/);
  assert.match(server,/live_call\.ended/);
  assert.match(store,/liveFinancialSnapshot/);
  assert.match(store,/customerJackpotSnapshot/);
  assert.match(store,/liveFinancialByTenant/);
  assert.match(store,/customer_jackpot_baselines/);
  assert.match(store,/tenant_scoped_live_call_financial_sessions/);
  const jackpotMigration=read("database/migrations/056_motivational_jackpot.sql");
  assert.match(jackpotMigration,/CREATE TABLE customer_jackpot_baselines/);
  assert.match(jackpotMigration,/Expand-only and non-destructive/);
  assert.match(jackpotMigration,/never delete or alter accounting data/);
  assert.doesNotMatch(jackpotMigration,/DROP\s+(TABLE|COLUMN|CONSTRAINT)/i);
  assert.match(site,/Des prix bas soutenus par le bouche-à-oreille/);
  assert.match(site,/préserver des tarifs bas/);
  assert.doesNotMatch(site,/tarif garanti|prix garanti/i);
});

test("le cockpit garde une liste d'appels compacte et une remise à zéro sélective",()=>{
  assert.ok(index.includes('id="reset-metrics"'));
  assert.equal((index.match(/id="reset-metrics"/g)||[]).length,1);
  assert.ok(index.includes('id="calls-table"'));
  assert.match(index,/Remettre des métriques à zéro/);
  assert.doesNotMatch(index,/y compris clients, repartiront de zéro/);
  assert.match(app,/renderCallTable\(tableRows,state\.marketCurrency/);
  assert.match(callTools,/import\("\.\/call-list\.js"\)/);
  assert.match(callList,/rows\.slice\(0,8\)/);
  assert.match(callList,/Afficher les /);
  assert.match(callList,/Réduire la liste/);
  assert.match(app,/import\("\.\/metric-reset\.js"\)/);
  assert.match(app,/metric_key:key/);
  assert.match(app,/scope:"global"/);
  assert.doesNotMatch(app,/DELETE\s+FROM\s+calls/i);
});

test("les remises à zéro cockpit et client sont sélectives et isolées",()=>{
  const server=read("backend/server.mjs"),store=read("backend/src/store-postgres.mjs");
  for(const key of ["calls","minutes","revenue","payout","quality"])assert.match(metricReset,new RegExp('\\["'+key+'",'));
  for(const label of ["Appels & décroché","Minutes & durées","Chiffre d’affaires","Reversements & marge","Qualité & expérience"])assert.ok(metricReset.includes(label));
  assert.match(metricReset,/Les CDR, règlements, contrats et traces d’audit ne sont pas supprimés/);
  assert.match(server,/\/api\/v1\/customer\/metrics\/reset/);
  assert.match(server,/CUSTOMER_METRIC_RESET_FORBIDDEN/);
  assert.match(server,/effectiveMetricRanges\(requestedRange\.from,requestedRange\.to,context\.tenant_id\)/);
  assert.match(server,/effectiveMetricRanges\(requestedRange\.from,requestedRange\.to\)/);
  assert.match(store,/scope='global' AND tenant_id=\$2/);
  assert.match(store,/scope='global'/);
  assert.match(store,/createCustomerMetricReset/);
  assert.match(clientPortal,/id="client-metrics-reset"/);
  assert.match(clientPortalApi,/resetMetrics:function/);
  assert.match(clientPortalApi,/\/customer\/metrics\/reset/);
  assert.match(clientPortalJs,/\["owner","admin"\]/);
  assert.match(clientPortalJs,/resetMetrics\(keys/);
  assert.match(clientPortalJs,/metric_net_payout_by_currency/);
  assert.match(app,/invalidateAppBootstrap\(\)/);
});

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
  for(const token of ["--cyan","--green","--amber","--red","--purple","--bg:#241712","--surface:#302019"])assert.ok(css.includes(token));
  assert.match(index,/viewport-fit=cover/);
  assert.match(index,/theme-color" content="#2b1b15"/);
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

test("la production ne charge aucun faux CDR local",()=>{
  assert.match(app,/function loadDemoCalls/);
  assert.match(app,/RUNTIME\.mode==="production"\)return Promise\.resolve/);
  assert.match(app,/s\.src="assets\/demo-data\.js"/);
  assert.match(demoData,/function buildCalls/);
  assert.doesNotMatch(index,/src="assets\/demo-data\.js"/);
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
  assert.match(commands,/Ouvrir le centre d’export/);
  assert.match(commandLoader,/import\("\.\/command-palette\.js"\)/);
  assert.doesNotMatch(index,/src="assets\/command-palette\.js"/);
  assert.match(css,/\.command-palette-btn\{/);
});

test("le workspace mémorise la dernière vue et période",()=>{
  assert.match(workspace,/pgi_ui_preferences/);
  assert.match(workspace,/pgi_operating_market/);
  assert.match(workspace,/pgi_mobile_full_v2/);
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
  for(const id of ["wh-billing-provider","wh-billing-provider-state","wh-billing-checkout","wh-billing-payout"])assert.ok(index.includes('id="'+id+'"'));
  for(const id of ["client-billing-offer","client-billing-offer-detail","client-billing-offer-chip","client-billing-provider-state","client-billing-provider-chip","client-billing-start","client-billing-manage","client-billing-consent","client-billing-terms","client-billing-recovery","client-billing-recovery-title","client-billing-recovery-text","client-billing-recovery-action"])assert.ok(clientPortal.includes('id="'+id+'"'));
  assert.match(clientPortalApi,/\/customer\/billing\/checkout-session/);
  assert.match(clientPortalApi,/\/customer\/billing\/portal-session/);
  assert.match(clientPortalApi,/Idempotency-Key/);
  assert.match(clientPortalApi,/newIdempotencyKey/);
  assert.match(clientPortalJs,/PAYMENT_PROVIDER_NOT_CONNECTED/);
  assert.match(clientPortalJs,/service_suspended/);
  assert.match(clientPortalJs,/next_retry_at/);
  assert.match(clientPortalJs,/openBilling\("manage"\)/);
  assert.match(subscriptionBillingUi,/subscription_recovery_grace/);
  assert.match(subscriptionBillingUi,/subscription_recovery_suspended/);
  assert.match(clientPortalJs,/handleBillingReturn/);
  assert.match(clientPortalJs,/Ouverture du paiement/);
  assert.match(clientPortal,/Paiement sécurisé par Stripe/);
  assert.match(clientPortal,/conditions-abonnement/);
  assert.match(clientPortal,/confidentialite/);
  assert.match(clientPortalJs,/Acceptez les conditions d’abonnement/);
  assert.match(clientPortalJs,/url\.searchParams\.delete\("session_id"\)/);
  assert.match(clientPortal,/L’opérateur règle Audiotel Premium Pro, qui calcule puis reverse votre net contractuel/);
  assert.doesNotMatch(sw,/assets\/subscription-billing-ui\.js/);
});

test("le contrôle clients permet recherche pays impayés et suspension depuis le cockpit",()=>{
  assert.ok(index.includes('id="customer-admin-root"'));
  assert.match(subscriptionBillingUi,/customer-admin\.js/);
  assert.match(customerAdmin,/ADMINISTRATION CLIENTS/);
  assert.match(customerAdmin,/ca-country/);
  assert.match(customerAdmin,/ca-billing/);
  assert.match(customerAdmin,/ca-kyc/);
  assert.match(customerAdmin,/ca-kpis/);
  assert.match(customerAdmin,/customer-admin\.css/);
  assert.match(customerAdmin,/data-tenant-action/);
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
  assert.match(api,/customerAdminSummary:function/);
  assert.match(customerAdmin,/customerAdminSummary/);
  assert.match(api,/tenantControlDetail:function/);
  assert.match(api,/setExpertStatus:function/);
  assert.match(api,/createCallDestination:function/);
  assert.match(api,/setCallDestinationStatus:function/);
  assert.match(tenantControlDetail,/data-destination-create/);
  assert.match(tenantControlDetail,/data-destination-status/);
  for(const label of ["DOSSIER CLIENT CENTRALISÉ","Lignes SVA","Destinations d’appel de la société","Intervenants / services / postes","Reversements récents","Historique & audit"])assert.ok(tenantControlDetail.includes(label));
  assert.match(tenantControlDetail,/data-tenant-status/);
  assert.match(tenantControlDetail,/data-line-status/);
  assert.match(tenantControlDetail,/data-expert-apply/);
  assert.match(tenantControlDetail,/data-alert-id/);
  assert.doesNotMatch(sw,/assets\/tenant-control-detail\.js/);
});

test("le centre de service premium garde un dossier unique et un routage simulable",()=>{
  for(const id of ["client-service-center","service-incident-open","service-alert-list","service-incident-list","routing-simulate","routing-simulation-result"])assert.ok(clientPortal.includes('id="'+id+'"'),id);
  assert.match(clientPortalJs,/client-service-center\.js/);
  assert.match(clientServiceCenter,/CENTRE DE SERVICE/);
  assert.match(clientServiceCenter,/Dossier créé/);
  assert.match(clientServiceCenter,/Tester mon routage|Routage disponible|Aucun routage disponible/);
  assert.match(clientPortalApi,/createIncident:function/);
  assert.match(clientPortalApi,/addIncidentNote:function/);
  assert.match(clientPortalApi,/simulateRouting:function/);
  assert.match(tenantControlDetail,/tenant-service-admin\.js/);
  assert.match(tenantServiceAdmin,/Centre de service & incidents/);
  assert.match(api,/createServiceIncident:function/);
  assert.match(api,/updateServiceIncident:function/);
  assert.match(api,/simulateTenantRouting:function/);
  assert.doesNotMatch(sw,/client-service-center\.js|tenant-service-admin\.js/);
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
    "assets/api-client.js","assets/data-client.js","assets/client-admin-theme.css",
    "assets/command-palette-loader.js","assets/workspace.js","assets/app.js"
  ])assert.ok(sw.includes(file),"service worker missing "+file);
  assert.doesNotMatch(sw,/assets\/demo-data\.js/);
  assert.doesNotMatch(index,/src="assets\/demo-data\.js"/);
  assert.match(app,/loadDemoCalls/);
  assert.doesNotMatch(sw,/assets\/command-palette\.js/);
  assert.doesNotMatch(sw,/assets\/customer-admin\.css/);
  assert.match(sw,/pgi-v49/);
});

test("le logo officiel Audiotel Premium Pro est intégré aux points stratégiques",()=>{
  assert.match(index,/assets\/audiotel-brand-icon-v33\.png/);
  assert.match(index,/assets\/audiotel-brand-logo-v33\.png/);
  for(const cls of ["brand-emblem","topbar-brand-emblem","command-brand-logo","auth-brand-logo","footer-brand-logo"])assert.ok(index.includes(cls),"missing branding "+cls);
  assert.match(index,/view-settings[\s\S]*command-brand-logo[\s\S]*audiotel-brand-logo-v33\.png/);
  for(const cls of ["cp-logo-auth","cp-logo-header","cp-billing-brand-logo","cp-footer-brand","cp-print-brand"])assert.ok(clientPortal.includes(cls),"missing client branding "+cls);
  assert.match(css,/\.brand-emblem\{/);
  assert.match(css,/\.command-brand-logo\{/);
  assert.match(css,/\.auth-brand-logo\{/);
  assert.match(sw,/audiotel-brand-icon-v33\.png/);
  assert.match(sw,/audiotel-brand-logo-v33\.png/);
  assert.match(sw,/pgi-v49/);
  assert.match(buildStatic,/audiotel-brand-logo-v33\.png/);
  assert.doesNotMatch(css,/brand-mark|command-brand-emblem|auth-brand-lockup|auth-brand-emblem/);
  assert.doesNotMatch(sw,/favicon\.svg/);
  assert.doesNotMatch(buildStatic,/favicon\.svg/);
});

test("la release Git exacte reste visible et obligatoire",()=>{
  assert.ok(index.includes('id="runtime-release"'));
  assert.match(app,/RUNTIME\.releaseId/);
  assert.match(buildStatic,/PGI_RELEASE_ID/);
  assert.match(buildStatic,/40-character Git SHA/);
});

test("le produit garde son identité interne et le nom de cockpit installé",()=>{
  assert.match(index,/PGI • Telecom - Audiotel Premium Pro/);
  assert.match(index,/Cockpit \/ PGI Telecom • Audiotel Premium Pro/);
  assert.match(index,/PLATEFORME/);
  assert.match(index,/CENTRE DE PILOTAGE AUDIOTEL PREMIUM PRO/);
});

test("final brown cockpit theme and installed app label are authoritative",()=>{
  assert.match(css,/--bg:#2b1b15/);
  assert.match(css,/\.product-name\{color:#f7e5d6;font-size:clamp\(24px,2\.3vw,32px\)/);
  assert.match(css,/@media \(max-width:820px\)[\s\S]*\.product-name\{max-width:min\(76vw,430px\);font-size:clamp\(18px,5\.0vw,22px\)/);
  assert.match(index,/apple-mobile-web-app-title" content="Cockpit \/ PGI Telecom • Audiotel Premium Pro"/);
  assert.match(manifest,/Audiotel Premium Pro/);
});

test("brand header polish keeps split colors, larger icon and dark period contrast",()=>{
  assert.match(index,/product-name-pgi/);
  assert.match(index,/product-name-audiotel/);
  assert.match(css,/\.topbar-brand-emblem\{[\s\S]*width:38px;height:38px/);
  assert.match(css,/\.product-name-pgi\{color:#f4e8dc\}/);
  assert.match(css,/\.product-name-audiotel\{color:#e0ad6d\}/);
  assert.match(css,/\.periods\{[\s\S]*rgba\(31,22,18,.96\)/);
  assert.match(sw,/pgi-v49/);
});


test("customer portal stays separate, tenant-facing and keeps only its light shell offline",()=>{assert.match(clientPortal,/Audiotel Premium Pro/);assert.match(clientPortal,/Espace client/);assert.match(clientPortal,/noindex,nofollow,noarchive/);for(const token of ["kpi-calls","kpi-minutes","kpi-revenue","kpi-payout","numbers-list","settlements-list","destinations-list"])assert.ok(clientPortal.includes(token),token);for(const path of ["/customer/auth/login","/customer/auth/activate","/customer/portal","/customer/calls"])assert.ok(clientPortalApi.includes(path),path);assert.match(clientPortalJs,/exportClient|Rapport complet/);assert.match(clientAdminTheme,/--bg:#2b1b15/);assert.match(clientAdminTheme,/--panel:#3a271f/);assert.match(sw,/client\.html/);assert.match(sw,/client-portal\.css/);assert.match(sw,/client-admin-theme\.css/);assert.doesNotMatch(sw,/client-analytics-plus\.js|client-premium-plus\.js|client-intelligence\.js|client-service-center\.js/);assert.match(sw,/endsWith\("\/client\.html"\)/);});


test("customer portal has professional analytics and multi-export center",()=>{for(const id of ["calls-chart","minutes-chart","revenue-chart","status-donut","payout-bars","client-export-dialog"])assert.ok(clientPortal.includes('id="'+id+'"'),id);assert.match(clientPortalJs,/function renderAnalytics/);assert.match(clientPortalJs,/function exportClient/);for(const kind of ["report","calls","settlements","numbers","copy","print"])assert.ok(clientPortal.includes('data-client-export="'+kind+'"'),kind);assert.match(clientAdminTheme,/--panel:#3a271f/);});
test("admin export center exposes complete download copy and PDF actions",()=>{assert.match(callTools,/export function openExports/);assert.match(callTools,/Centre d’export PGI/);assert.match(callTools,/Rapport complet CSV/);assert.match(callTools,/Copier le rapport complet/);assert.match(callTools,/adminMetricRows/);assert.match(callTools,/print-overview/);assert.match(commands,/Ouvrir le centre d’export/);assert.match(app,/m\.openExports/);assert.doesNotMatch(sw,/call-tools\.js/);});


test("customer portal exposes extended analytics and password management",()=>{for(const id of ["asr-chart","value-chart","duration-chart","client-security-dialog","client-password-form"])assert.ok(clientPortal.includes('id="'+id+'"'),id);assert.match(clientPortalApi,/changePassword/);assert.match(clientPortalJs,/function changePassword/);assert.match(clientPortalJs,/svgLine\("asr-chart"/);});

test("client and admin dashboards expose today with rich printable downloadable analytics",()=>{
  assert.match(index,/data-period="today"[^>]*>Aujourd’hui</);
  assert.match(clientPortal,/data-range="today"[^>]*>Aujourd’hui</);
  assert.match(clientPortalJs,/range:"today"/);
  assert.match(clientPortalJs,/key==="today"\)from\.setHours\(0,0,0,0\)/);
  for(const id of ["client-export-analytics","client-export-snapshot"])assert.ok(clientPortal.includes('id="'+id+'"'),id);
  for(const id of ["client-hour-bars","client-weekday-bars","client-number-pie","client-duration-pie","client-carrier-bars"])assert.ok(clientAnalyticsPlus.includes('id="'+id+'"'),id);
  assert.ok(clientPortal.includes('id="client-analytics-plus-mount"'));
  for(const token of ["activity_breakdown","analyticsCsv","safeSnapshot","conic-gradient"])assert.match(clientAnalyticsPlus,new RegExp(token));
  assert.match(clientAdminTheme,/print-color-adjust:exact/);
  assert.match(clientAdminTheme,/--accent:#d7a76a/);
  assert.match(clientMobile,/data-client-action="reset"/);
  assert.match(clientMobile,/client-metrics-reset/);
});


test("validated customer number and consumption proof stay visible, tenant-scoped and lazy",()=>{
  assert.match(clientPortal,/PGI Telecom/);
  assert.match(clientPortal,/Audiotel Premium Pro/);
  assert.match(clientAnalyticsPlus,/import\("\.\/client-account-proof\.js"\)/);
  assert.match(clientAccountProof,/assignment_status\|\|x\.status/);
  assert.match(clientAccountProof,/===\"active\"/);
  assert.match(clientAccountProof,/kyc_status\)===\"verified\"/);
  assert.match(clientAccountProof,/VOTRE NUMÉRO AUDIOTEL VALIDÉ/);
  assert.match(clientAccountProof,/Copier le numéro/);
  assert.match(clientAccountProof,/RELEVÉ DE CONTRÔLE/);
  assert.match(clientAccountProof,/\/customer\/consumption-receipts/);
  assert.match(clientAccountProof,/snapshot_sha256/);
  assert.match(tenantControlDetail,/tenant-consumption-check\.js/);
  assert.match(tenantConsumptionCheck,/CONFORME — le relevé client correspond aux données sources/);
  assert.match(tenantConsumptionCheck,/ÉCART DÉTECTÉ/);
  assert.match(tenantConsumptionCheck,/\/platform\/tenants\//);
  assert.match(tenantConsumptionCheck,/\/consumption-receipts/);
  assert.match(tenantConsumptionCheck,/\/consumption-today/);
  assert.match(tenantConsumptionCheck,/\/reconcile/);
  assert.match(tenantConsumptionCheck,/AUJOURD’HUI CÔTÉ SERVEUR/);
  assert.doesNotMatch(api,/tenantConsumptionToday|tenantConsumptionReceipts|reconcileTenantConsumptionReceipt/);
  assert.doesNotMatch(sw,/client-account-proof\.js|tenant-consumption-check\.js/);
});


test("client portal supports autonomous professional email registration",()=>{
  for(const id of ["register-panel","customer-register-form","register-first-name","register-last-name","register-company","register-country","register-number","register-phone","register-email","register-password","register-authority","show-register","show-login","client-onboarding"])assert.ok(clientPortal.includes('id="'+id+'"'),id);
  assert.match(clientPortalApi,/\/customer\/auth\/register/);
  assert.match(clientPortalJs,/submitRegistration/);
  assert.match(clientPortalJs,/COUNTRY_CODES/);
  assert.match(clientPortalJs,/authority_confirmed/);
  assert.match(clientPortalJs,/INVALID_SIRET/);
  assert.match(clientPortalCss,/autonomous-customer-onboarding-v35/);
  assert.match(clientI18n,/signupPacks/);
});

test("client portal auto-localizes and prepares Google account creation",()=>{for(const token of ["pt-PT","pt-BR","es","it","de","sv"])assert.ok(clientI18n.includes(token),token);assert.match(clientI18n,/navigator\.languages/);assert.match(clientGoogle,/accounts\.google\.com\/gsi\/client/);assert.match(clientGoogle,/renderButton/);assert.match(clientConfig,/googleClientId/);assert.match(clientPortal,/google-login/);assert.match(clientPortal,/google-activation/);assert.match(clientPortalJs,/pending_contract/);});


test("client portal intelligence compares periods, detects anomalies and filters calls",()=>{
  for(const id of ["client-intelligence","compare-calls","compare-asr","client-insights","call-filter-status","call-filter-number","call-filter-min-duration","call-filter-min-amount","call-load-more"])assert.ok(clientPortal.includes('id="'+id+'"'),id);
  assert.match(clientPortalJs,/comparison_previous/);
  assert.match(clientPortalJs,/detail:\{range:state\.range,serverTime:.*data:data\}/);
  assert.match(clientIntelligence,/function renderComparison/);
  assert.match(clientIntelligence,/function renderInsights/);
  assert.match(clientIntelligence,/function previousRange/);
  assert.match(clientIntelligence,/PGICustomerApi\.comparison/);
  assert.match(clientIntelligence,/minDuration/);
  assert.match(clientPortalApi,/\/customer\/comparison/);
  assert.match(clientPortalApi,/min_duration/);
  assert.match(clientPortalApi,/min_amount/);
  assert.match(buildStatic,/client-intelligence\.js/);
});


test("cockpit and client expose carrier-grade voice intelligence without bloating the PWA shell",()=>{
  for(const id of ["voice-intelligence-overview","voice-intelligence-system","carrier-health-center"])assert.ok(index.includes('id="'+id+'"'),id);
  for(const token of ["Qualité, signalisation & incidents","SANTÉ OPÉRATEURS","Bascule à évaluer après confirmation technique","Aucune bascule automatique"])assert.ok(voiceIntelligence.includes(token),token);
  assert.match(app,/voice\.incident/);
  assert.match(app,/voice_intelligence/);
  assert.match(api,/voiceIntelligence:function/);
  assert.match(dataClient,/rtt_ms/);
  assert.match(callTools,/Qui a raccroché/);
  assert.doesNotMatch(sw,/voice-intelligence\.js/);
  assert.match(buildStatic,/voice-intelligence\.js/);
  for(const id of ["client-voice-mount","client-call-diagnostic-mount"])assert.ok(clientPortal.includes('id="'+id+'"'),id);
  for(const id of ["client-voice-quality","client-call-diagnostic-dialog","client-call-diagnostic-grid"])assert.ok(clientIntelligence.includes(id),id);
  assert.match(clientIntelligence,/function renderVoiceQuality/);
  assert.match(clientIntelligence,/function showCallDiagnostic/);
  assert.match(buildStatic,/cockpit-pro\.css/);
});


test("PWA cockpit uses the exact install label",()=>{const m=JSON.parse(manifest);const label="Cockpit / PGI Telecom • Audiotel Premium Pro";assert.equal(m.name,label);assert.equal(m.short_name,label);assert.ok(index.includes('<title>'+label+'</title>'));assert.ok(index.includes('apple-mobile-web-app-title" content="'+label+'"'));});

test("advanced admin centers are visible without Ctrl K",()=>{
  for(const token of ["data-control-tower","data-sva-compliance","data-platform-admin"])assert.ok(index.includes(token),token);
  assert.ok(index.includes(">Control Tower</button>"));
  assert.ok(index.includes(">Conformité SVA</button>"));
  assert.ok(index.includes(">Administration</button>"));
  assert.match(commandLoader,/\[data-control-tower\]/);
  assert.match(commandLoader,/\[data-sva-compliance\]/);
  assert.match(commandLoader,/\.\/control-tower\.js/);
  assert.match(commandLoader,/\.\/sva-compliance-center\.js/);
});


test("les petits écrans conservent toutes les fonctions admin et client",()=>{
  assert.match(workspace,/pgi_mobile_full_v2/);
  assert.match(workspace,/v===null\|\|v==="1"/);
  assert.match(app,/mobileOverviewExpanded:true/);
  for(const view of ["overview","calls","finance","wholesale"])assert.match(index,new RegExp('mobile-nav[\\s\\S]*data-view="'+view+'"'));
  for(const view of ["experts","carriers","system","settings"])assert.match(index,new RegExp('mobile-sheet-grid[\\s\\S]*data-view="'+view+'"'));
  for(const token of ["data-control-tower","data-sva-compliance","data-platform-admin"])assert.ok(index.includes(token),"missing mobile admin access "+token);

  assert.match(clientPortalJs,/import\("\.\/client-mobile\.js"\)/);
  assert.ok(clientMobile.includes('id="client-mobile-more"'));
  assert.ok(clientMobile.includes('id="client-mobile-menu"'));
  for(const anchor of ["client-overview","client-intelligence","client-analytics","client-calls","client-finance","client-routing","client-service-center"]){
    assert.ok(clientMobile.includes('data-client-anchor="'+anchor+'"'),"missing client mobile anchor "+anchor);
  }
  for(const action of ["portability","export","security","refresh","logout"]){
    assert.ok(clientMobile.includes('data-client-action="'+action+'"'),"missing client mobile action "+action);
  }
  assert.match(clientPortalCss,/complete-client-mobile-access-v131/);
  assert.match(clientPortalCss,/\.cp-mobile-nav\{position:fixed/);
});


test("Premium+ reste lazy, accessible et complet sur petit écran",()=>{
  assert.match(commandLoader,/premium-plus\.js/);
  assert.match(read("assets/client-premium.js"),/client-premium-plus\.js/);
  for(const token of ["data-pgi-contrast","data-pgi-motion","data-pgi-density","data-pgi-text","@media(max-width:640px)"])assert.ok(premiumPlusCore.includes(token),token);
  assert.match(premiumPlusCore,/beforeinstallprompt/);
  assert.match(premiumPlusCore,/largest-contentful-paint/);
  assert.match(premiumPlusCore,/layout-shift/);
  assert.match(premiumPlusCore,/durationThreshold/);
  for(const label of ["Notifications","Confort","Sécurité","Guide","Application","Qualité UX"])assert.ok(premiumPlus.includes(label),label);
  for(const label of ["Notifications","Préférences","Sécurité","Confiance","Application","Qualité UX"])assert.ok(clientPremiumPlus.includes(label),label);
  assert.match(clientPremiumPlus,/operational_alerts/);
  assert.match(clientPremiumPlus,/service_incidents/);
  assert.match(clientPremiumPlus,/client-service-center/);
  assert.match(clientI18n,/pgi_client_locale/);
  assert.match(clientI18n,/setLocale/);
  assert.match(passkeyClient,/navigator\.credentials\.create/);
  assert.match(passkeyClient,/navigator\.credentials\.get/);
  assert.doesNotMatch(sw,/premium-plus\.js|client-premium-plus\.js|passkey-client\.js/);
});

test("la PWA Premium+ gère le portail client et les mises à jour sans forcer le reload",()=>{
  assert.match(sw,/pgi-v49/);
  assert.match(sw,/client\.html/);
  assert.match(sw,/SKIP_WAITING/);
  assert.doesNotMatch(sw,/c\.addAll\(S\)\)\.then\(\(\)=>self\.skipWaiting\(\)\)/);
  assert.match(premiumPlusCore,/r\?\.waiting/);
  assert.match(premiumPlusCore,/postMessage\(\{type:"SKIP_WAITING"\}\)/);
});
