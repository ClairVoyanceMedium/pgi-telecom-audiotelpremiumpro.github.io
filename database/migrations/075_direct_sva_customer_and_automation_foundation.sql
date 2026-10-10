-- Future direct SVA customer journey and event automation, isolated within PGI legal entity.
-- Entire schema is preparation-only. No customer activation or external side effects.

CREATE TABLE IF NOT EXISTS direct_sva_customer_accounts (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id),
  business_unit text NOT NULL DEFAULT 'direct_sva' CHECK(business_unit='direct_sva'),
  access_state text NOT NULL DEFAULT 'preparation' CHECK(access_state='preparation'),
  dashboard_enabled boolean NOT NULL DEFAULT false CHECK(dashboard_enabled=false),
  client_contract_accepted boolean NOT NULL DEFAULT false CHECK(client_contract_accepted=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  notes_reference text
);

CREATE TABLE IF NOT EXISTS direct_sva_customer_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES direct_sva_customer_accounts(tenant_id),
  public_reference text NOT NULL UNIQUE CHECK(public_reference ~ '^DSVA-[A-Z0-9_-]{8,60}$'),
  request_kind text NOT NULL CHECK(request_kind IN ('new_number','portability','wholesale_inquiry','routing','accounting')),
  status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','awaiting_authorization','on_hold','closed')),
  contract_reference text,
  evidence_reference text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  last_review_at timestamptz,
  CHECK(status NOT IN ('active','provisioned','paid'))
);
CREATE INDEX IF NOT EXISTS direct_sva_customer_cases_tenant_idx
  ON direct_sva_customer_cases(tenant_id,status,initiated_at DESC);

CREATE TABLE IF NOT EXISTS direct_sva_customer_case_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES direct_sva_customer_cases(id),
  event_key text NOT NULL CHECK(event_key IN
    ('case_prepared','documents_requested','documents_reviewed','on_hold','reviewed','closed')),
  evidence_reference text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,event_key,evidence_reference)
);

CREATE TABLE IF NOT EXISTS direct_sva_automation_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_unit text NOT NULL DEFAULT 'direct_sva' CHECK(business_unit='direct_sva'),
  workflow_key text NOT NULL CHECK(workflow_key IN
    ('lead_routing','compliance_check','contract_review','number_assignment','portability',
     'cdr_ingestion','settlement_reconciliation','accounting_draft','invoice_review',
     'publisher_payout','hubspot_sync','analytics_delivery','support_followup')),
  source_reference text NOT NULL CHECK(length(source_reference) BETWEEN 6 AND 120),
  idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 12 AND 180),
  customer_tenant_id bigint REFERENCES direct_sva_customer_accounts(tenant_id),
  run_state text NOT NULL DEFAULT 'pending_authorization'
    CHECK(run_state='pending_authorization'),
  external_execution_enabled boolean NOT NULL DEFAULT false CHECK(external_execution_enabled=false),
  financial_transfer_enabled boolean NOT NULL DEFAULT false CHECK(financial_transfer_enabled=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(business_unit,workflow_key,source_reference)
);
CREATE INDEX IF NOT EXISTS direct_sva_automation_jobs_workflow_idx
 ON direct_sva_automation_jobs(workflow_key,created_at DESC);

CREATE TABLE IF NOT EXISTS direct_sva_automation_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES direct_sva_automation_jobs(id),
  event_type text NOT NULL CHECK(event_type IN ('scheduled','blocked','reviewed','cancelled')),
  audit_reference text NOT NULL CHECK(length(audit_reference)>=6),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION direct_sva_guard_automation_events()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'direct SVA automation events are append-only';
END;
$$;
CREATE TRIGGER direct_sva_guard_automation_events
BEFORE UPDATE OR DELETE ON direct_sva_automation_events
FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_automation_events();

-- No job can be marked executable by an UPDATE in this schema phase.
-- Releasing these controls requires a separately reviewed migration and owner approval.
