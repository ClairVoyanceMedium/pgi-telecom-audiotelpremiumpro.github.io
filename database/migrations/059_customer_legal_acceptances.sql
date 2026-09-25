-- Audiotel Premium Pro — immutable customer legal acceptance evidence.
-- Append-only records for account terms and paid-subscription acceptance.

CREATE TABLE customer_legal_acceptances (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_principal_id uuid NOT NULL REFERENCES customer_principals(id) ON DELETE CASCADE,
  acceptance_type text NOT NULL CHECK (acceptance_type IN ('account_terms','subscription_checkout')),
  document_version text NOT NULL CHECK (char_length(document_version) BETWEEN 8 AND 40),
  documents jsonb NOT NULL DEFAULT '{}'::jsonb,
  immediate_performance_requested boolean NOT NULL DEFAULT false,
  account_type text CHECK (account_type IS NULL OR account_type IN ('individual','business')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  accepted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_legal_acceptances_tenant_time_idx
  ON customer_legal_acceptances(tenant_id,accepted_at DESC,id DESC);
CREATE INDEX customer_legal_acceptances_principal_time_idx
  ON customer_legal_acceptances(customer_principal_id,accepted_at DESC,id DESC);

CREATE FUNCTION prevent_customer_legal_acceptance_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'customer legal acceptances are append-only';
END;
$$;

CREATE TRIGGER customer_legal_acceptances_no_mutation
BEFORE UPDATE OR DELETE ON customer_legal_acceptances
FOR EACH ROW EXECUTE FUNCTION prevent_customer_legal_acceptance_mutation();

CREATE VIEW tenant_scoped_customer_legal_acceptances
WITH (security_barrier=true) AS
SELECT id,public_id,tenant_id,customer_principal_id,acceptance_type,document_version,
       documents,immediate_performance_requested,account_type,evidence,accepted_at
FROM customer_legal_acceptances
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE customer_legal_acceptances IS
'Immutable evidence of customer acceptance of published legal documents; stores document versions and minimal technical evidence, never passwords or payment card data.';
