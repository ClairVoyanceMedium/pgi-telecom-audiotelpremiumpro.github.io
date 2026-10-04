-- PGI Telecom — revenue growth: priority portability and referral acquisition.
-- Expand-only. Standard portability remains free. Priority changes only PGI processing order.

CREATE TABLE platform_growth_settings (
  settings_key text PRIMARY KEY,
  referral_enabled boolean NOT NULL DEFAULT true,
  referral_benefit_label text NOT NULL DEFAULT 'Avantage sur l’abonnement après activation effective du filleul',
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (settings_key='referral')
);

INSERT INTO platform_growth_settings(settings_key,referral_enabled,referral_benefit_label)
VALUES ('referral',true,'Avantage sur l’abonnement après activation effective du filleul')
ON CONFLICT (settings_key) DO NOTHING;

CREATE TABLE tenant_referral_codes (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  code varchar(24) NOT NULL UNIQUE CHECK (code ~ '^APP-[A-F0-9]{12}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  referrer_tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  referred_tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  referral_code varchar(24) NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','cancelled','rejected')),
  benefit_label text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_tenant_id<>referred_tenant_id)
);

CREATE INDEX tenant_referrals_referrer_status_idx
  ON tenant_referrals(referrer_tenant_id,status,captured_at DESC);

ALTER TABLE tenant_portability_requests
  ADD COLUMN processing_class text NOT NULL DEFAULT 'standard'
    CHECK (processing_class IN ('standard','priority')),
  ADD COLUMN priority_paid_at timestamptz;

CREATE TABLE portability_priority_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  portability_request_id bigint NOT NULL UNIQUE REFERENCES tenant_portability_requests(id) ON DELETE RESTRICT,
  amount_minor integer NOT NULL DEFAULT 990 CHECK (amount_minor=990),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider='stripe'),
  provider_checkout_session_reference text UNIQUE,
  provider_payment_intent_reference text,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','open','paid','expired','cancelled','refunded','failed')),
  created_by_customer_principal_id uuid,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX portability_priority_orders_tenant_time_idx
  ON portability_priority_orders(tenant_id,created_at DESC,id DESC);

CREATE TABLE portability_priority_provider_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL DEFAULT 'stripe',
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  order_public_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

CREATE TRIGGER platform_growth_settings_touch_updated
BEFORE UPDATE ON platform_growth_settings
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER tenant_referrals_touch_updated
BEFORE UPDATE ON tenant_referrals
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER portability_priority_orders_touch_updated
BEFORE UPDATE ON portability_priority_orders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON COLUMN tenant_portability_requests.processing_class IS
'Internal PGI processing class only. priority never guarantees or changes an operator portability deadline.';

COMMENT ON TABLE portability_priority_orders IS
'One-time 9.90 EUR TTC PGI processing-priority option. The standard portability path remains free.';

COMMENT ON TABLE tenant_referrals IS
'Referral attribution is immutable by referred tenant. Qualification occurs only after effective client activation; disabling the program blocks new attribution while preserving history.';
