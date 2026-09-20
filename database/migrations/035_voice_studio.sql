-- PGI Telecom — Voice Studio / SVI versionné, simulable et multi-client.
-- Expand-only. Aucun routage opérateur réel n'est activé par cette migration.

CREATE TABLE tenant_voice_services (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  sva_number_id bigint REFERENCES sva_numbers(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','testing','published','paused','archived')),
  timezone text NOT NULL DEFAULT 'Europe/Paris' CHECK (char_length(timezone) BETWEEN 2 AND 80),
  default_locale text NOT NULL DEFAULT 'fr-FR' CHECK (char_length(default_locale) BETWEEN 2 AND 20),
  active_version_id bigint,
  created_by_subject text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id)
);

CREATE INDEX tenant_voice_services_tenant_status_idx
  ON tenant_voice_services(tenant_id,status,updated_at DESC,id DESC);
CREATE UNIQUE INDEX tenant_voice_services_tenant_number_active_uq
  ON tenant_voice_services(tenant_id,sva_number_id)
  WHERE sva_number_id IS NOT NULL AND status IN ('testing','published','paused');

CREATE TABLE tenant_voice_service_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  service_id bigint NOT NULL,
  version_no integer NOT NULL CHECK (version_no BETWEEN 1 AND 1000000),
  state text NOT NULL DEFAULT 'draft'
    CHECK (state IN ('draft','published','retired')),
  flow jsonb NOT NULL,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  checksum_sha256 text NOT NULL CHECK (char_length(checksum_sha256)=64),
  source_version_id bigint,
  created_by_subject text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_id,version_no),
  UNIQUE(tenant_id,id),
  CONSTRAINT tenant_voice_service_versions_service_fk
    FOREIGN KEY (tenant_id,service_id) REFERENCES tenant_voice_services(tenant_id,id) ON DELETE CASCADE
);

ALTER TABLE tenant_voice_services
  ADD CONSTRAINT tenant_voice_services_active_version_fk
  FOREIGN KEY (tenant_id,active_version_id)
  REFERENCES tenant_voice_service_versions(tenant_id,id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX tenant_voice_service_versions_service_idx
  ON tenant_voice_service_versions(tenant_id,service_id,version_no DESC,id DESC);

CREATE TABLE tenant_voice_access_rules (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  service_id bigint NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('blacklist','whitelist','velocity','anonymous')),
  match_type text NOT NULL CHECK (match_type IN ('e164_exact','e164_prefix','country','anonymous','rate')),
  match_value text NOT NULL CHECK (char_length(match_value) BETWEEN 1 AND 160),
  action text NOT NULL CHECK (action IN ('allow','block','challenge','throttle')),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 10000),
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_voice_access_rules_service_fk
    FOREIGN KEY (tenant_id,service_id) REFERENCES tenant_voice_services(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX tenant_voice_access_rules_eval_idx
  ON tenant_voice_access_rules(tenant_id,service_id,enabled,priority,id);

CREATE TABLE tenant_voice_service_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  service_id bigint NOT NULL,
  version_id bigint,
  event_type text NOT NULL
    CHECK (event_type IN ('created','draft_saved','validated','simulated','published','rolled_back','paused','resumed','archived')),
  actor_type text NOT NULL DEFAULT 'customer'
    CHECK (actor_type IN ('customer','staff','system')),
  actor_subject text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_voice_service_events_service_fk
    FOREIGN KEY (tenant_id,service_id) REFERENCES tenant_voice_services(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT tenant_voice_service_events_version_fk
    FOREIGN KEY (tenant_id,version_id) REFERENCES tenant_voice_service_versions(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX tenant_voice_service_events_tenant_time_idx
  ON tenant_voice_service_events(tenant_id,service_id,occurred_at DESC,id DESC);

CREATE VIEW tenant_scoped_voice_services
WITH (security_barrier=true)
AS
SELECT id,tenant_id,sva_number_id,name,status,timezone,default_locale,active_version_id,published_at,created_at,updated_at
FROM tenant_voice_services
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_voice_service_versions
WITH (security_barrier=true)
AS
SELECT id,tenant_id,service_id,version_no,state,flow,validation,checksum_sha256,source_version_id,published_at,created_at
FROM tenant_voice_service_versions
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_voice_access_rules
WITH (security_barrier=true)
AS
SELECT id,tenant_id,service_id,rule_type,match_type,match_value,action,priority,enabled,metadata,created_at,updated_at
FROM tenant_voice_access_rules
WHERE tenant_id=pgi_require_tenant_context();

CREATE VIEW tenant_scoped_voice_service_events
WITH (security_barrier=true)
AS
SELECT id,tenant_id,service_id,version_id,event_type,actor_type,actor_subject,details,occurred_at
FROM tenant_voice_service_events
WHERE tenant_id=pgi_require_tenant_context();

COMMENT ON TABLE tenant_voice_services IS
'Provider-agnostic customer Voice Studio service. Publishing changes PGI configuration only; no carrier routing is activated until a telephony adapter consumes a published version.';

COMMENT ON TABLE tenant_voice_service_versions IS
'Immutable version history for SVI flows, validation results, safe simulation and rollback.';

COMMENT ON COLUMN tenant_voice_service_versions.flow IS
'Versioned SVI graph supporting menus, schedules, TTS, queues, weighted routing, recording consent, access control, voicemail and termination.';

COMMENT ON TABLE tenant_voice_access_rules IS
'Structured allow/block/throttle rules complementing versioned flow controls without storing raw call recordings or credentials.';
