-- Direct SVA workflow rehearsal, separate from Audiotel.
-- A simulation is never a carrier call, CRM write, GA4 emission or payment.
-- No legal status is needed to TEST a workflow with fictional non-personal facts.
CREATE TABLE IF NOT EXISTS direct_sva_automation_rehearsals (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_unit text NOT NULL DEFAULT 'direct_sva' CHECK (business_unit='direct_sva'),
 workflow_key text NOT NULL CHECK (workflow_key IN (
  'lead_routing','compliance_check','contract_review','number_assignment','portability',
  'cdr_ingestion','settlement_reconciliation','accounting_draft','invoice_review',
  'publisher_payout','hubspot_sync','analytics_delivery','support_followup')),
 source_reference text NOT NULL CHECK (source_reference ~ '^DSVA-SIM-[A-Za-z0-9-]{8,80}$'),
 idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9:_-]{16,128}$'),
 input_digest char(64) NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
 result_status text NOT NULL CHECK (result_status IN (
  'ready_for_simulation','missing_inputs','retry_planned','manual_review')),
 attempt_number smallint NOT NULL CHECK (attempt_number BETWEEN 1 AND 5),
 failure_mode text NOT NULL CHECK (failure_mode IN ('none','timeout','rate_limit','validation_error')),
 missing_checks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(missing_checks)='array'),
 checked_count smallint NOT NULL CHECK (checked_count BETWEEN 0 AND 50),
 next_simulation_at timestamptz,
 safe_plan jsonb NOT NULL CHECK (jsonb_typeof(safe_plan)='object'),
 actor_hash char(64) NOT NULL CHECK (actor_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (result_status='retry_planned' OR next_simulation_at IS NULL),
 CHECK ((result_status='retry_planned') = (next_simulation_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS direct_sva_rehearsals_overview_idx
 ON direct_sva_automation_rehearsals(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS direct_sva_rehearsals_workflow_idx
 ON direct_sva_automation_rehearsals(workflow_key,result_status,created_at DESC);
CREATE FUNCTION direct_sva_guard_rehearsal_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Direct SVA rehearsals are immutable. Record a new simulation.';
END;
$$;
CREATE TRIGGER direct_sva_guard_rehearsal_immutable
 BEFORE UPDATE OR DELETE ON direct_sva_automation_rehearsals
 FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_rehearsal_immutable();
