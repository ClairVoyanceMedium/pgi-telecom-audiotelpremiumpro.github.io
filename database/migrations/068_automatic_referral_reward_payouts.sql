-- PGI Telecom : automatic referral reward payouts through Stripe Connect.
-- Expand-only migration. Existing earned rewards remain payable and are picked up automatically.

ALTER TABLE tenant_card_payment_accounts
  ADD COLUMN IF NOT EXISTS transfers_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_requirements_state text,
  ADD COLUMN IF NOT EXISTS transfer_last_synced_at timestamptz;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_last_error_code text,
  ADD COLUMN IF NOT EXISTS payout_destination_reference text,
  ADD COLUMN IF NOT EXISTS payout_transfer_reference text;

ALTER TABLE customer_referral_rewards
  DROP CONSTRAINT IF EXISTS customer_referral_rewards_status_check;

ALTER TABLE customer_referral_rewards
  ADD CONSTRAINT customer_referral_rewards_status_check
  CHECK (status IN ('earned','processing','action_required','retry','paid','cancelled'));

ALTER TABLE customer_referral_rewards
  ADD CONSTRAINT customer_referral_rewards_payout_attempt_count_check
  CHECK (payout_attempt_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_transfer_ref_uidx
  ON customer_referral_rewards(payout_transfer_reference)
  WHERE payout_transfer_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_referral_rewards_payout_due_idx
  ON customer_referral_rewards(status,payout_next_attempt_at,earned_at,id)
  WHERE status IN ('earned','processing','action_required','retry');

COMMENT ON COLUMN tenant_card_payment_accounts.transfers_enabled IS
'True only when Stripe confirms that the connected account can receive platform transfers for automated referral rewards.';

COMMENT ON COLUMN customer_referral_rewards.payout_transfer_reference IS
'Stripe transfer identifier used as both financial evidence and anti-duplication trace for automatic referral reward settlement.';
