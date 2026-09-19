-- PGI Telecom — paid external subscription gate for premium-rate calling.
-- Internal PGI usage remains exempt. External tenants require a paid active monthly subscription.

CREATE TABLE service_plan_price_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_plan_id bigint NOT NULL REFERENCES service_plans(id),
  market_id bigint REFERENCES operating_markets(id),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  billing_interval text NOT NULL DEFAULT 'month'
    CHECK (billing_interval IN ('month','year')),
  interval_count integer NOT NULL DEFAULT 1 CHECK (interval_count > 0),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  provider text,
  provider_price_reference text,
  created_by bigint REFERENCES app_users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX service_plan_price_versions_lookup_idx
  ON service_plan_price_versions(service_plan_id,market_id,currency,effective_from DESC);
CREATE UNIQUE INDEX service_plan_price_versions_provider_unique
  ON service_plan_price_versions(provider,provider_price_reference)
  WHERE provider IS NOT NULL AND provider_price_reference IS NOT NULL;

CREATE FUNCTION pgi_protect_service_plan_price_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'subscription price versions are immutable';
  END IF;
  IF NEW.service_plan_id IS DISTINCT FROM OLD.service_plan_id
     OR NEW.market_id IS DISTINCT FROM OLD.market_id
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.billing_interval IS DISTINCT FROM OLD.billing_interval
     OR NEW.interval_count IS DISTINCT FROM OLD.interval_count
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_price_reference IS DISTINCT FROM OLD.provider_price_reference
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'subscription price financial identity is immutable';
  END IF;
  IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    RAISE EXCEPTION 'retired subscription price cannot be changed';
  END IF;
  IF NEW.effective_to IS NOT NULL AND NEW.effective_to<=NEW.effective_from THEN
    RAISE EXCEPTION 'subscription price effective_to must be after effective_from';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_plan_price_versions_immutable
BEFORE UPDATE OR DELETE ON service_plan_price_versions
FOR EACH ROW EXECUTE FUNCTION pgi_protect_service_plan_price_version();

INSERT INTO service_plans(plan_key,display_name,status,billing_model,default_currency,metadata)
VALUES (
  'external-sva-access',
  'External SVA Access',
  'active',
  'subscription',
  'EUR',
  '{"audience":"external_tenants","internal_exempt":true,"premium_rate_access":true}'::jsonb
)
ON CONFLICT (plan_key) DO UPDATE SET
  display_name=EXCLUDED.display_name,
  status='active',
  billing_model='subscription',
  metadata=service_plans.metadata||EXCLUDED.metadata,
  updated_at=now();

INSERT INTO plan_entitlements(service_plan_id,entitlement_key,value_type,value)
SELECT id,'premium_rate_calls','boolean','true'::jsonb
FROM service_plans
WHERE plan_key='external-sva-access'
ON CONFLICT(service_plan_id,entitlement_key) DO UPDATE SET
  value_type='boolean',value='true'::jsonb,updated_at=now();

INSERT INTO service_plan_price_versions(
  service_plan_id,market_id,currency,amount_minor,billing_interval,interval_count,effective_from,metadata
)
SELECT p.id,NULL,'EUR',200,'month',1,'2026-09-19T00:00:00Z'::timestamptz,
       '{"initial_price":true,"display_amount":"2.00 EUR/month"}'::jsonb
FROM service_plans p
WHERE p.plan_key='external-sva-access'
  AND NOT EXISTS (
    SELECT 1 FROM service_plan_price_versions v
    WHERE v.service_plan_id=p.id
      AND v.market_id IS NULL
      AND v.currency='EUR'
  );

ALTER TABLE tenant_subscriptions
  ADD COLUMN price_version_id bigint REFERENCES service_plan_price_versions(id),
  ADD COLUMN billing_provider text,
  ADD COLUMN provider_customer_reference text,
  ADD COLUMN provider_subscription_reference text,
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN last_payment_status text,
  ADD COLUMN last_event_at timestamptz;

CREATE UNIQUE INDEX tenant_subscriptions_provider_reference_unique
  ON tenant_subscriptions(billing_provider,provider_subscription_reference)
  WHERE billing_provider IS NOT NULL AND provider_subscription_reference IS NOT NULL;
CREATE INDEX tenant_subscriptions_access_idx
  ON tenant_subscriptions(tenant_id,status,current_period_end,market_id,service_plan_id);

CREATE TABLE subscription_billing_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  tenant_id bigint REFERENCES tenants(id),
  subscription_id bigint REFERENCES tenant_subscriptions(id),
  event_type text NOT NULL,
  event_time timestamptz NOT NULL,
  payload_sha256 char(64) NOT NULL,
  normalized_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider,provider_event_id)
);

CREATE INDEX subscription_billing_events_tenant_time_idx
  ON subscription_billing_events(tenant_id,event_time DESC,id DESC);
CREATE INDEX subscription_billing_events_subscription_time_idx
  ON subscription_billing_events(subscription_id,event_time DESC,id DESC)
  WHERE subscription_id IS NOT NULL;

CREATE FUNCTION pgi_prevent_subscription_billing_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'subscription billing events are append-only';
END;
$$;

CREATE TRIGGER subscription_billing_events_no_mutation
BEFORE UPDATE OR DELETE ON subscription_billing_events
FOR EACH ROW EXECUTE FUNCTION pgi_prevent_subscription_billing_event_mutation();

CREATE OR REPLACE FUNCTION pgi_publish_service_plan_price(
  p_plan_key text,
  p_currency char(3),
  p_amount_minor bigint,
  p_effective_from timestamptz DEFAULT now(),
  p_market_id bigint DEFAULT NULL,
  p_created_by bigint DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan_id bigint;
  v_price_id bigint;
BEGIN
  IF p_amount_minor<=0 THEN
    RAISE EXCEPTION 'subscription price must be positive';
  END IF;
  IF p_currency !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'invalid subscription currency';
  END IF;

  SELECT id INTO v_plan_id
  FROM service_plans
  WHERE plan_key=p_plan_key AND status='active'
  FOR UPDATE;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'active service plan not found: %',p_plan_key;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_plan_key||':'||COALESCE(p_market_id::text,'global')||':'||p_currency));

  IF EXISTS (
    SELECT 1
    FROM service_plan_price_versions
    WHERE service_plan_id=v_plan_id
      AND market_id IS NOT DISTINCT FROM p_market_id
      AND currency=p_currency
      AND effective_from>=p_effective_from
  ) THEN
    RAISE EXCEPTION 'new subscription price must be later than existing versions';
  END IF;

  UPDATE service_plan_price_versions
  SET effective_to=p_effective_from
  WHERE service_plan_id=v_plan_id
    AND market_id IS NOT DISTINCT FROM p_market_id
    AND currency=p_currency
    AND effective_to IS NULL
    AND effective_from<p_effective_from;

  INSERT INTO service_plan_price_versions(
    service_plan_id,market_id,currency,amount_minor,billing_interval,interval_count,effective_from,created_by
  )
  VALUES(v_plan_id,p_market_id,p_currency,p_amount_minor,'month',1,p_effective_from,p_created_by)
  RETURNING id INTO v_price_id;

  RETURN v_price_id;
END;
$$;

CREATE OR REPLACE FUNCTION pgi_tenant_has_premium_call_access(
  p_tenant_id bigint,
  p_market_id bigint DEFAULT NULL,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT
      CASE
        WHEN t.tenant_type='internal' THEN t.status='active'
        ELSE t.status='active' AND EXISTS (
          SELECT 1
          FROM tenant_subscriptions s
          JOIN service_plans p ON p.id=s.service_plan_id
          JOIN plan_entitlements e ON e.service_plan_id=p.id
          JOIN service_plan_price_versions pv ON pv.id=s.price_version_id
          WHERE s.tenant_id=t.id
            AND p.plan_key='external-sva-access'
            AND p.status='active'
            AND e.entitlement_key='premium_rate_calls'
            AND e.value='true'::jsonb
            AND s.status='active'
            AND s.starts_at<=p_at
            AND s.current_period_end IS NOT NULL
            AND s.current_period_end>p_at
            AND (s.ends_at IS NULL OR s.ends_at>p_at)
            AND (p_market_id IS NULL OR s.market_id IS NULL OR s.market_id=p_market_id)
            AND pv.effective_from<=s.starts_at
        )
      END
    FROM tenants t
    WHERE t.id=p_tenant_id
  ),false)
$$;

CREATE VIEW tenant_subscription_access
WITH (security_barrier=true)
AS
SELECT
  t.id AS tenant_id,
  t.public_id AS tenant_public_id,
  t.slug,
  t.display_name,
  t.tenant_type,
  t.status AS tenant_status,
  (t.tenant_type='internal') AS billing_exempt,
  pgi_tenant_has_premium_call_access(t.id,NULL,now()) AS premium_call_access,
  s.id AS subscription_id,
  s.status AS subscription_status,
  s.billing_currency,
  s.current_period_start,
  s.current_period_end,
  s.cancel_at_period_end,
  s.last_payment_status,
  s.billing_provider,
  pv.amount_minor,
  pv.billing_interval,
  pv.interval_count
FROM tenants t
LEFT JOIN LATERAL (
  SELECT x.*
  FROM tenant_subscriptions x
  JOIN service_plans p ON p.id=x.service_plan_id
  WHERE x.tenant_id=t.id
    AND p.plan_key='external-sva-access'
  ORDER BY x.created_at DESC
  LIMIT 1
) s ON true
LEFT JOIN service_plan_price_versions pv ON pv.id=s.price_version_id;

CREATE FUNCTION pgi_require_external_subscription_for_active_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status='active'
     AND NOT pgi_tenant_has_premium_call_access(NEW.tenant_id,NULL,now()) THEN
    RAISE EXCEPTION 'active paid subscription required before external SVA assignment activation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_number_assignments_subscription_gate
BEFORE INSERT OR UPDATE OF status,tenant_id ON tenant_number_assignments
FOR EACH ROW
WHEN (NEW.status='active')
EXECUTE FUNCTION pgi_require_external_subscription_for_active_assignment();
