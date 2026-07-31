#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${OPENEXPERT_ADMIN_PASSWORD:?OPENEXPERT_ADMIN_PASSWORD is required}"
: "${OPENEXPERT_AUTH_PASSWORD:?OPENEXPERT_AUTH_PASSWORD is required}"
: "${OPENEXPERT_AUTHENTICATOR_PASSWORD:?OPENEXPERT_AUTHENTICATOR_PASSWORD is required}"
: "${OPENEXPERT_RUNTIME_PASSWORD:?OPENEXPERT_RUNTIME_PASSWORD is required}"

psql \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set ON_ERROR_STOP=1 \
  --set database_name="$POSTGRES_DB" \
  --set admin_password="$OPENEXPERT_ADMIN_PASSWORD" \
  --set auth_password="$OPENEXPERT_AUTH_PASSWORD" \
  --set authenticator_password="$OPENEXPERT_AUTHENTICATOR_PASSWORD" \
  --set runtime_password="$OPENEXPERT_RUNTIME_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE openexpert_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openexpert_owner')
\gexec

SELECT 'CREATE ROLE openexpert_admin LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openexpert_admin')
\gexec

SELECT 'CREATE ROLE anonymous NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anonymous')
\gexec

SELECT 'CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated')
\gexec

SELECT 'CREATE ROLE openexpert_service NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openexpert_service')
\gexec

SELECT 'CREATE ROLE openexpert_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openexpert_runtime')
\gexec

SELECT 'CREATE ROLE openexpert_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'openexpert_auth')
\gexec

SELECT 'CREATE ROLE authenticator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator')
\gexec

ALTER ROLE openexpert_owner NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE openexpert_admin LOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE anonymous NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE authenticated NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE openexpert_service NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE openexpert_runtime LOGIN INHERIT NOBYPASSRLS;
ALTER ROLE openexpert_auth LOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE authenticator LOGIN NOINHERIT NOBYPASSRLS;

SELECT format('ALTER ROLE openexpert_admin PASSWORD %L', :'admin_password')
\gexec
SELECT format('ALTER ROLE openexpert_runtime PASSWORD %L', :'runtime_password')
\gexec
SELECT format('ALTER ROLE openexpert_auth PASSWORD %L', :'auth_password')
\gexec
SELECT format('ALTER ROLE authenticator PASSWORD %L', :'authenticator_password')
\gexec

GRANT openexpert_owner TO openexpert_admin;
GRANT authenticated TO openexpert_runtime;
GRANT anonymous, authenticated, openexpert_service TO authenticator;

ALTER DATABASE :"database_name" OWNER TO openexpert_owner;
REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"database_name"
  TO openexpert_owner, openexpert_admin, openexpert_auth, openexpert_runtime, authenticator;

ALTER ROLE openexpert_admin SET search_path = public, extensions;
ALTER ROLE openexpert_auth SET search_path = identity, public;
ALTER ROLE openexpert_runtime SET search_path = public, extensions;
ALTER ROLE authenticator SET search_path = public, extensions;

SET ROLE openexpert_owner;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION openexpert_owner;
CREATE SCHEMA IF NOT EXISTS app_migrations AUTHORIZATION openexpert_owner;
CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION openexpert_owner;
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION openexpert_owner;
CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION openexpert_owner;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA app, app_migrations, auth, identity FROM PUBLIC;
GRANT USAGE ON SCHEMA public, auth
  TO anonymous, authenticated, openexpert_service;
GRANT USAGE ON SCHEMA app
  TO anonymous, authenticated, openexpert_service;
GRANT USAGE ON SCHEMA identity
  TO openexpert_auth, openexpert_service;

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
  candidate := nullif(current_setting('request.jwt.claim.sub', true), '');

  IF candidate IS NULL THEN
    jwt_claims := nullif(current_setting('request.jwt.claims', true), '');
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

CREATE OR REPLACE FUNCTION auth.user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS 'SELECT app.request_jwt_subject()';

CREATE OR REPLACE FUNCTION app.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT nullif(auth.user_id()::text, '')::uuid
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

CREATE TABLE IF NOT EXISTS app_migrations.schema_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  applied_at timestamp with time zone NOT NULL DEFAULT now()
);

REVOKE ALL ON ALL TABLES IN SCHEMA app, app_migrations, identity FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app, auth FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_jwt_subject()
  TO anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION app.current_user_id()
  TO anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION app.set_request_context(uuid)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION app.storage_folder_segments(text)
  TO anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION auth.user_id()
  TO anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity.users
  TO openexpert_auth, openexpert_service;

ALTER DEFAULT PRIVILEGES FOR ROLE openexpert_owner
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE openexpert_owner
  REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE openexpert_owner
  REVOKE ALL ON SEQUENCES FROM PUBLIC;

RESET ROLE;

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

REVOKE CREATE ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions
  TO anonymous, authenticated, openexpert_service;
SQL
