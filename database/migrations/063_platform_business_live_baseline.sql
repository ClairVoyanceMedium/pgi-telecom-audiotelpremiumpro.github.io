-- PGI Telecom — Business Live cockpit baseline.
-- Expand-only and non-destructive: this reset affects only the Business Live display.
-- Official analytics, CDRs, settlements, revenue distributions and reports are untouched.

BEGIN;

CREATE TABLE platform_jackpot_baselines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  effective_from timestamptz NOT NULL DEFAULT now(),
  reason text,
  created_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX platform_jackpot_baselines_time_idx
  ON platform_jackpot_baselines(effective_from DESC,id DESC);

INSERT INTO platform_jackpot_baselines(reason,effective_from)
VALUES('Activation du Business Live plateforme',now());

COMMENT ON TABLE platform_jackpot_baselines IS
'Business Live cockpit reset epochs only. These rows never delete, hide or alter CDRs, official analytics, settlements, revenue distributions or customer reporting.';

COMMIT;
