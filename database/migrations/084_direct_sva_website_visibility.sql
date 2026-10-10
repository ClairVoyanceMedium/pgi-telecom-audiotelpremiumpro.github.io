-- Preparation only: SEO-preserving presentation switch, independent of commercial operation.
-- Content launch stays blocked by a structural CHECK until a separately reviewed migration.
CREATE TABLE IF NOT EXISTS direct_sva_website_visibility (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  public_content_authorized boolean NOT NULL DEFAULT false CHECK(public_content_authorized=false),
  navigation_enabled boolean NOT NULL DEFAULT false,
  commercial_calls_to_action_enabled boolean NOT NULL DEFAULT false CHECK(commercial_calls_to_action_enabled=false),
  changed_at timestamptz NOT NULL DEFAULT now(),
  actor_hash char(64) CHECK(actor_hash IS NULL OR actor_hash ~ '^[0-9a-f]{64}$')
);
INSERT INTO direct_sva_website_visibility(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
CREATE TABLE IF NOT EXISTS direct_sva_website_visibility_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT now(),
  switch_name text NOT NULL DEFAULT 'navigation_enabled' CHECK(switch_name='navigation_enabled'),
  previous_value boolean NOT NULL,
  requested_value boolean NOT NULL,
  result text NOT NULL CHECK(result IN ('applied','unchanged')),
  actor_hash char(64) NOT NULL CHECK(actor_hash ~ '^[0-9a-f]{64}$'),
  evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 8 AND 240)
);
CREATE FUNCTION direct_sva_website_visibility_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Direct SVA website visibility history is append-only'; END;
$$;
CREATE TRIGGER direct_sva_website_visibility_audit_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_website_visibility_audit
 FOR EACH ROW EXECUTE FUNCTION direct_sva_website_visibility_audit_immutable();
