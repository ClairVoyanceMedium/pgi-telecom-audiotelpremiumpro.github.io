-- Audiotel Premium Pro : programme Ambassadeur et pilotage comptable interne.
-- Migration additive. Les flux comptables restent fondés sur les événements financiers vérifiés.

BEGIN;

CREATE TABLE IF NOT EXISTS platform_feature_flags (
  feature_key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES ('ambassador_program',true,'{"motivation_email_enabled":true,"qualification_paid_invoices":3,"minimum_payout_minor":2000,"currency":"EUR"}'::jsonb)
ON CONFLICT(feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS ambassador_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  display_name text NOT NULL,
  company_name text,
  country_code char(2) NOT NULL DEFAULT 'FR',
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('pending','active','suspended','closed')),
  code text NOT NULL UNIQUE,
  access_token_hash char(64) NOT NULL,
  terms_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  advertising_disclosure_accepted_at timestamptz NOT NULL,
  processing_consent_at timestamptz NOT NULL,
  motivation_email_consent boolean NOT NULL DEFAULT false,
  payout_compliance_status text NOT NULL DEFAULT 'pending' CHECK(payout_compliance_status IN ('pending','verified','blocked')),
  last_activity_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ambassador_profiles_status_idx ON ambassador_profiles(status,created_at DESC);

CREATE TABLE IF NOT EXISTS ambassador_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ambassador_id bigint NOT NULL REFERENCES ambassador_profiles(id) ON DELETE RESTRICT,
  referred_tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','qualified','rejected')),
  qualifying_paid_invoices integer NOT NULL DEFAULT 0 CHECK(qualifying_paid_invoices>=0),
  sequence_number integer,
  base_reward_minor bigint NOT NULL DEFAULT 0 CHECK(base_reward_minor>=0),
  bonus_reward_minor bigint NOT NULL DEFAULT 0 CHECK(bonus_reward_minor>=0),
  currency char(3) NOT NULL DEFAULT 'EUR',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ambassador_referrals_ambassador_idx ON ambassador_referrals(ambassador_id,status,claimed_at DESC);

CREATE TABLE IF NOT EXISTS ambassador_rewards (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  ambassador_id bigint NOT NULL REFERENCES ambassador_profiles(id) ON DELETE RESTRICT,
  referral_id bigint REFERENCES ambassador_referrals(id) ON DELETE RESTRICT,
  reward_kind text NOT NULL CHECK(reward_kind IN ('client','milestone')),
  milestone_number integer,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'earned' CHECK(status IN ('earned','paid','cancelled')),
  earned_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  paid_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status<>'paid' OR (paid_at IS NOT NULL AND paid_reference IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ambassador_rewards_client_unique ON ambassador_rewards(referral_id) WHERE reward_kind='client';
CREATE UNIQUE INDEX IF NOT EXISTS ambassador_rewards_milestone_unique ON ambassador_rewards(ambassador_id,milestone_number) WHERE reward_kind='milestone';
CREATE INDEX IF NOT EXISTS ambassador_rewards_payable_idx ON ambassador_rewards(ambassador_id,status,earned_at DESC);

CREATE TABLE IF NOT EXISTS ambassador_email_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambassador_id bigint NOT NULL REFERENCES ambassador_profiles(id) ON DELETE CASCADE,
  email_key text NOT NULL,
  period_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed')),
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ambassador_id,email_key,period_key)
);

CREATE TABLE IF NOT EXISTS ambassador_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambassador_id bigint REFERENCES ambassador_profiles(id) ON DELETE SET NULL,
  staff_user_id bigint,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS business_accounting_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
  currency char(3) NOT NULL DEFAULT 'EUR',
  vat_mode text NOT NULL DEFAULT 'unconfigured' CHECK(vat_mode IN ('unconfigured','standard','franchise','exempt','other')),
  vat_rate_bps integer CHECK(vat_rate_bps IS NULL OR vat_rate_bps BETWEEN 0 AND 10000),
  fiscal_year_start_month smallint NOT NULL DEFAULT 1 CHECK(fiscal_year_start_month BETWEEN 1 AND 12),
  updated_by bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO business_accounting_settings(id,currency,vat_mode,vat_rate_bps,fiscal_year_start_month)
VALUES(1,'EUR','unconfigured',NULL,1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS business_accounting_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  source_key text NOT NULL UNIQUE,
  source_type text NOT NULL,
  source_id text,
  occurred_at timestamptz NOT NULL,
  tenant_id bigint REFERENCES tenants(id) ON DELETE SET NULL,
  ambassador_id bigint REFERENCES ambassador_profiles(id) ON DELETE SET NULL,
  basis text NOT NULL CHECK(basis IN ('cash','accrual')),
  direction text NOT NULL CHECK(direction IN ('in','out')),
  category text NOT NULL,
  debit_account_code text NOT NULL,
  credit_account_code text NOT NULL,
  amount_minor bigint NOT NULL CHECK(amount_minor>0),
  currency char(3) NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'posted' CHECK(status IN ('posted','needs_review','reversed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_accounting_ledger_period_idx ON business_accounting_ledger(currency,occurred_at DESC,category);

CREATE FUNCTION pgi_prevent_business_accounting_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'business accounting ledger is append-only';
END;
$$;
CREATE TRIGGER business_accounting_ledger_no_mutation
BEFORE UPDATE OR DELETE ON business_accounting_ledger
FOR EACH ROW EXECUTE FUNCTION pgi_prevent_business_accounting_ledger_mutation();

COMMIT;
