-- Audiotel Premium Pro : fixed progressive referral policy.
-- The commercial scale is server-authoritative and cannot be negotiated per customer.

UPDATE platform_feature_flags
SET configuration = jsonb_build_object(
  'currency','EUR',
  'qualification','three_paid_monthly_invoices',
  'qualification_paid_invoices',3,
  'tiers',jsonb_build_array(
    jsonb_build_object('from',1,'to',4,'reward_minor',1000),
    jsonb_build_object('from',5,'to',9,'reward_minor',1200),
    jsonb_build_object('from',10,'to',24,'reward_minor',1500),
    jsonb_build_object('from',25,'to',NULL,'reward_minor',2000)
  ),
  'milestones',jsonb_build_array(
    jsonb_build_object('ordinal',1,'bonus_minor',500),
    jsonb_build_object('ordinal',5,'bonus_minor',2000),
    jsonb_build_object('ordinal',10,'bonus_minor',5000)
  ),
  'permanent_from_ordinal',25,
  'permanent_reward_minor',2000,
  'policy_version','2026-10-05-fixed-v1'
),
updated_at=now()
WHERE feature_key='customer_referral';

-- Pending claims do not represent an earned liability. The exact reward is frozen
-- only when the third distinct paid monthly invoice qualifies the referred client.
UPDATE customer_referrals
SET reward_minor=0,
    metadata=COALESCE(metadata,'{}'::jsonb)||'{"reward_pending_qualification":true,"qualification_paid_invoices":3,"policy_version":"2026-10-05-fixed-v1"}'::jsonb
WHERE status='claimed';

CREATE INDEX IF NOT EXISTS subscription_billing_events_referral_paid_invoice_idx
  ON subscription_billing_events(tenant_id,event_time DESC,((normalized_details->>'provider_invoice_reference')))
  WHERE event_type='invoice.paid';

COMMENT ON TABLE customer_referrals IS
'Referral claims. A claim creates no payable amount. The fixed progressive reward is frozen at qualification after three distinct paid monthly invoices.';
COMMENT ON TABLE customer_referral_rewards IS
'Commercial reward ledger for qualified referrals. Amount equals the fixed tier for qualification ordinal plus any fixed milestone bonus.';
