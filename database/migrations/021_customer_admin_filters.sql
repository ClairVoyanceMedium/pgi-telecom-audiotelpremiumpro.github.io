BEGIN;

-- Keep the customer control center selective at hyperscale.
CREATE INDEX IF NOT EXISTS tenant_kyc_status_tenant_idx
  ON tenant_kyc_profiles(status,tenant_id);

COMMIT;
