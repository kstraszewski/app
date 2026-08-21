-- Rollback-only runtime coverage for migration 0074. Run after 0074 has been
-- reviewed and applied. The fixture exercises the combined snapshot, the
-- equal-timestamp invoice fence, and onboarding completion ordering.

BEGIN;

DO $organization_billing_and_seat_snapshot_smoke$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  admin_user_id_value uuid;
  admin_email_value text;
  invitation_id_value uuid := gen_random_uuid();
  event_value bigint := extract(epoch FROM statement_timestamp())::bigint;
  customer_id_value text;
  subscription_id_value text;
  subscription_item_id_value text;
  mismatched_item_id_value text;
  checkout_session_id_value text;
  price_id_value text;
  failed_invoice_id_value text;
  overlay_invoice_id_value text;
  snapshot jsonb;
  invoice_snapshot jsonb;
  access_projection jsonb;
  invitation_status text;
  invitation_revision bigint := 7;
BEGIN
  SELECT identity_user.id, lower(btrim(identity_user.email))
  INTO admin_user_id_value, admin_email_value
  FROM identity.users AS identity_user
  WHERE identity_user.email_verified
  ORDER BY identity_user.created_at, identity_user.id
  LIMIT 1;

  IF admin_user_id_value IS NULL THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_identity_fixture_missing';
  END IF;

  customer_id_value := 'cus_' || replace(organization_id_value::text, '-', '');
  subscription_id_value := 'sub_' || replace(organization_id_value::text, '-', '');
  subscription_item_id_value := 'si_' || replace(organization_id_value::text, '-', '');
  mismatched_item_id_value := 'si_mismatch' || replace(organization_id_value::text, '-', '');
  checkout_session_id_value := 'cs_test_' || replace(organization_id_value::text, '-', '');
  price_id_value := 'price_' || replace(organization_id_value::text, '-', '');
  failed_invoice_id_value := 'in_failed' || replace(organization_id_value::text, '-', '');
  overlay_invoice_id_value := 'in_overlay' || replace(organization_id_value::text, '-', '');

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0074 atomic snapshot smoke',
    'atomic-snapshot-' || replace(organization_id_value::text, '-', ''),
    'application',
    'blocked'
  );

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  ) VALUES (
    organization_id_value,
    admin_user_id_value,
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
    revision
  ) VALUES (
    invitation_id_value,
    md5(organization_id_value::text) || md5('0074-' || organization_id_value::text),
    admin_email_value,
    '0074 atomic snapshot smoke',
    'application',
    '0074 Admin',
    'accepted',
    organization_id_value,
    admin_user_id_value,
    statement_timestamp() + interval '1 day',
    statement_timestamp(),
    invitation_revision
  );

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_checkout_session_id,
    stripe_price_id,
    stripe_subscription_status,
    livemode,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    last_stripe_event_created_at,
    last_synced_at,
    stripe_subscription_item_id,
    licensed_seat_count,
    seat_revision
  ) VALUES (
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
    event_value,
    statement_timestamp(),
    subscription_item_id_value,
    1,
    1
  );

  -- A stale Subscription event cannot reopen an existing block and must expose
  -- the nested stale seat result instead of silently accepting it.
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
    event_value - 1,
    subscription_item_id_value,
    1
  );

  IF snapshot ->> 'billingAccessState' <> 'blocked'
     OR snapshot #>> '{seatSnapshot,stale}' <> 'true' THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_stale_reopened_block';
  END IF;

  -- A current-generation canonical item mismatch blocks and must not expose a
  -- completed onboarding invitation even though the inner billing writer
  -- briefly sees an active Subscription candidate.
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
    mismatched_item_id_value,
    2
  );

  SELECT invitation.status INTO STRICT invitation_status
  FROM public.organization_onboarding_invitations AS invitation
  WHERE invitation.id = invitation_id_value;

  IF snapshot ->> 'billingAccessState' <> 'blocked'
     OR snapshot ->> 'invitationCompleted' <> 'false'
     OR snapshot #>> '{seatSnapshot,mismatch}' <> 'true'
     OR snapshot #>> '{seatSnapshot,mismatchReason}' <>
       'stripe_subscription_item_mismatch'
     OR invitation_status <> 'accepted'
     OR (
       SELECT invitation.revision
       FROM public.organization_onboarding_invitations AS invitation
       WHERE invitation.id = invitation_id_value
     ) <> invitation_revision THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_mismatch_not_atomic';
  END IF;

  -- Invoice events created in the same Stripe second as the mismatch cannot
  -- reopen access, regardless of failed/resolved webhook ordering.
  invoice_snapshot := public.apply_organization_invoice_billing_state_v1(
    organization_id_value,
    subscription_id_value,
    failed_invoice_id_value,
    event_value + 1,
    'failed',
    'payment_failed'
  );
  access_projection := public.get_organization_billing_access_v1(
    organization_id_value
  );

  IF invoice_snapshot ->> 'billingAccessState' <> 'blocked'
     OR invoice_snapshot ->> 'newerBlockPreserved' <> 'true'
     OR access_projection ->> 'billingAccessState' <> 'blocked' THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_equal_failed_reopened_block';
  END IF;

  invoice_snapshot := public.apply_organization_invoice_billing_state_v1(
    organization_id_value,
    subscription_id_value,
    failed_invoice_id_value,
    event_value + 1,
    'resolved',
    NULL
  );
  access_projection := public.get_organization_billing_access_v1(
    organization_id_value
  );

  IF invoice_snapshot ->> 'billingAccessState' <> 'blocked'
     OR invoice_snapshot ->> 'newerBlockPreserved' <> 'true'
     OR access_projection ->> 'billingAccessState' <> 'blocked' THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_equal_resolved_reopened_block';
  END IF;

  -- The canonical combined writer is allowed to revalidate at the equal event
  -- timestamp. A matching item/quantity unlocks and only now completes the
  -- accepted invitation.
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
    1
  );
  access_projection := public.get_organization_billing_access_v1(
    organization_id_value
  );
  SELECT invitation.status INTO STRICT invitation_status
  FROM public.organization_onboarding_invitations AS invitation
  WHERE invitation.id = invitation_id_value;

  IF snapshot ->> 'billingAccessState' <> 'active'
     OR snapshot ->> 'invitationCompleted' <> 'true'
     OR snapshot #>> '{seatSnapshot,mismatch}' <> 'false'
     OR snapshot #>> '{seatSnapshot,stale}' <> 'false'
     OR access_projection ->> 'billingAccessState' <> 'active'
     OR invitation_status <> 'completed' THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_equal_valid_not_active';
  END IF;

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
    event_value + 2,
    subscription_item_id_value,
    1
  );

  IF snapshot ->> 'billingAccessState' <> 'active'
     OR snapshot #>> '{seatSnapshot,mismatch}' <> 'false' THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_newer_valid_not_active';
  END IF;

  -- Reset only the invitation fixture, then prove that an unresolved invoice
  -- anomaly overlays the active Subscription to grace without aborting the
  -- snapshot or falsely completing onboarding.
  UPDATE public.organization_onboarding_invitations
  SET status = 'accepted',
      completed_at = NULL,
      revision = revision + 1
  WHERE id = invitation_id_value;

  invoice_snapshot := public.apply_organization_invoice_billing_state_v1(
    organization_id_value,
    subscription_id_value,
    overlay_invoice_id_value,
    event_value + 2,
    'failed',
    'payment_failed'
  );

  IF invoice_snapshot ->> 'billingAccessState' <> 'grace' THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_invoice_overlay_setup_failed';
  END IF;

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
    event_value + 2,
    subscription_item_id_value,
    1
  );
  access_projection := public.get_organization_billing_access_v1(
    organization_id_value
  );
  SELECT invitation.status INTO STRICT invitation_status
  FROM public.organization_onboarding_invitations AS invitation
  WHERE invitation.id = invitation_id_value;

  IF snapshot ->> 'billingAccessState' <> 'grace'
     OR snapshot ->> 'invitationCompleted' <> 'false'
     OR snapshot #>> '{seatSnapshot,mismatch}' <> 'false'
     OR access_projection ->> 'billingAccessState' <> 'grace'
     OR invitation_status <> 'accepted' THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_invoice_overlay_invalid';
  END IF;

  IF to_regprocedure(
       'public.apply_organization_billing_snapshot(uuid,text,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone,bigint)'
     ) IS NOT NULL
     OR to_regprocedure(
       'public.apply_organization_seat_snapshot_v1(uuid,text,text,integer,bigint)'
     ) IS NOT NULL
     OR has_function_privilege(
       'authenticated',
       'public.apply_organization_billing_and_seat_snapshot_v1(uuid,text,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone,bigint,text,integer)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'openexpert_service',
       'public.apply_organization_billing_and_seat_snapshot_v1(uuid,text,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone,boolean,timestamp with time zone,bigint,text,integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'organization_billing_and_seat_snapshot_rpc_acl_invalid';
  END IF;
END;
$organization_billing_and_seat_snapshot_smoke$;

ROLLBACK;

-- MVCC two-session check (run with a committed disposable fixture):
--   A: BEGIN; SELECT public.apply_organization_billing_and_seat_snapshot_v1(...valid...);
--      -- keep the transaction open
--   B: SELECT billing_access_state FROM public.organizations WHERE id = ...;
--      -- must still see the previously committed `blocked`
--   A: COMMIT;
--   B: SELECT billing_access_state FROM public.organizations WHERE id = ...;
--      -- must now see `active`
-- The combined function has no intermediate commit and holds the organization
-- row lock, so PostgreSQL MVCC exposes only the pre-transaction or final state.
