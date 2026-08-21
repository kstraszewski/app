-- Rollback-only coverage for the purpose-specific organization creation gate.

BEGIN;

DO $organization_creation_grant_gate_smoke$
DECLARE
  existing_user_id uuid := gen_random_uuid();
  fresh_identity_id uuid := gen_random_uuid();
  existing_organization_id uuid := gen_random_uuid();
  existing_email text := '0080-existing-' || gen_random_uuid()::text || '@example.test';
  fresh_email text := '0080-fresh-' || gen_random_uuid()::text || '@example.test';
  created jsonb;
BEGIN
  IF has_function_privilege(
    'authenticated',
    'public.create_organization_with_admin_v2(text,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.create_organization_with_admin(text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'legacy_organization_creation_still_authenticated';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.create_intermediary_organization_for_existing_identity_v1(uuid,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'openexpert_service',
    'public.create_intermediary_organization_for_existing_identity_v1(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'organization_creation_service_acl_invalid';
  END IF;

  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES
    (existing_user_id, '0080 Existing', existing_email, true),
    (fresh_identity_id, '0080 Fresh', fresh_email, true);

  INSERT INTO public.organizations (id, name, slug, kind, billing_access_state)
  VALUES (
    existing_organization_id,
    '0080 Existing Organization',
    'smoke-0080-' || replace(existing_organization_id::text, '-', ''),
    'intermediary',
    'not_required'
  );

  INSERT INTO public.users (id, organization_id, email, role, full_name)
  VALUES (
    existing_user_id,
    existing_organization_id,
    existing_email,
    'admin',
    '0080 Existing'
  );

  INSERT INTO public.organization_memberships (organization_id, user_id, role)
  VALUES (existing_organization_id, existing_user_id, 'admin');

  BEGIN
    PERFORM public.create_intermediary_organization_for_existing_identity_v1(
      fresh_identity_id,
      '0080 bypass attempt',
      '0080 Fresh'
    );
    RAISE EXCEPTION 'fresh_invitation_identity_created_organization';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  created := public.create_intermediary_organization_for_existing_identity_v1(
    existing_user_id,
    '0080 Additional Intermediary',
    '0080 Existing'
  );

  IF created->>'kind' <> 'intermediary'
     OR created->>'billingAccessState' <> 'not_required'
     OR NOT EXISTS (
       SELECT 1
       FROM public.organization_memberships AS membership
       WHERE membership.organization_id = (created->>'id')::uuid
         AND membership.user_id = existing_user_id
         AND membership.role = 'admin'
     ) THEN
    RAISE EXCEPTION 'existing_workforce_intermediary_creation_invalid';
  END IF;
END
$organization_creation_grant_gate_smoke$;

ROLLBACK;
