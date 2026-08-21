-- Standalone, rollback-only runtime smoke for both serializations of the
-- Stripe-mutation/recovery race fixed by migration 0073.

BEGIN;

DO $organization_seat_change_fence_smoke$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  actor_user_id_value uuid;
  target_user_id_value uuid;
  target_email_value text;
  seat_change_id_value uuid;
  observed_updated_at timestamp with time zone;
  claim_result jsonb;
  recovery_result jsonb;
  begin_result jsonb;
BEGIN
  SELECT identity_user.id INTO actor_user_id_value
  FROM identity.users AS identity_user
  WHERE identity_user.email_verified
  ORDER BY identity_user.created_at, identity_user.id
  LIMIT 1;

  SELECT identity_user.id, lower(btrim(identity_user.email))
  INTO target_user_id_value, target_email_value
  FROM identity.users AS identity_user
  WHERE identity_user.email_verified
    AND identity_user.id <> actor_user_id_value
  ORDER BY identity_user.created_at, identity_user.id
  LIMIT 1;

  IF actor_user_id_value IS NULL OR target_user_id_value IS NULL THEN
    RAISE EXCEPTION 'organization_seat_change_fence_identity_fixture_missing';
  END IF;

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0073 seat fence smoke',
    'seat-fence-' || replace(organization_id_value::text, '-', ''),
    'application',
    'active'
  );

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    stripe_subscription_status,
    stripe_subscription_item_id,
    licensed_seat_count,
    seat_revision,
    current_period_start,
    current_period_end,
    last_synced_at
  ) VALUES (
    organization_id_value,
    'cus_0073FenceSmoke',
    'sub_0073FenceSmoke',
    'price_0073FenceSmoke',
    'active',
    'si_0073FenceSmoke',
    1,
    1,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    statement_timestamp()
  );

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  ) VALUES (
    organization_id_value,
    actor_user_id_value,
    'admin'
  );

  -- Interleaving A: recovery CAS wins. A later mutation claim must miss, so
  -- the server cannot call Stripe after the saga became terminal.
  INSERT INTO public.organization_billing_seat_changes (
    organization_id,
    actor_user_id,
    target_user_id,
    target_email_normalized,
    target_role,
    idempotency_key,
    request_fingerprint,
    stripe_idempotency_key,
    stripe_subscription_id,
    stripe_subscription_item_id,
    expected_seat_count,
    target_seat_count,
    base_seat_revision,
    proration_date,
    created_at,
    updated_at
  ) VALUES (
    organization_id_value,
    actor_user_id_value,
    target_user_id_value,
    target_email_value,
    'expert',
    gen_random_uuid(),
    repeat('a', 64),
    'openexpert-seat-change-' || replace(gen_random_uuid()::text, '-', ''),
    'sub_0073FenceSmoke',
    'si_0073FenceSmoke',
    1,
    2,
    1,
    statement_timestamp(),
    statement_timestamp() - interval '20 minutes',
    statement_timestamp() - interval '20 minutes'
  )
  RETURNING id, updated_at INTO seat_change_id_value, observed_updated_at;

  recovery_result := public.fail_stale_organization_member_seat_change_v1(
    seat_change_id_value,
    observed_updated_at,
    statement_timestamp() - interval '10 minutes',
    'smoke_recovery_won',
    'Recovery won before the Stripe mutation claim'
  );
  IF recovery_result ->> 'failed' <> 'true' THEN
    RAISE EXCEPTION 'organization_seat_change_fence_recovery_did_not_win';
  END IF;

  claim_result := public.claim_organization_member_seat_stripe_update_v1(
    seat_change_id_value,
    observed_updated_at
  );
  IF claim_result ->> 'claimed' <> 'false'
     OR claim_result ->> 'status' <> 'failed' THEN
    RAISE EXCEPTION 'organization_seat_change_fence_mutation_followed_terminal_recovery';
  END IF;

  DELETE FROM public.organization_billing_seat_changes
  WHERE id = seat_change_id_value;

  -- Interleaving B: mutation CAS wins. The touch changes the revision and age;
  -- stale recovery using its observation must miss and leave the saga pending.
  INSERT INTO public.organization_billing_seat_changes (
    organization_id,
    actor_user_id,
    target_user_id,
    target_email_normalized,
    target_role,
    idempotency_key,
    request_fingerprint,
    stripe_idempotency_key,
    stripe_subscription_id,
    stripe_subscription_item_id,
    expected_seat_count,
    target_seat_count,
    base_seat_revision,
    proration_date,
    created_at,
    updated_at
  ) VALUES (
    organization_id_value,
    actor_user_id_value,
    target_user_id_value,
    target_email_value,
    'expert',
    gen_random_uuid(),
    repeat('b', 64),
    'openexpert-seat-change-' || replace(gen_random_uuid()::text, '-', ''),
    'sub_0073FenceSmoke',
    'si_0073FenceSmoke',
    1,
    2,
    1,
    statement_timestamp(),
    statement_timestamp() - interval '20 minutes',
    statement_timestamp() - interval '20 minutes'
  )
  RETURNING id, updated_at INTO seat_change_id_value, observed_updated_at;

  claim_result := public.claim_organization_member_seat_stripe_update_v1(
    seat_change_id_value,
    observed_updated_at
  );
  IF claim_result ->> 'claimed' <> 'true'
     OR claim_result ->> 'status' <> 'pending' THEN
    RAISE EXCEPTION 'organization_seat_change_fence_mutation_did_not_win';
  END IF;

  recovery_result := public.fail_stale_organization_member_seat_change_v1(
    seat_change_id_value,
    observed_updated_at,
    statement_timestamp() - interval '10 minutes',
    'smoke_recovery_lost',
    'The old recovery observation must lose to the mutation claim'
  );
  IF recovery_result ->> 'failed' <> 'false'
     OR recovery_result ->> 'status' <> 'pending' THEN
    RAISE EXCEPTION 'organization_seat_change_fence_recovery_overwrote_mutation';
  END IF;

  DELETE FROM public.organization_billing_seat_changes
  WHERE id = seat_change_id_value;

  -- The public begin wrapper must expose the opaque database revision used by
  -- the pre-Stripe CAS without truncating PostgreSQL microseconds.
  begin_result := public.begin_organization_member_seat_change_v1(
    organization_id_value,
    actor_user_id_value,
    target_email_value,
    'expert',
    gen_random_uuid(),
    1,
    statement_timestamp()
  );
  IF begin_result ->> 'updatedAt' IS NULL
     OR (begin_result ->> 'updatedAt')::timestamp with time zone IS DISTINCT FROM (
       SELECT seat_change.updated_at
       FROM public.organization_billing_seat_changes AS seat_change
       WHERE seat_change.id = (begin_result ->> 'seatChangeId')::uuid
     ) THEN
    RAISE EXCEPTION 'organization_seat_change_fence_begin_revision_missing';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.claim_organization_member_seat_stripe_update_v1(uuid,timestamp with time zone)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.fail_stale_organization_member_seat_change_v1(uuid,timestamp with time zone,timestamp with time zone,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'openexpert_service',
    'public.claim_organization_member_seat_stripe_update_v1(uuid,timestamp with time zone)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'openexpert_service',
    'public.fail_stale_organization_member_seat_change_v1(uuid,timestamp with time zone,timestamp with time zone,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'organization_seat_change_fence_rpc_acl_invalid';
  END IF;
END;
$organization_seat_change_fence_smoke$;

ROLLBACK;
