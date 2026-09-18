-- PGI Telecom — exact dashboard dimension rollups.
-- Keeps rich cockpit charts bounded when raw CDR volume becomes very large.

CREATE TABLE dashboard_dimension_rollups_daily (
  bucket_date date NOT NULL,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  dimension_type text NOT NULL
    CHECK (dimension_type IN ('expert','carrier','duration')),
  dimension_key text NOT NULL,
  dimension_label text NOT NULL,
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  conversation_seconds bigint NOT NULL DEFAULT 0,
  billable_seconds bigint NOT NULL DEFAULT 0,
  generated_revenue_ttc numeric(22,6) NOT NULL DEFAULT 0,
  expected_payout_ht numeric(22,6) NOT NULL DEFAULT 0,
  estimated_margin_ht numeric(22,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_date,market_id,currency,dimension_type,dimension_key)
);

CREATE INDEX dashboard_dimension_rollups_market_date_idx
  ON dashboard_dimension_rollups_daily(market_id,bucket_date DESC,dimension_type,currency);
CREATE INDEX dashboard_dimension_rollups_type_date_idx
  ON dashboard_dimension_rollups_daily(dimension_type,bucket_date DESC,dimension_key);

INSERT INTO dashboard_dimension_rollups_daily(
  bucket_date,market_id,currency,dimension_type,dimension_key,dimension_label,
  calls_total,calls_connected,conversation_seconds,billable_seconds,
  generated_revenue_ttc,expected_payout_ht,estimated_margin_ht,updated_at
)
SELECT
  f.started_at::date,f.market_id,f.currency,'expert',
  COALESCE(f.expert_id::text,'unassigned'),
  COALESCE(e.display_name,'Non affecté'),
  count(*)::bigint,
  count(*) FILTER(WHERE f.call_status='connected')::bigint,
  COALESCE(sum(f.conversation_seconds),0)::bigint,
  COALESCE(sum(f.billable_seconds),0)::bigint,
  COALESCE(sum(f.retail_service_amount_ttc),0),
  COALESCE(sum(f.expected_payout_ht),0),
  COALESCE(sum(f.estimated_margin_ht),0),
  now()
FROM call_facts f
LEFT JOIN experts e ON e.id=f.expert_id
WHERE f.market_id IS NOT NULL
GROUP BY f.started_at::date,f.market_id,f.currency,f.expert_id,e.display_name
ON CONFLICT(bucket_date,market_id,currency,dimension_type,dimension_key) DO UPDATE SET
  dimension_label=EXCLUDED.dimension_label,
  calls_total=EXCLUDED.calls_total,
  calls_connected=EXCLUDED.calls_connected,
  conversation_seconds=EXCLUDED.conversation_seconds,
  billable_seconds=EXCLUDED.billable_seconds,
  generated_revenue_ttc=EXCLUDED.generated_revenue_ttc,
  expected_payout_ht=EXCLUDED.expected_payout_ht,
  estimated_margin_ht=EXCLUDED.estimated_margin_ht,
  updated_at=now();

INSERT INTO dashboard_dimension_rollups_daily(
  bucket_date,market_id,currency,dimension_type,dimension_key,dimension_label,
  calls_total,calls_connected,conversation_seconds,billable_seconds,
  generated_revenue_ttc,expected_payout_ht,estimated_margin_ht,updated_at
)
SELECT
  f.started_at::date,f.market_id,f.currency,'carrier',
  COALESCE(f.origin_carrier_id::text,'unknown'),
  COALESCE(c.name,'Inconnu'),
  count(*)::bigint,
  count(*) FILTER(WHERE f.call_status='connected')::bigint,
  COALESCE(sum(f.conversation_seconds),0)::bigint,
  COALESCE(sum(f.billable_seconds),0)::bigint,
  COALESCE(sum(f.retail_service_amount_ttc),0),
  COALESCE(sum(f.expected_payout_ht),0),
  COALESCE(sum(f.estimated_margin_ht),0),
  now()
FROM call_facts f
LEFT JOIN carriers c ON c.id=f.origin_carrier_id
WHERE f.market_id IS NOT NULL
GROUP BY f.started_at::date,f.market_id,f.currency,f.origin_carrier_id,c.name
ON CONFLICT(bucket_date,market_id,currency,dimension_type,dimension_key) DO UPDATE SET
  dimension_label=EXCLUDED.dimension_label,
  calls_total=EXCLUDED.calls_total,
  calls_connected=EXCLUDED.calls_connected,
  conversation_seconds=EXCLUDED.conversation_seconds,
  billable_seconds=EXCLUDED.billable_seconds,
  generated_revenue_ttc=EXCLUDED.generated_revenue_ttc,
  expected_payout_ht=EXCLUDED.expected_payout_ht,
  estimated_margin_ht=EXCLUDED.estimated_margin_ht,
  updated_at=now();

INSERT INTO dashboard_dimension_rollups_daily(
  bucket_date,market_id,currency,dimension_type,dimension_key,dimension_label,
  calls_total,calls_connected,conversation_seconds,billable_seconds,
  generated_revenue_ttc,expected_payout_ht,estimated_margin_ht,updated_at
)
SELECT
  f.started_at::date,f.market_id,f.currency,'duration',
  CASE
    WHEN f.call_status<>'connected' THEN 'not_connected'
    WHEN f.conversation_seconds<60 THEN 'lt_1m'
    WHEN f.conversation_seconds<300 THEN '1_5m'
    WHEN f.conversation_seconds<600 THEN '5_10m'
    WHEN f.conversation_seconds<1200 THEN '10_20m'
    WHEN f.conversation_seconds<1800 THEN '20_30m'
    ELSE 'gte_30m'
  END,
  CASE
    WHEN f.call_status<>'connected' THEN 'Non aboutis'
    WHEN f.conversation_seconds<60 THEN '< 1 min'
    WHEN f.conversation_seconds<300 THEN '1–5 min'
    WHEN f.conversation_seconds<600 THEN '5–10 min'
    WHEN f.conversation_seconds<1200 THEN '10–20 min'
    WHEN f.conversation_seconds<1800 THEN '20–30 min'
    ELSE '30 min +'
  END,
  count(*)::bigint,
  count(*) FILTER(WHERE f.call_status='connected')::bigint,
  COALESCE(sum(f.conversation_seconds),0)::bigint,
  COALESCE(sum(f.billable_seconds),0)::bigint,
  COALESCE(sum(f.retail_service_amount_ttc),0),
  COALESCE(sum(f.expected_payout_ht),0),
  COALESCE(sum(f.estimated_margin_ht),0),
  now()
FROM call_facts f
WHERE f.market_id IS NOT NULL
GROUP BY
  f.started_at::date,f.market_id,f.currency,
  CASE
    WHEN f.call_status<>'connected' THEN 'not_connected'
    WHEN f.conversation_seconds<60 THEN 'lt_1m'
    WHEN f.conversation_seconds<300 THEN '1_5m'
    WHEN f.conversation_seconds<600 THEN '5_10m'
    WHEN f.conversation_seconds<1200 THEN '10_20m'
    WHEN f.conversation_seconds<1800 THEN '20_30m'
    ELSE 'gte_30m'
  END,
  CASE
    WHEN f.call_status<>'connected' THEN 'Non aboutis'
    WHEN f.conversation_seconds<60 THEN '< 1 min'
    WHEN f.conversation_seconds<300 THEN '1–5 min'
    WHEN f.conversation_seconds<600 THEN '5–10 min'
    WHEN f.conversation_seconds<1200 THEN '10–20 min'
    WHEN f.conversation_seconds<1800 THEN '20–30 min'
    ELSE '30 min +'
  END
ON CONFLICT(bucket_date,market_id,currency,dimension_type,dimension_key) DO UPDATE SET
  dimension_label=EXCLUDED.dimension_label,
  calls_total=EXCLUDED.calls_total,
  calls_connected=EXCLUDED.calls_connected,
  conversation_seconds=EXCLUDED.conversation_seconds,
  billable_seconds=EXCLUDED.billable_seconds,
  generated_revenue_ttc=EXCLUDED.generated_revenue_ttc,
  expected_payout_ht=EXCLUDED.expected_payout_ht,
  estimated_margin_ht=EXCLUDED.estimated_margin_ht,
  updated_at=now();
