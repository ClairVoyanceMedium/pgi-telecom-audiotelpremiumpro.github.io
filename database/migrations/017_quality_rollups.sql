-- PGI Telecom — scalable RTP/voice quality rollups for the cockpit.

CREATE TABLE quality_rollups_hourly_sharded (
  bucket_start timestamptz NOT NULL,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  rollup_shard smallint NOT NULL CHECK (rollup_shard BETWEEN 0 AND 63),
  quality_samples bigint NOT NULL DEFAULT 0,
  mos_sum numeric(22,6) NOT NULL DEFAULT 0,
  packet_loss_sum numeric(22,6) NOT NULL DEFAULT 0,
  jitter_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  latency_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  dtmf_errors bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start,market_id,rollup_shard)
);

CREATE INDEX quality_rollups_market_time_idx
  ON quality_rollups_hourly_sharded(market_id,bucket_start DESC);
CREATE INDEX quality_rollups_time_brin
  ON quality_rollups_hourly_sharded USING brin(bucket_start);

INSERT INTO quality_rollups_hourly_sharded(
  bucket_start,market_id,rollup_shard,quality_samples,mos_sum,packet_loss_sum,
  jitter_ms_sum,latency_ms_sum,dtmf_errors,updated_at
)
SELECT
  date_trunc('hour',c.started_at),
  c.market_id,
  (c.tenant_bucket%64)::smallint,
  count(*)::bigint,
  COALESCE(sum(q.mos),0),
  COALESCE(sum(q.rtp_packet_loss_percent),0),
  COALESCE(sum(q.jitter_ms),0),
  COALESCE(sum(q.latency_ms),0),
  COALESCE(sum(q.dtmf_errors),0)::bigint,
  now()
FROM call_quality q
JOIN calls c ON c.id=q.call_id
WHERE c.market_id IS NOT NULL
GROUP BY date_trunc('hour',c.started_at),c.market_id,(c.tenant_bucket%64)::smallint
ON CONFLICT(bucket_start,market_id,rollup_shard) DO UPDATE SET
  quality_samples=EXCLUDED.quality_samples,
  mos_sum=EXCLUDED.mos_sum,
  packet_loss_sum=EXCLUDED.packet_loss_sum,
  jitter_ms_sum=EXCLUDED.jitter_ms_sum,
  latency_ms_sum=EXCLUDED.latency_ms_sum,
  dtmf_errors=EXCLUDED.dtmf_errors,
  updated_at=now();
