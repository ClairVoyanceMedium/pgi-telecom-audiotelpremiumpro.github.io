-- PGI Telecom — croissance simple : portabilité prioritaire et parrainage.
-- Expand-only. La portabilité standard reste gratuite et conserve la file normale.

ALTER TABLE tenant_portability_requests
  ADD COLUMN IF NOT EXISTS priority_service_status text NOT NULL DEFAULT 'standard'
    CHECK (priority_service_status IN ('standard','payment_pending','paid','cancelled','refunded')),
  ADD COLUMN IF NOT EXISTS priority_fee_minor integer NOT NULL DEFAULT 990
    CHECK (priority_fee_minor >= 0),
  ADD COLUMN IF NOT EXISTS priority_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (priority_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN IF NOT EXISTS priority_checkout_reference text,
  ADD COLUMN IF NOT EXISTS priority_payment_intent_reference text,
  ADD COLUMN IF NOT EXISTS priority_paid_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_portability_requests_priority_checkout_uidx
  ON tenant_portability_requests(priority_checkout_reference)
  WHERE priority_checkout_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_portability_requests_priority_status_idx
  ON tenant_portability_requests(priority_service_status,created_at DESC);

CREATE TABLE IF NOT EXISTS tenant_referral_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  code varchar(24) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  referred_tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  referral_code varchar(24) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','qualified','rewarded','rejected')),
  reward_minor integer NOT NULL DEFAULT 300 CHECK (reward_minor >= 0),
  reward_currency char(3) NOT NULL DEFAULT 'EUR' CHECK (reward_currency ~ '^[A-Z]{3}$'),
  qualification_reason text,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  provider_reward_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_tenant_id <> referred_tenant_id)
);

CREATE INDEX IF NOT EXISTS tenant_referrals_referrer_idx
  ON tenant_referrals(referrer_tenant_id,created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_referrals_status_idx
  ON tenant_referrals(status,created_at DESC);

DROP TRIGGER IF EXISTS tenant_referrals_touch_updated ON tenant_referrals;
CREATE TRIGGER tenant_referrals_touch_updated
BEFORE UPDATE ON tenant_referrals
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON COLUMN tenant_portability_requests.priority_service_status IS
'Optional 9.90 EUR TTC PGI internal dossier priority. Standard portability remains free. Paid priority never guarantees an operator porting date.';
COMMENT ON TABLE tenant_referrals IS
'Referral attribution. Reward is granted only after a referred tenant reaches a real active SVA service state.';
COMMENT ON COLUMN tenant_referrals.reward_minor IS
'Referral acquisition reward. Launch value 300 cents = one additional 3 EUR subscription month credited to the referrer.';
