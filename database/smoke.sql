\set ON_ERROR_STOP on
BEGIN;

INSERT INTO carriers(name,kind) VALUES
  ('Test SVA Host','sva_host'),
  ('Test Origin','origin_network');

INSERT INTO sva_numbers(e164,display_number,tariff_code,service_rate_ttc_per_min,status,carrier_name)
VALUES ('33890000000','0890 00 00 00','D080',0.800000,'active','Test SVA Host');

INSERT INTO experts(code,display_name,status,compensation_type,compensation_rate)
VALUES ('TEST01','Expert Test','available','per_minute',0.180000);

INSERT INTO callers(caller_hash,caller_masked,first_seen_at,last_seen_at,call_count,total_conversation_seconds)
VALUES (repeat('a',64),'06 •• •• 00 01',now(),now(),1,600);

INSERT INTO calls(
  external_call_id,caller_id,sva_number_id,expert_id,origin_carrier_id,host_carrier_id,
  started_at,ivr_started_at,queued_at,bridged_at,ended_at,
  wait_seconds,conversation_seconds,total_seconds,billable_seconds,payout_eligible_seconds,
  call_status,sip_final_code,hangup_cause,codec,
  service_rate_ttc_per_min,carrier_rate_ht_per_min,
  retail_service_amount_ttc,expected_payout_ht,confirmed_payout_ht,
  expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_status,reconciliation_variance_ht
)
SELECT
  'test-call-001',cl.id,sn.id,e.id,oc.id,hc.id,
  now()-interval '12 minutes',now()-interval '11 minutes 58 seconds',now()-interval '11 minutes 50 seconds',
  now()-interval '11 minutes 40 seconds',now()-interval '1 minute 40 seconds',
  20,600,620,600,600,
  'connected',200,'NORMAL_CLEARING','PCMA',
  0.800000,0.460000,
  8.000000,4.600000,4.600000,
  1.800000,0.030000,2.770000,'matched',0
FROM callers cl,sva_numbers sn,experts e,carriers oc,carriers hc
WHERE cl.caller_hash=repeat('a',64)
  AND sn.e164='33890000000'
  AND e.code='TEST01'
  AND oc.name='Test Origin'
  AND hc.name='Test SVA Host';

INSERT INTO call_quality(call_id,rtp_packet_loss_percent,jitter_ms,latency_ms,mos)
SELECT id,0.1000,4.2,25.0,4.30 FROM calls WHERE external_call_id='test-call-001';

INSERT INTO raw_cdr_events(source,source_event_id,event_time,payload,payload_sha256)
VALUES ('smoke','event-001',now(),'{"call":"test-call-001"}'::jsonb,repeat('b',64));

INSERT INTO raw_cdr_events(source,source_event_id,event_time,payload,payload_sha256)
VALUES ('smoke','event-001',now(),'{"call":"test-call-001"}'::jsonb,repeat('b',64))
ON CONFLICT (source,source_event_id) DO NOTHING;

INSERT INTO financial_ledger(call_id,event_type,amount_ht,currency,source_reference)
SELECT id,'expected',4.600000,'EUR','smoke-expected' FROM calls WHERE external_call_id='test-call-001';

INSERT INTO financial_ledger(call_id,event_type,amount_ht,currency,source_reference)
SELECT id,'confirmed',4.600000,'EUR','smoke-confirmed' FROM calls WHERE external_call_id='test-call-001';

DO $$
DECLARE
  c bigint;
  d numeric;
BEGIN
  SELECT count(*) INTO c FROM raw_cdr_events WHERE source='smoke' AND source_event_id='event-001';
  IF c <> 1 THEN RAISE EXCEPTION 'CDR idempotency failed: %', c; END IF;

  SELECT expected_payout_ht INTO d FROM v_daily_metrics ORDER BY day DESC LIMIT 1;
  IF d IS NULL OR d < 4.6 THEN RAISE EXCEPTION 'daily metrics view failed: %', d; END IF;

  BEGIN
    UPDATE financial_ledger SET amount_ht=9 WHERE source_reference='smoke-expected';
    RAISE EXCEPTION 'ledger mutation unexpectedly allowed';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = 'ledger mutation unexpectedly allowed' THEN RAISE; END IF;
  END;
END $$;

ROLLBACK;
