-- PGI Telecom — scalable tenant directory.
-- Prefix-search columns avoid sequential scans when the customer directory grows.

ALTER TABLE tenants
  ADD COLUMN slug_search text GENERATED ALWAYS AS (lower(btrim(slug))) STORED,
  ADD COLUMN display_name_search text GENERATED ALWAYS AS (lower(btrim(display_name))) STORED,
  ADD COLUMN legal_name_search text GENERATED ALWAYS AS (lower(btrim(COALESCE(legal_name,'')))) STORED;

CREATE INDEX tenants_slug_prefix_idx
  ON tenants(slug_search text_pattern_ops,id DESC);
CREATE INDEX tenants_display_name_prefix_idx
  ON tenants(display_name_search text_pattern_ops,id DESC);
CREATE INDEX tenants_legal_name_prefix_idx
  ON tenants(legal_name_search text_pattern_ops,id DESC);
CREATE INDEX tenants_directory_cursor_idx
  ON tenants(id DESC)
  WHERE tenant_type<>'internal';
CREATE INDEX tenants_directory_status_country_idx
  ON tenants(status,country_code,id DESC)
  WHERE tenant_type<>'internal';
