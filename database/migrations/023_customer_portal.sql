BEGIN;

ALTER TABLE customer_principals
  ADD COLUMN session_version bigint NOT NULL DEFAULT 1 CHECK (session_version > 0);

CREATE TABLE customer_password_credentials (
  customer_principal_id uuid PRIMARY KEY REFERENCES customer_principals(id) ON DELETE CASCADE,
  password_hash text NOT NULL CHECK (char_length(password_hash) BETWEEN 20 AND 512),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended')),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_password_credentials_lock_idx
  ON customer_password_credentials(locked_until)
  WHERE locked_until IS NOT NULL;

CREATE FUNCTION pgi_bump_customer_session_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_principal_id uuid;
BEGIN
  v_principal_id=COALESCE(NEW.customer_principal_id,OLD.customer_principal_id);
  UPDATE customer_principals
  SET session_version=session_version+1,updated_at=now()
  WHERE id=v_principal_id;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customer_password_session_version
AFTER INSERT OR UPDATE OR DELETE ON customer_password_credentials
FOR EACH ROW EXECUTE FUNCTION pgi_bump_customer_session_version();

CREATE VIEW tenant_scoped_portal_calls
WITH (security_barrier=true)
AS
SELECT
  f.call_id,f.tenant_id,f.market_id,m.country_code AS market,f.currency,
  f.sva_number_id,sn.display_number,sn.e164,
  f.started_at,f.ended_at,f.call_status,
  f.conversation_seconds,f.billable_seconds,f.payout_eligible_seconds,
  f.retail_service_amount_ttc
FROM call_facts f
JOIN sva_numbers sn ON sn.id=f.sva_number_id AND sn.tenant_id=f.tenant_id
LEFT JOIN operating_markets m ON m.id=f.market_id
WHERE f.tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_metric_rollups_daily
WITH (security_barrier=true)
AS
SELECT
  tenant_bucket,bucket_date,tenant_id,market_id,currency,
  calls_total,calls_connected,calls_abandoned,calls_failed,
  conversation_seconds,billable_seconds,payout_eligible_seconds,
  generated_revenue_ttc,expected_payout_ht,confirmed_payout_ht,paid_payout_ht,
  source_generation,updated_at
FROM metric_rollups_daily_v2
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_subscriptions
WITH (security_barrier=true)
AS
SELECT
  s.id,s.tenant_id,s.market_id,s.status,s.billing_currency,s.starts_at,
  s.current_period_start,s.current_period_end,s.ends_at,s.cancel_at_period_end,
  s.last_payment_status,s.last_event_at,p.plan_key,p.display_name AS plan_name,
  v.amount_minor,v.currency AS price_currency,v.billing_interval,v.interval_count
FROM tenant_subscriptions s
JOIN service_plans p ON p.id=s.service_plan_id
LEFT JOIN service_plan_price_versions v ON v.id=s.price_version_id
WHERE s.tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_number_assignments
WITH (security_barrier=true)
AS
SELECT
  id,tenant_id,sva_number_id,assignment_type,status,valid_from,valid_to,
  tariff_code,kyc_status,created_at
FROM tenant_number_assignments
WHERE tenant_id=pgi_require_tenant_context();

COMMIT;
