-- Audiotel Premium Pro : programme Ambassadeur fixe et comptabilite de parrainage.
-- Migration additive. Les anciennes recompenses deja acquises restent inchangees.

ALTER TABLE customer_referrals
  ADD COLUMN qualification_paid_invoice_count integer NOT NULL DEFAULT 0 CHECK (qualification_paid_invoice_count >= 0),
  ADD COLUMN qualified_rank integer CHECK (qualified_rank IS NULL OR qualified_rank > 0),
  ADD COLUMN base_reward_minor bigint NOT NULL DEFAULT 0 CHECK (base_reward_minor >= 0),
  ADD COLUMN milestone_bonus_minor bigint NOT NULL DEFAULT 0 CHECK (milestone_bonus_minor >= 0),
  ADD COLUMN policy_version text;

WITH paid_counts AS (
  SELECT r.id,
         count(DISTINCT COALESCE(e.normalized_details->>'provider_invoice_reference',e.provider_event_id))::int AS paid_count
  FROM customer_referrals r
  JOIN tenant_subscriptions s ON s.tenant_id=r.referred_tenant_id
  JOIN subscription_billing_events e ON e.subscription_id=s.id
  WHERE r.status='claimed'
    AND e.event_type='invoice.paid'
    AND COALESCE(NULLIF(e.normalized_details->>'provider_invoice_amount_paid_minor','')::bigint,0)>0
  GROUP BY r.id
)
UPDATE customer_referrals r
SET qualification_paid_invoice_count=LEAST(3,paid_counts.paid_count)
FROM paid_counts
WHERE r.id=paid_counts.id;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY referrer_tenant_id
           ORDER BY COALESCE(rewarded_at,qualified_at,claimed_at),id
         )::int AS qualified_rank
  FROM customer_referrals
  WHERE status='rewarded'
)
UPDATE customer_referrals r
SET qualified_rank=ranked.qualified_rank,
    qualification_paid_invoice_count=GREATEST(r.qualification_paid_invoice_count,3),
    base_reward_minor=r.reward_minor,
    milestone_bonus_minor=0,
    policy_version=COALESCE(r.policy_version,'legacy_snapshot')
FROM ranked
WHERE r.id=ranked.id
  AND r.qualified_rank IS NULL;

CREATE UNIQUE INDEX customer_referrals_referrer_rank_unique
  ON customer_referrals(referrer_tenant_id,qualified_rank)
  WHERE qualified_rank IS NOT NULL AND status='rewarded';

CREATE INDEX customer_referrals_referrer_rewarded_rank_idx
  ON customer_referrals(referrer_tenant_id,status,qualified_rank DESC,id DESC);

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES (
  'customer_referral',
  false,
  '{
    "policy_version":"ambassador_fixed_2026_10",
    "currency":"EUR",
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

COMMENT ON COLUMN customer_referrals.qualification_paid_invoice_count IS
'Nombre de mensualites d abonnement reellement encaissees et reconnues pour la qualification du filleul.';

COMMENT ON COLUMN customer_referrals.qualified_rank IS
'Rang definitif du filleul valide chez son parrain. Ce rang determine le bareme fixe non negociable.';

COMMENT ON COLUMN customer_referrals.base_reward_minor IS
'Prime de base figee au moment de la validation selon le rang du filleul.';

COMMENT ON COLUMN customer_referrals.milestone_bonus_minor IS
'Bonus de palier fige au moment de la validation.';

COMMENT ON COLUMN customer_referrals.policy_version IS
'Version de politique ayant calcule la recompense. ambassador_fixed_2026_10 applique 10/12/15/20 EUR et 3 mensualites encaissees.';
