-- Direct SVA operator business unit: independent bookkeeping and operator inventory.
-- Additive only. No production routing, number activation, payment or existing journal writes.
-- These are business-unit subledger records, not automatically statutory FEC entries.

CREATE TABLE IF NOT EXISTS direct_sva_operator_controls (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  operator_mode text NOT NULL DEFAULT 'preparation'
    CHECK (operator_mode='preparation'),
  number_activation_enabled boolean NOT NULL DEFAULT false CHECK (number_activation_enabled=false),
  payouts_enabled boolean NOT NULL DEFAULT false CHECK (payouts_enabled=false),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO direct_sva_operator_controls(id) VALUES(1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS direct_sva_number_blocks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  block_prefix text NOT NULL UNIQUE CHECK (block_prefix ~ '^0(81|82|89)[0-9]{0,7}$'),
  country_code char(2) NOT NULL DEFAULT 'FR' CHECK (country_code='FR'),
  expected_capacity integer NOT NULL DEFAULT 1000 CHECK (expected_capacity BETWEEN 1 AND 100000),
  arcep_decision_reference text,
  allocation_status text NOT NULL DEFAULT 'planned'
    CHECK (allocation_status IN ('planned','submitted','granted','expired','revoked')),
  granted_at date,
  expires_at date,
  evidence_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (allocation_status<>'granted' OR
    (nullif(btrim(COALESCE(arcep_decision_reference,'')),'') IS NOT NULL
     AND granted_at IS NOT NULL AND nullif(btrim(COALESCE(evidence_reference,'')),'') IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS direct_sva_interconnections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_name text NOT NULL,
  contract_reference text UNIQUE,
  contract_status text NOT NULL DEFAULT 'planned'
    CHECK (contract_status IN ('planned','negotiating','signed','suspended','expired')),
  services jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(services)='object'),
  signed_at date,
  valid_until date,
  technical_acceptance_reference text,
  evidence_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (contract_status<>'signed' OR
    (nullif(btrim(COALESCE(contract_reference,'')),'') IS NOT NULL
     AND signed_at IS NOT NULL AND nullif(btrim(COALESCE(evidence_reference,'')),'') IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS direct_sva_number_inventory (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  block_id bigint NOT NULL REFERENCES direct_sva_number_blocks(id),
  e164 text NOT NULL UNIQUE CHECK (e164 ~ '^\+33(81|82|89)[0-9]{7}$'),
  editor_tenant_id bigint REFERENCES tenants(id),
  tariff_code text,
  regulatory_status text NOT NULL DEFAULT 'unverified'
    CHECK (regulatory_status IN ('unverified','under_review','verified','rejected','expired')),
  number_status text NOT NULL DEFAULT 'planned'
    CHECK (number_status IN ('planned','reserved','assigned','testing','active','suspended','released')),
  CHECK (number_status NOT IN ('assigned','testing','active')),
  portability_reference text,
  editor_contract_reference text,
  arcep_assignment_evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (number_status NOT IN ('assigned','testing','active') OR
    (editor_tenant_id IS NOT NULL AND regulatory_status='verified'
     AND nullif(btrim(COALESCE(editor_contract_reference,'')),'') IS NOT NULL
     AND nullif(btrim(COALESCE(arcep_assignment_evidence,'')),'') IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS direct_sva_inventory_tenant_idx
  ON direct_sva_number_inventory(editor_tenant_id,number_status);
CREATE INDEX IF NOT EXISTS direct_sva_inventory_block_idx
  ON direct_sva_number_inventory(block_id,number_status);

CREATE TABLE IF NOT EXISTS direct_sva_account_catalog (
  account_code text PRIMARY KEY CHECK (account_code ~ '^[0-9]{6}$'),
  account_label text NOT NULL,
  account_kind text NOT NULL CHECK (account_kind IN ('asset','liability','revenue','expense','suspense')),
  active boolean NOT NULL DEFAULT true,
  requires_expert_review boolean NOT NULL DEFAULT true
);
INSERT INTO direct_sva_account_catalog(account_code,account_label,account_kind) VALUES
 ('411100','Creances operateurs SVA directs','asset'),
 ('512100','Banque et tresorerie SVA directe','asset'),
 ('467200','Reversements dus aux editeurs SVA directs','liability'),
 ('471290','Flux SVA directs en attente de qualification','suspense'),
 ('706100','Produits du service SVA direct a qualifier','revenue'),
 ('622610','Charges de collecte et interconnexion','expense'),
 ('622620','Charges de transit, SIP et supervision','expense'),
 ('635810','Redevances de numerotation','expense'),
 ('658100','Corrections, impayes et fraude SVA','expense')
ON CONFLICT(account_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS direct_sva_accounting_periods (
  period_key char(7) PRIMARY KEY CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','review','closed')),
  closed_at timestamptz,
  closed_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS direct_sva_journal_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  business_unit text NOT NULL DEFAULT 'direct_sva' CHECK (business_unit='direct_sva'),
  source_system text NOT NULL CHECK (source_system ~ '^[a-z_]{3,40}$'),
  source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 6 AND 200),
  entry_date date NOT NULL,
  currency char(3) NOT NULL DEFAULT 'EUR' CHECK (currency='EUR'),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 6 AND 400),
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 6 AND 240),
  source_digest char(64) NOT NULL CHECK (source_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  created_by bigint NOT NULL REFERENCES app_users(id),
  approved_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  UNIQUE(source_system,source_reference),
  CHECK ((status='draft' AND posted_at IS NULL AND approved_by IS NULL)
    OR (status='posted' AND posted_at IS NOT NULL AND approved_by IS NOT NULL AND approved_by<>created_by))
);
CREATE INDEX IF NOT EXISTS direct_sva_journal_date_idx
 ON direct_sva_journal_entries(entry_date,status);
CREATE INDEX IF NOT EXISTS direct_sva_journal_status_idx
 ON direct_sva_journal_entries(status,created_at DESC);

CREATE TABLE IF NOT EXISTS direct_sva_journal_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES direct_sva_journal_entries(id),
  line_no smallint NOT NULL CHECK (line_no BETWEEN 1 AND 50),
  account_code text NOT NULL REFERENCES direct_sva_account_catalog(account_code),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 300),
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor>=0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor>=0),
  UNIQUE(entry_id,line_no),
  CHECK ((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
);
CREATE INDEX IF NOT EXISTS direct_sva_journal_lines_account_idx
 ON direct_sva_journal_lines(account_code,entry_id);

CREATE TABLE IF NOT EXISTS direct_sva_journal_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journal_entry_id bigint NOT NULL REFERENCES direct_sva_journal_entries(id),
  event text NOT NULL CHECK (event IN ('draft_created','posted')),
  actor_user_id bigint REFERENCES app_users(id),
  evidence_reference text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS direct_sva_journal_audit_entry_idx
 ON direct_sva_journal_audit(journal_entry_id,id DESC);

CREATE FUNCTION direct_sva_guard_posted_entry()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_count bigint;
  total_debit numeric;
  total_credit numeric;
  month_state text;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'direct SVA accounting entries cannot be deleted';
  END IF;
  IF OLD.status='posted' THEN
    RAISE EXCEPTION 'posted direct SVA accounting entries are immutable; use a reversal entry';
  END IF;
  IF NEW.business_unit<>'direct_sva' THEN
    RAISE EXCEPTION 'direct SVA journal cannot change business unit';
  END IF;
  IF NEW.status='posted' THEN
    SELECT COUNT(*),COALESCE(SUM(debit_minor),0),COALESCE(SUM(credit_minor),0)
      INTO line_count,total_debit,total_credit
      FROM direct_sva_journal_lines WHERE entry_id=OLD.id;
    IF line_count<2 OR total_debit<=0 OR total_debit<>total_credit THEN
      RAISE EXCEPTION 'direct SVA entry must have at least two balanced lines';
    END IF;
    SELECT state INTO month_state FROM direct_sva_accounting_periods
      WHERE period_key=to_char(NEW.entry_date,'YYYY-MM');
    IF month_state='closed' THEN
      RAISE EXCEPTION 'cannot post direct SVA accounting into a closed period';
    END IF;
    IF NEW.approved_by IS NULL OR NEW.approved_by=NEW.created_by OR NEW.posted_at IS NULL THEN
      RAISE EXCEPTION 'direct SVA maker-checker approval required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER direct_sva_guard_posted_entry
BEFORE UPDATE OR DELETE ON direct_sva_journal_entries
FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_posted_entry();

CREATE FUNCTION direct_sva_guard_posted_lines()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry_status text;
  target_id bigint;
BEGIN
  IF TG_OP='DELETE' THEN
    target_id:=OLD.entry_id;
  ELSE
    target_id:=NEW.entry_id;
  END IF;
  SELECT status INTO entry_status
    FROM direct_sva_journal_entries WHERE id=target_id FOR UPDATE;
  IF entry_status IS NULL OR entry_status='posted' THEN
    RAISE EXCEPTION 'direct SVA lines require an existing draft entry';
  END IF;
  IF TG_OP='UPDATE' AND OLD.entry_id<>NEW.entry_id THEN
    RAISE EXCEPTION 'cannot move direct SVA journal lines across entries';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER direct_sva_guard_posted_lines
BEFORE INSERT OR UPDATE OR DELETE ON direct_sva_journal_lines
FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_posted_lines();

CREATE FUNCTION direct_sva_guard_audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'direct SVA audit history is append-only';
END;
$$;
CREATE TRIGGER direct_sva_guard_audit_append_only
BEFORE UPDATE OR DELETE ON direct_sva_journal_audit
FOR EACH ROW EXECUTE FUNCTION direct_sva_guard_audit_append_only();
