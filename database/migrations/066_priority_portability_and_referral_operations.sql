-- Audiotel Premium Pro: paid priority portability and operational referral completion.
-- Expand-only. Standard portability remains free. Priority applies only after confirmed payment.

ALTER TABLE tenant_portability_requests
  ADD COLUMN processing_priority text NOT NULL DEFAULT 'standard'
    CHECK (processing_priority IN ('standard','priority')),
  ADD COLUMN priority_fee_minor bigint NOT NULL DEFAULT 0 CHECK (priority_fee_minor >= 0),
  ADD COLUMN priority_fee_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (priority_fee_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN priority_payment_status text NOT NULL DEFAULT 'not_required'
    CHECK (priority_payment_status IN ('not_required','pending','paid','failed','expired')),
  ADD COLUMN priority_checkout_session_reference text,
  ADD COLUMN priority_payment_intent_reference text,
  ADD COLUMN priority_requested_at timestamptz,
  ADD COLUMN priority_paid_at timestamptz;

CREATE INDEX tenant_portability_requests_priority_idx
  ON tenant_portability_requests(processing_priority,priority_payment_status,created_at,id)
  WHERE status NOT IN ('ported','rejected','cancelled');

CREATE TABLE portability_priority_payment_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  portability_request_id bigint NOT NULL REFERENCES tenant_portability_requests(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','paid','failed','expired')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  provider_checkout_session_reference text,
  provider_payment_intent_reference text,
  event_time timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

CREATE INDEX portability_priority_payment_events_request_idx
  ON portability_priority_payment_events(portability_request_id,event_time DESC,id DESC);

CREATE VIEW tenant_scoped_portability_requests_v5
WITH (security_barrier=true)
AS
SELECT
  v.*,
  p.processing_priority,p.priority_fee_minor,p.priority_fee_currency,p.priority_payment_status,
  p.priority_checkout_session_reference,p.priority_payment_intent_reference,
  p.priority_requested_at,p.priority_paid_at
FROM tenant_scoped_portability_requests_v4 v
JOIN tenant_portability_requests p ON p.id=v.id
WHERE p.tenant_id=pgi_require_tenant_context();

UPDATE platform_feature_flags
SET configuration = configuration || '{"reward_minor":490,"currency":"EUR","qualification":"paid_active_subscription"}'::jsonb,
    updated_at = now()
WHERE feature_key='customer_referral';

COMMENT ON COLUMN tenant_portability_requests.processing_priority IS
'Priority is standard unless a one-time priority service payment has been confirmed. Priority concerns PGI administrative handling only and never guarantees an operator deadline.';

COMMENT ON TABLE portability_priority_payment_events IS
'Idempotent Stripe event ledger for the optional 9.90 EUR TTC PGI portability priority service.';
