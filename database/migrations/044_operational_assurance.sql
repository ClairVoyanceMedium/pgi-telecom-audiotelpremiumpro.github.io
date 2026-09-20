-- PGI Telecom — operational assurance & four-eyes control.
-- Expand-only. No external operator, APNF/RSVA, payment or Stripe connection is activated.

BEGIN;

CREATE TABLE platform_change_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  change_type text NOT NULL
    CHECK (change_type IN ('carrier_switch_activation','payout_release','regulatory_override','tenant_mass_action')),
  entity_type text NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 80),
  entity_id text NOT NULL CHECK (char_length(entity_id) BETWEEN 1 AND 160),
  risk_level text NOT NULL DEFAULT 'critical'
    CHECK (risk_level IN ('high','critical')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','executed','cancelled','expired')),
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  request_reason text,
  requested_by bigint NOT NULL REFERENCES app_users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
  approved_by bigint REFERENCES app_users(id),
  approved_at timestamptz,
  rejected_by bigint REFERENCES app_users(id),
  rejected_at timestamptz,
  decision_reason text,
  executed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at>requested_at),
  CHECK (approved_by IS NULL OR approved_by<>requested_by),
  CHECK (rejected_by IS NULL OR rejected_by<>requested_by),
  CHECK (
    (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status<>'approved'
  ),
  CHECK (
    (status='rejected' AND rejected_by IS NOT NULL AND rejected_at IS NOT NULL)
    OR status<>'rejected'
  ),
  CHECK (
    (status='executed' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND executed_at IS NOT NULL)
    OR status<>'executed'
  )
);

CREATE UNIQUE INDEX platform_change_requests_active_entity_idx
  ON platform_change_requests(change_type,entity_type,entity_id)
  WHERE status IN ('pending','approved');

CREATE INDEX platform_change_requests_status_time_idx
  ON platform_change_requests(status,expires_at,id DESC);

CREATE TABLE platform_change_approval_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  change_request_id bigint NOT NULL REFERENCES platform_change_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('requested','approved','rejected','executed','cancelled','expired')),
  actor_id bigint REFERENCES app_users(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_sha256 char(64) CHECK (previous_sha256 IS NULL OR previous_sha256 ~ '^[0-9a-f]{64}$'),
  event_sha256 char(64) NOT NULL UNIQUE CHECK (event_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_change_approval_events_request_idx
  ON platform_change_approval_events(change_request_id,id);

CREATE FUNCTION pgi_prevent_change_approval_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_change_approval_events is append-only';
END;
$$;

CREATE TRIGGER platform_change_approval_events_no_mutation
BEFORE UPDATE OR DELETE ON platform_change_approval_events
FOR EACH ROW EXECUTE FUNCTION pgi_prevent_change_approval_event_mutation();

COMMENT ON TABLE platform_change_requests IS
'Four-eyes workflow for critical PGI control-plane changes. Requester and approver must be different staff users.';

COMMENT ON TABLE platform_change_approval_events IS
'Append-only SHA-256 chained history of critical-change approvals. It never contains carrier or payment secrets.';

COMMIT;
