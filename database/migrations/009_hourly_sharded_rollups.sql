-- PGI Telecom — sharded hourly operational rollups.
-- Keeps long-range dashboards bounded even when call_facts contains very large histories.

CREATE TABLE platform_rollups_hourly_sharded (
  bucket_start timestamptz NOT NULL,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rollup_shard smallint NOT NULL CHECK (rollup_shard BETWEEN 0 AND 63),
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  calls_abandoned bigint NOT NULL DEFAULT 0,
  calls_failed bigint NOT NULL DEFAULT 0,
  conversation_seconds bigint NOT NULL DEFAULT 0,
  billable_seconds bigint NOT NULL DEFAULT 0,
  payout_eligible_seconds bigint NOT NULL DEFAULT 0,
  generated_revenue_ttc numeric(22,6) NOT NULL DEFAULT 0,
  expected_payout_ht numeric(22,6) NOT NULL DEFAULT 0,
  confirmed_payout_ht numeric(22,6) NOT NULL DEFAULT 0,
  paid_payout_ht numeric(22,6) NOT NULL DEFAULT 0,
  expert_cost_ht numeric(22,6) NOT NULL DEFAULT 0,
  technical_cost_ht numeric(22,6) NOT NULL DEFAULT 0,
  estimated_margin_ht numeric(22,6) NOT NULL DEFAULT 0,
  reconciliation_variance_ht numeric(22,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start,market_id,currency,rollup_shard)
);

CREATE INDEX platform_rollups_hourly_market_time_idx
  ON platform_rollups_hourly_sharded(market_id,bucket_start DESC,currency);
CREATE INDEX platform_rollups_hourly_time_idx
  ON platform_rollups_hourly_sharded(bucket_start DESC,market_id);
CREATE INDEX platform_rollups_hourly_brin
  ON platform_rollups_hourly_sharded USING brin(bucket_start);
