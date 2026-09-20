-- Audiotel Premium Pro — subscription price update to 3.00 EUR/month.
-- Historical 2.00 EUR price versions remain immutable and auditable.

DO $$
DECLARE
  v_plan_id bigint;
  v_current_amount bigint;
  v_price_id bigint;
BEGIN
  SELECT id INTO v_plan_id
  FROM service_plans
  WHERE plan_key='external-sva-access' AND status='active'
  FOR UPDATE;

  IF v_plan_id IS NULL THEN
    RAISE EXCEPTION 'active service plan not found: external-sva-access';
  END IF;

  SELECT amount_minor INTO v_current_amount
  FROM service_plan_price_versions
  WHERE service_plan_id=v_plan_id
    AND market_id IS NULL
    AND currency='EUR'
    AND effective_from<='2026-09-20T19:33:00Z'::timestamptz
    AND (effective_to IS NULL OR effective_to>'2026-09-20T19:33:00Z'::timestamptz)
  ORDER BY effective_from DESC
  LIMIT 1;

  IF COALESCE(v_current_amount,0)<>300 THEN
    SELECT pgi_publish_service_plan_price(
      'external-sva-access',
      'EUR',
      300,
      '2026-09-20T19:33:00Z'::timestamptz,
      NULL,
      NULL,
      NULL,
      NULL
    ) INTO v_price_id;

    UPDATE service_plan_price_versions
    SET metadata=metadata||'{"price_policy":"current_reference","display_amount":"3.00 EUR/month","changed_on":"2026-09-20"}'::jsonb
    WHERE id=v_price_id;
  END IF;
END;
$$;
