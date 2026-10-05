-- Audiotel Premium Pro : versements automatiques des primes ambassadeurs.
-- Migration additive, idempotente et sans stockage de coordonnées bancaires.
CREATE TABLE IF NOT EXISTS tenant_referral_payout_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_account_reference text NOT NULL UNIQUE CHECK (provider_account_reference ~ '^acct_[A-Za-z0-9]+$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','onboarding','restricted','active','disabled')),
  transfers_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  requirements_state text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'pending';
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS payout_destination_account_reference text;
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS provider_transfer_reference text;
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS payout_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS payout_last_attempt_at timestamptz;
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS payout_next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS payout_last_error text;
ALTER TABLE customer_referral_rewards ADD COLUMN IF NOT EXISTS payout_updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_provider_transfer_uidx ON customer_referral_rewards(provider_transfer_reference) WHERE provider_transfer_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS customer_referral_rewards_payout_due_idx ON customer_referral_rewards(status,payout_status,payout_next_attempt_at,id);
CREATE INDEX IF NOT EXISTS tenant_referral_payout_accounts_status_idx ON tenant_referral_payout_accounts(status,updated_at DESC,id DESC);
UPDATE customer_referral_rewards SET payout_status='paid',provider_transfer_reference=CASE WHEN paid_reference ~ '^tr_[A-Za-z0-9]+$' THEN paid_reference ELSE provider_transfer_reference END,payout_updated_at=now() WHERE status='paid' AND payout_status<>'paid';
COMMENT ON TABLE tenant_referral_payout_accounts IS 'Compte de versement ambassadeur. Aucune coordonnée bancaire n est stockée dans PGI.';
COMMENT ON COLUMN customer_referral_rewards.provider_transfer_reference IS 'Référence du transfert prestataire confirmant le versement automatique.';
