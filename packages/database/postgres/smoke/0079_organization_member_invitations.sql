-- Rollback-only runtime coverage for migration 0079. Run only after the
-- migration has been independently reviewed, or load migration 0079 in the
-- same disposable transaction before this file.

BEGIN;

DO $organization_member_invitations_smoke$
DECLARE
  owner_id uuid := gen_random_uuid();
  invited_id uuid := gen_random_uuid();
  second_invited_id uuid := gen_random_uuid();
  existing_id uuid := gen_random_uuid();
  wrong_id uuid := gen_random_uuid();
  organization_id_value uuid := gen_random_uuid();
  stale_invitation_id uuid := gen_random_uuid();
  first_invitation_id uuid;
  second_invitation_id uuid;
  owner_email text;
  invited_email text;
  second_invited_email text;
  existing_email text;
  wrong_email text;
  stale_email text;
  first_token_hash text := md5('0079-first-a') || md5('0079-first-b');
  second_token_hash text := md5('0079-second-a') || md5('0079-second-b');
  third_token_hash text := md5('0079-third-a') || md5('0079-third-b');
  stale_token_hash text := md5('0079-stale-a') || md5('0079-stale-b');
  result jsonb;
  membership_count integer;
  reservation_count integer;
  licensed_count integer;
  subscription_item_before text;
  subscription_item_after text;
  observed_status text;
BEGIN
  owner_email := 'member-invite-owner-'
    || replace(owner_id::text, '-', '') || '@example.test';
  invited_email := 'member-invite-first-'
    || replace(invited_id::text, '-', '') || '@example.test';
  second_invited_email := 'member-invite-second-'
    || replace(second_invited_id::text, '-', '') || '@example.test';
  existing_email := 'member-invite-existing-'
    || replace(existing_id::text, '-', '') || '@example.test';
  wrong_email := 'member-invite-wrong-'
    || replace(wrong_id::text, '-', '') || '@example.test';
  stale_email := 'member-invite-stale-'
    || replace(stale_invitation_id::text, '-', '') || '@example.test';

  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES
    (owner_id, '0079 Owner', owner_email, true),
    (existing_id, '0079 Existing', existing_email, true),
    (wrong_id, '0079 Wrong', wrong_email, true);

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0079 member invitation smoke',
    'member-invite-' || replace(organization_id_value::text, '-', ''),
    'application',
    'active'
  );

  INSERT INTO public.users (id, organization_id, email, role, full_name)
  VALUES (owner_id, organization_id_value, owner_email, 'admin', '0079 Owner');
  INSERT INTO public.organization_memberships (organization_id, user_id, role)
  VALUES (organization_id_value, owner_id, 'admin');

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_subscription_item_id,
    stripe_price_id,
    stripe_subscription_status,
    current_period_start,
    current_period_end,
    last_synced_at,
    licensed_seat_count
  ) VALUES (
    organization_id_value,
    'cus_' || replace(organization_id_value::text, '-', ''),
    'sub_' || replace(organization_id_value::text, '-', ''),
    'si_' || replace(organization_id_value::text, '-', ''),
    'price_' || replace(organization_id_value::text, '-', ''),
    'active',
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    statement_timestamp(),
    3
  );

  SELECT account.stripe_subscription_item_id
  INTO STRICT subscription_item_before
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = organization_id_value;

  -- A stale row does not reserve capacity. The next create lazily moves it to
  -- expired, so the same address may safely receive a new reservation.
  INSERT INTO public.organization_member_invitations (
    id,
    organization_id,
    token_hash,
    email_normalized,
    role,
    status,
    invited_by_user_id,
    created_at,
    expires_at
  ) VALUES (
    stale_invitation_id,
    organization_id_value,
    stale_token_hash,
    stale_email,
    'expert',
    'pending',
    owner_id,
    statement_timestamp() - interval '2 days',
    statement_timestamp() - interval '1 day'
  );

  result := public.create_organization_member_invitation_v1(
    organization_id_value,
    owner_id,
    stale_email,
    'expert',
    '0079 Stale Replacement',
    third_token_hash,
    statement_timestamp() + interval '1 day'
  );
  first_invitation_id := (result ->> 'id')::uuid;

  SELECT invitation.status INTO STRICT observed_status
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.id = stale_invitation_id;
  IF observed_status <> 'expired'
     OR result ->> 'reservedSeatCount' <> '1' THEN
    RAISE EXCEPTION 'member_invitation_expiry_did_not_free_capacity';
  END IF;

  -- Revoke immediately frees the same paid slot without touching Stripe.
  result := public.revoke_organization_member_invitation_v1(
    organization_id_value,
    owner_id,
    first_invitation_id
  );
  IF result ->> 'status' <> 'revoked' THEN
    RAISE EXCEPTION 'member_invitation_revoke_failed';
  END IF;

  result := public.create_organization_member_invitation_v1(
    organization_id_value,
    owner_id,
    invited_email,
    'expert',
    '0079 Invited',
    first_token_hash,
    statement_timestamp() + interval '1 day'
  );
  first_invitation_id := (result ->> 'id')::uuid;
  result := public.create_organization_member_invitation_v1(
    organization_id_value,
    owner_id,
    second_invited_email,
    'admin',
    NULL,
    second_token_hash,
    statement_timestamp() + interval '1 day'
  );
  second_invitation_id := (result ->> 'id')::uuid;

  SELECT count(*)::integer INTO reservation_count
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.organization_id = organization_id_value
    AND invitation.status = 'pending'
    AND invitation.expires_at > statement_timestamp();
  IF reservation_count <> 2 THEN
    RAISE EXCEPTION 'member_invitation_reservations_not_counted';
  END IF;

  BEGIN
    PERFORM public.create_organization_member_invitation_v1(
      organization_id_value,
      owner_id,
      'overflow-' || replace(gen_random_uuid()::text, '-', '') || '@example.test',
      'expert',
      NULL,
      md5('0079-overflow-a') || md5('0079-overflow-b'),
      statement_timestamp() + interval '1 day'
    );
    RAISE EXCEPTION 'member_invitation_capacity_overflow_was_accepted';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'organization_seat_capacity_exhausted' THEN RAISE; END IF;
  END;

  -- The general existing-identity writer must also respect reservations.
  BEGIN
    PERFORM public.add_organization_member_within_capacity_v1(
      organization_id_value,
      owner_id,
      existing_email,
      'expert'
    );
    RAISE EXCEPTION 'member_write_bypassed_pending_reservations';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'organization_seat_capacity_exhausted' THEN RAISE; END IF;
  END;

  -- Better Auth creates and verifies the invited identity only after the
  -- invitation was issued. A different verified identity cannot consume it.
  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES (invited_id, '0079 Invited', invited_email, true);
  BEGIN
    PERFORM public.accept_organization_member_invitation_v1(
      first_token_hash,
      wrong_id
    );
    RAISE EXCEPTION 'member_invitation_wrong_email_was_accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM <> 'member_invitation_verified_email_mismatch' THEN RAISE; END IF;
  END;

  result := public.accept_organization_member_invitation_v1(
    first_token_hash,
    invited_id
  );
  IF result ->> 'accepted' <> 'true'
     OR result ->> 'membershipCreated' <> 'true'
     OR result ->> 'userId' <> invited_id::text THEN
    RAISE EXCEPTION 'member_invitation_acceptance_failed';
  END IF;

  result := public.accept_organization_member_invitation_v1(
    first_token_hash,
    invited_id
  );
  IF result ->> 'replayed' <> 'true' THEN
    RAISE EXCEPTION 'member_invitation_acceptance_not_idempotent';
  END IF;

  -- The second identity is initially unverified and cannot accept. Verification
  -- followed by acceptance atomically replaces the last reservation.
  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES (second_invited_id, '0079 Second', second_invited_email, false);
  BEGIN
    PERFORM public.accept_organization_member_invitation_v1(
      second_token_hash,
      second_invited_id
    );
    RAISE EXCEPTION 'member_invitation_unverified_identity_was_accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN
      IF SQLERRM <> 'member_invitation_verified_email_mismatch' THEN RAISE; END IF;
  END;

  UPDATE identity.users
  SET email_verified = true
  WHERE id = second_invited_id;
  result := public.accept_organization_member_invitation_v1(
    second_token_hash,
    second_invited_id
  );

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = organization_id_value;
  SELECT count(*)::integer INTO reservation_count
  FROM public.organization_member_invitations AS invitation
  WHERE invitation.organization_id = organization_id_value
    AND invitation.status = 'pending'
    AND invitation.expires_at > statement_timestamp();
  SELECT account.licensed_seat_count, account.stripe_subscription_item_id
  INTO STRICT licensed_count, subscription_item_after
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = organization_id_value;

  IF result ->> 'role' <> 'admin'
     OR membership_count <> 3
     OR reservation_count <> 0
     OR licensed_count <> 3
     OR subscription_item_after <> subscription_item_before THEN
    RAISE EXCEPTION 'member_invitation_final_capacity_or_stripe_invariant_failed';
  END IF;

  IF has_table_privilege('authenticated', 'public.organization_member_invitations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.organization_member_invitations', 'INSERT')
     OR has_table_privilege('openexpert_service', 'public.organization_member_invitations', 'INSERT')
     OR NOT has_table_privilege('openexpert_service', 'public.organization_member_invitations', 'SELECT')
     OR has_function_privilege(
       'authenticated',
       'public.accept_organization_member_invitation_v1(text,uuid)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'openexpert_service',
       'public.accept_organization_member_invitation_v1(text,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'member_invitation_acl_invalid';
  END IF;
END
$organization_member_invitations_smoke$;

ROLLBACK;
