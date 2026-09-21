-- PGI Telecom — customer team access audit trail.
-- Additive only. Existing identities, memberships and invitations remain authoritative.

BEGIN;

CREATE TABLE customer_tenant_access_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('invitation_created','invitation_revoked','member_role_changed','member_status_changed')),
  target_customer_principal_id uuid REFERENCES customer_principals(id),
  invitation_id uuid REFERENCES customer_tenant_invitations(id),
  actor_customer_principal_id uuid REFERENCES customer_principals(id),
  previous_role text,
  new_role text,
  previous_status text,
  new_status text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target_customer_principal_id IS NOT NULL OR invitation_id IS NOT NULL)
);

CREATE INDEX customer_tenant_access_events_tenant_time_idx
  ON customer_tenant_access_events(tenant_id,created_at DESC,id DESC);

CREATE INDEX customer_tenant_invitations_pending_tenant_idx
  ON customer_tenant_invitations(tenant_id,created_at DESC)
  WHERE status='pending';

CREATE FUNCTION prevent_customer_tenant_access_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer_tenant_access_events is append-only';
END;
$$;

CREATE TRIGGER customer_tenant_access_events_no_update
BEFORE UPDATE OR DELETE ON customer_tenant_access_events
FOR EACH ROW EXECUTE FUNCTION prevent_customer_tenant_access_event_mutation();

COMMIT;
