-- PGI Telecom — customer SVA port-in workflow.
-- Expand-only. A portability request does not activate routing or prove ownership.

CREATE TABLE tenant_portability_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint REFERENCES sva_numbers(id),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  requested_e164 text NOT NULL CHECK (requested_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_number text,
  service_family text NOT NULL DEFAULT 'premium_rate'
    CHECK (service_family IN ('premium_rate','shared_cost','freephone','other')),
  current_operator_name text,
  current_operator_reference text,
  account_holder_name text,
  desired_port_date date,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted','awaiting_documents','eligibility_check','operator_pending','scheduled','ported','rejected','cancelled')),
  ownership_status text NOT NULL DEFAULT 'pending'
    CHECK (ownership_status IN ('pending','verified','rejected')),
  authorization_confirmed boolean NOT NULL DEFAULT false,
  number_owner_confirmed boolean NOT NULL DEFAULT false,
  target_carrier_id bigint REFERENCES carriers(id),
  operator_portability_reference text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at IS NULL OR completed_at >= created_at),
  CHECK (status <> 'ported' OR (ownership_status='verified' AND sva_number_id IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX tenant_portability_requests_tenant_idx
  ON tenant_portability_requests(tenant_id,created_at DESC,id DESC);

CREATE INDEX tenant_portability_requests_status_idx
  ON tenant_portability_requests(status,created_at,id);

CREATE UNIQUE INDEX tenant_portability_requests_open_number_unique
  ON tenant_portability_requests(requested_e164)
  WHERE status IN ('submitted','awaiting_documents','eligibility_check','operator_pending','scheduled');

CREATE TRIGGER tenant_portability_requests_touch_updated
BEFORE UPDATE ON tenant_portability_requests
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE VIEW tenant_scoped_portability_requests AS
SELECT
  id,tenant_id,sva_number_id,country_code,requested_e164,display_number,service_family,
  current_operator_name,current_operator_reference,account_holder_name,desired_port_date,
  status,ownership_status,authorization_confirmed,number_owner_confirmed,
  operator_portability_reference,scheduled_at,completed_at,rejection_reason,created_at,updated_at
FROM tenant_portability_requests
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE tenant_portability_requests IS
'Port-in requests for customer-owned service numbers. Request creation never activates routing; operator and ownership confirmation remain required.';
