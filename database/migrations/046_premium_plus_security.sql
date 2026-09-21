-- PGI Telecom — Premium+ strong authentication foundation.
-- Expand-only. WebAuthn remains disabled until PGI_WEBAUTHN_RP_ID and PGI_WEBAUTHN_ORIGIN are configured.

BEGIN;

CREATE TABLE webauthn_credentials (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  owner_type text NOT NULL CHECK (owner_type IN ('staff','customer')),
  staff_user_id bigint REFERENCES app_users(id) ON DELETE CASCADE,
  customer_principal_id uuid REFERENCES customer_principals(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE CHECK (char_length(credential_id) BETWEEN 16 AND 2048),
  public_key_spki text NOT NULL CHECK (char_length(public_key_spki) BETWEEN 40 AND 8192),
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count>=0),
  transports jsonb NOT NULL DEFAULT '[]'::jsonb,
  label text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (owner_type='staff' AND staff_user_id IS NOT NULL AND customer_principal_id IS NULL)
    OR
    (owner_type='customer' AND staff_user_id IS NULL AND customer_principal_id IS NOT NULL)
  )
);

CREATE INDEX webauthn_credentials_staff_idx ON webauthn_credentials(staff_user_id,enabled,id) WHERE owner_type='staff';
CREATE INDEX webauthn_credentials_customer_idx ON webauthn_credentials(customer_principal_id,enabled,id) WHERE owner_type='customer';

COMMENT ON TABLE webauthn_credentials IS
'WebAuthn passkeys for optional step-up MFA. No passkey is considered active until server-side challenge, origin, RP ID, signature and user-verification checks succeed.';

COMMIT;
