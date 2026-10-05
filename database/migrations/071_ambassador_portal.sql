-- Dedicated ambassador profiles for non-client referrers.
CREATE TABLE IF NOT EXISTS customer_ambassador_profiles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  public_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','active','suspended','rejected')),
  application_source text NOT NULL DEFAULT 'public_ambassador_form',
  contact_phone text,
  application_note text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  suspended_at timestamptz,
  rejected_at timestamptz,
  approved_by bigint REFERENCES app_users(id),
  status_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_ambassador_profiles_status_requested_idx
  ON customer_ambassador_profiles(status,requested_at DESC,id DESC);

CREATE INDEX IF NOT EXISTS customer_ambassador_profiles_public_idx
  ON customer_ambassador_profiles(public_id);

DO $pgi$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname='customer_ambassador_profiles_touch_updated'
      AND tgrelid='customer_ambassador_profiles'::regclass
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER customer_ambassador_profiles_touch_updated
    BEFORE UPDATE ON customer_ambassador_profiles
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  END IF;
END
$pgi$;

COMMENT ON TABLE customer_ambassador_profiles IS
  'Dedicated ambassador lifecycle. An active profile may refer without an Audiotel subscription.';
