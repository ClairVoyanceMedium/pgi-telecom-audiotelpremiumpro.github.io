-- Audiotel Premium Pro : automatic referral payouts through Stripe Connect.
-- Expand-only. Existing reward status remains the accounting source of truth:
-- earned = liability outstanding, paid = provider-confirmed transfer, cancelled = voided.

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_state text NOT NULL DEFAULT 'pending'
    CHECK (payout_state IN ('pending','processing','blocked','paid','cancelled'));

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_provider text;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS provider_destination_reference text;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS provider_transfer_reference text;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_attempts integer NOT NULL DEFAULT 0
    CHECK (payout_attempts >= 0);

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_processing_started_at timestamptz;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_next_attempt_at timestamptz;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_last_error text;

UPDATE customer_referral_rewards
SET payout_state=CASE
  WHEN status='paid' THEN 'paid'
  WHEN status='cancelled' THEN 'cancelled'
  ELSE COALESCE(NULLIF(payout_state,''),'pending')
END
WHERE (status='paid' AND payout_state<>'paid')
   OR (status='cancelled' AND payout_state<>'cancelled')
   OR payout_state IS NULL
   OR payout_state='';

CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_provider_transfer_uidx
  ON customer_referral_rewards(provider_transfer_reference)
  WHERE provider_transfer_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_referral_rewards_auto_payout_queue_idx
  ON customer_referral_rewards(payout_state,payout_next_attempt_at,earned_at,id)
  WHERE status='earned';

COMMENT ON COLUMN customer_referral_rewards.payout_state IS
'Automatic payout orchestration state. Reward status remains earned until the provider transfer is confirmed.';

COMMENT ON COLUMN customer_referral_rewards.provider_transfer_reference IS
'Stripe transfer identifier recorded only after Stripe accepts the idempotent transfer request.';
