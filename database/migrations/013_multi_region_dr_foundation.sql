-- PGI Telecom — multi-region disaster recovery and data-residency foundation.

CREATE TABLE platform_regions (
  region_key text PRIMARY KEY,
  display_name text NOT NULL,
  geography text NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','ready','active','degraded','draining','offline')),
  traffic_weight integer NOT NULL DEFAULT 0 CHECK (traffic_weight BETWEEN 0 AND 10000),
  failover_priority integer NOT NULL DEFAULT 100 CHECK (failover_priority > 0),
  data_residency_tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_regions(
  region_key,display_name,geography,status,traffic_weight,failover_priority,data_residency_tags
)
VALUES(
  'eu-primary','Europe Primary','EU','active',10000,1,ARRAY['EU','GDPR']
)
ON CONFLICT (region_key) DO NOTHING;

CREATE TABLE tenant_residency_policies (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  primary_region text NOT NULL REFERENCES platform_regions(region_key),
  allowed_regions text[] NOT NULL,
  failover_regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  residency_mode text NOT NULL DEFAULT 'regional'
    CHECK (residency_mode IN ('regional','country_pinned','dedicated','global_allowed')),
  cross_region_replication_allowed boolean NOT NULL DEFAULT true,
  encryption_key_scope text NOT NULL DEFAULT 'platform'
    CHECK (encryption_key_scope IN ('platform','region','tenant')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (array_length(allowed_regions,1) IS NOT NULL)
);

INSERT INTO tenant_residency_policies(
  tenant_id,primary_region,allowed_regions,failover_regions,residency_mode
)
SELECT id,'eu-primary',ARRAY['eu-primary']::text[],ARRAY[]::text[],'regional'
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE FUNCTION pgi_assign_default_residency_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO tenant_residency_policies(
    tenant_id,primary_region,allowed_regions,failover_regions,residency_mode
  )
  VALUES(
    NEW.id,COALESCE(NULLIF(NEW.home_region,''),'eu-primary'),
    ARRAY[COALESCE(NULLIF(NEW.home_region,''),'eu-primary')]::text[],
    ARRAY[]::text[],'regional'
  )
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_assign_residency_policy
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION pgi_assign_default_residency_policy();

CREATE TABLE disaster_recovery_targets (
  component_key text NOT NULL,
  region_key text NOT NULL REFERENCES platform_regions(region_key),
  rpo_seconds integer NOT NULL CHECK (rpo_seconds >= 0),
  rto_seconds integer NOT NULL CHECK (rto_seconds >= 0),
  replication_mode text NOT NULL
    CHECK (replication_mode IN ('synchronous','asynchronous','backup_restore','stateless')),
  criticality text NOT NULL
    CHECK (criticality IN ('tier0','tier1','tier2','tier3')),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (component_key,region_key)
);

INSERT INTO disaster_recovery_targets(
  component_key,region_key,rpo_seconds,rto_seconds,replication_mode,criticality
)
VALUES
  ('api','eu-primary',0,300,'stateless','tier0'),
  ('postgres-writer','eu-primary',60,900,'asynchronous','tier0'),
  ('cdr-ingestion','eu-primary',0,300,'stateless','tier0'),
  ('object-storage','eu-primary',300,1800,'backup_restore','tier1')
ON CONFLICT (component_key,region_key) DO NOTHING;

CREATE TABLE disaster_recovery_drills (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  drill_type text NOT NULL
    CHECK (drill_type IN ('restore','regional_failover','database_failover','queue_recovery','full')),
  source_region text REFERENCES platform_regions(region_key),
  target_region text REFERENCES platform_regions(region_key),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('planned','running','passed','failed','aborted')),
  observed_rpo_seconds integer,
  observed_rto_seconds integer,
  evidence_ref text,
  notes text,
  created_by bigint REFERENCES app_users(id)
);

CREATE INDEX disaster_recovery_drills_time_idx
  ON disaster_recovery_drills(started_at DESC,id DESC);

CREATE TABLE region_failover_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_region text NOT NULL REFERENCES platform_regions(region_key),
  target_region text NOT NULL REFERENCES platform_regions(region_key),
  scope text NOT NULL
    CHECK (scope IN ('traffic','api','database','cdr','tenant_bucket','full')),
  tenant_bucket smallint CHECK (tenant_bucket BETWEEN 0 AND 4095),
  state text NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned','approved','executing','completed','rolled_back','failed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  requested_by bigint REFERENCES app_users(id),
  approved_by bigint REFERENCES app_users(id),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text
);

CREATE INDEX region_failover_events_time_idx
  ON region_failover_events(requested_at DESC,id DESC);
CREATE INDEX region_failover_events_bucket_idx
  ON region_failover_events(tenant_bucket,requested_at DESC)
  WHERE tenant_bucket IS NOT NULL;
