-- PGI Telecom : automatic referral reward payouts through Stripe Connect.
-- Expand-only migration. Existing reward ledger statuses remain unchanged.

ALTER TABLE tenant_card_payment_accounts
  ADD COLUMN IF NOT EXISTS transfers_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_requirements_state text,
  ADD COLUMN IF NOT EXISTS transfer_last_synced_at timestamptz;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_last_error_code text,
  ADD COLUMN IF NOT EXISTS payout_destination_reference text,
  ADD COLUMN IF NOT EXISTS payout_transfer_reference text;

ALTER TABLE customer_referral_rewards
  ADD CONSTRAINT customer_referral_rewards_payout_state_check
  CHECK (payout_state IN ('pending','processing','action_required','retry','paid','cancelled'));

ALTER TABLE customer_referral_rewards
  ADD CONSTRAINT customer_referral_rewards_payout_attempt_count_check
  CHECK (payout_attempt_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_transfer_ref_uidx
  ON customer_referral_rewards(payout_transfer_reference)
  WHERE payout_transfer_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_referral_rewards_payout_due_idx
  ON customer_referral_rewards(status,payout_state,payout_next_attempt_at,earned_at,id)
  WHERE status='earned' AND payout_state IN ('pending','processing','action_required','retry');

COMMENT ON COLUMN tenant_card_payment_accounts.transfers_enabled IS
'True only when Stripe confirms that the connected account can receive platform transfers for automated referral rewards.';

COMMENT ON COLUMN customer_referral_rewards.payout_state IS
'Operational payout state kept separate from the immutable financial ledger status so migrations remain expand-only.';

COMMENT ON COLUMN customer_referral_rewards.payout_transfer_reference IS
'Stripe transfer identifier used as both financial evidence and anti-duplication trace for automatic referral reward settlement.';
