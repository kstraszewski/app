-- Standalone, rollback-only runtime smoke for invoice-only seat correlation.
-- It models: pending without Hosted Invoice URL -> pending update expiry ->
-- delayed invoice.voided/uncollectible exact lookup.

BEGIN;

DO $organization_seat_invoice_correlation_smoke$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  actor_user_id_value uuid;
  target_user_id_value uuid;
  target_email_value text;
  seat_change_id_value uuid;
  terminal_race_change_id_value uuid;
  terminal_race_payload jsonb;
  paid_event_value bigint := extract(epoch FROM statement_timestamp())::bigint - 1;
  newer_subscription_event_value bigint := extract(epoch FROM statement_timestamp())::bigint;
  billing_snapshot jsonb;
  invoice_snapshot jsonb;
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
    RAISE EXCEPTION 'organization_seat_invoice_identity_fixture_missing';
  END IF;

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0076 seat invoice correlation smoke',
    'seat-invoice-' || replace(organization_id_value::text, '-', ''),
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
    'cus_0076InvoiceOnly',
    'sub_0076InvoiceOnly',
    'price_0076InvoiceOnly',
    'active',
    'si_0076InvoiceOnly',
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
    status,
    idempotency_key,
    request_fingerprint,
    stripe_idempotency_key,
    stripe_subscription_id,
    stripe_subscription_item_id,
    expected_seat_count,
    target_seat_count,
    base_seat_revision,
    proration_date,
    attempts
  ) VALUES (
    organization_id_value,
    actor_user_id_value,
    target_user_id_value,
    target_email_value,
    'expert',
    'pending',
    gen_random_uuid(),
    repeat('d', 64),
    'openexpert-seat-change-' || replace(gen_random_uuid()::text, '-', ''),
    'sub_0076InvoiceOnly',
    'si_0076InvoiceOnly',
    1,
    2,
    1,
    statement_timestamp(),
    1
  )
  RETURNING id INTO seat_change_id_value;

  PERFORM public.mark_organization_member_seat_change_v1(
    seat_change_id_value,
    'pending',
    NULL,
    NULL,
    'in_0076InvoiceOnly',
    NULL
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_billing_seat_changes AS seat_change
    WHERE seat_change.id = seat_change_id_value
      AND seat_change.status = 'pending'
      AND seat_change.stripe_invoice_id = 'in_0076InvoiceOnly'
      AND seat_change.payment_url IS NULL
  ) THEN
    RAISE EXCEPTION 'organization_seat_invoice_only_not_persisted';
  END IF;

  -- Model pending_update_expired. The exact Invoice ID must survive terminal
  -- state so a later invoice.voided event is classified as this seat saga.
  PERFORM public.mark_organization_member_seat_change_v1(
    seat_change_id_value,
    'failed',
    'stripe_pending_update_expired',
    'Stripe pending subscription update expired before payment completed',
    NULL,
    NULL
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_billing_seat_changes AS seat_change
    WHERE seat_change.id = seat_change_id_value
      AND seat_change.status = 'failed'
      AND seat_change.stripe_invoice_id = 'in_0076InvoiceOnly'
      AND seat_change.payment_url IS NULL
  ) THEN
    RAISE EXCEPTION 'organization_seat_invoice_correlation_lost_on_expiry';
  END IF;

  -- Model the binder reading an open saga while a concurrent terminal path
  -- commits first. The verified Invoice must still be durably attached without
  -- reopening the failed saga, and the RPC response must expose that binding.
  INSERT INTO public.organization_billing_seat_changes (
    organization_id,
    actor_user_id,
    target_user_id,
    target_email_normalized,
    target_role,
    status,
    idempotency_key,
    request_fingerprint,
    stripe_idempotency_key,
    stripe_subscription_id,
    stripe_subscription_item_id,
    expected_seat_count,
    target_seat_count,
    base_seat_revision,
    proration_date,
    attempts
  ) VALUES (
    organization_id_value,
    actor_user_id_value,
    target_user_id_value,
    target_email_value,
    'expert',
    'pending',
    gen_random_uuid(),
    repeat('f', 64),
    'openexpert-seat-change-' || replace(gen_random_uuid()::text, '-', ''),
    'sub_0076InvoiceOnly',
    'si_0076InvoiceOnly',
    1,
    2,
    1,
    statement_timestamp(),
    1
  )
  RETURNING id INTO terminal_race_change_id_value;

  PERFORM public.mark_organization_member_seat_change_v1(
    terminal_race_change_id_value,
    'failed',
    'stripe_pending_update_expired',
    'Concurrent expiry won before the Invoice binder',
    NULL,
    NULL
  );

  SELECT public.mark_organization_member_seat_change_v1(
    terminal_race_change_id_value,
    'pending',
    NULL,
    NULL,
    'in_0076TerminalRace',
    NULL
  ) INTO terminal_race_payload;

  IF terminal_race_payload ->> 'status' <> 'failed'
     OR terminal_race_payload ->> 'stripeInvoiceId' <> 'in_0076TerminalRace'
     OR NOT EXISTS (
       SELECT 1
       FROM public.organization_billing_seat_changes AS seat_change
       WHERE seat_change.id = terminal_race_change_id_value
         AND seat_change.status = 'failed'
         AND seat_change.stripe_invoice_id = 'in_0076TerminalRace'
         AND seat_change.payment_url IS NULL
     ) THEN
    RAISE EXCEPTION 'organization_seat_terminal_invoice_binding_race_failed';
  END IF;

  -- Delivery order: renewal failure T1, a newer canonical Subscription T3,
  -- then invoice.paid T2. Resolving the Invoice at T2 intentionally preserves
  -- the T3 block; a second canonical apply at max(T2, account fence)=T3 must
  -- recompute access after the anomaly is durably resolved.
  invoice_snapshot := public.apply_organization_invoice_billing_state_v1(
    organization_id_value,
    'sub_0076InvoiceOnly',
    'in_0076PaidRecovery',
    paid_event_value - (8 * 24 * 60 * 60),
    'failed',
    'payment_failed'
  );

  billing_snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    organization_id_value,
    'cus_0076InvoiceOnly',
    'sub_0076InvoiceOnly',
    NULL,
    'price_0076InvoiceOnly',
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    newer_subscription_event_value,
    'si_0076InvoiceOnly',
    1
  );

  IF invoice_snapshot ->> 'billingAccessState' <> 'blocked'
     OR billing_snapshot ->> 'billingAccessState' <> 'blocked' THEN
    RAISE EXCEPTION 'organization_paid_recovery_out_of_order_setup_failed';
  END IF;

  invoice_snapshot := public.apply_organization_invoice_billing_state_v1(
    organization_id_value,
    'sub_0076InvoiceOnly',
    'in_0076PaidRecovery',
    paid_event_value,
    'resolved',
    NULL
  );

  IF invoice_snapshot ->> 'invoiceState' <> 'resolved'
     OR invoice_snapshot ->> 'billingAccessState' <> 'blocked'
     OR invoice_snapshot ->> 'newerBlockPreserved' <> 'true' THEN
    RAISE EXCEPTION 'organization_paid_recovery_resolve_not_durable';
  END IF;

  billing_snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    organization_id_value,
    'cus_0076InvoiceOnly',
    'sub_0076InvoiceOnly',
    NULL,
    'price_0076InvoiceOnly',
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    newer_subscription_event_value,
    'si_0076InvoiceOnly',
    1
  );

  IF billing_snapshot ->> 'billingAccessState' <> 'active'
     OR billing_snapshot #>> '{seatSnapshot,mismatch}' <> 'false'
     OR billing_snapshot #>> '{seatSnapshot,stale}' <> 'false' THEN
    RAISE EXCEPTION 'organization_paid_recovery_canonical_reapply_failed';
  END IF;

  -- Split-RPC fail-close: first commit a canonical seat mismatch. Even Invoice
  -- failed/resolved events NEWER than the account fence must persist their
  -- ledger state without reopening access between RPCs.
  billing_snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    organization_id_value,
    'cus_0076InvoiceOnly',
    'sub_0076InvoiceOnly',
    NULL,
    'price_0076InvoiceOnly',
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    newer_subscription_event_value + 1,
    'si_0076WrongItem',
    2
  );

  IF billing_snapshot ->> 'billingAccessState' <> 'blocked'
     OR billing_snapshot #>> '{seatSnapshot,mismatch}' <> 'true' THEN
    RAISE EXCEPTION 'organization_invoice_existing_block_mismatch_setup_failed';
  END IF;

  invoice_snapshot := public.apply_organization_invoice_billing_state_v1(
    organization_id_value,
    'sub_0076InvoiceOnly',
    'in_0076ExistingBlock',
    newer_subscription_event_value + 2,
    'failed',
    'payment_failed'
  );

  IF invoice_snapshot ->> 'invoiceState' <> 'failed'
     OR invoice_snapshot ->> 'billingAccessState' <> 'blocked'
     OR invoice_snapshot ->> 'existingBlockPreserved' <> 'true' THEN
    RAISE EXCEPTION 'organization_invoice_newer_failure_reopened_existing_block';
  END IF;

  invoice_snapshot := public.apply_organization_invoice_billing_state_v1(
    organization_id_value,
    'sub_0076InvoiceOnly',
    'in_0076ExistingBlock',
    newer_subscription_event_value + 3,
    'resolved',
    NULL
  );

  IF invoice_snapshot ->> 'invoiceState' <> 'resolved'
     OR invoice_snapshot ->> 'billingAccessState' <> 'blocked'
     OR invoice_snapshot ->> 'existingBlockPreserved' <> 'true'
     OR NOT EXISTS (
       SELECT 1
       FROM public.organization_billing_invoice_states AS invoice_state
       WHERE invoice_state.stripe_invoice_id = 'in_0076ExistingBlock'
         AND invoice_state.state = 'resolved'
         AND invoice_state.event_created = newer_subscription_event_value + 3
     ) THEN
    RAISE EXCEPTION 'organization_invoice_newer_resolve_reopened_existing_block';
  END IF;

  -- A full matching billing+seat projection is the sole unlock authority.
  billing_snapshot := public.apply_organization_billing_and_seat_snapshot_v1(
    organization_id_value,
    'cus_0076InvoiceOnly',
    'sub_0076InvoiceOnly',
    NULL,
    'price_0076InvoiceOnly',
    'active',
    false,
    statement_timestamp() - interval '1 day',
    statement_timestamp() + interval '29 days',
    false,
    NULL,
    newer_subscription_event_value + 3,
    'si_0076InvoiceOnly',
    1
  );

  IF billing_snapshot ->> 'billingAccessState' <> 'active'
     OR billing_snapshot #>> '{seatSnapshot,mismatch}' <> 'false'
     OR billing_snapshot #>> '{seatSnapshot,stale}' <> 'false' THEN
    RAISE EXCEPTION 'organization_invoice_existing_block_canonical_unlock_failed';
  END IF;

  BEGIN
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
      payment_url,
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
      repeat('e', 64),
      'openexpert-seat-change-' || replace(gen_random_uuid()::text, '-', ''),
      'sub_0076InvoiceOnly',
      'si_0076InvoiceOnly',
      'https://invoice.stripe.test/missing-id',
      1,
      2,
      1,
      statement_timestamp()
    );
    RAISE EXCEPTION 'organization_seat_payment_url_without_invoice_was_accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  IF has_function_privilege(
    'authenticated',
    'public.mark_organization_member_seat_change_v1(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'openexpert_service',
    'public.mark_organization_member_seat_change_v1(uuid,text,text,text,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'organization_seat_invoice_mark_rpc_acl_invalid';
  END IF;
END;
$organization_seat_invoice_correlation_smoke$;

ROLLBACK;
