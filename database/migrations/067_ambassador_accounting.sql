BEGIN;

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES (
  'customer_referral',
  false,
  '{
    "program_version":"ambassador-2026-10-05-v1",
    "locked":true,
    "currency":"EUR",
    "reward_minor":1000,
    "qualification":"three_paid_monthly_invoices",
    "qualification_payments_required":3,
    "tiers":[
      {"min":1,"max":4,"reward_minor":1000},
      {"min":5,"max":9,"reward_minor":1200},
      {"min":10,"max":24,"reward_minor":1500},
      {"min":25,"max":null,"reward_minor":2000}
    ],
    "milestone_bonuses":[
      {"rank":1,"bonus_minor":500},
      {"rank":5,"bonus_minor":2000},
      {"rank":10,"bonus_minor":5000}
    ]
  }'::jsonb
)
ON CONFLICT(feature_key) DO UPDATE
SET configuration=EXCLUDED.configuration,updated_at=now();

CREATE INDEX IF NOT EXISTS subscription_billing_events_referral_paid_idx
  ON subscription_billing_events(tenant_id,event_time DESC,id DESC)
  WHERE event_type='invoice.paid';

CREATE INDEX IF NOT EXISTS customer_referrals_referrer_rewarded_idx
  ON customer_referrals(referrer_tenant_id,rewarded_at DESC,id DESC)
  WHERE status='rewarded';

CREATE INDEX IF NOT EXISTS customer_referral_rewards_accounting_idx
  ON customer_referral_rewards(currency,status,earned_at DESC,paid_at DESC);

COMMIT;
