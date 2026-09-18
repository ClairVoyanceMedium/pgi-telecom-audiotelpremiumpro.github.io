-- PGI Telecom — resilient distributed work queue and dead-letter audit.

ALTER TABLE work_queue
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN trace_id text,
  ADD COLUMN dead_lettered_at timestamptz;

CREATE INDEX work_queue_lease_recovery_idx
  ON work_queue(queue_name,lease_expires_at,id)
  WHERE completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL;

CREATE INDEX work_queue_ready_idx
  ON work_queue(queue_name,priority,available_at,id)
  WHERE completed_at IS NULL AND failed_at IS NULL AND dead_lettered_at IS NULL;

CREATE TABLE work_queue_dead_letters (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_id bigint NOT NULL,
  queue_name text NOT NULL,
  tenant_id bigint REFERENCES tenants(id),
  correlation_id uuid NOT NULL,
  trace_id text,
  payload jsonb NOT NULL,
  attempts integer NOT NULL,
  last_error text,
  dead_lettered_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX work_queue_dead_letters_work_unique
  ON work_queue_dead_letters(work_id);
CREATE INDEX work_queue_dead_letters_queue_time_idx
  ON work_queue_dead_letters(queue_name,dead_lettered_at DESC,id DESC);
CREATE INDEX work_queue_dead_letters_tenant_time_idx
  ON work_queue_dead_letters(tenant_id,dead_lettered_at DESC,id DESC)
  WHERE tenant_id IS NOT NULL;
