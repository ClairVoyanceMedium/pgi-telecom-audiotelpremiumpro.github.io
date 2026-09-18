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

CREATE TABLE number_portability_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  from_carrier_id bigint,
  to_carrier_id bigint,
  portability_reference text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz,
  activated_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','requested','confirmed','scheduled','activating','completed','failed','cancelled')),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text
);

CREATE INDEX number_portability_events_number_idx
  ON number_portability_events(sva_number_id, requested_at DESC);

CREATE OR REPLACE FUNCTION protect_active_sva_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  IF OLD.status IN ('active','porting')
     AND NEW.e164 IS DISTINCT FROM OLD.e164 THEN
    RAISE EXCEPTION 'active SVA number identity cannot be changed during carrier operations';
  END IF;
  RETURN NEW;
END;
$;

CREATE TRIGGER sva_numbers_protect_identity
BEFORE UPDATE ON sva_numbers
FOR EACH ROW EXECUTE FUNCTION protect_active_sva_identity();

CREATE TABLE carriers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('sva_host','origin_network','transit','other')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE carrier_adapters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  adapter_key text NOT NULL,
  adapter_version text NOT NULL DEFAULT '1',
  enabled boolean NOT NULL DEFAULT true,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  cdr_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  settlement_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, adapter_key, adapter_version)
);

CREATE TABLE carrier_connections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  connection_name text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('sip_inbound','cdr','settlement','api','sftp','other')),
  state text NOT NULL DEFAULT 'configured'
    CHECK (state IN ('configured','testing','ready','active','standby','disabled','error')),
  transport text,
  endpoint_host text,
  endpoint_port integer CHECK (endpoint_port IS NULL OR endpoint_port BETWEEN 1 AND 65535),
  auth_mode text,
  secret_ref text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_health_at timestamptz,
  last_health_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, connection_name)
);

CREATE TABLE number_carrier_assignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  assignment_status text NOT NULL DEFAULT 'planned'
    CHECK (assignment_status IN ('planned','testing','active','draining','ended','cancelled')),
  portability_reference text,
  portability_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX number_carrier_assignments_number_time_idx
  ON number_carrier_assignments(sva_number_id, valid_from DESC);

CREATE TABLE logical_carrier_routes (
  route_key text PRIMARY KEY,
  description text NOT NULL,
  active_carrier_id bigint REFERENCES carriers(id),
  standby_carrier_id bigint REFERENCES carriers(id),
  active_connection_id bigint REFERENCES carrier_connections(id),
  standby_connection_id bigint REFERENCES carrier_connections(id),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (active_carrier_id IS NULL OR standby_carrier_id IS NULL OR active_carrier_id <> standby_carrier_id)
);

INSERT INTO logical_carrier_routes(route_key,description)
VALUES ('sva-primary','Logical inbound SVA host route')
ON CONFLICT (route_key) DO NOTHING;

CREATE TABLE carrier_switches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_key text NOT NULL REFERENCES logical_carrier_routes(route_key),
  from_carrier_id bigint REFERENCES carriers(id),
  to_carrier_id bigint NOT NULL REFERENCES carriers(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  requested_by bigint REFERENCES app_users(id),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  rollback_deadline timestamptz,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','testing','ready','switching','completed','rolled_back','failed','cancelled')),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text
);

CREATE INDEX carrier_switches_route_time_idx
  ON carrier_switches(route_key, requested_at DESC);

CREATE OR REPLACE FUNCTION activate_logical_carrier_route(
  p_route_key text,
  p_to_carrier_id bigint,
  p_connection_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
AS $
DECLARE
  v_generation bigint;
BEGIN
  UPDATE logical_carrier_routes
  SET standby_carrier_id = active_carrier_id,
      standby_connection_id = active_connection_id,
      active_carrier_id = p_to_carrier_id,
      active_connection_id = p_connection_id,
      generation = generation + 1,
      updated_at = now()
  WHERE route_key = p_route_key
    AND EXISTS (
      SELECT 1
      FROM carrier_connections cc
      WHERE cc.id = p_connection_id
        AND cc.carrier_id = p_to_carrier_id
        AND cc.purpose = 'sip_inbound'
        AND cc.state IN ('ready','active','standby')
    )
  RETURNING generation INTO v_generation;

  IF v_generation IS NULL THEN
    RAISE EXCEPTION 'route activation rejected: carrier connection is not ready';
  END IF;

  RETURN v_generation;
END;
$;

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
  paid_payout_ht numeric(14,6) NOT NULL DEFAULT 0,
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
    paid_payout_ht >= 0 AND
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

CREATE INDEX calls_started_at_brin ON calls USING brin(started_at);
CREATE INDEX raw_cdr_received_at_brin ON raw_cdr_events USING brin(received_at);
CREATE INDEX financial_ledger_occurred_at_brin ON financial_ledger USING brin(occurred_at);

CREATE OR REPLACE FUNCTION prevent_contract_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $
BEGIN
  IF EXISTS (
    SELECT 1
    FROM carrier_contracts c
    WHERE c.carrier_id = NEW.carrier_id
      AND c.id <> COALESCE(NEW.id,0)
      AND c.sva_number_id IS NOT DISTINCT FROM NEW.sva_number_id
      AND daterange(c.valid_from, COALESCE(c.valid_to + 1, 'infinity'::date), '[)')
          && daterange(NEW.valid_from, COALESCE(NEW.valid_to + 1, 'infinity'::date), '[)')
  ) THEN
    RAISE EXCEPTION 'overlapping carrier contract for carrier %, SVA %', NEW.carrier_id, NEW.sva_number_id;
  END IF;
  RETURN NEW;
END;
$;

CREATE TRIGGER carrier_contracts_no_overlap
BEFORE INSERT OR UPDATE ON carrier_contracts
FOR EACH ROW EXECUTE FUNCTION prevent_contract_overlap();

CREATE TABLE metric_rollups_hourly (
  bucket_start timestamptz NOT NULL,
  dimension_type text NOT NULL CHECK (dimension_type IN ('global','expert','origin_carrier','sva_number')),
  dimension_id bigint NOT NULL DEFAULT 0,
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  calls_abandoned bigint NOT NULL DEFAULT 0,
  calls_failed bigint NOT NULL DEFAULT 0,
  conversation_seconds bigint NOT NULL DEFAULT 0,
  billable_seconds bigint NOT NULL DEFAULT 0,
  payout_eligible_seconds bigint NOT NULL DEFAULT 0,
  generated_revenue_ttc numeric(18,6) NOT NULL DEFAULT 0,
  expected_payout_ht numeric(18,6) NOT NULL DEFAULT 0,
  confirmed_payout_ht numeric(18,6) NOT NULL DEFAULT 0,
  paid_payout_ht numeric(18,6) NOT NULL DEFAULT 0,
  expert_cost_ht numeric(18,6) NOT NULL DEFAULT 0,
  technical_cost_ht numeric(18,6) NOT NULL DEFAULT 0,
  estimated_margin_ht numeric(18,6) NOT NULL DEFAULT 0,
  reconciliation_variance_ht numeric(18,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, dimension_type, dimension_id)
);

CREATE INDEX metric_rollups_hourly_dimension_idx
  ON metric_rollups_hourly(dimension_type, dimension_id, bucket_start DESC);

CREATE TABLE api_idempotency_keys (
  idempotency_key uuid PRIMARY KEY,
  operation text NOT NULL,
  request_sha256 char(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE INDEX api_idempotency_expiry_idx ON api_idempotency_keys(expires_at);

CREATE TABLE outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text
);

CREATE INDEX outbox_events_pending_idx
  ON outbox_events(available_at, id)
  WHERE published_at IS NULL;

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
