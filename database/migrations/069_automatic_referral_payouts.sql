-- PGI Telecom : automatic ambassador payouts through Stripe Connect.
-- Expand-only. Existing earned rewards are queued safely and existing paid rewards are marked transferred.

ALTER TABLE tenant_card_payment_accounts
  ADD COLUMN IF NOT EXISTS transfers_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipient_requirements_state text;

ALTER TABLE customer_referral_rewards
  ADD COLUMN IF NOT EXISTS payout_status text NOT NULL DEFAULT 'queued',
  ADD COLUMN IF NOT EXISTS payout_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS provider_account_reference text,
  ADD COLUMN IF NOT EXISTS provider_transfer_reference text,
  ADD COLUMN IF NOT EXISTS payout_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payout_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS payout_last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_last_error_code text,
  ADD COLUMN IF NOT EXISTS payout_last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE customer_referral_rewards
SET payout_status=CASE
      WHEN status='paid' THEN 'transferred'
      WHEN status='cancelled' THEN 'cancelled'
      ELSE 'queued'
    END,
    payout_next_attempt_at=CASE WHEN status='earned' THEN now() ELSE payout_next_attempt_at END,
    updated_at=now()
WHERE payout_status IS NULL
   OR (status='paid' AND payout_status<>'transferred')
   OR (status='cancelled' AND payout_status<>'cancelled');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='customer_referral_rewards_payout_status_check'
  ) THEN
    ALTER TABLE customer_referral_rewards
      ADD CONSTRAINT customer_referral_rewards_payout_status_check
      CHECK (payout_status IN ('queued','missing_payout_details','processing','transferred','failed','cancelled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS customer_referral_rewards_provider_transfer_uidx
  ON customer_referral_rewards(provider_transfer_reference)
  WHERE provider_transfer_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_referral_rewards_payout_queue_idx
  ON customer_referral_rewards(payout_next_attempt_at,id)
  WHERE status='earned'
    AND payout_status IN ('queued','missing_payout_details','processing','failed');

COMMENT ON COLUMN customer_referral_rewards.payout_status IS
'Automatic payout state: queued, missing_payout_details, processing, transferred, failed, cancelled.';
COMMENT ON COLUMN customer_referral_rewards.provider_transfer_reference IS
'Stripe Connect transfer id. Unique to prevent duplicate accounting of an ambassador reward.';
COMMENT ON COLUMN tenant_card_payment_accounts.transfers_enabled IS
'True when the connected Stripe Account recipient stripe_transfers capability is active.';
