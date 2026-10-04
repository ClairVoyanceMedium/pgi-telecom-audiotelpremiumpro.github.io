-- PGI Telecom : paid priority option for incoming portability.
-- Expand-only. Standard portability remains free; priority execution is granted only after confirmed Stripe payment.

ALTER TABLE tenant_portability_requests
  ADD COLUMN service_level text NOT NULL DEFAULT 'standard'
    CHECK (service_level IN ('standard','priority')),
  ADD COLUMN priority_fee_minor integer NOT NULL DEFAULT 0
    CHECK (priority_fee_minor >= 0),
  ADD COLUMN priority_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (priority_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN priority_payment_status text NOT NULL DEFAULT 'not_requested'
    CHECK (priority_payment_status IN ('not_requested','pending','paid','failed','refunded')),
  ADD COLUMN priority_checkout_session_reference text,
  ADD COLUMN priority_payment_intent_reference text,
  ADD COLUMN priority_paid_at timestamptz;

ALTER TABLE tenant_portability_requests
  ADD CONSTRAINT tenant_portability_priority_consistency_check
  CHECK (
    (service_level='standard' AND priority_fee_minor=0 AND priority_payment_status='not_requested')
    OR
    (service_level='priority' AND priority_fee_minor=990 AND priority_currency='EUR' AND priority_payment_status IN ('pending','paid','failed','refunded'))
  );

CREATE UNIQUE INDEX tenant_portability_priority_checkout_unique
  ON tenant_portability_requests(priority_checkout_session_reference)
  WHERE priority_checkout_session_reference IS NOT NULL;

CREATE INDEX tenant_portability_priority_paid_idx
  ON tenant_portability_requests(priority_payment_status,created_at,id)
  WHERE service_level='priority';

CREATE VIEW tenant_scoped_portability_requests_v5
WITH (security_barrier=true)
AS
SELECT
  v.*,
  p.service_level,p.priority_fee_minor,p.priority_currency,p.priority_payment_status,
  p.priority_checkout_session_reference,p.priority_payment_intent_reference,p.priority_paid_at
FROM tenant_scoped_portability_requests_v4 v
JOIN tenant_portability_requests p ON p.id=v.id
WHERE p.tenant_id=pgi_require_tenant_context();

COMMENT ON COLUMN tenant_portability_requests.service_level IS
'Customer-selected handling level. Standard remains free. Priority costs 9.90 EUR TTC and becomes operational only after confirmed payment.';

COMMENT ON COLUMN tenant_portability_requests.priority_payment_status IS
'Priority portability payment state. A pending or failed payment must never elevate work queue priority.';
