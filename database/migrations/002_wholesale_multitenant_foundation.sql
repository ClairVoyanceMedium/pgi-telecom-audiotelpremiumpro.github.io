-- PGI Telecom — multi-tenant / wholesale SVA foundation.
-- Additive only: existing single-tenant runtime remains compatible.

CREATE TABLE tenants (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  legal_name text,
  tenant_type text NOT NULL DEFAULT 'customer'
    CHECK (tenant_type IN ('internal','customer','reseller')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','closed')),
  country_code char(2),
  billing_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tenants(slug,display_name,legal_name,tenant_type,status,country_code)
VALUES ('pgi-internal','PGI Telecom','PGI Telecom','internal','active','FR')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE tenant_memberships (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  user_id bigint NOT NULL REFERENCES app_users(id),
  role text NOT NULL
    CHECK (role IN ('owner','admin','finance','operator','readonly')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,user_id)
);

CREATE TABLE tenant_number_assignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  assignment_type text NOT NULL DEFAULT 'customer_service'
    CHECK (assignment_type IN ('own_service','customer_service','reseller_suballocation')),
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','pending_kyc','testing','active','suspended','ended')),
  valid_from timestamptz,
  valid_to timestamptz,
  tariff_code text,
  commercial_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

CREATE INDEX tenant_number_assignments_tenant_idx
  ON tenant_number_assignments(tenant_id,status,created_at DESC);

CREATE INDEX tenant_number_assignments_number_idx
  ON tenant_number_assignments(sva_number_id,status,created_at DESC);

CREATE TABLE tenant_settlements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  upstream_settlement_id bigint REFERENCES carrier_settlements(id),
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_service_amount_ht numeric(16,6) NOT NULL DEFAULT 0,
  upstream_payout_ht numeric(16,6) NOT NULL DEFAULT 0,
  platform_fee_ht numeric(16,6) NOT NULL DEFAULT 0,
  net_payout_ht numeric(16,6) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reconciled','invoiced','payable','paid','disputed')),
  payment_due_date date,
  paid_at timestamptz,
  statement_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (gross_service_amount_ht >= 0),
  CHECK (upstream_payout_ht >= 0),
  CHECK (platform_fee_ht >= 0),
  CHECK (net_payout_ht >= 0)
);

CREATE UNIQUE INDEX tenant_settlement_period_unique
  ON tenant_settlements(tenant_id,period_start,period_end);

CREATE TABLE tenant_settlement_calls (
  tenant_settlement_id bigint NOT NULL REFERENCES tenant_settlements(id) ON DELETE CASCADE,
  call_id bigint NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  attributable_amount_ht numeric(14,6) NOT NULL DEFAULT 0,
  platform_fee_ht numeric(14,6) NOT NULL DEFAULT 0,
  net_payout_ht numeric(14,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_settlement_id,call_id),
  CHECK (attributable_amount_ht >= 0),
  CHECK (platform_fee_ht >= 0),
  CHECK (net_payout_ht >= 0)
);

ALTER TABLE sva_numbers ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE experts ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE calls ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE metric_baselines ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE audit_log ADD COLUMN tenant_id bigint REFERENCES tenants(id);
ALTER TABLE financial_ledger ADD COLUMN tenant_id bigint REFERENCES tenants(id);

CREATE INDEX sva_numbers_tenant_idx ON sva_numbers(tenant_id,status);
CREATE INDEX experts_tenant_idx ON experts(tenant_id,status);
CREATE INDEX calls_tenant_started_idx ON calls(tenant_id,started_at DESC);
CREATE INDEX financial_ledger_tenant_time_idx ON financial_ledger(tenant_id,occurred_at DESC);

UPDATE sva_numbers
SET tenant_id=(SELECT id FROM tenants WHERE slug='pgi-internal')
WHERE tenant_id IS NULL;

UPDATE experts
SET tenant_id=(SELECT id FROM tenants WHERE slug='pgi-internal')
WHERE tenant_id IS NULL;

UPDATE calls
SET tenant_id=(SELECT id FROM tenants WHERE slug='pgi-internal')
WHERE tenant_id IS NULL;

UPDATE financial_ledger
SET tenant_id=(SELECT id FROM tenants WHERE slug='pgi-internal')
WHERE tenant_id IS NULL;
