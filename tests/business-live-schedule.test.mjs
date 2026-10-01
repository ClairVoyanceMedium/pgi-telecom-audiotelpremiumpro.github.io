import test from "node:test";
import assert from "node:assert/strict";
import {normalizeBusinessLiveSchedule,nextBusinessLiveRun} from "../backend/src/business-live-schedule.mjs";

test("Business Live daily schedule respects Europe/Paris wall clock",()=>{
  const next=nextBusinessLiveRun({enabled:true,frequency:"daily",time:"09:00",timezone:"Europe/Paris"},new Date("2026-10-01T06:00:00Z"));
  assert.equal(next.toISOString(),"2026-10-01T07:00:00.000Z");
});

test("Business Live weekly schedule can target Monday 09:00",()=>{
  const next=nextBusinessLiveRun({enabled:true,frequency:"weekly",weekday:1,time:"09:00",timezone:"Europe/Paris"},new Date("2026-10-01T15:00:00Z"));
  assert.equal(next.toISOString(),"2026-10-05T07:00:00.000Z");
});

test("Business Live monthly day clamps to the last day of shorter months",()=>{
  const next=nextBusinessLiveRun({enabled:true,frequency:"monthly",month_day:31,time:"09:00",timezone:"Europe/Paris"},new Date("2027-02-01T00:00:00Z"));
  assert.equal(next.toISOString(),"2027-02-28T08:00:00.000Z");
});

test("Business Live arbitrary day interval supports 120-day cadence",()=>{
  const next=nextBusinessLiveRun({enabled:true,frequency:"interval_days",interval_days:120,anchor_date:"2026-10-01",time:"09:00",timezone:"Europe/Paris"},new Date("2026-10-02T00:00:00Z"));
  assert.equal(next.toISOString(),"2027-01-29T08:00:00.000Z");
});

test("Business Live schedule validation rejects invalid cadence",()=>{
  assert.throws(()=>normalizeBusinessLiveSchedule({frequency:"interval_days",interval_days:0,time:"09:00",timezone:"Europe/Paris"}),e=>e.code==="BUSINESS_LIVE_INTERVAL_INVALID");
});
