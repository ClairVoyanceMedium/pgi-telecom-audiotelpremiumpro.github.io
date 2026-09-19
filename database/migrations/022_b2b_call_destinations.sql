BEGIN;

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
CREATE VIEW tenant_scoped_call_destinations WITH (security_barrier=true) AS
SELECT id,tenant_id,sva_number_id,label,destination_type,destination_uri,priority,status,failover_enabled,max_concurrent_calls,active_calls,last_assigned_at,last_health_at,last_health_status,created_at,updated_at
FROM tenant_call_destinations WHERE tenant_id=pgi_require_tenant_context();

COMMIT;
