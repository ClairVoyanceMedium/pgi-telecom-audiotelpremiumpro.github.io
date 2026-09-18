import test from "node:test";
import assert from "node:assert/strict";
import {EventBus} from "../backend/src/event-bus.mjs";
import {PostgresStore} from "../backend/src/store-postgres.mjs";

const url=process.env.PGI_TEST_DATABASE_URL;
const run=Boolean(url);

function config(){
  return {
    mode:"production",databaseUrl:url,databasePoolMax:4,databaseSsl:"disable",
    serviceRateTtcPerMin:.8,payoutRateHtPerMin:.46,expertCostHtPerMin:.18,
    reconciliationToleranceHt:.01
  };
}

test("PostgresStore performs real ingest summary and routing", {skip:!run}, async()=>{
  const bus=new EventBus();
  const store=await PostgresStore.connect(config(),bus);
  try{
    await store.sql.unsafe("TRUNCATE TABLE settlement_call_matches,carrier_settlements,call_quality,financial_ledger,outbox_events,raw_cdr_events,calls,callers,expert_presence_events,metric_baselines,carrier_switches,number_carrier_assignments,carrier_connections,carrier_adapters,carrier_contracts,number_portability_events,experts,sva_numbers,carriers,audit_log,api_idempotency_keys RESTART IDENTITY CASCADE");
    await store.sql.unsafe("INSERT INTO carriers(name,kind) VALUES('Host A','sva_host'),('Host B','sva_host')");
    await store.sql.unsafe("INSERT INTO sva_numbers(e164,display_number,tariff_code,service_rate_ttc_per_min,status) VALUES('33890000000','0890 00 00 00','D080',0.8,'active')");
    await store.sql.unsafe("INSERT INTO experts(code,display_name,status,compensation_type,compensation_rate) VALUES('E1','Expert 1','available','per_minute',0.18)");
    await store.sql.unsafe("INSERT INTO carrier_connections(carrier_id,connection_name,purpose,state,transport,endpoint_host,endpoint_port,auth_mode) SELECT id,'primary','sip_inbound','ready','udp','192.0.2.10',5060,'ip_acl' FROM carriers WHERE name='Host A'");
    await store.sql.unsafe("SELECT activate_logical_carrier_route('sva-primary',(SELECT id FROM carriers WHERE name='Host A'),(SELECT id FROM carrier_connections WHERE connection_name='primary'))");

    const envelope={
      source:"integration",
      source_event_id:"evt-1",
      payload:{
        external_call_id:"call-1",
        started_at:"2026-09-18T12:00:00Z",
        bridged_at:"2026-09-18T12:00:10Z",
        ended_at:"2026-09-18T12:10:10Z",
        conversation_seconds:600,
        total_seconds:610,
        call_status:"connected",
        caller_masked:"06 •• •• 00 01",
        origin_carrier:"Orange",
        origin_type:"mobile",
        sva_number:"33890000000",
        expert_id:1,
        sip_final_code:200
      }
    };
    const first=await store.ingestCdr(envelope);
    assert.equal(first.duplicate,false);
    const second=await store.ingestCdr(envelope);
    assert.equal(second.duplicate,true);

    const summary=await store.summary("2026-09-18T00:00:00Z","2026-09-19T00:00:00Z");
    assert.equal(summary.calls_total,1);
    assert.ok(summary.expected_payout_ht>0);

    const calls=await store.listCalls({limit:10});
    assert.equal(calls.data.length,1);
    assert.equal(calls.data[0].origin_carrier,"Orange");

    const expert=await store.selectExpert();
    assert.equal(expert.display_name,"Expert 1");

    const route=await store.carrierRouting();
    assert.equal(route.active_carrier,"Host A");

    const metrics=await store.metrics();
    assert.equal(metrics.calls_total,1);
  }finally{
    await store.close();
  }
});
