-- 063_business_live_reset_schedules.sql
-- Expand-only. Scheduled Business Live resets never alter CDRs, settlements,
-- revenue distributions or official dashboard metrics.

CREATE TABLE business_live_reset_schedules (
  schedule_key text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('platform','tenant')),
  tenant_id bigint REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  interval_unit text NOT NULL DEFAULT 'day' CHECK (interval_unit IN ('day','week','month')),
  interval_value integer NOT NULL DEFAULT 1 CHECK (interval_value BETWEEN 1 AND 3650),
  timezone text NOT NULL DEFAULT 'Europe/Paris',
  anchor_at timestamptz,
  next_occurrence bigint,
  next_run_at timestamptz,
  last_run_at timestamptz,
  lease_until timestamptz,
  last_error text,
  updated_by_user_id bigint REFERENCES app_users(id),
  updated_by_customer_principal_id uuid REFERENCES customer_principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (scope='platform' AND tenant_id IS NULL AND schedule_key='platform')
    OR
    (scope='tenant' AND tenant_id IS NOT NULL AND schedule_key=('tenant:'||tenant_id::text))
  ),
  CHECK (enabled=false OR anchor_at IS NOT NULL)
);

CREATE INDEX business_live_reset_schedules_due_idx
  ON business_live_reset_schedules(next_run_at,schedule_key)
  WHERE enabled=true;

COMMENT ON TABLE business_live_reset_schedules IS
'User-configurable Business Live reset schedules. They control display baselines only and never delete or rewrite accounting, CDR, settlement, payout or official dashboard data.';

CREATE FUNCTION pgi_business_live_next_run(
  p_anchor_at timestamptz,
  p_timezone text,
  p_interval_unit text,
  p_interval_value integer,
  p_after timestamptz
)
RETURNS TABLE(occurrence bigint,run_at timestamptz)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  i bigint := 0;
  local_anchor timestamp without time zone;
  local_target timestamp without time zone;
  candidate timestamptz;
BEGIN
  IF p_anchor_at IS NULL THEN
    RAISE EXCEPTION 'business live schedule anchor is required';
  END IF;
  IF p_interval_unit NOT IN ('day','week','month') THEN
    RAISE EXCEPTION 'invalid business live schedule interval unit';
  END IF;
  IF p_interval_value IS NULL OR p_interval_value < 1 OR p_interval_value > 3650 THEN
    RAISE EXCEPTION 'invalid business live schedule interval value';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
    RAISE EXCEPTION 'invalid business live schedule timezone';
  END IF;

  local_anchor := p_anchor_at AT TIME ZONE p_timezone;

  LOOP
    IF p_interval_unit='day' THEN
      local_target := local_anchor + make_interval(days=>(p_interval_value*i)::integer);
    ELSIF p_interval_unit='week' THEN
      local_target := local_anchor + make_interval(days=>(p_interval_value*7*i)::integer);
    ELSE
      -- Always calculate from the original anchor so a schedule anchored on the
      -- 29th/30th/31st returns to that calendar day whenever the month has it.
      local_target := local_anchor + make_interval(months=>(p_interval_value*i)::integer);
    END IF;

    candidate := local_target AT TIME ZONE p_timezone;
    IF candidate > p_after THEN
      occurrence := i;
      run_at := candidate;
      RETURN NEXT;
      RETURN;
    END IF;

    i := i + 1;
    IF i > 100000 THEN
      RAISE EXCEPTION 'business live schedule search limit exceeded';
    END IF;
  END LOOP;
END;
$$;
