import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

const root=process.cwd();
const dist=path.join(root,"dist");
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));
const publicAssetVersion=String(process.env.PGI_RELEASE_ID||pkg.version||"dev").trim().replace(/[^A-Za-z0-9._-]/g,"").slice(0,12)||"dev";

fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(path.join(dist,"assets"),{recursive:true});

const files=[
  "index.html",
  "client.html",
  "paiement-cb-result.html",
  "site/index.html",
  "site/site.css",
  "site/application.css",
  "site/payment-card.css",
  "site/site.js",
  "site/site-search.js",
  "site/payment-result.js",
  "site/form-ux.js",
  "site/contact-widget.js",
  "site/contact-widget.css",
  "site/hubspot-tracking.js",
  "site/manifest.webmanifest",
  "sitemap.xml",
  "manifest.webmanifest",
  "service-worker.js",
  "robots.txt",
  "llms.txt",
  "llms-full.txt",
  "fa0a7deb5d60bdf1260c8174ad8c71db.txt",
  ".nojekyll",
  "assets/styles.css",
  "assets/client-portal.css",
  "assets/client-admin-theme.css",
  "assets/client-config.js",
  "assets/client-i18n.js",
  "assets/client-google.js",
  "assets/client-portal-api.js",
  "assets/client-portal.js",
  "assets/client-billing.js",
  "assets/withdrawal.js",
  "assets/withdrawal.css",
  "assets/customer-email-verification.js",
  "assets/client-live-finance.js",
  "assets/call-time-summary.js",
  "assets/client-live-finance.css",
  "assets/business-live-reset-schedule.js",
  "assets/business-live-reset-schedule.css",
  "assets/password-visibility.js",
  "assets/client-analytics-plus.js",
  "assets/client-number-control.js",
  "assets/client-account-proof.js",
  "assets/client-experience-command-center.js",
  "assets/client-portability.js",
  "assets/client-portability-base.js",
  "assets/client-portability-priority.js",
  "assets/client-service-center.js",
  "assets/client-relations.js",
  "assets/client-voice-studio.js",
  "assets/client-search.js",
  "assets/client-premium.js",
  "assets/client-growth-suite.js",
  "assets/client-growth-suite.css",
  "assets/client-card-payments.js",
  "assets/client-referral.js",
  "assets/referral-admin.js",
  "assets/client-card-payments.css",
  "assets/client-audience.js",
  "assets/client-access-visibility.js",
  "assets/client-mobile.js",
  "assets/client-team-access.js",
  "assets/client-premium-plus.js",
  "assets/passkey-client.js",
  "assets/premium-plus-core.js",
  "assets/premium-plus.js",
  "assets/client-intelligence.js",
  "assets/core.js",
  "assets/api-client.js",
  "assets/data-client.js",
  "assets/demo-data.js",
  "assets/command-palette-loader.js",
  "assets/command-palette.js",
  "assets/workspace.js",
  "assets/cockpit-pro.js",
  "assets/cockpit-pro.css",
  "assets/live-finance.js",
  "assets/live-finance.css",
  "assets/cockpit-growth-suite.js",
  "assets/cockpit-growth-suite.css",
  "assets/performance-radar.js",
  "assets/voice-intelligence.js",
  "assets/subscription-billing-ui.js",
  "assets/customer-admin.js",
  "assets/customer-profitability.js",
  "assets/customer-relations.js",
  "assets/customer-admin.css",
  "assets/tenant-control-detail.js",
  "assets/tenant-line-command.js",
  "assets/yearly-progress.js",
  "assets/tenant-consumption-check.js",
  "assets/customer-360-detail.js",
  "assets/customer-internal-notes.js",
  "assets/tenant-control-utils.js",
  "assets/tenant-portability-admin.js",
  "assets/tenant-service-admin.js",
  "assets/tenant-payout-admin.js",
  "assets/platform-admin-tools.js",
  "assets/platform-regulatory-tools.js",
  "assets/control-tower.js",
  "assets/control-tower-assurance.js",
  "assets/launch-readiness.js",
  "assets/performance-resilience-lab.js",
  "assets/sva-compliance-center.js",
  "assets/call-tools.js",
  "assets/call-list.js",
  "assets/metric-reset.js",
  "assets/app.js",
  "assets/audiotel-brand-icon-v33.png",
  "assets/audiotel-brand-logo-v33.png",
  "assets/audiotel-hero-professionnels-diagonal.webp"
];

for(const file of files){
  const src=path.join(root,file);
  const dst=path.join(dist,file);
  if(!fs.existsSync(src))throw new Error("Missing build input: "+file);
  fs.mkdirSync(path.dirname(dst),{recursive:true});
  fs.copyFileSync(src,dst);
}

// The customer-facing site owns the production root. Keep the staff cockpit on a
// dedicated, non-indexed URL instead of exposing it as the homepage.
fs.copyFileSync(path.join(root,"index.html"),path.join(dist,"cockpit.html"));
const publicBaseUrl=resolvePublicBaseUrl();
const marketingSource=fs.readFileSync(path.join(root,"site","index.html"),"utf8");
const marketingSite=versionPublicAssets(injectPublicSearch(injectContactWidget(injectLegalNavigation(simplifyPublicShell(applyPublicMetadata(marketingSource,publicBaseUrl))))));
const marketingRoot=versionPublicAssets(injectPublicSearch(injectContactWidget(injectLegalNavigation(simplifyPublicShell(applyPublicMetadata(
  marketingSource
    .replaceAll("../assets/","assets/")
    .replaceAll("../client.html","client.html")
    .replace('href="site.css"','href="site/site.css"')
    .replace('src="site.js"','src="site/site.js"'),
  publicBaseUrl
))))));
fs.writeFileSync(path.join(dist,"site","index.html"),marketingSite,"utf8");
fs.writeFileSync(path.join(dist,"index.html"),marketingRoot,"utf8");
const seoPages=[
  "solutions-audiotel",
  "business-live-audiotel",
  "audiotel-sans-siret",
  "changer-operateur-audiotel",
  "monetiser-ses-appels",
  "combien-rapporte-numero-surtaxe",
  "audiotel-voyance",
  "audiotel-independants",
  "audiotel-coaching",
  "audiotel-professionnels",
  "reversement-audiotel",
  "numero-sva",
  "portabilite-numero-sva",
  "portabilite-prioritaire",
  "parrainage-audiotel",
  "numero-surtaxe-08",
  "tarif-numero-sva",
  "comparateur-audiotel",
  "paiement-cb-audiotel",
  "guide-audiotel-sva",
  "demande-ouverture",
  "mentions-legales",
  "conditions-utilisation",
  "conditions-abonnement",
  "confidentialite",
  "accord-traitement-donnees",
  "cookies-traceurs",
  "resilier-contrat",
  "retractation"
];
for(const slug of seoPages){
  const source=fs.readFileSync(path.join(root,"site","seo",slug+".html"),"utf8");
  const targetDir=path.join(dist,slug);
  fs.mkdirSync(targetDir,{recursive:true});
  fs.writeFileSync(path.join(targetDir,"index.html"),versionPublicAssets(injectPublicSearch(injectContactWidget(injectLegalNavigation(simplifyPublicShell(applyLandingMetadata(source,publicBaseUrl,slug)))))),"utf8");
}


const searchCategory={
  "solutions-audiotel":"Solutions","business-live-audiotel":"Suivi en direct","audiotel-sans-siret":"Ouverture",
  "changer-operateur-audiotel":"Portabilité","monetiser-ses-appels":"Guide","combien-rapporte-numero-surtaxe":"Revenus","audiotel-voyance":"Métiers","audiotel-independants":"Métiers",
  "audiotel-coaching":"Métiers","audiotel-professionnels":"Métiers","reversement-audiotel":"Reversements",
  "numero-sva":"Numéro SVA","portabilite-numero-sva":"Portabilité","portabilite-prioritaire":"Portabilité","parrainage-audiotel":"Parrainage","numero-surtaxe-08":"Numéro 08",
  "tarif-numero-sva":"Tarifs","comparateur-audiotel":"Comparateur","paiement-cb-audiotel":"Paiement CB",
  "guide-audiotel-sva":"Guide","demande-ouverture":"Ouverture","mentions-legales":"Juridique",
  "conditions-utilisation":"Juridique","conditions-abonnement":"Juridique","confidentialite":"Confidentialité",
  "accord-traitement-donnees":"Confidentialité","cookies-traceurs":"Confidentialité",
  "resilier-contrat":"Abonnement","retractation":"Abonnement"
};
const searchHints={
  "portabilite-numero-sva":"portabilité portage transfert conserver garder numéro changer opérateur",
  "portabilite-prioritaire":"portabilité prioritaire 9,90 priorité traitement dossier transfert",
  "parrainage-audiotel":"parrainage parrain filleul lien code récompense client",
  "changer-operateur-audiotel":"changer opérateur concurrent transfert portabilité conserver numéro",
  "monetiser-ses-appels":"monétiser appels clients revenus numéro surtaxé",
  "combien-rapporte-numero-surtaxe":"combien rapporte numéro surtaxé revenus gains reversement",
  "numero-sva":"nouveau numéro numéro surtaxé 08 081 082 089 SVA ouvrir créer",
  "numero-surtaxe-08":"08 081 082 089 surtaxé tarification majorée",
  "tarif-numero-sva":"tarif prix coût appel 08 SVA",
  "reversement-audiotel":"reversement revenu gains rémunération minute",
  "comparateur-audiotel":"comparer offre gains revenu économie reversement",
  "paiement-cb-audiotel":"paiement CB carte bancaire consultation forfait",
  "business-live-audiotel":"Business Live direct temps réel suivi appels",
  "audiotel-sans-siret":"sans SIRET particulier porteur projet",
  "conditions-abonnement":"4,90€ abonnement prix résiliation paiement contrat",
  "resilier-contrat":"résilier résiliation abonnement contrat",
  "retractation":"rétractation consommateur droit",
  "confidentialite":"RGPD données confidentialité vie privée"
};
function decodeSearchText(value){
  return String(value||"")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">");
}
function stripSearchMarkup(value){
  return decodeSearchText(String(value||"")
    .replace(/<script[\s\S]*?<\/script>/gi," ")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim());
}
function searchEntry(url,file,slug=""){
  const page=fs.readFileSync(file,"utf8");
  const title=stripSearchMarkup(page.match(/<title>([\s\S]*?)<\/title>/i)?.[1]||"Audiotel Premium Pro");
  const description=decodeSearchText(page.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1]||"");
  const headings=[...page.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map(m=>stripSearchMarkup(m[1])).join(" · ");
  const text=stripSearchMarkup(page).slice(0,5000);
  return {url,title,description,headings,category:slug?searchCategory[slug]||"Informations":"Accueil",keywords:(slug.replaceAll("-"," ")+" "+(searchHints[slug]||"")).trim(),text};
}
const siteSearchPages=[
  searchEntry("/",path.join(dist,"index.html")),
  ...seoPages.map(slug=>searchEntry("/"+slug+"/",path.join(dist,slug,"index.html"),slug))
];
fs.writeFileSync(path.join(dist,"site-search-index.json"),JSON.stringify({version:2,pages:siteSearchPages}),"utf8");


if(publicBaseUrl){
  fs.writeFileSync(
    path.join(dist,"robots.txt"),
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /client.html",
      "Disallow: /cockpit",
      "Disallow: /cockpit.html",
      "Disallow: /backend/",
      "Disallow: /docs/",
      "",
      "User-agent: Bingbot",
      "Allow: /",
      "Disallow: /client.html",
      "Disallow: /cockpit",
      "Disallow: /cockpit.html",
      "Disallow: /backend/",
      "Disallow: /docs/",
      "",
      "User-agent: OAI-SearchBot",
      "Allow: /",
      "Disallow: /client.html",
      "Disallow: /cockpit",
      "Disallow: /cockpit.html",
      "Disallow: /backend/",
      "Disallow: /docs/",
      "",
      "User-agent: Claude-SearchBot",
      "Allow: /",
      "Disallow: /client.html",
      "Disallow: /cockpit",
      "Disallow: /cockpit.html",
      "Disallow: /backend/",
      "Disallow: /docs/",
      "",
      "User-agent: PerplexityBot",
      "Allow: /",
      "Disallow: /client.html",
      "Disallow: /cockpit",
      "Disallow: /cockpit.html",
      "Disallow: /backend/",
      "Disallow: /docs/",
      "",
      "User-agent: Applebot",
      "Allow: /",
      "Disallow: /client.html",
      "Disallow: /cockpit",
      "Disallow: /cockpit.html",
      "Disallow: /backend/",
      "Disallow: /docs/",
      "",
      "Sitemap: "+publicBaseUrl+"/sitemap.xml",
      ""
    ].join("\n"),
    "utf8"
  );
  const urls=[
    {loc:publicBaseUrl+"/",sourcePath:"site/index.html"},
    ...seoPages
      .filter(slug=>slug!=="mentions-legales")
      .map(slug=>({loc:publicBaseUrl+"/"+slug+"/",sourcePath:"site/seo/"+slug+".html"}))
  ];
  fs.writeFileSync(
    path.join(dist,"sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
    urls.map(x=>{
      const lastmod=latestGitDate(x.sourcePath);
      return '  <url>\n    <loc>'+escapeXml(x.loc)+'</loc>\n'+
        (lastmod?'    <lastmod>'+lastmod+'</lastmod>\n':'')+
        '  </url>\n';
    }).join("")+
    '</urlset>\n',
    "utf8"
  );
}

const mode=process.env.PGI_RUNTIME_MODE||"demo";
const apiBaseUrl=process.env.PGI_API_BASE_URL||"";
const googleClientId=String(process.env.PGI_GOOGLE_CLIENT_ID||"841451931994-iq878g5pip1ufmu19oeqss7bqtcbilqu.apps.googleusercontent.com").trim();
const releaseId=process.env.PGI_RELEASE_ID||"";
const production=mode==="production";
if(production&&!/^[0-9a-f]{40}$/.test(releaseId))throw new Error("PGI_RELEASE_ID must be the 40-character Git SHA in production");
const config={
  appName:"PGI • Telecom - Audiotel Premium Pro",
  version:pkg.version,
  releaseId,
  schemaVersion:1,
  mode,
  apiBaseUrl,
  currency:"EUR",
  locale:"fr-FR",
  features:{
    realtime:production,
    settlements:production,
    fullCallerNumber:false
  }
};

fs.writeFileSync(path.join(dist,"assets","client-config.js"),"window.PGI_CLIENT_CONFIG=Object.freeze("+JSON.stringify({googleClientId})+");\n","utf8");

fs.writeFileSync(
  path.join(dist,"assets","config.js"),
  "window.PGI_CONFIG = Object.freeze("+JSON.stringify(config)+");\n",
  "utf8"
);

console.log("Static build ready:",dist);
console.log("Runtime mode:",mode);
console.log("API base:",apiBaseUrl||"(not configured)");
console.log("Release:",releaseId||"(demo)");


function resolvePublicBaseUrl(){
  const raw=String(
    process.env.PGI_PUBLIC_BASE_URL||
    "https://audiotel-premium-pro.com"
  ).trim();
  if(!raw)return "";
  const value=/^https?:\/\//i.test(raw)?raw:"https://"+raw;
  let url;
  try{url=new URL(value);}catch{throw new Error("Invalid public base URL");}
  if(!["http:","https:"].includes(url.protocol))throw new Error("Public base URL must use HTTP(S)");
  return (url.origin+url.pathname).replace(/\/+$/,"");
}

function applyPublicMetadata(html,baseUrl){
  if(!baseUrl)return html;
  const canonical=baseUrl+"/";
  const image=baseUrl+"/assets/audiotel-brand-logo-v33.png";
  return html
    .replace(/<link rel="canonical" href="[^"]*">/,'<link rel="canonical" href="'+canonical+'">')
    .replace(/<meta property="og:url" content="[^"]*">/,'<meta property="og:url" content="'+canonical+'">')
    .replace(/<meta property="og:image" content="[^"]*">/,'<meta property="og:image" content="'+image+'">')
    .replace(/<meta name="twitter:image" content="[^"]*">/,'<meta name="twitter:image" content="'+image+'">')
    .replace(/"logo":"[^"]*audiotel-brand-logo-v33[.]png"/,'"logo":"'+image+'"')
    .replace(/"url":"[^"]*"/,'"url":"'+canonical+'"');
}

function LANDING_SEO_META(slug){return ({
  "business-live-audiotel":{title:"Business Live Audiotel : suivi des appels | Audiotel Premium Pro",description:"Suivez en direct l’activité, les minutes et les montants estimés pendant vos appels, avec distinction entre estimé, confirmé et validé."},
  "audiotel-sans-siret":{title:"Audiotel sans SIRET : première demande | Audiotel Premium Pro",description:"Déposez une première demande Audiotel sans SIRET, pour un nouveau numéro ou une portabilité, puis découvrez les justificatifs requis avant activation."},
  "changer-operateur-audiotel":{title:"Changer d’opérateur Audiotel | Audiotel Premium Pro",description:"Changez de solution Audiotel sans repartir de zéro : portabilité d’un numéro SVA éligible, comparaison de l’offre actuelle et étapes du transfert."},
  "audiotel-voyance":{title:"Audiotel voyance : numéro SVA | Audiotel Premium Pro",description:"Audiotel pour voyance et astrologie : numéro SVA, suivi des appels, reversements, portabilité et espace client."},
  "audiotel-independants":{title:"Audiotel indépendant : numéro SVA | Audiotel Premium Pro",description:"Audiotel pour indépendants et porteurs de projet : numéro SVA, reversements, portabilité et demande initiale possible sans SIRET selon la situation."},
  "audiotel-coaching":{title:"Audiotel coaching : numéro SVA | Audiotel Premium Pro",description:"Audiotel pour coaching et conseil téléphonique : numéro SVA, appels, minutes, reversements, portabilité et suivi en ligne."},
  "audiotel-professionnels":{title:"Audiotel professionnel : numéro SVA | Audiotel Premium Pro",description:"Audiotel pour professionnels et entreprises : numéro SVA, suivi des appels, reversements, portabilité et gestion depuis un espace client."},
  "reversement-audiotel":{title:"Reversement Audiotel : taux et gains | Audiotel Premium Pro",description:"Comparez taux de reversement, minutes facturables et montants attendus, confirmés et validés avec une simulation transparente."},
  "numero-sva":{title:"Numéro SVA / Audiotel : ouverture | Audiotel Premium Pro",description:"Numéro SVA/Audiotel pour particuliers et professionnels : ouverture, suivi des appels, portabilité, tarification et reversements."},
  "portabilite-numero-sva":{title:"Portabilité numéro surtaxé : garder son 08 | Audiotel Premium Pro",description:"Conservez un numéro surtaxé SVA éligible : préparation du transfert, vérification du titulaire et suivi de la confirmation opérateur."},
  "numero-surtaxe-08":{title:"Numéro surtaxé 08 : 081, 082, 089 | Audiotel Premium Pro",description:"Comprenez les numéros 081, 082 et 089, les tarifs SVA, la composante service et les principales obligations d’information."},
  "tarif-numero-sva":{title:"Tarif numéro surtaxé SVA | Audiotel Premium Pro",description:"Comprenez les tarifs des numéros SVA en France, les paliers 08, le prix du service et l’abonnement Audiotel Premium Pro."},
  "comparateur-audiotel":{title:"Comparateur Audiotel : reversements | Audiotel Premium Pro",description:"Comparez un écart de reversement Audiotel et mesurez l’impact potentiel par minute, jour, mois et année selon votre volume d’appels."},
  "paiement-cb-audiotel":{title:"Paiement CB sécurisé | Audiotel Premium Pro",description:"Paiement CB sécurisé : suivi des encaissements, commission de service de 4,9 % et frais de traitement distincts."},
  "guide-audiotel-sva":{title:"Guide Audiotel / SVA | Audiotel Premium Pro",description:"Guide Audiotel et SVA : numéro surtaxé, reversement, portabilité, tarifs, éligibilité et suivi d’activité."},
  "demande-ouverture":{title:"Demande d’ouverture | Audiotel Premium Pro",description:"Demandez un nouveau numéro ou une portabilité Audiotel Premium Pro, particulier ou professionnel, avec ou sans SIRET au dépôt initial."},
  "accord-traitement-donnees":{title:"Accord de traitement des données | Audiotel Premium Pro",description:"Accord RGPD Audiotel Premium Pro : sécurité, assistance, sous-traitants, audit et fin de contrat."}
})[slug]||null;}

function applyLandingSeoMeta(html,slug){
  const meta=LANDING_SEO_META(slug);
  if(!meta)return html.replaceAll("| PGI Telecom","| Audiotel Premium Pro");
  let out=html.replaceAll("| PGI Telecom","| Audiotel Premium Pro");
  out=out.replace(/<title>[\s\S]*?<\/title>/i,"<title>"+meta.title+"</title>");
  out=out.replace(/<meta name="description" content="[^"]*">/i,'<meta name="description" content="'+meta.description+'">');
  out=out.replace(/<meta property="og:title" content="[^"]*">/i,'<meta property="og:title" content="'+meta.title+'">');
  out=out.replace(/<meta property="og:description" content="[^"]*">/i,'<meta property="og:description" content="'+meta.description+'">');
  out=out.replace(/<meta name="twitter:title" content="[^"]*">/i,'<meta name="twitter:title" content="'+meta.title+'">');
  out=out.replace(/<meta name="twitter:description" content="[^"]*">/i,'<meta name="twitter:description" content="'+meta.description+'">');
  return out;
}

function applyLandingMetadata(html,baseUrl,slug){
  const base=baseUrl||"https://audiotel-premium-pro.com";
  const canonical=base.replace(/\/+$/,"")+"/"+slug+"/";
  const logo=base.replace(/\/+$/,"")+"/assets/audiotel-brand-logo-v33.png";
  const rendered=html
    .replaceAll("__BASE__",base.replace(/\/+$/,""))
    .replaceAll("__CANONICAL__",canonical)
    .replaceAll("__LOGO__",logo);
  return injectBreadcrumb(applyLandingSeoMeta(rendered,slug),base,canonical);
}

function injectBreadcrumb(html,baseUrl,canonical){
  if(html.includes('"@type":"BreadcrumbList"'))return html;
  const title=(html.match(/<title>([^<]+)<\/title>/i)?.[1]||"Audiotel Premium Pro").trim();
  const data={
    "@context":"https://schema.org",
    "@type":"BreadcrumbList",
    itemListElement:[
      {"@type":"ListItem",position:1,name:"Accueil",item:baseUrl.replace(/\/+$/,"")+"/"},
      {"@type":"ListItem",position:2,name:title,item:canonical}
    ]
  };
  return html.replace("</head>",'<script type="application/ld+json">'+JSON.stringify(data)+'</script>\n</head>');
}

function latestGitDate(sourcePath){
  try{
    const value=execFileSync("git",["log","-1","--format=%cs","--",sourcePath],{
      cwd:root,
      encoding:"utf8",
      stdio:["ignore","pipe","ignore"]
    }).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value;
  }catch{}
  try{
    const source=fs.readFileSync(path.join(root,sourcePath),"utf8");
    const match=source.match(/"dateModified":"(\d{4}-\d{2}-\d{2})"/);
    return match?match[1]:"";
  }catch{
    return "";
  }
}

function simplifyPublicShell(html){
  const nav='<nav aria-label="Navigation principale"><a href="/solutions-audiotel/">Solutions</a><a href="/portabilite-numero-sva/">Portabilité</a><a href="/#simulateur">Simulateur</a><a href="/#tarif">Tarif</a></nav>';
  const legalAccess='<section class="section section-dark legal-access-section"><div class="wrap"><div class="section-head legal-access-head"><p class="eyebrow">DOCUMENTS UTILES</p><h2>Besoin d’un document précis ?</h2><p>Accédez directement aux informations les plus utiles.</p></div><nav class="legal-access-links" aria-label="Documents contractuels"><a href="/conditions-abonnement/"><strong>Conditions d’abonnement</strong><span>Prix, paiement, résiliation et règles du contrat.</span></a><a href="/confidentialite/"><strong>Confidentialité</strong><span>Comment vos données sont utilisées et protégées.</span></a><a href="/resilier-contrat/"><strong>Résilier mon abonnement</strong><span>Accéder directement à la démarche de résiliation.</span></a><a href="/retractation/"><strong>Droit de rétractation</strong><span>Consulter ou exercer le droit applicable.</span></a></nav></div></section>';
  return html
    .replace(/<nav aria-label="Navigation principale">[\s\S]*?<\/nav>/,nav)
    .replace(/<a class="header-login" href="[^"]*client\.html">[\s\S]*?<\/a>/,'<a class="header-login" href="/client.html"><span>Déjà client ?</span><strong>Se connecter à mon espace client</strong></a>')
    .replace(/<section class="section section-dark"><div class="wrap"><div class="section-head"><p class="eyebrow">DOCUMENTS (?:JURIDIQUES|ASSOCIÉS)<\/p><h2>[\s\S]*?<\/h2><\/div><div class="footer-links">[\s\S]*?<\/div><\/div><\/section>/g,legalAccess)
    .replaceAll("<span>Solution PGI Telecom</span>","<span>Une solution PGI Telecom</span>")
    .replaceAll("Demander l’ouverture de mon compte","Demander mon numéro")
    .replaceAll("Découvrir la plateforme","Découvrir les avantages")
    .replaceAll("Comparer un écart économique","Calculer votre revenu supplémentaire")
    .replaceAll("Comparer les économies potentielles","Calculer votre revenu supplémentaire")
    .replaceAll("Préparer ma demande","Demander mon numéro")
    .replaceAll("<span>Plateforme Audiotel &amp; SVA</span>","<span>Numéro surtaxé &amp; espace client</span>")
    .replaceAll("<span>4,90€ TTC / mois pour la plateforme</span>","<span>Mois en cours offert · puis 4,90€ / mois</span>")
    .replaceAll("<span>4,90€ TTC / mois</span>","<span>Mois en cours offert · puis 4,90€ / mois</span>")
    .replaceAll("<span>Particulier ou professionnel</span>","<span>Particuliers, indépendants &amp; entreprises</span>")
    .replaceAll("<span>Activation soumise à validation</span>","<span>Activation après validation</span>")
    .replaceAll("<span>Activation après validation</span>","<span>Activation après validation</span><span>Sans engagement de durée</span>")
    .replaceAll("4,90€ / mois","4,90€ TTC / mois")
    .replaceAll("4,90€ par mois","4,90€ TTC par mois");
}



function normalizePublicBranding(html){
  return String(html||"")
    .replace(/\bPGI\s*(?:[•·-]\s*)?Telecom\b/gi,"PGI Telecom")
    .replace(/\bPGI\b(?!\s+Telecom)/gi,"PGI Telecom");
}

function injectRevenueQuickNav(html){
  const nav='<section class="revenue-quick-nav" aria-label="Accès rapides Audiotel Premium Pro"><div class="wrap"><nav class="revenue-quick-tabs" aria-label="Accès rapides Audiotel Premium Pro"><a class="revenue-quick-tab revenue-quick-tab-primary" href="/portabilite-numero-sva/"><small>DÉJÀ UN NUMÉRO SURTAXÉ ?</small><strong>Demander ma portabilité</strong><span>Conserver mon numéro s’il est éligible</span></a><a class="revenue-quick-tab" href="/demande-ouverture/?type=nouveau"><small>NOUVEAU CLIENT</small><strong>Demander mon numéro surtaxé</strong><span>Préparer mon ouverture</span></a><a class="revenue-quick-tab" href="/comparateur-audiotel/"><small>POTENTIEL DE REVENUS</small><strong>Estimer mes reversements</strong><span>Comparer à activité identique</span></a><a class="revenue-quick-tab" href="/paiement-cb-audiotel/"><small>ENCAISSEMENT PAR LIEN</small><strong>Créer un lien de paiement CB</strong><span>Envoyer le lien et suivre le paiement</span></a><a class="revenue-quick-tab revenue-quick-tab-client" href="/parrainage-audiotel/"><small>PARRAINAGE</small><strong>Parrainer un nouveau client</strong><span>Partager mon lien client</span></a></nav></div></section>';
  const out=String(html||"").replace(/<section class="revenue-quick-nav"[\s\S]*?<\/section>/,nav);
  if(out.includes('class="revenue-quick-nav"'))return out;
  return out.replace("</body>",nav+"\n</body>");
}

function versionPublicAssets(html){
  const prepared=normalizePublicBranding(injectRevenueQuickNav(String(html||"")));
  return prepared.replace(/((?:src|href)=")(?!https?:|data:|mailto:|#)([^"]+\.(?:css|js|png|webp|svg|ico))(")/gi,(full,prefix,url,suffix)=>{
    if(/[?&]v=/.test(url))return full;
    return prefix+url+(url.includes("?")?"&":"?")+"v="+publicAssetVersion+suffix;
  });
}

function injectPublicSearch(html){
  const search='<div class="wrap public-search-wrap" data-site-search><form class="public-search" data-site-search-form role="search" aria-label="Rechercher sur Audiotel Premium Pro"><div class="public-search-box"><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="m21 21-4.35-4.35m2.35-5.65a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><label class="sr-only" for="site-search-input">Rechercher sur tout le site</label><input id="site-search-input" data-site-search-input type="search" inputmode="search" autocomplete="off" spellcheck="false" placeholder="Rechercher sur tout le site…" aria-autocomplete="list" aria-controls="site-search-results" aria-expanded="false"><span class="public-search-hint" aria-hidden="true">/</span></div><div class="public-search-results" id="site-search-results" data-site-search-results role="listbox" hidden></div></form></div>';
  let out=html;
  if(!out.includes('data-site-search'))out=out.replace("</header>",search+"</header>");
  if(!out.includes('/site/site-search.js'))out=out.replace("</head>",'<script src="/site/site-search.js" defer></script>\n</head>');
  return out;
}

function injectContactWidget(html){
  if(html.includes('/site/contact-widget.js'))return html;
  return html.replace("</head>",'<link rel="stylesheet" href="/site/contact-widget.css">\n<script src="/site/contact-widget.js" defer></script>\n</head>');
}

function injectLegalNavigation(html){
  const marker='aria-label="Informations juridiques"';
  if(html.includes(marker))return html.replaceAll('class="footer-links" '+marker,'class="footer-legal" '+marker);
  if(html.includes('class="site-footer"'))return html;
  const nav='<div class="wrap footer-legal-wrap"><nav class="footer-legal" aria-label="Informations juridiques"><a href="/mentions-legales/">Mentions légales</a><a href="/conditions-utilisation/">CGU</a><a href="/conditions-abonnement/">Conditions</a><a href="/confidentialite/">Confidentialité</a><a href="/accord-traitement-donnees/">DPA</a><a href="/cookies-traceurs/">Cookies</a><a href="/resilier-contrat/">Résilier votre contrat</a><a href="/retractation/">Rétractation</a></nav></div>';
  return html.replace("</footer>",nav+"</footer>");
}

function escapeXml(value){
  return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[ch]));
}
