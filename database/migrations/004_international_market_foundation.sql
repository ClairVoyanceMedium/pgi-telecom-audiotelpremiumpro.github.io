-- PGI Telecom — international market foundation.
-- Additive only. France remains the default market; no foreign market is activated automatically.

CREATE TABLE operating_markets (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  country_code char(2) NOT NULL UNIQUE
    CHECK (country_code ~ '^[A-Z]{2}$'),
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','testing','active','suspended','closed')),
  default_currency char(3) NOT NULL
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_locale text NOT NULL,
  timezone text NOT NULL,
  regulator_name text,
  numbering_authority text,
  data_region text NOT NULL DEFAULT 'eu',
  privacy_retention_days integer CHECK (privacy_retention_days IS NULL OR privacy_retention_days > 0),
  numbering_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  compliance_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO operating_markets(
  country_code,display_name,status,default_currency,default_locale,timezone,
  regulator_name,numbering_authority,data_region,numbering_profile
)
VALUES (
  'FR','France','active','EUR','fr-FR','Europe/Paris',
  'ARCEP','ARCEP','eu',
  '{"canonical_number_format":"E.164","service_family":"premium_rate","local_product":"SVA"}'::jsonb
)
ON CONFLICT (country_code) DO NOTHING;

ALTER TABLE tenants
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'fr-FR',
  ADD COLUMN default_currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (default_currency ~ '^[A-Z]{3}$'),
  ADD COLUMN timezone text NOT NULL DEFAULT 'Europe/Paris';

CREATE TABLE tenant_market_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','testing','active','suspended','closed')),
  preferred_locale text,
  billing_currency char(3)
    CHECK (billing_currency IS NULL OR billing_currency ~ '^[A-Z]{3}$'),
  timezone text,
  compliance_status text NOT NULL DEFAULT 'not_started'
    CHECK (compliance_status IN ('not_started','pending','verified','blocked','expired')),
  tax_registration_id text,
  tax_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_residency_region text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,market_id)
);

INSERT INTO tenant_market_profiles(
  tenant_id,market_id,status,preferred_locale,billing_currency,timezone,compliance_status,data_residency_region
)
SELECT t.id,m.id,'active','fr-FR','EUR','Europe/Paris','verified','eu'
FROM tenants t
JOIN operating_markets m ON m.country_code='FR'
WHERE t.slug='pgi-internal'
ON CONFLICT (tenant_id,market_id) DO NOTHING;

ALTER TABLE sva_numbers
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN number_type text NOT NULL DEFAULT 'premium_rate'
    CHECK (number_type IN ('premium_rate','shared_cost','freephone','geographic','mobile','other')),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN national_number text;

UPDATE sva_numbers
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

CREATE INDEX sva_numbers_market_status_idx ON sva_numbers(market_id,status);

CREATE TABLE sva_number_aliases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  market_id bigint REFERENCES operating_markets(id),
  carrier_id bigint REFERENCES carriers(id),
  alias text NOT NULL,
  alias_type text NOT NULL DEFAULT 'carrier_dialed'
    CHECK (alias_type IN ('national','international','display','carrier_dialed','portability','other')),
  normalized_e164 text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sva_number_aliases_carrier_alias_unique
  ON sva_number_aliases(COALESCE(carrier_id,0),alias);
CREATE INDEX sva_number_aliases_number_idx
  ON sva_number_aliases(sva_number_id,enabled);

INSERT INTO sva_number_aliases(sva_number_id,market_id,alias,alias_type,normalized_e164)
SELECT id,market_id,display_number,'display',e164
FROM sva_numbers
WHERE display_number IS NOT NULL AND display_number<>''
ON CONFLICT DO NOTHING;

CREATE TABLE carrier_market_capabilities (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  carrier_id bigint NOT NULL REFERENCES carriers(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  service_type text NOT NULL DEFAULT 'premium_rate'
    CHECK (service_type IN ('premium_rate','shared_cost','freephone','geographic','mobile','transit','other')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','testing','ready','active','standby','suspended','closed')),
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  numbering_prefixes jsonb NOT NULL DEFAULT '[]'::jsonb,
  settlement_currencies text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id,market_id,service_type)
);

CREATE TABLE carrier_connection_markets (
  carrier_connection_id bigint NOT NULL REFERENCES carrier_connections(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  priority integer NOT NULL DEFAULT 100 CHECK (priority > 0),
  inbound_domain text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (carrier_connection_id,market_id)
);

ALTER TABLE carrier_contracts
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE carrier_contracts cc
SET market_id=COALESCE(
  (SELECT sn.market_id FROM sva_numbers sn WHERE sn.id=cc.sva_number_id),
  (SELECT id FROM operating_markets WHERE country_code='FR')
)
WHERE market_id IS NULL;

ALTER TABLE carrier_settlements
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE carrier_settlements
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

ALTER TABLE tenant_settlements
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE tenant_settlements
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

ALTER TABLE calls
  ADD COLUMN market_id bigint REFERENCES operating_markets(id),
  ADD COLUMN currency char(3) NOT NULL DEFAULT 'EUR'
    CHECK (currency ~ '^[A-Z]{3}$');

UPDATE calls c
SET market_id=sn.market_id,
    currency=sn.currency
FROM sva_numbers sn
WHERE c.sva_number_id=sn.id AND c.market_id IS NULL;

ALTER TABLE financial_ledger
  ADD COLUMN market_id bigint REFERENCES operating_markets(id);

UPDATE financial_ledger f
SET market_id=c.market_id,
    currency=c.currency
FROM calls c
WHERE f.call_id=c.id AND f.market_id IS NULL;

ALTER TABLE logical_carrier_routes
  ADD COLUMN market_id bigint REFERENCES operating_markets(id);

UPDATE logical_carrier_routes
SET market_id=(SELECT id FROM operating_markets WHERE country_code='FR')
WHERE market_id IS NULL;

CREATE INDEX logical_carrier_routes_market_idx
  ON logical_carrier_routes(market_id,route_key);
CREATE INDEX calls_market_started_idx
  ON calls(market_id,started_at DESC);
CREATE INDEX carrier_contracts_market_idx
  ON carrier_contracts(market_id,carrier_id,valid_from DESC);
CREATE INDEX carrier_settlements_market_period_idx
  ON carrier_settlements(market_id,currency,period_end DESC);
CREATE INDEX tenant_settlements_market_period_idx
  ON tenant_settlements(market_id,currency,period_end DESC);
CREATE INDEX financial_ledger_market_time_idx
  ON financial_ledger(market_id,currency,occurred_at DESC);

CREATE TABLE payment_compliance_market_profiles (
  payment_compliance_profile_id bigint NOT NULL REFERENCES payment_compliance_profiles(id) ON DELETE CASCADE,
  market_id bigint NOT NULL REFERENCES operating_markets(id),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','onboarding','active','suspended','closed')),
  local_registration_reference text,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (payment_compliance_profile_id,market_id)
);
