-- Privacy minimized one time referral invitations.
-- Recipient email is never stored in clear text. Only a SHA 256 hash is retained
-- to prevent duplicate invitations and repeated commercial solicitation.

CREATE TABLE IF NOT EXISTS customer_referral_invitations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  referral_code_id bigint NOT NULL REFERENCES customer_referral_codes(id) ON DELETE CASCADE,
  referrer_tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  recipient_email_hash char(64) NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  consent_attested_at timestamptz NOT NULL,
  sent_at timestamptz,
  provider_message_reference text,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_referral_invitations_hash_format_chk CHECK (recipient_email_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT customer_referral_invitations_recipient_uidx UNIQUE (recipient_email_hash)
);

CREATE INDEX IF NOT EXISTS customer_referral_invitations_referrer_time_idx
  ON customer_referral_invitations(referrer_tenant_id,created_at DESC);

CREATE INDEX IF NOT EXISTS customer_referral_invitations_status_time_idx
  ON customer_referral_invitations(status,created_at DESC);

COMMENT ON TABLE customer_referral_invitations IS
'One time referral invitations. No clear text recipient email is stored. Hash uniqueness prevents repeated invitations to the same address.';
