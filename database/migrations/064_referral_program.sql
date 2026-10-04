-- PGI Telecom — referral program with reversible commercial activation.
-- Expand-only. Historical referrals are preserved when the program is disabled.

CREATE TABLE referral_program_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled boolean NOT NULL DEFAULT false,
  reward_kind text NOT NULL DEFAULT 'subscription_benefit'
    CHECK (reward_kind IN ('subscription_benefit')),
  reward_policy_status text NOT NULL DEFAULT 'unconfigured'
    CHECK (reward_policy_status IN ('unconfigured','configured','retired')),
  updated_by_staff_user_id bigint REFERENCES staff_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO referral_program_settings(singleton,enabled,reward_kind,reward_policy_status)
VALUES(true,false,'subscription_benefit','unconfigured');

CREATE TABLE tenant_referral_codes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{12}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_referral_codes_code_idx
  ON tenant_referral_codes(code);

CREATE TABLE tenant_referrals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_tenant_id bigint NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  referred_tenant_id bigint NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE RESTRICT,
  referral_code_id bigint NOT NULL REFERENCES tenant_referral_codes(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'attributed'
    CHECK (status IN ('attributed','qualified','cancelled')),
  reward_status text NOT NULL DEFAULT 'pending_qualification'
    CHECK (reward_status IN ('pending_qualification','pending_policy','granted','cancelled')),
  attributed_at timestamptz NOT NULL DEFAULT now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (referrer_tenant_id <> referred_tenant_id),
  CHECK ((status='qualified') = (qualified_at IS NOT NULL))
);

CREATE INDEX tenant_referrals_referrer_idx
  ON tenant_referrals(referrer_tenant_id,status,attributed_at DESC,id DESC);
CREATE INDEX tenant_referrals_status_idx
  ON tenant_referrals(status,reward_status,attributed_at DESC,id DESC);

CREATE FUNCTION pgi_qualify_referral_when_tenant_activates()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status='active' AND OLD.status IS DISTINCT FROM 'active' THEN
    UPDATE tenant_referrals
    SET
      status='qualified',
      reward_status=CASE
        WHEN reward_status='pending_qualification' THEN 'pending_policy'
        ELSE reward_status
      END,
      qualified_at=COALESCE(qualified_at,now())
    WHERE referred_tenant_id=NEW.id
      AND status='attributed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_referral_qualification
AFTER UPDATE OF status ON tenants
FOR EACH ROW
EXECUTE FUNCTION pgi_qualify_referral_when_tenant_activates();

COMMENT ON TABLE referral_program_settings IS
'Single authoritative switch for Audiotel Premium Pro referrals. Disabling blocks every new attribution without deleting historical codes or referrals.';
COMMENT ON COLUMN referral_program_settings.reward_policy_status IS
'Commercial reward policy readiness. unconfigured means qualified referrals remain pending and no financial or subscription benefit is granted automatically.';
COMMENT ON TABLE tenant_referrals IS
'Immutable attribution relationship between a referrer tenant and a referred tenant. Qualification occurs only when the referred tenant becomes active.';
