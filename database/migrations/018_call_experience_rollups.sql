-- PGI Telecom — caller experience and degraded-network rollups.
-- Adds scalable wait/IVR/queue analytics without scanning full CDR history.

CREATE TABLE experience_rollups_hourly_sharded (
  bucket_start timestamptz NOT NULL,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  rollup_shard smallint NOT NULL CHECK (rollup_shard BETWEEN 0 AND 63),
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  calls_abandoned bigint NOT NULL DEFAULT 0,
  wait_seconds_sum bigint NOT NULL DEFAULT 0,
  wait_connected_seconds_sum bigint NOT NULL DEFAULT 0,
  wait_abandoned_seconds_sum bigint NOT NULL DEFAULT 0,
  answered_le_20s bigint NOT NULL DEFAULT 0,
  abandoned_le_10s bigint NOT NULL DEFAULT 0,
  ivr_seconds_sum bigint NOT NULL DEFAULT 0,
  ivr_samples bigint NOT NULL DEFAULT 0,
  queue_seconds_sum bigint NOT NULL DEFAULT 0,
  queue_samples bigint NOT NULL DEFAULT 0,
  wait_le_10s bigint NOT NULL DEFAULT 0,
  wait_10_20s bigint NOT NULL DEFAULT 0,
  wait_20_30s bigint NOT NULL DEFAULT 0,
  wait_30_60s bigint NOT NULL DEFAULT 0,
  wait_60_120s bigint NOT NULL DEFAULT 0,
  wait_gt_120s bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start,market_id,rollup_shard)
);

CREATE INDEX experience_rollups_market_time_idx
  ON experience_rollups_hourly_sharded(market_id,bucket_start DESC);
CREATE INDEX experience_rollups_time_brin
  ON experience_rollups_hourly_sharded USING brin(bucket_start);

INSERT INTO experience_rollups_hourly_sharded(
  bucket_start,market_id,rollup_shard,calls_total,calls_connected,calls_abandoned,
  wait_seconds_sum,wait_connected_seconds_sum,wait_abandoned_seconds_sum,
  answered_le_20s,abandoned_le_10s,ivr_seconds_sum,ivr_samples,queue_seconds_sum,queue_samples,
  wait_le_10s,wait_10_20s,wait_20_30s,wait_30_60s,wait_60_120s,wait_gt_120s,updated_at
)
SELECT
  date_trunc('hour',c.started_at),
  c.market_id,
  (c.tenant_bucket%64)::smallint,
  count(*)::bigint,
  count(*) FILTER(WHERE c.call_status='connected')::bigint,
  count(*) FILTER(WHERE c.call_status='abandoned')::bigint,
  COALESCE(sum(c.wait_seconds),0)::bigint,
  COALESCE(sum(c.wait_seconds) FILTER(WHERE c.call_status='connected'),0)::bigint,
  COALESCE(sum(c.wait_seconds) FILTER(WHERE c.call_status='abandoned'),0)::bigint,
  count(*) FILTER(WHERE c.call_status='connected' AND c.wait_seconds<=20)::bigint,
  count(*) FILTER(WHERE c.call_status='abandoned' AND c.wait_seconds<=10)::bigint,
  COALESCE(sum(GREATEST(0,EXTRACT(EPOCH FROM (c.queued_at-c.ivr_started_at)))::bigint)
    FILTER(WHERE c.queued_at IS NOT NULL AND c.ivr_started_at IS NOT NULL),0)::bigint,
  count(*) FILTER(WHERE c.queued_at IS NOT NULL AND c.ivr_started_at IS NOT NULL)::bigint,
  COALESCE(sum(GREATEST(0,EXTRACT(EPOCH FROM (COALESCE(c.bridged_at,c.ended_at)-c.queued_at)))::bigint)
    FILTER(WHERE c.queued_at IS NOT NULL),0)::bigint,
  count(*) FILTER(WHERE c.queued_at IS NOT NULL)::bigint,
  count(*) FILTER(WHERE c.wait_seconds<=10)::bigint,
  count(*) FILTER(WHERE c.wait_seconds>10 AND c.wait_seconds<=20)::bigint,
  count(*) FILTER(WHERE c.wait_seconds>20 AND c.wait_seconds<=30)::bigint,
  count(*) FILTER(WHERE c.wait_seconds>30 AND c.wait_seconds<=60)::bigint,
  count(*) FILTER(WHERE c.wait_seconds>60 AND c.wait_seconds<=120)::bigint,
  count(*) FILTER(WHERE c.wait_seconds>120)::bigint,
  now()
FROM calls c
WHERE c.market_id IS NOT NULL
GROUP BY date_trunc('hour',c.started_at),c.market_id,(c.tenant_bucket%64)::smallint
ON CONFLICT(bucket_start,market_id,rollup_shard) DO UPDATE SET
  calls_total=EXCLUDED.calls_total,
  calls_connected=EXCLUDED.calls_connected,
  calls_abandoned=EXCLUDED.calls_abandoned,
  wait_seconds_sum=EXCLUDED.wait_seconds_sum,
  wait_connected_seconds_sum=EXCLUDED.wait_connected_seconds_sum,
  wait_abandoned_seconds_sum=EXCLUDED.wait_abandoned_seconds_sum,
  answered_le_20s=EXCLUDED.answered_le_20s,
  abandoned_le_10s=EXCLUDED.abandoned_le_10s,
  ivr_seconds_sum=EXCLUDED.ivr_seconds_sum,
  ivr_samples=EXCLUDED.ivr_samples,
  queue_seconds_sum=EXCLUDED.queue_seconds_sum,
  queue_samples=EXCLUDED.queue_samples,
  wait_le_10s=EXCLUDED.wait_le_10s,
  wait_10_20s=EXCLUDED.wait_10_20s,
  wait_20_30s=EXCLUDED.wait_20_30s,
  wait_30_60s=EXCLUDED.wait_30_60s,
  wait_60_120s=EXCLUDED.wait_60_120s,
  wait_gt_120s=EXCLUDED.wait_gt_120s,
  updated_at=now();

ALTER TABLE quality_rollups_hourly_sharded
  ADD COLUMN affected_samples bigint NOT NULL DEFAULT 0,
  ADD COLUMN low_mos_samples bigint NOT NULL DEFAULT 0;

WITH q AS (
  SELECT
    date_trunc('hour',c.started_at) AS bucket_start,
    c.market_id,
    (c.tenant_bucket%64)::smallint AS rollup_shard,
    count(*) FILTER(
      WHERE COALESCE(q.rtp_packet_loss_percent,0)>=5
         OR COALESCE(q.jitter_ms,0)>5
         OR COALESCE(q.latency_ms,0)>150
    )::bigint AS affected_samples,
    count(*) FILTER(WHERE q.mos IS NOT NULL AND q.mos<3.5)::bigint AS low_mos_samples
  FROM calls c
  JOIN call_quality q ON q.call_id=c.id
  WHERE c.market_id IS NOT NULL
  GROUP BY date_trunc('hour',c.started_at),c.market_id,(c.tenant_bucket%64)::smallint
)
UPDATE quality_rollups_hourly_sharded r
SET affected_samples=q.affected_samples,
    low_mos_samples=q.low_mos_samples,
    updated_at=now()
FROM q
WHERE r.bucket_start=q.bucket_start
  AND r.market_id=q.market_id
  AND r.rollup_shard=q.rollup_shard;
