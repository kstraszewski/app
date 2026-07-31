-- Managed PostgreSQL providers do not always allow application operators to
-- create a BYPASSRLS role. Express the trusted server-only capability as
-- explicit policies for the application service role instead.
--
-- The Data API accepts this role only from a JWT signed by the private key
-- held by the Nuxt server. Table and function ACLs from 0002 still limit which
-- operations the role can perform.

DO $service_policies$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
    FROM pg_class relation
    JOIN pg_namespace namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
    ORDER BY relation.relname
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policy policy
      JOIN pg_class policy_relation
        ON policy_relation.oid = policy.polrelid
      JOIN pg_namespace policy_namespace
        ON policy_namespace.oid = policy_relation.relnamespace
      WHERE policy_namespace.nspname = target.schema_name
        AND policy_relation.relname = target.table_name
        AND policy.polname = 'openexpert_service_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY openexpert_service_all '
        'ON %I.%I FOR ALL TO openexpert_service USING (true) WITH CHECK (true)',
        target.schema_name,
        target.table_name
      );
    END IF;
  END LOOP;
END
$service_policies$;
