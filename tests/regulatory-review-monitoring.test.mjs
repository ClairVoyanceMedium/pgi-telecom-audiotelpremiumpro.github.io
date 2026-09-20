import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const [migration,store,memory,workers,server,api,adminUi,regUi,productionCheck]=await Promise.all([
  readFile(new URL("../database/migrations/043_regulatory_review_monitoring.sql",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/store-memory.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/src/workers.mjs",import.meta.url),"utf8"),
  readFile(new URL("../backend/server.mjs",import.meta.url),"utf8"),
  readFile(new URL("../assets/api-client.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/platform-admin-tools.js",import.meta.url),"utf8"),
  readFile(new URL("../assets/platform-regulatory-tools.js",import.meta.url),"utf8"),
  readFile(new URL("../scripts/check-production-contract.mjs",import.meta.url),"utf8")
]);

test("regulatory review monitoring is additive and persistent",()=>{
  for(const token of [
    "CREATE TABLE regulatory_review_alerts",
    "review_schedule_missing",
    "review_due_soon",
    "review_due_today",
    "review_overdue",
    "control_blocking",
    "control_expiring",
    "regulatory_review_alerts_state_due_idx"
  ])assert.ok(migration.includes(token),token);
  assert.doesNotMatch(migration,/^\s*(DROP|TRUNCATE|DELETE)\b/im);
});

test("worker scans regulatory deadlines without auto-suspending lines",()=>{
  assert.ok(store.includes("async scanRegulatoryReviews("));
  assert.ok(store.includes("async listRegulatoryReviewAlerts("));
  assert.ok(store.includes("async acknowledgeRegulatoryReviewAlert("));
  assert.ok(workers.includes("scanRegulatoryReviews(1000)"));
  assert.ok(memory.includes("scanRegulatoryReviews"));
  assert.ok(migration.includes("does not itself suspend service"));
  assert.equal(store.includes("UPDATE tenant_number_assignments SET status='suspended'"),false);
});

test("review alerts are available and acknowledgeable through private API",()=>{
  assert.ok(server.includes("/api/v1/platform/regulatory-review-alerts"));
  assert.ok(server.includes("/api/v1/platform/regulatory-review-alerts/:id/acknowledge"));
  assert.ok(api.includes("regulatoryReviewAlerts:function"));
  assert.ok(api.includes("acknowledgeRegulatoryReviewAlert:function"));
  assert.ok(store.includes("regulatory.review_alert.acknowledge"));
});

test("cockpit exposes blocking today soon and next-review workflow",()=>{
  for(const token of ["Bloquants","Aujourd’hui","Bientôt","data-regulatory-attention"])assert.ok(adminUi.includes(token),token);
  for(const token of ["Échéances réglementaires","data-regulatory-alert-ack","Prochaine revue","pa-arcep-next-review","next_review_at"])assert.ok(regUi.includes(token),token);
  assert.ok(regUi.includes("L’acquittement ne modifie aucune preuve"));
});

test("production contract protects regulatory monitoring",()=>{
  assert.ok(productionCheck.includes("043_regulatory_review_monitoring.sql"));
  assert.ok(productionCheck.includes("scanRegulatoryReviews"));
});
