-- Expert accounting layer for PGI Telecom.
-- Keeps source-driven staging separate from validated statutory accounting.

CREATE TABLE IF NOT EXISTS platform_accounting_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  legal_name text,
  siren text,
  fiscal_year_close_month smallint NOT NULL DEFAULT 12 CHECK (fiscal_year_close_month BETWEEN 1 AND 12),
  fiscal_year_close_day smallint NOT NULL DEFAULT 31 CHECK (fiscal_year_close_day BETWEEN 1 AND 31),
  default_currency char(3) NOT NULL DEFAULT 'EUR',
  vat_regime text NOT NULL DEFAULT 'unconfigured'
    CHECK (vat_regime IN ('unconfigured','normal','simplified','franchise','exempt')),
  vat_rate_bps integer CHECK (vat_rate_bps IS NULL OR vat_rate_bps BETWEEN 0 AND 10000),
  prices_include_vat boolean,
  account_map jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(account_map)='object'),
  fec_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES app_users(id)
);

INSERT INTO platform_accounting_settings(id)
VALUES(1)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS platform_accounting_accounts (
  account_num text PRIMARY KEY CHECK (account_num ~ '^[0-9]{3,12}$'),
  label text NOT NULL,
  account_class smallint GENERATED ALWAYS AS (substring(account_num,1,1)::smallint) STORED,
  active boolean NOT NULL DEFAULT true,
  suspense boolean NOT NULL DEFAULT false,
  expert_review_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_accounting_accounts(account_num,label,suspense,expert_review_required) VALUES
('401000','Fournisseurs',false,false),
('411000','Clients',false,false),
('445660','TVA déductible sur autres biens et services',false,true),
('445710','TVA collectée',false,true),
('467000','Autres comptes débiteurs ou créditeurs',false,true),
('467100','Parrainages à payer',false,true),
('471000','Compte d attente',true,true),
('471110','Encaissements Stripe à rapprocher',true,true),
('471120','Flux opérateurs à rapprocher',true,true),
('471210','Produits abonnements à qualifier',true,true),
('471220','Produits portabilité prioritaire à qualifier',true,true),
('471230','Commissions paiement CB à qualifier',true,true),
('471240','Marge SVA à qualifier',true,true),
('471310','Charges de parrainage à qualifier',true,true),
('512000','Banque',false,true),
('706000','Prestations de services',false,true)
ON CONFLICT(account_num) DO UPDATE SET label=EXCLUDED.label;

CREATE TABLE IF NOT EXISTS platform_accounting_journals (
  journal_code text PRIMARY KEY CHECK (journal_code ~ '^[A-Z0-9]{2,8}$'),
  label text NOT NULL,
  journal_type text NOT NULL CHECK (journal_type IN ('sales','purchases','bank','operations','opening')),
  active boolean NOT NULL DEFAULT true
);

INSERT INTO platform_accounting_journals(journal_code,label,journal_type) VALUES
('VE','Ventes','sales'),
('AC','Achats','purchases'),
('BQ','Banque','bank'),
('OD','Opérations diverses','operations'),
('AN','À nouveaux','opening')
ON CONFLICT(journal_code) DO UPDATE SET label=EXCLUDED.label,journal_type=EXCLUDED.journal_type;

CREATE TABLE IF NOT EXISTS platform_accounting_periods (
  period_key char(7) PRIMARY KEY CHECK (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','review','closed')),
  review_started_at timestamptz,
  closed_at timestamptz,
  closed_by bigint REFERENCES app_users(id),
  close_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform_accounting_period_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_key char(7) NOT NULL,
  previous_state text,
  new_state text NOT NULL CHECK (new_state IN ('open','review','closed')),
  reason text,
  actor_user_id bigint REFERENCES app_users(id),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_accounting_period_events_period_idx
  ON platform_accounting_period_events(period_key,occurred_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS platform_accounting_sequences (
  fiscal_year integer NOT NULL CHECK (fiscal_year BETWEEN 2000 AND 2200),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number>=1),
  PRIMARY KEY(fiscal_year)
);

CREATE TABLE IF NOT EXISTS platform_accounting_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  source_type text NOT NULL,
  source_key text NOT NULL UNIQUE,
  source_hash text NOT NULL,
  journal_code text NOT NULL REFERENCES platform_accounting_journals(journal_code),
  entry_number text UNIQUE,
  entry_date date NOT NULL,
  piece_ref text NOT NULL,
  piece_date date NOT NULL,
  label text NOT NULL,
  currency char(3) NOT NULL DEFAULT 'EUR',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','reversal')),
  expert_note text,
  source_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_payload)='object'),
  validated_at timestamptz,
  validated_by bigint REFERENCES app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='draft' AND entry_number IS NULL AND validated_at IS NULL) OR
         (status IN ('validated','reversal') AND entry_number IS NOT NULL AND validated_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS platform_accounting_entries_date_idx
  ON platform_accounting_entries(entry_date,id);
CREATE INDEX IF NOT EXISTS platform_accounting_entries_status_idx
  ON platform_accounting_entries(status,entry_date,id);

CREATE TABLE IF NOT EXISTS platform_accounting_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint NOT NULL REFERENCES platform_accounting_entries(id) ON DELETE CASCADE,
  line_no smallint NOT NULL CHECK (line_no BETWEEN 1 AND 99),
  account_num text NOT NULL REFERENCES platform_accounting_accounts(account_num),
  account_label text NOT NULL,
  auxiliary_num text,
  auxiliary_label text,
  line_label text NOT NULL,
  debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor>=0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor>=0),
  lettering text,
  lettering_date date,
  amount_currency_minor bigint,
  currency char(3) NOT NULL DEFAULT 'EUR',
  vat_code text,
  UNIQUE(entry_id,line_no),
  CHECK ((debit_minor>0 AND credit_minor=0) OR (credit_minor>0 AND debit_minor=0))
);

CREATE INDEX IF NOT EXISTS platform_accounting_lines_account_idx
  ON platform_accounting_lines(account_num,entry_id);

CREATE TABLE IF NOT EXISTS platform_bank_transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_key text NOT NULL UNIQUE,
  booked_at date NOT NULL,
  value_at date,
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'EUR',
  label text NOT NULL,
  counterparty text,
  source text NOT NULL DEFAULT 'import',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(raw_payload)='object'),
  reconciliation_state text NOT NULL DEFAULT 'unmatched'
    CHECK (reconciliation_state IN ('unmatched','matched','ignored')),
  matched_entry_id bigint REFERENCES platform_accounting_entries(id),
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS platform_bank_transactions_reconciliation_idx
  ON platform_bank_transactions(reconciliation_state,booked_at,id);

CREATE TABLE IF NOT EXISTS platform_accounting_documents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id bigint REFERENCES platform_accounting_entries(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_reference text NOT NULL,
  document_kind text NOT NULL,
  document_date date,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  storage_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_type,source_reference,document_kind)
);

CREATE FUNCTION pgi_accounting_entry_balanced(p_entry_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(sum(debit_minor),0)=COALESCE(sum(credit_minor),0)
     AND COALESCE(sum(debit_minor),0)>0
  FROM platform_accounting_lines
  WHERE entry_id=p_entry_id
$$;

CREATE FUNCTION pgi_accounting_require_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id bigint;
BEGIN
  v_entry_id=COALESCE(NEW.entry_id,OLD.entry_id);
  IF NOT pgi_accounting_entry_balanced(v_entry_id) THEN
    RAISE EXCEPTION 'ACCOUNTING_ENTRY_NOT_BALANCED:%',v_entry_id
      USING ERRCODE='23514';
  END IF;
  RETURN COALESCE(NEW,OLD);
END
$$;

CREATE CONSTRAINT TRIGGER platform_accounting_lines_balanced_ck
AFTER INSERT OR UPDATE OR DELETE ON platform_accounting_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pgi_accounting_require_balanced();

CREATE FUNCTION pgi_accounting_protect_validated()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  IF TG_TABLE_NAME='platform_accounting_entries' THEN
    IF OLD.status IN ('validated','reversal') THEN
      RAISE EXCEPTION 'ACCOUNTING_VALIDATED_ENTRY_IMMUTABLE:%',OLD.id
        USING ERRCODE='55000';
    END IF;
    RETURN COALESCE(NEW,OLD);
  END IF;
  SELECT status INTO v_status FROM platform_accounting_entries WHERE id=OLD.entry_id;
  IF v_status IN ('validated','reversal') THEN
    RAISE EXCEPTION 'ACCOUNTING_VALIDATED_LINES_IMMUTABLE:%',OLD.entry_id
      USING ERRCODE='55000';
  END IF;
  RETURN COALESCE(NEW,OLD);
END
$$;

CREATE TRIGGER platform_accounting_entries_immutable_trg
BEFORE UPDATE OR DELETE ON platform_accounting_entries
FOR EACH ROW EXECUTE FUNCTION pgi_accounting_protect_validated();

CREATE TRIGGER platform_accounting_lines_immutable_trg
BEFORE UPDATE OR DELETE ON platform_accounting_lines
FOR EACH ROW EXECUTE FUNCTION pgi_accounting_protect_validated();

CREATE FUNCTION pgi_accounting_guard_closed_period()
RETURNS trigger
LANGUAGE plpgsql
AS $accounting$
DECLARE
  v_state text;
  v_period char(7);
BEGIN
  v_period=to_char(NEW.entry_date,'YYYY-MM');
  SELECT state INTO v_state FROM platform_accounting_periods WHERE period_key=v_period;
  IF v_state='closed' THEN
    RAISE EXCEPTION 'ACCOUNTING_PERIOD_CLOSED:%',v_period
      USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END
$accounting$;

CREATE TRIGGER platform_accounting_entries_closed_period_trg
BEFORE INSERT OR UPDATE OF entry_date,status ON platform_accounting_entries
FOR EACH ROW EXECUTE FUNCTION pgi_accounting_guard_closed_period();

COMMENT ON TABLE platform_accounting_entries IS
'Expert-accounting ledger. Source-generated rows start as draft. Only reviewed, balanced and classified entries may be validated and exported as FEC.';
COMMENT ON TABLE platform_bank_transactions IS
'Bank feed/import staging for reconciliation. No transaction is assumed to be bank-settled without a bank source.';
COMMENT ON COLUMN platform_accounting_settings.fec_enabled IS
'Explicit gate. FEC export also requires legal identity, closed periods, no suspense lines and only validated entries.';
