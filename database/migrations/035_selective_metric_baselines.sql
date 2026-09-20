-- Audiotel Premium Pro — selective, tenant-scoped metric reset epochs.
-- Non-destructive: CDRs, settlements and audit history remain immutable/readable.

ALTER TABLE metric_baselines
  ADD COLUMN IF NOT EXISTS metric_key text NOT NULL DEFAULT 'all';

ALTER TABLE metric_baselines
  ADD COLUMN IF NOT EXISTS created_by_customer_principal_id uuid REFERENCES customer_principals(id);

ALTER TABLE metric_baselines
  DROP CONSTRAINT IF EXISTS metric_baselines_scope_check;
ALTER TABLE metric_baselines
  ADD CONSTRAINT metric_baselines_scope_check
  CHECK (scope IN ('global','tenant','expert','sva_number'));

ALTER TABLE metric_baselines
  DROP CONSTRAINT IF EXISTS metric_baselines_metric_key_check;
ALTER TABLE metric_baselines
  ADD CONSTRAINT metric_baselines_metric_key_check
  CHECK (metric_key IN ('all','calls','minutes','revenue','payout','quality'));

ALTER TABLE metric_baselines
  DROP CONSTRAINT IF EXISTS metric_baselines_tenant_scope_check;
ALTER TABLE metric_baselines
  ADD CONSTRAINT metric_baselines_tenant_scope_check
  CHECK (scope <> 'tenant' OR tenant_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS metric_baselines_selective_idx
  ON metric_baselines(scope,tenant_id,metric_key,effective_from DESC,id DESC);

COMMENT ON COLUMN metric_baselines.metric_key IS
'Independent visible-statistics epoch: all, calls, minutes, revenue, payout or quality. Raw CDR/accounting history is never deleted.';

COMMENT ON COLUMN metric_baselines.created_by_customer_principal_id IS
'Customer principal that reset its own tenant-visible statistics; staff resets continue to use created_by.';
