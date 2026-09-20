-- PGI Telecom — scalable service operations queue and attachment linkage.
-- Additive only. Keeps the incident model independent from any storage provider.

CREATE INDEX tenant_service_incidents_ops_queue_idx
  ON tenant_service_incidents(status,severity,updated_at DESC,id DESC);

CREATE INDEX tenant_service_incidents_category_status_idx
  ON tenant_service_incidents(category,status,updated_at DESC,id DESC);

CREATE INDEX tenant_service_incidents_tenant_deadline_idx
  ON tenant_service_incidents(tenant_id,target_resolution_at,id)
  WHERE status NOT IN ('resolved','closed');

CREATE TABLE tenant_service_incident_attachments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id bigint NOT NULL REFERENCES tenant_service_incidents(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  object_asset_id uuid NOT NULL REFERENCES object_assets(id),
  label text CHECK (label IS NULL OR char_length(label) <= 180),
  customer_visible boolean NOT NULL DEFAULT true,
  created_by_type text NOT NULL DEFAULT 'staff'
    CHECK (created_by_type IN ('customer','staff','system')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(incident_id,object_asset_id)
);

CREATE INDEX tenant_service_incident_attachments_incident_idx
  ON tenant_service_incident_attachments(incident_id,created_at,id);

CREATE VIEW tenant_scoped_service_incident_attachments
WITH (security_barrier=true)
AS
SELECT id,incident_id,tenant_id,object_asset_id,label,customer_visible,created_by_type,created_at
FROM tenant_service_incident_attachments
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE tenant_service_incident_attachments IS
'Provider-agnostic attachment linkage. File bytes remain governed by object_assets and its retention/privacy lifecycle.';
