-- PGI Telecom — active call financial telemetry for customer/admin live counters.
-- This table is an operational estimate only. Authoritative accounting remains the final CDR
-- plus the reconciled tenant revenue distribution.

CREATE TABLE live_call_financial_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_call_id text NOT NULL UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id bigint REFERENCES operating_markets(id),
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  billable_started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  origin_type text NOT NULL DEFAULT 'unknown' CHECK (origin_type IN ('fixed','mobile','unknown')),
  service_rate_ttc_per_min numeric(14,6) NOT NULL DEFAULT 0 CHECK (service_rate_ttc_per_min >= 0),
  upstream_payout_rate_ht_per_min numeric(14,6) NOT NULL DEFAULT 0 CHECK (upstream_payout_rate_ht_per_min >= 0),
  platform_fee_bps integer NOT NULL DEFAULT 0 CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  platform_fee_ht_per_min numeric(14,6) NOT NULL DEFAULT 0 CHECK (platform_fee_ht_per_min >= 0),
  net_client_rate_ht_per_min numeric(14,6) NOT NULL DEFAULT 0 CHECK (net_client_rate_ht_per_min >= 0),
  payout_terms_id bigint REFERENCES tenant_payout_terms(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at IS NULL OR ended_at >= billable_started_at)
);

CREATE INDEX live_call_financial_sessions_active_idx
  ON live_call_financial_sessions(status,tenant_id,market_id,billable_started_at)
  WHERE status='active';

CREATE VIEW tenant_scoped_live_call_financial_sessions
WITH (security_barrier=true)
AS
SELECT
  id,external_call_id,tenant_id,market_id,sva_number_id,currency,billable_started_at,ended_at,status,
  origin_type,service_rate_ttc_per_min,upstream_payout_rate_ht_per_min,
  platform_fee_bps,platform_fee_ht_per_min,net_client_rate_ht_per_min,payout_terms_id,
  created_at,updated_at
FROM live_call_financial_sessions
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE live_call_financial_sessions IS
'Operational live estimate for active calls. Never used as the authoritative settlement ledger; final CDR and reconciled distribution replace the estimate.';

COMMENT ON COLUMN live_call_financial_sessions.net_client_rate_ht_per_min IS
'Estimated live client net rate after the active PGI platform fee terms at call start.';
