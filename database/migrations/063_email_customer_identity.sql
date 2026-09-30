BEGIN;

ALTER TABLE transactional_email_deliveries
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE INDEX IF NOT EXISTS transactional_email_deliveries_message_id_idx
  ON transactional_email_deliveries(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inbound_email_customer_links (
  provider_email_id text PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_hash char(64) NOT NULL CHECK (sender_hash ~ '^[0-9a-f]{64}$'),
  match_method text NOT NULL CHECK (match_method IN ('thread','email_dossier','email')),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inbound_email_customer_links_tenant_time_idx
  ON inbound_email_customer_links(tenant_id,received_at DESC);

COMMENT ON COLUMN transactional_email_deliveries.provider_message_id IS
'RFC Message-ID returned by Resend webhooks, used only to correlate customer replies with the original transactional thread.';

COMMENT ON TABLE inbound_email_customer_links IS
'Privacy-minimised inbound e-mail correlation ledger. Stores no subject or message body; links a verified inbound provider ID to a customer tenant.';

COMMIT;
