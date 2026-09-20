import fs from "node:fs";
import path from "node:path";

const budgets = {
  "index.html": 60 * 1024,
  "assets/styles.css": 90 * 1024,
  "assets/config.js": 8 * 1024,
  "assets/core.js": 24 * 1024,
  "assets/api-client.js": 16 * 1024,
  "assets/data-client.js": 12 * 1024,
  "assets/command-palette-loader.js": 2 * 1024,
  "assets/workspace.js": 6 * 1024,
  "assets/app.js": 90 * 1024,
  "service-worker.js": 16 * 1024
};

const portalBudgets = {"client.html":28*1024,"assets/client-portal.css":30*1024,"assets/client-portal-api.js":8*1024,"assets/client-portal.js":44*1024,"assets/client-config.js":2*1024,"assets/client-google.js":5*1024,"assets/client-i18n.js":76*1024,"assets/client-portability.js":10*1024};
const lazyBudgets = {"assets/demo-data.js":8*1024,"assets/customer-admin.css":10*1024,"assets/cockpit-pro.js":12*1024,"assets/cockpit-pro.css":4*1024,"assets/voice-intelligence.js":20*1024,"assets/client-intelligence.js":28*1024,"assets/command-palette.js":8*1024,"assets/performance-radar.js":16*1024,"assets/subscription-billing-ui.js":4*1024,"assets/customer-admin.js":24*1024,"assets/tenant-control-detail.js":22*1024,"assets/tenant-control-utils.js":4*1024,"assets/tenant-portability-admin.js":12*1024,"assets/tenant-service-admin.js":7*1024,"assets/tenant-payout-admin.js":5*1024,"assets/client-service-center.js":14*1024,"assets/client-voice-studio.js":26*1024,"assets/platform-admin-tools.js":18*1024,"assets/control-tower.js":16*1024,"assets/call-tools.js":10*1024,"assets/call-list.js":5*1024,"assets/metric-reset.js":8*1024};

let total = 0;
const failures = [];
for (const [file,max] of Object.entries(budgets)) {
  const size = fs.statSync(path.resolve(file)).size;
  total += size;
  if (size > max) failures.push(`${file}: ${size} bytes > budget ${max}`);
}
for (const [file,max] of Object.entries(portalBudgets)) {
  const bytes = fs.statSync(path.resolve(file)).size;
  if (bytes > max) failures.push(`${file}: ${bytes} bytes > portal budget ${max}`);
}
for (const [file,max] of Object.entries(lazyBudgets)) {
  const size = fs.statSync(path.resolve(file)).size;
  if (size > max) failures.push(`${file}: ${size} bytes > lazy budget ${max}`);
}
const totalBudget = 260 * 1024;
const reservedHeadroom = 20 * 1024;
if (total > totalBudget) failures.push(`shell total: ${total} bytes > budget ${totalBudget}`);
if (total > totalBudget-reservedHeadroom) failures.push(`shell reserve: ${totalBudget-total} bytes remaining < required ${reservedHeadroom}`);

if (failures.length) {
  failures.forEach(x => console.error("FAIL:", x));
  process.exit(1);
}
console.log(`Performance budget: OK (${total} bytes)`);
