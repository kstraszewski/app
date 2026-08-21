-- An application administrator can reserve an already-paid seat for an email
-- address that does not have an identity yet. Reservations are local billing
-- capacity only: creating, resending, revoking, expiring or accepting one never
-- changes Stripe quantity.

CREATE TABLE public.organization_member_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  email_normalized text NOT NULL,
  invited_name text,
  role text DEFAULT 'expert' NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  invited_by_user_id uuid NOT NULL
    REFERENCES identity.users(id) ON DELETE RESTRICT,
  accepted_by_user_id uuid
    REFERENCES identity.users(id) ON DELETE RESTRICT,
  expires_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revision bigint DEFAULT 1 NOT NULL,
  delivery_attempts integer DEFAULT 1 NOT NULL,
  last_delivery_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_member_invitations_token_hash_check CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT organization_member_invitations_email_check CHECK (
    length(email_normalized) BETWEEN 3 AND 320
    AND email_normalized = lower(btrim(email_normalized))
  ),
  CONSTRAINT organization_member_invitations_name_check CHECK (
    invited_name IS NULL
    OR (
      invited_name = btrim(invited_name)
      AND length(invited_name) BETWEEN 1 AND 200
    )
  ),
  CONSTRAINT organization_member_invitations_role_check CHECK (
    role IN ('expert', 'admin')
  ),
  CONSTRAINT organization_member_invitations_status_check CHECK (
    status IN ('pending', 'accepted', 'expired', 'revoked')
  ),
  CONSTRAINT organization_member_invitations_lifecycle_check CHECK (
    (
      status = 'pending'
      AND accepted_by_user_id IS NULL
      AND accepted_at IS NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'accepted'
      AND accepted_by_user_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'expired'
      AND accepted_by_user_id IS NULL
      AND accepted_at IS NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'revoked'
      AND accepted_by_user_id IS NULL
      AND accepted_at IS NULL
      AND revoked_at IS NOT NULL
    )
  ),
  CONSTRAINT organization_member_invitations_expiry_check CHECK (
    expires_at > created_at
  ),
  CONSTRAINT organization_member_invitations_revision_check CHECK (
    revision >= 1
  ),
  CONSTRAINT organization_member_invitations_delivery_attempts_check CHECK (
    delivery_attempts >= 1
  ),
  CONSTRAINT organization_member_invitations_delivery_error_check CHECK (
    last_delivery_error IS NULL OR length(last_delivery_error) <= 2000
  )
);

CREATE UNIQUE INDEX organization_member_invitations_pending_email_unique
  ON public.organization_member_invitations (organization_id, email_normalized)
  WHERE status = 'pending';
CREATE INDEX organization_member_invitations_organization_timeline_idx
  ON public.organization_member_invitations (organization_id, created_at DESC);
CREATE INDEX organization_member_invitations_live_capacity_idx
  ON public.organization_member_invitations (organization_id, expires_at)
  WHERE status = 'pending';

CREATE TRIGGER set_organization_member_invitations_updated_at
  BEFORE UPDATE ON public.organization_member_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.organization_member_invitations IS
  'Service-managed email invitations that reserve one already-paid application seat. Only a SHA-256 token digest is stored.';
COMMENT ON COLUMN public.organization_member_invitations.email_normalized IS
  'Exact normalized email that the verified Better Auth identity must match when accepting.';

-- A pending invitation is a real capacity reservation. Protect the invariant
-- even if a membership writer other than the HTTP route is used. Initial
-- onboarding has no member reservation, so it remains unaffected.
CREATE FUNCTION private.enforce_application_member_reservations_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  membership_count integer;
  reservation_count integer;
BEGIN
  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = new.organization_id
  FOR UPDATE;

  IF NOT FOUND OR organization_record.kind <> 'application' THEN
    RETURN new;
  END IF;

  -- Avoid changing pre-subscription onboarding semantics. Invitations can only
  -- be created for an active/grace paid account, so no reservation is possible
  -- before a canonical licensed quantity exists.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_member_invitations AS invitation
    WHERE invitation.organization_id = new.organization_id
      AND invitation.status = 'pending'
      AND invitation.expires_at > statement_timestamp()
  ) THEN
    RETURN new;
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = new.organization_id
  FOR UPDATE;

  IF NOT FOUND OR billing_account.stripe_subscription_item_id IS NULL THEN
    RAISE EXCEPTION 'active_application_subscription_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = new.organization_id;

  SELECT count(*)::integer INTO reservation_count
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.organization_id = new.organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at > statement_timestamp();

  IF membership_count + reservation_count >= billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_seat_capacity_exhausted'
      USING ERRCODE = '23514';
  END IF;

  RETURN new;
END
$function$;

ALTER FUNCTION private.enforce_application_member_reservations_v1()
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.enforce_application_member_reservations_v1()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER organization_memberships_enforce_member_reservations
  BEFORE INSERT OR UPDATE OF organization_id
  ON public.organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_application_member_reservations_v1();

-- 0078 introduced the no-Stripe writer for an existing verified identity.
-- Once invitations can reserve capacity, that writer must use occupied seats
-- (memberships + live reservations) while holding the same organization/account
-- locks. This keeps a quote race from silently consuming a reserved seat.
CREATE OR REPLACE FUNCTION public.add_organization_member_within_capacity_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_email text,
  p_target_role text DEFAULT 'expert'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  target_identity identity.users;
  normalized_email text := lower(nullif(btrim(p_target_email), ''));
  normalized_role text := lower(nullif(btrim(p_target_role), ''));
  membership_count integer;
  reservation_count integer;
  final_membership_count integer;
  access_projection jsonb;
  inserted_membership public.organization_memberships;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'organization_and_actor_required'
      USING ERRCODE = '22023';
  END IF;
  IF normalized_email IS NULL OR length(normalized_email) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'invalid_member_email' USING ERRCODE = '22023';
  END IF;
  IF normalized_role IS NULL OR normalized_role NOT IN ('expert', 'admin') THEN
    RAISE EXCEPTION 'invalid_organization_role' USING ERRCODE = '23514';
  END IF;

  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF organization_record.kind <> 'application' THEN
    RAISE EXCEPTION 'application_organization_required'
      USING ERRCODE = '23514';
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.organization_memberships AS actor_membership
  WHERE actor_membership.organization_id = p_organization_id
    AND actor_membership.user_id = p_actor_user_id
    AND actor_membership.role = 'admin'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;

  access_projection := public.get_organization_billing_access_v1(
    p_organization_id
  );
  IF coalesce((access_projection ->> 'entitled')::boolean, false) = false
     OR coalesce(access_projection ->> 'billingAccessState', '')
       NOT IN ('active', 'grace') THEN
    RAISE EXCEPTION 'active_application_subscription_required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.organization_member_invitations AS invitation
  SET status = 'expired',
      revision = invitation.revision + 1
  WHERE invitation.organization_id = p_organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at <= statement_timestamp();

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  SELECT count(*)::integer INTO reservation_count
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at > statement_timestamp();

  IF membership_count < 1
     OR membership_count + reservation_count >= billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_seat_capacity_exhausted'
      USING ERRCODE = '23514';
  END IF;

  SELECT identity_user.* INTO target_identity
  FROM identity.users AS identity_user
  WHERE lower(btrim(identity_user.email)) = normalized_email
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verified_target_identity_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF target_identity.email_verified IS DISTINCT FROM true
     OR lower(btrim(target_identity.email)) <> normalized_email THEN
    RAISE EXCEPTION 'verified_target_identity_required'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = target_identity.id
  ) THEN
    RAISE EXCEPTION 'organization_member_already_exists'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_member_invitations AS invitation
    WHERE invitation.organization_id = p_organization_id
      AND invitation.email_normalized = normalized_email
      AND invitation.status = 'pending'
      AND invitation.expires_at > statement_timestamp()
  ) THEN
    RAISE EXCEPTION 'member_invitation_already_pending'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.users (
    id,
    organization_id,
    email,
    role,
    full_name,
    avatar_url
  ) VALUES (
    target_identity.id,
    p_organization_id,
    lower(btrim(target_identity.email)),
    normalized_role,
    nullif(btrim(target_identity.name), ''),
    NULL
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, display_name)
  VALUES (target_identity.id, nullif(btrim(target_identity.name), ''))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  ) VALUES (
    p_organization_id,
    target_identity.id,
    normalized_role
  )
  RETURNING * INTO inserted_membership;

  SELECT count(*)::integer INTO final_membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  IF final_membership_count + reservation_count > billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_membership_reservation_invariant_failed'
      USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'organizationId', inserted_membership.organization_id,
    'userId', inserted_membership.user_id,
    'role', inserted_membership.role,
    'createdAt', inserted_membership.created_at,
    'membershipSeatCount', final_membership_count,
    'reservedSeatCount', reservation_count,
    'occupiedSeatCount', final_membership_count + reservation_count,
    'licensedSeatCount', billing_account.licensed_seat_count
  );
END
$function$;

ALTER FUNCTION public.add_organization_member_within_capacity_v1(
  uuid,
  uuid,
  text,
  text
) OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION public.add_organization_member_within_capacity_v1(
  uuid,
  uuid,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.add_organization_member_within_capacity_v1(
  uuid,
  uuid,
  text,
  text
) TO openexpert_service;

COMMENT ON FUNCTION public.add_organization_member_within_capacity_v1(
  uuid,
  uuid,
  text,
  text
) IS
  'Service-only atomic add of one verified application member into unreserved paid capacity; never mutates Stripe quantity.';

CREATE FUNCTION public.create_organization_member_invitation_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_email text,
  p_role text,
  p_invited_name text,
  p_token_hash text,
  p_expires_at timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  inserted_invitation public.organization_member_invitations;
  normalized_email text := lower(nullif(btrim(p_email), ''));
  normalized_role text := lower(nullif(btrim(p_role), ''));
  normalized_name text := nullif(btrim(p_invited_name), '');
  membership_count integer;
  reservation_count integer;
  access_projection jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'organization_and_actor_required' USING ERRCODE = '22023';
  END IF;
  IF normalized_email IS NULL
     OR length(normalized_email) NOT BETWEEN 3 AND 320
     OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' THEN
    RAISE EXCEPTION 'invalid_member_email' USING ERRCODE = '22023';
  END IF;
  IF normalized_role NOT IN ('expert', 'admin') THEN
    RAISE EXCEPTION 'invalid_organization_role' USING ERRCODE = '23514';
  END IF;
  IF normalized_name IS NOT NULL AND length(normalized_name) > 200 THEN
    RAISE EXCEPTION 'invalid_invited_name' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_member_invitation_token_hash' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL
     OR p_expires_at < statement_timestamp() + interval '5 minutes'
     OR p_expires_at > statement_timestamp() + interval '30 days' THEN
    RAISE EXCEPTION 'invalid_member_invitation_expiry' USING ERRCODE = '22023';
  END IF;

  -- Global lock order shared by every reservation writer.
  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF organization_record.kind <> 'application' THEN
    RAISE EXCEPTION 'application_organization_required' USING ERRCODE = '23514';
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.organization_memberships AS actor_membership
  WHERE actor_membership.organization_id = p_organization_id
    AND actor_membership.user_id = p_actor_user_id
    AND actor_membership.role = 'admin'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;

  access_projection := public.get_organization_billing_access_v1(p_organization_id);
  IF coalesce((access_projection ->> 'entitled')::boolean, false) = false
     OR coalesce(access_projection ->> 'billingAccessState', '')
       NOT IN ('active', 'grace') THEN
    RAISE EXCEPTION 'active_application_subscription_required'
      USING ERRCODE = '42501';
  END IF;

  -- Expiry frees capacity without a background job. The row remains auditable.
  UPDATE public.organization_member_invitations AS invitation
  SET status = 'expired',
      revision = invitation.revision + 1
  WHERE invitation.organization_id = p_organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at <= statement_timestamp();

  IF EXISTS (
    SELECT 1
    FROM identity.users AS identity_user
    JOIN public.organization_memberships AS membership
      ON membership.user_id = identity_user.id
     AND membership.organization_id = p_organization_id
    WHERE lower(btrim(identity_user.email)) = normalized_email
  ) THEN
    RAISE EXCEPTION 'organization_member_already_exists' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_member_invitations AS invitation
    WHERE invitation.organization_id = p_organization_id
      AND invitation.email_normalized = normalized_email
      AND invitation.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'member_invitation_already_pending' USING ERRCODE = '23505';
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  SELECT count(*)::integer INTO reservation_count
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at > statement_timestamp();

  IF membership_count < 1
     OR membership_count + reservation_count >= billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_seat_capacity_exhausted'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.organization_member_invitations (
    organization_id,
    token_hash,
    email_normalized,
    invited_name,
    role,
    invited_by_user_id,
    expires_at
  ) VALUES (
    p_organization_id,
    p_token_hash,
    normalized_email,
    normalized_name,
    normalized_role,
    p_actor_user_id,
    p_expires_at
  )
  RETURNING * INTO inserted_invitation;

  RETURN jsonb_build_object(
    'id', inserted_invitation.id,
    'organizationId', inserted_invitation.organization_id,
    'email', inserted_invitation.email_normalized,
    'invitedName', inserted_invitation.invited_name,
    'role', inserted_invitation.role,
    'status', inserted_invitation.status,
    'invitedByUserId', inserted_invitation.invited_by_user_id,
    'expiresAt', inserted_invitation.expires_at,
    'sentAt', inserted_invitation.sent_at,
    'acceptedAt', inserted_invitation.accepted_at,
    'revokedAt', inserted_invitation.revoked_at,
    'revision', inserted_invitation.revision,
    'deliveryAttempts', inserted_invitation.delivery_attempts,
    'lastDeliveryError', inserted_invitation.last_delivery_error,
    'createdAt', inserted_invitation.created_at,
    'updatedAt', inserted_invitation.updated_at,
    'licensedSeatCount', billing_account.licensed_seat_count,
    'membershipSeatCount', membership_count,
    'reservedSeatCount', reservation_count + 1
  );
END
$function$;

CREATE FUNCTION public.resend_organization_member_invitation_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_invitation_id uuid,
  p_token_hash text,
  p_expires_at timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  invitation_record public.organization_member_invitations;
  membership_count integer;
  reservation_count integer;
  access_projection jsonb;
BEGIN
  IF p_organization_id IS NULL OR p_actor_user_id IS NULL OR p_invitation_id IS NULL THEN
    RAISE EXCEPTION 'organization_actor_and_invitation_required' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_member_invitation_token_hash' USING ERRCODE = '22023';
  END IF;
  IF p_expires_at IS NULL
     OR p_expires_at < statement_timestamp() + interval '5 minutes'
     OR p_expires_at > statement_timestamp() + interval '30 days' THEN
    RAISE EXCEPTION 'invalid_member_invitation_expiry' USING ERRCODE = '22023';
  END IF;

  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF organization_record.kind <> 'application' THEN
    RAISE EXCEPTION 'application_organization_required' USING ERRCODE = '23514';
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.organization_memberships AS actor_membership
  WHERE actor_membership.organization_id = p_organization_id
    AND actor_membership.user_id = p_actor_user_id
    AND actor_membership.role = 'admin'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;

  access_projection := public.get_organization_billing_access_v1(p_organization_id);
  IF coalesce((access_projection ->> 'entitled')::boolean, false) = false
     OR coalesce(access_projection ->> 'billingAccessState', '')
       NOT IN ('active', 'grace') THEN
    RAISE EXCEPTION 'active_application_subscription_required'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.organization_member_invitations AS invitation
  SET status = 'expired',
      revision = invitation.revision + 1
  WHERE invitation.organization_id = p_organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at <= statement_timestamp();

  SELECT invitation.* INTO invitation_record
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.id = p_invitation_id
    AND invitation.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF invitation_record.status NOT IN ('pending', 'expired') THEN
    RAISE EXCEPTION 'member_invitation_not_resendable' USING ERRCODE = '23514';
  END IF;

  IF invitation_record.status = 'expired' THEN
    IF EXISTS (
      SELECT 1
      FROM public.organization_member_invitations AS other_invitation
      WHERE other_invitation.organization_id = p_organization_id
        AND other_invitation.email_normalized = invitation_record.email_normalized
        AND other_invitation.status = 'pending'
        AND other_invitation.id <> invitation_record.id
    ) THEN
      RAISE EXCEPTION 'member_invitation_already_pending' USING ERRCODE = '23505';
    END IF;

    SELECT count(*)::integer INTO membership_count
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id;
    SELECT count(*)::integer INTO reservation_count
    FROM public.organization_member_invitations AS invitation
    WHERE invitation.organization_id = p_organization_id
      AND invitation.status = 'pending'
      AND invitation.expires_at > statement_timestamp();
    IF membership_count + reservation_count >= billing_account.licensed_seat_count THEN
      RAISE EXCEPTION 'organization_seat_capacity_exhausted'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  UPDATE public.organization_member_invitations
  SET token_hash = p_token_hash,
      status = 'pending',
      expires_at = p_expires_at,
      sent_at = NULL,
      last_delivery_error = NULL,
      revision = revision + 1,
      delivery_attempts = delivery_attempts + 1
  WHERE id = invitation_record.id
  RETURNING * INTO invitation_record;

  RETURN jsonb_build_object(
    'id', invitation_record.id,
    'organizationId', invitation_record.organization_id,
    'email', invitation_record.email_normalized,
    'invitedName', invitation_record.invited_name,
    'role', invitation_record.role,
    'status', invitation_record.status,
    'invitedByUserId', invitation_record.invited_by_user_id,
    'expiresAt', invitation_record.expires_at,
    'sentAt', invitation_record.sent_at,
    'acceptedAt', invitation_record.accepted_at,
    'revokedAt', invitation_record.revoked_at,
    'revision', invitation_record.revision,
    'deliveryAttempts', invitation_record.delivery_attempts,
    'lastDeliveryError', invitation_record.last_delivery_error,
    'createdAt', invitation_record.created_at,
    'updatedAt', invitation_record.updated_at
  );
END
$function$;

CREATE FUNCTION public.record_organization_member_invitation_delivery_v1(
  p_invitation_id uuid,
  p_expected_revision bigint,
  p_sent_at timestamp with time zone,
  p_error text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  invitation_record public.organization_member_invitations;
  normalized_error text := nullif(left(btrim(p_error), 2000), '');
BEGIN
  IF p_invitation_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision < 1 THEN
    RAISE EXCEPTION 'invalid_member_invitation_delivery_result' USING ERRCODE = '22023';
  END IF;
  IF (p_sent_at IS NULL) = (normalized_error IS NULL) THEN
    RAISE EXCEPTION 'member_invitation_delivery_result_pair_required'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.organization_member_invitations
  SET sent_at = p_sent_at,
      last_delivery_error = normalized_error
  WHERE id = p_invitation_id
    AND status = 'pending'
    AND revision = p_expected_revision
  RETURNING * INTO invitation_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_invitation_delivery_revision_conflict'
      USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'id', invitation_record.id,
    'revision', invitation_record.revision,
    'sentAt', invitation_record.sent_at,
    'deliveryAttempts', invitation_record.delivery_attempts,
    'lastDeliveryError', invitation_record.last_delivery_error
  );
END
$function$;

CREATE FUNCTION public.revoke_organization_member_invitation_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_invitation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  invitation_record public.organization_member_invitations;
BEGIN
  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.organization_memberships AS actor_membership
  WHERE actor_membership.organization_id = p_organization_id
    AND actor_membership.user_id = p_actor_user_id
    AND actor_membership.role = 'admin'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.organization_member_invitations AS invitation
  SET status = 'expired',
      revision = invitation.revision + 1
  WHERE invitation.organization_id = p_organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at <= statement_timestamp();

  SELECT invitation.* INTO invitation_record
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.id = p_invitation_id
    AND invitation.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_invitation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF invitation_record.status = 'accepted' THEN
    RAISE EXCEPTION 'accepted_member_invitation_cannot_be_revoked'
      USING ERRCODE = '23514';
  END IF;
  IF invitation_record.status <> 'revoked' THEN
    UPDATE public.organization_member_invitations
    SET status = 'revoked',
        revoked_at = statement_timestamp(),
        revision = revision + 1
    WHERE id = invitation_record.id
    RETURNING * INTO invitation_record;
  END IF;

  RETURN jsonb_build_object(
    'id', invitation_record.id,
    'organizationId', invitation_record.organization_id,
    'email', invitation_record.email_normalized,
    'invitedName', invitation_record.invited_name,
    'role', invitation_record.role,
    'status', invitation_record.status,
    'expiresAt', invitation_record.expires_at,
    'sentAt', invitation_record.sent_at,
    'acceptedAt', invitation_record.accepted_at,
    'revokedAt', invitation_record.revoked_at,
    'revision', invitation_record.revision,
    'deliveryAttempts', invitation_record.delivery_attempts,
    'lastDeliveryError', invitation_record.last_delivery_error,
    'createdAt', invitation_record.created_at,
    'updatedAt', invitation_record.updated_at
  );
END
$function$;

CREATE FUNCTION public.accept_organization_member_invitation_v1(
  p_token_hash text,
  p_actor_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  invitation_organization_id uuid;
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  invitation_record public.organization_member_invitations;
  target_identity identity.users;
  membership_count integer;
  reservation_count integer;
  final_membership_count integer;
  membership_created boolean := false;
  access_projection jsonb;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_member_invitation_acceptance' USING ERRCODE = '22023';
  END IF;

  SELECT invitation.organization_id INTO invitation_organization_id
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = invitation_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = invitation_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT invitation.* INTO invitation_record
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.token_hash = p_token_hash
    AND invitation.organization_id = invitation_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member_invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT identity_user.* INTO target_identity
  FROM identity.users AS identity_user
  WHERE identity_user.id = p_actor_user_id
  FOR SHARE;
  IF NOT FOUND
     OR target_identity.email_verified IS DISTINCT FROM true
     OR lower(btrim(target_identity.email)) <> invitation_record.email_normalized THEN
    RAISE EXCEPTION 'member_invitation_verified_email_mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF invitation_record.status = 'accepted' THEN
    IF invitation_record.accepted_by_user_id <> p_actor_user_id THEN
      RAISE EXCEPTION 'member_invitation_already_accepted'
        USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'accepted', true,
      'replayed', true,
      'membershipCreated', false,
      'invitationId', invitation_record.id,
      'organizationId', organization_record.id,
      'organizationName', organization_record.name,
      'organizationSlug', organization_record.slug,
      'userId', p_actor_user_id,
      'role', invitation_record.role
    );
  END IF;
  IF invitation_record.status IN ('expired', 'revoked') THEN
    RAISE EXCEPTION 'member_invitation_not_pending' USING ERRCODE = '23514';
  END IF;
  IF invitation_record.expires_at <= statement_timestamp() THEN
    UPDATE public.organization_member_invitations
    SET status = 'expired',
        revision = revision + 1
    WHERE id = invitation_record.id;
    RETURN jsonb_build_object(
      'accepted', false,
      'replayed', false,
      'reason', 'expired',
      'invitationId', invitation_record.id
    );
  END IF;

  access_projection := public.get_organization_billing_access_v1(
    invitation_organization_id
  );
  IF coalesce((access_projection ->> 'entitled')::boolean, false) = false
     OR coalesce(access_projection ->> 'billingAccessState', '')
       NOT IN ('active', 'grace') THEN
    RAISE EXCEPTION 'active_application_subscription_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = invitation_organization_id;
  SELECT count(*)::integer INTO reservation_count
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.organization_id = invitation_organization_id
    AND invitation.status = 'pending'
    AND invitation.expires_at > statement_timestamp();

  IF membership_count + reservation_count > billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_membership_reservation_invariant_failed'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = invitation_organization_id
      AND membership.user_id = p_actor_user_id
  ) THEN
    membership_created := false;
  ELSE
    IF membership_count >= billing_account.licensed_seat_count THEN
      RAISE EXCEPTION 'organization_seat_capacity_exhausted'
        USING ERRCODE = '23514';
    END IF;

    -- Consume the reservation first inside this transaction. If any following
    -- insert fails, PostgreSQL rolls the status change back too.
    UPDATE public.organization_member_invitations
    SET status = 'accepted',
        accepted_by_user_id = p_actor_user_id,
        accepted_at = statement_timestamp(),
        revision = revision + 1
    WHERE id = invitation_record.id;

    INSERT INTO public.users (
      id,
      organization_id,
      email,
      role,
      full_name,
      avatar_url
    ) VALUES (
      target_identity.id,
      invitation_organization_id,
      invitation_record.email_normalized,
      invitation_record.role,
      coalesce(nullif(btrim(target_identity.name), ''), invitation_record.invited_name),
      NULL
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, display_name)
    VALUES (
      target_identity.id,
      coalesce(nullif(btrim(target_identity.name), ''), invitation_record.invited_name)
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role
    ) VALUES (
      invitation_organization_id,
      target_identity.id,
      invitation_record.role
    );
    membership_created := true;
  END IF;

  IF NOT membership_created THEN
    UPDATE public.organization_member_invitations
    SET status = 'accepted',
        accepted_by_user_id = p_actor_user_id,
        accepted_at = statement_timestamp(),
        revision = revision + 1
    WHERE id = invitation_record.id;
  END IF;

  SELECT count(*)::integer INTO final_membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = invitation_organization_id;
  IF final_membership_count > billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_membership_capacity_invariant_failed'
      USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'replayed', false,
    'membershipCreated', membership_created,
    'invitationId', invitation_record.id,
    'organizationId', organization_record.id,
    'organizationName', organization_record.name,
    'organizationSlug', organization_record.slug,
    'userId', p_actor_user_id,
    'role', invitation_record.role,
    'membershipSeatCount', final_membership_count,
    'licensedSeatCount', billing_account.licensed_seat_count
  );
END
$function$;

ALTER TABLE public.organization_member_invitations
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_member_invitations_service_select
  ON public.organization_member_invitations
  FOR SELECT
  TO openexpert_service
  USING (true);

ALTER TABLE public.organization_member_invitations OWNER TO openexpert_owner;
REVOKE ALL ON TABLE public.organization_member_invitations
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT ON TABLE public.organization_member_invitations
  TO openexpert_service;

ALTER FUNCTION public.create_organization_member_invitation_v1(
  uuid, uuid, text, text, text, text, timestamp with time zone
) OWNER TO openexpert_owner;
ALTER FUNCTION public.resend_organization_member_invitation_v1(
  uuid, uuid, uuid, text, timestamp with time zone
) OWNER TO openexpert_owner;
ALTER FUNCTION public.record_organization_member_invitation_delivery_v1(
  uuid, bigint, timestamp with time zone, text
) OWNER TO openexpert_owner;
ALTER FUNCTION public.revoke_organization_member_invitation_v1(uuid, uuid, uuid)
  OWNER TO openexpert_owner;
ALTER FUNCTION public.accept_organization_member_invitation_v1(text, uuid)
  OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.create_organization_member_invitation_v1(
  uuid, uuid, text, text, text, text, timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.resend_organization_member_invitation_v1(
  uuid, uuid, uuid, text, timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.record_organization_member_invitation_delivery_v1(
  uuid, bigint, timestamp with time zone, text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.revoke_organization_member_invitation_v1(
  uuid, uuid, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.accept_organization_member_invitation_v1(text, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.create_organization_member_invitation_v1(
  uuid, uuid, text, text, text, text, timestamp with time zone
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.resend_organization_member_invitation_v1(
  uuid, uuid, uuid, text, timestamp with time zone
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.record_organization_member_invitation_delivery_v1(
  uuid, bigint, timestamp with time zone, text
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.revoke_organization_member_invitation_v1(
  uuid, uuid, uuid
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.accept_organization_member_invitation_v1(text, uuid)
  TO openexpert_service;

COMMENT ON FUNCTION public.create_organization_member_invitation_v1(
  uuid, uuid, text, text, text, text, timestamp with time zone
) IS 'Service-only atomic reservation of one already-paid application seat; never mutates Stripe.';
COMMENT ON FUNCTION public.accept_organization_member_invitation_v1(text, uuid)
  IS 'Service-only exact-email acceptance that atomically consumes a reservation and creates the membership.';

NOTIFY pgrst, 'reload schema';
