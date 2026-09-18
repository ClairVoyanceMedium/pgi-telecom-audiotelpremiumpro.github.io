-- PGI Telecom — hyperscale identity, entitlement and customer-lifecycle foundation.
-- Additive only. Keeps the current administrator login intact while preparing self-service tenants.

ALTER TABLE app_users
  ADD COLUMN public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'fr-FR',
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Paris';

CREATE UNIQUE INDEX app_users_public_id_unique ON app_users(public_id);
CREATE INDEX app_users_email_normalized_idx ON app_users(lower(email)) WHERE enabled;

CREATE TABLE identity_providers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_key text NOT NULL UNIQUE,
  provider_type text NOT NULL
    CHECK (provider_type IN ('oidc','saml','password','magic_link','other')),
  issuer text,
  state text NOT NULL DEFAULT 'planned'
    CHECK (state IN ('planned','testing','active','suspended','closed')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_identities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  identity_provider_id bigint NOT NULL REFERENCES identity_providers(id),
  provider_subject text NOT NULL,
  email_at_provider text,
  email_verified boolean NOT NULL DEFAULT false,
  last_authenticated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identity_provider_id,provider_subject)
);

CREATE INDEX user_identities_user_idx ON user_identities(user_id,identity_provider_id);

CREATE TABLE tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL
    CHECK (role IN ('owner','admin','finance','operator','readonly')),
  invited_by bigint REFERENCES app_users(id),
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accepted','expired','revoked')),
  expires_at timestamptz NOT NULL,
  accepted_by bigint REFERENCES app_users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_invitations_tenant_status_idx
  ON tenant_invitations(tenant_id,status,created_at DESC);
CREATE INDEX tenant_invitations_email_status_idx
  ON tenant_invitations(lower(email),status);

CREATE TABLE service_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','revoked')),
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_by bigint REFERENCES app_users(id),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_accounts_tenant_status_idx
  ON service_accounts(tenant_id,status,created_at DESC);

CREATE TABLE service_account_credentials (
  credential_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
  secret_hash char(64) NOT NULL UNIQUE,
  prefix text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','rotating','revoked','expired')),
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_account_credentials_account_idx
  ON service_account_credentials(service_account_id,status);

CREATE TABLE service_plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft','active','retired')),
  billing_model text NOT NULL DEFAULT 'contract'
    CHECK (billing_model IN ('contract','subscription','usage','hybrid')),
  default_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO service_plans(plan_key,display_name,status,billing_model,default_currency)
VALUES ('enterprise-contract','Enterprise Contract','active','contract','EUR')
ON CONFLICT (plan_key) DO NOTHING;

CREATE TABLE plan_entitlements (
  service_plan_id bigint NOT NULL REFERENCES service_plans(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  value_type text NOT NULL
    CHECK (value_type IN ('boolean','integer','decimal','text','json')),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_plan_id,entitlement_key)
);

CREATE TABLE tenant_subscriptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_plan_id bigint NOT NULL REFERENCES service_plans(id),
  market_id bigint REFERENCES operating_markets(id),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('trial','active','past_due','suspended','cancelled','ended')),
  billing_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (billing_currency ~ '^[A-Z]{3}$'),
  external_billing_reference text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  current_period_start timestamptz,
  current_period_end timestamptz,
  ends_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE INDEX tenant_subscriptions_tenant_status_idx
  ON tenant_subscriptions(tenant_id,status,current_period_end DESC);
CREATE INDEX tenant_subscriptions_plan_status_idx
  ON tenant_subscriptions(service_plan_id,status,tenant_id);

CREATE TABLE tenant_entitlement_overrides (
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entitlement_key text NOT NULL,
  value_type text NOT NULL
    CHECK (value_type IN ('boolean','integer','decimal','text','json')),
  value jsonb NOT NULL,
  reason text,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  created_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,entitlement_key,valid_from),
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX tenant_entitlement_overrides_active_idx
  ON tenant_entitlement_overrides(tenant_id,entitlement_key,valid_from DESC);

CREATE TABLE tenant_usage_counters (
  tenant_bucket smallint NOT NULL CHECK (tenant_bucket BETWEEN 0 AND 4095),
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  metric_key text NOT NULL,
  quantity numeric(20,6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_bucket,tenant_id,usage_date,metric_key)
) PARTITION BY HASH (tenant_bucket);

DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format(
      'CREATE TABLE tenant_usage_counters_p%s PARTITION OF tenant_usage_counters FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
      i,i
    );
  END LOOP;
END;
$$;

CREATE INDEX tenant_usage_counters_tenant_date_idx
  ON tenant_usage_counters(tenant_id,usage_date DESC,metric_key);

CREATE TABLE tenant_quota_policies (
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quota_key text NOT NULL,
  window_type text NOT NULL
    CHECK (window_type IN ('minute','hour','day','month','concurrent')),
  soft_limit numeric(20,6),
  hard_limit numeric(20,6),
  action_on_hard_limit text NOT NULL DEFAULT 'reject'
    CHECK (action_on_hard_limit IN ('reject','throttle','alert_only')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,quota_key),
  CHECK (soft_limit IS NULL OR soft_limit >= 0),
  CHECK (hard_limit IS NULL OR hard_limit >= 0),
  CHECK (soft_limit IS NULL OR hard_limit IS NULL OR soft_limit <= hard_limit)
);

CREATE TABLE tenant_lifecycle_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id bigint REFERENCES app_users(id),
  correlation_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX tenant_lifecycle_events_tenant_time_idx
  ON tenant_lifecycle_events(tenant_id,occurred_at DESC,id DESC);
