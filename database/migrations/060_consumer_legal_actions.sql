BEGIN;

-- Consumer withdrawal and subscription cancellation evidence.
-- Withdrawal evidence is accepted from the public legal function and remains usable
-- even when no tenant can be matched automatically.

CREATE TABLE consumer_withdrawal_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint REFERENCES tenants(id) ON DELETE SET NULL,
  customer_principal_id uuid REFERENCES customer_principals(id) ON DELETE SET NULL,
  subscription_id bigint REFERENCES tenant_subscriptions(id) ON DELETE SET NULL,
  first_name text NOT NULL CHECK (char_length(first_name) BETWEEN 1 AND 120),
  last_name text NOT NULL CHECK (char_length(last_name) BETWEEN 1 AND 120),
  acknowledgement_email text NOT NULL CHECK (char_length(acknowledgement_email) BETWEEN 3 AND 320),
  contract_reference text NOT NULL CHECK (char_length(contract_reference) BETWEEN 2 AND 240),
  statement text NOT NULL CHECK (char_length(statement) BETWEEN 10 AND 2000),
  legal_version text NOT NULL CHECK (char_length(legal_version) BETWEEN 8 AND 40),
  source_path text NOT NULL DEFAULT '/retractation/',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledgement_state text NOT NULL DEFAULT 'pending'
    CHECK (acknowledgement_state IN ('pending','sending','accepted','failed')),
  acknowledgement_attempts integer NOT NULL DEFAULT 0 CHECK (acknowledgement_attempts>=0),
  acknowledgement_provider_message_id text,
  acknowledgement_last_error text,
  acknowledgement_sent_at timestamptz,
  next_acknowledgement_attempt_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX consumer_withdrawal_ack_queue_idx
  ON consumer_withdrawal_requests(next_acknowledgement_attempt_at,id)
  WHERE acknowledgement_state IN ('pending','failed');
CREATE INDEX consumer_withdrawal_tenant_time_idx
  ON consumer_withdrawal_requests(tenant_id,received_at DESC,id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE FUNCTION protect_consumer_withdrawal_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'consumer withdrawal evidence cannot be deleted';
  END IF;
  IF OLD.public_id IS DISTINCT FROM NEW.public_id
     OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.customer_principal_id IS DISTINCT FROM NEW.customer_principal_id
     OR OLD.subscription_id IS DISTINCT FROM NEW.subscription_id
     OR OLD.first_name IS DISTINCT FROM NEW.first_name
     OR OLD.last_name IS DISTINCT FROM NEW.last_name
     OR OLD.acknowledgement_email IS DISTINCT FROM NEW.acknowledgement_email
     OR OLD.contract_reference IS DISTINCT FROM NEW.contract_reference
     OR OLD.statement IS DISTINCT FROM NEW.statement
     OR OLD.legal_version IS DISTINCT FROM NEW.legal_version
     OR OLD.source_path IS DISTINCT FROM NEW.source_path
     OR OLD.evidence IS DISTINCT FROM NEW.evidence
     OR OLD.received_at IS DISTINCT FROM NEW.received_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'consumer withdrawal evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER consumer_withdrawal_evidence_guard
BEFORE UPDATE OR DELETE ON consumer_withdrawal_requests
FOR EACH ROW EXECUTE FUNCTION protect_consumer_withdrawal_evidence();

CREATE TABLE subscription_cancellation_requests (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_principal_id uuid NOT NULL REFERENCES customer_principals(id) ON DELETE RESTRICT,
  subscription_id bigint NOT NULL REFERENCES tenant_subscriptions(id) ON DELETE RESTRICT,
  provider_subscription_reference text NOT NULL,
  requested_effective_at timestamptz NOT NULL,
  legal_version text NOT NULL CHECK (char_length(legal_version) BETWEEN 8 AND 40),
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','provider_pending','scheduled','effective','failed')),
  provider_confirmed_at timestamptz,
  provider_last_error text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX subscription_cancellation_one_open_idx
  ON subscription_cancellation_requests(subscription_id)
  WHERE status IN ('received','provider_pending','scheduled');
CREATE INDEX subscription_cancellation_tenant_time_idx
  ON subscription_cancellation_requests(tenant_id,received_at DESC,id DESC);

CREATE TRIGGER subscription_cancellation_touch_updated
BEFORE UPDATE ON subscription_cancellation_requests
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE FUNCTION protect_subscription_cancellation_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'subscription cancellation evidence cannot be deleted';
  END IF;
  IF OLD.public_id IS DISTINCT FROM NEW.public_id
     OR OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.customer_principal_id IS DISTINCT FROM NEW.customer_principal_id
     OR OLD.subscription_id IS DISTINCT FROM NEW.subscription_id
     OR OLD.provider_subscription_reference IS DISTINCT FROM NEW.provider_subscription_reference
     OR OLD.requested_effective_at IS DISTINCT FROM NEW.requested_effective_at
     OR OLD.legal_version IS DISTINCT FROM NEW.legal_version
     OR OLD.evidence IS DISTINCT FROM NEW.evidence
     OR OLD.received_at IS DISTINCT FROM NEW.received_at THEN
    RAISE EXCEPTION 'subscription cancellation evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER subscription_cancellation_evidence_guard
BEFORE UPDATE OR DELETE ON subscription_cancellation_requests
FOR EACH ROW EXECUTE FUNCTION protect_subscription_cancellation_evidence();

COMMIT;
