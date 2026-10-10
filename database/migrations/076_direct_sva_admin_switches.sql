-- Two separate administrator switches for PGI direct SVA distribution.
-- First switch controls PRIVATE administrative interface preview only.
-- Second switch is structurally locked OFF until a later independently reviewed
-- regulatory, financial and operational release migration.
-- This migration does not change existing Audiotel tables or activate any route.

CREATE TABLE IF NOT EXISTS direct_sva_admin_switches (
 id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
 interface_preview_enabled boolean NOT NULL DEFAULT false,
 commercial_operation_enabled boolean NOT NULL DEFAULT false
   CHECK (commercial_operation_enabled=false),
 last_changed_at timestamptz NOT NULL DEFAULT now(),
 last_changed_by_hash char(64)
   CHECK (last_changed_by_hash IS NULL OR last_changed_by_hash ~ '^[0-9a-f]{64}$')
);
INSERT INTO direct_sva_admin_switches(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS direct_sva_admin_switch_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 switch_name text NOT NULL CHECK(switch_name IN ('interface_preview','commercial_operation')),
 previous_value boolean NOT NULL,
 requested_value boolean NOT NULL,
 resulting_value boolean NOT NULL,
 result text NOT NULL CHECK(result IN ('applied','unchanged','refused')),
 actor_hash char(64) NOT NULL CHECK(actor_hash ~ '^[0-9a-f]{64}$'),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 8 AND 240),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS direct_sva_admin_switch_audit_recent_idx
 ON direct_sva_admin_switch_audit(occurred_at DESC,id DESC);

CREATE FUNCTION direct_sva_guard_admin_switch_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Direct SVA administration history is append-only';
END;
$$;
CREATE TRIGGER direct_sva_guard_admin_switch_audit_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_admin_switch_audit
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_admin_switch_audit_immutable();

-- Safety invariant: switching ON the first control neither changes legal status
-- nor activates client permissions, provisioning, payments, CRM or analytics.
-- The second control can only be unlocked by a future migration and approval.
