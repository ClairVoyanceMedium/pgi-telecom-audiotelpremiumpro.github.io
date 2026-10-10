-- PGI Telecom Distribution only: financial cycle / publisher allocation / action fence.
-- Preparation schema, never a disbursement mechanism or statutory accounting export.
-- Additive to 081; Audiotel Premium Pro is not changed.
CREATE TABLE IF NOT EXISTS direct_sva_financial_cycle_previews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_unit text NOT NULL DEFAULT 'direct_sva' CHECK (business_unit='direct_sva'),
 cycle_reference text NOT NULL UNIQUE CHECK (cycle_reference ~ '^DSVA-CYCLE-[0-9a-f]{32}$'),
 cycle_fingerprint char(64) NOT NULL UNIQUE CHECK (cycle_fingerprint ~ '^[0-9a-f]{64}$'),
 source_statement_id bigint REFERENCES direct_sva_collection_statements(id),
 operator_reference text NOT NULL CHECK (length(operator_reference) BETWEEN 8 AND 120),
 statement_reference text NOT NULL CHECK (length(statement_reference) BETWEEN 8 AND 120),
 period_key char(7) NOT NULL CHECK (period_key ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$'),
 currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
 operator_reported_minor bigint NOT NULL CHECK (operator_reported_minor BETWEEN 1 AND 1000000000000),
 pgi_margin_estimate_minor bigint NOT NULL CHECK (pgi_margin_estimate_minor BETWEEN 0 AND 1000000000000),
 publisher_liability_estimate_minor bigint NOT NULL CHECK (publisher_liability_estimate_minor BETWEEN 0 AND 1000000000000),
 receipts_reported_unverified_minor bigint NOT NULL DEFAULT 0 CHECK (receipts_reported_unverified_minor BETWEEN 0 AND 1000000000000),
 issuer_signature_verified boolean NOT NULL DEFAULT false CHECK (issuer_signature_verified=false),
 bank_reconciliation_verified boolean NOT NULL DEFAULT false CHECK (bank_reconciliation_verified=false),
 accounting_posting_authorized boolean NOT NULL DEFAULT false CHECK (accounting_posting_authorized=false),
 payout_authorized boolean NOT NULL DEFAULT false CHECK (payout_authorized=false),
 actual_funds_movement_minor bigint NOT NULL DEFAULT 0 CHECK (actual_funds_movement_minor=0),
 source_kind text NOT NULL DEFAULT 'untrusted_preparation' CHECK (source_kind='untrusted_preparation'),
 created_by_hash char(64) NOT NULL CHECK (created_by_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (operator_reported_minor=pgi_margin_estimate_minor+publisher_liability_estimate_minor),
 CHECK (receipts_reported_unverified_minor<=operator_reported_minor),
 UNIQUE (operator_reference,statement_reference)
);
CREATE INDEX IF NOT EXISTS direct_sva_financial_cycle_period_idx
 ON direct_sva_financial_cycle_previews(period_key,created_at DESC);

CREATE TABLE IF NOT EXISTS direct_sva_financial_publisher_previews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cycle_id bigint NOT NULL REFERENCES direct_sva_financial_cycle_previews(id),
 publisher_reference text NOT NULL CHECK (length(publisher_reference) BETWEEN 8 AND 120),
 calls integer NOT NULL CHECK (calls BETWEEN 1 AND 500),
 upstream_minor bigint NOT NULL CHECK (upstream_minor BETWEEN 0 AND 1000000000000),
 pgi_margin_minor bigint NOT NULL CHECK (pgi_margin_minor BETWEEN 0 AND 1000000000000),
 publisher_due_minor bigint NOT NULL CHECK (publisher_due_minor BETWEEN 0 AND 1000000000000),
 held_unverified_minor bigint NOT NULL DEFAULT 0 CHECK (held_unverified_minor BETWEEN 0 AND 1000000000000),
 collected_confirmed_minor bigint NOT NULL DEFAULT 0 CHECK (collected_confirmed_minor=0),
 paid_confirmed_minor bigint NOT NULL DEFAULT 0 CHECK (paid_confirmed_minor=0),
 beneficiary_kyb_verified boolean NOT NULL DEFAULT false CHECK (beneficiary_kyb_verified=false),
 payout_eligible boolean NOT NULL DEFAULT false CHECK (payout_eligible=false),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cycle_id,publisher_reference),
 CHECK (upstream_minor=pgi_margin_minor+publisher_due_minor),
 CHECK (held_unverified_minor<=publisher_due_minor)
);
CREATE INDEX IF NOT EXISTS direct_sva_financial_publisher_ref_idx
 ON direct_sva_financial_publisher_previews(publisher_reference,cycle_id DESC);

CREATE TABLE IF NOT EXISTS direct_sva_financial_action_previews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cycle_id bigint NOT NULL REFERENCES direct_sva_financial_cycle_previews(id),
 action_key text NOT NULL CHECK (action_key IN (
  'cdr_import','statement_authenticity','bank_reconciliation','publisher_identity',
  'tax_model','funds_safeguards','accounting_draft','business_live',
  'payout_preparation','payout_execution','payment_confirmation','exceptions_and_alerts')),
 action_state text NOT NULL DEFAULT 'awaiting_authoritative_evidence'
  CHECK (action_state='awaiting_authoritative_evidence'),
 idempotency_key char(64) NOT NULL UNIQUE CHECK (idempotency_key ~ '^[0-9a-f]{64}$'),
 execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized=false),
 external_delivery_enabled boolean NOT NULL DEFAULT false CHECK (external_delivery_enabled=false),
 external_action_reference text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cycle_id,action_key),
 CHECK(external_action_reference IS NULL)
);

CREATE TABLE IF NOT EXISTS direct_sva_financial_audit_previews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cycle_id bigint NOT NULL REFERENCES direct_sva_financial_cycle_previews(id),
 event_type text NOT NULL CHECK(event_type IN (
  'preview_prepared','amount_discrepancy','publisher_hold_declared','external_prerequisite_missing')),
 event_digest char(64) NOT NULL CHECK(event_digest ~ '^[0-9a-f]{64}$'),
 actor_hash char(64) NOT NULL CHECK(actor_hash ~ '^[0-9a-f]{64}$'),
 has_authoritative_evidence boolean NOT NULL DEFAULT false CHECK(has_authoritative_evidence=false),
 external_side_effect boolean NOT NULL DEFAULT false CHECK(external_side_effect=false),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cycle_id,event_type,event_digest)
);
CREATE INDEX IF NOT EXISTS direct_sva_financial_audit_cycle_idx
 ON direct_sva_financial_audit_previews(cycle_id,id DESC);

CREATE FUNCTION direct_sva_guard_financial_preparation_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'PGI distribution financial previews are immutable; use reviewed correction records';
END;
$$;
CREATE TRIGGER direct_sva_guard_financial_cycle_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_financial_cycle_previews
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_financial_preparation_immutable();
CREATE TRIGGER direct_sva_guard_financial_publisher_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_financial_publisher_previews
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_financial_preparation_immutable();
CREATE TRIGGER direct_sva_guard_financial_action_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_financial_action_previews
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_financial_preparation_immutable();
CREATE TRIGGER direct_sva_guard_financial_audit_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_financial_audit_previews
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_financial_preparation_immutable();
