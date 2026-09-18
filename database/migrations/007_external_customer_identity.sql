-- PGI Telecom — external customer identity boundary.
-- External tenant users are intentionally separate from app_users (PGI staff/control-plane users).

ALTER TABLE tenants
  ADD COLUMN authorization_version bigint NOT NULL DEFAULT 1 CHECK (authorization_version > 0);

CREATE TABLE customer_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  display_name text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','suspended','closed')),
  preferred_locale text NOT NULL DEFAULT 'fr-FR',
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  email_verified boolean NOT NULL DEFAULT false,
  last_authenticated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customer_principals_email_unique
  ON customer_principals(email_normalized);
CREATE INDEX customer_principals_status_idx
  ON customer_principals(status,created_at DESC);

CREATE TABLE customer_identities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_principal_id uuid NOT NULL REFERENCES customer_principals(id) ON DELETE CASCADE,
  identity_provider_id bigint NOT NULL REFERENCES identity_providers(id),
  provider_subject text NOT NULL,
  email_at_provider text,
  claims_version bigint NOT NULL DEFAULT 1 CHECK (claims_version > 0),
  last_authenticated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_provider_id,provider_subject)
);

CREATE INDEX customer_identities_principal_idx
  ON customer_identities(customer_principal_id,identity_provider_id);

CREATE TABLE customer_tenant_memberships (
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_principal_id uuid NOT NULL REFERENCES customer_principals(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (role IN ('owner','admin','finance','operator','analyst','readonly')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','suspended','revoked')),
  permission_grants text[] NOT NULL DEFAULT ARRAY[]::text[],
  permission_denials text[] NOT NULL DEFAULT ARRAY[]::text[],
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,customer_principal_id)
);

CREATE INDEX customer_tenant_memberships_principal_idx
  ON customer_tenant_memberships(customer_principal_id,status,tenant_id);
CREATE INDEX customer_tenant_memberships_tenant_role_idx
  ON customer_tenant_memberships(tenant_id,status,role,customer_principal_id);

CREATE TABLE customer_tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  role text NOT NULL
    CHECK (role IN ('owner','admin','finance','operator','analyst','readonly')),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at timestamptz NOT NULL,
  invited_by_customer_principal_id uuid REFERENCES customer_principals(id),
  invited_by_app_user_id bigint REFERENCES app_users(id),
  accepted_by_customer_principal_id uuid REFERENCES customer_principals(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_tenant_invitations_tenant_idx
  ON customer_tenant_invitations(tenant_id,status,created_at DESC);
CREATE INDEX customer_tenant_invitations_email_idx
  ON customer_tenant_invitations(email_normalized,status,expires_at);

CREATE TABLE customer_refresh_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_principal_id uuid NOT NULL REFERENCES customer_principals(id) ON DELETE CASCADE,
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  refresh_token_hash char(64) NOT NULL UNIQUE,
  session_family_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  user_agent_hash char(64),
  ip_hash char(64),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (expires_at > issued_at)
);

CREATE INDEX customer_refresh_sessions_principal_idx
  ON customer_refresh_sessions(customer_principal_id,revoked_at,expires_at DESC);
CREATE INDEX customer_refresh_sessions_tenant_idx
  ON customer_refresh_sessions(tenant_id,revoked_at,expires_at DESC)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX customer_refresh_sessions_expiry_idx
  ON customer_refresh_sessions(expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE customer_api_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  client_id text NOT NULL UNIQUE,
  credential_hash char(64) NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','rotating','suspended','revoked')),
  rate_limit_profile text,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_api_clients_tenant_idx
  ON customer_api_clients(tenant_id,status,created_at DESC);

CREATE FUNCTION pgi_bump_tenant_authorization_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_tenant_id bigint;
BEGIN
  v_tenant_id=COALESCE(NEW.tenant_id,OLD.tenant_id);
  UPDATE tenants
  SET authorization_version=authorization_version+1,
      updated_at=now()
  WHERE id=v_tenant_id;
  RETURN COALESCE(NEW,OLD);
END;
$$;

CREATE TRIGGER customer_membership_authorization_version
AFTER INSERT OR UPDATE OR DELETE ON customer_tenant_memberships
FOR EACH ROW EXECUTE FUNCTION pgi_bump_tenant_authorization_version();
