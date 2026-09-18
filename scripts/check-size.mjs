import fs from "node:fs";
import path from "node:path";

const budgets = {
  "index.html": 60 * 1024,
  "assets/styles.css": 90 * 1024,
  "assets/config.js": 8 * 1024,
  "assets/core.js": 24 * 1024,
  "assets/api-client.js": 16 * 1024,
  "assets/app.js": 90 * 1024,
  "service-worker.js": 16 * 1024
};

let total = 0;
const failures = [];
for (const [file,max] of Object.entries(budgets)) {
  const size = fs.statSync(path.resolve(file)).size;
  total += size;
  if (size > max) failures.push(`${file}: ${size} bytes > budget ${max}`);
}
const totalBudget = 260 * 1024;
if (total > totalBudget) failures.push(`shell total: ${total} bytes > budget ${totalBudget}`);

if (failures.length) {
  failures.forEach(x => console.error("FAIL:", x));
  process.exit(1);
}
console.log(`Performance budget: OK (${total} bytes)`);
