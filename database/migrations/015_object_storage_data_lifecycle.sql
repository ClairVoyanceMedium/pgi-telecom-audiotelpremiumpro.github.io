-- PGI Telecom — object storage references, retention and privacy request lifecycle.

CREATE TABLE object_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  market_id bigint REFERENCES operating_markets(id),
  asset_type text NOT NULL
    CHECK (asset_type IN ('kyc_document','carrier_statement','tenant_statement','invoice','cdr_export','audit_export','backup_manifest','other')),
  storage_provider text NOT NULL,
  bucket_ref text NOT NULL,
  object_key text NOT NULL,
  storage_region text,
  content_sha256 char(64) NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  media_type text,
  classification text NOT NULL DEFAULT 'confidential'
    CHECK (classification IN ('internal','confidential','restricted','regulated')),
  encryption_scope text NOT NULL DEFAULT 'platform'
    CHECK (encryption_scope IN ('platform','region','tenant')),
  encryption_key_ref text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','quarantined','archived','deletion_pending','deleted')),
  retention_until timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (storage_provider,bucket_ref,object_key)
);

CREATE INDEX object_assets_tenant_type_idx
  ON object_assets(tenant_id,asset_type,status,created_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX object_assets_retention_idx
  ON object_assets(retention_until,status)
  WHERE retention_until IS NOT NULL AND legal_hold=false;

CREATE TABLE data_retention_policies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  market_id bigint REFERENCES operating_markets(id),
  data_class text NOT NULL,
  retention_days integer NOT NULL CHECK (retention_days >= 0),
  deletion_mode text NOT NULL DEFAULT 'hard_delete'
    CHECK (deletion_mode IN ('hard_delete','anonymize','archive')),
  legal_basis text,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX data_retention_policies_resolution_idx
  ON data_retention_policies(data_class,tenant_id,market_id,enabled,priority);

CREATE TABLE data_subject_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  market_id bigint REFERENCES operating_markets(id),
  request_type text NOT NULL
    CHECK (request_type IN ('access','rectification','erasure','restriction','portability','objection','other')),
  subject_reference_hash char(64) NOT NULL,
  jurisdiction text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','identity_verification','in_review','blocked_legal_hold','in_progress','completed','rejected','cancelled')),
  received_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  completed_at timestamptz,
  evidence_asset_id uuid REFERENCES object_assets(id),
  resolution_notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (completed_at IS NULL OR completed_at >= received_at)
);

CREATE INDEX data_subject_requests_tenant_status_idx
  ON data_subject_requests(tenant_id,status,received_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX data_subject_requests_due_idx
  ON data_subject_requests(due_at,status)
  WHERE due_at IS NOT NULL AND completed_at IS NULL;
