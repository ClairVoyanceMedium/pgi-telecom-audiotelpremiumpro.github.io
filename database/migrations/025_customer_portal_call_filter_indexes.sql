-- PGI Telecom — indexes for scalable customer portal call filtering.
-- Expand-only: improves tenant/status/number filtering without changing data.

CREATE INDEX IF NOT EXISTS call_facts_tenant_status_time_idx
  ON call_facts(tenant_id,call_status,started_at DESC,call_id DESC);

CREATE INDEX IF NOT EXISTS call_facts_tenant_number_time_idx
  ON call_facts(tenant_id,sva_number_id,started_at DESC,call_id DESC);
