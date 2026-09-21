BEGIN;

-- Customer 360: fast recent-signup views and exact duplicate lookups.
CREATE INDEX IF NOT EXISTS tenants_external_created_idx
  ON tenants(created_at DESC,id DESC)
  WHERE tenant_type<>'internal';

CREATE INDEX IF NOT EXISTS tenants_external_billing_email_idx
  ON tenants((lower(btrim(billing_email))),id DESC)
  WHERE tenant_type<>'internal' AND billing_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS tenant_kyc_registration_lookup_idx
  ON tenant_kyc_profiles(registration_country,registration_number,tenant_id)
  WHERE registration_number IS NOT NULL;

COMMIT;
