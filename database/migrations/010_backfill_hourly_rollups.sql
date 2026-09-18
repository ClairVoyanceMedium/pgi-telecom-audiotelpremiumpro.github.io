-- PGI Telecom — backfill hyperscale hourly rollups from the authoritative call facts.
-- Runs before the 1.13 API starts because production gates startup on all migrations succeeding.

INSERT INTO platform_rollups_hourly_sharded(
  bucket_start,market_id,currency,rollup_shard,
  calls_total,calls_connected,calls_abandoned,calls_failed,
  conversation_seconds,billable_seconds,payout_eligible_seconds,
  generated_revenue_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,
  expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht,updated_at
)
SELECT
  date_trunc('hour',f.started_at) AS bucket_start,
  f.market_id,
  f.currency,
  (f.tenant_bucket%64)::smallint AS rollup_shard,
  count(*)::bigint,
  count(*) FILTER(WHERE f.call_status='connected')::bigint,
  count(*) FILTER(WHERE f.call_status='abandoned')::bigint,
  count(*) FILTER(WHERE f.call_status NOT IN ('connected','abandoned'))::bigint,
  COALESCE(sum(f.conversation_seconds),0)::bigint,
  COALESCE(sum(f.billable_seconds),0)::bigint,
  COALESCE(sum(f.payout_eligible_seconds),0)::bigint,
  COALESCE(sum(f.retail_service_amount_ttc),0),
  COALESCE(sum(f.expected_payout_ht),0),
  COALESCE(sum(f.confirmed_payout_ht),0),
  COALESCE(sum(f.paid_payout_ht),0),
  COALESCE(sum(f.expert_cost_ht),0),
  COALESCE(sum(f.technical_cost_ht),0),
  COALESCE(sum(f.estimated_margin_ht),0),
  COALESCE(sum(f.reconciliation_variance_ht),0),
  now()
FROM call_facts f
WHERE f.market_id IS NOT NULL
GROUP BY
  date_trunc('hour',f.started_at),
  f.market_id,
  f.currency,
  (f.tenant_bucket%64)::smallint
ON CONFLICT(bucket_start,market_id,currency,rollup_shard) DO UPDATE SET
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
  updated_at=now();
