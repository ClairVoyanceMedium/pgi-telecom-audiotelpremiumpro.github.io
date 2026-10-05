-- Audiotel Premium Pro : fixed ambassador referral economics.
-- The program can be enabled or disabled, but its reward schedule is not editable.
-- A referral qualifies only after three distinct paid monthly subscription invoices.

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES (
  'customer_referral',
  false,
  '{
    "currency":"EUR",
    "qualification":"three_paid_monthly_subscriptions",
    "qualification_paid_months":3,
    "reward_rule_version":"2026-10-fixed-ambassador-1",
    "schedule":[
      {"from":1,"to":4,"reward_minor":1000},
      {"from":5,"to":9,"reward_minor":1200},
      {"from":10,"to":24,"reward_minor":1500},
      {"from":25,"to":null,"reward_minor":2000}
    ],
    "milestones":[
      {"ordinal":1,"bonus_minor":500},
      {"ordinal":5,"bonus_minor":2000},
      {"ordinal":10,"bonus_minor":5000}
    ],
    "permanent_from":25,
    "permanent_reward_minor":2000
  }'::jsonb
)
ON CONFLICT(feature_key) DO UPDATE
SET configuration=EXCLUDED.configuration,
    updated_at=now();

COMMENT ON TABLE customer_referrals IS
'Referral claims. Pending claims keep reward_minor at zero or their historical value; the fixed reward is determined from the qualified-referral rank only after three distinct paid monthly subscription invoices. Historical rewarded claims remain unchanged.';

COMMENT ON TABLE customer_referral_rewards IS
'Append-only commercial reward ledger for referrals qualified after the required paid monthly invoices. Earning is automatic; payment settlement remains explicitly traceable.';
