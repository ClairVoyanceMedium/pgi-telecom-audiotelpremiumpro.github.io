-- PGI Telecom — external customer control center and unpaid subscription alerts.
-- Additive only. Internal PGI tenant is never subject to these external-customer controls.

CREATE INDEX tenants_directory_country_status_cursor_idx
  ON tenants(country_code,status,id DESC)
  WHERE tenant_type<>'internal';

CREATE INDEX tenant_subscriptions_due_idx
  ON tenant_subscriptions(current_period_end,tenant_id,id)
  WHERE status IN ('active','past_due','suspended');

CREATE INDEX sva_numbers_e164_prefix_idx
  ON sva_numbers(e164 text_pattern_ops,id DESC);

CREATE TABLE tenant_admin_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_key text NOT NULL UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  subscription_id bigint REFERENCES tenant_subscriptions(id),
  alert_type text NOT NULL
    CHECK (alert_type IN ('subscription_unpaid')),
  severity text NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info','warning','critical')),
  state text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open','acknowledged','resolved')),
  title text NOT NULL,
  message text NOT NULL,
  due_at timestamptz,
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by bigint REFERENCES app_users(id),
  resolved_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_admin_alerts_state_time_idx
  ON tenant_admin_alerts(state,last_detected_at DESC,id DESC);
CREATE INDEX tenant_admin_alerts_tenant_state_idx
  ON tenant_admin_alerts(tenant_id,state,last_detected_at DESC);
CREATE INDEX tenant_admin_alerts_due_brin
  ON tenant_admin_alerts USING brin(due_at);

CREATE TABLE tenant_control_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  assignment_id bigint REFERENCES tenant_number_assignments(id),
  actor_user_id bigint REFERENCES app_users(id),
  action text NOT NULL
    CHECK (action IN ('tenant.suspend','tenant.activate','assignment.suspend','assignment.activate','alert.acknowledge')),
  previous_status text,
  new_status text,
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX tenant_control_events_tenant_time_idx
  ON tenant_control_events(tenant_id,occurred_at DESC,id DESC);
CREATE INDEX tenant_control_events_assignment_time_idx
  ON tenant_control_events(assignment_id,occurred_at DESC,id DESC)
  WHERE assignment_id IS NOT NULL;
