-- Standalone, rollback-only runtime smoke for the permanent one-external-call
-- invariant added in 0075. Run after migrations through 0075.

BEGIN;

DO $organization_seat_change_single_mutation_smoke$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  actor_user_id_value uuid;
  target_user_id_value uuid;
  target_email_value text;
  seat_change_id_value uuid;
  observed_updated_at timestamp with time zone;
  persisted_attempts integer;
  claim_result jsonb;
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
    RAISE EXCEPTION 'organization_seat_single_mutation_identity_fixture_missing';
  END IF;

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0075 single Stripe mutation smoke',
    'seat-single-mutation-' || replace(organization_id_value::text, '-', ''),
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
    'cus_0075SingleMutation',
    'sub_0075SingleMutation',
    'price_0075SingleMutation',
    'active',
    'si_0075SingleMutation',
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
    proration_date
  ) VALUES (
    organization_id_value,
    actor_user_id_value,
    target_user_id_value,
    target_email_value,
    'expert',
    gen_random_uuid(),
    repeat('c', 64),
    'openexpert-seat-change-' || replace(gen_random_uuid()::text, '-', ''),
    'sub_0075SingleMutation',
    'si_0075SingleMutation',
    1,
    2,
    1,
    statement_timestamp()
  )
  RETURNING id, updated_at INTO seat_change_id_value, observed_updated_at;

  claim_result := public.claim_organization_member_seat_stripe_update_v1(
    seat_change_id_value,
    observed_updated_at
  );
  IF claim_result ->> 'claimed' <> 'true'
     OR claim_result ->> 'status' <> 'pending'
     OR claim_result ->> 'attempts' <> '1' THEN
    RAISE EXCEPTION 'organization_seat_single_mutation_first_claim_failed';
  END IF;

  -- Persist the exact invoice returned by the first Stripe request. Even long
  -- after Stripe forgets the idempotency result, this saga can never claim a
  -- second external mutation with the same or a new observation.
  PERFORM public.mark_organization_member_seat_change_v1(
    seat_change_id_value,
    'pending',
    NULL,
    NULL,
    'in_0075SingleMutation',
    'https://invoice.stripe.test/in_0075SingleMutation'
  );

  SELECT seat_change.updated_at, seat_change.attempts
  INTO STRICT observed_updated_at, persisted_attempts
  FROM public.organization_billing_seat_changes AS seat_change
  WHERE seat_change.id = seat_change_id_value;

  claim_result := public.claim_organization_member_seat_stripe_update_v1(
    seat_change_id_value,
    observed_updated_at
  );
  IF claim_result ->> 'claimed' <> 'false'
     OR claim_result ->> 'status' <> 'pending'
     OR (claim_result ->> 'attempts')::integer <> persisted_attempts THEN
    RAISE EXCEPTION 'organization_seat_single_mutation_replay_was_reauthorized';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_billing_seat_changes AS seat_change
    WHERE seat_change.id = seat_change_id_value
      AND (
        seat_change.stripe_invoice_id <> 'in_0075SingleMutation'
        OR seat_change.attempts <> persisted_attempts
        OR seat_change.status <> 'pending'
      )
  ) THEN
    RAISE EXCEPTION 'organization_seat_single_mutation_invoice_fence_changed';
  END IF;
END;
$organization_seat_change_single_mutation_smoke$;

ROLLBACK;
