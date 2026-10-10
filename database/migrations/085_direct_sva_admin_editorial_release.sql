-- The site owner, not a hard-coded assistant gate, decides when editorial
-- distribution pages go public from the authenticated administration cockpit.
-- Keep telecom provisioning, client portal and third-party money movement separate.
-- Existing published URLs must remain available when navigation is hidden.
ALTER TABLE direct_sva_website_visibility
 DROP CONSTRAINT IF EXISTS direct_sva_website_visibility_public_content_authorized_check;
ALTER TABLE direct_sva_website_visibility_audit
 DROP CONSTRAINT IF EXISTS direct_sva_website_visibility_audit_switch_name_check;
ALTER TABLE direct_sva_website_visibility_audit
 ADD CONSTRAINT direct_sva_website_visibility_audit_switch_name_check
 CHECK (switch_name IN ('navigation_enabled','public_content_authorized'));
