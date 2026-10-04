-- Audiotel Premium Pro : customer referral program.
-- Fail-closed for new claims, immutable reward snapshots, historical claims retained.

CREATE TABLE platform_feature_flags (
  feature_key text PRIMARY KEY CHECK (feature_key ~ '^[a-z0-9_.-]{2,80}$'),
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES ('customer_referral',false,'{"reward_minor":0,"currency":"EUR","qualification":"paid_active_subscription"}'::jsonb)
ON CONFLICT(feature_key) DO NOTHING;

CREATE TABLE customer_referral_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{8,24}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE customer_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  referral_code_id bigint NOT NULL REFERENCES customer_referral_codes(id) ON DELETE RESTRICT,
  referrer_tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  referred_tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','qualified','rewarded','rejected')),
  reward_minor bigint NOT NULL CHECK (reward_minor >= 0),
  reward_currency char(3) NOT NULL DEFAULT 'EUR' CHECK (reward_currency ~ '^[A-Z]{3}$'),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  qualification_subscription_id bigint REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (referrer_tenant_id <> referred_tenant_id)
);

CREATE INDEX customer_referrals_referrer_idx ON customer_referrals(referrer_tenant_id,claimed_at DESC,id DESC);
CREATE INDEX customer_referrals_status_idx ON customer_referrals(status,claimed_at DESC,id DESC);

CREATE TABLE customer_referral_rewards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  referral_id bigint NOT NULL UNIQUE REFERENCES customer_referrals(id) ON DELETE RESTRICT,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'earned' CHECK (status IN ('earned','paid','cancelled')),
  earned_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  paid_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_referral_rewards_tenant_idx ON customer_referral_rewards(tenant_id,status,earned_at DESC,id DESC);

CREATE TRIGGER platform_feature_flags_touch_updated
BEFORE UPDATE ON platform_feature_flags
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE platform_feature_flags IS
'Authoritative server-side feature controls. Disabled features remain fail-closed even when an old client or URL attempts to use them.';
COMMENT ON TABLE customer_referrals IS
'Referral claims. Reward amount/currency are frozen at claim time; qualification occurs only after a paid active subscription.';
COMMENT ON TABLE customer_referral_rewards IS
'Append-only commercial reward ledger for qualified customer referrals. Earning is automatic; payment settlement remains explicitly traceable.';
