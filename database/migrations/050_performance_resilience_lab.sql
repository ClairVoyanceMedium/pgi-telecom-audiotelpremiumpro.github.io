BEGIN;

CREATE TABLE performance_lab_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_type text NOT NULL CHECK (run_type IN ('load','stress','spike','soak','synthetic','chaos','restore')),
  scenario text NOT NULL CHECK (char_length(scenario) BETWEEN 2 AND 120),
  target text,
  status text NOT NULL CHECK (status IN ('passed','failed','aborted','informational')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  requests_total bigint NOT NULL DEFAULT 0 CHECK (requests_total>=0),
  errors_total bigint NOT NULL DEFAULT 0 CHECK (errors_total>=0),
  error_rate numeric(12,8) NOT NULL DEFAULT 0 CHECK (error_rate>=0 AND error_rate<=1),
  p50_ms numeric(14,3),
  p95_ms numeric(14,3),
  p99_ms numeric(14,3),
  requests_per_second numeric(14,3),
  virtual_users integer,
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ref text,
  created_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_at>=started_at)
);

CREATE INDEX performance_lab_runs_time_idx
  ON performance_lab_runs(completed_at DESC,id DESC);
CREATE INDEX performance_lab_runs_type_time_idx
  ON performance_lab_runs(run_type,completed_at DESC,id DESC);

CREATE TABLE synthetic_probe_results (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  probe_key text NOT NULL CHECK (probe_key ~ '^[a-z0-9_.-]{2,80}$'),
  checked_at timestamptz NOT NULL DEFAULT now(),
  success boolean NOT NULL,
  latency_ms numeric(14,3) NOT NULL CHECK (latency_ms>=0),
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  release_id text,
  error_code text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX synthetic_probe_results_key_time_idx
  ON synthetic_probe_results(probe_key,checked_at DESC,id DESC);
CREATE INDEX synthetic_probe_results_failures_idx
  ON synthetic_probe_results(checked_at DESC,id DESC)
  WHERE NOT success;

COMMENT ON TABLE performance_lab_runs IS
'Measured preproduction and production load/resilience evidence. Rows are observations, never capacity guarantees.';
COMMENT ON TABLE synthetic_probe_results IS
'Sanitized synthetic availability and latency observations without customer payloads or credentials.';

COMMIT;
