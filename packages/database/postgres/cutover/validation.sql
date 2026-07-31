\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
\set QUIET 1

SELECT 'server_version', current_setting('server_version');
SELECT 'database', current_database();

SELECT
  'extension',
  extension_name,
  coalesce(installed_version, 'not-installed'),
  coalesce(installed_schema, 'not-installed')
FROM (
  VALUES
    ('btree_gist'),
    ('pg_trgm'),
    ('pgcrypto'),
    ('unaccent'),
    ('vector')
) required(extension_name)
LEFT JOIN pg_available_extensions extension
  ON extension.name = required.extension_name
LEFT JOIN (
  SELECT
    installed.extname,
    namespace.nspname AS installed_schema
  FROM pg_extension installed
  JOIN pg_namespace namespace
    ON namespace.oid = installed.extnamespace
) installed
  ON installed.extname = required.extension_name
ORDER BY extension_name;

SELECT
  'required_role',
  required.role_name,
  coalesce(role_record.rolcanlogin::text, 'missing'),
  coalesce(role_record.rolbypassrls::text, 'missing')
FROM (
  VALUES
    ('anonymous'),
    ('authenticated'),
    ('openexpert_auth'),
    ('openexpert_service')
) required(role_name)
LEFT JOIN pg_roles role_record
  ON role_record.rolname = required.role_name
ORDER BY required.role_name;

SELECT
  'required_function_missing',
  required.function_name
FROM (
  VALUES
    ('app.current_user_id()'),
    ('app.request_jwt_subject()'),
    ('app.set_request_context(uuid)'),
    ('auth.user_id()'),
    ('app.storage_folder_segments(text)')
) required(function_name)
WHERE to_regprocedure(required.function_name) IS NULL
ORDER BY required.function_name;

SELECT 'unsafe_context_setter_grant', 'authenticated'
WHERE has_function_privilege(
  'authenticated',
  'app.set_request_context(uuid)',
  'EXECUTE'
);

SELECT 'unexpected_auth_table', table_name
FROM information_schema.tables
WHERE table_schema = 'auth'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

BEGIN;

CREATE TEMP TABLE openexpert_validation_counts (
  schema_name text NOT NULL,
  table_name text NOT NULL,
  row_count bigint NOT NULL
) ON COMMIT DROP;

SELECT format(
  'INSERT INTO openexpert_validation_counts '
  || 'SELECT %L, %L, count(*) FROM %I.%I;',
  table_schema,
  table_name,
  table_schema,
  table_name
)
FROM information_schema.tables
WHERE table_schema IN ('identity', 'private', 'public')
  AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name
\gexec

SELECT 'row_count', schema_name, table_name, row_count
FROM openexpert_validation_counts
ORDER BY schema_name, table_name;

SELECT
  'rls_disabled',
  schemaname,
  tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND NOT rowsecurity
ORDER BY tablename;

SELECT
  'openexpert_service_policy_missing',
  namespace.nspname,
  relation.relname
FROM pg_class relation
JOIN pg_namespace namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p')
  AND relation.relrowsecurity
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy policy
    WHERE policy.polrelid = relation.oid
      AND policy.polname = 'openexpert_service_all'
  )
ORDER BY relation.relname;

SELECT
  'invalid_constraint',
  namespace.nspname,
  relation.relname,
  constraint_record.conname
FROM pg_constraint constraint_record
JOIN pg_class relation
  ON relation.oid = constraint_record.conrelid
JOIN pg_namespace namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname IN ('identity', 'private', 'public')
  AND NOT constraint_record.convalidated
ORDER BY namespace.nspname, relation.relname, constraint_record.conname;

COMMIT;
