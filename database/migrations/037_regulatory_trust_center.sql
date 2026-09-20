-- Audiotel Premium Pro — Regulatory Trust Center.
-- Expand-only. Adds fail-closed SVA regulatory evidence and abuse controls.
-- No operator, numbering or payment provider connection is activated by this migration.

CREATE TABLE sva_regulatory_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  regulatory_role text NOT NULL DEFAULT 'service_provider'
    CHECK (regulatory_role IN ('service_provider','sva_operator')),
  service_name text,
  service_description text,
  provider_name text,
  provider_website text,
  provider_address text,
  complaint_contact text,
  signaletic_model text
    CHECK (signaletic_model IS NULL OR signaletic_model IN ('free','normal','majorated')),
  numbering_rights_status text NOT NULL DEFAULT 'not_started',
  editor_identity_status text NOT NULL DEFAULT 'not_started',
  rsva_status text NOT NULL DEFAULT 'not_started',
  tariff_transparency_status text NOT NULL DEFAULT 'not_started',
  mgit_status text NOT NULL DEFAULT 'not_started',
  complaint_process_status text NOT NULL DEFAULT 'not_started',
  fraud_monitoring_status text NOT NULL DEFAULT 'not_started',
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,sva_number_id),
  CHECK (numbering_rights_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (editor_identity_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (rsva_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (tariff_transparency_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (mgit_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (complaint_process_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (fraud_monitoring_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (next_review_at IS NULL OR last_reviewed_at IS NULL OR next_review_at>=last_reviewed_at)
);

CREATE INDEX sva_regulatory_profiles_state_idx
  ON sva_regulatory_profiles(tenant_id,updated_at DESC,sva_number_id);
CREATE INDEX sva_regulatory_profiles_review_idx
  ON sva_regulatory_profiles(next_review_at)
  WHERE next_review_at IS NOT NULL;

CREATE TABLE platform_regulatory_controls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id bigint REFERENCES operating_markets(id),
  control_key text NOT NULL
    CHECK (control_key IN (
      'ce_identifier','apnf_rsva_access','af2m_cgs','man_caller_authentication',
      'fraud_route_traceability','incident_notification','33700_process'
    )),
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  evidence_reference text,
  evidence_sha256 char(64),
  verified_at timestamptz,
  valid_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX platform_regulatory_controls_unique_scope
  ON platform_regulatory_controls(control_key,COALESCE(market_id,0));
CREATE INDEX platform_regulatory_controls_state_idx
  ON platform_regulatory_controls(status,control_key);

CREATE TABLE sva_regulatory_evidence_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  control_key text NOT NULL
    CHECK (control_key IN (
      'numbering_rights','editor_identity','rsva','tariff_transparency',
      'mgit','complaint_process','fraud_monitoring'
    )),
  status text NOT NULL
    CHECK (status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  source text NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal','customer','operator','apnf_rsva','af2m','arcep','dgccrf','33700','other')),
  evidence_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash char(64),
  event_hash char(64) NOT NULL,
  actor_subject text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'),
  CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX sva_regulatory_evidence_number_idx
  ON sva_regulatory_evidence_events(tenant_id,sva_number_id,id DESC);
CREATE INDEX sva_regulatory_evidence_hash_idx
  ON sva_regulatory_evidence_events(event_hash);

CREATE TABLE sva_abuse_cases (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint REFERENCES sva_numbers(id) ON DELETE SET NULL,
  source text NOT NULL
    CHECK (source IN ('33700','arcep','dgccrf','operator','consumer','internal','other')),
  external_reference text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('spam','fraud','spoofing','tariff','content','identity','routing','other')),
  severity text NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('low','normal','high','critical')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','mitigated','resolved','closed')),
  suspension_required boolean NOT NULL DEFAULT false,
  first_response_due_at timestamptz,
  resolution_due_at timestamptz,
  summary text NOT NULL CHECK (char_length(summary) BETWEEN 3 AND 500),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sva_abuse_cases_open_idx
  ON sva_abuse_cases(status,severity,opened_at DESC)
  WHERE status NOT IN ('resolved','closed');
CREATE INDEX sva_abuse_cases_number_idx
  ON sva_abuse_cases(tenant_id,sva_number_id,opened_at DESC);

CREATE FUNCTION pgi_regulatory_evidence_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(970370000000 + NEW.sva_number_id);
  SELECT event_hash INTO v_previous
  FROM sva_regulatory_evidence_events
  WHERE tenant_id=NEW.tenant_id AND sva_number_id=NEW.sva_number_id
  ORDER BY id DESC LIMIT 1;
  NEW.previous_hash:=v_previous;
  NEW.event_hash:=encode(digest(
    concat_ws('|',
      NEW.tenant_id::text,
      NEW.sva_number_id::text,
      NEW.control_key,
      NEW.status,
      NEW.source,
      COALESCE(NEW.evidence_reference,''),
      NEW.metadata::text,
      COALESCE(v_previous,''),
      NEW.occurred_at::text
    ),
    'sha256'
  ),'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER sva_regulatory_evidence_hash_chain
BEFORE INSERT ON sva_regulatory_evidence_events
FOR EACH ROW
EXECUTE FUNCTION pgi_regulatory_evidence_hash_chain();

CREATE FUNCTION pgi_regulatory_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory evidence ledger is append-only';
END;
$$;

CREATE TRIGGER sva_regulatory_evidence_no_update
BEFORE UPDATE OR DELETE ON sva_regulatory_evidence_events
FOR EACH ROW
EXECUTE FUNCTION pgi_regulatory_evidence_immutable();

CREATE FUNCTION pgi_apply_sva_regulatory_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO sva_regulatory_profiles(tenant_id,sva_number_id)
  VALUES(NEW.tenant_id,NEW.sva_number_id)
  ON CONFLICT(tenant_id,sva_number_id) DO NOTHING;

  UPDATE sva_regulatory_profiles
  SET
    numbering_rights_status=CASE WHEN NEW.control_key='numbering_rights' THEN NEW.status ELSE numbering_rights_status END,
    editor_identity_status=CASE WHEN NEW.control_key='editor_identity' THEN NEW.status ELSE editor_identity_status END,
    rsva_status=CASE WHEN NEW.control_key='rsva' THEN NEW.status ELSE rsva_status END,
    tariff_transparency_status=CASE WHEN NEW.control_key='tariff_transparency' THEN NEW.status ELSE tariff_transparency_status END,
    mgit_status=CASE WHEN NEW.control_key='mgit' THEN NEW.status ELSE mgit_status END,
    complaint_process_status=CASE WHEN NEW.control_key='complaint_process' THEN NEW.status ELSE complaint_process_status END,
    fraud_monitoring_status=CASE WHEN NEW.control_key='fraud_monitoring' THEN NEW.status ELSE fraud_monitoring_status END,
    last_reviewed_at=NEW.occurred_at,
    updated_at=now()
  WHERE tenant_id=NEW.tenant_id AND sva_number_id=NEW.sva_number_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sva_regulatory_evidence_apply
AFTER INSERT ON sva_regulatory_evidence_events
FOR EACH ROW
EXECUTE FUNCTION pgi_apply_sva_regulatory_evidence();

CREATE FUNCTION pgi_sva_regulatory_ready(p_tenant_id bigint,p_sva_number_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM tenants t
      WHERE t.id=p_tenant_id AND t.tenant_type='internal'
    ) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM sva_regulatory_profiles p
      JOIN tenant_kyc_profiles k ON k.tenant_id=p.tenant_id
      WHERE p.tenant_id=p_tenant_id
        AND p.sva_number_id=p_sva_number_id
        AND k.status='verified'
        AND p.numbering_rights_status='verified'
        AND p.editor_identity_status='verified'
        AND p.rsva_status='verified'
        AND p.tariff_transparency_status='verified'
        AND p.mgit_status IN ('verified','not_applicable')
        AND p.complaint_process_status='verified'
        AND p.fraud_monitoring_status='verified'
        AND nullif(btrim(p.service_name),'') IS NOT NULL
        AND nullif(btrim(p.service_description),'') IS NOT NULL
        AND nullif(btrim(p.provider_name),'') IS NOT NULL
        AND nullif(btrim(p.provider_address),'') IS NOT NULL
        AND nullif(btrim(p.complaint_contact),'') IS NOT NULL
        AND (p.next_review_at IS NULL OR p.next_review_at>now())
    )
  END
$$;

CREATE FUNCTION pgi_require_regulatory_ready_for_active_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_internal boolean;
BEGIN
  IF NEW.status<>'active' THEN
    RETURN NEW;
  END IF;

  SELECT tenant_type='internal' INTO v_internal
  FROM tenants WHERE id=NEW.tenant_id;

  IF COALESCE(v_internal,false) THEN
    RETURN NEW;
  END IF;

  IF NEW.regulatory_assignor_carrier_id IS NULL
     OR nullif(btrim(COALESCE(NEW.upstream_assignment_reference,'')),'') IS NULL THEN
    RAISE EXCEPTION 'regulatory assignor and upstream assignment reference required before external SVA activation';
  END IF;

  IF NOT pgi_sva_regulatory_ready(NEW.tenant_id,NEW.sva_number_id) THEN
    RAISE EXCEPTION 'verified regulatory trust profile required before external SVA activation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER zzz_tenant_number_assignments_regulatory_gate
BEFORE INSERT OR UPDATE OF status,tenant_id,sva_number_id,regulatory_assignor_carrier_id,upstream_assignment_reference
ON tenant_number_assignments
FOR EACH ROW
WHEN (NEW.status='active')
EXECUTE FUNCTION pgi_require_regulatory_ready_for_active_assignment();

-- Existing external assignments are deliberately imported as not ready.
INSERT INTO sva_regulatory_profiles(tenant_id,sva_number_id)
SELECT DISTINCT a.tenant_id,a.sva_number_id
FROM tenant_number_assignments a
JOIN tenants t ON t.id=a.tenant_id
WHERE t.tenant_type<>'internal'
ON CONFLICT(tenant_id,sva_number_id) DO NOTHING;

-- France controls are created in a truthful not_started state.
INSERT INTO platform_regulatory_controls(market_id,control_key,status)
SELECT m.id,v.control_key,'not_started'
FROM operating_markets m
CROSS JOIN (VALUES
  ('ce_identifier'),
  ('apnf_rsva_access'),
  ('af2m_cgs'),
  ('man_caller_authentication'),
  ('fraud_route_traceability'),
  ('incident_notification'),
  ('33700_process')
) AS v(control_key)
WHERE m.country_code='FR'
ON CONFLICT DO NOTHING;

COMMENT ON TABLE sva_regulatory_profiles IS
'Fail-closed regulatory readiness profile for every externally activated SVA number.';
COMMENT ON TABLE sva_regulatory_evidence_events IS
'Append-only cryptographically chained evidence ledger for SVA regulatory controls.';
COMMENT ON TABLE platform_regulatory_controls IS
'Platform-level evidence for operator/interop obligations such as CE, APNF/RSVA, MAN and 33700 processes.';
COMMENT ON TABLE sva_abuse_cases IS
'Regulatory and consumer-protection case register for 33700, Arcep, DGCCRF, operator and internal reports.';
