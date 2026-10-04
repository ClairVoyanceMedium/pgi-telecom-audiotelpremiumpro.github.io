BEGIN;

CREATE TABLE platform_feature_controls (
  feature_key text PRIMARY KEY
    CHECK (feature_key ~ '^[a-z][a-z0-9_]{2,80}$'),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(config)='object'),
  updated_by bigint REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_feature_controls(feature_key,enabled,config)
VALUES (
  'referral_program',
  true,
  '{"reward_mode":"manual","reward_label":"Avantage de parrainage après activation du filleul"}'::jsonb
)
ON CONFLICT(feature_key) DO NOTHING;

CREATE TABLE tenant_referral_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE
    CHECK (code ~ '^PGI-[A-Z0-9]{12,24}$'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referral_attributions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  referrer_tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  referred_tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  referral_code text NOT NULL,
  status text NOT NULL DEFAULT 'lead'
    CHECK (status IN ('lead','converted','rewarded','rejected')),
  source text NOT NULL DEFAULT 'public_opening'
    CHECK (source IN ('public_opening','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_tenant_id<>referred_tenant_id)
);

CREATE INDEX referral_attributions_referrer_status_idx
  ON referral_attributions(referrer_tenant_id,status,created_at DESC,id DESC);

CREATE INDEX referral_attributions_created_idx
  ON referral_attributions(created_at DESC,id DESC);

COMMENT ON TABLE platform_feature_controls IS
'Global operational feature switches. Disabling a feature must not delete its historical data.';
COMMENT ON TABLE tenant_referral_codes IS
'Stable customer referral codes. Codes are identifiers, never authentication secrets.';
COMMENT ON TABLE referral_attributions IS
'Referral attribution history. Existing rows are preserved when the referral program is disabled.';

COMMIT;
