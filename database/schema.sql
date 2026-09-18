-- PGI Telecom • Audiotel Premium Pro
-- PostgreSQL production schema — v1
-- Aucun secret ni donnée réelle dans ce fichier.

BEGIN;

CREATE TABLE app_users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','finance','expert','readonly')),
  expert_id bigint,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE sva_numbers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  e164 text NOT NULL UNIQUE,
  display_number text NOT NULL,
  tariff_code text NOT NULL DEFAULT 'D080',
  service_rate_ttc_per_min numeric(10,6) NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','active','porting','suspended','closed')),
  assigned_to_label text,
  carrier_name text,
  portability_status text,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carriers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('sva_host','origin_network','transit','other')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carrier_contracts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  sva_number_id bigint REFERENCES sva_numbers(id),
  valid_from date NOT NULL,
  valid_to date,
  payout_rate_ht_per_min numeric(10,6) NOT NULL,
  mobile_deduction_ht_per_min numeric(10,6) NOT NULL DEFAULT 0,
  minimum_payable_seconds integer NOT NULL DEFAULT 0 CHECK (minimum_payable_seconds >= 0),
  billing_increment_seconds integer NOT NULL DEFAULT 60 CHECK (billing_increment_seconds > 0),
  payout_rounding text NOT NULL DEFAULT 'contract' CHECK (payout_rounding IN ('contract','ceil','floor','nearest')),
  settlement_delay_days integer NOT NULL DEFAULT 60 CHECK (settlement_delay_days >= 0),
  fixed_monthly_fee_ht numeric(12,4) NOT NULL DEFAULT 0,
  setup_fee_ht numeric(12,4) NOT NULL DEFAULT 0,
  commitment_months integer NOT NULL DEFAULT 0 CHECK (commitment_months >= 0),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE TABLE experts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('available','busy','away','offline')),
  compensation_type text NOT NULL DEFAULT 'per_minute' CHECK (compensation_type IN ('per_minute','percentage','fixed','none')),
  compensation_rate numeric(12,6) NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_users
  ADD CONSTRAINT app_users_expert_fk FOREIGN KEY (expert_id) REFERENCES experts(id);

CREATE TABLE callers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  caller_hash char(64) NOT NULL UNIQUE,
  caller_masked text NOT NULL,
  caller_e164_encrypted bytea,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  call_count integer NOT NULL DEFAULT 0,
  total_conversation_seconds bigint NOT NULL DEFAULT 0,
  retention_class text NOT NULL DEFAULT 'standard',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_call_id text UNIQUE,
  cdr_source text NOT NULL DEFAULT 'freeswitch',
  caller_id bigint REFERENCES callers(id),
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  expert_id bigint REFERENCES experts(id),
  origin_carrier_id bigint REFERENCES carriers(id),
  host_carrier_id bigint REFERENCES carriers(id),

  started_at timestamptz NOT NULL,
  ivr_started_at timestamptz,
  queued_at timestamptz,
  bridged_at timestamptz,
  ended_at timestamptz NOT NULL,

  wait_seconds integer NOT NULL DEFAULT 0 CHECK (wait_seconds >= 0),
  conversation_seconds integer NOT NULL DEFAULT 0 CHECK (conversation_seconds >= 0),
  total_seconds integer NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  billable_seconds integer NOT NULL DEFAULT 0 CHECK (billable_seconds >= 0),
  payout_eligible_seconds integer NOT NULL DEFAULT 0 CHECK (payout_eligible_seconds >= 0),

  call_status text NOT NULL CHECK (call_status IN ('connected','abandoned','failed','rejected','busy','cancelled')),
  sip_final_code integer,
  hangup_cause text,
  codec text,

  service_rate_ttc_per_min numeric(10,6) NOT NULL,
  carrier_rate_ht_per_min numeric(10,6) NOT NULL DEFAULT 0,
  mobile_deduction_ht_per_min numeric(10,6) NOT NULL DEFAULT 0,

  retail_service_amount_ttc numeric(14,6) NOT NULL DEFAULT 0,
  expected_payout_ht numeric(14,6) NOT NULL DEFAULT 0,
  confirmed_payout_ht numeric(14,6),
  expert_cost_ht numeric(14,6) NOT NULL DEFAULT 0,
  technical_cost_ht numeric(14,6) NOT NULL DEFAULT 0,
  estimated_margin_ht numeric(14,6) NOT NULL DEFAULT 0,

  reconciliation_status text NOT NULL DEFAULT 'pending'
    CHECK (reconciliation_status IN ('pending','matched','variance','excluded','manual_review')),
  reconciliation_variance_ht numeric(14,6) NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (ended_at >= started_at)
);

CREATE INDEX calls_started_at_idx ON calls(started_at DESC);
CREATE INDEX calls_expert_started_idx ON calls(expert_id, started_at DESC);
CREATE INDEX calls_origin_carrier_started_idx ON calls(origin_carrier_id, started_at DESC);
CREATE INDEX calls_status_started_idx ON calls(call_status, started_at DESC);
CREATE INDEX calls_reconciliation_idx ON calls(reconciliation_status, started_at DESC);
CREATE INDEX calls_caller_idx ON calls(caller_id, started_at DESC);

CREATE TABLE call_quality (
  call_id bigint PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  rtp_packet_loss_percent numeric(7,4),
  jitter_ms numeric(10,3),
  latency_ms numeric(10,3),
  mos numeric(5,3),
  packets_in bigint,
  packets_out bigint,
  bytes_in bigint,
  bytes_out bigint,
  dtmf_errors integer NOT NULL DEFAULT 0,
  sampled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carrier_settlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  statement_reference text,
  invoice_reference text,
  expected_amount_ht numeric(16,6) NOT NULL DEFAULT 0,
  confirmed_amount_ht numeric(16,6) NOT NULL DEFAULT 0,
  paid_amount_ht numeric(16,6) NOT NULL DEFAULT 0,
  payment_due_date date,
  paid_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reconciled','invoiced','paid','disputed')),
  source_file_hash char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX carrier_settlement_period_unique
  ON carrier_settlements(carrier_id, period_start, period_end);

CREATE TABLE settlement_call_matches (
  settlement_id bigint NOT NULL REFERENCES carrier_settlements(id) ON DELETE CASCADE,
  call_id bigint NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  carrier_amount_ht numeric(14,6) NOT NULL,
  matched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (settlement_id, call_id)
);

CREATE TABLE metric_baselines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint REFERENCES app_users(id),
  scope text NOT NULL CHECK (scope IN ('global','expert','sva_number')),
  scope_id bigint,
  reason text,
  effective_from timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX metric_baselines_scope_idx ON metric_baselines(scope, scope_id, effective_from DESC);

CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id bigint REFERENCES app_users(id),
  action text NOT NULL,
  entity_type text,
  entity_id text,
  request_id text,
  ip_hash char(64),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_log_time_idx ON audit_log(occurred_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id, occurred_at DESC);

CREATE TABLE raw_cdr_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  source_event_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  event_time timestamptz,
  payload jsonb NOT NULL,
  payload_sha256 char(64) NOT NULL,
  processed_at timestamptz,
  processing_status text NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending','processed','rejected','duplicate','manual_review')),
  processing_error text,
  UNIQUE (source, source_event_id)
);

CREATE INDEX raw_cdr_events_pending_idx
  ON raw_cdr_events(processing_status, received_at)
  WHERE processing_status IN ('pending','manual_review');

CREATE TABLE financial_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  call_id bigint REFERENCES calls(id),
  settlement_id bigint REFERENCES carrier_settlements(id),
  event_type text NOT NULL
    CHECK (event_type IN ('expected','confirmed','paid','adjustment','reversal','fee')),
  amount_ht numeric(16,6) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'EUR',
  source_reference text,
  source_hash char(64),
  reason text,
  created_by bigint REFERENCES app_users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (amount_ht <> 0 OR event_type = 'expected')
);

CREATE INDEX financial_ledger_call_idx ON financial_ledger(call_id, occurred_at);
CREATE INDEX financial_ledger_settlement_idx ON financial_ledger(settlement_id, occurred_at);
CREATE INDEX financial_ledger_type_time_idx ON financial_ledger(event_type, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  RAISE EXCEPTION 'financial_ledger is append-only';
END;
$;

CREATE TRIGGER financial_ledger_no_update
BEFORE UPDATE OR DELETE ON financial_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$;

CREATE TRIGGER calls_touch_updated_at
BEFORE UPDATE ON calls
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE calls
  ADD CONSTRAINT calls_financial_nonnegative
  CHECK (
    retail_service_amount_ttc >= 0 AND
    expected_payout_ht >= 0 AND
    (confirmed_payout_ht IS NULL OR confirmed_payout_ht >= 0) AND
    expert_cost_ht >= 0 AND
    technical_cost_ht >= 0
  ),
  ADD CONSTRAINT calls_timeline_consistent
  CHECK (
    (ivr_started_at IS NULL OR ivr_started_at >= started_at) AND
    (queued_at IS NULL OR queued_at >= started_at) AND
    (bridged_at IS NULL OR bridged_at >= started_at) AND
    ended_at >= COALESCE(bridged_at, queued_at, ivr_started_at, started_at)
  ),
  ADD CONSTRAINT calls_connected_has_bridge
  CHECK (call_status <> 'connected' OR bridged_at IS NOT NULL),
  ADD CONSTRAINT calls_conversation_not_over_total
  CHECK (conversation_seconds <= total_seconds);

ALTER TABLE call_quality
  ADD CONSTRAINT call_quality_ranges
  CHECK (
    (rtp_packet_loss_percent IS NULL OR (rtp_packet_loss_percent >= 0 AND rtp_packet_loss_percent <= 100)) AND
    (jitter_ms IS NULL OR jitter_ms >= 0) AND
    (latency_ms IS NULL OR latency_ms >= 0) AND
    (mos IS NULL OR (mos >= 1 AND mos <= 5)) AND
    (dtmf_errors >= 0)
  );

CREATE TABLE system_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  measured_at timestamptz NOT NULL,
  component text NOT NULL,
  metric text NOT NULL,
  value numeric(18,6),
  unit text,
  status text,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX system_metrics_lookup_idx ON system_metrics(component, metric, measured_at DESC);

CREATE TABLE expert_presence_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  expert_id bigint NOT NULL REFERENCES experts(id),
  status text NOT NULL CHECK (status IN ('available','busy','away','offline')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'app'
);

CREATE INDEX expert_presence_events_idx ON expert_presence_events(expert_id, occurred_at DESC);

COMMIT;
