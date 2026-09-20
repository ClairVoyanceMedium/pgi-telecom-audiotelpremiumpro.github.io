-- PGI Telecom — French SVA RIO and source-contract separation.
-- Expand-only. Portability moves the number; it never assigns the donor contract,
-- its debt, penalties or remaining commitment to PGI.

ALTER TABLE tenant_portability_requests
  ADD COLUMN rio_ciphertext bytea,
  ADD COLUMN rio_fingerprint char(64),
  ADD COLUMN rio_last4 char(4),
  ADD COLUMN rio_validation_status text NOT NULL DEFAULT 'pending'
    CHECK (rio_validation_status IN ('pending','verified','rejected')),
  ADD COLUMN rio_validated_at timestamptz,
  ADD COLUMN source_contract_transfer_mode text NOT NULL DEFAULT 'none'
    CHECK (source_contract_transfer_mode='none'),
  ADD COLUMN source_contract_liability_acknowledged boolean NOT NULL DEFAULT false;

ALTER TABLE tenant_portability_requests
  ADD CONSTRAINT tenant_portability_requests_rio_verified_check
    CHECK (
      rio_validation_status <> 'verified'
      OR (rio_ciphertext IS NOT NULL AND rio_fingerprint IS NOT NULL AND rio_last4 IS NOT NULL AND rio_validated_at IS NOT NULL)
    ),
  ADD CONSTRAINT tenant_portability_requests_fr_operator_gate
    CHECK (
      country_code <> 'FR'
      OR status NOT IN ('operator_pending','scheduled','ported')
      OR (rio_validation_status='verified' AND source_contract_liability_acknowledged=true)
    ) NOT VALID,
  ADD CONSTRAINT tenant_portability_requests_no_source_contract_transfer
    CHECK (source_contract_transfer_mode='none') NOT VALID;

CREATE INDEX tenant_portability_requests_rio_status_idx
  ON tenant_portability_requests(country_code,rio_validation_status,status);

CREATE VIEW tenant_scoped_portability_requests_v3
WITH (security_barrier=true)
AS
SELECT
  id,tenant_id,sva_number_id,country_code,requested_e164,display_number,service_family,
  current_operator_name,current_operator_reference,account_holder_name,desired_port_date,
  status,ownership_status,authorization_confirmed,number_owner_confirmed,
  operator_portability_reference,scheduled_at,completed_at,rejection_reason,
  tariff_code,service_rate_ttc_per_min,currency,tariff_verification_status,tariff_verified_at,
  rio_last4,rio_validation_status,rio_validated_at,
  source_contract_transfer_mode,source_contract_liability_acknowledged,
  created_at,updated_at
FROM tenant_portability_requests
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON COLUMN tenant_portability_requests.rio_ciphertext IS
'Encrypted portability credential. Never exposed by tenant-scoped views or customer/admin APIs.';

COMMENT ON COLUMN tenant_portability_requests.rio_validation_status IS
'For French SVA port-ins, the RIO is validated locally before the request can enter the operator phase.';

COMMENT ON COLUMN tenant_portability_requests.source_contract_transfer_mode IS
'Always none: PGI receives the ported number, not an assignment of the donor contract or its liabilities.';

COMMENT ON COLUMN tenant_portability_requests.source_contract_liability_acknowledged IS
'Customer acknowledgement that pre-existing debt, penalties and minimum-term obligations remain with the customer and are not assumed by PGI.';
