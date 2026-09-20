-- Audiotel Premium Pro — proactive regulatory review monitoring.
-- Expand-only. Creates durable attention records without auto-suspending active lines
-- or rewriting regulatory evidence/status history.

CREATE TABLE regulatory_review_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_key text NOT NULL UNIQUE,
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  assignment_id bigint REFERENCES tenant_number_assignments(id) ON DELETE CASCADE,
  sva_number_id bigint REFERENCES sva_numbers(id) ON DELETE CASCADE,
  platform_control_id bigint REFERENCES platform_regulatory_controls(id) ON DELETE CASCADE,
  framework text NOT NULL
    CHECK (framework IN ('regulatory_trust','arcep_2026','platform')),
  alert_kind text NOT NULL
    CHECK (alert_kind IN ('review_schedule_missing','review_due_soon','review_due_today','review_overdue','control_blocking','control_expiring')),
  severity text NOT NULL
    CHECK (severity IN ('info','warning','critical')),
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open','acknowledged','resolved')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 180),
  message text NOT NULL CHECK (char_length(message) BETWEEN 3 AND 1000),
  due_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by bigint REFERENCES app_users(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (framework='platform' AND platform_control_id IS NOT NULL)
    OR
    (framework IN ('regulatory_trust','arcep_2026') AND tenant_id IS NOT NULL AND assignment_id IS NOT NULL AND sva_number_id IS NOT NULL)
  )
);

CREATE INDEX regulatory_review_alerts_state_due_idx
  ON regulatory_review_alerts(state,severity,due_at,id)
  WHERE state<>'resolved';

CREATE INDEX regulatory_review_alerts_assignment_idx
  ON regulatory_review_alerts(assignment_id,state,id DESC)
  WHERE assignment_id IS NOT NULL;

CREATE INDEX regulatory_review_alerts_tenant_idx
  ON regulatory_review_alerts(tenant_id,state,id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX regulatory_review_alerts_platform_idx
  ON regulatory_review_alerts(platform_control_id,state,id DESC)
  WHERE platform_control_id IS NOT NULL;

COMMENT ON TABLE regulatory_review_alerts IS
'Persistent admin attention queue for upcoming/overdue SVA regulatory reviews and expiring/blocking platform controls. It does not itself suspend service or certify compliance.';

COMMENT ON COLUMN regulatory_review_alerts.alert_kind IS
'Operational urgency bucket: missing schedule, soon (<=30d), today (<=24h), overdue, blocking status, or expiring platform evidence.';

COMMENT ON COLUMN regulatory_review_alerts.details IS
'Privacy-minimised diagnostics only. Must not contain raw RIO, caller identity, call content, payment-card data or credentials.';
