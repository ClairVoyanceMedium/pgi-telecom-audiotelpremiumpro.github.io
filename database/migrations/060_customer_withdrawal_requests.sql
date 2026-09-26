BEGIN;

CREATE TABLE customer_withdrawal_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint REFERENCES tenants(id) ON DELETE SET NULL,
  first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 80),
  last_name text NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 80),
  contract_email text NOT NULL CHECK (char_length(contract_email) BETWEEN 3 AND 320),
  acknowledgement_email text NOT NULL CHECK (char_length(acknowledgement_email) BETWEEN 3 AND 320),
  contract_reference text CHECK (contract_reference IS NULL OR char_length(contract_reference) <= 180),
  contract_details text NOT NULL CHECK (char_length(contract_details) BETWEEN 3 AND 1200),
  contract_date date,
  legal_version text NOT NULL CHECK (char_length(legal_version) BETWEEN 8 AND 80),
  source text NOT NULL DEFAULT 'online' CHECK (source='online'),
  request_sha256 char(64) NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  requester_ip_sha256 char(64) CHECK (requester_ip_sha256 IS NULL OR requester_ip_sha256 ~ '^[0-9a-f]{64}$'),
  user_agent_sha256 char(64) CHECK (user_agent_sha256 IS NULL OR user_agent_sha256 ~ '^[0-9a-f]{64}$'),
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX customer_withdrawal_requests_tenant_time_idx
  ON customer_withdrawal_requests(tenant_id,submitted_at DESC,id DESC);
CREATE INDEX customer_withdrawal_requests_time_idx
  ON customer_withdrawal_requests(submitted_at DESC,id DESC);
CREATE INDEX customer_withdrawal_requests_request_hash_idx
  ON customer_withdrawal_requests(request_sha256);

COMMENT ON TABLE customer_withdrawal_requests IS
'Durable record of online consumer withdrawal declarations. Original declaration fields are not mutated by the public flow.';
COMMENT ON COLUMN customer_withdrawal_requests.requester_ip_sha256 IS
'One-way operational evidence hash. Raw requester IP addresses are not stored in this table.';
COMMENT ON COLUMN customer_withdrawal_requests.user_agent_sha256 IS
'One-way operational evidence hash. Raw user-agent values are not stored in this table.';

COMMIT;
