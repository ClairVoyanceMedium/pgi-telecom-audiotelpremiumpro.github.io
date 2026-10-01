import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const migration=fs.readFileSync("database/migrations/063_business_live_reset_schedules.sql","utf8");
const scheduler=fs.readFileSync("backend/src/business-live-reset-scheduler.mjs","utf8");
const server=fs.readFileSync("backend/server.mjs","utf8");
const clientApi=fs.readFileSync("assets/client-portal-api.js","utf8");
const adminApi=fs.readFileSync("assets/api-client.js","utf8");
const clientUi=fs.readFileSync("assets/client-live-finance.js","utf8");
const clientScheduleLoader=fs.readFileSync("assets/business-live-schedule-client.js","utf8");
const adminUi=fs.readFileSync("assets/live-finance.js","utf8");
const scheduleUi=fs.readFileSync("assets/business-live-schedule.js","utf8");
const buildStatic=fs.readFileSync("scripts/build-static.mjs","utf8");
const vercel=fs.readFileSync("vercel.json","utf8");

test("Business Live scheduled resets are persistent tenant-safe display baselines",()=>{
  assert.match(migration,/CREATE TABLE business_live_reset_schedules/);
  assert.match(migration,/scope IN \('platform','tenant'\)/);
  assert.match(migration,/interval_unit IN \('day','week','month'\)/);
  assert.match(migration,/interval_value BETWEEN 1 AND 3650/);
  assert.match(migration,/pgi_business_live_next_run/);
  assert.match(migration,/last_run_at/);
  assert.match(migration,/lease_until/);
  assert.doesNotMatch(migration,/\b(?:DROP|TRUNCATE)\b|DELETE\s+FROM/i);
  assert.match(migration,/never delete or rewrite accounting/i);
});

test("client and cockpit expose free day week month recurrence with date time and timezone",()=>{
  assert.match(clientScheduleLoader,/business-live-schedule\.js/);
  assert.match(clientScheduleLoader,/can_manage/);
  assert.match(adminUi,/business-live-schedule\.js/);
  for(const token of ["data-bl-value","data-bl-unit","data-bl-date","data-bl-time","data-bl-timezone"])assert.match(scheduleUi,new RegExp(token));
  assert.match(scheduleUi,/120 jours/);
  assert.match(scheduleUi,/tous les 1 mois|tous les 3 mois/i);
  assert.match(clientApi,/jackpotSchedule/);
  assert.match(clientApi,/saveJackpotSchedule/);
  assert.match(adminApi,/liveFinanceSchedule/);
  assert.match(adminApi,/saveLiveFinanceSchedule/);
  assert.match(buildStatic,/business-live-schedule-client\.js/);
  assert.match(buildStatic,/business-live-schedule\.js/);
  assert.match(buildStatic,/business-live-schedule\.css/);
});

test("scheduled reset API remains permissioned and isolated from official metrics",()=>{
  assert.match(server,/\/api\/v1\/customer\/jackpot\/reset-schedule/);
  assert.match(server,/CUSTOMER_JACKPOT_SCHEDULE_FORBIDDEN/);
  assert.match(server,/\/api\/v1\/dashboard\/live-finance\/reset-schedule/);
  assert.match(server,/requireRole\(actor,\["admin"\]\)/);
  assert.match(server,/\/api\/v1\/internal\/business-live\/reset-dispatch/);
  assert.match(server,/authorizeInternalCron/);
  assert.match(scheduler,/createCustomerJackpotReset/);
  assert.match(scheduler,/createPlatformJackpotReset/);
  assert.doesNotMatch(scheduler,/DELETE\s+FROM\s+calls|TRUNCATE|UPDATE\s+calls/i);
});

test("Vercel checks due schedules without deploying feature branches",()=>{
  const cfg=JSON.parse(vercel);
  assert.equal(cfg.git.deploymentEnabled["**"],false);
  assert.equal(cfg.git.deploymentEnabled.main,true);
  const cron=cfg.crons.find(x=>x.path==="/api/v1/internal/business-live/reset-dispatch");
  assert.ok(cron);
  assert.equal(cron.schedule,"*/5 * * * *");
});
