-- Security prototype only. NEVER place in database/migrations or apply on production.
-- Tested on a disposable Neon branch: br-young-thunder-autqs2g6.
-- THIS FILE MUST BE REVIEWED BEFORE ANY PROMOTION. The existing SQL application
-- owner has BYPASSRLS, so the app must use a separate non-bypass role.
-- Prerequisite: execute inside a DB transaction with
-- SET LOCAL pgi.isolated_rls_test = 'approved';
DO $$
BEGIN
 IF current_setting('pgi.isolated_rls_test',true) IS DISTINCT FROM 'approved'
 THEN RAISE EXCEPTION 'RLS prototype blocked outside isolated acceptance transaction'; END IF;
END $$;
CREATE ROLE pgi_dsva_tenant_reader NOLOGIN NOBYPASSRLS;
GRANT pgi_dsva_tenant_reader TO pgi_telecom_owner;
GRANT USAGE ON SCHEMA public TO pgi_dsva_tenant_reader;
GRANT SELECT ON direct_sva_customer_accounts,direct_sva_customer_cases,direct_sva_number_inventory TO pgi_dsva_tenant_reader;
ALTER TABLE direct_sva_customer_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_sva_customer_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY dsva_tenant_account_select ON direct_sva_customer_accounts FOR SELECT TO pgi_dsva_tenant_reader
 USING(tenant_id = nullif(current_setting('app.pgi_dsva_tenant_id',true),'')::bigint AND business_unit='direct_sva');
ALTER TABLE direct_sva_customer_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_sva_customer_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY dsva_tenant_cases_select ON direct_sva_customer_cases FOR SELECT TO pgi_dsva_tenant_reader
 USING(tenant_id = nullif(current_setting('app.pgi_dsva_tenant_id',true),'')::bigint);
ALTER TABLE direct_sva_number_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE direct_sva_number_inventory FORCE ROW LEVEL SECURITY;
CREATE POLICY dsva_tenant_numbers_select ON direct_sva_number_inventory FOR SELECT TO pgi_dsva_tenant_reader
 USING(editor_tenant_id = nullif(current_setting('app.pgi_dsva_tenant_id',true),'')::bigint);
-- All tenant-scoped reads require transaction-bound SET LOCAL ROLE
-- pgi_dsva_tenant_reader and SET LOCAL app.pgi_dsva_tenant_id='101'.
-- No SELECT on direct_sva_journal_entries/lines is granted. Future finance
-- access must use distinct reviewed privileges and business-unit predicates.
-- No caller can set a client tenant id from an unverified HTTP parameter.
-- When read replicas are involved, verify transaction and role semantics.
