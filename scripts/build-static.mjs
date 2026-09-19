import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const dist=path.join(root,"dist");
const pkg=JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8"));

fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(path.join(dist,"assets"),{recursive:true});

const files=[
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "robots.txt",
  ".nojekyll",
  "assets/styles.css",
  "assets/core.js",
  "assets/api-client.js",
  "assets/data-client.js",
  "assets/demo-data.js",
  "assets/command-palette-loader.js",
  "assets/command-palette.js",
  "assets/workspace.js",
  "assets/cockpit-pro.js",
  "assets/performance-radar.js",
  "assets/subscription-billing-ui.js",
  "assets/customer-admin.js",
  "assets/customer-admin.css",
  "assets/tenant-control-detail.js",
  "assets/platform-admin-tools.js",
  "assets/call-tools.js",
  "assets/app.js",
  "assets/favicon.svg"
];

for(const file of files){
  const src=path.join(root,file);
  const dst=path.join(dist,file);
  if(!fs.existsSync(src))throw new Error("Missing build input: "+file);
  fs.mkdirSync(path.dirname(dst),{recursive:true});
  fs.copyFileSync(src,dst);
}

const mode=process.env.PGI_RUNTIME_MODE||"demo";
const apiBaseUrl=process.env.PGI_API_BASE_URL||"";
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

fs.writeFileSync(
  path.join(dist,"assets","config.js"),
  "window.PGI_CONFIG = Object.freeze("+JSON.stringify(config,null,2)+");\n",
  "utf8"
);

console.log("Static build ready:",dist);
console.log("Runtime mode:",mode);
console.log("API base:",apiBaseUrl||"(not configured)");
console.log("Release:",releaseId||"(demo)");
