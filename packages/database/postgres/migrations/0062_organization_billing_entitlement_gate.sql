-- Enforce application billing at the Data API boundary as well as in Nuxt.
--
-- The browser receives a short-lived `authenticated` Data API token. Without
-- this migration, the token could use ordinary organization-membership RLS
-- policies directly and bypass the server-side subscription guard.

CREATE OR REPLACE FUNCTION private.has_organization_billing_entitlement(
  target_organization_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    LEFT JOIN public.organization_billing_accounts AS billing_account
      ON billing_account.organization_id = organization.id
    WHERE organization.id = target_organization_id
      AND (
        (
          organization.kind = 'intermediary'
          AND organization.billing_access_state = 'not_required'
        )
        OR (
          organization.kind = 'application'
          AND (
            (
              organization.billing_access_state = 'active'
              AND billing_account.stripe_subscription_status IN ('active', 'trialing')
            )
            OR (
              organization.billing_access_state = 'grace'
              AND billing_account.stripe_subscription_status = 'past_due'
              AND billing_account.grace_until > statement_timestamp()
            )
          )
        )
      )
  )
$function$;

ALTER FUNCTION private.has_organization_billing_entitlement(uuid)
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.has_organization_billing_entitlement(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.has_organization_billing_entitlement(uuid)
  TO authenticated, openexpert_service;

-- Billing recovery must still be able to discover a restricted organization
-- and its own membership. All domain authorization continues to use the
-- entitlement-aware helpers below.
CREATE OR REPLACE FUNCTION private.is_organization_member_for_billing_recovery(
  target_organization_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = target_organization_id
      AND membership.user_id = (SELECT app.current_user_id())
  )
$function$;

ALTER FUNCTION private.is_organization_member_for_billing_recovery(uuid)
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.is_organization_member_for_billing_recovery(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.is_organization_member_for_billing_recovery(uuid)
  TO authenticated, openexpert_service;

CREATE OR REPLACE FUNCTION private.is_organization_member(
  target_organization_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT private.has_organization_billing_entitlement(target_organization_id)
    AND private.is_organization_member_for_billing_recovery(target_organization_id)
$function$;

CREATE OR REPLACE FUNCTION private.is_organization_admin(
  target_organization_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT private.has_organization_billing_entitlement(target_organization_id)
    AND EXISTS (
      SELECT 1
      FROM public.organization_memberships AS membership
      WHERE membership.organization_id = target_organization_id
        AND membership.user_id = (SELECT app.current_user_id())
        AND membership.role = 'admin'
    )
$function$;

CREATE OR REPLACE FUNCTION private.shares_organization(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT target_user_id = (SELECT app.current_user_id())
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships AS mine
      JOIN public.organization_memberships AS theirs
        ON theirs.organization_id = mine.organization_id
      WHERE mine.user_id = (SELECT app.current_user_id())
        AND theirs.user_id = target_user_id
        AND private.has_organization_billing_entitlement(mine.organization_id)
    )
$function$;

CREATE OR REPLACE FUNCTION private.has_administrative_permission(
  target_organization_id uuid,
  target_permission_key text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT private.has_organization_billing_entitlement(target_organization_id)
    AND private.user_has_administrative_permission(
      target_organization_id,
      (SELECT app.current_user_id()),
      target_permission_key
    )
$function$;

DROP POLICY IF EXISTS "members can view organization memberships"
  ON public.organization_memberships;
CREATE POLICY "members can view organization memberships"
  ON public.organization_memberships
  FOR SELECT TO authenticated
  USING (private.is_organization_member_for_billing_recovery(organization_id));

DROP POLICY IF EXISTS "members can view organizations" ON public.organizations;
CREATE POLICY "members can view organizations"
  ON public.organizations
  FOR SELECT TO authenticated
  USING (private.is_organization_member_for_billing_recovery(id));

-- Restrictive policies are combined with every existing permissive policy.
-- This covers direct table access, including policies that use a team/facility
-- helper or compare the current user directly instead of calling the central
-- organization-membership helper.
DO $entitlement_policies$
DECLARE
  target_table record;
BEGIN
  FOR target_table IN
    SELECT relation.relname AS table_name
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    JOIN pg_attribute AS attribute
      ON attribute.attrelid = relation.oid
     AND attribute.attname = 'organization_id'
     AND NOT attribute.attisdropped
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND relation.relrowsecurity
      AND relation.relname NOT IN (
        'organization_memberships',
        'users'
      )
    ORDER BY relation.relname
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS organization_billing_entitlement_gate ON public.%I',
      target_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY organization_billing_entitlement_gate ON public.%I '
      'AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (private.has_organization_billing_entitlement(organization_id)) '
      'WITH CHECK (private.has_organization_billing_entitlement(organization_id))',
      target_table.table_name
    );
  END LOOP;
END
$entitlement_policies$;

-- Every authenticated SECURITY DEFINER RPC whose first argument identifies an
-- organization is moved behind a generated entitlement-checking wrapper. The
-- original implementation retains its OID for existing dependencies, moves to
-- the private schema, and loses all API-role EXECUTE grants.
DO $entitlement_rpc_wrappers$
DECLARE
  target_function record;
  raw_name text;
  identity_types text;
  argument_names text;
  first_argument_name text;
  call_statement text;
  volatility_keyword text;
BEGIN
  FOR target_function IN
    SELECT
      procedure.oid,
      procedure.proname,
      procedure.proargtypes,
      procedure.proargnames,
      procedure.pronargs,
      procedure.prorettype,
      procedure.proretset,
      procedure.provolatile,
      pg_get_function_arguments(procedure.oid) AS declaration_arguments,
      pg_get_function_result(procedure.oid) AS result_type,
      has_function_privilege('openexpert_service', procedure.oid, 'EXECUTE')
        AS service_can_execute
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
      AND has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      AND (
        pg_get_function_identity_arguments(procedure.oid)
          LIKE 'p_organization_id uuid%'
        OR pg_get_function_identity_arguments(procedure.oid)
          LIKE 'target_organization_id uuid%'
      )
    ORDER BY procedure.oid
  LOOP
    identity_types := oidvectortypes(target_function.proargtypes);
    first_argument_name := target_function.proargnames[1];
    SELECT string_agg(quote_ident(argument_name), ', ' ORDER BY ordinal)
    INTO argument_names
    FROM unnest(
      target_function.proargnames[1:target_function.pronargs]
    ) WITH ORDINALITY AS arguments(argument_name, ordinal);

    IF first_argument_name IS NULL OR argument_names IS NULL THEN
      RAISE EXCEPTION 'organization billing wrapper requires named input arguments: %',
        target_function.oid::regprocedure;
    END IF;

    raw_name := left(target_function.proname, 34)
      || '__billing_raw_'
      || substr(md5(target_function.oid::text), 1, 8);

    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET SCHEMA private',
      target_function.proname,
      identity_types
    );
    EXECUTE format(
      'ALTER FUNCTION private.%I(%s) RENAME TO %I',
      target_function.proname,
      identity_types,
      raw_name
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION private.%I(%s) '
      'FROM PUBLIC, anonymous, authenticated, openexpert_service',
      raw_name,
      identity_types
    );

    call_statement := CASE
      WHEN target_function.prorettype = 'pg_catalog.void'::regtype THEN
        format('PERFORM private.%I(%s); RETURN;', raw_name, argument_names)
      WHEN target_function.proretset THEN
        format('RETURN QUERY SELECT * FROM private.%I(%s);', raw_name, argument_names)
      ELSE
        format('RETURN private.%I(%s);', raw_name, argument_names)
    END;
    volatility_keyword := CASE target_function.provolatile
      WHEN 'i' THEN 'IMMUTABLE'
      WHEN 's' THEN 'STABLE'
      ELSE 'VOLATILE'
    END;

    EXECUTE format(
      $wrapper_definition$
        CREATE FUNCTION public.%I(%s)
        RETURNS %s
        LANGUAGE plpgsql
        %s
        SECURITY DEFINER
        SET search_path = ''
        AS $billing_wrapper$
        BEGIN
          IF (SELECT app.current_user_id()) IS NOT NULL
             AND NOT private.has_organization_billing_entitlement(%I) THEN
            RAISE EXCEPTION 'organization_subscription_required'
              USING ERRCODE = '42501';
          END IF;
          %s
        END
        $billing_wrapper$
      $wrapper_definition$,
      target_function.proname,
      target_function.declaration_arguments,
      target_function.result_type,
      volatility_keyword,
      first_argument_name,
      call_statement
    );

    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) '
      'FROM PUBLIC, anonymous, authenticated, openexpert_service',
      target_function.proname,
      identity_types
    );
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) OWNER TO openexpert_owner',
      target_function.proname,
      identity_types
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated',
      target_function.proname,
      identity_types
    );
    IF target_function.service_can_execute THEN
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO openexpert_service',
        target_function.proname,
        identity_types
      );
    END IF;
  END LOOP;
END
$entitlement_rpc_wrappers$;

-- Storage authorization helpers all derive the organization UUID from the
-- first path segment. Returning no segments for a restricted authenticated
-- request makes the existing storage policies fail closed without affecting
-- anonymous booking assets or service-role workers.
CREATE OR REPLACE FUNCTION app.storage_folder_segments(name text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
STRICT
SET search_path = ''
AS $function$
DECLARE
  parts text[];
  folder_parts text[];
  target_organization_id uuid;
BEGIN
  parts := string_to_array(name, '/');
  folder_parts := parts[1 : array_length(parts, 1) - 1];

  IF (SELECT app.current_user_id()) IS NULL
     OR coalesce(array_length(folder_parts, 1), 0) = 0
     OR folder_parts[1] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RETURN folder_parts;
  END IF;

  target_organization_id := folder_parts[1]::uuid;
  IF NOT private.has_organization_billing_entitlement(target_organization_id) THEN
    RETURN ARRAY[]::text[];
  END IF;
  RETURN folder_parts;
END
$function$;

COMMENT ON FUNCTION private.has_organization_billing_entitlement(uuid) IS
  'Authoritative database entitlement gate for direct authenticated Data API and RPC access.';

NOTIFY pgrst, 'reload schema';
