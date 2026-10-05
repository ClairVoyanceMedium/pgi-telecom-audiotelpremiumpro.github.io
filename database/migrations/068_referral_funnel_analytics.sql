-- Privacy-minimized referral funnel analytics.
-- visitor_token is a browser-session UUID generated for referral attribution.
-- No IP address, email address or other direct identifier is stored here.

CREATE TABLE IF NOT EXISTS customer_referral_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referral_code_id bigint NOT NULL REFERENCES customer_referral_codes(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('visit','prospect')),
  visitor_token uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(referral_code_id,event_type,visitor_token)
);

CREATE INDEX IF NOT EXISTS customer_referral_events_code_time_idx
  ON customer_referral_events(referral_code_id,occurred_at DESC);

CREATE INDEX IF NOT EXISTS customer_referral_events_type_time_idx
  ON customer_referral_events(event_type,occurred_at DESC);

COMMENT ON TABLE customer_referral_events IS
'Privacy-minimized referral funnel events. visit = unique referral landing session; prospect = accepted opening request. No direct visitor PII is stored.';
