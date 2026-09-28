BEGIN;

CREATE TABLE IF NOT EXISTS analytics_event_deliveries (
  delivery_key text PRIMARY KEY CHECK (char_length(delivery_key) BETWEEN 8 AND 220),
  source text NOT NULL CHECK (source IN ('stripe')),
  source_event_id text NOT NULL,
  event_name text NOT NULL CHECK (event_name IN ('purchase','refund')),
  transaction_id text NOT NULL,
  payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','failed')),
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  provider_status integer,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX IF NOT EXISTS analytics_event_deliveries_state_idx
  ON analytics_event_deliveries(state,updated_at DESC);

CREATE INDEX IF NOT EXISTS analytics_event_deliveries_transaction_idx
  ON analytics_event_deliveries(transaction_id,event_name);

COMMIT;
