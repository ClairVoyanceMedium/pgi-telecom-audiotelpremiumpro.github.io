import test from "node:test";
import assert from "node:assert/strict";
import {MemoryStore} from "../backend/src/store-memory.mjs";
import {EventBus} from "../backend/src/event-bus.mjs";

function config(){
  return {
    mode:"simulator",
    serviceRateTtcPerMin:.8,
    payoutRateHtPerMin:.46,
    expertCostHtPerMin:.18,
    reconciliationToleranceHt:.01,
    technicalCostHtPerCall:.03
  };
}

test("live financial session grows while active and stops cleanly",async()=>{
  const bus=new EventBus(),events=[];
  const unsubscribe=bus.subscribe(event=>events.push(event));
  const store=new MemoryStore(config(),bus);
  const startedAt=new Date(Date.now()-60000).toISOString();

  const session=await store.startLiveCallFinancial({
    external_call_id:"live-test-1",
    sva_number:"089 TEST",
    billable_started_at:startedAt,
    origin_type:"fixed"
  });
  assert.equal(session.status,"active");
  assert.equal(session.currency,"EUR");
  assert.ok(session.net_client_rate_ht_per_min>0);
  assert.ok(session.net_client_rate_ht_per_min<session.upstream_payout_rate_ht_per_min);

  const snapshot=await store.liveFinancialSnapshot();
  assert.equal(snapshot.active_calls,1);
  assert.equal(snapshot.currency_count,1);
  assert.equal(snapshot.by_currency[0].currency,"EUR");
  assert.ok(snapshot.by_currency[0].estimated_upstream_payout_ht>.40);
  assert.ok(snapshot.by_currency[0].estimated_client_net_ht>0);
  assert.ok(snapshot.by_currency[0].estimated_client_net_ht<snapshot.by_currency[0].estimated_upstream_payout_ht);
  assert.ok(snapshot.by_currency[0].client_rate_ht_per_second>0);

  const stopped=await store.stopLiveCallFinancial("live-test-1","ended");
  assert.equal(stopped.status,"ended");
  assert.equal((await store.liveFinancialSnapshot()).active_calls,0);
  assert.ok(events.some(event=>event.type==="live_call.started"&&event.payload.tenant_id===1));
  assert.ok(events.some(event=>event.type==="live_call.ended"&&event.payload.tenant_id===1));
  unsubscribe();
});

test("final CDR closes a live estimate and publishes tenant-scoped events",async()=>{
  const bus=new EventBus(),events=[];
  bus.subscribe(event=>events.push(event));
  const store=new MemoryStore(config(),bus);
  const started=new Date(Date.now()-120000);
  const ended=new Date(Date.now()-1000);

  await store.startLiveCallFinancial({
    external_call_id:"live-test-cdr",
    sva_number:"089 TEST",
    billable_started_at:started.toISOString(),
    origin_type:"fixed"
  });
  const result=await store.ingestCdr({
    source:"test",
    source_event_id:"event-live-test-cdr",
    event_time:ended.toISOString(),
    payload:{
      external_call_id:"live-test-cdr",
      started_at:started.toISOString(),
      bridged_at:started.toISOString(),
      ended_at:ended.toISOString(),
      conversation_seconds:119,
      total_seconds:119,
      call_status:"connected",
      origin_type:"fixed",
      sva_number:"089 TEST",
      caller_masked:"0612345678"
    }
  });

  assert.equal(result.duplicate,false);
  assert.equal((await store.liveFinancialSnapshot()).active_calls,0);
  assert.ok(events.some(event=>event.type==="live_call.ended"&&event.payload.source==="cdr"&&event.payload.tenant_id===1));
  assert.ok(events.some(event=>event.type==="call.ingested"&&event.payload.tenant_id===1));
});
