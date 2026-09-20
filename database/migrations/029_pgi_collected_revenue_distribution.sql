-- PGI Telecom — PGI-collected SVA revenue distribution.
-- Upstream operator money is accounted to PGI first. PGI margin is then deducted
-- before the tenant/client amount becomes payable. No bank transfer is executed here.

CREATE TABLE tenant_payout_terms (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id bigint REFERENCES operating_markets(id),
  sva_number_id bigint REFERENCES sva_numbers(id),
  collection_model text NOT NULL DEFAULT 'pgi_collects'
    CHECK (collection_model IN ('pgi_collects')),
  platform_fee_bps integer NOT NULL
    CHECK (platform_fee_bps BETWEEN 0 AND 10000),
  platform_fee_ht_per_min numeric(14,6) NOT NULL DEFAULT 0
    CHECK (platform_fee_ht_per_min >= 0),
  payout_delay_days integer NOT NULL DEFAULT 0
    CHECK (payout_delay_days BETWEEN 0 AND 365),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','ended')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX tenant_payout_terms_lookup_idx
  ON tenant_payout_terms(tenant_id,status,effective_from DESC);

CREATE UNIQUE INDEX tenant_payout_terms_active_scope_unique
  ON tenant_payout_terms(
    tenant_id,
    COALESCE(market_id,0),
    COALESCE(sva_number_id,0)
  )
  WHERE status='active' AND effective_to IS NULL;

CREATE TABLE tenant_revenue_distributions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  upstream_settlement_id bigint NOT NULL REFERENCES carrier_settlements(id),
  market_id bigint REFERENCES operating_markets(id),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  period_start date NOT NULL,
  period_end date NOT NULL,
  collection_model text NOT NULL DEFAULT 'pgi_collects'
    CHECK (collection_model IN ('pgi_collects')),
  upstream_payout_ht numeric(16,6) NOT NULL DEFAULT 0
    CHECK (upstream_payout_ht >= 0),
  platform_fee_ht numeric(16,6) NOT NULL DEFAULT 0
    CHECK (platform_fee_ht >= 0),
  net_payout_ht numeric(16,6) NOT NULL DEFAULT 0
    CHECK (net_payout_ht >= 0),
  unallocated_amount_ht numeric(16,6) NOT NULL DEFAULT 0
    CHECK (unallocated_amount_ht >= 0),
  held_amount_ht numeric(16,6) NOT NULL DEFAULT 0
    CHECK (held_amount_ht >= 0),
  payment_compliance_profile_id bigint REFERENCES payment_compliance_profiles(id),
  status text NOT NULL DEFAULT 'reconciled'
    CHECK (status IN ('blocked_terms','blocked_compliance','reconciled','payable','paid','disputed')),
  payment_due_date date,
  paid_at timestamptz,
  payment_reference text,
  statement_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (held_amount_ht <= net_payout_ht),
  CHECK (abs((platform_fee_ht + net_payout_ht + unallocated_amount_ht) - upstream_payout_ht) <= 0.00001),
  CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND payment_reference IS NOT NULL))
);

CREATE UNIQUE INDEX tenant_revenue_distributions_upstream_tenant_market_unique
  ON tenant_revenue_distributions(
    upstream_settlement_id,
    tenant_id,
    COALESCE(market_id,0),
    currency
  );

CREATE INDEX tenant_revenue_distributions_tenant_period_idx
  ON tenant_revenue_distributions(tenant_id,currency,period_end DESC,id DESC);

CREATE TABLE tenant_revenue_distribution_calls (
  tenant_distribution_id bigint NOT NULL REFERENCES tenant_revenue_distributions(id) ON DELETE CASCADE,
  call_id bigint NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  payout_terms_id bigint REFERENCES tenant_payout_terms(id),
  upstream_amount_ht numeric(14,6) NOT NULL DEFAULT 0 CHECK (upstream_amount_ht >= 0),
  platform_fee_ht numeric(14,6) NOT NULL DEFAULT 0 CHECK (platform_fee_ht >= 0),
  net_payout_ht numeric(14,6) NOT NULL DEFAULT 0 CHECK (net_payout_ht >= 0),
  unallocated_amount_ht numeric(14,6) NOT NULL DEFAULT 0 CHECK (unallocated_amount_ht >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_distribution_id,call_id),
  CHECK (abs((platform_fee_ht + net_payout_ht + unallocated_amount_ht) - upstream_amount_ht) <= 0.00001)
);

CREATE INDEX tenant_revenue_distribution_calls_call_idx
  ON tenant_revenue_distribution_calls(call_id);

CREATE VIEW tenant_scoped_revenue_distributions
WITH (security_barrier=true)
AS
SELECT
  id,tenant_id,upstream_settlement_id,market_id,currency,period_start,period_end,
  collection_model,upstream_payout_ht,platform_fee_ht,net_payout_ht,
  unallocated_amount_ht,held_amount_ht,payment_compliance_profile_id,status,
  payment_due_date,paid_at,payment_reference,statement_reference,created_at,updated_at
FROM tenant_revenue_distributions
WHERE tenant_id=pgi_require_tenant_context();

CREATE FUNCTION pgi_tenant_has_payout_terms(
  p_tenant_id bigint,
  p_market_id bigint,
  p_sva_number_id bigint,
  p_at timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tenant_payout_terms pt
    WHERE pt.tenant_id=p_tenant_id
      AND pt.status='active'
      AND pt.effective_from<=p_at
      AND (pt.effective_to IS NULL OR pt.effective_to>p_at)
      AND (pt.market_id IS NULL OR pt.market_id=p_market_id)
      AND (pt.sva_number_id IS NULL OR pt.sva_number_id=p_sva_number_id)
  )
$$;

CREATE FUNCTION pgi_require_payout_terms_for_active_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_market_id bigint;
  v_tenant_type text;
BEGIN
  IF NEW.status='active' THEN
    SELECT t.tenant_type INTO v_tenant_type
    FROM tenants t
    WHERE t.id=NEW.tenant_id;

    IF v_tenant_type<>'internal' THEN
      SELECT sn.market_id INTO v_market_id
      FROM sva_numbers sn
      WHERE sn.id=NEW.sva_number_id;

      IF NOT pgi_tenant_has_payout_terms(NEW.tenant_id,v_market_id,NEW.sva_number_id,COALESCE(NEW.valid_from,now())) THEN
        RAISE EXCEPTION 'active external SVA assignment requires PGI payout terms';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenant_number_assignments_payout_terms_gate
BEFORE INSERT OR UPDATE OF status,tenant_id,sva_number_id ON tenant_number_assignments
FOR EACH ROW
WHEN (NEW.status='active')
EXECUTE FUNCTION pgi_require_payout_terms_for_active_assignment();

COMMENT ON TABLE tenant_revenue_distributions IS
'Accounting distribution of SVA money received/receivable by PGI from the upstream carrier: upstream amount minus PGI margin equals client net payout.';

COMMENT ON COLUMN tenant_revenue_distributions.platform_fee_ht IS
'PGI commercial margin retained before the client net payout is made payable.';

COMMENT ON COLUMN tenant_revenue_distributions.net_payout_ht IS
'Amount contractually attributable to the client after PGI margin; payment remains gated by compliance and upstream receipt.';
