-- Audiotel Premium Pro — tax-inclusive subscription pricing.
-- Expand-only. The customer-facing subscription amount is gross/TTC.
-- No Stripe or PSP connection is activated by this migration.

ALTER TABLE service_plan_price_versions
  ADD COLUMN tax_behavior text NOT NULL DEFAULT 'inclusive'
    CHECK (tax_behavior IN ('inclusive','exclusive','unspecified'));

UPDATE service_plan_price_versions
SET metadata=metadata||jsonb_build_object(
  'tax_behavior','inclusive',
  'customer_price_basis','TTC',
  'display_amount',
    CASE
      WHEN currency='EUR' AND amount_minor=300 THEN '3.00 EUR TTC/month'
      ELSE COALESCE(metadata->>'display_amount',(amount_minor::numeric/100)::text||' '||currency||' TTC/'||billing_interval)
    END
)
WHERE tax_behavior='inclusive';

CREATE FUNCTION pgi_protect_service_plan_price_tax_behavior()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tax_behavior IS DISTINCT FROM OLD.tax_behavior THEN
    RAISE EXCEPTION 'subscription price tax behavior is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER service_plan_price_versions_tax_behavior_immutable
BEFORE UPDATE OF tax_behavior ON service_plan_price_versions
FOR EACH ROW
EXECUTE FUNCTION pgi_protect_service_plan_price_tax_behavior();

COMMENT ON COLUMN service_plan_price_versions.tax_behavior IS
'Customer-facing tax behavior. Audiotel Premium Pro prices are inclusive by default: amount_minor is the final TTC/gross subscription amount charged to the customer.';

COMMENT ON TABLE service_plan_price_versions IS
'Immutable subscription price versions. amount_minor is customer-facing; tax_behavior=inclusive means the displayed amount is TTC/gross and taxes are included in that amount when applicable.';
