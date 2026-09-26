BEGIN;

CREATE TABLE IF NOT EXISTS acquisition_events (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_name text NOT NULL CHECK (event_name ~ '^[a-z0-9_.-]{2,80}$'),
  tenant_id bigint REFERENCES tenants(id) ON DELETE SET NULL,
  session_hash text CHECK (session_hash IS NULL OR session_hash ~ '^[a-f0-9]{64}$'),
  path text,
  referrer_host text,
  source text,
  medium text,
  campaign text,
  term text,
  content text,
  consent_analytics boolean NOT NULL DEFAULT false,
  consent_marketing boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS acquisition_events_time_idx
  ON acquisition_events(occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS acquisition_events_name_time_idx
  ON acquisition_events(event_name,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS acquisition_events_tenant_time_idx
  ON acquisition_events(tenant_id,occurred_at DESC,id DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_external_links (
  tenant_id bigint PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'hubspot' CHECK (provider='hubspot'),
  contact_id text,
  deal_id text,
  pipeline_id text,
  last_stage text,
  last_synced_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_external_links_sync_idx
  ON crm_external_links(last_synced_at DESC NULLS LAST,updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_sync_receipts (
  outbox_event_id bigint PRIMARY KEY REFERENCES outbox_events(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'hubspot' CHECK (provider='hubspot'),
  state text NOT NULL CHECK (state IN ('pending','synced','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  last_error_code text,
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_sync_receipts_state_idx
  ON crm_sync_receipts(state,updated_at,id);

COMMIT;
