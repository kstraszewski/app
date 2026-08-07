-- Opt-in organization-scoped access to experimental CRM features.

INSERT INTO public.administrative_roles (
  role_key,
  label,
  description,
  risk_level,
  sort_order
)
VALUES (
  'experiments_access',
  'Dostęp do eksperymentów',
  'Umożliwia korzystanie z eksperymentalnych funkcji organizacji.',
  'standard',
  70
)
ON CONFLICT (role_key) DO UPDATE
SET
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  sort_order = excluded.sort_order;

INSERT INTO public.administrative_role_permissions (role_key, permission_key)
VALUES ('experiments_access', 'experiments.use')
ON CONFLICT (role_key, permission_key) DO NOTHING;

ALTER TABLE public.organization_user_admin_roles
  DROP CONSTRAINT organization_user_admin_roles_role_valid;

ALTER TABLE public.organization_user_admin_roles
  ADD CONSTRAINT organization_user_admin_roles_role_valid CHECK (
    role_key = ANY (ARRAY[
      'access_admin'::text,
      'structure_admin'::text,
      'consents_admin'::text,
      'crm_config_admin'::text,
      'forum_admin'::text,
      'experiments_access'::text
    ])
  );

-- Preserve the administrative-access command semantics while extending its
-- accepted role catalogue with experiments_access.
CREATE OR REPLACE FUNCTION public.set_organization_user_admin_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_role_keys text[],
  p_consent_publish boolean,
  p_consent_justification text,
  p_consent_expires_at timestamp with time zone,
  p_change_reason text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  actor_snapshot jsonb;
  target_snapshot jsonb;
  normalized_role_keys text[];
  previous_role_keys text[];
  previous_membership_role text;
  requested_membership_role text;
  access_state public.organization_user_access_states%rowtype;
  current_consent_grant public.organization_user_direct_grants%rowtype;
  consent_changed boolean := false;
  roles_changed boolean := false;
  changed boolean := false;
  audit_event_id uuid;
  request_fingerprint text;
  previous_command private.organization_admin_access_commands%rowtype;
  response_payload jsonb;
  previous_state jsonb;
  next_state jsonb;
BEGIN
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING errcode = '42501';
  END IF;

  IF NOT private.has_administrative_permission(
    p_organization_id,
    'iam.roles.manage'
  ) THEN
    RAISE EXCEPTION 'administrative_access_manage_forbidden' USING errcode = '42501';
  END IF;

  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'administrative_access_revision_invalid' USING errcode = '22023';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'administrative_access_idempotency_key_required' USING errcode = '22023';
  END IF;
  IF p_change_reason IS NULL
    OR char_length(btrim(p_change_reason)) NOT BETWEEN 10 AND 2000
  THEN
    RAISE EXCEPTION 'administrative_access_change_reason_invalid' USING errcode = '22023';
  END IF;
  IF p_role_keys IS NULL THEN
    RAISE EXCEPTION 'administrative_access_roles_required' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_role_keys) AS requested_role(role_key)
    WHERE requested_role.role_key NOT IN (
      'organization_admin',
      'access_admin',
      'structure_admin',
      'consents_admin',
      'crm_config_admin',
      'forum_admin',
      'experiments_access'
    )
  ) THEN
    RAISE EXCEPTION 'administrative_access_role_invalid' USING errcode = '22023';
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT requested_role.role_key ORDER BY requested_role.role_key),
    ARRAY[]::text[]
  )
  INTO normalized_role_keys
  FROM unnest(p_role_keys) AS requested_role(role_key);

  IF cardinality(normalized_role_keys) <> cardinality(p_role_keys) THEN
    RAISE EXCEPTION 'administrative_access_roles_duplicate' USING errcode = '22023';
  END IF;

  IF coalesce(p_consent_publish, false) THEN
    IF p_consent_justification IS NULL
      OR char_length(btrim(p_consent_justification)) NOT BETWEEN 10 AND 2000
    THEN
      RAISE EXCEPTION 'consent_publishing_justification_invalid' USING errcode = '22023';
    END IF;

    IF p_consent_expires_at IS NULL
      OR p_consent_expires_at <= statement_timestamp()
    THEN
      RAISE EXCEPTION 'consent_publishing_expiry_invalid' USING errcode = '22023';
    END IF;
  ELSIF p_consent_justification IS NOT NULL OR p_consent_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'consent_publishing_fields_without_grant' USING errcode = '22023';
  END IF;

  request_fingerprint := pg_catalog.md5(
    jsonb_build_object(
      'targetUserId', p_user_id,
      'expectedRevision', p_expected_revision,
      'roleKeys', to_jsonb(normalized_role_keys),
      'consentPublish', coalesce(p_consent_publish, false),
      'consentJustification', CASE
        WHEN coalesce(p_consent_publish, false) THEN btrim(p_consent_justification)
        ELSE NULL
      END,
      'consentExpiresAt', CASE
        WHEN coalesce(p_consent_publish, false) THEN p_consent_expires_at
        ELSE NULL
      END,
      'changeReason', btrim(p_change_reason)
    )::text
  );

  SELECT command.*
  INTO previous_command
  FROM private.organization_admin_access_commands AS command
  WHERE command.organization_id = p_organization_id
    AND command.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF previous_command.actor_user_id <> actor_user_id
      OR previous_command.target_user_id <> p_user_id
      OR previous_command.command_type <> 'set_admin_access'
      OR previous_command.request_fingerprint <> request_fingerprint
    THEN
      RAISE EXCEPTION 'administrative_access_idempotency_conflict' USING errcode = '23505';
    END IF;

    RETURN jsonb_set(previous_command.response, '{replayed}', 'true'::jsonb, true);
  END IF;

  SELECT membership.role
  INTO previous_membership_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_member_not_found' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.organization_user_access_states (organization_id, user_id)
  VALUES (p_organization_id, p_user_id)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  SELECT state.*
  INTO access_state
  FROM public.organization_user_access_states AS state
  WHERE state.organization_id = p_organization_id
    AND state.user_id = p_user_id
  FOR UPDATE;

  IF access_state.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'administrative_access_revision_conflict'
      USING
        errcode = '40001',
        detail = jsonb_build_object(
          'expectedRevision', p_expected_revision,
          'currentRevision', access_state.revision
        )::text;
  END IF;

  SELECT coalesce(
    array_agg(existing_role.role_key ORDER BY existing_role.role_key),
    ARRAY[]::text[]
  )
  INTO previous_role_keys
  FROM (
    SELECT 'organization_admin'::text AS role_key
    WHERE previous_membership_role = 'admin'

    UNION ALL

    SELECT assignment.role_key
    FROM public.organization_user_admin_roles AS assignment
    WHERE assignment.organization_id = p_organization_id
      AND assignment.user_id = p_user_id
  ) AS existing_role;

  previous_state := private.administrative_access_state_json(
    p_organization_id,
    p_user_id
  );

  requested_membership_role := CASE
    WHEN 'organization_admin' = ANY (normalized_role_keys) THEN 'admin'
    ELSE 'expert'
  END;

  IF previous_membership_role = 'admin'
    AND requested_membership_role <> 'admin'
    AND (
      SELECT count(*)
      FROM public.organization_memberships AS other_admin
      WHERE other_admin.organization_id = p_organization_id
        AND other_admin.role = 'admin'
    ) <= 1
  THEN
    RAISE EXCEPTION 'administrative_access_last_organization_admin' USING errcode = '23514';
  END IF;

  roles_changed := previous_role_keys IS DISTINCT FROM normalized_role_keys;

  IF previous_membership_role IS DISTINCT FROM requested_membership_role THEN
    UPDATE public.organization_memberships
    SET role = requested_membership_role
    WHERE organization_id = p_organization_id
      AND user_id = p_user_id;
  END IF;

  DELETE FROM public.organization_user_admin_roles AS assignment
  WHERE assignment.organization_id = p_organization_id
    AND assignment.user_id = p_user_id
    AND NOT (assignment.role_key = ANY (normalized_role_keys));

  INSERT INTO public.organization_user_admin_roles (
    organization_id,
    user_id,
    role_key,
    assigned_by_user_id,
    reason
  )
  SELECT
    p_organization_id,
    p_user_id,
    requested_role.role_key,
    actor_user_id,
    btrim(p_change_reason)
  FROM unnest(normalized_role_keys) AS requested_role(role_key)
  WHERE requested_role.role_key <> 'organization_admin'
  ON CONFLICT (organization_id, user_id, role_key) DO NOTHING;

  SELECT direct_grant.*
  INTO current_consent_grant
  FROM public.organization_user_direct_grants AS direct_grant
  WHERE direct_grant.organization_id = p_organization_id
    AND direct_grant.user_id = p_user_id
    AND direct_grant.permission_key = 'compliance.consents.definitions.publish'
    AND direct_grant.status = 'active'
  FOR UPDATE;

  IF coalesce(p_consent_publish, false) THEN
    consent_changed :=
      NOT FOUND
      OR current_consent_grant.expires_at <= statement_timestamp()
      OR current_consent_grant.justification IS DISTINCT FROM btrim(p_consent_justification)
      OR current_consent_grant.expires_at IS DISTINCT FROM p_consent_expires_at;

    IF consent_changed AND current_consent_grant.id IS NOT NULL THEN
      UPDATE public.organization_user_direct_grants
      SET
        status = 'revoked',
        revoked_by_user_id = actor_user_id,
        revoked_at = statement_timestamp(),
        revocation_reason = btrim(p_change_reason),
        revision = revision + 1
      WHERE id = current_consent_grant.id;
    END IF;

    IF consent_changed THEN
      INSERT INTO public.organization_user_direct_grants (
        organization_id,
        user_id,
        permission_key,
        justification,
        expires_at,
        granted_by_user_id
      ) VALUES (
        p_organization_id,
        p_user_id,
        'compliance.consents.definitions.publish',
        btrim(p_consent_justification),
        p_consent_expires_at,
        actor_user_id
      );
    END IF;
  ELSE
    consent_changed := current_consent_grant.id IS NOT NULL;

    IF consent_changed THEN
      UPDATE public.organization_user_direct_grants
      SET
        status = 'revoked',
        revoked_by_user_id = actor_user_id,
        revoked_at = statement_timestamp(),
        revocation_reason = btrim(p_change_reason),
        revision = revision + 1
      WHERE id = current_consent_grant.id;
    END IF;
  END IF;

  changed := roles_changed OR consent_changed;

  IF changed THEN
    UPDATE public.organization_user_access_states
    SET
      revision = revision + 1,
      updated_by_user_id = actor_user_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND user_id = p_user_id
    RETURNING * INTO access_state;

    SELECT jsonb_build_object(
      'userId', actor.id,
      'fullName', coalesce(actor.full_name, actor.email),
      'email', actor.email,
      'avatarUrl', actor.avatar_url
    )
    INTO actor_snapshot
    FROM public.users AS actor
    WHERE actor.id = actor_user_id;

    SELECT jsonb_build_object(
      'userId', target.id,
      'fullName', coalesce(target.full_name, target.email),
      'email', target.email,
      'avatarUrl', target.avatar_url
    )
    INTO target_snapshot
    FROM public.users AS target
    WHERE target.id = p_user_id;

    INSERT INTO public.organization_user_audit_events (
      organization_id,
      target_user_id,
      actor_user_id,
      actor_snapshot,
      target_snapshot,
      event_type,
      resource_type,
      resource_id,
      resource_label,
      changes,
      reason,
      source,
      correlation_id,
      revision_before,
      revision_after
    ) VALUES (
      p_organization_id,
      p_user_id,
      actor_user_id,
      coalesce(actor_snapshot, '{}'::jsonb),
      coalesce(target_snapshot, '{}'::jsonb),
      'admin_access_updated',
      'user_admin_access',
      p_user_id::text,
      'Dostęp administracyjny użytkownika',
      jsonb_build_array(
        jsonb_build_object(
          'field', 'roles',
          'before', to_jsonb(previous_role_keys),
          'after', to_jsonb(normalized_role_keys)
        ),
        jsonb_build_object(
          'field', 'consentPublishingGrant',
          'before', previous_state -> 'consentPublishingGrant',
          'after', CASE
            WHEN coalesce(p_consent_publish, false) THEN jsonb_build_object(
              'permissionKey', 'compliance.consents.definitions.publish',
              'expiresAt', p_consent_expires_at
            )
            ELSE NULL
          END
        )
      ),
      btrim(p_change_reason),
      'admin_panel',
      p_idempotency_key,
      p_expected_revision,
      access_state.revision
    )
    RETURNING id INTO audit_event_id;
  END IF;

  next_state := private.administrative_access_state_json(
    p_organization_id,
    p_user_id
  );

  response_payload := jsonb_build_object(
    'data', next_state,
    'changed', changed,
    'replayed', false,
    'auditEventId', audit_event_id
  );

  INSERT INTO private.organization_admin_access_commands (
    organization_id,
    idempotency_key,
    actor_user_id,
    target_user_id,
    command_type,
    request_fingerprint,
    response
  ) VALUES (
    p_organization_id,
    p_idempotency_key,
    actor_user_id,
    p_user_id,
    'set_admin_access',
    request_fingerprint,
    response_payload
  );

  RETURN response_payload;
END;
$$;
