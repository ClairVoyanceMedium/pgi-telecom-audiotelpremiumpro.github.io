-- PGI Telecom Distribution: future distributor business-unit label only.
-- No edit to Audiotel Premium Pro, billing, customer numbers, or operations.
-- This additive presentation change affects only the direct_sva cost centre.
-- Commercial operation stays blocked by the existing database constraints.

UPDATE pgi_company_business_units
 SET display_name='PGI Telecom Distribution'
 WHERE unit_code='direct_sva'
   AND lifecycle_status='preparation'
   AND display_name IS DISTINCT FROM 'PGI Telecom Distribution';
