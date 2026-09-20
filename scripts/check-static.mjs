import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "index.html",
  "client.html",
  "assets/styles.css",
  "assets/client-portal.css",
  "assets/client-config.js",
  "assets/client-i18n.js",
  "assets/client-google.js",
  "assets/client-portal-api.js",
  "assets/client-portal.js",
  "assets/client-portability.js",
  "assets/client-service-center.js",
  "assets/client-voice-studio.js",
  "assets/client-search.js",
  "assets/client-premium.js",
  "assets/client-intelligence.js",
  "assets/config.js",
  "assets/core.js",
  "assets/api-client.js",
  "assets/workspace.js",
  "assets/command-palette-loader.js",
  "assets/command-palette.js",
  "assets/data-client.js",
  "assets/demo-data.js",
  "assets/cockpit-pro.js",
  "assets/cockpit-pro.css",
  "assets/performance-radar.js",
  "assets/voice-intelligence.js",
  "assets/subscription-billing-ui.js",
  "assets/customer-admin.js",
  "assets/customer-admin.css",
  "assets/tenant-control-detail.js",
  "assets/tenant-control-utils.js",
  "assets/tenant-portability-admin.js",
  "assets/tenant-service-admin.js",
  "assets/tenant-payout-admin.js",
  "assets/platform-admin-tools.js",
  "assets/call-tools.js",
  "assets/call-list.js",
  "assets/metric-reset.js",
  "assets/app.js",
  "assets/audiotel-brand-icon-v33.png",
  "assets/audiotel-brand-logo-v33.png",
  "manifest.webmanifest",
  "service-worker.js",
  "README.md",
  "SECURITY.md",
  "docs/ARCHITECTURE.md",
  "docs/API-CONTRACT.md"
];

const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error("Fichiers requis manquants:", missing.join(", "));
  process.exit(1);
}

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const clientPortal = fs.readFileSync(path.join(root, "client.html"), "utf8");
const app = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");
const frontRuntime = [
  "index.html","client.html","assets/config.js","assets/core.js","assets/api-client.js","assets/client-portal-api.js","assets/client-portal.js","assets/client-portability.js","assets/client-service-center.js","assets/client-voice-studio.js","assets/client-search.js","assets/client-premium.js","assets/client-intelligence.js",
  "assets/data-client.js","assets/demo-data.js","assets/command-palette-loader.js","assets/command-palette.js",
  "assets/workspace.js","assets/cockpit-pro.js","assets/performance-radar.js","assets/voice-intelligence.js","assets/subscription-billing-ui.js","assets/customer-admin.js","assets/customer-admin.css","assets/tenant-control-detail.js","assets/tenant-control-utils.js","assets/tenant-portability-admin.js","assets/tenant-service-admin.js","assets/tenant-payout-admin.js","assets/platform-admin-tools.js","assets/call-tools.js","assets/call-list.js","assets/metric-reset.js","assets/app.js","service-worker.js"
].map(file=>fs.readFileSync(path.join(root,file),"utf8")).join("\n");

const failures = [];
if (!index.includes("PGI • Telecom - Audiotel Premium Pro")) failures.push("Nom officiel absent de index.html");
if (!index.includes('name="viewport"')) failures.push("Viewport mobile absent");
if (!clientPortal.includes('name="robots" content="noindex,nofollow,noarchive"')) failures.push("Customer portal must be noindex");
if (!clientPortal.includes("Audiotel Premium Pro")) failures.push("Customer portal branding missing");
if (/\bPGI\b/.test(clientPortal)) failures.push("Customer portal must use Audiotel Premium Pro, not PGI");
if (/voyance|voyant/i.test(frontRuntime)) failures.push("Generic Audiotel product must not be sector-specific to clairvoyance");
if (!index.includes("Intervenants")) failures.push("Cockpit must use generic intervenant terminology");
if (/>Experts</.test(index)||/>Expert</.test(index)) failures.push("Visible cockpit labels must not use the legacy Expert wording");
if (!clientPortal.includes("plusieurs services, équipes, intervenants ou postes")) failures.push("Customer portal must explain multiservice routing");
if (/http:\/\//i.test(frontRuntime)) failures.push("Référence HTTP non chiffrée détectée");
if (/localhost|127\.0\.0\.1/i.test(frontRuntime)) failures.push("Endpoint local détecté dans le front");
if (!app.includes("baseline")) failures.push("Logique de baseline absente");
if (!app.includes("expected") || !app.includes("confirmed")) failures.push("Réconciliation financière absente");

if (failures.length) {
  failures.forEach(x => console.error("FAIL:", x));
  process.exit(1);
}
console.log("Static checks: OK");
