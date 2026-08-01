-- Consent compliance administrators manage consent definitions and their
-- audit trail. Approving execution grants for client anonymization is a
-- separate privacy responsibility and must not be inherited implicitly.

delete from public.administrative_role_permissions
where role_key = 'consents_admin'
  and permission_key = 'privacy.grants.approve';
