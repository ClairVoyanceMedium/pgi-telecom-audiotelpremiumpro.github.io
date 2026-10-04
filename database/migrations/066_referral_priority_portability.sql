-- Audiotel Premium Pro : referral execution and paid PGI portability priority.
-- Expand-only. Standard inbound portability stays free at PGI platform level.

ALTER TABLE tenant_portability_requests
  ADD COLUMN processing_tier text NOT NULL DEFAULT 'standard'
    CHECK (processing_tier IN ('standard','priority')),
  ADD COLUMN priority_fee_minor bigint NOT NULL DEFAULT 0 CHECK (priority_fee_minor >= 0),
  ADD COLUMN priority_fee_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (priority_fee_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN priority_payment_status text NOT NULL DEFAULT 'not_required'
    CHECK (priority_payment_status IN ('not_required','pending','paid','expired','refunded')),
  ADD COLUMN priority_checkout_reference text,
  ADD COLUMN priority_payment_reference text,
  ADD COLUMN priority_paid_at timestamptz;

CREATE UNIQUE INDEX tenant_portability_priority_checkout_unique
  ON tenant_portability_requests(priority_checkout_reference)
  WHERE priority_checkout_reference IS NOT NULL;

CREATE INDEX tenant_portability_priority_queue_idx
  ON tenant_portability_requests(processing_tier,priority_payment_status,automation_next_at,id)
  WHERE status NOT IN ('ported','rejected','cancelled');

CREATE TABLE portability_priority_payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider ~ '^[a-z0-9_.-]{2,40}$'),
  provider_event_id text NOT NULL,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  portability_request_id bigint NOT NULL REFERENCES tenant_portability_requests(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  payment_status text NOT NULL CHECK (payment_status IN ('pending','paid','expired')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_checkout_reference text,
  provider_payment_reference text,
  event_time timestamptz NOT NULL,
  payload_sha256 char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

CREATE INDEX portability_priority_payment_request_idx
  ON portability_priority_payment_events(portability_request_id,created_at DESC,id DESC);

CREATE VIEW tenant_scoped_portability_requests_v5
WITH (security_barrier=true)
AS
SELECT
  v.*,
  p.processing_tier,p.priority_fee_minor,p.priority_fee_currency,p.priority_payment_status,
  p.priority_checkout_reference,p.priority_payment_reference,p.priority_paid_at
FROM tenant_scoped_portability_requests_v4 v
JOIN tenant_portability_requests p ON p.id=v.id
WHERE p.tenant_id=pgi_require_tenant_context();

COMMENT ON COLUMN tenant_portability_requests.processing_tier IS
'Internal PGI processing tier. Priority never represents or guarantees faster third-party operator execution.';
COMMENT ON TABLE portability_priority_payment_events IS
'Idempotent Stripe event ledger for the optional 9.90 EUR TTC PGI portability priority service.';
