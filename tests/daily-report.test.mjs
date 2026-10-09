import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {dailyReportScheduleState,buildDailyReportText} from "../backend/src/daily-report.mjs";

const vercel=JSON.parse(fs.readFileSync(new URL("../vercel.json",import.meta.url),"utf8"));
const server=fs.readFileSync(new URL("../backend/server.mjs",import.meta.url),"utf8");
const resend=fs.readFileSync(new URL("../backend/src/resend-email.mjs",import.meta.url),"utf8");
const store=fs.readFileSync(new URL("../backend/src/store-postgres.mjs",import.meta.url),"utf8");

test("daily report schedule follows Europe Paris across summer and winter time",()=>{
  assert.deepEqual(dailyReportScheduleState(new Date("2026-10-08T18:00:00Z")),{date:"2026-10-08",hour:20,should_run:true,retry:false});
  assert.deepEqual(dailyReportScheduleState(new Date("2026-10-08T19:00:00Z")),{date:"2026-10-08",hour:21,should_run:true,retry:true});
  assert.equal(dailyReportScheduleState(new Date("2026-10-08T20:00:00Z")).should_run,false);
  assert.deepEqual(dailyReportScheduleState(new Date("2026-12-08T19:00:00Z")),{date:"2026-12-08",hour:20,should_run:true,retry:false});
  assert.deepEqual(dailyReportScheduleState(new Date("2026-12-08T20:00:00Z")),{date:"2026-12-08",hour:21,should_run:true,retry:true});
});

test("daily report is factual when external read APIs are unavailable",()=>{
  const report=buildDailyReportText("2026-10-08",{service:{created_today:2,open_now:1},mail:{delivered:3},system:{calls_total:4},categories:[{category:"billing",count:1}]});
  assert.match(report,/Bilan PGI Telecom \| 08\/10\/2026/);
  assert.match(report,/Google Search Console : non disponible côté serveur/);
  assert.match(report,/GA4 Data API : non disponible côté serveur/);
  assert.match(report,/Gmail : non disponible côté serveur/);
  assert.equal(report.includes(String.fromCharCode(8212)),false);
});

test("daily report backend uses protected cron and one native idempotency key",()=>{
  assert.ok(vercel.crons.some(x=>x.path==="/api/v1/internal/daily-report/run"&&x.schedule==="0 18,19,20 * * *"));
  assert.match(server,/authorizeCron\(req,config\)/);
  assert.match(server,/runDailyReportCron/);
  assert.match(resend,/idempotency-key/);
  assert.match(resend,/sendDailyReportEmail/);
  assert.match(store,/async dailyReportSnapshot/);
});


test("daily report snapshot uses the real audit timestamp column",()=>{
  assert.match(store,/audit_log WHERE action='customer\.email\.inbound_resolved' AND occurred_at>=/);
  assert.doesNotMatch(store,/audit_log WHERE action='customer\.email\.inbound_resolved' AND created_at>=/);
});
