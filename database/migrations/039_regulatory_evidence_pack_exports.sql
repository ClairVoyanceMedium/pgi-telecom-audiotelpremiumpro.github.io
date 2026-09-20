-- Audiotel Premium Pro — immutable Regulatory Evidence Pack export register.
-- Each generated pack receives a durable export identity and hash record.

CREATE TABLE sva_regulatory_evidence_pack_exports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL REFERENCES tenants(id),
  assignment_id bigint NOT NULL REFERENCES tenant_number_assignments(id),
  sva_number_id bigint NOT NULL REFERENCES sva_numbers(id),
  generated_at timestamptz NOT NULL,
  pack_sha256 char(64) NOT NULL CHECK (pack_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_chain_head char(64),
  evidence_links_valid boolean NOT NULL,
  evidence_events integer NOT NULL DEFAULT 0 CHECK (evidence_events >= 0),
  actor_subject text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (evidence_chain_head IS NULL OR evidence_chain_head ~ '^[0-9a-f]{64}$')
);

CREATE INDEX sva_regulatory_evidence_pack_exports_assignment_idx
  ON sva_regulatory_evidence_pack_exports(tenant_id,assignment_id,generated_at DESC,id DESC);
CREATE INDEX sva_regulatory_evidence_pack_exports_hash_idx
  ON sva_regulatory_evidence_pack_exports(pack_sha256);

CREATE FUNCTION pgi_regulatory_evidence_pack_export_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'regulatory evidence pack export register is append-only';
END;
$$;

CREATE TRIGGER sva_regulatory_evidence_pack_exports_no_mutation
BEFORE UPDATE OR DELETE ON sva_regulatory_evidence_pack_exports
FOR EACH ROW
EXECUTE FUNCTION pgi_regulatory_evidence_pack_export_immutable();

COMMENT ON TABLE sva_regulatory_evidence_pack_exports IS
'Append-only registry of generated regulatory Evidence Packs. Stores identity and hashes, not the exported document payload.';
