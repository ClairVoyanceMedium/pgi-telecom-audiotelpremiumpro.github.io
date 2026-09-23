-- Billing recovery / dunning state for external SVA subscriptions.
-- A transient renewal failure receives a short service grace period while Stripe retries.
-- Earned SVA payouts are never deleted or held by this state machine.

CREATE TABLE subscription_recovery_states (
  subscription_id bigint PRIMARY KEY REFERENCES tenant_subscriptions(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  recovery_state text NOT NULL DEFAULT 'healthy'
    CHECK (recovery_state IN ('healthy','grace','retrying','action_required','suspended','recovered')),
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  grace_until timestamptz,
  recovery_deadline timestamptz,
  next_retry_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count>=0),
  last_invoice_reference text,
  last_payment_status text,
  recovered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (grace_until IS NULL OR first_failed_at IS NOT NULL),
  CHECK (recovery_deadline IS NULL OR first_failed_at IS NOT NULL),
  CHECK (recovery_deadline IS NULL OR grace_until IS NULL OR recovery_deadline>=grace_until)
);

CREATE INDEX subscription_recovery_state_due_idx
  ON subscription_recovery_states(recovery_state,grace_until,recovery_deadline,subscription_id);
CREATE INDEX subscription_recovery_tenant_idx
  ON subscription_recovery_states(tenant_id,updated_at DESC,subscription_id DESC);

CREATE TRIGGER subscription_recovery_states_touch
BEFORE UPDATE ON subscription_recovery_states
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE VIEW tenant_scoped_subscription_recovery
WITH (security_barrier=true)
AS
SELECT
  subscription_id,tenant_id,recovery_state,first_failed_at,last_failed_at,grace_until,recovery_deadline,
  next_retry_at,attempt_count,last_invoice_reference,last_payment_status,recovered_at,created_at,updated_at
FROM subscription_recovery_states
WHERE tenant_id=pgi_require_tenant_context();

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
          LEFT JOIN subscription_recovery_states r
            ON r.subscription_id=s.id AND r.tenant_id=s.tenant_id
          WHERE s.tenant_id=t.id
            AND p.plan_key='external-sva-access'
            AND p.status='active'
            AND e.entitlement_key='premium_rate_calls'
            AND e.value='true'::jsonb
            AND (
              (
                s.status='active'
                AND s.current_period_end IS NOT NULL
                AND s.current_period_end>p_at
              )
              OR
              (
                s.status='past_due'
                AND r.recovery_state IN ('grace','retrying','action_required')
                AND r.grace_until IS NOT NULL
                AND r.grace_until>p_at
              )
            )
            AND s.starts_at<=p_at
            AND (s.ends_at IS NULL OR s.ends_at>p_at)
            AND (p_market_id IS NULL OR s.market_id IS NULL OR s.market_id=p_market_id)
        )
      END
    FROM tenants t
    WHERE t.id=p_tenant_id
  ),false)
$$;
