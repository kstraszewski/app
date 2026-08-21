-- Paid application seats are capacity, not a requirement to provision fake
-- identities. An accepted onboarding invitation is the immutable authority for
-- every multi-seat first Stripe quantity; the legacy direct one-owner/one-seat
-- flow remains compatible. Afterwards memberships may occupy any number of paid
-- seats from one through the licensed quantity.

ALTER TABLE public.organization_onboarding_invitations
  ADD COLUMN onboarding_source text,
  ADD COLUMN initial_seat_count integer;

UPDATE public.organization_onboarding_invitations
SET onboarding_source = 'superadmin_invitation',
    initial_seat_count = 1
WHERE onboarding_source IS NULL
   OR initial_seat_count IS NULL;

ALTER TABLE public.organization_onboarding_invitations
  ALTER COLUMN onboarding_source SET DEFAULT 'superadmin_invitation',
  ALTER COLUMN onboarding_source SET NOT NULL,
  ALTER COLUMN initial_seat_count SET DEFAULT 1,
  ALTER COLUMN initial_seat_count SET NOT NULL,
  ADD CONSTRAINT organization_onboarding_invitations_source_check CHECK (
    onboarding_source IN ('superadmin_invitation', 'self_service')
  ) NOT VALID,
  ADD CONSTRAINT organization_onboarding_invitations_initial_seats_check CHECK (
    initial_seat_count BETWEEN 1 AND 1000
  ) NOT VALID,
  ADD CONSTRAINT organization_onboarding_invitations_kind_capacity_check CHECK (
    organization_kind = 'application' OR initial_seat_count = 1
  ) NOT VALID,
  ADD CONSTRAINT organization_onboarding_invitations_self_service_check CHECK (
    onboarding_source <> 'self_service'
    OR (
      organization_kind = 'application'
      AND invited_by_user_id IS NULL
      AND discount_kind IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.organization_onboarding_invitations
  VALIDATE CONSTRAINT organization_onboarding_invitations_source_check,
  VALIDATE CONSTRAINT organization_onboarding_invitations_initial_seats_check,
  VALIDATE CONSTRAINT organization_onboarding_invitations_kind_capacity_check,
  VALIDATE CONSTRAINT organization_onboarding_invitations_self_service_check;

CREATE FUNCTION private.enforce_organization_onboarding_capacity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF ROW(new.onboarding_source, new.initial_seat_count) IS DISTINCT FROM
     ROW(old.onboarding_source, old.initial_seat_count) THEN
    RAISE EXCEPTION 'organization_onboarding_capacity_is_immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN new;
END
$function$;

ALTER FUNCTION private.enforce_organization_onboarding_capacity_immutable()
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.enforce_organization_onboarding_capacity_immutable()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER organization_onboarding_invitations_capacity_immutable
  BEFORE UPDATE OF onboarding_source, initial_seat_count
  ON public.organization_onboarding_invitations
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_organization_onboarding_capacity_immutable();

COMMENT ON COLUMN public.organization_onboarding_invitations.onboarding_source IS
  'Immutable onboarding origin. Public self-service offers cannot carry an assigned invitation discount.';
COMMENT ON COLUMN public.organization_onboarding_invitations.initial_seat_count IS
  'Immutable initial application capacity charged by the first Stripe Checkout; includes the owner seat.';

-- Keep every subscription, invoice-anomaly, and grace fence from migration
-- 0068. Only replace the former seat equality with the paid-capacity range.
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
          AND billing_account.stripe_subscription_item_id IS NOT NULL
          AND (
            SELECT count(*)::integer
            FROM public.organization_memberships AS membership
            WHERE membership.organization_id = organization.id
          ) BETWEEN 1 AND billing_account.licensed_seat_count
          AND (
            (
              NOT EXISTS (
                SELECT 1
                FROM public.organization_billing_invoice_states AS invoice_state
                WHERE invoice_state.organization_id = organization.id
                  AND invoice_state.stripe_subscription_id =
                    billing_account.stripe_subscription_id
                  AND invoice_state.state = 'failed'
              )
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
            OR (
              organization.billing_access_state = 'grace'
              AND (
                billing_account.stripe_subscription_status IN ('active', 'trialing')
                OR (
                  billing_account.stripe_subscription_status = 'past_due'
                  AND billing_account.grace_until > statement_timestamp()
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.organization_billing_invoice_states AS invoice_state
                WHERE invoice_state.organization_id = organization.id
                  AND invoice_state.stripe_subscription_id =
                    billing_account.stripe_subscription_id
                  AND invoice_state.state = 'failed'
                  AND invoice_state.grace_until <= statement_timestamp()
              )
              AND EXISTS (
                SELECT 1
                FROM public.organization_billing_invoice_states AS invoice_state
                WHERE invoice_state.organization_id = organization.id
                  AND invoice_state.stripe_subscription_id =
                    billing_account.stripe_subscription_id
                  AND invoice_state.state = 'failed'
              )
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
  TO authenticated;

-- Preserve the authoritative access projection from migration 0069, including
-- its earliest invoice/subscription grace deadline. Capacity is valid only
-- while at least the owner and at most the paid seat quantity are members.
CREATE OR REPLACE FUNCTION public.get_organization_billing_access_v1(
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  membership_count integer;
  invoice_failure_grace timestamp with time zone;
  effective_grace timestamp with time zone;
  effective_state text;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF organization_record.kind = 'intermediary' THEN
    RETURN jsonb_build_object(
      'organizationId', p_organization_id,
      'billingAccessState', 'not_required',
      'entitled', true,
      'graceUntil', NULL
    );
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id;

  IF NOT FOUND THEN
    effective_state := CASE
      WHEN organization_record.billing_access_state = 'subscription_required'
        THEN 'subscription_required'
      ELSE 'blocked'
    END;
    RETURN jsonb_build_object(
      'organizationId', p_organization_id,
      'billingAccessState', effective_state,
      'entitled', false,
      'graceUntil', NULL
    );
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  SELECT min(invoice_state.grace_until)
  INTO invoice_failure_grace
  FROM public.organization_billing_invoice_states AS invoice_state
  WHERE invoice_state.organization_id = p_organization_id
    AND invoice_state.stripe_subscription_id = billing_account.stripe_subscription_id
    AND invoice_state.state = 'failed';

  IF organization_record.billing_access_state = 'subscription_required' THEN
    effective_state := 'subscription_required';
  ELSIF organization_record.billing_access_state = 'blocked'
        OR billing_account.stripe_subscription_item_id IS NULL
        OR membership_count < 1
        OR membership_count > billing_account.licensed_seat_count THEN
    effective_state := 'blocked';
  ELSIF billing_account.stripe_subscription_status IN ('active', 'trialing') THEN
    IF invoice_failure_grace IS NULL
       AND organization_record.billing_access_state = 'active' THEN
      effective_state := 'active';
    ELSIF invoice_failure_grace > statement_timestamp()
          AND organization_record.billing_access_state = 'grace' THEN
      effective_state := 'grace';
      effective_grace := invoice_failure_grace;
    ELSE
      effective_state := 'blocked';
    END IF;
  ELSIF billing_account.stripe_subscription_status = 'past_due'
        AND billing_account.grace_until IS NOT NULL
        AND organization_record.billing_access_state = 'grace' THEN
    effective_grace := billing_account.grace_until;
    IF invoice_failure_grace IS NOT NULL THEN
      effective_grace := least(effective_grace, invoice_failure_grace);
    END IF;
    effective_state := CASE
      WHEN effective_grace > statement_timestamp() THEN 'grace'
      ELSE 'blocked'
    END;
  ELSE
    effective_state := 'blocked';
  END IF;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'billingAccessState', effective_state,
    'entitled', effective_state IN ('active', 'grace'),
    'graceUntil', effective_grace
  );
END
$function$;

ALTER FUNCTION public.get_organization_billing_access_v1(uuid)
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION public.get_organization_billing_access_v1(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_organization_billing_access_v1(uuid)
  TO openexpert_service;

COMMENT ON FUNCTION public.get_organization_billing_access_v1(uuid) IS
  'Returns the authoritative capacity-, subscription-, and invoice-aware billing access projection for a server session.';

-- Migration 0074 made this private function the only seat half used by the
-- atomic billing+seat writer. Keep its generation fence and the existing paid
-- +1 saga, while allowing unoccupied licensed capacity.
CREATE OR REPLACE FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_subscription_item_id text,
  p_quantity integer,
  p_event_created bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  open_change public.organization_billing_seat_changes;
  target_identity identity.users;
  membership_count integer;
  final_membership_count integer;
  invitation_initial_seat_count integer;
  completed_change_id uuid;
  membership_created boolean := false;
  mismatch_reason text;
  event_replayed boolean := false;
  previous_licensed_seat_count integer;
BEGIN
  IF p_organization_id IS NULL
     OR p_stripe_subscription_id IS NULL
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_stripe_subscription_item_id IS NULL
     OR p_stripe_subscription_item_id !~ '^si_[A-Za-z0-9]+$'
     OR p_quantity IS NULL
     OR p_quantity < 1
     OR p_quantity > 1000
     OR p_event_created IS NULL
     OR p_event_created < 0 THEN
    RAISE EXCEPTION 'invalid_organization_seat_snapshot'
      USING ERRCODE = '22023';
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
  previous_licensed_seat_count := billing_account.licensed_seat_count;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  -- A late event from another subscription generation is stale, not a reason
  -- to mutate or block the current paid capacity.
  IF billing_account.stripe_subscription_id IS DISTINCT FROM
     p_stripe_subscription_id THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'mismatch', false,
      'subscriptionAccepted', false,
      'organizationId', p_organization_id,
      'licensedSeatCount', billing_account.licensed_seat_count,
      'seatRevision', billing_account.seat_revision,
      'membershipSeatCount', membership_count,
      'completedSeatChangeId', NULL,
      'membershipCreated', false
    );
  END IF;

  IF p_event_created < billing_account.last_stripe_event_created_at THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'mismatch', false,
      'subscriptionAccepted', true,
      'organizationId', p_organization_id,
      'licensedSeatCount', billing_account.licensed_seat_count,
      'seatRevision', billing_account.seat_revision,
      'membershipSeatCount', membership_count,
      'completedSeatChangeId', NULL,
      'membershipCreated', false
    );
  END IF;
  event_replayed := p_event_created = billing_account.last_stripe_event_created_at;

  SELECT seat_change.* INTO open_change
  FROM public.organization_billing_seat_changes AS seat_change
  WHERE seat_change.organization_id = p_organization_id
    AND seat_change.status IN ('prepared', 'pending')
  ORDER BY seat_change.created_at
  LIMIT 1
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.organization_billing_accounts AS other_account
    WHERE other_account.stripe_subscription_item_id = p_stripe_subscription_item_id
      AND other_account.organization_id <> p_organization_id
  ) THEN
    mismatch_reason := 'stripe_subscription_item_already_bound';
  ELSIF billing_account.stripe_subscription_item_id IS NULL THEN
    SELECT invitation.initial_seat_count
    INTO invitation_initial_seat_count
    FROM public.organization_onboarding_invitations AS invitation
    WHERE invitation.organization_id = p_organization_id
      AND invitation.organization_kind = 'application'
      AND invitation.status IN ('accepted', 'completed')
    FOR SHARE;

    UPDATE public.organization_billing_accounts
    SET stripe_subscription_item_id = p_stripe_subscription_item_id,
        licensed_seat_count = p_quantity,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    IF invitation_initial_seat_count IS NULL
       AND (p_quantity <> 1 OR membership_count <> 1) THEN
      -- Compatibility for the existing direct /onboarding flow: before 0078 it
      -- creates a one-owner application without an invitation. It may bind only
      -- the historical one-seat shape; every multi-seat first bind requires an
      -- immutable invitation authority.
      mismatch_reason := 'initial_seat_invitation_required';
    ELSIF invitation_initial_seat_count IS NOT NULL
          AND invitation_initial_seat_count <> p_quantity THEN
      mismatch_reason := 'initial_seat_quantity_invitation_mismatch';
    ELSIF membership_count < 1 OR membership_count > p_quantity THEN
      mismatch_reason := 'initial_membership_capacity_mismatch';
    END IF;
  ELSIF billing_account.stripe_subscription_item_id <>
        p_stripe_subscription_item_id
        AND open_change.id IS NULL
        AND p_quantity = billing_account.licensed_seat_count
        AND membership_count BETWEEN 1 AND p_quantity THEN
    -- A replacement subscription may bind a new item only when canonical
    -- capacity is unchanged and no paid seat transition is open.
    UPDATE public.organization_billing_accounts
    SET stripe_subscription_item_id = p_stripe_subscription_item_id,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;
    event_replayed := false;
  ELSIF billing_account.stripe_subscription_item_id <>
        p_stripe_subscription_item_id THEN
    mismatch_reason := 'stripe_subscription_item_mismatch';
  ELSIF p_quantity = billing_account.licensed_seat_count THEN
    UPDATE public.organization_billing_accounts
    SET last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    IF membership_count < 1 OR membership_count > p_quantity THEN
      mismatch_reason := 'canonical_membership_capacity_mismatch';
    END IF;
  ELSIF p_quantity > billing_account.licensed_seat_count
        AND open_change.id IS NOT NULL
        AND open_change.stripe_subscription_id = p_stripe_subscription_id
        AND open_change.stripe_subscription_item_id = p_stripe_subscription_item_id
        AND open_change.expected_seat_count = billing_account.licensed_seat_count
        AND open_change.expected_seat_count = membership_count
        AND open_change.target_seat_count = p_quantity
        AND open_change.base_seat_revision = billing_account.seat_revision
        AND NOT EXISTS (
          SELECT 1
          FROM public.organization_memberships AS target_membership
          WHERE target_membership.organization_id = p_organization_id
            AND target_membership.user_id = open_change.target_user_id
        ) THEN
    -- The legacy paid +1 saga is valid only once every existing licensed seat
    -- is occupied. Free capacity additions use the separate service RPC below.
    UPDATE public.organization_billing_accounts
    SET licensed_seat_count = p_quantity,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    SELECT identity_user.* INTO STRICT target_identity
    FROM identity.users AS identity_user
    WHERE identity_user.id = open_change.target_user_id;

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
      open_change.target_role,
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
      open_change.target_user_id,
      open_change.target_role
    );
    membership_created := true;

    SELECT count(*)::integer INTO final_membership_count
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id;

    IF final_membership_count = open_change.target_seat_count THEN
      UPDATE public.organization_billing_seat_changes
      SET status = 'succeeded',
          failure_code = NULL,
          failure_message = NULL,
          completed_at = statement_timestamp()
      WHERE id = open_change.id
      RETURNING id INTO completed_change_id;

      RETURN jsonb_build_object(
        'applied', true,
        'stale', false,
        'replayed', false,
        'mismatch', false,
        'subscriptionAccepted', true,
        'organizationId', p_organization_id,
        'licensedSeatCount', billing_account.licensed_seat_count,
        'seatRevision', billing_account.seat_revision,
        'membershipSeatCount', final_membership_count,
        'completedSeatChangeId', completed_change_id,
        'membershipCreated', membership_created
      );
    END IF;

    membership_count := final_membership_count;
    mismatch_reason := 'membership_finalize_count_mismatch';
  ELSE
    -- Stripe remains the canonical external observation, but an unsupported
    -- increase/decrease is mirrored only into a blocked local state.
    UPDATE public.organization_billing_accounts
    SET licensed_seat_count = p_quantity,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    mismatch_reason := CASE
      WHEN p_quantity < previous_licensed_seat_count
        THEN 'seat_decrease_unsupported'
      ELSE 'seat_increase_without_matching_change'
    END;
  END IF;

  IF mismatch_reason IS NOT NULL THEN
    UPDATE public.organizations
    SET billing_access_state = 'blocked'
    WHERE id = p_organization_id;

    IF open_change.id IS NOT NULL THEN
      UPDATE public.organization_billing_seat_changes
      SET status = 'failed',
          failure_code = 'canonical_seat_mismatch',
          failure_message = left(mismatch_reason, 2000),
          completed_at = statement_timestamp()
      WHERE id = open_change.id
        AND status IN ('prepared', 'pending');
    END IF;

    RETURN jsonb_build_object(
      'applied', true,
      'stale', false,
      'replayed', event_replayed,
      'mismatch', true,
      'mismatchReason', mismatch_reason,
      'subscriptionAccepted', true,
      'organizationId', p_organization_id,
      'licensedSeatCount', billing_account.licensed_seat_count,
      'seatRevision', billing_account.seat_revision,
      'membershipSeatCount', membership_count,
      'completedSeatChangeId', NULL,
      'membershipCreated', membership_created
    );
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'stale', false,
    'replayed', event_replayed,
    'mismatch', false,
    'subscriptionAccepted', true,
    'organizationId', p_organization_id,
    'licensedSeatCount', billing_account.licensed_seat_count,
    'seatRevision', billing_account.seat_revision,
    'membershipSeatCount', membership_count,
    'completedSeatChangeId', NULL,
    'membershipCreated', false
  );
END
$function$;

ALTER FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

COMMENT ON FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) IS
  'Applies generation-fenced Stripe capacity, authorizes the immutable invitation quantity (or legacy direct quantity one) on first bind, and delegates paid increases only to a matching full-capacity seat saga.';

-- Add an already verified identity without touching Stripe when a paid seat is
-- free. Only the trusted service can name the actor; the function itself
-- verifies that the actor is a direct organization admin.
CREATE FUNCTION public.add_organization_member_within_capacity_v1(
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

  -- Shared writer order: organization, then billing account. This serializes
  -- two callers racing for the final available seat.
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

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  IF membership_count < 1
     OR membership_count >= billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_seat_capacity_exhausted'
      USING ERRCODE = '23514';
  END IF;

  SELECT identity_user.* INTO target_identity
  FROM identity.users AS identity_user
  WHERE lower(identity_user.email) = normalized_email
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

  IF final_membership_count > billing_account.licensed_seat_count THEN
    RAISE EXCEPTION 'organization_membership_capacity_invariant_failed'
      USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'organizationId', inserted_membership.organization_id,
    'userId', inserted_membership.user_id,
    'role', inserted_membership.role,
    'createdAt', inserted_membership.created_at,
    'membershipSeatCount', final_membership_count,
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
  'Service-only atomic add of one verified application member into already-paid capacity; never mutates Stripe quantity.';

NOTIFY pgrst, 'reload schema';
