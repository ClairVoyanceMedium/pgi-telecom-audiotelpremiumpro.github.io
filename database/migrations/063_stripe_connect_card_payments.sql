-- PGI Telecom — Stripe Connect card payment foundation.
-- Expand-only. Card payments remain disabled until a connected Stripe account is fully onboarded.

CREATE TABLE tenant_card_payment_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_account_reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','onboarding','restricted','active','disabled')),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  details_submitted boolean NOT NULL DEFAULT false,
  application_fee_bps integer NOT NULL DEFAULT 490 CHECK (application_fee_bps BETWEEN 0 AND 3000),
  requirements_state text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_card_payment_accounts_status_idx
  ON tenant_card_payment_accounts(status,updated_at DESC);

CREATE TABLE tenant_card_payment_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  card_payment_account_id bigint NOT NULL REFERENCES tenant_card_payment_accounts(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_checkout_session_reference text UNIQUE,
  provider_payment_intent_reference text,
  provider_charge_reference text,
  customer_email text,
  description text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 100 AND 100000000),
  application_fee_bps integer NOT NULL CHECK (application_fee_bps BETWEEN 0 AND 3000),
  application_fee_minor bigint NOT NULL CHECK (application_fee_minor >= 0),
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created','open','paid','expired','cancelled','refunded','disputed','failed')),
  paid_at timestamptz,
  refunded_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_customer_principal_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (application_fee_minor <= amount_minor)
);

CREATE INDEX tenant_card_payment_requests_tenant_time_idx
  ON tenant_card_payment_requests(tenant_id,created_at DESC,id DESC);
CREATE INDEX tenant_card_payment_requests_status_idx
  ON tenant_card_payment_requests(status,created_at DESC,id DESC);
CREATE INDEX tenant_card_payment_requests_payment_intent_idx
  ON tenant_card_payment_requests(provider_payment_intent_reference)
  WHERE provider_payment_intent_reference IS NOT NULL;

CREATE TABLE card_payment_provider_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL DEFAULT 'stripe',
  provider_event_id text NOT NULL,
  connected_account_reference text,
  event_type text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  normalized_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

CREATE INDEX card_payment_provider_events_time_idx
  ON card_payment_provider_events(received_at DESC,id DESC);

CREATE TRIGGER tenant_card_payment_accounts_touch_updated
BEFORE UPDATE ON tenant_card_payment_accounts
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER tenant_card_payment_requests_touch_updated
BEFORE UPDATE ON tenant_card_payment_requests
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE tenant_card_payment_accounts IS
'One Stripe Connect payment account per Audiotel Premium Pro tenant. No card payment is allowed until charges_enabled is confirmed.';
COMMENT ON TABLE tenant_card_payment_requests IS
'Customer-facing card payment requests. The PGI application fee basis points and amount are frozen per request.';
COMMENT ON COLUMN tenant_card_payment_accounts.application_fee_bps IS
'PGI platform application fee in basis points. Default launch value 490 = 4.90%, excluding Stripe processing fees charged to the connected account.';
