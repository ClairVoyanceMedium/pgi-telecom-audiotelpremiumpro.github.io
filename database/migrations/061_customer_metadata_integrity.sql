BEGIN;

UPDATE customer_principals
SET metadata=jsonb_build_object('legacy_value',metadata),
    updated_at=now()
WHERE jsonb_typeof(metadata) IS DISTINCT FROM 'object';

ALTER TABLE customer_principals
  DROP CONSTRAINT IF EXISTS customer_principals_metadata_object_ck;

ALTER TABLE customer_principals
  ADD CONSTRAINT customer_principals_metadata_object_ck
  CHECK (jsonb_typeof(metadata)='object') NOT VALID;

ALTER TABLE customer_principals
  VALIDATE CONSTRAINT customer_principals_metadata_object_ck;

COMMIT;
