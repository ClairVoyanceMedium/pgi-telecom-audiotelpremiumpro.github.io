-- PGI Telecom — automated operator orchestration for inbound portability.
-- Expand-only. Sensitive portability credentials remain encrypted in tenant_portability_requests
-- and are decrypted only in worker memory immediately before an operator call.

ALTER TABLE tenant_portability_requests
  ADD COLUMN automation_state text NOT NULL DEFAULT 'queued'
    CHECK (automation_state IN ('queued','checking','submitting','operator_pending','scheduled','completing','completed','action_required','failed','cancelling','cancelled')),
  ADD COLUMN automation_attempts integer NOT NULL DEFAULT 0 CHECK (automation_attempts >= 0),
  ADD COLUMN automation_next_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN automation_last_error text,
  ADD COLUMN automation_last_sync_at timestamptz,
  ADD COLUMN operator_status text,
  ADD COLUMN target_api_connection_id bigint REFERENCES carrier_connections(id);

CREATE INDEX tenant_portability_requests_automation_due_idx
  ON tenant_portability_requests(automation_next_at,id)
  WHERE status NOT IN ('ported','rejected','cancelled')
    AND automation_state IN ('queued','checking','submitting','operator_pending','scheduled','action_required','failed');

CREATE TABLE portability_operator_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  portability_request_id bigint NOT NULL REFERENCES tenant_portability_requests(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  carrier_id bigint REFERENCES carriers(id),
  carrier_connection_id bigint REFERENCES carrier_connections(id),
  direction text NOT NULL CHECK (direction IN ('outbound','inbound')),
  event_type text NOT NULL,
  provider_event_id text,
  operator_reference text,
  http_status integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  sanitized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX portability_operator_events_provider_unique
  ON portability_operator_events(carrier_id,provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX portability_operator_events_request_time_idx
  ON portability_operator_events(portability_request_id,occurred_at DESC,id DESC);

CREATE VIEW tenant_scoped_portability_requests_v4
WITH (security_barrier=true)
AS
SELECT
  v.*,
  p.automation_state,p.automation_attempts,p.automation_next_at,p.automation_last_error,
  p.automation_last_sync_at,p.operator_status,p.target_api_connection_id
FROM tenant_scoped_portability_requests_v3 v
JOIN tenant_portability_requests p ON p.id=v.id
WHERE p.tenant_id=pgi_require_tenant_context();

COMMENT ON COLUMN tenant_portability_requests.automation_state IS
'PGI-side portability orchestration state. Operator API failures are retried or surfaced as an exception without requiring normal customer intervention.';

COMMENT ON TABLE portability_operator_events IS
'Sanitized operator portability exchanges. Raw RIO, credentials, authorization headers and secrets must never be persisted here.';
