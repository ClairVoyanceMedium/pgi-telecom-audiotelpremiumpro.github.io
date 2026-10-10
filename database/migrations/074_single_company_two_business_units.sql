-- PGI Telecom: one legal accounting entity, two independent business units.
-- Additive preparation only. No new marketing/property sync, ledger import or operator activation.

CREATE TABLE IF NOT EXISTS pgi_company_business_units (
  unit_code text PRIMARY KEY CHECK(unit_code IN ('audiotel_platform','direct_sva')),
  legal_accounting_profile_id smallint NOT NULL DEFAULT 1
    REFERENCES platform_accounting_settings(id) CHECK(legal_accounting_profile_id=1),
  analytics_namespace text NOT NULL UNIQUE,
  cost_center text NOT NULL UNIQUE,
  display_name text NOT NULL,
  lifecycle_status text NOT NULL CHECK(lifecycle_status IN ('existing','preparation')),
  direct_distribution_sync_enabled boolean NOT NULL DEFAULT false CHECK(direct_distribution_sync_enabled=false),
  separate_legal_fec boolean NOT NULL DEFAULT false CHECK(separate_legal_fec=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((unit_code='audiotel_platform' AND lifecycle_status='existing')
    OR (unit_code='direct_sva' AND lifecycle_status='preparation'))
);
INSERT INTO pgi_company_business_units(
 unit_code,legal_accounting_profile_id,analytics_namespace,cost_center,display_name,lifecycle_status
) VALUES
 ('audiotel_platform',1,'audiotel','APP','Audiotel Premium Pro','existing'),
 ('direct_sva',1,'distribution_directe','DSVA','Distribution SVA directe','preparation')
ON CONFLICT(unit_code) DO NOTHING;

-- Account/accountant-approved FEC merge is a separate future operation.
-- A direct entry can appear at most once in the statutory bridge.
CREATE TABLE IF NOT EXISTS direct_sva_statutory_accounting_bridge (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  direct_entry_id bigint NOT NULL UNIQUE REFERENCES direct_sva_journal_entries(id),
  legal_accounting_profile_id smallint NOT NULL DEFAULT 1
    REFERENCES platform_accounting_settings(id) CHECK(legal_accounting_profile_id=1),
  statutory_entry_id bigint UNIQUE REFERENCES platform_accounting_entries(id),
  mapping_status text NOT NULL DEFAULT 'awaiting_expert_review'
    CHECK(mapping_status='awaiting_expert_review'),
  expert_mapping_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(statutory_entry_id IS NULL)
);

-- CRM / GSC / GA4 metadata registry: reference only, never actual credentials.
-- The checks are not connected and cannot be presented as operational.
CREATE TABLE IF NOT EXISTS direct_sva_integration_readiness (
  integration_key text PRIMARY KEY CHECK(integration_key IN (
    'ga4','gsc','hubspot','statutory_accounting','network','payment_psp'
  )),
  business_unit text NOT NULL DEFAULT 'direct_sva'
    REFERENCES pgi_company_business_units(unit_code) CHECK(business_unit='direct_sva'),
  readiness_status text NOT NULL DEFAULT 'planned'
    CHECK(readiness_status IN ('planned','documented','tested')),
  activation_status text NOT NULL DEFAULT 'disabled' CHECK(activation_status='disabled'),
  can_send_data boolean NOT NULL DEFAULT false CHECK(can_send_data=false),
  evidence_reference text,
  configuration_notes text,
  last_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(readiness_status='planned' OR length(btrim(COALESCE(evidence_reference,'')))>=6)
);
INSERT INTO direct_sva_integration_readiness(integration_key) VALUES
 ('ga4'),('gsc'),('hubspot'),('statutory_accounting'),('network'),('payment_psp')
ON CONFLICT(integration_key) DO NOTHING;

-- Future operator numbers and direct account entries cannot be linked accidentally
-- to ordinary Audiotel commercial documents by an automated cross-unit key.
CREATE TABLE IF NOT EXISTS direct_sva_crm_outbox_preparation (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  direct_source_reference text NOT NULL UNIQUE CHECK (direct_source_reference ~ '^DSVA-[A-Za-z0-9_-]{6,80}$'),
  unit_code text NOT NULL DEFAULT 'direct_sva'
    REFERENCES pgi_company_business_units(unit_code) CHECK(unit_code='direct_sva'),
  integration_state text NOT NULL DEFAULT 'unconfigured'
    CHECK(integration_state='unconfigured'),
  send_enabled boolean NOT NULL DEFAULT false CHECK(send_enabled=false),
  hubspot_deal_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(hubspot_deal_id IS NULL)
);
