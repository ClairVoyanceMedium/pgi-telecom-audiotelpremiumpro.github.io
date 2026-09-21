BEGIN;

CREATE TABLE tenant_consumption_receipts (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  customer_principal_id bigint REFERENCES customer_principals(id),
  requested_from timestamptz NOT NULL,
  requested_to timestamptz NOT NULL,
  tenant_timezone text NOT NULL,
  metrics jsonb NOT NULL CHECK (jsonb_typeof(metrics)='object'),
  metric_ranges jsonb NOT NULL CHECK (jsonb_typeof(metric_ranges)='object'),
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[a-f0-9]{64}$'),
  source_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (requested_to >= requested_from)
);

CREATE INDEX tenant_consumption_receipts_tenant_created_idx
  ON tenant_consumption_receipts(tenant_id,created_at DESC,id DESC);

CREATE INDEX tenant_consumption_receipts_principal_created_idx
  ON tenant_consumption_receipts(customer_principal_id,created_at DESC,id DESC)
  WHERE customer_principal_id IS NOT NULL;

CREATE VIEW tenant_scoped_consumption_receipts
WITH (security_barrier=true)
AS
SELECT
  id,public_id,tenant_id,customer_principal_id,requested_from,requested_to,tenant_timezone,
  metrics,metric_ranges,snapshot_sha256,source_updated_at,created_at
FROM tenant_consumption_receipts
WHERE tenant_id=pgi_require_tenant_context();

CREATE FUNCTION pgi_consumption_receipt_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tenant consumption receipts are immutable';
END;
$$;

CREATE TRIGGER tenant_consumption_receipts_immutable
BEFORE UPDATE ON tenant_consumption_receipts
FOR EACH ROW EXECUTE FUNCTION pgi_consumption_receipt_immutable();

COMMENT ON TABLE tenant_consumption_receipts IS
'Immutable customer dashboard consumption receipts. Stores aggregate evidence only; never raw caller identity, credentials or full CDR payloads.';

COMMENT ON COLUMN tenant_consumption_receipts.snapshot_sha256 IS
'SHA-256 of the normalized dashboard snapshot, metric baselines and exact requested period used for support reconciliation.';

COMMIT;
