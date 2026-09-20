-- Audiotel Premium Pro — extend immutable Evidence Pack registry with ARCEP 2026 chain metadata.
-- Expand-only. Historical exports remain valid and keep NULL in the new columns.

ALTER TABLE sva_regulatory_evidence_pack_exports
  ADD COLUMN arcep_2026_chain_head char(64),
  ADD COLUMN arcep_2026_links_valid boolean,
  ADD COLUMN arcep_2026_evidence_events integer;

ALTER TABLE sva_regulatory_evidence_pack_exports
  ADD CONSTRAINT sva_regulatory_evidence_pack_exports_arcep_head_chk
    CHECK (arcep_2026_chain_head IS NULL OR arcep_2026_chain_head ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT sva_regulatory_evidence_pack_exports_arcep_events_chk
    CHECK (arcep_2026_evidence_events IS NULL OR arcep_2026_evidence_events >= 0);

COMMENT ON COLUMN sva_regulatory_evidence_pack_exports.arcep_2026_chain_head IS
'SHA-256 head of the dedicated ARCEP 2026 evidence chain at export time.';
COMMENT ON COLUMN sva_regulatory_evidence_pack_exports.arcep_2026_links_valid IS
'Continuity result for the dedicated ARCEP 2026 evidence chain at export time.';
COMMENT ON COLUMN sva_regulatory_evidence_pack_exports.arcep_2026_evidence_events IS
'Number of ARCEP 2026 evidence events included in the Evidence Pack.';
