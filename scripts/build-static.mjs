import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const dist=path.join(root,"dist");
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));

fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(path.join(dist,"assets"),{recursive:true});

const files=[
  "index.html",
  "client.html",
  "site/index.html",
  "site/site.css",
  "site/site.js",
  "sitemap.xml",
  "manifest.webmanifest",
  "service-worker.js",
  "robots.txt",
  ".nojekyll",
  "assets/styles.css",
  "assets/client-portal.css",
  "assets/client-admin-theme.css",
  "assets/client-config.js",
  "assets/client-i18n.js",
  "assets/client-google.js",
  "assets/client-portal-api.js",
  "assets/client-portal.js",
  "assets/client-live-finance.js",
  "assets/client-live-finance.css",
  "assets/client-analytics-plus.js",
  "assets/client-account-proof.js",
  "assets/client-experience-command-center.js",
  "assets/client-portability.js",
  "assets/client-service-center.js",
  "assets/client-relations.js",
  "assets/client-voice-studio.js",
  "assets/client-search.js",
  "assets/client-premium.js",
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
  "assets/performance-radar.js",
  "assets/voice-intelligence.js",
  "assets/subscription-billing-ui.js",
  "assets/customer-admin.js",
  "assets/customer-profitability.js",
  "assets/customer-relations.js",
  "assets/customer-admin.css",
  "assets/tenant-control-detail.js",
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
  "assets/performance-resilience-lab.js",
  "assets/sva-compliance-center.js",
  "assets/call-tools.js",
  "assets/call-list.js",
  "assets/metric-reset.js",
  "assets/app.js",
  "assets/audiotel-brand-icon-v33.png",
  "assets/audiotel-brand-logo-v33.png"
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
const marketingSite=applyPublicMetadata(marketingSource,publicBaseUrl);
const marketingRoot=applyPublicMetadata(
  marketingSource
    .replaceAll("../assets/","assets/")
    .replaceAll("../client.html","client.html")
    .replace('href="site.css"','href="site/site.css"')
    .replace('src="site.js"','src="site/site.js"'),
  publicBaseUrl
);
fs.writeFileSync(path.join(dist,"site","index.html"),marketingSite,"utf8");
fs.writeFileSync(path.join(dist,"index.html"),marketingRoot,"utf8");
const seoPages=[
  "audiotel-voyance",
  "audiotel-coaching",
  "audiotel-professionnels",
  "reversement-audiotel",
  "numero-sva",
  "comparateur-audiotel",
  "guide-audiotel-sva",
  "demande-ouverture",
  "confidentialite",
  "conditions-abonnement"
];
for(const slug of seoPages){
  const source=fs.readFileSync(path.join(root,"site","seo",slug+".html"),"utf8");
  const targetDir=path.join(dist,slug);
  fs.mkdirSync(targetDir,{recursive:true});
  fs.writeFileSync(path.join(targetDir,"index.html"),applyLandingMetadata(source,publicBaseUrl,slug),"utf8");
}


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
      "Sitemap: "+publicBaseUrl+"/sitemap.xml",
      ""
    ].join("\n"),
    "utf8"
  );
  const lastmod=new Date().toISOString().slice(0,10);
  const urls=[
    {loc:publicBaseUrl+"/",priority:"1.0"},
    ...seoPages.map(slug=>({loc:publicBaseUrl+"/"+slug+"/",priority:"0.8"}))
  ];
  fs.writeFileSync(
    path.join(dist,"sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
    urls.map(x=>'  <url>\n    <loc>'+escapeXml(x.loc)+'</loc>\n    <lastmod>'+lastmod+'</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>'+x.priority+'</priority>\n  </url>\n').join("")+
    '</urlset>\n',
    "utf8"
  );
}

const mode=process.env.PGI_RUNTIME_MODE||"demo";
const apiBaseUrl=process.env.PGI_API_BASE_URL||"";
const googleClientId=String(process.env.PGI_GOOGLE_CLIENT_ID||"").trim();
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
    process.env.VERCEL_PROJECT_PRODUCTION_URL||
    process.env.VERCEL_URL||
    ""
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

function applyLandingMetadata(html,baseUrl,slug){
  const base=baseUrl||"https://clairvoyancemedium.github.io/pgi-telecom-audiotelpremiumpro.github.io";
  const canonical=base.replace(/\/+$/,"")+"/"+slug+"/";
  const logo=base.replace(/\/+$/,"")+"/assets/audiotel-brand-logo-v33.png";
  return html
    .replaceAll("__BASE__",base.replace(/\/+$/,""))
    .replaceAll("__CANONICAL__",canonical)
    .replaceAll("__LOGO__",logo);
}

function escapeXml(value){
  return String(value).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[ch]));
}
