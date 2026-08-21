-- Close legacy organization-creation bypasses after purpose-specific signup.
-- Application organizations are created only by durable onboarding invitations;
-- an existing workforce member may still create an additional intermediary.

CREATE OR REPLACE FUNCTION public.create_intermediary_organization_for_existing_identity_v1(
  p_actor_user_id uuid,
  p_organization_name text,
  p_full_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;

  -- A purpose-specific magic link may create a verified identity, but it must
  -- not become a general organization-creation grant. Require an existing
  -- workforce membership and keep it locked until the new tenant is created.
  PERFORM 1
  FROM public.organization_memberships AS membership
  WHERE membership.user_id = p_actor_user_id
  ORDER BY membership.organization_id
  LIMIT 1
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_workforce_membership_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN private.create_organization_for_identity(
    p_actor_user_id,
    p_organization_name,
    p_full_name,
    'intermediary'
  );
END
$function$;

ALTER FUNCTION public.create_intermediary_organization_for_existing_identity_v1(
  uuid,
  text,
  text
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.create_organization_with_admin_v2(text, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.create_organization_with_admin(text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.create_intermediary_organization_for_existing_identity_v1(
  uuid,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_intermediary_organization_for_existing_identity_v1(
  uuid,
  text,
  text
) TO openexpert_service;

COMMENT ON FUNCTION public.create_intermediary_organization_for_existing_identity_v1(
  uuid,
  text,
  text
) IS
  'Service-only legacy path for an existing workforce identity to create another intermediary tenant. Application tenants require a durable onboarding invitation.';

NOTIFY pgrst, 'reload schema';
