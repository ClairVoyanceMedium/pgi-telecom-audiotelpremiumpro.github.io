-- Preserve existing Audiotel customers and number identities during a future
-- change of upstream hosting/distribution. PREPARATION ONLY, no porting or routing.
-- Additive, with no UPDATE to tenants, assignments, customer subscriptions or calls.

CREATE TABLE IF NOT EXISTS direct_sva_existing_customer_transition_plans (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id bigint NOT NULL REFERENCES tenants(id),
 assignment_id bigint NOT NULL UNIQUE REFERENCES tenant_number_assignments(id),
 sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
 e164_snapshot text NOT NULL CHECK (e164_snapshot ~ '^\+[1-9][0-9]{7,14}$'),
 source_host_carrier_id bigint NOT NULL REFERENCES carriers(id),
 target_mode text NOT NULL CHECK(target_mode IN ('partner','direct_sva')),
 target_host_carrier_id bigint REFERENCES carriers(id),
 planned_cutover_at timestamptz,
 state text NOT NULL DEFAULT 'prepared' CHECK(state='prepared'),
 customer_account_preserved boolean NOT NULL DEFAULT true CHECK(customer_account_preserved=true),
 number_identity_preserved boolean NOT NULL DEFAULT true CHECK(number_identity_preserved=true),
 existing_contract_unchanged_by_preparation boolean NOT NULL DEFAULT true
   CHECK(existing_contract_unchanged_by_preparation=true),
 routing_authorized boolean NOT NULL DEFAULT false CHECK(routing_authorized=false),
 portability_authorized boolean NOT NULL DEFAULT false CHECK(portability_authorized=false),
 money_transfer_authorized boolean NOT NULL DEFAULT false CHECK(money_transfer_authorized=false),
 client_terms_review_status text NOT NULL DEFAULT 'pending' CHECK(client_terms_review_status='pending'),
 notice_review_status text NOT NULL DEFAULT 'pending' CHECK(notice_review_status='pending'),
 cdr_cutover_reconciled boolean NOT NULL DEFAULT false CHECK(cdr_cutover_reconciled=false),
 actor_hash char(64) NOT NULL CHECK (actor_hash ~ '^[0-9a-f]{64}$'),
 evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 8 AND 240),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((target_mode='direct_sva' AND target_host_carrier_id IS NULL) OR
        (target_mode='partner' AND target_host_carrier_id IS NOT NULL AND
         target_host_carrier_id<>source_host_carrier_id))
);
CREATE INDEX IF NOT EXISTS direct_sva_transition_tenant_idx
 ON direct_sva_existing_customer_transition_plans(tenant_id,id DESC);
CREATE INDEX IF NOT EXISTS direct_sva_transition_source_idx
 ON direct_sva_existing_customer_transition_plans(source_host_carrier_id,id DESC);

CREATE TABLE IF NOT EXISTS direct_sva_existing_customer_transition_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 plan_id bigint NOT NULL REFERENCES direct_sva_existing_customer_transition_plans(id),
 event_type text NOT NULL CHECK(event_type='prepared'),
 actor_hash char(64) NOT NULL CHECK (actor_hash ~ '^[0-9a-f]{64}$'),
 evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 8 AND 240),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION direct_sva_guard_customer_transition_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'direct SVA preparatory transition records are immutable';
END;
$$;
CREATE TRIGGER direct_sva_transition_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_existing_customer_transition_plans
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_customer_transition_immutable();
CREATE TRIGGER direct_sva_transition_audit_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_existing_customer_transition_audit
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_customer_transition_immutable();
