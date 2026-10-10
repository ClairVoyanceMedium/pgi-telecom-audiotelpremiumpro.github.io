-- Direct SVA complaints, isolated from the existing Audiotel helpdesk.
-- Preparation ONLY: no live intake, email sending, CRM mutation or automatic
-- decisions on refunds, porting, contractual obligations or third-party funds.
CREATE TABLE IF NOT EXISTS direct_sva_complaint_cases (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 public_reference text NOT NULL UNIQUE
  CHECK(public_reference ~ '^DSVA-RCL-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$'),
 receipt_id uuid NOT NULL UNIQUE,
 source text NOT NULL CHECK(source IN ('public_web','verified_provider_email')),
 customer_tenant_id bigint REFERENCES tenants(id),
 email text NOT NULL CHECK (length(email) BETWEEN 5 AND 320),
 email_sha256 char(64) NOT NULL CHECK(email_sha256 ~ '^[0-9a-f]{64}$'),
 category text NOT NULL CHECK(category IN ('billing','payout','number','call','fraud','privacy','other')),
 priority text NOT NULL CHECK(priority IN ('normal','high')),
 subject text NOT NULL CHECK(length(subject) BETWEEN 5 AND 180),
 customer_message text NOT NULL CHECK(length(customer_message) BETWEEN 15 AND 8000),
 customer_identity_verified boolean NOT NULL DEFAULT false CHECK(customer_identity_verified=false),
 status text NOT NULL DEFAULT 'prepared' CHECK(status='prepared'),
 external_processing_authorized boolean NOT NULL DEFAULT false CHECK(external_processing_authorized=false),
 crm_ticket_authorized boolean NOT NULL DEFAULT false CHECK(crm_ticket_authorized=false),
 compensation_authorized boolean NOT NULL DEFAULT false CHECK(compensation_authorized=false),
 number_change_authorized boolean NOT NULL DEFAULT false CHECK(number_change_authorized=false),
 first_response_target_at timestamptz NOT NULL,
 resolution_review_target_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(first_response_target_at>=created_at-interval '5 minutes'),
 CHECK(resolution_review_target_at>first_response_target_at)
);
CREATE INDEX IF NOT EXISTS dsva_complaint_created_idx
 ON direct_sva_complaint_cases(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS dsva_complaint_category_idx
 ON direct_sva_complaint_cases(category,priority,created_at DESC);

CREATE TABLE IF NOT EXISTS direct_sva_complaint_delivery_queue (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 complaint_id bigint NOT NULL REFERENCES direct_sva_complaint_cases(id),
 delivery_kind text NOT NULL CHECK(delivery_kind IN ('internal_gmail','customer_receipt','hubspot_ticket','safe_reply_draft')),
 idempotency_key text NOT NULL UNIQUE CHECK(length(idempotency_key) BETWEEN 12 AND 180),
 delivery_state text NOT NULL DEFAULT 'blocked_release' CHECK(delivery_state='blocked_release'),
 external_execution_allowed boolean NOT NULL DEFAULT false CHECK(external_execution_allowed=false),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts=0),
 provider_reference text,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(complaint_id,delivery_kind),
 CHECK(provider_reference IS NULL)
);

CREATE TABLE IF NOT EXISTS direct_sva_complaint_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 complaint_id bigint NOT NULL REFERENCES direct_sva_complaint_cases(id),
 event_kind text NOT NULL CHECK(event_kind IN ('registered_preparation','classified_preparation')),
 audit_detail text NOT NULL CHECK(length(audit_detail) BETWEEN 6 AND 200),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION direct_sva_guard_complaint_audit_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'direct SVA complaint audit is immutable';
END;
$$;
CREATE TRIGGER direct_sva_complaint_audit_append_only
 BEFORE UPDATE OR DELETE ON direct_sva_complaint_audit
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_complaint_audit_immutable();
