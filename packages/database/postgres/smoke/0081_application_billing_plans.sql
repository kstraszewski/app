-- Rollback-only runtime coverage for migration 0081. Run after applying the
-- migration to a disposable/local branch, or load 0081 immediately before
-- this file in the same psql session.

BEGIN;
SET LOCAL ROLE openexpert_owner;

DO $application_billing_plans_smoke$
DECLARE
  actor_id uuid := gen_random_uuid();
  organization_id_value uuid := gen_random_uuid();
  invitation_id uuid := gen_random_uuid();
  client_key uuid := gen_random_uuid();
  actor_email text := 'plan-owner-' || replace(actor_id::text, '-', '') || '@example.test';
  subscription_id text := 'sub_' || replace(organization_id_value::text, '-', '');
  subscription_item_id text := 'si_' || replace(organization_id_value::text, '-', '');
  individual_price_id text := 'price_individual' || replace(organization_id_value::text, '-', '');
  team_price_id text := 'price_team' || replace(organization_id_value::text, '-', '');
  begin_result jsonb;
  claim_result jsonb;
  snapshot jsonb;
  observed_plan text;
  observed_status text;
  observed_seats integer;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.organization_billing_accounts AS account
    WHERE account.stripe_subscription_item_id IS NOT NULL
      AND account.billing_plan_code IS NULL
  ) THEN
    RAISE EXCEPTION 'existing_billing_accounts_were_not_backfilled';
  END IF;

  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES (actor_id, '0081 Plan Owner', actor_email, true);

  INSERT INTO public.organizations (id, name, slug, kind, billing_access_state)
  VALUES (
    organization_id_value,
    '0081 plan smoke',
    'plan-smoke-' || replace(organization_id_value::text, '-', ''),
    'application',
    'active'
  );

  INSERT INTO public.users (id, organization_id, email, role, full_name)
  VALUES (actor_id, organization_id_value, actor_email, 'admin', '0081 Plan Owner');

  INSERT INTO public.organization_memberships (organization_id, user_id, role)
  VALUES (organization_id_value, actor_id, 'admin');

  INSERT INTO public.organization_onboarding_invitations (
    id,
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    status,
    expires_at,
    onboarding_source,
    initial_seat_count,
    billing_plan_code
  ) VALUES (
    invitation_id,
    md5('0081-plan-a') || md5(invitation_id::text),
    actor_email,
    '0081 plan invitation',
    'application',
    'pending',
    statement_timestamp() + interval '1 day',
    'self_service',
    1,
    'individual'
  );

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET billing_plan_code = 'team'
    WHERE id = invitation_id;
    RAISE EXCEPTION 'invitation_billing_plan_was_mutable';
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
      onboarding_source,
      initial_seat_count,
      billing_plan_code
    ) VALUES (
      md5('0081-team-a') || md5('0081-team-b'),
      actor_email,
      '0081 invalid team invitation',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'self_service',
      2,
      'team'
    );
    RAISE EXCEPTION 'team_plan_accepted_fewer_than_three_seats';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_customer_id,
    stripe_checkout_session_id,
    stripe_subscription_id,
    stripe_subscription_item_id,
    stripe_price_id,
    stripe_subscription_status,
    current_period_start,
    current_period_end,
    last_synced_at,
    last_stripe_event_created_at,
    licensed_seat_count,
    seat_revision,
    billing_plan_code,
    livemode
  ) VALUES (
    organization_id_value,
    'cus_' || replace(organization_id_value::text, '-', ''),
    'cs_test_' || replace(organization_id_value::text, '-', ''),
    subscription_id,
    subscription_item_id,
    individual_price_id,
    'active',
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    statement_timestamp(),
    10,
    1,
    7,
    'individual',
    false
  );

  IF NOT private.has_organization_billing_entitlement(organization_id_value) THEN
    RAISE EXCEPTION 'individual_plan_was_not_entitled';
  END IF;

  begin_result := public.begin_organization_plan_upgrade_v1(
    organization_id_value,
    actor_id,
    client_key,
    7,
    individual_price_id,
    team_price_id,
    extract(epoch FROM statement_timestamp())::bigint
  );

  IF begin_result ->> 'status' <> 'prepared'
     OR begin_result ->> 'replayed' <> 'false' THEN
    RAISE EXCEPTION 'plan_upgrade_was_not_prepared';
  END IF;

  claim_result := public.claim_organization_plan_upgrade_v1(
    (begin_result ->> 'changeId')::uuid,
    (begin_result ->> 'updatedAt')::timestamp with time zone
  );
  IF claim_result ->> 'claimed' <> 'true'
     OR claim_result ->> 'status' <> 'pending' THEN
    RAISE EXCEPTION 'plan_upgrade_was_not_claimed';
  END IF;

  -- The combined billing writer has already accepted Stripe's target Price
  -- before delegating the canonical item/quantity to this generation wrapper.
  UPDATE public.organization_billing_accounts
  SET stripe_price_id = team_price_id
  WHERE organization_id = organization_id_value;

  snapshot := private.apply_organization_seat_snapshot_generation_v1(
    organization_id_value,
    subscription_id,
    subscription_item_id,
    3,
    11
  );

  SELECT account.billing_plan_code, account.licensed_seat_count
  INTO STRICT observed_plan, observed_seats
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = organization_id_value;

  SELECT change.status INTO STRICT observed_status
  FROM public.organization_billing_plan_changes AS change
  WHERE change.id = (begin_result ->> 'changeId')::uuid;

  IF observed_plan <> 'team'
     OR observed_seats <> 3
     OR observed_status <> 'succeeded'
     OR snapshot ->> 'mismatch' <> 'false'
     OR snapshot ->> 'completedPlanChangeId' <> begin_result ->> 'changeId'
     OR NOT private.has_organization_billing_entitlement(organization_id_value) THEN
    RAISE EXCEPTION 'individual_to_team_upgrade_did_not_finalize_atomically';
  END IF;

  IF has_function_privilege('authenticated',
       'public.begin_organization_plan_upgrade_v1(uuid,uuid,uuid,bigint,text,text,bigint)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.claim_organization_plan_upgrade_v1(uuid,timestamp with time zone)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.mark_organization_plan_upgrade_v1(uuid,text,text,text,text,text)',
       'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.fail_stale_organization_plan_upgrade_v1(uuid,timestamp with time zone)',
       'EXECUTE')
     OR has_table_privilege('authenticated',
       'public.organization_billing_plan_changes',
       'SELECT') THEN
    RAISE EXCEPTION 'authenticated_plan_upgrade_acl_is_too_broad';
  END IF;

  IF NOT has_function_privilege('openexpert_service',
       'public.begin_organization_plan_upgrade_v1(uuid,uuid,uuid,bigint,text,text,bigint)',
       'EXECUTE')
     OR NOT has_function_privilege('openexpert_service',
       'public.claim_organization_plan_upgrade_v1(uuid,timestamp with time zone)',
       'EXECUTE')
     OR NOT has_function_privilege('openexpert_service',
       'public.mark_organization_plan_upgrade_v1(uuid,text,text,text,text,text)',
       'EXECUTE')
     OR NOT has_function_privilege('openexpert_service',
       'public.fail_stale_organization_plan_upgrade_v1(uuid,timestamp with time zone)',
       'EXECUTE')
     OR NOT has_table_privilege('openexpert_service',
       'public.organization_billing_plan_changes',
       'SELECT') THEN
    RAISE EXCEPTION 'service_plan_upgrade_acl_is_missing';
  END IF;
END
$application_billing_plans_smoke$;

ROLLBACK;
