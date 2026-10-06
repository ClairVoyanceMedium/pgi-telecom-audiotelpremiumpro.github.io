-- Audiotel Premium Pro : legal corpus v5 service acceptance types.
-- Historical acceptance rows remain immutable. This migration only allows
-- new append-only evidence for the paid priority portability option.

ALTER TABLE customer_legal_acceptances
  DROP CONSTRAINT IF EXISTS customer_legal_acceptances_acceptance_type_check;

ALTER TABLE customer_legal_acceptances
  ADD CONSTRAINT customer_legal_acceptances_acceptance_type_check
  CHECK (acceptance_type IN (
    'account_terms',
    'subscription_checkout',
    'portability_priority_checkout'
  ));

COMMENT ON COLUMN customer_legal_acceptances.acceptance_type IS
'Append-only legal acceptance kind. Includes account terms, subscription checkout and priority portability checkout.';
