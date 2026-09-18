-- PGI Telecom — tenant SQL access boundary.
-- Customer-facing data access must go through tenant-scoped security-barrier views.

CREATE OR REPLACE FUNCTION pgi_current_tenant_id()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('pgi.tenant_id', true),'')::bigint
$$;

CREATE OR REPLACE FUNCTION pgi_require_tenant_context()
RETURNS bigint
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_tenant_id bigint;
BEGIN
  v_tenant_id:=pgi_current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant context required';
  END IF;
  RETURN v_tenant_id;
END;
$$;

CREATE VIEW tenant_scoped_call_facts
WITH (security_barrier=true)
AS
SELECT
  tenant_bucket,call_id,tenant_id,market_id,currency,sva_number_id,expert_id,
  origin_carrier_id,host_carrier_id,started_at,ended_at,call_status,
  conversation_seconds,billable_seconds,payout_eligible_seconds,
  retail_service_amount_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,
  expert_cost_ht,technical_cost_ht,estimated_margin_ht,reconciliation_variance_ht
FROM call_facts
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_experts
WITH (security_barrier=true)
AS
SELECT
  id,tenant_id,code,display_name,status,active_calls,last_assigned_at,enabled,
  compensation_type,compensation_rate
FROM experts
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_sva_numbers
WITH (security_barrier=true)
AS
SELECT
  id,tenant_id,market_id,e164,display_number,tariff_code,currency,number_type,
  service_rate_ttc_per_min,status,portability_status,activated_at,created_at
FROM sva_numbers
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_settlements
WITH (security_barrier=true)
AS
SELECT
  id,tenant_id,market_id,currency,period_start,period_end,gross_service_amount_ht,
  upstream_payout_ht,platform_fee_ht,net_payout_ht,status,payment_due_date,paid_at,
  statement_reference,created_at
FROM tenant_settlements
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_usage_counters
WITH (security_barrier=true)
AS
SELECT
  tenant_bucket,tenant_id,usage_date,metric_key,quantity,updated_at
FROM tenant_usage_counters
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_memberships
WITH (security_barrier=true)
AS
SELECT
  tenant_id,customer_principal_id,role,status,permission_grants,permission_denials,
  joined_at,updated_at
FROM customer_tenant_memberships
WHERE tenant_id=pgi_require_tenant_context();
