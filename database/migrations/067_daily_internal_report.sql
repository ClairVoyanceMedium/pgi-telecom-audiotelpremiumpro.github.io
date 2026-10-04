-- PGI Telecom : durable daily internal operations report ledger.
-- One report per Europe/Paris calendar day. Aggregate snapshots contain no message body, raw caller identity or payment-card data.

CREATE TABLE platform_daily_reports (
  report_date date PRIMARY KEY,
  timezone text NOT NULL DEFAULT 'Europe/Paris' CHECK (timezone='Europe/Paris'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  provider_email_id text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state<>'sent' OR sent_at IS NOT NULL)
);

CREATE INDEX platform_daily_reports_state_idx
  ON platform_daily_reports(state,report_date DESC);

COMMENT ON TABLE platform_daily_reports IS
'Idempotent internal 20:00 Europe/Paris daily report ledger. Aggregate operational counters only.';
