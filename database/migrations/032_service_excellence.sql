-- PGI Telecom — service excellence, customer incident ownership and safe routing simulation support.
-- Expand-only. Adds a single traceable customer incident record instead of duplicating telecom or billing facts.

CREATE TABLE tenant_service_incidents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  incident_key text UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  sva_number_id bigint REFERENCES sva_numbers(id),
  source_telecom_incident_id bigint REFERENCES telecom_incidents(id),
  category text NOT NULL
    CHECK (category IN ('telephony','portability','billing','payout','account','routing','quality','other')),
  severity text NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('low','normal','high','critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','waiting_customer','monitoring','resolved','closed')),
  source text NOT NULL DEFAULT 'customer'
    CHECK (source IN ('customer','admin','system')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 180),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 5000),
  assigned_team text NOT NULL DEFAULT 'PGI Operations' CHECK (char_length(assigned_team) BETWEEN 2 AND 120),
  owner_user_id bigint REFERENCES app_users(id),
  created_by_customer_principal_id uuid REFERENCES customer_principals(id),
  first_response_due_at timestamptz NOT NULL,
  target_resolution_at timestamptz NOT NULL,
  first_responded_at timestamptz,
  last_customer_update_at timestamptz,
  last_pgi_update_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  customer_visible boolean NOT NULL DEFAULT true,
  diagnostic_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(public_id),
  CHECK (target_resolution_at >= first_response_due_at)
);

CREATE INDEX tenant_service_incidents_tenant_status_idx
  ON tenant_service_incidents(tenant_id,status,updated_at DESC,id DESC);
CREATE INDEX tenant_service_incidents_sla_idx
  ON tenant_service_incidents(first_response_due_at,target_resolution_at,id)
  WHERE status NOT IN ('resolved','closed');
CREATE INDEX tenant_service_incidents_telecom_idx
  ON tenant_service_incidents(source_telecom_incident_id,tenant_id)
  WHERE source_telecom_incident_id IS NOT NULL;

CREATE TABLE tenant_service_incident_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id bigint NOT NULL REFERENCES tenant_service_incidents(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL
    CHECK (event_type IN ('created','status_changed','severity_changed','assigned','note','diagnostic','sla_warning','resolved','closed')),
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('customer','staff','system')),
  actor_user_id bigint REFERENCES app_users(id),
  actor_customer_principal_id uuid REFERENCES customer_principals(id),
  previous_value text,
  new_value text,
  message text,
  customer_visible boolean NOT NULL DEFAULT true,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_service_incident_events_incident_time_idx
  ON tenant_service_incident_events(incident_id,occurred_at ASC,id ASC);
CREATE INDEX tenant_service_incident_events_tenant_time_idx
  ON tenant_service_incident_events(tenant_id,occurred_at DESC,id DESC);

CREATE TABLE tenant_service_incident_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  incident_id bigint NOT NULL REFERENCES tenant_service_incidents(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  author_type text NOT NULL CHECK (author_type IN ('customer','staff','system')),
  author_user_id bigint REFERENCES app_users(id),
  author_customer_principal_id uuid REFERENCES customer_principals(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  customer_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_service_incident_notes_incident_time_idx
  ON tenant_service_incident_notes(incident_id,created_at ASC,id ASC);

CREATE TABLE tenant_operational_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_key text NOT NULL UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  incident_id bigint REFERENCES tenant_service_incidents(id) ON DELETE SET NULL,
  alert_type text NOT NULL
    CHECK (alert_type IN ('carrier_incident','first_response_due','resolution_due','routing_unavailable','portability_attention','quality_degraded')),
  severity text NOT NULL
    CHECK (severity IN ('info','warning','critical')),
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open','acknowledged','resolved')),
  title text NOT NULL,
  message text NOT NULL,
  customer_visible boolean NOT NULL DEFAULT true,
  due_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_operational_alerts_tenant_state_idx
  ON tenant_operational_alerts(tenant_id,state,last_detected_at DESC,id DESC);
CREATE INDEX tenant_operational_alerts_due_idx
  ON tenant_operational_alerts(due_at,id)
  WHERE state<>'resolved';

CREATE VIEW tenant_scoped_service_incidents
WITH (security_barrier=true)
AS
SELECT
  id,public_id,tenant_id,sva_number_id,source_telecom_incident_id,category,severity,status,source,title,description,
  assigned_team,first_response_due_at,target_resolution_at,first_responded_at,last_customer_update_at,last_pgi_update_at,
  resolved_at,closed_at,customer_visible,diagnostic_snapshot,created_at,updated_at
FROM tenant_service_incidents
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_service_incident_events
WITH (security_barrier=true)
AS
SELECT
  e.id,e.incident_id,e.tenant_id,e.event_type,e.actor_type,e.previous_value,e.new_value,e.message,e.customer_visible,e.details,e.occurred_at
FROM tenant_service_incident_events e
WHERE e.tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_service_incident_notes
WITH (security_barrier=true)
AS
SELECT
  n.id,n.incident_id,n.tenant_id,n.author_type,n.body,n.customer_visible,n.created_at
FROM tenant_service_incident_notes n
WHERE n.tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_operational_alerts
WITH (security_barrier=true)
AS
SELECT
  id,alert_key,tenant_id,incident_id,alert_type,severity,state,title,message,customer_visible,due_at,
  details,first_detected_at,last_detected_at,acknowledged_at,resolved_at,created_at,updated_at
FROM tenant_operational_alerts
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE tenant_service_incidents IS
'Unique customer-facing service dossier with ownership, SLA targets, diagnostics and lifecycle history.';

COMMENT ON COLUMN tenant_service_incidents.diagnostic_snapshot IS
'Safe point-in-time operational context. Must not contain credentials, raw caller identity, RIO or payment-card data.';

COMMENT ON TABLE tenant_operational_alerts IS
'Customer-scoped operational alerts generated from PGI service state without duplicating telecom source-of-truth.';
