BEGIN;

-- Customer profitability cockpit: accelerate period/currency ranking across external tenants.
CREATE INDEX IF NOT EXISTS tenant_revenue_distributions_profitability_idx
  ON tenant_revenue_distributions(currency,period_end DESC,tenant_id)
  INCLUDE (platform_fee_ht,net_payout_ht,upstream_payout_ht,unallocated_amount_ht,upstream_settlement_id);

COMMIT;
