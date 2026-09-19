BEGIN;

-- Keep the customer control center selective at hyperscale.
CREATE INDEX IF NOT EXISTS tenant_kyc_status_tenant_idx
  ON tenant_kyc_profiles(status,tenant_id);

CREATE INDEX IF NOT EXISTS tenants_admin_status_country_id_idx
  ON tenants(status,country_code,id DESC)
  WHERE tenant_type <> 'internal';

COMMIT;
