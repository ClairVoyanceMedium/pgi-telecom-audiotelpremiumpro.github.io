CREATE TABLE business_live_reset_schedules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_key text NOT NULL UNIQUE,
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  frequency text NOT NULL CHECK (frequency IN ('daily','weekly','monthly','interval_days')),
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  local_time time NOT NULL DEFAULT '09:00',
  weekday smallint CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  month_day smallint CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 31),
  interval_days integer CHECK (interval_days IS NULL OR interval_days BETWEEN 1 AND 3650),
  anchor_date date,
  next_run_at timestamptz,
  last_run_at timestamptz,
  run_count bigint NOT NULL DEFAULT 0 CHECK (run_count >= 0),
  last_error text,
  configured_by_staff_id bigint REFERENCES app_users(id),
  configured_by_customer_principal_id uuid REFERENCES customer_principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope='platform' AND tenant_id IS NULL AND schedule_key='platform')
    OR
    (scope='tenant' AND tenant_id IS NOT NULL)
  ),
  CHECK (
    (frequency='daily' AND weekday IS NULL AND month_day IS NULL AND interval_days IS NULL AND anchor_date IS NULL)
    OR
    (frequency='weekly' AND weekday IS NOT NULL AND month_day IS NULL AND interval_days IS NULL AND anchor_date IS NULL)
    OR
    (frequency='monthly' AND weekday IS NULL AND month_day IS NOT NULL AND interval_days IS NULL AND anchor_date IS NULL)
    OR
    (frequency='interval_days' AND weekday IS NULL AND month_day IS NULL AND interval_days IS NOT NULL AND anchor_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX business_live_reset_schedules_tenant_unique
  ON business_live_reset_schedules(tenant_id)
  WHERE scope='tenant';

CREATE INDEX business_live_reset_schedules_due_idx
  ON business_live_reset_schedules(next_run_at,id)
  WHERE enabled=true AND next_run_at IS NOT NULL;

CREATE TABLE business_live_reset_schedule_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  schedule_id bigint NOT NULL REFERENCES business_live_reset_schedules(id) ON DELETE CASCADE,
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  executed_at timestamptz NOT NULL DEFAULT now(),
  reset_reference text NOT NULL,
  UNIQUE(schedule_id,scheduled_for)
);

CREATE INDEX business_live_reset_schedule_runs_lookup_idx
  ON business_live_reset_schedule_runs(schedule_id,executed_at DESC);
