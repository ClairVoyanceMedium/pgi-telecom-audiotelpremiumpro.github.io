BEGIN;

ALTER TABLE transactional_email_deliveries
  ADD COLUMN IF NOT EXISTS provider_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS transactional_email_deliveries_message_id_uidx
  ON transactional_email_deliveries(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE inbound_email_correlations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_email_id text NOT NULL UNIQUE,
  message_id text,
  tenant_id bigint REFERENCES tenants(id) ON DELETE SET NULL,
  sender_hash char(64) CHECK (sender_hash IS NULL OR sender_hash ~ '^[0-9a-f]{64}$'),
  resolution_method text NOT NULL
    CHECK (resolution_method IN ('thread','sender_plus_dossier','sender_exact','dossier_hint','ambiguous','unresolved')),
  dossier_reference text
    CHECK (dossier_reference IS NULL OR dossier_reference ~ '^APP-[0-9]{4}-[0-9A-Z]{5,18}$'),
  resolution_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inbound_email_correlations_tenant_time_idx
  ON inbound_email_correlations(tenant_id,created_at DESC,id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX inbound_email_correlations_message_idx
  ON inbound_email_correlations(message_id)
  WHERE message_id IS NOT NULL;

COMMENT ON COLUMN transactional_email_deliveries.provider_message_id IS
'Normalized RFC Message-ID learned from Resend webhooks for safe reply-thread correlation.';

COMMENT ON TABLE inbound_email_correlations IS
'Privacy-minimized inbound email routing ledger. Stores no email body and never treats an APP dossier reference alone as authentication.';

COMMIT;
