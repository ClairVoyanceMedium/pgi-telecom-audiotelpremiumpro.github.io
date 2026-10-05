-- Audiotel Premium Pro : automatic Stripe Connect referral payouts.
-- Keeps commercial reward accrual separate from money movement and provides an
-- immutable, idempotent payout identity for every earned reward.

CREATE TABLE customer_referral_payouts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  reward_id bigint NOT NULL UNIQUE REFERENCES customer_referral_rewards(id) ON DELETE RESTRICT,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_account_reference text,
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued','recipient_missing','processing','sent','retryable_error','failed','cancelled')),
  idempotency_key text NOT NULL UNIQUE,
  provider_transfer_reference text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error_code text,
  last_error_message text,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX customer_referral_payouts_transfer_unique
  ON customer_referral_payouts(provider,provider_transfer_reference)
  WHERE provider_transfer_reference IS NOT NULL;

CREATE INDEX customer_referral_payouts_state_idx
  ON customer_referral_payouts(state,updated_at,id);

CREATE INDEX customer_referral_payouts_tenant_idx
  ON customer_referral_payouts(tenant_id,state,created_at DESC,id DESC);

CREATE TRIGGER customer_referral_payouts_touch_updated
BEFORE UPDATE ON customer_referral_payouts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Existing earned rewards enter the automatic queue. Historical rewards that
-- were already marked paid remain preserved as sent settlements. A legacy
-- manual reference is retained in metadata and is never mistaken for a Stripe
-- transfer identifier.
INSERT INTO customer_referral_payouts(
  reward_id,tenant_id,state,idempotency_key,provider_transfer_reference,sent_at,metadata
)
SELECT
  rw.id,
  rw.tenant_id,
  CASE WHEN rw.status='paid' THEN 'sent' ELSE 'queued' END,
  'pgi-referral-reward:'||rw.public_id::text,
  CASE WHEN rw.status='paid' AND COALESCE(rw.paid_reference,'') ~ '^tr_[A-Za-z0-9]+$' THEN rw.paid_reference ELSE NULL END,
  CASE WHEN rw.status='paid' THEN rw.paid_at ELSE NULL END,
  CASE
    WHEN rw.status='paid' AND COALESCE(rw.paid_reference,'') !~ '^tr_[A-Za-z0-9]+$'
      THEN jsonb_build_object('legacy_settlement',true,'legacy_reference',rw.paid_reference)
    ELSE '{}'::jsonb
  END
FROM customer_referral_rewards rw
WHERE rw.status IN ('earned','paid')
ON CONFLICT(reward_id) DO NOTHING;

COMMENT ON TABLE customer_referral_payouts IS
'Automatic referral payout state. A Stripe transfer uses one deterministic idempotency key per reward; the reward is marked paid only in the same database transaction that records a confirmed transfer.';
