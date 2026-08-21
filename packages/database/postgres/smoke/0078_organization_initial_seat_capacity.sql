-- Rollback-only runtime coverage for migration 0078. Run only after the
-- migration has been independently reviewed and applied to a disposable
-- database branch.

BEGIN;

DO $organization_initial_seat_capacity_smoke$
DECLARE
  owner_user_id_value uuid := gen_random_uuid();
  first_member_user_id_value uuid := gen_random_uuid();
  second_member_user_id_value uuid := gen_random_uuid();
  overflow_user_id_value uuid := gen_random_uuid();
  unverified_user_id_value uuid := gen_random_uuid();
  organization_id_value uuid := gen_random_uuid();
  direct_organization_id_value uuid := gen_random_uuid();
  mismatch_organization_id_value uuid := gen_random_uuid();
  invitation_id_value uuid := gen_random_uuid();
  mismatch_invitation_id_value uuid := gen_random_uuid();
  legacy_invitation_id_value uuid := gen_random_uuid();
  event_value bigint := extract(epoch FROM statement_timestamp())::bigint;
  owner_email_value text;
  first_member_email_value text;
  second_member_email_value text;
  overflow_email_value text;
  unverified_email_value text;
  customer_id_value text;
  subscription_id_value text;
  subscription_item_id_value text;
  checkout_session_id_value text;
  price_id_value text;
  direct_customer_id_value text;
  direct_subscription_id_value text;
  direct_subscription_item_id_value text;
  direct_checkout_session_id_value text;
  direct_price_id_value text;
  mismatch_customer_id_value text;
  mismatch_subscription_id_value text;
  mismatch_subscription_item_id_value text;
  mismatch_checkout_session_id_value text;
  mismatch_price_id_value text;
  snapshot jsonb;
  access_projection jsonb;
  member_result jsonb;
  observed_source text;
  observed_initial_seats integer;
  observed_members integer;
  observed_licensed integer;
  observed_access text;
  observed_invitation_status text;
BEGIN
  owner_email_value := 'capacity-owner-'
    || replace(owner_user_id_value::text, '-', '') || '@example.test';
  first_member_email_value := 'capacity-first-'
    || replace(first_member_user_id_value::text, '-', '') || '@example.test';
  second_member_email_value := 'capacity-second-'
    || replace(second_member_user_id_value::text, '-', '') || '@example.test';
  overflow_email_value := 'capacity-overflow-'
    || replace(overflow_user_id_value::text, '-', '') || '@example.test';
  unverified_email_value := 'capacity-unverified-'
    || replace(unverified_user_id_value::text, '-', '') || '@example.test';

  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES
    (owner_user_id_value, '0078 Owner', owner_email_value, true),
    (first_member_user_id_value, '0078 First', first_member_email_value, true),
    (second_member_user_id_value, '0078 Second', second_member_email_value, true),
    (overflow_user_id_value, '0078 Overflow', overflow_email_value, true),
    (unverified_user_id_value, '0078 Unverified', unverified_email_value, false);

  -- Historical invitation inserts receive the immutable compatibility defaults.
  INSERT INTO public.organization_onboarding_invitations (
    id,
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    status,
    expires_at
  ) VALUES (
    legacy_invitation_id_value,
    md5('0078-legacy-a') || md5(legacy_invitation_id_value::text),
    owner_email_value,
    '0078 legacy invitation',
    'intermediary',
    'pending',
    statement_timestamp() + interval '1 day'
  );

  SELECT invitation.onboarding_source, invitation.initial_seat_count
  INTO STRICT observed_source, observed_initial_seats
  FROM public.organization_onboarding_invitations AS invitation
  WHERE invitation.id = legacy_invitation_id_value;

  IF observed_source <> 'superadmin_invitation'
     OR observed_initial_seats <> 1 THEN
    RAISE EXCEPTION 'organization_initial_capacity_backfill_defaults_invalid';
  END IF;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET initial_seat_count = 2
    WHERE id = legacy_invitation_id_value;
    RAISE EXCEPTION 'organization_initial_capacity_was_mutable';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.organization_onboarding_invitations (
      token_hash,
      email_normalized,
      organization_name,
      organization_kind,
      status,
      expires_at,
      initial_seat_count
    ) VALUES (
      md5('0078-intermediary-a') || md5('0078-intermediary-b'),
      owner_email_value,
      '0078 invalid intermediary capacity',
      'intermediary',
      'pending',
      statement_timestamp() + interval '1 day',
      2
    );
    RAISE EXCEPTION 'organization_intermediary_capacity_was_not_rejected';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.organization_onboarding_invitations (
      token_hash,
      email_normalized,
      organization_name,
      organization_kind,
      status,
      expires_at,
      onboarding_source,
      initial_seat_count,
      invited_by_user_id
    ) VALUES (
      md5('0078-self-inviter-a') || md5('0078-self-inviter-b'),
      owner_email_value,
      '0078 invalid self-service inviter',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'self_service',
      2,
      owner_user_id_value
    );
    RAISE EXCEPTION 'organization_self_service_inviter_was_not_rejected';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.organization_onboarding_invitations (
      token_hash,
      email_normalized,
      organization_name,
      organization_kind,
      status,
      expires_at,
      onboarding_source,
      initial_seat_count,
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_status
    ) VALUES (
      md5('0078-self-discount-a') || md5('0078-self-discount-b'),
      owner_email_value,
      '0078 invalid self-service discount',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'self_service',
      2,
      'percentage',
      1000,
      'once',
      'assigned'
    );
    RAISE EXCEPTION 'organization_self_service_discount_was_not_rejected';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  customer_id_value := 'cus_' || replace(organization_id_value::text, '-', '');
  subscription_id_value := 'sub_' || replace(organization_id_value::text, '-', '');
  subscription_item_id_value := 'si_' || replace(organization_id_value::text, '-', '');
  checkout_session_id_value := 'cs_test_' || replace(organization_id_value::text, '-', '');
  price_id_value := 'price_' || replace(organization_id_value::text, '-', '');

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0078 capacity smoke',
    'capacity-smoke-' || replace(organization_id_value::text, '-', ''),
    'application',
    'subscription_required'
  );

  INSERT INTO public.users (
    id,
    organization_id,
    email,
    role,
    full_name
  ) VALUES (
    owner_user_id_value,
    organization_id_value,
    owner_email_value,
    'admin',
    '0078 Owner'
  );

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  ) VALUES (
    organization_id_value,
    owner_user_id_value,
    'admin'
  );

  INSERT INTO public.organization_onboarding_invitations (
    id,
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    administrator_name,
    status,
    organization_id,
    accepted_by_user_id,
    expires_at,
    accepted_at,
    revision,
    onboarding_source,
    initial_seat_count
  ) VALUES (
    invitation_id_value,
    md5('0078-capacity-a') || md5(invitation_id_value::text),
    owner_email_value,
    '0078 capacity smoke',
    'application',
    '0078 Owner',
    'accepted',
    organization_id_value,
    owner_user_id_value,
    statement_timestamp() + interval '1 day',
    statement_timestamp(),
    4,
    'self_service',
    3
  );

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_customer_id,
    stripe_checkout_session_id,
    stripe_price_id,
    livemode,
    last_stripe_event_created_at
  ) VALUES (
    organization_id_value,
    customer_id_value,
    checkout_session_id_value,
    price_id_value,
    false,
    0
  );

  snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    organization_id_value,
    customer_id_value,
    subscription_id_value,
    checkout_session_id_value,
    price_id_value,
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    event_value,
    subscription_item_id_value,
    3
  );
  access_projection := public.get_organization_billing_access_v1(
    organization_id_value
  );

  SELECT count(*)::integer
  INTO observed_members
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = organization_id_value;
  SELECT account.licensed_seat_count
  INTO STRICT observed_licensed
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = organization_id_value;

  IF snapshot ->> 'billingAccessState' <> 'active'
     OR snapshot ->> 'invitationCompleted' <> 'true'
     OR snapshot #>> '{seatSnapshot,mismatch}' <> 'false'
     OR access_projection ->> 'entitled' <> 'true'
     OR observed_members <> 1
     OR observed_licensed <> 3 THEN
    RAISE EXCEPTION 'organization_initial_capacity_activation_failed';
  END IF;

  member_result := public.add_organization_member_within_capacity_v1(
    organization_id_value,
    owner_user_id_value,
    first_member_email_value,
    'expert'
  );

  SELECT count(*)::integer, account.licensed_seat_count
  INTO observed_members, observed_licensed
  FROM public.organization_billing_accounts AS account
  JOIN public.organization_memberships AS membership
    ON membership.organization_id = account.organization_id
  WHERE account.organization_id = organization_id_value
  GROUP BY account.licensed_seat_count;

  IF member_result ->> 'userId' <> first_member_user_id_value::text
     OR member_result ? 'email'
     OR member_result ? 'fullName'
     OR observed_members <> 2
     OR observed_licensed <> 3 THEN
    RAISE EXCEPTION 'organization_first_free_capacity_add_failed';
  END IF;

  -- An unverified identity cannot consume the remaining paid slot.
  BEGIN
    PERFORM public.add_organization_member_within_capacity_v1(
      organization_id_value,
      owner_user_id_value,
      unverified_email_value,
      'expert'
    );
    RAISE EXCEPTION 'organization_unverified_capacity_member_was_added';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  member_result := public.add_organization_member_within_capacity_v1(
    organization_id_value,
    owner_user_id_value,
    second_member_email_value,
    'admin'
  );

  SELECT count(*)::integer, account.licensed_seat_count
  INTO observed_members, observed_licensed
  FROM public.organization_billing_accounts AS account
  JOIN public.organization_memberships AS membership
    ON membership.organization_id = account.organization_id
  WHERE account.organization_id = organization_id_value
  GROUP BY account.licensed_seat_count;

  IF member_result ->> 'role' <> 'admin'
     OR observed_members <> 3
     OR observed_licensed <> 3 THEN
    RAISE EXCEPTION 'organization_second_free_capacity_add_failed';
  END IF;

  BEGIN
    PERFORM public.add_organization_member_within_capacity_v1(
      organization_id_value,
      owner_user_id_value,
      overflow_email_value,
      'expert'
    );
    RAISE EXCEPTION 'organization_capacity_overflow_was_not_rejected';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'organization_seat_capacity_exhausted' THEN
        RAISE;
      END IF;
  END;

  -- A newer equal-capacity snapshot leaves a fully occupied existing active
  -- organization unchanged.
  snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    organization_id_value,
    customer_id_value,
    subscription_id_value,
    NULL,
    price_id_value,
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    event_value + 1,
    subscription_item_id_value,
    3
  );

  SELECT organization.billing_access_state
  INTO STRICT observed_access
  FROM public.organizations AS organization
  WHERE organization.id = organization_id_value;
  SELECT account.licensed_seat_count
  INTO STRICT observed_licensed
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = organization_id_value;

  IF snapshot #>> '{seatSnapshot,mismatch}' <> 'false'
     OR observed_access <> 'active'
     OR observed_licensed <> 3 THEN
    RAISE EXCEPTION 'organization_existing_active_capacity_changed';
  END IF;

  -- Compatibility: the pre-0078 direct /onboarding path has no invitation. It
  -- may still activate exactly one owner at quantity one, but no larger shape.
  direct_customer_id_value := 'cus_'
    || replace(direct_organization_id_value::text, '-', '');
  direct_subscription_id_value := 'sub_'
    || replace(direct_organization_id_value::text, '-', '');
  direct_subscription_item_id_value := 'si_'
    || replace(direct_organization_id_value::text, '-', '');
  direct_checkout_session_id_value := 'cs_test_'
    || replace(direct_organization_id_value::text, '-', '');
  direct_price_id_value := 'price_'
    || replace(direct_organization_id_value::text, '-', '');

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    direct_organization_id_value,
    '0078 direct compatibility smoke',
    'capacity-direct-' || replace(direct_organization_id_value::text, '-', ''),
    'application',
    'subscription_required'
  );

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  ) VALUES (
    direct_organization_id_value,
    owner_user_id_value,
    'admin'
  );

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_customer_id,
    stripe_checkout_session_id,
    stripe_price_id,
    livemode,
    last_stripe_event_created_at
  ) VALUES (
    direct_organization_id_value,
    direct_customer_id_value,
    direct_checkout_session_id_value,
    direct_price_id_value,
    false,
    0
  );

  snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    direct_organization_id_value,
    direct_customer_id_value,
    direct_subscription_id_value,
    direct_checkout_session_id_value,
    direct_price_id_value,
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    event_value,
    direct_subscription_item_id_value,
    1
  );

  SELECT organization.billing_access_state
  INTO STRICT observed_access
  FROM public.organizations AS organization
  WHERE organization.id = direct_organization_id_value;

  IF snapshot #>> '{seatSnapshot,mismatch}' <> 'false'
     OR observed_access <> 'active' THEN
    RAISE EXCEPTION 'organization_direct_single_seat_compatibility_failed';
  END IF;

  -- A first Stripe item can bind only to the exact immutable invitation
  -- capacity. The billing half may observe active, but the atomic writer must
  -- restore accepted onboarding and leave access blocked on mismatch.
  mismatch_customer_id_value := 'cus_'
    || replace(mismatch_organization_id_value::text, '-', '');
  mismatch_subscription_id_value := 'sub_'
    || replace(mismatch_organization_id_value::text, '-', '');
  mismatch_subscription_item_id_value := 'si_'
    || replace(mismatch_organization_id_value::text, '-', '');
  mismatch_checkout_session_id_value := 'cs_test_'
    || replace(mismatch_organization_id_value::text, '-', '');
  mismatch_price_id_value := 'price_'
    || replace(mismatch_organization_id_value::text, '-', '');

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    mismatch_organization_id_value,
    '0078 mismatch smoke',
    'capacity-mismatch-' || replace(mismatch_organization_id_value::text, '-', ''),
    'application',
    'subscription_required'
  );

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  ) VALUES (
    mismatch_organization_id_value,
    owner_user_id_value,
    'admin'
  );

  INSERT INTO public.organization_onboarding_invitations (
    id,
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    status,
    organization_id,
    accepted_by_user_id,
    expires_at,
    accepted_at,
    onboarding_source,
    initial_seat_count
  ) VALUES (
    mismatch_invitation_id_value,
    md5('0078-mismatch-a') || md5(mismatch_invitation_id_value::text),
    owner_email_value,
    '0078 mismatch smoke',
    'application',
    'accepted',
    mismatch_organization_id_value,
    owner_user_id_value,
    statement_timestamp() + interval '1 day',
    statement_timestamp(),
    'superadmin_invitation',
    2
  );

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_customer_id,
    stripe_checkout_session_id,
    stripe_price_id,
    livemode,
    last_stripe_event_created_at
  ) VALUES (
    mismatch_organization_id_value,
    mismatch_customer_id_value,
    mismatch_checkout_session_id_value,
    mismatch_price_id_value,
    false,
    0
  );

  snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    mismatch_organization_id_value,
    mismatch_customer_id_value,
    mismatch_subscription_id_value,
    mismatch_checkout_session_id_value,
    mismatch_price_id_value,
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    event_value,
    mismatch_subscription_item_id_value,
    3
  );

  SELECT organization.billing_access_state
  INTO STRICT observed_access
  FROM public.organizations AS organization
  WHERE organization.id = mismatch_organization_id_value;
  SELECT invitation.status
  INTO STRICT observed_invitation_status
  FROM public.organization_onboarding_invitations AS invitation
  WHERE invitation.id = mismatch_invitation_id_value;

  IF snapshot #>> '{seatSnapshot,mismatch}' <> 'true'
     OR snapshot #>> '{seatSnapshot,mismatchReason}' <>
       'initial_seat_quantity_invitation_mismatch'
     OR observed_access <> 'blocked'
     OR observed_invitation_status <> 'accepted' THEN
    RAISE EXCEPTION 'organization_wrong_initial_capacity_was_not_blocked';
  END IF;

  IF has_function_privilege(
       'authenticated',
       'public.add_organization_member_within_capacity_v1(uuid,uuid,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anonymous',
       'public.add_organization_member_within_capacity_v1(uuid,uuid,text,text)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'openexpert_service',
       'public.add_organization_member_within_capacity_v1(uuid,uuid,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'openexpert_service',
       'private.apply_organization_seat_snapshot_generation_v1(uuid,text,text,integer,bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'organization_initial_capacity_rpc_acl_invalid';
  END IF;
END;
$organization_initial_seat_capacity_smoke$;

ROLLBACK;

-- The companion 0078_organization_initial_seat_capacity_mvcc.sh exercises two
-- committed sessions racing for one final available seat. This file remains
-- rollback-only and never persists its identity or organization fixtures.
