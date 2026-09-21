BEGIN;

CREATE TABLE customer_experience_preferences (
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_principal_id uuid NOT NULL REFERENCES customer_principals(id) ON DELETE CASCADE,
  alert_preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(alert_preferences)='object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,customer_principal_id)
);

CREATE INDEX customer_experience_preferences_principal_idx
  ON customer_experience_preferences(customer_principal_id,updated_at DESC);

CREATE VIEW tenant_scoped_customer_experience_preferences
WITH (security_barrier=true)
AS
SELECT tenant_id,customer_principal_id,alert_preferences,updated_at
FROM customer_experience_preferences
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE customer_experience_preferences IS
'Per-user customer command-center preferences. Stores aggregate alert thresholds only; no caller identity or external notification credentials.';

COMMIT;
