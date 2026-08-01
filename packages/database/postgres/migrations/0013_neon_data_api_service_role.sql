-- Allow Neon Data API to assume the privileged backend role carried by
-- server-issued JWTs. Neon owns the authenticator role, so keep this grant
-- conditional for local or pre-Data-API database branches.
DO $grant_neon_data_api_service_role$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    GRANT openexpert_service TO authenticator;
  END IF;
END
$grant_neon_data_api_service_role$;
