-- PGI Telecom — optional paid priority handling for inbound portability.
-- Expand-only. Standard portability remains available and free; the paid option only changes PGI internal handling priority.

ALTER TABLE tenant_portability_requests
  ADD COLUMN handling_tier text NOT NULL DEFAULT 'standard'
    CHECK (handling_tier IN ('standard','priority')),
  ADD COLUMN priority_paid_at timestamptz;

CREATE TABLE portability_priority_payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portability_request_id bigint NOT NULL UNIQUE REFERENCES tenant_portability_requests(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  amount_minor integer NOT NULL DEFAULT 990 CHECK (amount_minor=990),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','open','paid','expired','failed','partially_refunded','refunded','disputed')),
  provider_checkout_session_reference text UNIQUE,
  provider_payment_intent_reference text,
  paid_at timestamptz,
  refunded_amount_minor integer NOT NULL DEFAULT 0 CHECK (refunded_amount_minor BETWEEN 0 AND amount_minor),
  refunded_at timestamptz,
  last_provider_event_at timestamptz,
  created_by_customer_principal_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status<>'paid' OR paid_at IS NOT NULL),
  CHECK (status<>'refunded' OR refunded_at IS NOT NULL)
);

CREATE INDEX portability_priority_payments_tenant_idx
  ON portability_priority_payments(tenant_id,created_at DESC,id DESC);
CREATE INDEX portability_priority_payments_status_idx
  ON portability_priority_payments(status,updated_at DESC,id DESC);
CREATE INDEX portability_priority_payments_payment_intent_idx
  ON portability_priority_payments(provider_payment_intent_reference)
  WHERE provider_payment_intent_reference IS NOT NULL;

CREATE TABLE portability_priority_provider_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payment_public_id uuid,
  payload_sha256 char(64) NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

CREATE INDEX portability_priority_provider_events_time_idx
  ON portability_priority_provider_events(received_at DESC,id DESC);

CREATE TRIGGER portability_priority_payments_touch_updated
BEFORE UPDATE ON portability_priority_payments
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE VIEW tenant_scoped_portability_requests_v5 AS
SELECT
  v4.*,
  p.handling_tier,
  p.priority_paid_at,
  pp.status AS priority_payment_status,
  pp.amount_minor AS priority_fee_minor,
  pp.currency AS priority_fee_currency
FROM tenant_scoped_portability_requests_v4 v4
JOIN tenant_portability_requests p ON p.id=v4.id
LEFT JOIN portability_priority_payments pp ON pp.portability_request_id=p.id
WHERE p.tenant_id=pgi_require_tenant_context();

COMMENT ON COLUMN tenant_portability_requests.handling_tier IS
'PGI internal handling tier only. priority never guarantees or changes an external operator processing time.';
COMMENT ON TABLE portability_priority_payments IS
'Optional one-off 9.90 EUR TTC payment for PGI priority handling. It is separate from standard free portability, monthly subscription billing and tenant Stripe Connect card payments.';
