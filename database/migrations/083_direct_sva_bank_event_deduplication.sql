-- PGI Telecom Distribution only. Global bank movement replay protection and
-- independent exception register, preparation stage with ZERO payment capability.
-- A bank reference can never be counted in two different operator statements.
CREATE TABLE IF NOT EXISTS direct_sva_bank_event_previews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_unit text NOT NULL DEFAULT 'direct_sva' CHECK(business_unit='direct_sva'),
 source_adapter text NOT NULL CHECK(source_adapter ~ '^[a-z_]{4,64}$'),
 external_movement_reference text NOT NULL CHECK(length(external_movement_reference) BETWEEN 8 AND 140),
 source_payload_digest char(64) NOT NULL CHECK(source_payload_digest ~ '^[0-9a-f]{64}$'),
 cycle_id bigint REFERENCES direct_sva_financial_cycle_previews(id),
 collection_statement_id bigint NOT NULL REFERENCES direct_sva_collection_statements(id),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000000),
 currency char(3) NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'),
 booking_date date NOT NULL,
 source_verification_state text NOT NULL DEFAULT 'unverified' CHECK(source_verification_state='unverified'),
 bank_money_confirmed boolean NOT NULL DEFAULT false CHECK(bank_money_confirmed=false),
 financial_posting_allowed boolean NOT NULL DEFAULT false CHECK(financial_posting_allowed=false),
 payout_allowed boolean NOT NULL DEFAULT false CHECK(payout_allowed=false),
 created_by_hash char(64) NOT NULL CHECK(created_by_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_adapter,external_movement_reference)
);
CREATE INDEX IF NOT EXISTS direct_sva_bank_event_statement_idx
 ON direct_sva_bank_event_previews(collection_statement_id,booking_date);

CREATE TABLE IF NOT EXISTS direct_sva_financial_exception_previews (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_unit text NOT NULL DEFAULT 'direct_sva' CHECK(business_unit='direct_sva'),
 cycle_id bigint NOT NULL REFERENCES direct_sva_financial_cycle_previews(id),
 exception_reference text NOT NULL UNIQUE CHECK(length(exception_reference) BETWEEN 8 AND 120),
 exception_kind text NOT NULL CHECK(exception_kind IN (
  'duplicate_bank_event','settlement_difference','unattributed_publisher',
  'invalid_cdr','publisher_compliance','disputed_amount','bank_feed_unverified',
  'payment_provider_unavailable')),
 source_digest char(64) NOT NULL CHECK(source_digest ~ '^[0-9a-f]{64}$'),
 review_state text NOT NULL DEFAULT 'requires_independent_review'
  CHECK(review_state='requires_independent_review'),
 payout_release_allowed boolean NOT NULL DEFAULT false CHECK(payout_release_allowed=false),
 customer_message_sent boolean NOT NULL DEFAULT false CHECK(customer_message_sent=false),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS direct_sva_financial_exception_cycle_idx
 ON direct_sva_financial_exception_previews(cycle_id,created_at DESC);

CREATE TRIGGER direct_sva_guard_bank_event_preview_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_bank_event_previews
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_financial_preparation_immutable();
CREATE TRIGGER direct_sva_guard_financial_exception_preview_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_financial_exception_previews
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_financial_preparation_immutable();
