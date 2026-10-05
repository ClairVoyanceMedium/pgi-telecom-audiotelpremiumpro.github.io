-- Audiotel Premium Pro : automated referral reward payouts.
-- Dedicated Stripe recipient accounts keep referral transfers isolated from direct card-payment accounts.

CREATE TABLE IF NOT EXISTS customer_referral_payout_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_account_reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','onboarding','restricted','active','disabled')),
  transfers_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  requirements_state text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_referral_payout_accounts_status_idx
  ON customer_referral_payout_accounts(status,transfers_enabled,updated_at DESC);

DROP TRIGGER IF EXISTS customer_referral_payout_accounts_touch_updated ON customer_referral_payout_accounts;
CREATE TRIGGER customer_referral_payout_accounts_touch_updated
BEFORE UPDATE ON customer_referral_payout_accounts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_state text NOT NULL DEFAULT 'pending'
    CHECK (payout_state IN ('pending','processing','waiting_account','retry','transferred','manual','cancelled')),
  ADD COLUMN IF NOT EXISTS payout_attempt_count integer NOT NULL DEFAULT 0 CHECK (payout_attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS payout_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_last_error text,
  ADD COLUMN IF NOT EXISTS payout_destination_reference text,
  ADD COLUMN IF NOT EXISTS provider_transfer_reference text,
  ADD COLUMN IF NOT EXISTS payout_completed_at timestamptz;

UPDATE customer_referral_rewards
SET payout_state=CASE
      WHEN status='paid' THEN 'manual'
      WHEN status='cancelled' THEN 'cancelled'
      ELSE payout_state
    END,
    payout_completed_at=CASE WHEN status='paid' THEN COALESCE(payout_completed_at,paid_at) ELSE payout_completed_at END
WHERE (status='paid' AND payout_state<>'manual')
   OR (status='cancelled' AND payout_state<>'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_transfer_ref_uidx
  ON customer_referral_rewards(provider_transfer_reference)
  WHERE provider_transfer_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_referral_rewards_auto_payout_due_idx
  ON customer_referral_rewards(status,payout_state,payout_next_attempt_at,earned_at,id)
  WHERE status='earned';

COMMENT ON TABLE customer_referral_payout_accounts IS
'Dedicated Stripe Accounts v2 recipient accounts used only to receive automatic referral reward transfers from PGI.';
COMMENT ON COLUMN customer_referral_payout_accounts.transfers_enabled IS
'True only when configuration.recipient.capabilities.stripe_balance.stripe_transfers.status is active.';
COMMENT ON COLUMN customer_referral_rewards.payout_state IS
'Automation state for referral settlement. status=paid remains the accounting source of truth only after confirmed transfer or explicit manual settlement.';
COMMENT ON COLUMN customer_referral_rewards.provider_transfer_reference IS
'Stripe transfer ID. Unique to make provider settlement traceable and resistant to duplicate accounting.';
