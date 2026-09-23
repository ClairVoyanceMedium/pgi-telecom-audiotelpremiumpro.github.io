-- PGI Telecom — independent motivational jackpot baseline.
-- Expand-only and non-destructive: jackpot display state is isolated from official
-- dashboard metrics, CDRs, settlements and revenue distributions.

CREATE TABLE customer_jackpot_baselines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  effective_from timestamptz NOT NULL DEFAULT now(),
  reason text,
  created_by_customer_principal_id uuid REFERENCES customer_principals(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_jackpot_baselines_tenant_time_idx
  ON customer_jackpot_baselines(tenant_id,effective_from DESC,id DESC);

CREATE INDEX IF NOT EXISTS live_call_financial_sessions_jackpot_idx
  ON live_call_financial_sessions(tenant_id,billable_started_at DESC)
  INCLUDE (ended_at,status,currency,net_client_rate_ht_per_min);

INSERT INTO customer_jackpot_baselines(tenant_id,reason,effective_from)
SELECT t.id,'Activation du jackpot personnel',now()
FROM tenants t;

COMMENT ON TABLE customer_jackpot_baselines IS
'Motivational jackpot reset epochs only. These rows never delete or alter accounting data, CDRs, settlements, revenue distributions or official dashboard metrics.';
