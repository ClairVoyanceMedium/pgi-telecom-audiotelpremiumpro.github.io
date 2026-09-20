BEGIN;

CREATE TABLE customer_federated_identities (
  provider text NOT NULL CHECK (provider IN ('google')),
  provider_subject text NOT NULL CHECK (char_length(provider_subject) BETWEEN 1 AND 255),
  customer_principal_id uuid NOT NULL REFERENCES customer_principals(id) ON DELETE CASCADE,
  email_at_link text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  hosted_domain text,
  picture_url text,
  last_authenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider,provider_subject),
  UNIQUE(customer_principal_id,provider)
);

CREATE INDEX customer_federated_identities_principal_idx
  ON customer_federated_identities(customer_principal_id);

COMMIT;
