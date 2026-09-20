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
AS $$
BEGIN
  IF OLD.status IN ('active','porting')
     AND NEW.e164 IS DISTINCT FROM OLD.e164 THEN
    RAISE EXCEPTION 'active SVA number identity cannot be changed during carrier operations';
  END IF;
  RETURN NEW;
END;
$$;

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

ALTER TABLE number_portability_events
  ADD CONSTRAINT number_portability_events_from_carrier_fk FOREIGN KEY (from_carrier_id) REFERENCES carriers(id),
  ADD CONSTRAINT number_portability_events_to_carrier_fk FOREIGN KEY (to_carrier_id) REFERENCES carriers(id);

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
AS $$
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
$$;

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
  destination_uri text,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('available','busy','away','offline')),
  compensation_type text NOT NULL DEFAULT 'per_minute' CHECK (compensation_type IN ('per_minute','percentage','fixed','none')),
  compensation_rate numeric(12,6) NOT NULL DEFAULT 0,
  active_calls integer NOT NULL DEFAULT 0 CHECK (active_calls >= 0),
  last_assigned_at timestamptz,
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
  external_call_id text,
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
  ringing_at timestamptz,
  ended_at timestamptz NOT NULL,

  wait_seconds integer NOT NULL DEFAULT 0 CHECK (wait_seconds >= 0),
  conversation_seconds integer NOT NULL DEFAULT 0 CHECK (conversation_seconds >= 0),
  total_seconds integer NOT NULL DEFAULT 0 CHECK (total_seconds >= 0),
  billable_seconds integer NOT NULL DEFAULT 0 CHECK (billable_seconds >= 0),
  payout_eligible_seconds integer NOT NULL DEFAULT 0 CHECK (payout_eligible_seconds >= 0),

  call_status text NOT NULL CHECK (call_status IN ('connected','abandoned','failed','rejected','busy','cancelled')),
  sip_final_code integer,
  hangup_cause text,
  hangup_party text CHECK (hangup_party IS NULL OR hangup_party IN ('caller','callee','network','unknown')),
  post_dial_delay_ms integer CHECK (post_dial_delay_ms IS NULL OR post_dial_delay_ms>=0),
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

CREATE UNIQUE INDEX calls_host_external_unique
  ON calls(host_carrier_id, external_call_id)
  WHERE host_carrier_id IS NOT NULL AND external_call_id IS NOT NULL;
CREATE INDEX calls_started_at_idx ON calls(started_at DESC);
CREATE INDEX calls_expert_started_idx ON calls(expert_id, started_at DESC);
CREATE INDEX calls_origin_carrier_started_idx ON calls(origin_carrier_id, started_at DESC);
CREATE INDEX calls_host_carrier_started_idx ON calls(host_carrier_id, started_at DESC);
CREATE INDEX calls_sip_final_started_idx ON calls(sip_final_code, started_at DESC);
CREATE INDEX calls_pdd_started_idx ON calls(post_dial_delay_ms, started_at DESC) WHERE post_dial_delay_ms IS NOT NULL;
CREATE INDEX calls_status_started_idx ON calls(call_status, started_at DESC);
CREATE INDEX calls_reconciliation_idx ON calls(reconciliation_status, started_at DESC);
CREATE INDEX calls_caller_idx ON calls(caller_id, started_at DESC);

CREATE TABLE call_quality (
  call_id bigint PRIMARY KEY REFERENCES calls(id) ON DELETE CASCADE,
  rtp_packet_loss_percent numeric(7,4),
  jitter_ms numeric(10,3),
  latency_ms numeric(10,3),
  rtt_ms numeric(10,3),
  mos numeric(5,3),
  packets_in bigint,
  packets_lost bigint,
  packets_out bigint,
  bytes_in bigint,
  bytes_out bigint,
  dtmf_errors integer NOT NULL DEFAULT 0,
  sampled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_voice_daily_sharded (
  tenant_bucket smallint NOT NULL CHECK (tenant_bucket BETWEEN 0 AND 4095),
  bucket_date date NOT NULL,
  tenant_id bigint NOT NULL,
  market_id bigint NOT NULL,
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  pdd_samples bigint NOT NULL DEFAULT 0,
  pdd_ms_sum bigint NOT NULL DEFAULT 0,
  high_pdd_calls bigint NOT NULL DEFAULT 0,
  quality_samples bigint NOT NULL DEFAULT 0,
  network_affected_calls bigint NOT NULL DEFAULT 0,
  low_mos_calls bigint NOT NULL DEFAULT 0,
  mos_sum numeric(22,6) NOT NULL DEFAULT 0,
  packet_loss_sum numeric(22,6) NOT NULL DEFAULT 0,
  jitter_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  latency_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  rtt_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  sip_5xx_calls bigint NOT NULL DEFAULT 0,
  caller_hangups bigint NOT NULL DEFAULT 0,
  callee_hangups bigint NOT NULL DEFAULT 0,
  network_hangups bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_bucket,bucket_date,tenant_id,market_id)
) PARTITION BY HASH (tenant_bucket);
DO $pgi$
DECLARE i integer;
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format('CREATE TABLE tenant_voice_daily_sharded_p%s PARTITION OF tenant_voice_daily_sharded FOR VALUES WITH (MODULUS 64, REMAINDER %s)',i,i);
  END LOOP;
END;
$pgi$;
CREATE INDEX tenant_voice_daily_tenant_date_idx ON tenant_voice_daily_sharded(tenant_id,bucket_date DESC);

CREATE TABLE voice_carrier_health_hourly_sharded (
  bucket_start timestamptz NOT NULL,
  market_id bigint NOT NULL,
  carrier_role text NOT NULL CHECK (carrier_role IN ('origin','host')),
  carrier_id bigint NOT NULL REFERENCES carriers(id),
  rollup_shard smallint NOT NULL CHECK (rollup_shard BETWEEN 0 AND 63),
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  calls_failed bigint NOT NULL DEFAULT 0,
  pdd_samples bigint NOT NULL DEFAULT 0,
  pdd_ms_sum bigint NOT NULL DEFAULT 0,
  high_pdd_calls bigint NOT NULL DEFAULT 0,
  quality_samples bigint NOT NULL DEFAULT 0,
  network_affected_calls bigint NOT NULL DEFAULT 0,
  low_mos_calls bigint NOT NULL DEFAULT 0,
  mos_sum numeric(22,6) NOT NULL DEFAULT 0,
  packet_loss_sum numeric(22,6) NOT NULL DEFAULT 0,
  jitter_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  latency_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  rtt_ms_sum numeric(22,6) NOT NULL DEFAULT 0,
  sip_4xx_calls bigint NOT NULL DEFAULT 0,
  sip_5xx_calls bigint NOT NULL DEFAULT 0,
  caller_hangups bigint NOT NULL DEFAULT 0,
  callee_hangups bigint NOT NULL DEFAULT 0,
  network_hangups bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket_start,market_id,carrier_role,carrier_id,rollup_shard)
);
CREATE INDEX voice_carrier_health_market_time_idx ON voice_carrier_health_hourly_sharded(market_id,bucket_start DESC,carrier_role);
CREATE INDEX voice_carrier_health_carrier_time_idx ON voice_carrier_health_hourly_sharded(carrier_role,carrier_id,bucket_start DESC);
CREATE INDEX voice_carrier_health_time_brin ON voice_carrier_health_hourly_sharded USING brin(bucket_start);

CREATE TABLE voice_sip_code_hourly_sharded (
  bucket_start timestamptz NOT NULL,
  market_id bigint NOT NULL,
  host_carrier_id bigint NOT NULL REFERENCES carriers(id),
  sip_final_code integer NOT NULL CHECK (sip_final_code BETWEEN 100 AND 699),
  rollup_shard smallint NOT NULL CHECK (rollup_shard BETWEEN 0 AND 63),
  calls_total bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket_start,market_id,host_carrier_id,sip_final_code,rollup_shard)
);
CREATE INDEX voice_sip_code_market_time_idx ON voice_sip_code_hourly_sharded(market_id,bucket_start DESC,sip_final_code);
CREATE INDEX voice_sip_code_carrier_time_idx ON voice_sip_code_hourly_sharded(host_carrier_id,bucket_start DESC,sip_final_code);

CREATE TABLE telecom_incidents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning','critical')),
  carrier_role text CHECK (carrier_role IS NULL OR carrier_role IN ('origin','host')),
  carrier_id bigint REFERENCES carriers(id),
  market_id bigint,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved')),
  title text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX telecom_incidents_open_unique ON telecom_incidents(incident_type,COALESCE(carrier_role,''),COALESCE(carrier_id,0),COALESCE(market_id,0)) WHERE state='open';
CREATE INDEX telecom_incidents_time_idx ON telecom_incidents(started_at DESC);
CREATE INDEX telecom_incidents_state_idx ON telecom_incidents(state,last_detected_at DESC);

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
AS $$
BEGIN
  RAISE EXCEPTION 'financial_ledger is append-only';
END;
$$;

CREATE TRIGGER financial_ledger_no_update
BEFORE UPDATE OR DELETE ON financial_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

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
AS $$
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
$$;

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


-- Wholesale / multi-tenant foundation.
CREATE TABLE tenants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  legal_name text,
  tenant_type text NOT NULL DEFAULT 'customer'
    CHECK (tenant_type IN ('internal','customer','reseller')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','closed')),
  country_code char(2),
  billing_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenants(slug,display_name,legal_name,tenant_type,status,country_code)
VALUES ('pgi-internal','PGI Telecom','PGI Telecom','internal','active','FR')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE tenant_memberships (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  user_id bigint NOT NULL REFERENCES app_users(id),
  role text NOT NULL
    CHECK (role IN ('owner','admin','finance','operator','readonly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,user_id)
);

CREATE TABLE tenant_number_assignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  assignment_type text NOT NULL DEFAULT 'customer_service'
    CHECK (assignment_type IN ('own_service','customer_service','reseller_suballocation')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','pending_kyc','testing','active','suspended','ended')),
  valid_from timestamptz,
  valid_to timestamptz,
  tariff_code text,
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX tenant_number_assignments_tenant_idx
  ON tenant_number_assignments(tenant_id,status,created_at DESC);
CREATE INDEX tenant_number_assignments_number_idx
  ON tenant_number_assignments(sva_number_id,status,created_at DESC);

CREATE TABLE tenant_settlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  upstream_settlement_id bigint REFERENCES carrier_settlements(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_service_amount_ht numeric(16,6) NOT NULL DEFAULT 0,
  upstream_payout_ht numeric(16,6) NOT NULL DEFAULT 0,
  platform_fee_ht numeric(16,6) NOT NULL DEFAULT 0,
  net_payout_ht numeric(16,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reconciled','invoiced','payable','paid','disputed')),
  payment_due_date date,
  paid_at timestamptz,
  statement_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (gross_service_amount_ht >= 0),
  CHECK (upstream_payout_ht >= 0),
  CHECK (platform_fee_ht >= 0),
  CHECK (net_payout_ht >= 0)
);

CREATE UNIQUE INDEX tenant_settlement_period_unique
  ON tenant_settlements(tenant_id,period_start,period_end);

CREATE TABLE tenant_settlement_calls (
  tenant_settlement_id bigint NOT NULL REFERENCES tenant_settlements(id) ON DELETE CASCADE,
  call_id bigint NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  attributable_amount_ht numeric(14,6) NOT NULL DEFAULT 0,
  platform_fee_ht numeric(14,6) NOT NULL DEFAULT 0,
  net_payout_ht numeric(14,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_settlement_id,call_id),
  CHECK (attributable_amount_ht >= 0),
  CHECK (platform_fee_ht >= 0),
  CHECK (net_payout_ht >= 0)
);

ALTER TABLE sva_numbers ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE experts ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE calls ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE metric_baselines ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE audit_log ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE financial_ledger ADD COLUMN tenant_id bigint REFERENCES tenants(id);

CREATE INDEX sva_numbers_tenant_idx ON sva_numbers(tenant_id,status);
CREATE INDEX experts_tenant_idx ON experts(tenant_id,status);
CREATE INDEX calls_tenant_started_idx ON calls(tenant_id,started_at DESC);
CREATE INDEX financial_ledger_tenant_time_idx ON financial_ledger(tenant_id,occurred_at DESC);


-- Wholesale regulatory and payment-compliance controls.
ALTER TABLE tenant_number_assignments
  ADD COLUMN regulatory_assignor_carrier_id bigint REFERENCES carriers(id);
ALTER TABLE tenant_number_assignments
  ADD COLUMN upstream_assignment_reference text;
ALTER TABLE tenant_number_assignments
  ADD COLUMN kyc_status text NOT NULL DEFAULT 'not_started'
    CHECK (kyc_status IN ('not_started','pending','verified','rejected','expired'));

CREATE TABLE tenant_kyc_profiles (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'company'
    CHECK (entity_type IN ('individual','sole_trader','company','association','other')),
  registration_country char(2),
  registration_number text,
  legal_representative_verified boolean NOT NULL DEFAULT false,
  bank_account_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','rejected','expired')),
  provider_reference text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_compliance_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_name text NOT NULL UNIQUE,
  regulatory_role text NOT NULL
    CHECK (regulatory_role IN ('upstream_direct','psp_agent','payment_institution','other')),
  provider_name text,
  registration_reference text,
  funds_flow_mode text NOT NULL
    CHECK (funds_flow_mode IN ('upstream_to_editor','psp_managed','platform_managed')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','active','suspended','closed')),
  valid_from date,
  valid_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX tenant_number_assignments_assignor_idx
  ON tenant_number_assignments(regulatory_assignor_carrier_id,status);
CREATE INDEX tenant_kyc_status_idx
  ON tenant_kyc_profiles(status,updated_at DESC);
CREATE INDEX payment_compliance_status_idx
  ON payment_compliance_profiles(status,created_at DESC);



-- International / multi-market foundation.
-- PGI Telecom — international market foundation.
-- Additive only. France remains the default market; no foreign market is activated automatically.

CREATE TABLE operating_markets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_code char(2) NOT NULL UNIQUE
    CHECK (country_code ~ '^[A-Z]{2}$'),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','testing','active','suspended','closed')),
  default_currency char(3) NOT NULL
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_locale text NOT NULL,
  timezone text NOT NULL,
  regulator_name text,
  numbering_authority text,
  data_region text NOT NULL DEFAULT 'eu',
  privacy_retention_days integer CHECK (privacy_retention_days IS NULL OR privacy_retention_days > 0),
  numbering_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  compliance_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO operating_markets(
  country_code,display_name,status,default_currency,default_locale,timezone,
  regulator_name,numbering_authority,data_region,numbering_profile
)
VALUES (
  'FR','France','active','EUR','fr-FR','Europe/Paris',
  'ARCEP','ARCEP','eu',
  '{"canonical_number_format":"E.164","service_family":"premium_rate","local_product":"SVA"}'::jsonb
)
ON CONFLICT (country_code) DO NOTHING;

ALTER TABLE tenants
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'fr-FR',
  ADD COLUMN default_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Paris';

CREATE TABLE tenant_market_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','testing','active','suspended','closed')),
  preferred_locale text,
  billing_currency char(3)
    CHECK (billing_currency IS NULL OR billing_currency ~ '^[A-Z]{3}$'),
  timezone text,
  compliance_status text NOT NULL DEFAULT 'not_started'
    CHECK (compliance_status IN ('not_started','pending','verified','blocked','expired')),
  tax_registration_id text,
  tax_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_residency_region text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,market_id)
);

INSERT INTO tenant_market_profiles(
  tenant_id,market_id,status,preferred_locale,billing_currency,timezone,compliance_status,data_residency_region
)
SELECT t.id,m.id,'active','fr-FR','EUR','Europe/Paris','verified','eu'
FROM tenants t
JOIN operating_markets m ON m.country_code='FR'
WHERE t.slug='pgi-internal'
ON CONFLICT (tenant_id,market_id) DO NOTHING;

ALTER TABLE sva_numbers
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN number_type text NOT NULL DEFAULT 'premium_rate'
    CHECK (number_type IN ('premium_rate','shared_cost','freephone','geographic','mobile','other')),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN national_number text;

UPDATE sva_numbers
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

CREATE INDEX sva_numbers_market_status_idx ON sva_numbers(market_id,status);

-- Voice/NOC tables are declared earlier for snapshot locality, then constrained here
-- once their tenant and market parent tables exist.
ALTER TABLE tenant_voice_daily_sharded
  ADD CONSTRAINT tenant_voice_daily_tenant_fk FOREIGN KEY(tenant_id) REFERENCES tenants(id),
  ADD CONSTRAINT tenant_voice_daily_market_fk FOREIGN KEY(market_id) REFERENCES operating_markets(id);
ALTER TABLE voice_carrier_health_hourly_sharded
  ADD CONSTRAINT voice_carrier_health_market_fk FOREIGN KEY(market_id) REFERENCES operating_markets(id);
ALTER TABLE voice_sip_code_hourly_sharded
  ADD CONSTRAINT voice_sip_code_market_fk FOREIGN KEY(market_id) REFERENCES operating_markets(id);
ALTER TABLE telecom_incidents
  ADD CONSTRAINT telecom_incidents_market_fk FOREIGN KEY(market_id) REFERENCES operating_markets(id);

CREATE TABLE sva_number_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  market_id bigint REFERENCES operating_markets(id),
  carrier_id bigint REFERENCES carriers(id),
  alias text NOT NULL,
  alias_type text NOT NULL DEFAULT 'carrier_dialed'
    CHECK (alias_type IN ('national','international','display','carrier_dialed','portability','other')),
  normalized_e164 text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sva_number_aliases_carrier_alias_unique
  ON sva_number_aliases(COALESCE(carrier_id,0),alias);
CREATE INDEX sva_number_aliases_number_idx
  ON sva_number_aliases(sva_number_id,enabled);

INSERT INTO sva_number_aliases(sva_number_id,market_id,alias,alias_type,normalized_e164)
SELECT id,market_id,display_number,'display',e164
FROM sva_numbers
WHERE display_number IS NOT NULL AND display_number<>''
ON CONFLICT DO NOTHING;

CREATE TABLE carrier_market_capabilities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  service_type text NOT NULL DEFAULT 'premium_rate'
    CHECK (service_type IN ('premium_rate','shared_cost','freephone','geographic','mobile','transit','other')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','testing','ready','active','standby','suspended','closed')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  numbering_prefixes jsonb NOT NULL DEFAULT '[]'::jsonb,
  settlement_currencies text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id,market_id,service_type)
);

CREATE TABLE carrier_connection_markets (
  carrier_connection_id bigint NOT NULL REFERENCES carrier_connections(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  priority integer NOT NULL DEFAULT 100 CHECK (priority > 0),
  inbound_domain text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (carrier_connection_id,market_id)
);

ALTER TABLE carrier_contracts
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE carrier_contracts cc
SET market_id=COALESCE(
  (SELECT sn.market_id FROM sva_numbers sn WHERE sn.id=cc.sva_number_id),
  (SELECT id FROM operating_markets WHERE country_code='FR')
)
WHERE market_id IS NULL;

ALTER TABLE carrier_settlements
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE carrier_settlements
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

ALTER TABLE tenant_settlements
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE tenant_settlements
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

ALTER TABLE calls
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE calls c
SET market_id=sn.market_id,
    currency=sn.currency
FROM sva_numbers sn
WHERE c.sva_number_id=sn.id AND c.market_id IS NULL;

ALTER TABLE financial_ledger
  ADD COLUMN market_id bigint REFERENCES operating_markets(id);

UPDATE financial_ledger f
SET market_id=c.market_id,
    currency=c.currency
FROM calls c
WHERE f.call_id=c.id AND f.market_id IS NULL;

ALTER TABLE logical_carrier_routes
  ADD COLUMN market_id bigint REFERENCES operating_markets(id);

UPDATE logical_carrier_routes
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

CREATE INDEX logical_carrier_routes_market_idx
  ON logical_carrier_routes(market_id,route_key);
CREATE INDEX calls_market_started_idx
  ON calls(market_id,started_at DESC);
CREATE INDEX carrier_contracts_market_idx
  ON carrier_contracts(market_id,carrier_id,valid_from DESC);
CREATE INDEX carrier_settlements_market_period_idx
  ON carrier_settlements(market_id,currency,period_end DESC);
CREATE INDEX tenant_settlements_market_period_idx
  ON tenant_settlements(market_id,currency,period_end DESC);
CREATE INDEX financial_ledger_market_time_idx
  ON financial_ledger(market_id,currency,occurred_at DESC);

CREATE TABLE payment_compliance_market_profiles (
  payment_compliance_profile_id bigint NOT NULL REFERENCES payment_compliance_profiles(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','active','suspended','closed')),
  local_registration_reference text,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_compliance_profile_id,market_id)
);

-- Hyperscale / multi-cluster foundation.
-- PGI Telecom — hyperscale foundation.
-- Additive only. Prepares the control plane and data plane for millions of tenants.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE tenants
  ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN placement_bucket smallint GENERATED ALWAYS AS ((id % 4096)::smallint) STORED,
  ADD COLUMN home_region text NOT NULL DEFAULT 'eu-primary',
  ADD COLUMN capacity_tier text NOT NULL DEFAULT 'standard'
    CHECK (capacity_tier IN ('standard','high_volume','dedicated','strategic'));

CREATE UNIQUE INDEX tenants_public_id_unique ON tenants(public_id);
CREATE INDEX tenants_bucket_status_idx ON tenants(placement_bucket,status,id);
CREATE INDEX tenants_region_status_idx ON tenants(home_region,status,id);

CREATE TABLE data_clusters (
  cluster_key text PRIMARY KEY,
  region text NOT NULL,
  cluster_role text NOT NULL DEFAULT 'primary'
    CHECK (cluster_role IN ('primary','secondary','archive')),
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('planned','provisioning','ready','draining','offline')),
  writer_endpoint_ref text,
  reader_endpoint_ref text,
  tenant_soft_limit bigint CHECK (tenant_soft_limit IS NULL OR tenant_soft_limit > 0),
  weight integer NOT NULL DEFAULT 100 CHECK (weight > 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO data_clusters(cluster_key,region,cluster_role,state,tenant_soft_limit)
VALUES ('primary-eu','eu-primary','primary','ready',2000000)
ON CONFLICT (cluster_key) DO NOTHING;

CREATE TABLE routing_buckets (
  bucket smallint PRIMARY KEY CHECK (bucket BETWEEN 0 AND 4095),
  cluster_key text NOT NULL REFERENCES data_clusters(cluster_key),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','moving','draining','disabled')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO routing_buckets(bucket,cluster_key)
SELECT g::smallint,'primary-eu'
FROM generate_series(0,4095) AS g
ON CONFLICT (bucket) DO NOTHING;

CREATE TABLE tenant_data_placement (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  tenant_public_id uuid NOT NULL,
  placement_bucket smallint NOT NULL CHECK (placement_bucket BETWEEN 0 AND 4095),
  cluster_key text NOT NULL REFERENCES data_clusters(cluster_key),
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active','moving','draining','frozen')),
  home_region text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_data_placement_public_unique
  ON tenant_data_placement(tenant_public_id);
CREATE INDEX tenant_data_placement_cluster_idx
  ON tenant_data_placement(cluster_key,placement_bucket,tenant_id);

INSERT INTO tenant_data_placement(
  tenant_id,tenant_public_id,placement_bucket,cluster_key,home_region
)
SELECT t.id,t.public_id,t.placement_bucket,rb.cluster_key,t.home_region
FROM tenants t
JOIN routing_buckets rb ON rb.bucket=t.placement_bucket
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION pgi_assign_tenant_data_placement()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cluster text;
BEGIN
  SELECT cluster_key INTO v_cluster
  FROM routing_buckets
  WHERE bucket=NEW.placement_bucket
    AND state IN ('active','moving')
  LIMIT 1;

  IF v_cluster IS NULL THEN
    RAISE EXCEPTION 'no active data placement for tenant bucket %', NEW.placement_bucket;
  END IF;

  INSERT INTO tenant_data_placement(
    tenant_id,tenant_public_id,placement_bucket,cluster_key,home_region
  )
  VALUES(
    NEW.id,NEW.public_id,NEW.placement_bucket,v_cluster,NEW.home_region
  )
  ON CONFLICT (tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_assign_data_placement
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION pgi_assign_tenant_data_placement();

ALTER TABLE calls
  ADD COLUMN tenant_bucket smallint GENERATED ALWAYS AS (((COALESCE(tenant_id,0)) % 4096)::smallint) STORED;

ALTER TABLE financial_ledger
  ADD COLUMN tenant_bucket smallint GENERATED ALWAYS AS (((COALESCE(tenant_id,0)) % 4096)::smallint) STORED;

ALTER TABLE audit_log
  ADD COLUMN tenant_bucket smallint GENERATED ALWAYS AS (((COALESCE(tenant_id,0)) % 4096)::smallint) STORED;

ALTER TABLE outbox_events
  ADD COLUMN tenant_id bigint REFERENCES tenants(id),
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN tenant_bucket smallint GENERATED ALWAYS AS (((COALESCE(tenant_id,0)) % 4096)::smallint) STORED,
  ADD COLUMN event_key uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE api_idempotency_keys
  ADD COLUMN tenant_id bigint REFERENCES tenants(id);

CREATE INDEX calls_bucket_tenant_started_idx
  ON calls(tenant_bucket,tenant_id,started_at DESC,id DESC);
CREATE INDEX financial_ledger_bucket_tenant_time_idx
  ON financial_ledger(tenant_bucket,tenant_id,occurred_at DESC,id DESC);
CREATE INDEX audit_log_bucket_tenant_time_idx
  ON audit_log(tenant_bucket,tenant_id,occurred_at DESC,id DESC);
CREATE UNIQUE INDEX outbox_events_event_key_unique
  ON outbox_events(event_key);
CREATE INDEX outbox_events_bucket_pending_idx
  ON outbox_events(tenant_bucket,available_at,id)
  WHERE published_at IS NULL;
CREATE INDEX api_idempotency_tenant_expiry_idx
  ON api_idempotency_keys(tenant_id,expires_at);

CREATE TABLE worker_leases (
  lease_key text PRIMARY KEY,
  owner_id text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (expires_at > acquired_at)
);

CREATE INDEX worker_leases_expiry_idx ON worker_leases(expires_at);

CREATE TABLE work_queue (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  queue_name text NOT NULL,
  tenant_id bigint REFERENCES tenants(id),
  tenant_bucket smallint GENERATED ALWAYS AS (((COALESCE(tenant_id,0)) % 4096)::smallint) STORED,
  dedupe_key text,
  priority smallint NOT NULL DEFAULT 100,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 10 CHECK (max_attempts > 0),
  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX work_queue_dedupe_active_unique
  ON work_queue(queue_name,dedupe_key)
  WHERE dedupe_key IS NOT NULL AND completed_at IS NULL AND failed_at IS NULL;
CREATE INDEX work_queue_claim_idx
  ON work_queue(queue_name,priority,available_at,id)
  WHERE completed_at IS NULL AND failed_at IS NULL;
CREATE INDEX work_queue_tenant_idx
  ON work_queue(tenant_bucket,tenant_id,created_at DESC);

CREATE TABLE call_facts (
  tenant_bucket smallint NOT NULL CHECK (tenant_bucket BETWEEN 0 AND 4095),
  call_id bigint NOT NULL,
  tenant_id bigint,
  market_id bigint,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  sva_number_id bigint NOT NULL,
  expert_id bigint,
  origin_carrier_id bigint,
  host_carrier_id bigint,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  call_status text NOT NULL,
  conversation_seconds integer NOT NULL DEFAULT 0,
  billable_seconds integer NOT NULL DEFAULT 0,
  payout_eligible_seconds integer NOT NULL DEFAULT 0,
  retail_service_amount_ttc numeric(14,6) NOT NULL DEFAULT 0,
  expected_payout_ht numeric(14,6) NOT NULL DEFAULT 0,
  confirmed_payout_ht numeric(14,6) NOT NULL DEFAULT 0,
  paid_payout_ht numeric(14,6) NOT NULL DEFAULT 0,
  expert_cost_ht numeric(14,6) NOT NULL DEFAULT 0,
  technical_cost_ht numeric(14,6) NOT NULL DEFAULT 0,
  estimated_margin_ht numeric(14,6) NOT NULL DEFAULT 0,
  reconciliation_variance_ht numeric(14,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_bucket,call_id)
) PARTITION BY HASH (tenant_bucket);

DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format(
      'CREATE TABLE call_facts_p%s PARTITION OF call_facts FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
      i,i
    );
  END LOOP;
END;
$$;

CREATE INDEX call_facts_tenant_time_idx
  ON call_facts(tenant_id,started_at DESC,call_id DESC);
CREATE INDEX call_facts_tenant_status_time_idx
  ON call_facts(tenant_id,call_status,started_at DESC,call_id DESC);
CREATE INDEX call_facts_tenant_number_time_idx
  ON call_facts(tenant_id,sva_number_id,started_at DESC,call_id DESC);
CREATE INDEX call_facts_market_time_idx
  ON call_facts(market_id,started_at DESC,call_id DESC);
CREATE INDEX call_facts_time_idx
  ON call_facts(started_at DESC,call_id DESC);
CREATE INDEX call_facts_started_brin
  ON call_facts USING brin(started_at);

INSERT INTO call_facts(
  tenant_bucket,call_id,tenant_id,market_id,currency,sva_number_id,expert_id,
  origin_carrier_id,host_carrier_id,started_at,ended_at,call_status,
  conversation_seconds,billable_seconds,payout_eligible_seconds,
  retail_service_amount_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,
  expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht,created_at
)
SELECT
  c.tenant_bucket,c.id,c.tenant_id,c.market_id,c.currency,c.sva_number_id,c.expert_id,
  c.origin_carrier_id,c.host_carrier_id,c.started_at,c.ended_at,c.call_status,
  c.conversation_seconds,c.billable_seconds,c.payout_eligible_seconds,
  c.retail_service_amount_ttc,c.expected_payout_ht,COALESCE(c.confirmed_payout_ht,0),c.paid_payout_ht,
  c.expert_cost_ht,c.technical_cost_ht,c.estimated_margin_ht,c.reconciliation_variance_ht,c.created_at
FROM calls c
ON CONFLICT (tenant_bucket,call_id) DO NOTHING;

CREATE TABLE metric_rollups_daily_v2 (
  tenant_bucket smallint NOT NULL CHECK (tenant_bucket BETWEEN 0 AND 4095),
  bucket_date date NOT NULL,
  tenant_id bigint,
  market_id bigint,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  calls_total bigint NOT NULL DEFAULT 0,
  calls_connected bigint NOT NULL DEFAULT 0,
  calls_abandoned bigint NOT NULL DEFAULT 0,
  calls_failed bigint NOT NULL DEFAULT 0,
  conversation_seconds bigint NOT NULL DEFAULT 0,
  billable_seconds bigint NOT NULL DEFAULT 0,
  payout_eligible_seconds bigint NOT NULL DEFAULT 0,
  generated_revenue_ttc numeric(20,6) NOT NULL DEFAULT 0,
  expected_payout_ht numeric(20,6) NOT NULL DEFAULT 0,
  confirmed_payout_ht numeric(20,6) NOT NULL DEFAULT 0,
  paid_payout_ht numeric(20,6) NOT NULL DEFAULT 0,
  expert_cost_ht numeric(20,6) NOT NULL DEFAULT 0,
  technical_cost_ht numeric(20,6) NOT NULL DEFAULT 0,
  estimated_margin_ht numeric(20,6) NOT NULL DEFAULT 0,
  reconciliation_variance_ht numeric(20,6) NOT NULL DEFAULT 0,
  source_generation bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_bucket,bucket_date,tenant_id,market_id,currency)
) PARTITION BY HASH (tenant_bucket);

DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format(
      'CREATE TABLE metric_rollups_daily_v2_p%s PARTITION OF metric_rollups_daily_v2 FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
      i,i
    );
  END LOOP;
END;
$$;

CREATE INDEX metric_rollups_daily_v2_tenant_idx
  ON metric_rollups_daily_v2(tenant_id,bucket_date DESC);
CREATE INDEX metric_rollups_daily_v2_market_idx
  ON metric_rollups_daily_v2(market_id,bucket_date DESC,currency);

CREATE TABLE capacity_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  measured_at timestamptz NOT NULL DEFAULT now(),
  component text NOT NULL,
  cluster_key text,
  region text,
  metric text NOT NULL,
  value numeric(20,6) NOT NULL,
  unit text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX capacity_snapshots_lookup_idx
  ON capacity_snapshots(component,metric,measured_at DESC);
CREATE INDEX capacity_snapshots_cluster_idx
  ON capacity_snapshots(cluster_key,measured_at DESC);

-- B2B customer call destinations. Migration 022 keeps existing databases aligned.
CREATE TABLE tenant_call_destinations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  sva_number_id bigint REFERENCES sva_numbers(id),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  destination_type text NOT NULL CHECK (destination_type IN ('pstn','sip','pbx','contact_center')),
  destination_uri text NOT NULL CHECK (char_length(destination_uri) BETWEEN 4 AND 512),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 10000),
  status text NOT NULL DEFAULT 'testing' CHECK (status IN ('active','testing','disabled')),
  failover_enabled boolean NOT NULL DEFAULT true,
  max_concurrent_calls integer CHECK (max_concurrent_calls IS NULL OR max_concurrent_calls > 0),
  active_calls integer NOT NULL DEFAULT 0 CHECK (active_calls >= 0),
  last_assigned_at timestamptz,
  last_health_at timestamptz,
  last_health_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_call_destinations_route_idx ON tenant_call_destinations(tenant_id,sva_number_id,status,priority,active_calls,last_assigned_at,id);
CREATE INDEX tenant_call_destinations_tenant_idx ON tenant_call_destinations(tenant_id,status,id);
ALTER TABLE calls ADD COLUMN call_destination_id bigint REFERENCES tenant_call_destinations(id);
ALTER TABLE calls ADD COLUMN call_destination_label text;
CREATE INDEX calls_destination_started_idx ON calls(call_destination_id,started_at DESC) WHERE call_destination_id IS NOT NULL;
-- La vue tenant_scoped_call_destinations est créée par la migration 022 après la frontière SQL tenant.

-- Customer-control indexes. Migration 021 keeps existing databases aligned.
CREATE INDEX IF NOT EXISTS tenant_kyc_status_tenant_idx
  ON tenant_kyc_profiles(status,tenant_id);

-- Selective metric reset epochs. Migration 035 keeps existing databases aligned.
ALTER TABLE metric_baselines
  ADD COLUMN IF NOT EXISTS metric_key text NOT NULL DEFAULT 'all';
ALTER TABLE metric_baselines
  ADD COLUMN IF NOT EXISTS created_by_customer_principal_id uuid REFERENCES customer_principals(id);
ALTER TABLE metric_baselines
  ADD CONSTRAINT metric_baselines_metric_key_check CHECK (metric_key IN ('all','calls','minutes','revenue','payout','quality'));
CREATE INDEX IF NOT EXISTS metric_baselines_selective_idx
  ON metric_baselines(scope,tenant_id,metric_key,effective_from DESC,id DESC);

-- Fresh-database bootstrap manifest. backend/migrate.mjs validates every checksum
-- against the immutable migration files before seeding schema_migrations.
CREATE TABLE schema_bootstrap_migrations (
  version text PRIMARY KEY,
  checksum char(64) NOT NULL
);

INSERT INTO schema_bootstrap_migrations(version,checksum) VALUES
  ('001_baseline','c3da5c9577b073a6bcdb4af3857524f41a29689126cf9ae6aa04ea95e4473512'),
  ('002_wholesale_multitenant_foundation','09906e258342074ebd5a5c8b09a542ae448f14d5355af5e07327c3eb126089f5'),
  ('003_wholesale_compliance_foundation','c703e0f5d0875073418a2765f94898c8dbe66ce568323f61a431e0ce614c5f02'),
  ('004_international_market_foundation','af4d7deb38de9dfced53d6535bb8ef795b7bfb5834f2b9169923e9b19f12fb69'),
  ('005_hyperscale_foundation','8e4766de0773b9cc49e540514407feeba2a8405d7fcf3099dc3e91ab87942c69');

COMMIT;
