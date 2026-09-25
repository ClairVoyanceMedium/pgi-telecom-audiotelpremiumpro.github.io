BEGIN;

CREATE TABLE transactional_email_deliveries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint REFERENCES tenants(id) ON DELETE SET NULL,
  customer_principal_id uuid REFERENCES customer_principals(id) ON DELETE SET NULL,
  outbox_event_id bigint REFERENCES outbox_events(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  template_key text NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('notifications','billing','support')),
  recipient_hash char(64) NOT NULL CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL DEFAULT 'resend' CHECK (provider='resend'),
  provider_email_id text UNIQUE,
  event_type text,
  aggregate_type text,
  aggregate_id text,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','accepted','sent','delivered','delayed','clicked','bounced','complained','failed','suppressed')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error_code text,
  accepted_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  delayed_at timestamptz,
  clicked_at timestamptz,
  bounced_at timestamptz,
  complained_at timestamptz,
  failed_at timestamptz,
  suppressed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transactional_email_deliveries_tenant_time_idx
  ON transactional_email_deliveries(tenant_id,created_at DESC,id DESC);
CREATE INDEX transactional_email_deliveries_state_time_idx
  ON transactional_email_deliveries(state,updated_at DESC,id DESC);
CREATE INDEX transactional_email_deliveries_recipient_idx
  ON transactional_email_deliveries(recipient_hash,created_at DESC);

CREATE TABLE transactional_email_event_receipts (
  outbox_event_id bigint PRIMARY KEY REFERENCES outbox_events(id) ON DELETE CASCADE,
  disposition text NOT NULL CHECK (disposition IN ('processed','ignored')),
  error_code text,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactional_email_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  svix_id text NOT NULL UNIQUE,
  event_type text NOT NULL,
  provider_email_id text NOT NULL,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transactional_email_webhook_provider_idx
  ON transactional_email_webhook_events(provider_email_id,occurred_at DESC,id DESC);

CREATE TABLE transactional_email_suppressions (
  recipient_hash char(64) PRIMARY KEY CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (reason IN ('hard_bounce','complaint','provider_suppressed')),
  source_provider_email_id text,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE transactional_email_deliveries IS
'Minimal transactional e-mail delivery ledger. Stores recipient hashes and provider identifiers, not message bodies.';
COMMENT ON TABLE transactional_email_webhook_events IS
'Idempotent Resend webhook receipt ledger. Stores payload hashes only, never complete webhook payloads.';
COMMENT ON TABLE transactional_email_suppressions IS
'Permanent transactional e-mail suppression hashes produced by hard bounces, complaints, or provider suppression.';

COMMIT;
