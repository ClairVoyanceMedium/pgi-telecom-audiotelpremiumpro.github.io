import test from "node:test";
import assert from "node:assert/strict";
import {EventBus} from "../backend/src/event-bus.mjs";
import {PostgresStore} from "../backend/src/store-postgres.mjs";

const url=process.env.PGI_TEST_DATABASE_URL;
const run=Boolean(url);

function config(){
  return {
    mode:"production",databaseUrl:url,databasePoolMax:4,databaseSsl:"disable",
    callerHashKey:"k".repeat(32),requireCarrierContract:true,
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
    await store.sql.unsafe("INSERT INTO logical_carrier_routes(route_key,description) VALUES('sva-primary','Integration test route')");
    await store.sql.unsafe("INSERT INTO sva_numbers(e164,display_number,tariff_code,service_rate_ttc_per_min,status,tenant_id,market_id,currency) SELECT '33890000000','0890 00 00 00','D080',0.8,'active',t.id,m.id,'EUR' FROM tenants t CROSS JOIN operating_markets m WHERE t.slug='pgi-internal' AND m.country_code='FR'");
    await store.sql.unsafe("INSERT INTO carrier_contracts(carrier_id,sva_number_id,valid_from,payout_rate_ht_per_min,mobile_deduction_ht_per_min,minimum_payable_seconds,billing_increment_seconds,payout_rounding) SELECT c.id,s.id,'2026-01-01',0.55,0.05,60,30,'floor' FROM carriers c CROSS JOIN sva_numbers s WHERE c.name='Host A' AND s.e164='33890000000'");
    await store.sql.unsafe("INSERT INTO experts(code,display_name,destination_uri,status,compensation_type,compensation_rate,tenant_id) SELECT 'E1','Expert 1','loopback/9101','available','per_minute',0.18,id FROM tenants WHERE slug='pgi-internal'");
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
        caller_masked:"0612345678",
        caller_id_number:"0612345678",
        secret_field:"must-not-persist",
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
    assert.equal(calls.data[0].caller_masked,"•• •• •• 56 78");
    assert.equal(calls.data[0].service_rate_ttc_per_min,0.8);
    assert.equal(calls.data[0].carrier_rate_ht_per_min,0.55);
    assert.equal(calls.data[0].expected_payout_ht,5);
    assert.equal(calls.data[0].retail_service_amount_ttc,8);
    assert.equal(calls.data[0].expert_cost_ht,1.8);

    const rawPayload=await store.sql.unsafe(
      "SELECT payload ? 'caller_masked' AS has_caller_masked,"+
      " payload ? 'caller_hash' AS has_caller_hash,"+
      " payload ? 'caller_id_number' AS has_caller_id_number,"+
      " payload ? 'secret_field' AS has_secret_field"+
      " FROM raw_cdr_events WHERE source_event_id='evt-1'"
    );
    assert.equal(rawPayload.length,1);
    assert.equal(rawPayload[0].has_caller_masked,false);
    assert.equal(rawPayload[0].has_caller_hash,false);
    assert.equal(rawPayload[0].has_caller_id_number,false);
    assert.equal(rawPayload[0].has_secret_field,false);

    const expert=await store.selectExpert();
    assert.equal(expert.display_name,"Expert 1");

    const route=await store.carrierRouting();
    assert.equal(route.active_carrier,"Host A");

    const metrics=await store.metrics();
    assert.equal(metrics.calls_total,1);
    const migrations=await store.sql.unsafe("SELECT version,checksum FROM schema_migrations ORDER BY version");
    assert.equal(migrations.length,17);
    assert.equal(new Set(migrations.map(x=>x.version)).size,migrations.length);
    assert.equal(migrations[0].version,"001_baseline");
    assert.equal(migrations.at(-1).version,"017_quality_rollups");
    for(const migration of migrations)assert.match(migration.checksum,/^[a-f0-9]{64}$/);
  }finally{
    await store.close();
  }
});


test("PostgreSQL relay propagates realtime events across independent processes", {skip:!run}, async()=>{
  const busA=new EventBus();
  const busB=new EventBus();
  const storeA=await PostgresStore.connect(config(),busA);
  const storeB=await PostgresStore.connect(config(),busB);
  const received=[];

  try{
    await busA.attachPostgres(storeA.sql);
    await busB.attachPostgres(storeB.sql);
    busB.subscribe(event=>received.push(event));

    const sent=busA.publish("call.ingested",{id:987});
    const deadline=Date.now()+2000;
    while(received.length===0&&Date.now()<deadline){
      await new Promise(resolve=>setTimeout(resolve,20));
    }

    assert.equal(received.length,1);
    assert.equal(received[0].id,sent.id);
    assert.equal(received[0].type,"call.ingested");
    assert.deepEqual(received[0].payload,{id:987});
    assert.equal(busA.relayStatus.received,0);
    assert.equal(busB.relayStatus.received,1);
  }finally{
    await busA.close();
    await busB.close();
    await storeA.close();
    await storeB.close();
  }
});
