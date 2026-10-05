BEGIN;

ALTER TABLE customer_referrals
  ADD COLUMN IF NOT EXISTS qualified_sequence integer CHECK (qualified_sequence IS NULL OR qualified_sequence > 0),
  ADD COLUMN IF NOT EXISTS base_reward_minor bigint NOT NULL DEFAULT 0 CHECK (base_reward_minor >= 0),
  ADD COLUMN IF NOT EXISTS milestone_bonus_minor bigint NOT NULL DEFAULT 0 CHECK (milestone_bonus_minor >= 0),
  ADD COLUMN IF NOT EXISTS reward_tier text;

UPDATE customer_referrals
SET base_reward_minor=reward_minor,
    milestone_bonus_minor=0,
    reward_tier=COALESCE(reward_tier,'historique')
WHERE status='rewarded' AND reward_minor>0 AND base_reward_minor=0;

CREATE UNIQUE INDEX IF NOT EXISTS customer_referrals_referrer_sequence_unique
  ON customer_referrals(referrer_tenant_id,qualified_sequence)
  WHERE qualified_sequence IS NOT NULL;

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES (
  'customer_referral',
  false,
  '{"currency":"EUR","qualification":"three_paid_monthly_subscriptions","qualifying_payments":3,"payout_threshold_minor":2000,"tiers":[{"min":1,"max":4,"reward_minor":1000},{"min":5,"max":9,"reward_minor":1200},{"min":10,"max":24,"reward_minor":1500},{"min":25,"max":null,"reward_minor":2000}],"milestone_bonuses":[{"at":1,"amount_minor":500},{"at":5,"amount_minor":2000},{"at":10,"amount_minor":5000}],"pricing_mode":"fixed_non_negotiable"}'::jsonb
)
ON CONFLICT(feature_key) DO UPDATE
SET configuration=EXCLUDED.configuration,
    updated_at=now();

COMMENT ON COLUMN customer_referrals.qualified_sequence IS
'Ordinal number of the validated client for the ambassador. Assigned atomically at qualification.';
COMMENT ON COLUMN customer_referrals.base_reward_minor IS
'Fixed base reward determined from the validated-client tier at qualification.';
COMMENT ON COLUMN customer_referrals.milestone_bonus_minor IS
'Automatic milestone bonus included in the total referral reward.';
COMMENT ON COLUMN customer_referrals.reward_tier IS
'Human-readable fixed tier snapshot at qualification.';
COMMENT ON TABLE customer_referral_rewards IS
'Append-only ambassador reward ledger. A referral qualifies after three genuinely paid monthly invoices. Payment eligibility begins at a 20 EUR accumulated earned balance.';

COMMIT;
