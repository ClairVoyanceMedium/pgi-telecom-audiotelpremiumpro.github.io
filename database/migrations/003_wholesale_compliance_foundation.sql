-- PGI Telecom — wholesale regulatory and payment-compliance foundation.
-- Additive only. No production role is enabled by this migration.

ALTER TABLE tenant_number_assignments
  ADD COLUMN regulatory_assignor_carrier_id bigint REFERENCES carriers(id);

ALTER TABLE tenant_number_assignments
  ADD COLUMN upstream_assignment_reference text;

ALTER TABLE tenant_number_assignments
  ADD COLUMN kyc_status text NOT NULL DEFAULT 'not_started'
    CHECK (kyc_status IN ('not_started','pending','verified','rejected','expired'));

CREATE TABLE tenant_kyc_profiles (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT 'company'
    CHECK (entity_type IN ('individual','sole_trader','company','association','other')),
  registration_country char(2),
  registration_number text,
  legal_representative_verified boolean NOT NULL DEFAULT false,
  bank_account_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','rejected','expired')),
  provider_reference text,
  reviewed_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_compliance_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  profile_name text NOT NULL UNIQUE,
  regulatory_role text NOT NULL
    CHECK (regulatory_role IN ('upstream_direct','psp_agent','payment_institution','other')),
  provider_name text,
  registration_reference text,
  funds_flow_mode text NOT NULL
    CHECK (funds_flow_mode IN ('upstream_to_editor','psp_managed','platform_managed')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','active','suspended','closed')),
  valid_from date,
  valid_to date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX tenant_number_assignments_assignor_idx
  ON tenant_number_assignments(regulatory_assignor_carrier_id,status);

CREATE INDEX tenant_kyc_status_idx
  ON tenant_kyc_profiles(status,updated_at DESC);

CREATE INDEX payment_compliance_status_idx
  ON payment_compliance_profiles(status,created_at DESC);
