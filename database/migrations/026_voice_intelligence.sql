-- PGI Telecom — voice intelligence, carrier health and NOC incident history.
-- Expand-only. Adds diagnostics inspired by carrier-grade voice observability without external paid services.

ALTER TABLE calls ADD COLUMN IF NOT EXISTS ringing_at timestamptz;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS post_dial_delay_ms integer CHECK (post_dial_delay_ms IS NULL OR post_dial_delay_ms>=0);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS hangup_party text CHECK (hangup_party IS NULL OR hangup_party IN ('caller','callee','network','unknown'));

ALTER TABLE call_quality ADD COLUMN IF NOT EXISTS rtt_ms numeric(10,3);
ALTER TABLE call_quality ADD COLUMN IF NOT EXISTS packets_lost bigint;

CREATE INDEX IF NOT EXISTS calls_host_carrier_started_idx ON calls(host_carrier_id,started_at DESC);
CREATE INDEX IF NOT EXISTS calls_sip_final_started_idx ON calls(sip_final_code,started_at DESC);
CREATE INDEX IF NOT EXISTS calls_pdd_started_idx ON calls(post_dial_delay_ms,started_at DESC) WHERE post_dial_delay_ms IS NOT NULL;

-- Backfill tenant daily rollups so production client dashboards become immediately useful
-- even when the hyperscale foundation predates runtime incremental writes.
INSERT INTO metric_rollups_daily_v2(
  tenant_bucket,bucket_date,tenant_id,market_id,currency,
  calls_total,calls_connected,calls_abandoned,calls_failed,
  conversation_seconds,billable_seconds,payout_eligible_seconds,
  generated_revenue_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,
  expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht,
  source_generation,updated_at
)
SELECT
  tenant_bucket,started_at::date,tenant_id,market_id,currency,
  count(*)::bigint,
  count(*) FILTER(WHERE call_status='connected')::bigint,
  count(*) FILTER(WHERE call_status='abandoned')::bigint,
  count(*) FILTER(WHERE call_status NOT IN ('connected','abandoned'))::bigint,
  COALESCE(sum(conversation_seconds),0)::bigint,
  COALESCE(sum(billable_seconds),0)::bigint,
  COALESCE(sum(payout_eligible_seconds),0)::bigint,
  COALESCE(sum(retail_service_amount_ttc),0),
  COALESCE(sum(expected_payout_ht),0),
  COALESCE(sum(confirmed_payout_ht),0),
  COALESCE(sum(paid_payout_ht),0),
  COALESCE(sum(expert_cost_ht),0),
  COALESCE(sum(technical_cost_ht),0),
  COALESCE(sum(estimated_margin_ht),0),
  COALESCE(sum(reconciliation_variance_ht),0),
  1,now()
FROM call_facts
WHERE tenant_id IS NOT NULL AND market_id IS NOT NULL
GROUP BY tenant_bucket,started_at::date,tenant_id,market_id,currency
ON CONFLICT(tenant_bucket,bucket_date,tenant_id,market_id,currency) DO UPDATE SET
  calls_total=EXCLUDED.calls_total,
  calls_connected=EXCLUDED.calls_connected,
  calls_abandoned=EXCLUDED.calls_abandoned,
  calls_failed=EXCLUDED.calls_failed,
  conversation_seconds=EXCLUDED.conversation_seconds,
  billable_seconds=EXCLUDED.billable_seconds,
  payout_eligible_seconds=EXCLUDED.payout_eligible_seconds,
  generated_revenue_ttc=EXCLUDED.generated_revenue_ttc,
  expected_payout_ht=EXCLUDED.expected_payout_ht,
  confirmed_payout_ht=EXCLUDED.confirmed_payout_ht,
  paid_payout_ht=EXCLUDED.paid_payout_ht,
  expert_cost_ht=EXCLUDED.expert_cost_ht,
  technical_cost_ht=EXCLUDED.technical_cost_ht,
  estimated_margin_ht=EXCLUDED.estimated_margin_ht,
  reconciliation_variance_ht=EXCLUDED.reconciliation_variance_ht,
  source_generation=metric_rollups_daily_v2.source_generation+1,
  updated_at=now();

CREATE TABLE IF NOT EXISTS voice_carrier_health_hourly_sharded (
  bucket_start timestamptz NOT NULL,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  carrier_role text NOT NULL CHECK (carrier_role IN ('origin','host')),
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  rollup_shard smallint NOT NULL CHECK (rollup_shard BETWEEN 0 AND 63),
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  calls_failed bigint NOT NULL DEFAULT 0,
  pdd_samples bigint NOT NULL DEFAULT 0,
  pdd_ms_sum bigint NOT NULL DEFAULT 0,
  high_pdd_calls bigint NOT NULL DEFAULT 0,
  quality_samples bigint NOT NULL DEFAULT 0,
  network_affected_calls bigint NOT NULL DEFAULT 0,
  low_mos_calls bigint NOT NULL DEFAULT 0,
  mos_sum numeric(22,6) NOT NULL DEFAULT 0,
  packet_loss_sum numeric(22,6) NOT NULL DEFAULT 0,
  jitter_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  latency_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  rtt_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  sip_4xx_calls bigint NOT NULL DEFAULT 0,
  sip_5xx_calls bigint NOT NULL DEFAULT 0,
  caller_hangups bigint NOT NULL DEFAULT 0,
  callee_hangups bigint NOT NULL DEFAULT 0,
  network_hangups bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket_start,market_id,carrier_role,carrier_id,rollup_shard)
);

CREATE INDEX IF NOT EXISTS voice_carrier_health_market_time_idx
  ON voice_carrier_health_hourly_sharded(market_id,bucket_start DESC,carrier_role);
CREATE INDEX IF NOT EXISTS voice_carrier_health_carrier_time_idx
  ON voice_carrier_health_hourly_sharded(carrier_role,carrier_id,bucket_start DESC);
CREATE INDEX IF NOT EXISTS voice_carrier_health_time_brin
  ON voice_carrier_health_hourly_sharded USING brin(bucket_start);

INSERT INTO voice_carrier_health_hourly_sharded(
  bucket_start,market_id,carrier_role,carrier_id,rollup_shard,
  calls_total,calls_connected,calls_failed,pdd_samples,pdd_ms_sum,high_pdd_calls,
  quality_samples,network_affected_calls,low_mos_calls,mos_sum,packet_loss_sum,jitter_ms_sum,latency_ms_sum,rtt_ms_sum,
  sip_4xx_calls,sip_5xx_calls,caller_hangups,callee_hangups,network_hangups,updated_at
)
SELECT
  date_trunc('hour',c.started_at),c.market_id,r.carrier_role,r.carrier_id,(c.tenant_bucket%64)::smallint,
  count(*)::bigint,
  count(*) FILTER(WHERE c.call_status='connected')::bigint,
  count(*) FILTER(WHERE c.call_status NOT IN ('connected','abandoned'))::bigint,
  count(*) FILTER(WHERE c.post_dial_delay_ms IS NOT NULL)::bigint,
  COALESCE(sum(c.post_dial_delay_ms) FILTER(WHERE c.post_dial_delay_ms IS NOT NULL),0)::bigint,
  count(*) FILTER(WHERE c.post_dial_delay_ms>8000)::bigint,
  count(q.call_id)::bigint,
  count(q.call_id) FILTER(WHERE COALESCE(q.rtp_packet_loss_percent,0)>=5 OR COALESCE(q.jitter_ms,0)>5 OR COALESCE(q.latency_ms,0)>150)::bigint,
  count(q.call_id) FILTER(WHERE q.mos IS NOT NULL AND q.mos<3.5)::bigint,
  COALESCE(sum(q.mos),0),COALESCE(sum(q.rtp_packet_loss_percent),0),COALESCE(sum(q.jitter_ms),0),COALESCE(sum(q.latency_ms),0),COALESCE(sum(q.rtt_ms),0),
  count(*) FILTER(WHERE c.sip_final_code BETWEEN 400 AND 499)::bigint,
  count(*) FILTER(WHERE c.sip_final_code BETWEEN 500 AND 599)::bigint,
  count(*) FILTER(WHERE c.hangup_party='caller')::bigint,
  count(*) FILTER(WHERE c.hangup_party='callee')::bigint,
  count(*) FILTER(WHERE c.hangup_party='network')::bigint,
  now()
FROM calls c
LEFT JOIN call_quality q ON q.call_id=c.id
CROSS JOIN LATERAL (
  VALUES ('origin'::text,c.origin_carrier_id),('host'::text,c.host_carrier_id)
) AS r(carrier_role,carrier_id)
WHERE c.market_id IS NOT NULL AND r.carrier_id IS NOT NULL
GROUP BY date_trunc('hour',c.started_at),c.market_id,r.carrier_role,r.carrier_id,(c.tenant_bucket%64)::smallint
ON CONFLICT(bucket_start,market_id,carrier_role,carrier_id,rollup_shard) DO UPDATE SET
  calls_total=EXCLUDED.calls_total,
  calls_connected=EXCLUDED.calls_connected,
  calls_failed=EXCLUDED.calls_failed,
  pdd_samples=EXCLUDED.pdd_samples,
  pdd_ms_sum=EXCLUDED.pdd_ms_sum,
  high_pdd_calls=EXCLUDED.high_pdd_calls,
  quality_samples=EXCLUDED.quality_samples,
  network_affected_calls=EXCLUDED.network_affected_calls,
  low_mos_calls=EXCLUDED.low_mos_calls,
  mos_sum=EXCLUDED.mos_sum,
  packet_loss_sum=EXCLUDED.packet_loss_sum,
  jitter_ms_sum=EXCLUDED.jitter_ms_sum,
  latency_ms_sum=EXCLUDED.latency_ms_sum,
  rtt_ms_sum=EXCLUDED.rtt_ms_sum,
  sip_4xx_calls=EXCLUDED.sip_4xx_calls,
  sip_5xx_calls=EXCLUDED.sip_5xx_calls,
  caller_hangups=EXCLUDED.caller_hangups,
  callee_hangups=EXCLUDED.callee_hangups,
  network_hangups=EXCLUDED.network_hangups,
  updated_at=now();

CREATE TABLE IF NOT EXISTS telecom_incidents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  carrier_role text CHECK (carrier_role IS NULL OR carrier_role IN ('origin','host')),
  carrier_id bigint REFERENCES carriers(id),
  market_id bigint REFERENCES operating_markets(id),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS telecom_incidents_open_unique
  ON telecom_incidents(incident_type,COALESCE(carrier_role,''),COALESCE(carrier_id,0),COALESCE(market_id,0))
  WHERE state='open';
CREATE INDEX IF NOT EXISTS telecom_incidents_time_idx ON telecom_incidents(started_at DESC);
CREATE INDEX IF NOT EXISTS telecom_incidents_state_idx ON telecom_incidents(state,last_detected_at DESC);

CREATE VIEW tenant_scoped_portal_call_details
WITH (security_barrier=true)
AS
SELECT
  c.id AS call_id,c.tenant_id,m.country_code AS market,c.currency,
  sn.id AS sva_number_id,sn.display_number,sn.e164,
  c.started_at,c.ringing_at,c.bridged_at,c.ended_at,c.call_status,
  c.wait_seconds,c.conversation_seconds,c.billable_seconds,
  c.retail_service_amount_ttc,c.sip_final_code,c.hangup_cause,c.hangup_party,c.codec,c.post_dial_delay_ms,
  oc.name AS origin_carrier,hc.name AS host_carrier,
  q.rtp_packet_loss_percent,q.jitter_ms,q.latency_ms,q.rtt_ms,q.mos,q.packets_in,q.packets_out,q.packets_lost,q.bytes_in,q.bytes_out,q.dtmf_errors
FROM calls c
JOIN sva_numbers sn ON sn.id=c.sva_number_id AND sn.tenant_id=c.tenant_id
LEFT JOIN operating_markets m ON m.id=c.market_id
LEFT JOIN carriers oc ON oc.id=c.origin_carrier_id
LEFT JOIN carriers hc ON hc.id=c.host_carrier_id
LEFT JOIN call_quality q ON q.call_id=c.id
WHERE c.tenant_id=pgi_require_tenant_context();
