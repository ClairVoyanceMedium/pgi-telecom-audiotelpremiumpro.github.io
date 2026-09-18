-- Aggregation views for PGI Telecom • Audiotel Premium Pro

CREATE OR REPLACE VIEW v_daily_metrics AS
SELECT
  date_trunc('day', started_at) AS day,
  count(*) AS calls_total,
  count(*) FILTER (WHERE call_status='connected') AS calls_connected,
  count(*) FILTER (WHERE call_status='abandoned') AS calls_abandoned,
  coalesce(sum(billable_seconds),0) AS billable_seconds,
  coalesce(sum(payout_eligible_seconds),0) AS payout_eligible_seconds,
  coalesce(sum(retail_service_amount_ttc),0) AS generated_revenue_ttc,
  coalesce(sum(expected_payout_ht),0) AS expected_payout_ht,
  coalesce(sum(confirmed_payout_ht),0) AS confirmed_payout_ht,
  coalesce(sum(expert_cost_ht),0) AS expert_cost_ht,
  coalesce(sum(technical_cost_ht),0) AS technical_cost_ht,
  coalesce(sum(estimated_margin_ht),0) AS estimated_margin_ht,
  coalesce(sum(reconciliation_variance_ht),0) AS reconciliation_variance_ht,
  avg(conversation_seconds) FILTER (WHERE call_status='connected') AS acd_seconds
FROM calls
GROUP BY 1;

CREATE OR REPLACE VIEW v_expert_metrics AS
SELECT
  expert_id,
  date_trunc('day', started_at) AS day,
  count(*) AS calls_total,
  count(*) FILTER (WHERE call_status='connected') AS calls_connected,
  coalesce(sum(conversation_seconds),0) AS conversation_seconds,
  coalesce(sum(billable_seconds),0) AS billable_seconds,
  coalesce(sum(expected_payout_ht),0) AS expected_payout_ht,
  coalesce(sum(expert_cost_ht),0) AS expert_cost_ht,
  coalesce(sum(estimated_margin_ht),0) AS estimated_margin_ht,
  avg(conversation_seconds) FILTER (WHERE call_status='connected') AS acd_seconds
FROM calls
GROUP BY expert_id, date_trunc('day', started_at);

CREATE OR REPLACE VIEW v_carrier_reconciliation AS
SELECT
  origin_carrier_id,
  date_trunc('day', started_at) AS day,
  count(*) AS calls_total,
  coalesce(sum(expected_payout_ht),0) AS expected_payout_ht,
  coalesce(sum(confirmed_payout_ht),0) AS confirmed_payout_ht,
  coalesce(sum(reconciliation_variance_ht),0) AS variance_ht,
  count(*) FILTER (WHERE reconciliation_status='variance') AS variance_calls
FROM calls
GROUP BY origin_carrier_id, date_trunc('day', started_at);
