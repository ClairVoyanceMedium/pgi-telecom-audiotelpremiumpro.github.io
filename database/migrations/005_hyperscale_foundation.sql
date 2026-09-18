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

CREATE FUNCTION pgi_assign_tenant_data_placement()
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
