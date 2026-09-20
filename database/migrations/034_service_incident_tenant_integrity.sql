-- PGI Telecom — hard tenant-integrity boundary for service incidents.
-- Additive constraints: an incident child row can never point to another tenant.

ALTER TABLE tenant_service_incidents
  ADD CONSTRAINT tenant_service_incidents_id_tenant_unique UNIQUE(id,tenant_id);

ALTER TABLE tenant_service_incident_events
  ADD CONSTRAINT tenant_service_incident_events_tenant_fk
  FOREIGN KEY(incident_id,tenant_id)
  REFERENCES tenant_service_incidents(id,tenant_id);

ALTER TABLE tenant_service_incident_notes
  ADD CONSTRAINT tenant_service_incident_notes_tenant_fk
  FOREIGN KEY(incident_id,tenant_id)
  REFERENCES tenant_service_incidents(id,tenant_id);

ALTER TABLE tenant_service_incident_attachments
  ADD CONSTRAINT tenant_service_incident_attachments_tenant_fk
  FOREIGN KEY(incident_id,tenant_id)
  REFERENCES tenant_service_incidents(id,tenant_id);

CREATE OR REPLACE FUNCTION pgi_validate_service_incident_attachment_tenant()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_asset_tenant bigint;
BEGIN
  SELECT tenant_id INTO v_asset_tenant
  FROM object_assets
  WHERE id=NEW.object_asset_id;

  IF v_asset_tenant IS NULL OR v_asset_tenant<>NEW.tenant_id THEN
    RAISE EXCEPTION 'service incident attachment tenant mismatch';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_service_incident_attachment_tenant_guard
BEFORE INSERT OR UPDATE OF tenant_id,object_asset_id
ON tenant_service_incident_attachments
FOR EACH ROW EXECUTE FUNCTION pgi_validate_service_incident_attachment_tenant();

COMMENT ON CONSTRAINT tenant_service_incident_events_tenant_fk ON tenant_service_incident_events IS
'Prevents cross-tenant event linkage even if application validation fails.';

COMMENT ON CONSTRAINT tenant_service_incident_notes_tenant_fk ON tenant_service_incident_notes IS
'Prevents cross-tenant note linkage even if application validation fails.';
