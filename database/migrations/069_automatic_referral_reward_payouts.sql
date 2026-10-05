-- Audiotel Premium Pro : durable automatic referral reward payouts.
-- Each earned reward remains an accounting liability until a real provider transfer is confirmed.

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_provider text,
  ADD COLUMN IF NOT EXISTS payout_destination_reference text,
  ADD COLUMN IF NOT EXISTS payout_transfer_reference text,
  ADD COLUMN IF NOT EXISTS payout_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payout_last_error text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='customer_referral_rewards_payout_state_check'
      AND conrelid='customer_referral_rewards'::regclass
  ) THEN
    ALTER TABLE customer_referral_rewards
      ADD CONSTRAINT customer_referral_rewards_payout_state_check
      CHECK (payout_state IN ('pending','processing','awaiting_account','retry','paid','manual_paid','cancelled'));
  END IF;
END
$$;

UPDATE customer_referral_rewards
SET payout_state=CASE
  WHEN status='paid' THEN 'manual_paid'
  WHEN status='cancelled' THEN 'cancelled'
  ELSE 'pending'
END
WHERE payout_state='pending';

CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_transfer_unique
  ON customer_referral_rewards(payout_provider,payout_transfer_reference)
  WHERE payout_transfer_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_referral_rewards_auto_due_idx
  ON customer_referral_rewards(payout_next_attempt_at,id)
  WHERE status='earned';

COMMENT ON COLUMN customer_referral_rewards.payout_state IS
'Automatic referral payout orchestration state. Accounting status stays earned until a real provider transfer is confirmed.';
COMMENT ON COLUMN customer_referral_rewards.payout_transfer_reference IS
'Provider transfer reference proving that the earned referral reward was actually moved to the beneficiary account.';
