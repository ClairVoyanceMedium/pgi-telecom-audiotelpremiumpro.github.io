BEGIN;

UPDATE platform_feature_flags
SET configuration = jsonb_build_object(
  'program_version','ambassador-2026-10',
  'currency','EUR',
  'qualification','three_paid_monthly_invoices',
  'qualification_paid_invoices',3,
  'payout_threshold_minor',2000,
  'tiers',jsonb_build_array(
    jsonb_build_object('from',1,'to',4,'reward_minor',1000),
    jsonb_build_object('from',5,'to',9,'reward_minor',1200),
    jsonb_build_object('from',10,'to',24,'reward_minor',1500),
    jsonb_build_object('from',25,'to',NULL,'reward_minor',2000)
  ),
  'bonuses',jsonb_build_object('1',500,'5',2000,'10',5000)
),
updated_at = now()
WHERE feature_key='customer_referral';

CREATE INDEX IF NOT EXISTS subscription_billing_events_referral_paid_idx
  ON subscription_billing_events(tenant_id,subscription_id,event_time)
  WHERE event_type='invoice.paid';

CREATE TABLE IF NOT EXISTS customer_referral_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referral_code_id bigint NOT NULL REFERENCES customer_referral_codes(id) ON DELETE CASCADE,
  visitor_hash char(64) NOT NULL CHECK (visitor_hash ~ '^[a-f0-9]{64}$'),
  visited_on date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(referral_code_id,visitor_hash,visited_on)
);

CREATE INDEX IF NOT EXISTS customer_referral_visits_code_created_idx
  ON customer_referral_visits(referral_code_id,created_at DESC);

COMMENT ON TABLE customer_referrals IS
  'Programme ambassadeur: un filleul est récompensable après trois factures mensuelles distinctes réellement payées; le montant est déterminé par le rang du filleul qualifié.';

COMMENT ON TABLE customer_referral_visits IS
  'Clics uniques journaliers sur les liens ambassadeurs. Le registre conserve uniquement un identifiant visiteur haché, pas une adresse IP.';

COMMIT;
