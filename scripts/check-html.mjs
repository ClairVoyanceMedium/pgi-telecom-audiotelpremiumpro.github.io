import fs from "node:fs";

const html = fs.readFileSync("index.html","utf8");
const failures = [];

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const seen = new Set();
for (const id of ids) {
  if (seen.has(id)) failures.push("Duplicate id: " + id);
  seen.add(id);
}

if (!html.includes('Content-Security-Policy')) failures.push("CSP missing");
if (!html.includes('name="robots" content="noindex,nofollow,noarchive"')) failures.push("robots noindex missing");
if (!html.includes('rel="manifest"')) failures.push("manifest link missing");
if (!html.includes('class="skip-link"')) failures.push("skip link missing");

const scriptSrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
for (const src of scriptSrcs) {
  if (/^https?:\/\//i.test(src)) failures.push("Remote script forbidden: " + src);
}

const requiredScripts = ["assets/config.js","assets/core.js","assets/api-client.js","assets/app.js"];
for (const src of requiredScripts) {
  if (!scriptSrcs.includes(src)) failures.push("Required script missing: " + src);
}

if (failures.length) {
  failures.forEach(x => console.error("FAIL:", x));
  process.exit(1);
}
console.log("HTML integrity: OK");
