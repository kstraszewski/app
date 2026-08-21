CREATE OR REPLACE FUNCTION public.apply_organization_seat_snapshot_v1(
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

  IF p_event_created < billing_account.last_stripe_event_created_at THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'mismatch', false,
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

  IF billing_account.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id THEN
    mismatch_reason := 'stripe_subscription_mismatch';
  ELSIF EXISTS (
    SELECT 1
    FROM public.organization_billing_accounts AS other_account
    WHERE other_account.stripe_subscription_item_id = p_stripe_subscription_item_id
      AND other_account.organization_id <> p_organization_id
  ) THEN
    mismatch_reason := 'stripe_subscription_item_already_bound';
  ELSIF billing_account.stripe_subscription_item_id IS NULL THEN
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

    IF p_quantity <> membership_count THEN
      mismatch_reason := 'initial_seat_quantity_membership_mismatch';
    END IF;
  ELSIF billing_account.stripe_subscription_item_id <> p_stripe_subscription_item_id
        AND open_change.id IS NULL
        AND p_quantity = billing_account.licensed_seat_count
        AND p_quantity = membership_count THEN
    -- A completed re-subscribe updates the billing account subscription before
    -- this item snapshot arrives. Rebind only when no paid seat transition is
    -- in flight and both local sources already agree with canonical quantity.
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
  ELSIF billing_account.stripe_subscription_item_id <> p_stripe_subscription_item_id THEN
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

    IF membership_count <> p_quantity THEN
      mismatch_reason := 'canonical_quantity_membership_mismatch';
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
    'organizationId', p_organization_id,
    'licensedSeatCount', billing_account.licensed_seat_count,
    'seatRevision', billing_account.seat_revision,
    'membershipSeatCount', membership_count,
    'completedSeatChangeId', NULL,
    'membershipCreated', false
  );
END
$function$;

ALTER FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) TO openexpert_service;

COMMENT ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) IS
  'Applies canonical Stripe seat quantity, finalizes matching add-member sagas, and safely rebinds a replacement subscription item after re-subscribe.';

