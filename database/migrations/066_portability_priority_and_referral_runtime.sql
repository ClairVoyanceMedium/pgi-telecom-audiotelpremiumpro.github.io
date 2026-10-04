-- Audiotel Premium Pro : optional paid priority for inbound portability.
-- Standard inbound portability remains free. Priority changes only PGI internal queue ordering.

INSERT INTO platform_feature_flags(feature_key,enabled,configuration)
VALUES ('portability_priority',true,'{"price_minor":990,"currency":"EUR","scope":"pgi_internal_queue","operator_delay_guarantee":false}'::jsonb)
ON CONFLICT(feature_key) DO NOTHING;

CREATE TABLE tenant_portability_priority_orders (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portability_request_id bigint NOT NULL REFERENCES tenant_portability_requests(id) ON DELETE CASCADE,
  created_by_customer_principal_id uuid REFERENCES customer_principals(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'stripe' CHECK (provider IN ('stripe')),
  provider_checkout_session_reference text UNIQUE,
  provider_payment_intent_reference text,
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 100 AND 100000),
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','open','paid','failed','expired','refunded')),
  legal_version text NOT NULL,
  terms_accepted_at timestamptz NOT NULL,
  immediate_performance_requested_at timestamptz NOT NULL,
  withdrawal_loss_acknowledged_at timestamptz NOT NULL,
  paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_portability_priority_one_active_idx
  ON tenant_portability_priority_orders(portability_request_id)
  WHERE status IN ('created','open','paid');

CREATE INDEX tenant_portability_priority_tenant_time_idx
  ON tenant_portability_priority_orders(tenant_id,created_at DESC,id DESC);

CREATE TABLE portability_priority_provider_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL DEFAULT 'stripe',
  provider_event_id text NOT NULL,
  priority_order_id bigint NOT NULL REFERENCES tenant_portability_priority_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload_sha256 char(64) NOT NULL,
  normalized_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider,provider_event_id)
);

CREATE TRIGGER tenant_portability_priority_orders_touch_updated
BEFORE UPDATE ON tenant_portability_priority_orders
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMENT ON TABLE tenant_portability_priority_orders IS
'Optional one-time paid priority for PGI internal portability processing. It never guarantees operator eligibility, response time or porting date.';
COMMENT ON COLUMN tenant_portability_priority_orders.amount_minor IS
'Immutable price snapshot. Launch price is 990 minor EUR units, i.e. 9.90 EUR TTC.';
