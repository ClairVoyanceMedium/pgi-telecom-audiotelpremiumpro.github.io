-- Audiotel Premium Pro — SVA ecosystem compliance center.
-- Expand-only. Adds AF2M 2026, APNF/RSVA, consumer-protection and privacy readiness.
-- Existing active lines are not suspended by this migration.
-- No external operator, APNF/RSVA, AF2M, DGCCRF, CNIL, ACPR or PSP connection is activated.

BEGIN;

CREATE TABLE regulatory_framework_registry (
  framework_key text PRIMARY KEY,
  authority_name text NOT NULL,
  framework_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('regulator','industry','consumer','privacy','conditional')),
  reference_version text,
  effective_from date,
  source_reference text,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO regulatory_framework_registry(
  framework_key,authority_name,framework_name,category,reference_version,effective_from,source_reference,description
) VALUES
  ('arcep_numbering','ARCEP','Plan national de numérotation','regulator','2026','2026-01-01','ARCEP decision 2025-2215','Règles de numérotation et conditions propres aux numéros SVA.'),
  ('apnf_rsva','APNF / RSVA','Référentiel SVA','industry','RSVA','2023-01-01','Code consommation L224-43 / décisions ARCEP','Identification éditeur, service et tarif dans le référentiel partagé SVA.'),
  ('af2m_sva_2026','af2m','Recommandations déontologiques SVA 2026','industry','2026-09-01','2026-09-01','af2m Recommandations SVA 2026','Standards de transparence, tarification, MGIT, promotion et protection des utilisateurs.'),
  ('dgccrf_consumer','DGCCRF','Protection du consommateur SVA','consumer','current',NULL,'Code de la consommation','Transparence tarifaire, pratiques loyales, réclamations et contact après-vente.'),
  ('cnil_privacy','CNIL','Données personnelles et vie privée','privacy','RGPD/ePrivacy',NULL,'RGPD / cadre communications électroniques','Gouvernance, minimisation, droits des personnes et gestion des violations selon applicabilité.'),
  ('af2m_33700','af2m / 33700','Signalements appels indésirables','consumer','current',NULL,'33700','Traitement des signalements et escalade fraude/spam.'),
  ('consumer_mediation','Médiation consommation','Médiation de la consommation','conditional','current',NULL,'Code de la consommation','Évaluation et preuve du dispositif de médiation lorsque applicable.'),
  ('acpr_dsp2_scope','ACPR','Périmètre services de paiement / DSP2','conditional','current',NULL,'Code monétaire et financier / DSP2','Évaluation de l’applicabilité lorsqu’un service entre dans le champ des services de paiement.')
ON CONFLICT(framework_key) DO NOTHING;

CREATE TABLE sva_ecosystem_control_catalog (
  control_key text PRIMARY KEY,
  framework_key text NOT NULL REFERENCES regulatory_framework_registry(framework_key),
  label text NOT NULL,
  required_for_activation boolean NOT NULL DEFAULT true,
  allow_not_applicable boolean NOT NULL DEFAULT false,
  default_review_days integer CHECK (default_review_days IS NULL OR default_review_days BETWEEN 1 AND 3650),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sva_ecosystem_control_catalog(
  control_key,framework_key,label,required_for_activation,allow_not_applicable,default_review_days,description
) VALUES
  ('rsva_identity_complete','apnf_rsva','Identité éditeur et service RSVA complète',true,false,365,'Les champs permettant d’identifier le service, son fournisseur et le contact de réclamation sont documentés.'),
  ('rsva_tariff_complete','apnf_rsva','Tarif RSVA cohérent',true,false,90,'Le tarif déclaré est cohérent avec le palier et la tarification commercialisée.'),
  ('rsva_directory_history','apnf_rsva','Historique annuaire SVA disponible',true,false,365,'La gouvernance prévoit la disponibilité des informations consommateur pendant la durée réglementaire applicable.'),
  ('rsva_tariff_change_governance','apnf_rsva','Changements tarifaires RSVA gouvernés',true,false,90,'Les changements sont planifiés au premier jour du mois et suffisamment en amont de leur date d’effet.'),
  ('af2m_2026_flowdown','af2m_sva_2026','Référentiel AF2M 2026 répercuté',true,false,365,'Les obligations déontologiques applicables sont répercutées dans les relations contractuelles pertinentes.'),
  ('af2m_tariff_caps','af2m_sva_2026','Plafonds tarifaires et durée contrôlés',true,false,90,'Les plafonds par appel, durée et cumul mensuel sont contrôlés selon le profil du service.'),
  ('af2m_mgit_spec','af2m_sva_2026','MGIT conforme au profil du service',true,true,90,'Le contenu, la durée, l’ordre de l’information et le bip avant facturation sont vérifiés lorsque le MGIT est applicable.'),
  ('af2m_signaletic','af2m_sva_2026','Signalétique SVA cohérente',true,false,180,'La signalétique utilisée correspond au modèle tarifaire déclaré.'),
  ('af2m_unfair_practices','af2m_sva_2026','Prévention des pratiques déloyales',true,false,90,'Le service et sa promotion interdisent notamment les mécanismes incitant abusivement au rappel d’un numéro majoré.'),
  ('af2m_service_classification','af2m_sva_2026','Catégorie de service qualifiée',true,false,180,'La catégorie et les règles sectorielles applicables au service sont déterminées.'),
  ('consumer_price_transparency','dgccrf_consumer','Information tarifaire consommateur',true,false,90,'Le prix et le mode de facturation sont présentés de façon claire et cohérente sur les parcours concernés.'),
  ('consumer_complaint_handling','dgccrf_consumer','Réclamations consommateur',true,false,90,'Le consommateur dispose d’un contact et d’un processus de traitement des réclamations.'),
  ('consumer_post_contract_contact','dgccrf_consumer','Contact post-contractuel non surtaxé',true,true,180,'L’applicabilité de l’interdiction d’un numéro surtaxé pour le suivi d’un contrat ou une réclamation est évaluée et traitée.'),
  ('signalconso_response_process','dgccrf_consumer','Processus SignalConso / contrôle DGCCRF',false,true,180,'Un processus interne permet de traiter les signalements ou demandes de l’administration.'),
  ('privacy_notice','cnil_privacy','Information vie privée',true,false,365,'Une information claire décrit les traitements de données nécessaires au service.'),
  ('data_minimisation_retention','cnil_privacy','Minimisation et conservation',true,false,180,'Les données collectées et leurs durées de conservation sont limitées aux besoins documentés.'),
  ('data_subject_rights','cnil_privacy','Droits des personnes',true,false,365,'Un processus permet l’exercice des droits applicables.'),
  ('breach_notification_scope','cnil_privacy','Périmètre notification violation',true,true,180,'Le régime de notification des violations de données applicable à l’activité est déterminé.'),
  ('33700_escalation','af2m_33700','Traitement 33700',true,false,90,'Les signalements d’appels ou messages indésirables sont qualifiés, tracés et escaladés.'),
  ('consumer_mediation_scope_assessed','consumer_mediation','Médiation consommation évaluée',true,true,365,'L’obligation de médiation est évaluée et, lorsqu’elle s’applique, le dispositif est documenté.'),
  ('dsp2_scope_assessed','acpr_dsp2_scope','Périmètre DSP2 évalué',true,true,365,'Le risque d’entrer dans le champ des services de paiement est évalué avant commercialisation.')
ON CONFLICT(control_key) DO NOTHING;

CREATE TABLE sva_service_compliance_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  service_category text NOT NULL DEFAULT 'other'
    CHECK (service_category IN ('general','advice','connection','payment','stock_information','distance_selling','m2m','automated_content','classifieds','telephony','access_code','directory_assistance','user_matching','minors','other')),
  audience text NOT NULL DEFAULT 'consumer'
    CHECK (audience IN ('consumer','professional','mixed')),
  billing_mode text NOT NULL DEFAULT 'per_minute'
    CHECK (billing_mode IN ('free','normal','per_minute','per_call','mixed')),
  per_call_price_ttc numeric(12,4) CHECK (per_call_price_ttc IS NULL OR per_call_price_ttc>=0),
  max_billable_duration_seconds integer CHECK (max_billable_duration_seconds IS NULL OR max_billable_duration_seconds BETWEEN 1 AND 86400),
  monthly_user_cap_ttc numeric(12,2) NOT NULL DEFAULT 300 CHECK (monthly_user_cap_ttc>0),
  mgit_required boolean NOT NULL DEFAULT true,
  mgit_duration_seconds integer CHECK (mgit_duration_seconds IS NULL OR mgit_duration_seconds BETWEEN 1 AND 60),
  mgit_tariff_first boolean NOT NULL DEFAULT false,
  mgit_optout_instruction boolean NOT NULL DEFAULT false,
  mgit_no_background_music boolean NOT NULL DEFAULT false,
  mgit_beep_before_billing boolean NOT NULL DEFAULT false,
  privacy_notice_url text,
  consumer_contact text,
  mediation_reference text,
  af2m_reference_version text NOT NULL DEFAULT '2026-09-01',
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,sva_number_id),
  CHECK (per_call_price_ttc IS NULL OR per_call_price_ttc<=24),
  CHECK (monthly_user_cap_ttc<=300),
  CHECK (next_review_at IS NULL OR last_reviewed_at IS NULL OR next_review_at>=last_reviewed_at)
);

CREATE INDEX sva_service_compliance_profiles_review_idx
  ON sva_service_compliance_profiles(next_review_at)
  WHERE next_review_at IS NOT NULL;

CREATE TABLE sva_ecosystem_control_states (
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  control_key text NOT NULL REFERENCES sva_ecosystem_control_catalog(control_key),
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  evidence_reference text,
  evidence_event_hash char(64),
  reviewed_at timestamptz,
  valid_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,sva_number_id,control_key),
  CHECK (evidence_event_hash IS NULL OR evidence_event_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX sva_ecosystem_control_states_status_idx
  ON sva_ecosystem_control_states(status,control_key,updated_at DESC);

CREATE TABLE sva_ecosystem_evidence_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  control_key text NOT NULL REFERENCES sva_ecosystem_control_catalog(control_key),
  status text NOT NULL
    CHECK (status IN ('not_started','pending','verified','failed','expired','not_applicable')),
  source text NOT NULL DEFAULT 'internal'
    CHECK (source IN ('internal','customer','operator','apnf_rsva','af2m','arcep','dgccrf','cnil','33700','mediator','acpr','other')),
  evidence_reference text,
  valid_until timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash char(64),
  event_hash char(64) NOT NULL,
  actor_subject text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_hash IS NULL OR previous_hash ~ '^[0-9a-f]{64}$'),
  CHECK (event_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX sva_ecosystem_evidence_number_idx
  ON sva_ecosystem_evidence_events(tenant_id,sva_number_id,id DESC);
CREATE INDEX sva_ecosystem_evidence_control_idx
  ON sva_ecosystem_evidence_events(control_key,status,occurred_at DESC);

CREATE FUNCTION pgi_sva_ecosystem_evidence_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_previous char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(970450000000 + NEW.sva_number_id);
  SELECT event_hash INTO v_previous
  FROM sva_ecosystem_evidence_events
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
      COALESCE(NEW.valid_until::text,''),
      NEW.metadata::text,
      COALESCE(v_previous,''),
      NEW.occurred_at::text
    ),
    'sha256'
  ),'hex');
  RETURN NEW;
END;
$$;

CREATE TRIGGER sva_ecosystem_evidence_hash_chain
BEFORE INSERT ON sva_ecosystem_evidence_events
FOR EACH ROW EXECUTE FUNCTION pgi_sva_ecosystem_evidence_hash_chain();

CREATE FUNCTION pgi_sva_ecosystem_evidence_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'SVA ecosystem evidence ledger is append-only';
END;
$$;

CREATE TRIGGER sva_ecosystem_evidence_no_mutation
BEFORE UPDATE OR DELETE ON sva_ecosystem_evidence_events
FOR EACH ROW EXECUTE FUNCTION pgi_sva_ecosystem_evidence_immutable();

CREATE FUNCTION pgi_apply_sva_ecosystem_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO sva_ecosystem_control_states(
    tenant_id,sva_number_id,control_key,status,evidence_reference,evidence_event_hash,reviewed_at,valid_until,updated_at
  ) VALUES(
    NEW.tenant_id,NEW.sva_number_id,NEW.control_key,NEW.status,NEW.evidence_reference,NEW.event_hash,NEW.occurred_at,NEW.valid_until,now()
  )
  ON CONFLICT(tenant_id,sva_number_id,control_key) DO UPDATE SET
    status=EXCLUDED.status,
    evidence_reference=EXCLUDED.evidence_reference,
    evidence_event_hash=EXCLUDED.evidence_event_hash,
    reviewed_at=EXCLUDED.reviewed_at,
    valid_until=EXCLUDED.valid_until,
    updated_at=now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sva_ecosystem_evidence_apply
AFTER INSERT ON sva_ecosystem_evidence_events
FOR EACH ROW EXECUTE FUNCTION pgi_apply_sva_ecosystem_evidence();

CREATE TABLE sva_tariff_change_plans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id) ON DELETE CASCADE,
  current_tariff_code text,
  proposed_tariff_code text NOT NULL,
  proposed_service_rate_ttc_per_min numeric(12,4) CHECK (proposed_service_rate_ttc_per_min IS NULL OR proposed_service_rate_ttc_per_min>=0),
  proposed_service_price_ttc_per_call numeric(12,4) CHECK (proposed_service_price_ttc_per_call IS NULL OR proposed_service_price_ttc_per_call BETWEEN 0 AND 24),
  effective_on date NOT NULL,
  declaration_due_at date GENERATED ALWAYS AS (effective_on-7) STORED,
  status text NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','declared','confirmed','cancelled')),
  rsva_reference text,
  requested_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  declared_at timestamptz,
  confirmed_at timestamptz,
  notes text,
  CHECK (extract(day FROM effective_on)=1),
  CHECK (created_at::date<=effective_on-7)
);

CREATE INDEX sva_tariff_change_plans_number_idx
  ON sva_tariff_change_plans(tenant_id,sva_number_id,effective_on DESC,id DESC);

CREATE FUNCTION pgi_sva_ecosystem_ready(p_tenant_id bigint,p_sva_number_id bigint)
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
    ) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM sva_service_compliance_profiles p
      JOIN sva_numbers n ON n.id=p.sva_number_id
      WHERE p.tenant_id=p_tenant_id
        AND p.sva_number_id=p_sva_number_id
        AND p.af2m_reference_version='2026-09-01'
        AND nullif(btrim(p.service_category),'') IS NOT NULL
        AND nullif(btrim(p.audience),'') IS NOT NULL
        AND nullif(btrim(p.billing_mode),'') IS NOT NULL
        AND p.monthly_user_cap_ttc<=300
        AND (p.per_call_price_ttc IS NULL OR p.per_call_price_ttc<=24)
        AND (
          COALESCE(n.service_rate_ttc_per_min,0)<=0.20
          OR (p.max_billable_duration_seconds IS NOT NULL AND p.max_billable_duration_seconds<=1800)
        )
        AND (
          NOT p.mgit_required
          OR (
            p.mgit_duration_seconds BETWEEN 10 AND 20
            AND p.mgit_tariff_first
            AND p.mgit_optout_instruction
            AND p.mgit_no_background_music
            AND p.mgit_beep_before_billing
          )
        )
        AND (p.next_review_at IS NULL OR p.next_review_at>now())
        AND NOT EXISTS (
          SELECT 1
          FROM sva_ecosystem_control_catalog c
          LEFT JOIN sva_ecosystem_control_states s
            ON s.tenant_id=p.tenant_id
           AND s.sva_number_id=p.sva_number_id
           AND s.control_key=c.control_key
          WHERE c.required_for_activation
            AND (
              s.control_key IS NULL
              OR s.status NOT IN ('verified','not_applicable')
              OR (s.status='not_applicable' AND NOT c.allow_not_applicable)
              OR (s.valid_until IS NOT NULL AND s.valid_until<=now())
            )
        )
    )
  END
$$;

CREATE FUNCTION pgi_require_sva_ecosystem_ready_for_active_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_internal boolean;
  v_is_fr boolean;
BEGIN
  IF NEW.status<>'active' THEN
    RETURN NEW;
  END IF;

  SELECT tenant_type='internal' INTO v_internal
  FROM tenants WHERE id=NEW.tenant_id;

  IF COALESCE(v_internal,false) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(m.country_code,'FR')='FR'
  INTO v_is_fr
  FROM sva_numbers n
  LEFT JOIN operating_markets m ON m.id=n.market_id
  WHERE n.id=NEW.sva_number_id;

  IF NOT COALESCE(v_is_fr,false) THEN
    RETURN NEW;
  END IF;

  IF NOT pgi_sva_ecosystem_ready(NEW.tenant_id,NEW.sva_number_id) THEN
    RAISE EXCEPTION 'verified SVA ecosystem readiness required before external French SVA activation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER zzzzz_tenant_number_assignments_sva_ecosystem_gate
BEFORE INSERT OR UPDATE OF status,tenant_id,sva_number_id
ON tenant_number_assignments
FOR EACH ROW
WHEN (NEW.status='active')
EXECUTE FUNCTION pgi_require_sva_ecosystem_ready_for_active_assignment();

INSERT INTO sva_service_compliance_profiles(tenant_id,sva_number_id)
SELECT DISTINCT a.tenant_id,a.sva_number_id
FROM tenant_number_assignments a
JOIN tenants t ON t.id=a.tenant_id
JOIN sva_numbers n ON n.id=a.sva_number_id
LEFT JOIN operating_markets m ON m.id=n.market_id
WHERE t.tenant_type<>'internal'
  AND COALESCE(m.country_code,'FR')='FR'
ON CONFLICT(tenant_id,sva_number_id) DO NOTHING;

CREATE VIEW sva_ecosystem_assignment_readiness AS
SELECT
  a.id AS assignment_id,
  a.tenant_id,
  a.sva_number_id,
  n.e164,
  a.status AS assignment_status,
  p.service_category,
  p.audience,
  p.billing_mode,
  p.mgit_required,
  p.af2m_reference_version,
  p.next_review_at,
  pgi_sva_ecosystem_ready(a.tenant_id,a.sva_number_id) AS ecosystem_ready
FROM tenant_number_assignments a
JOIN sva_numbers n ON n.id=a.sva_number_id
LEFT JOIN operating_markets m ON m.id=n.market_id
LEFT JOIN sva_service_compliance_profiles p
  ON p.tenant_id=a.tenant_id AND p.sva_number_id=a.sva_number_id
WHERE COALESCE(m.country_code,'FR')='FR';

COMMENT ON TABLE regulatory_framework_registry IS
'Reference registry for SVA-related authorities and industry frameworks. Presence does not imply certification, membership or approval.';
COMMENT ON TABLE sva_ecosystem_control_catalog IS
'Versioned SVA compliance control catalogue spanning RSVA, AF2M 2026, consumer protection, privacy and conditional frameworks.';
COMMENT ON TABLE sva_service_compliance_profiles IS
'Per-number SVA commercial/compliance profile used by technical activation readiness. It is not a legal certification.';
COMMENT ON TABLE sva_ecosystem_evidence_events IS
'Append-only SHA-256 evidence chain for SVA ecosystem controls. External connections are not implied.';
COMMENT ON TABLE sva_tariff_change_plans IS
'Planning ledger for SVA tariff changes. It validates calendar/lead-time rules locally but does not declare anything to RSVA.';
COMMENT ON VIEW sva_ecosystem_assignment_readiness IS
'Technical SVA ecosystem readiness. A true value is not an ARCEP, AF2M, APNF, DGCCRF or CNIL approval.';

COMMIT;
