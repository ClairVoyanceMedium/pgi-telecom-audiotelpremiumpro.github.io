-- PGI Telecom Distribution: append-only preparation of operator and cash receipt evidence.
-- NEVER asserts that money was collected; no posting, payout, Stripe or bank action.
-- Additive only, Audiotel Premium Pro schema and records remain unchanged.

CREATE TABLE IF NOT EXISTS direct_sva_collection_statements (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_unit text NOT NULL DEFAULT 'direct_sva' CHECK (business_unit='direct_sva'),
 operator_reference text NOT NULL CHECK (length(operator_reference) BETWEEN 8 AND 120),
 statement_reference text NOT NULL CHECK (length(statement_reference) BETWEEN 8 AND 120),
 period_key char(7) NOT NULL CHECK (period_key ~ '^20[2-9][0-9]-(0[1-9]|1[0-2])$'),
 statement_fingerprint char(64) NOT NULL CHECK (statement_fingerprint ~ '^[0-9a-f]{64}$'),
 currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
 upstream_minor bigint NOT NULL CHECK (upstream_minor>0 AND upstream_minor<=1000000000000),
 pgi_margin_minor bigint NOT NULL CHECK (pgi_margin_minor>=0),
 publisher_due_minor bigint NOT NULL CHECK (publisher_due_minor>=0),
 verification_state text NOT NULL DEFAULT 'unverified' CHECK(verification_state='unverified'),
 accounting_posting_authorized boolean NOT NULL DEFAULT false CHECK(accounting_posting_authorized=false),
 payout_authorized boolean NOT NULL DEFAULT false CHECK(payout_authorized=false),
 prepared_by_hash char(64) NOT NULL CHECK(prepared_by_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(operator_reference,statement_reference),
 CHECK(upstream_minor=pgi_margin_minor+publisher_due_minor)
);
CREATE INDEX IF NOT EXISTS direct_sva_collection_statement_period_idx
 ON direct_sva_collection_statements(period_key,created_at DESC);

CREATE TABLE IF NOT EXISTS direct_sva_collection_receipt_evidence (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 statement_id bigint NOT NULL REFERENCES direct_sva_collection_statements(id),
 receipt_reference text NOT NULL CHECK(length(receipt_reference) BETWEEN 8 AND 120),
 bank_statement_reference text NOT NULL CHECK(length(bank_statement_reference) BETWEEN 8 AND 120),
 booking_date date NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=1000000000000),
 currency char(3) NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 verification_state text NOT NULL DEFAULT 'unverified' CHECK(verification_state='unverified'),
 money_received_confirmed boolean NOT NULL DEFAULT false CHECK(money_received_confirmed=false),
 accounting_posting_authorized boolean NOT NULL DEFAULT false CHECK(accounting_posting_authorized=false),
 payout_authorized boolean NOT NULL DEFAULT false CHECK(payout_authorized=false),
 external_execution_enabled boolean NOT NULL DEFAULT false CHECK(external_execution_enabled=false),
 prepared_by_hash char(64) NOT NULL CHECK(prepared_by_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(statement_id,receipt_reference)
);
CREATE INDEX IF NOT EXISTS direct_sva_collection_receipt_statement_idx
 ON direct_sva_collection_receipt_evidence(statement_id,booking_date,created_at);

CREATE FUNCTION direct_sva_guard_collection_receipt_ceiling()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 maximum bigint;
 running_total numeric;
BEGIN
 SELECT upstream_minor INTO maximum
 FROM direct_sva_collection_statements WHERE id=NEW.statement_id FOR UPDATE;
 IF maximum IS NULL THEN
  RAISE EXCEPTION 'direct SVA collection statement required';
 END IF;
 SELECT COALESCE(SUM(amount_minor),0) INTO running_total
 FROM direct_sva_collection_receipt_evidence WHERE statement_id=NEW.statement_id;
 IF running_total+NEW.amount_minor>maximum THEN
  RAISE EXCEPTION 'direct SVA recorded receipts exceed the stated operator net';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER direct_sva_guard_collection_receipt_ceiling
BEFORE INSERT ON direct_sva_collection_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_collection_receipt_ceiling();

CREATE FUNCTION direct_sva_guard_collection_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'direct SVA preparatory financial evidence is immutable; correct with a new reviewed record';
END;
$$;
CREATE TRIGGER direct_sva_guard_collection_statement_immutable
BEFORE UPDATE OR DELETE ON direct_sva_collection_statements
FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_collection_evidence_immutable();
CREATE TRIGGER direct_sva_guard_collection_receipt_immutable
BEFORE UPDATE OR DELETE ON direct_sva_collection_receipt_evidence
FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_collection_evidence_immutable();
