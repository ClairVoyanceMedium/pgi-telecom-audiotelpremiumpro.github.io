-- PGI Telecom — subscription revenue recovery and dunning state.
-- Expand-only: strict provisioning remains paid-only; established routing receives a bounded recovery window.

ALTER TABLE tenant_subscriptions
  ADD COLUMN recovery_stage text NOT NULL DEFAULT 'current',
  ADD COLUMN dunning_started_at timestamptz,
  ADD COLUMN dunning_grace_until timestamptz,
  ADD COLUMN dunning_deadline_at timestamptz,
  ADD COLUMN payment_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN next_payment_attempt timestamptz,
  ADD COLUMN last_invoice_reference text;

ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT tenant_subscriptions_recovery_stage_check
  CHECK (recovery_stage IN ('current','grace','retrying','suspended'));

ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT tenant_subscriptions_payment_attempt_count_check
  CHECK (payment_attempt_count>=0);

CREATE INDEX tenant_subscriptions_recovery_deadline_idx
  ON tenant_subscriptions(recovery_stage,dunning_deadline_at,tenant_id,id)
  WHERE recovery_stage<>'current';

CREATE FUNCTION pgi_tenant_has_premium_routing_access(
  p_tenant_id bigint,
  p_market_id bigint DEFAULT NULL,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE((
    SELECT CASE
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
          AND s.starts_at<=p_at
          AND (s.ends_at IS NULL OR s.ends_at>p_at)
          AND (p_market_id IS NULL OR s.market_id IS NULL OR s.market_id=p_market_id)
          AND (
            (s.status='active' AND s.current_period_end IS NOT NULL AND s.current_period_end>p_at)
            OR
            (s.status='past_due'
             AND s.recovery_stage IN ('grace','retrying')
             AND s.dunning_started_at IS NOT NULL
             AND s.dunning_deadline_at IS NOT NULL
             AND s.dunning_deadline_at>p_at)
          )
      )
    END
    FROM tenants t
    WHERE t.id=p_tenant_id
  ),false)
$$;
