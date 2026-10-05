-- Audiotel Premium Pro : programme Ambassadeur fixe.
-- Migration idempotente et additive. Le moteur applicatif reste compatible avant son execution.

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES (
  'customer_referral',
  false,
  '{
    "policy_version":"ambassador_fixed_2026_10",
    "currency":"EUR",
    "qualification":"three_paid_monthly_invoices",
    "qualification_paid_invoices":3,
    "tiers":[
      {"from":1,"to":4,"reward_minor":1000},
      {"from":5,"to":9,"reward_minor":1200},
      {"from":10,"to":24,"reward_minor":1500},
      {"from":25,"to":null,"reward_minor":2000}
    ],
    "milestone_bonuses":[
      {"rank":1,"bonus_minor":500},
      {"rank":5,"bonus_minor":2000},
      {"rank":10,"bonus_minor":5000}
    ],
    "ambassador_from_rank":25,
    "admin_editable_amounts":false
  }'::jsonb
)
ON CONFLICT(feature_key) DO UPDATE
SET configuration=EXCLUDED.configuration,
    updated_at=now();

UPDATE customer_referrals
SET metadata=(CASE WHEN jsonb_typeof(metadata)='object' THEN metadata ELSE '{}'::jsonb END)
  || jsonb_build_object(
    'policy_version',COALESCE(NULLIF(metadata->>'policy_version',''),'legacy_snapshot'),
    'qualification_required_paid_invoices',3
  )
WHERE status IN ('claimed','rewarded')
  AND (
    COALESCE(metadata->>'qualification_required_paid_invoices','')<>'3'
    OR metadata->>'policy_version' IS NULL
  );

COMMENT ON TABLE customer_referrals IS
'Referral claims. Current policy details, progress and frozen rank are persisted in metadata; historical reward snapshots remain immutable.';
