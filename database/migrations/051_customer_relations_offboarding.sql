BEGIN;

-- Audiotel Premium Pro — customer relations, billing disputes and offboarding.
-- Expand-only. ChatGPT/agent automation may prepare and execute reversible steps,
-- but money movement, permanent number release and final termination remain gated.

CREATE TABLE tenant_relation_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  case_kind text NOT NULL
    CHECK (case_kind IN ('billing_dispute','payout_dispute','service_complaint','contract_termination','port_out','data_request','other')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','triage','investigating','waiting_customer','waiting_provider','proposed','approved','executing','resolved','closed','cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','critical')),
  source text NOT NULL DEFAULT 'customer'
    CHECK (source IN ('customer','staff','system','agent')),
  customer_capacity text NOT NULL DEFAULT 'unknown'
    CHECK (customer_capacity IN ('business','consumer','unknown')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 180),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 8000),
  assigned_team text NOT NULL DEFAULT 'Customer Relations',
  created_by_customer_principal_id uuid REFERENCES customer_principals(id),
  created_by_user_id bigint REFERENCES app_users(id),
  disputed_amount numeric(18,6) CHECK (disputed_amount IS NULL OR disputed_amount>=0),
  disputed_currency char(3) CHECK (disputed_currency IS NULL OR disputed_currency ~ '^[A-Z]{3}$'),
  invoice_reference text,
  payment_reference text,
  disputed_period_start date,
  disputed_period_end date,
  requested_resolution text,
  formal_complaint_at timestamptz,
  mediation_eligible_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  ai_state text NOT NULL DEFAULT 'queued'
    CHECK (ai_state IN ('queued','analyzing','ready','action_required','blocked','done')),
  ai_confidence numeric(5,4) CHECK (ai_confidence IS NULL OR (ai_confidence>=0 AND ai_confidence<=1)),
  ai_policy_version text NOT NULL DEFAULT 'customer-relations/1',
  first_response_due_at timestamptz NOT NULL DEFAULT (now()+interval '1 business day'),
  target_resolution_at timestamptz NOT NULL DEFAULT (now()+interval '10 days'),
  first_responded_at timestamptz,
  last_customer_update_at timestamptz,
  last_pgi_update_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  resolution_code text,
  resolution_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (disputed_period_end IS NULL OR disputed_period_start IS NULL OR disputed_period_end>=disputed_period_start),
  CHECK (target_resolution_at>=first_response_due_at)
);

CREATE INDEX tenant_relation_cases_tenant_status_idx
  ON tenant_relation_cases(tenant_id,status,updated_at DESC,id DESC);
CREATE INDEX tenant_relation_cases_queue_idx
  ON tenant_relation_cases(priority DESC,target_resolution_at,id)
  WHERE status NOT IN ('resolved','closed','cancelled');
CREATE INDEX tenant_relation_cases_invoice_idx
  ON tenant_relation_cases(tenant_id,invoice_reference)
  WHERE invoice_reference IS NOT NULL;

CREATE TRIGGER tenant_relation_cases_touch_updated
BEFORE UPDATE ON tenant_relation_cases
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE tenant_relation_case_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES tenant_relation_cases(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  event_type text NOT NULL
    CHECK (event_type IN (
      'created','customer_message','staff_message','agent_analysis','evidence_linked',
      'hold_placed','hold_released','decision_proposed','decision_approved','decision_rejected',
      'status_changed','mediation_ready','exit_prepared','port_out_submitted','port_out_scheduled',
      'port_out_completed','final_invoice_ready','data_export_ready','access_revoked',
      'resolved','closed','cancelled'
    )),
  actor_type text NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('customer','staff','system','agent')),
  actor_user_id bigint REFERENCES app_users(id),
  actor_customer_principal_id uuid REFERENCES customer_principals(id),
  message text CHECK (message IS NULL OR char_length(message)<=8000),
  customer_visible boolean NOT NULL DEFAULT true,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_relation_case_events_case_time_idx
  ON tenant_relation_case_events(case_id,occurred_at,id);
CREATE INDEX tenant_relation_case_events_tenant_time_idx
  ON tenant_relation_case_events(tenant_id,occurred_at DESC,id DESC);

CREATE TABLE tenant_relation_evidence (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES tenant_relation_cases(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  evidence_kind text NOT NULL
    CHECK (evidence_kind IN ('invoice','payment','cdr','settlement','contract','communication','portability','identity','export','other')),
  source_table text,
  source_id text,
  external_reference text,
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[a-f0-9]{64}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_relation_evidence_case_idx
  ON tenant_relation_evidence(case_id,created_at,id);

CREATE TABLE tenant_dispute_collection_holds (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id bigint NOT NULL REFERENCES tenant_relation_cases(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  amount numeric(18,6) NOT NULL CHECK (amount>=0),
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  scope text NOT NULL DEFAULT 'disputed_amount_only'
    CHECK (scope IN ('disputed_amount_only','specific_invoice')),
  invoice_reference text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','applied','expired')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 1000),
  created_by_type text NOT NULL DEFAULT 'agent'
    CHECK (created_by_type IN ('agent','staff','system')),
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_dispute_collection_holds_active_case_idx
  ON tenant_dispute_collection_holds(case_id)
  WHERE status='active';

CREATE TABLE tenant_exit_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  case_id bigint NOT NULL UNIQUE REFERENCES tenant_relation_cases(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  exit_scope text NOT NULL DEFAULT 'all_services'
    CHECK (exit_scope IN ('all_services','selected_lines')),
  reason_category text NOT NULL DEFAULT 'unspecified'
    CHECK (reason_category IN ('price','service','quality','competition','business_closed','other','unspecified')),
  requested_effective_date date,
  number_retention_preference text NOT NULL DEFAULT 'undecided'
    CHECK (number_retention_preference IN ('port_out','release','undecided')),
  port_out_requested boolean NOT NULL DEFAULT false,
  target_operator_name text,
  operator_reference text,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','preparing','waiting_customer','waiting_provider','scheduled','finalizing','completed','cancelled','blocked')),
  final_invoice_status text NOT NULL DEFAULT 'pending'
    CHECK (final_invoice_status IN ('pending','ready','disputed','settled','not_applicable')),
  final_settlement_status text NOT NULL DEFAULT 'pending'
    CHECK (final_settlement_status IN ('pending','ready','disputed','settled','not_applicable')),
  data_export_status text NOT NULL DEFAULT 'not_requested'
    CHECK (data_export_status IN ('not_requested','requested','preparing','ready','delivered')),
  contract_obligations_acknowledged boolean NOT NULL DEFAULT false,
  customer_confirmed boolean NOT NULL DEFAULT false,
  scheduled_at timestamptz,
  access_revocation_at timestamptz,
  number_quarantine_until date,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_exit_requests_tenant_status_idx
  ON tenant_exit_requests(tenant_id,status,created_at DESC,id DESC);

CREATE TRIGGER tenant_exit_requests_touch_updated
BEFORE UPDATE ON tenant_exit_requests
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE tenant_exit_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exit_request_id bigint NOT NULL REFERENCES tenant_exit_requests(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  assignment_id bigint NOT NULL REFERENCES tenant_number_assignments(id),
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  e164_snapshot text NOT NULL CHECK (e164_snapshot ~ '^\+[1-9][0-9]{7,14}$'),
  requested_action text NOT NULL
    CHECK (requested_action IN ('port_out','release','keep_until_exit')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','eligibility_check','waiting_provider','scheduled','completed','cancelled','blocked')),
  operator_reference text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(exit_request_id,assignment_id)
);

CREATE TABLE tenant_relation_actions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  case_id bigint NOT NULL REFERENCES tenant_relation_cases(id) ON DELETE CASCADE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  action_type text NOT NULL
    CHECK (action_type IN (
      'collect_evidence','reconcile_billing','draft_response','request_customer_info',
      'place_dispute_hold','release_dispute_hold','propose_credit','issue_credit',
      'propose_refund','issue_refund','prepare_exit','check_portability','submit_port_out',
      'schedule_exit','generate_data_export','cancel_subscription','release_number',
      'revoke_access','resolve_case','close_case'
    )),
  risk_class text NOT NULL
    CHECK (risk_class IN ('low','medium','high','irreversible')),
  execution_mode text NOT NULL
    CHECK (execution_mode IN ('automatic','approval_required','customer_confirmation','external_confirmation')),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','approved','rejected','queued','executing','completed','failed','cancelled')),
  proposed_by text NOT NULL DEFAULT 'agent'
    CHECK (proposed_by IN ('agent','staff','system')),
  proposed_by_user_id bigint REFERENCES app_users(id),
  approved_by_user_id bigint REFERENCES app_users(id),
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence>=0 AND confidence<=1)),
  explanation text CHECK (explanation IS NULL OR char_length(explanation)<=4000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_relation_actions_case_idx
  ON tenant_relation_actions(case_id,created_at DESC,id DESC);
CREATE INDEX tenant_relation_actions_pending_idx
  ON tenant_relation_actions(status,risk_class,created_at,id)
  WHERE status IN ('proposed','approved','queued','executing');

CREATE VIEW tenant_scoped_relation_cases
WITH (security_barrier=true)
AS
SELECT
  id,public_id,tenant_id,case_kind,status,priority,source,customer_capacity,title,description,
  disputed_amount,disputed_currency,invoice_reference,payment_reference,disputed_period_start,disputed_period_end,
  requested_resolution,formal_complaint_at,mediation_eligible_at,legal_hold,ai_state,ai_confidence,ai_policy_version,
  first_response_due_at,target_resolution_at,first_responded_at,last_customer_update_at,last_pgi_update_at,
  resolved_at,closed_at,resolution_code,resolution_summary,created_at,updated_at
FROM tenant_relation_cases
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_exit_requests
WITH (security_barrier=true)
AS
SELECT
  id,public_id,case_id,tenant_id,exit_scope,reason_category,requested_effective_date,
  number_retention_preference,port_out_requested,target_operator_name,operator_reference,status,
  final_invoice_status,final_settlement_status,data_export_status,contract_obligations_acknowledged,
  customer_confirmed,scheduled_at,access_revocation_at,number_quarantine_until,completed_at,created_at,updated_at
FROM tenant_exit_requests
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_relation_case_events
WITH (security_barrier=true)
AS
SELECT id,case_id,tenant_id,event_type,actor_type,message,customer_visible,details,occurred_at
FROM tenant_relation_case_events
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE tenant_relation_cases IS
'Customer complaint/dispute/termination dossier. Source financial and telecom facts remain authoritative in their original tables.';
COMMENT ON TABLE tenant_relation_actions IS
'Agent-oriented action queue. Irreversible or money-moving actions are never auto-approved by this table.';
COMMENT ON TABLE tenant_dispute_collection_holds IS
'Internal collection hold limited to the disputed scope. It does not alter an invoice or create a refund.';
COMMENT ON TABLE tenant_exit_requests IS
'Customer offboarding orchestration. Port-out completion and final termination require external/provider confirmation where applicable.';
COMMENT ON TABLE tenant_relation_evidence IS
'References and hashes only; raw card data, secrets, RIO and unnecessary personal data must not be stored here.';

COMMIT;
