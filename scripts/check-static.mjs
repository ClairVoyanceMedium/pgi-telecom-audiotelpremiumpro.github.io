import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "index.html",
  "assets/styles.css",
  "assets/config.js",
  "assets/core.js",
  "assets/api-client.js",
  "assets/workspace.js",
  "assets/command-palette.js",
  "assets/data-client.js",
  "assets/demo-data.js",
  "assets/cockpit-pro.js",
  "assets/app.js",
  "assets/favicon.svg",
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
const app = fs.readFileSync(path.join(root, "assets/app.js"), "utf8");
const frontRuntime = [
  "index.html","assets/config.js","assets/core.js","assets/api-client.js",
  "assets/data-client.js","assets/demo-data.js","assets/command-palette.js",
  "assets/workspace.js","assets/cockpit-pro.js","assets/app.js","service-worker.js"
].map(file=>fs.readFileSync(path.join(root,file),"utf8")).join("\n");

const failures = [];
if (!index.includes("PGI • Telecom - Audiotel Premium Pro")) failures.push("Nom officiel absent de index.html");
if (!index.includes('name="viewport"')) failures.push("Viewport mobile absent");
if (/http:\/\//i.test(frontRuntime)) failures.push("Référence HTTP non chiffrée détectée");
if (/localhost|127\.0\.0\.1/i.test(frontRuntime)) failures.push("Endpoint local détecté dans le front");
if (!app.includes("baseline")) failures.push("Logique de baseline absente");
if (!app.includes("expected") || !app.includes("confirmed")) failures.push("Réconciliation financière absente");

if (failures.length) {
  failures.forEach(x => console.error("FAIL:", x));
  process.exit(1);
}
console.log("Static checks: OK");
