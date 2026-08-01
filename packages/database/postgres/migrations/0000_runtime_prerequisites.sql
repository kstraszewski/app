-- Portable prerequisites shared by a fresh Neon branch and the local stack.
--
-- Neon Data API normally creates `anonymous` and `authenticated`. The
-- application-specific NOLOGIN roles keep authentication credentials and
-- privileged backend access isolated from public Data API roles. Production
-- operators provision LOGIN credentials for `openexpert_auth` separately.

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS identity;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anonymous') THEN
    EXECUTE 'CREATE ROLE anonymous NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openexpert_service') THEN
    EXECUTE 'CREATE ROLE openexpert_service NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'openexpert_auth') THEN
    EXECUTE 'CREATE ROLE openexpert_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  END IF;
END
$roles$;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

DO $extension_locations$
DECLARE
  misplaced text;
BEGIN
  SELECT string_agg(extension.extname, ', ' ORDER BY extension.extname)
  INTO misplaced
  FROM pg_extension extension
  JOIN pg_namespace namespace
    ON namespace.oid = extension.extnamespace
  WHERE extension.extname IN (
    'btree_gist',
    'pg_trgm',
    'pgcrypto',
    'unaccent',
    'vector'
  )
    AND namespace.nspname <> 'extensions';

  IF misplaced IS NOT NULL THEN
    RAISE EXCEPTION
      'Required extensions must be installed in schema extensions; misplaced: %',
      misplaced;
  END IF;
END
$extension_locations$;

-- Better Auth owns application identity data. The provider-owned `auth`
-- schema remains reserved for the RLS identity function supplied by Neon.
CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS identity_users_email_unique
  ON identity.users (lower(email));

CREATE OR REPLACE FUNCTION app.request_jwt_subject()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $function$
DECLARE
  candidate text;
  jwt_claims text;
BEGIN
  candidate := nullif(
    current_setting('request.jwt.claim.sub', true),
    ''
  );

  IF candidate IS NULL THEN
    jwt_claims := nullif(
      current_setting('request.jwt.claims', true),
      ''
    );
    IF jwt_claims IS NOT NULL THEN
      candidate := nullif(jwt_claims::jsonb ->> 'sub', '');
    END IF;
  END IF;

  candidate := coalesce(
    candidate,
    nullif(current_setting('app.user_id', true), '')
  );

  RETURN candidate::uuid;
END
$function$;

CREATE OR REPLACE FUNCTION app.set_request_context(user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $function$
BEGIN
  IF user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required' USING ERRCODE = '22004';
  END IF;

  PERFORM set_config('app.user_id', user_id::text, true);
END
$function$;

-- Neon Data API provides auth.user_id(). Native PostgREST does not, so the
-- local fallback reads the transaction-scoped JWT settings.
DO $identity_function$
BEGIN
  IF to_regprocedure('auth.user_id()') IS NULL THEN
    EXECUTE $definition$
      CREATE FUNCTION auth.user_id()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      SET search_path = ''
      AS $body$
        SELECT app.request_jwt_subject()
      $body$
    $definition$;
    EXECUTE 'REVOKE ALL ON FUNCTION auth.user_id() FROM PUBLIC';
    EXECUTE 'GRANT EXECUTE ON FUNCTION auth.user_id() TO anonymous, authenticated, openexpert_service';
  END IF;
END
$identity_function$;

-- Domain SQL depends only on application-owned functions. Data API and local
-- PostgREST both expose verified JWT claims through request.jwt.claims, so the
-- provider-managed auth schema does not need to be executable by API roles.
CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT app.request_jwt_subject()
$function$;

CREATE OR REPLACE FUNCTION app.storage_folder_segments(name text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  parts text[];
BEGIN
  SELECT string_to_array(name, '/') INTO parts;
  RETURN parts[1 : array_length(parts, 1) - 1];
END
$function$;

REVOKE ALL ON SCHEMA app, auth, identity FROM PUBLIC;
GRANT USAGE ON SCHEMA app, auth
  TO anonymous, authenticated, openexpert_service;
GRANT USAGE ON SCHEMA identity
  TO openexpert_auth, openexpert_service;
GRANT USAGE ON SCHEMA extensions
  TO anonymous, authenticated, openexpert_service;

REVOKE ALL ON FUNCTION app.request_jwt_subject() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.set_request_context(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.storage_folder_segments(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.request_jwt_subject()
  TO anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION app.current_user_id()
  TO anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION app.set_request_context(uuid)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION app.storage_folder_segments(text)
  TO anonymous, authenticated, openexpert_service;

REVOKE ALL ON TABLE identity.users
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.users
  TO openexpert_auth, openexpert_service;
