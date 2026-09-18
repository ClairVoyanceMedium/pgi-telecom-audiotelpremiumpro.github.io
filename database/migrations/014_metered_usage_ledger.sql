-- PGI Telecom — immutable metered-usage ledger for subscriptions, billing and quota audit.

CREATE TABLE tenant_usage_events (
  tenant_bucket smallint NOT NULL CHECK (tenant_bucket BETWEEN 0 AND 4095),
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  subscription_id bigint REFERENCES tenant_subscriptions(id),
  metric_key text NOT NULL,
  quantity numeric(20,6) NOT NULL CHECK (quantity >= 0),
  unit text NOT NULL,
  occurred_at timestamptz NOT NULL,
  source text NOT NULL,
  source_event_id text NOT NULL,
  correlation_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_bucket,event_id),
  UNIQUE (tenant_bucket,source,source_event_id)
) PARTITION BY HASH (tenant_bucket);

DO $$
DECLARE
  i integer;
BEGIN
  FOR i IN 0..63 LOOP
    EXECUTE format(
      'CREATE TABLE tenant_usage_events_p%s PARTITION OF tenant_usage_events FOR VALUES WITH (MODULUS 64, REMAINDER %s)',
      i,i
    );
  END LOOP;
END;
$$;

CREATE INDEX tenant_usage_events_tenant_time_idx
  ON tenant_usage_events(tenant_id,occurred_at DESC,event_id);
CREATE INDEX tenant_usage_events_subscription_time_idx
  ON tenant_usage_events(subscription_id,occurred_at DESC)
  WHERE subscription_id IS NOT NULL;
CREATE INDEX tenant_usage_events_metric_time_idx
  ON tenant_usage_events(metric_key,occurred_at DESC);
CREATE INDEX tenant_usage_events_occurred_brin
  ON tenant_usage_events USING brin(occurred_at);

CREATE FUNCTION prevent_usage_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tenant_usage_events is append-only';
END;
$$;

CREATE TRIGGER tenant_usage_events_no_update
BEFORE UPDATE OR DELETE ON tenant_usage_events
FOR EACH ROW EXECUTE FUNCTION prevent_usage_event_mutation();

CREATE TABLE tenant_billing_cycles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  subscription_id bigint REFERENCES tenant_subscriptions(id),
  subscription_scope bigint GENERATED ALWAYS AS (COALESCE(subscription_id,0)) STORED,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  billing_currency char(3) NOT NULL CHECK (billing_currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','rating','rated','invoiced','paid','disputed','closed')),
  usage_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal_amount numeric(20,6) NOT NULL DEFAULT 0,
  tax_amount numeric(20,6) NOT NULL DEFAULT 0,
  total_amount numeric(20,6) NOT NULL DEFAULT 0,
  external_invoice_reference text,
  rated_at timestamptz,
  invoiced_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (subtotal_amount >= 0 AND tax_amount >= 0 AND total_amount >= 0)
);

CREATE UNIQUE INDEX tenant_billing_cycles_period_unique
  ON tenant_billing_cycles(tenant_id,subscription_scope,period_start,period_end);
CREATE INDEX tenant_billing_cycles_status_idx
  ON tenant_billing_cycles(status,period_end,id);
