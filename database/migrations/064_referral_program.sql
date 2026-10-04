-- Audiotel Premium Pro — programme de parrainage durable, désactivable et auditable.
-- Les conditions financières sont figées au moment de l'attribution afin qu'un changement ultérieur
-- du programme n'altère jamais un parrainage déjà accepté.

CREATE TABLE platform_referral_program (
  singleton_key text PRIMARY KEY DEFAULT 'default' CHECK (singleton_key='default'),
  enabled boolean NOT NULL DEFAULT false,
  reward_amount_minor integer CHECK (reward_amount_minor IS NULL OR reward_amount_minor>0),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  reward_label text NOT NULL DEFAULT 'Crédit parrainage',
  terms_version text NOT NULL DEFAULT '2026-10-04-v1',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_referral_program(singleton_key,enabled,reward_amount_minor,currency,reward_label,terms_version)
VALUES('default',false,NULL,'EUR','Crédit parrainage','2026-10-04-v1')
ON CONFLICT(singleton_key) DO NOTHING;

CREATE TABLE tenant_referral_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{8,20}$'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id)
);

CREATE INDEX tenant_referral_codes_active_idx
  ON tenant_referral_codes(active,tenant_id);

CREATE TABLE tenant_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  sponsor_tenant_id bigint NOT NULL REFERENCES tenants(id),
  referred_tenant_id bigint NOT NULL REFERENCES tenants(id),
  referral_code_id bigint NOT NULL REFERENCES tenant_referral_codes(id),
  status text NOT NULL DEFAULT 'captured'
    CHECK (status IN ('captured','qualified','rejected','cancelled')),
  source text NOT NULL DEFAULT 'public_opening',
  reward_amount_minor integer NOT NULL CHECK (reward_amount_minor>0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reward_label text NOT NULL,
  terms_version text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  qualification_reason text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sponsor_tenant_id<>referred_tenant_id),
  UNIQUE (referred_tenant_id)
);

CREATE INDEX tenant_referrals_sponsor_idx
  ON tenant_referrals(sponsor_tenant_id,status,captured_at DESC);
CREATE INDEX tenant_referrals_referred_idx
  ON tenant_referrals(referred_tenant_id,status);

CREATE TABLE tenant_referral_rewards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  referral_id bigint NOT NULL UNIQUE REFERENCES tenant_referrals(id),
  sponsor_tenant_id bigint NOT NULL REFERENCES tenants(id),
  referred_tenant_id bigint NOT NULL REFERENCES tenants(id),
  amount_minor integer NOT NULL CHECK (amount_minor>0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  reward_label text NOT NULL,
  status text NOT NULL DEFAULT 'earned'
    CHECK (status IN ('earned','settled','void')),
  earned_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  settlement_reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_referral_rewards_sponsor_idx
  ON tenant_referral_rewards(sponsor_tenant_id,status,earned_at DESC);

COMMENT ON TABLE platform_referral_program IS
'Global referral-program switch and current commercial terms. Disabled means no new referral attribution is accepted.';
COMMENT ON TABLE tenant_referrals IS
'Referral attribution with immutable reward terms snapshotted at capture time. Historical rows remain when the global program is disabled.';
COMMENT ON TABLE tenant_referral_rewards IS
'Reward ledger created only after the referred tenant is active and has an active SVA number assignment.';
