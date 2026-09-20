-- PGI Telecom — verified tariff and atomic completion guards for customer port-in.
-- Expand-only. The public number remains the canonical E.164 identity through the move.

ALTER TABLE tenant_portability_requests
  ADD COLUMN tariff_code text,
  ADD COLUMN service_rate_ttc_per_min numeric(10,6),
  ADD COLUMN currency char(3),
  ADD COLUMN tariff_verification_status text NOT NULL DEFAULT 'pending'
    CHECK (tariff_verification_status IN ('pending','verified','rejected')),
  ADD COLUMN tariff_verified_at timestamptz,
  ADD COLUMN tariff_verified_by bigint REFERENCES app_users(id);

ALTER TABLE tenant_portability_requests
  ADD CONSTRAINT tenant_portability_requests_currency_check
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT tenant_portability_requests_rate_check
    CHECK (service_rate_ttc_per_min IS NULL OR service_rate_ttc_per_min >= 0),
  ADD CONSTRAINT tenant_portability_requests_verified_tariff_check
    CHECK (
      tariff_verification_status <> 'verified'
      OR (
        service_rate_ttc_per_min IS NOT NULL
        AND currency IS NOT NULL
        AND tariff_verified_at IS NOT NULL
      )
    ),
  ADD CONSTRAINT tenant_portability_requests_ported_guard
    CHECK (
      status <> 'ported'
      OR (
        ownership_status='verified'
        AND tariff_verification_status='verified'
        AND sva_number_id IS NOT NULL
        AND target_carrier_id IS NOT NULL
        AND operator_portability_reference IS NOT NULL
        AND completed_at IS NOT NULL
      )
    );

CREATE INDEX tenant_portability_requests_carrier_status_idx
  ON tenant_portability_requests(target_carrier_id,status,scheduled_at);

CREATE OR REPLACE VIEW tenant_scoped_portability_requests
WITH (security_barrier=true)
AS
SELECT
  id,tenant_id,sva_number_id,country_code,requested_e164,display_number,service_family,
  current_operator_name,current_operator_reference,account_holder_name,desired_port_date,
  status,ownership_status,authorization_confirmed,number_owner_confirmed,
  operator_portability_reference,scheduled_at,completed_at,rejection_reason,
  tariff_code,service_rate_ttc_per_min,currency,tariff_verification_status,tariff_verified_at,
  created_at,updated_at
FROM tenant_portability_requests
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON COLUMN tenant_portability_requests.service_rate_ttc_per_min IS
'Public service price per minute supplied for the existing number and verified before completion. It is copied unchanged to sva_numbers on successful port-in.';

COMMENT ON COLUMN tenant_portability_requests.tariff_verification_status IS
'Independent tariff verification gate. A request cannot become ported until the current public tariff has been verified.';
