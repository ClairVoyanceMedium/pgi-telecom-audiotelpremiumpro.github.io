BEGIN;

CREATE TABLE tenant_internal_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  author_user_id bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by bigint REFERENCES app_users(id),
  CHECK (archived_at IS NULL OR archived_at>=created_at)
);

CREATE INDEX tenant_internal_notes_active_idx
  ON tenant_internal_notes(tenant_id,created_at DESC,id DESC)
  WHERE archived_at IS NULL;

COMMENT ON TABLE tenant_internal_notes IS
'Private PGI staff notes attached to a customer tenant. Never exposed to customer portal or public exports.';

COMMIT;
