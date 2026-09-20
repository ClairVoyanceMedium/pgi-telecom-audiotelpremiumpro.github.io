-- Audiotel Premium Pro — ARCEP 2026 numbering-plan guardrails.
-- Expand-only. Encodes operational gates derived from decision ARCEP 2025-2215,
-- effective numbering-plan version from 1 January 2026.
-- No operator, numbering, APNF, payment or Stripe connection is activated here.

CREATE TABLE sva_arcep_2026_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  decision_reference text NOT NULL DEFAULT 'ARCEP 2025-2215',
  exclusive_stable_assignee_status text NOT NULL DEFAULT 'not_started',
  single_service_status text NOT NULL DEFAULT 'not_started',
  portability_offered_status text NOT NULL DEFAULT 'not_started',
  tariff_ceiling_status text NOT NULL DEFAULT 'not_started',
  no_temporary_contact_use_status text NOT NULL DEFAULT 'not_started',
  public_body_eligibility_status text NOT NULL DEFAULT 'not_started',
  caller_id_block_status text NOT NULL DEFAULT 'not_started',
  parental_control_classification_status text NOT NULL DEFAULT 'not_started',
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,sva_number_id),
  CHECK (exclusive_stable_assignee_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (single_service_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (portability_offered_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (tariff_ceiling_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (no_temporary_contact_use_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (public_body_eligibility_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (caller_id_block_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (parental_control_classification_status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  CHECK (next_review_at IS NULL OR last_reviewed_at IS NULL OR next_review_at>=last_reviewed_at)
);

CREATE INDEX sva_arcep_2026_profiles_review_idx
  ON sva_arcep_2026_profiles(next_review_at)
  WHERE next_review_at IS NOT NULL;

CREATE TABLE sva_arcep_2026_evidence_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  control_key text NOT NULL
    CHECK (control_key IN (
      'exclusive_stable_assignee',
      'single_service',
      'portability_offered',
      'tariff_ceiling',
      'no_temporary_contact_use',
      'public_body_eligibility',
      'caller_id_block',
      'parental_control_classification'
    )),
  status text NOT NULL
    CHECK (status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  source text NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal','customer','operator','apnf_rsva','af2m','arcep','dgccrf','other')),
  evidence_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash char(64),
  event_hash char(64) NOT NULL,
  actor_subject text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status<>'verified' OR nullif(btrim(COALESCE(evidence_reference,'')),'') IS NOT NULL),
  CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'),
  CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX sva_arcep_2026_evidence_number_idx
  ON sva_arcep_2026_evidence_events(tenant_id,sva_number_id,id DESC);

CREATE FUNCTION pgi_arcep_2026_evidence_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(970400000000 + NEW.sva_number_id);
  SELECT event_hash INTO v_previous
  FROM sva_arcep_2026_evidence_events
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

CREATE TRIGGER sva_arcep_2026_evidence_hash_chain
BEFORE INSERT ON sva_arcep_2026_evidence_events
FOR EACH ROW
EXECUTE FUNCTION pgi_arcep_2026_evidence_hash_chain();

CREATE FUNCTION pgi_arcep_2026_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ARCEP 2026 evidence ledger is append-only';
END;
$$;

CREATE TRIGGER sva_arcep_2026_evidence_no_mutation
BEFORE UPDATE OR DELETE ON sva_arcep_2026_evidence_events
FOR EACH ROW
EXECUTE FUNCTION pgi_arcep_2026_evidence_immutable();

CREATE FUNCTION pgi_apply_arcep_2026_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO sva_arcep_2026_profiles(tenant_id,sva_number_id)
  VALUES(NEW.tenant_id,NEW.sva_number_id)
  ON CONFLICT(tenant_id,sva_number_id) DO NOTHING;

  UPDATE sva_arcep_2026_profiles
  SET
    exclusive_stable_assignee_status=CASE WHEN NEW.control_key='exclusive_stable_assignee' THEN NEW.status ELSE exclusive_stable_assignee_status END,
    single_service_status=CASE WHEN NEW.control_key='single_service' THEN NEW.status ELSE single_service_status END,
    portability_offered_status=CASE WHEN NEW.control_key='portability_offered' THEN NEW.status ELSE portability_offered_status END,
    tariff_ceiling_status=CASE WHEN NEW.control_key='tariff_ceiling' THEN NEW.status ELSE tariff_ceiling_status END,
    no_temporary_contact_use_status=CASE WHEN NEW.control_key='no_temporary_contact_use' THEN NEW.status ELSE no_temporary_contact_use_status END,
    public_body_eligibility_status=CASE WHEN NEW.control_key='public_body_eligibility' THEN NEW.status ELSE public_body_eligibility_status END,
    caller_id_block_status=CASE WHEN NEW.control_key='caller_id_block' THEN NEW.status ELSE caller_id_block_status END,
    parental_control_classification_status=CASE WHEN NEW.control_key='parental_control_classification' THEN NEW.status ELSE parental_control_classification_status END,
    last_reviewed_at=NEW.occurred_at,
    updated_at=now()
  WHERE tenant_id=NEW.tenant_id AND sva_number_id=NEW.sva_number_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sva_arcep_2026_evidence_apply
AFTER INSERT ON sva_arcep_2026_evidence_events
FOR EACH ROW
EXECUTE FUNCTION pgi_apply_arcep_2026_evidence();

CREATE FUNCTION pgi_arcep_2026_number_ready(p_tenant_id bigint,p_sva_number_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM tenants t
      WHERE t.id=p_tenant_id AND t.tenant_type='internal'
    ) THEN true
    WHEN NOT EXISTS (
      SELECT 1
      FROM sva_numbers n
      LEFT JOIN operating_markets m ON m.id=n.market_id
      WHERE n.id=p_sva_number_id
        AND COALESCE(m.country_code,'FR')='FR'
        AND regexp_replace(n.e164,'^\+','','g') ~ '^33(81|82|89)'
    ) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM sva_arcep_2026_profiles p
      JOIN sva_numbers n ON n.id=p.sva_number_id
      LEFT JOIN operating_markets m ON m.id=n.market_id
      WHERE p.tenant_id=p_tenant_id
        AND p.sva_number_id=p_sva_number_id
        AND COALESCE(m.country_code,'FR')='FR'
        AND p.exclusive_stable_assignee_status='verified'
        AND p.single_service_status='verified'
        AND p.portability_offered_status='verified'
        AND p.tariff_ceiling_status='verified'
        AND p.no_temporary_contact_use_status='verified'
        AND p.public_body_eligibility_status IN ('verified','not_applicable')
        AND (
          regexp_replace(n.e164,'^\+','','g') !~ '^3389'
          OR p.caller_id_block_status='verified'
        )
        AND (
          regexp_replace(n.e164,'^\+','','g') !~ '^33895'
          OR p.parental_control_classification_status='verified'
        )
        AND (p.next_review_at IS NULL OR p.next_review_at>now())
    )
  END
$$;

CREATE FUNCTION pgi_require_arcep_2026_ready_for_active_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_internal boolean;
  v_is_fr_premium boolean;
BEGIN
  IF NEW.status<>'active' THEN
    RETURN NEW;
  END IF;

  SELECT tenant_type='internal' INTO v_internal
  FROM tenants WHERE id=NEW.tenant_id;

  IF COALESCE(v_internal,false) THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(m.country_code,'FR')='FR'
    AND regexp_replace(n.e164,'^\+','','g') ~ '^33(81|82|89)'
  INTO v_is_fr_premium
  FROM sva_numbers n
  LEFT JOIN operating_markets m ON m.id=n.market_id
  WHERE n.id=NEW.sva_number_id;

  IF NOT COALESCE(v_is_fr_premium,false) THEN
    RETURN NEW;
  END IF;

  -- Serialise activation per number so two tenants cannot concurrently acquire
  -- the same premium number.
  PERFORM pg_advisory_xact_lock(970401000000 + NEW.sva_number_id);

  IF EXISTS (
    SELECT 1
    FROM tenant_number_assignments a
    WHERE a.sva_number_id=NEW.sva_number_id
      AND a.status='active'
      AND a.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'ARCEP 2026 exclusive stable assignee rule blocks multiple active assignments';
  END IF;

  IF NOT pgi_arcep_2026_number_ready(NEW.tenant_id,NEW.sva_number_id) THEN
    RAISE EXCEPTION 'verified ARCEP 2026 number-plan guardrails required before external premium SVA activation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER zzzz_tenant_number_assignments_arcep_2026_gate
BEFORE INSERT OR UPDATE OF status,tenant_id,sva_number_id
ON tenant_number_assignments
FOR EACH ROW
WHEN (NEW.status='active')
EXECUTE FUNCTION pgi_require_arcep_2026_ready_for_active_assignment();

-- Existing external French premium assignments are imported in a truthful
-- not_started state. Existing active rows are not silently re-certified.
INSERT INTO sva_arcep_2026_profiles(tenant_id,sva_number_id)
SELECT DISTINCT a.tenant_id,a.sva_number_id
FROM tenant_number_assignments a
JOIN tenants t ON t.id=a.tenant_id
JOIN sva_numbers n ON n.id=a.sva_number_id
LEFT JOIN operating_markets m ON m.id=n.market_id
WHERE t.tenant_type<>'internal'
  AND COALESCE(m.country_code,'FR')='FR'
  AND regexp_replace(n.e164,'^\+','','g') ~ '^33(81|82|89)'
ON CONFLICT(tenant_id,sva_number_id) DO NOTHING;

CREATE VIEW arcep_2026_assignment_readiness AS
SELECT
  a.id AS assignment_id,
  a.tenant_id,
  a.sva_number_id,
  n.e164,
  a.status AS assignment_status,
  p.exclusive_stable_assignee_status,
  p.single_service_status,
  p.portability_offered_status,
  p.tariff_ceiling_status,
  p.no_temporary_contact_use_status,
  p.public_body_eligibility_status,
  p.caller_id_block_status,
  p.parental_control_classification_status,
  p.next_review_at,
  pgi_arcep_2026_number_ready(a.tenant_id,a.sva_number_id) AS arcep_2026_ready
FROM tenant_number_assignments a
JOIN sva_numbers n ON n.id=a.sva_number_id
LEFT JOIN operating_markets m ON m.id=n.market_id
LEFT JOIN sva_arcep_2026_profiles p
  ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id
WHERE COALESCE(m.country_code,'FR')='FR'
  AND regexp_replace(n.e164,'^\+','','g') ~ '^33(81|82|89)';

COMMENT ON TABLE sva_arcep_2026_profiles IS
'Fail-closed per-number controls derived from ARCEP decision 2025-2215 for French 081/082/089 premium special numbers.';
COMMENT ON TABLE sva_arcep_2026_evidence_events IS
'Append-only SHA-256 chained evidence for ARCEP 2026 numbering-plan activation controls.';
COMMENT ON VIEW arcep_2026_assignment_readiness IS
'Operational readiness view. A true value is a technical gate state, not a legal certification or regulatory approval.';
