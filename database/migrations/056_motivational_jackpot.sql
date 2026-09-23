-- PGI Telecom — independent motivational jackpot baseline.
-- Non-destructive: this only changes the visible jackpot epoch. CDRs, settlements,
-- revenue distributions and official dashboard metrics remain untouched.

ALTER TABLE metric_baselines DROP CONSTRAINT IF EXISTS metric_baselines_metric_key_check;
ALTER TABLE metric_baselines ADD CONSTRAINT metric_baselines_metric_key_check
  CHECK (metric_key IN ('all','calls','minutes','revenue','payout','quality','jackpot'));

CREATE INDEX IF NOT EXISTS live_call_financial_sessions_jackpot_idx
  ON live_call_financial_sessions(tenant_id,billable_started_at DESC)
  INCLUDE (ended_at,status,currency,net_client_rate_ht_per_min);

INSERT INTO metric_baselines(tenant_id,scope,metric_key,reason,effective_from)
SELECT t.id,'global','jackpot','Activation du jackpot personnel',now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM metric_baselines b
  WHERE b.tenant_id=t.id AND b.scope='global' AND b.metric_key='jackpot'
);

COMMENT ON COLUMN metric_baselines.metric_key IS
'Independent visible epoch: all, calls, minutes, revenue, payout, quality or jackpot. Jackpot resets are motivational only and never delete or alter accounting data.';
