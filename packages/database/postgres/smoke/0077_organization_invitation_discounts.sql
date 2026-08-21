-- Rollback-only runtime coverage for migration 0077. Run after applying the
-- migration in a disposable transaction or database branch.

BEGIN;

DO $organization_invitation_discounts_smoke$
DECLARE
  actor_user_id_value uuid;
  actor_email_value text;
  organization_id_value uuid := gen_random_uuid();
  accepted_invitation_id_value uuid := gen_random_uuid();
  revoked_invitation_id_value uuid := gen_random_uuid();
  percentage_invitation_id_value uuid := gen_random_uuid();
  fixed_invitation_id_value uuid := gen_random_uuid();
  coupon_id_value text;
  checkout_id_value text;
  mismatched_checkout_id_value text;
  replacement_checkout_id_value text;
  subscription_id_value text;
  mismatched_subscription_id_value text;
  observed_discount_status text;
BEGIN
  SELECT identity_user.id, lower(btrim(identity_user.email))
  INTO actor_user_id_value, actor_email_value
  FROM identity.users AS identity_user
  WHERE identity_user.email_verified
  ORDER BY identity_user.created_at, identity_user.id
  LIMIT 1;

  IF actor_user_id_value IS NULL THEN
    RAISE EXCEPTION 'organization_invitation_discount_identity_fixture_missing';
  END IF;

  coupon_id_value := 'oe_inv_'
    || replace(accepted_invitation_id_value::text, '-', '')
    || '_123456789abc';
  checkout_id_value := 'cs_test_'
    || replace(accepted_invitation_id_value::text, '-', '');
  mismatched_checkout_id_value := 'cs_test_mismatch'
    || replace(accepted_invitation_id_value::text, '-', '');
  replacement_checkout_id_value := 'cs_test_replacement'
    || replace(accepted_invitation_id_value::text, '-', '');
  subscription_id_value := 'sub_'
    || replace(accepted_invitation_id_value::text, '-', '');
  mismatched_subscription_id_value := 'sub_mismatch'
    || replace(accepted_invitation_id_value::text, '-', '');

  -- Existing/intermediary invitations remain valid only when every discount
  -- column is NULL.
  INSERT INTO public.organization_onboarding_invitations (
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    status,
    expires_at
  ) VALUES (
    md5('0077-legacy-a') || md5('0077-legacy-b'),
    actor_email_value,
    '0077 no discount smoke',
    'intermediary',
    'pending',
    statement_timestamp() + interval '1 day'
  );

  -- Both commercial shapes and all three durations are representable.
  INSERT INTO public.organization_onboarding_invitations (
    id,
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    status,
    expires_at,
    discount_kind,
    discount_percent_off_bps,
    discount_duration,
    discount_duration_months,
    discount_status
  ) VALUES (
    percentage_invitation_id_value,
    md5('0077-percent-a') || md5('0077-percent-b'),
    actor_email_value,
    '0077 percentage smoke',
    'application',
    'pending',
    statement_timestamp() + interval '1 day',
    'percentage',
    2500,
    'repeating',
    3,
    'assigned'
  );

  INSERT INTO public.organization_onboarding_invitations (
    id,
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    status,
    expires_at,
    discount_kind,
    discount_amount_off_minor,
    discount_currency,
    discount_duration,
    discount_status
  ) VALUES (
    fixed_invitation_id_value,
    md5('0077-fixed-a') || md5('0077-fixed-b'),
    actor_email_value,
    '0077 fixed smoke',
    'application',
    'pending',
    statement_timestamp() + interval '1 day',
    'fixed_amount',
    5000,
    'pln',
    'forever',
    'assigned'
  );

  -- A definition cannot be added to an old invitation or edited after insert.
  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_percent_off_bps = 3000
    WHERE id = percentage_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_discount_definition_was_mutable';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- Revoke uses the existing application update shape. The trigger must move
  -- an unused grant from assigned to revoked in that same statement.
  INSERT INTO public.organization_onboarding_invitations (
    id,
    token_hash,
    email_normalized,
    organization_name,
    organization_kind,
    status,
    expires_at,
    discount_kind,
    discount_percent_off_bps,
    discount_duration,
    discount_status,
    discount_stripe_coupon_id,
    discount_livemode
  ) VALUES (
    revoked_invitation_id_value,
    md5('0077-revoked-a') || md5('0077-revoked-b'),
    actor_email_value,
    '0077 revoked smoke',
    'application',
    'pending',
    statement_timestamp() + interval '1 day',
    'percentage',
    1000,
    'once',
    'assigned',
    'oe_inv_' || replace(revoked_invitation_id_value::text, '-', '')
      || '_123456789abc',
    false
  );

  UPDATE public.organization_onboarding_invitations
  SET status = 'revoked',
      revoked_at = statement_timestamp(),
      revision = revision + 1
  WHERE id = revoked_invitation_id_value;

  SELECT invitation.discount_status INTO STRICT observed_discount_status
  FROM public.organization_onboarding_invitations AS invitation
  WHERE invitation.id = revoked_invitation_id_value;

  IF observed_discount_status <> 'revoked' THEN
    RAISE EXCEPTION 'organization_invitation_discount_revoke_not_projected';
  END IF;

  -- Exercise crash recovery (Coupon persisted while still assigned), Checkout
  -- replacement before payment, and the terminal applied projection.
  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0077 discount lifecycle smoke',
    'discount-lifecycle-' || replace(organization_id_value::text, '-', ''),
    'application',
    'subscription_required'
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

  INSERT INTO public.organization_billing_accounts (
    organization_id,
    stripe_checkout_session_id,
    livemode
  ) VALUES (
    organization_id_value,
    mismatched_checkout_id_value,
    false
  );

  -- Correlation is enforced on INSERT as well as on later projection updates.
  BEGIN
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
      discount_kind,
      discount_amount_off_minor,
      discount_currency,
      discount_duration,
      discount_status,
      discount_stripe_coupon_id,
      discount_stripe_checkout_session_id,
      discount_livemode
    ) VALUES (
      accepted_invitation_id_value,
      md5('0077-insert-fence-a') || md5('0077-insert-fence-b'),
      actor_email_value,
      '0077 insert correlation fence',
      'application',
      'accepted',
      organization_id_value,
      actor_user_id_value,
      statement_timestamp() + interval '1 day',
      statement_timestamp(),
      'fixed_amount',
      2000,
      'pln',
      'once',
      'checkout_created',
      coupon_id_value,
      checkout_id_value,
      false
    );
    RAISE EXCEPTION 'organization_invitation_insert_correlation_was_bypassed';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

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
    discount_kind,
    discount_amount_off_minor,
    discount_currency,
    discount_duration,
    discount_status
  ) VALUES (
    accepted_invitation_id_value,
    md5('0077-accepted-a') || md5('0077-accepted-b'),
    actor_email_value,
    '0077 discount lifecycle smoke',
    'application',
    'accepted',
    organization_id_value,
    actor_user_id_value,
    statement_timestamp() + interval '1 day',
    statement_timestamp(),
    'fixed_amount',
    2000,
    'pln',
    'once',
    'assigned'
  );

  UPDATE public.organization_onboarding_invitations
  SET discount_stripe_coupon_id = coupon_id_value,
      discount_livemode = false,
      revision = revision + 1
  WHERE id = accepted_invitation_id_value;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_stripe_coupon_id = coupon_id_value || '_changed'
    WHERE id = accepted_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_discount_coupon_was_mutable';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  -- The invitation projection must bind only the Checkout Session currently
  -- owned by this organization's locked billing account.
  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_status = 'checkout_created',
        discount_stripe_checkout_session_id = checkout_id_value,
        revision = revision + 1
    WHERE id = accepted_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_mismatched_checkout_was_accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE public.organization_billing_accounts
  SET stripe_checkout_session_id = checkout_id_value,
      livemode = true
  WHERE organization_id = organization_id_value;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_status = 'checkout_created',
        discount_stripe_checkout_session_id = checkout_id_value,
        revision = revision + 1
    WHERE id = accepted_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_mismatched_mode_was_accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE public.organization_billing_accounts
  SET livemode = false
  WHERE organization_id = organization_id_value;

  UPDATE public.organization_onboarding_invitations
  SET discount_status = 'checkout_created',
      discount_stripe_checkout_session_id = checkout_id_value,
      revision = revision + 1
  WHERE id = accepted_invitation_id_value;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_stripe_checkout_session_id = replacement_checkout_id_value,
        revision = revision + 1
    WHERE id = accepted_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_stale_replacement_was_accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  UPDATE public.organization_billing_accounts
  SET stripe_checkout_session_id = replacement_checkout_id_value
  WHERE organization_id = organization_id_value;

  UPDATE public.organization_onboarding_invitations
  SET discount_stripe_checkout_session_id = replacement_checkout_id_value,
      revision = revision + 1
  WHERE id = accepted_invitation_id_value;

  UPDATE public.organization_billing_accounts
  SET stripe_customer_id = 'cus_'
        || replace(organization_id_value::text, '-', ''),
      stripe_subscription_id = subscription_id_value,
      stripe_price_id = 'price_'
        || replace(organization_id_value::text, '-', ''),
      stripe_subscription_status = 'canceled',
      current_period_start = statement_timestamp(),
      current_period_end = statement_timestamp() + interval '1 month',
      last_synced_at = statement_timestamp()
  WHERE organization_id = organization_id_value;

  UPDATE public.organizations
  SET billing_access_state = 'blocked'
  WHERE id = organization_id_value;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_status = 'applied',
        discount_stripe_subscription_id = mismatched_subscription_id_value,
        discount_applied_at = statement_timestamp(),
        revision = revision + 1
    WHERE id = accepted_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_mismatched_subscription_was_applied';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Consumption is historical and may be recovered after Stripe has already
  -- moved the exact subscription to canceled/blocked. Canonical payment proof
  -- stays an application concern; the database fences the external identities.
  UPDATE public.organization_onboarding_invitations
  SET discount_status = 'applied',
      discount_stripe_subscription_id = subscription_id_value,
      discount_applied_at = statement_timestamp(),
      revision = revision + 1
  WHERE id = accepted_invitation_id_value;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_stripe_checkout_session_id = checkout_id_value
    WHERE id = accepted_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_applied_checkout_was_mutable';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_status = 'checkout_created',
        discount_stripe_subscription_id = NULL,
        discount_applied_at = NULL
    WHERE id = accepted_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_applied_discount_was_not_terminal';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  -- Invalid/partial definitions must fail closed rather than pass a CHECK via
  -- SQL's UNKNOWN result.
  BEGIN
    INSERT INTO public.organization_onboarding_invitations (
      token_hash,
      email_normalized,
      organization_name,
      organization_kind,
      status,
      expires_at,
      discount_kind,
      discount_duration,
      discount_status
    ) VALUES (
      md5('0077-invalid-percent-a') || md5('0077-invalid-percent-b'),
      actor_email_value,
      '0077 invalid percentage',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      'once',
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_null_percentage_was_accepted';
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
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_status
    ) VALUES (
      md5('0077-invalid-percent-limit-a') || md5('0077-invalid-percent-limit-b'),
      actor_email_value,
      '0077 invalid percentage limit',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      10001,
      'once',
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_percentage_over_limit_was_accepted';
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
      discount_kind,
      discount_amount_off_minor,
      discount_duration,
      discount_status
    ) VALUES (
      md5('0077-invalid-fixed-a') || md5('0077-invalid-fixed-b'),
      actor_email_value,
      '0077 invalid fixed amount',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'fixed_amount',
      1000,
      'once',
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_null_fixed_currency_was_accepted';
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
      discount_kind,
      discount_amount_off_minor,
      discount_currency,
      discount_duration,
      discount_status
    ) VALUES (
      md5('0077-invalid-fixed-limit-a') || md5('0077-invalid-fixed-limit-b'),
      actor_email_value,
      '0077 invalid fixed amount limit',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'fixed_amount',
      100000001,
      'pln',
      'once',
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_fixed_amount_over_limit_was_accepted';
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
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_status
    ) VALUES (
      md5('0077-invalid-repeat-a') || md5('0077-invalid-repeat-b'),
      actor_email_value,
      '0077 invalid repeating duration',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      1000,
      'repeating',
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_null_duration_months_was_accepted';
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
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_duration_months,
      discount_status
    ) VALUES (
      md5('0077-invalid-repeat-limit-a') || md5('0077-invalid-repeat-limit-b'),
      actor_email_value,
      '0077 invalid repeating limit',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      1000,
      'repeating',
      37,
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_duration_months_over_limit_was_accepted';
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
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_duration_months,
      discount_status
    ) VALUES (
      md5('0077-invalid-once-a') || md5('0077-invalid-once-b'),
      actor_email_value,
      '0077 invalid once duration',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      1000,
      'once',
      2,
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_once_duration_months_was_accepted';
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
      discount_status
    ) VALUES (
      md5('0077-invalid-partial-a') || md5('0077-invalid-partial-b'),
      actor_email_value,
      '0077 partial projection',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_partial_discount_was_accepted';
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
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_status,
      discount_stripe_coupon_id,
      discount_livemode
    ) VALUES (
      md5('0077-invalid-coupon-a') || md5('0077-invalid-coupon-b'),
      actor_email_value,
      '0077 invalid coupon identity',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      1000,
      'once',
      'assigned',
      'not a Stripe coupon',
      false
    );
    RAISE EXCEPTION 'organization_invitation_invalid_coupon_id_was_accepted';
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
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_status,
      discount_stripe_coupon_id,
      discount_stripe_checkout_session_id,
      discount_livemode
    ) VALUES (
      md5('0077-invalid-pending-checkout-a') || md5('0077-invalid-pending-checkout-b'),
      actor_email_value,
      '0077 pending checkout',
      'application',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      1000,
      'once',
      'checkout_created',
      'oe_inv_pending_123456789abc',
      'cs_test_pending123',
      false
    );
    RAISE EXCEPTION 'organization_invitation_pending_checkout_was_accepted';
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
      discount_kind,
      discount_percent_off_bps,
      discount_duration,
      discount_status
    ) VALUES (
      md5('0077-invalid-kind-a') || md5('0077-invalid-kind-b'),
      actor_email_value,
      '0077 intermediary discount',
      'intermediary',
      'pending',
      statement_timestamp() + interval '1 day',
      'percentage',
      1000,
      'once',
      'assigned'
    );
    RAISE EXCEPTION 'organization_invitation_intermediary_discount_was_accepted';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    UPDATE public.organization_onboarding_invitations
    SET discount_stripe_coupon_id = coupon_id_value,
        discount_livemode = false
    WHERE id = percentage_invitation_id_value;
    RAISE EXCEPTION 'organization_invitation_duplicate_coupon_was_accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$organization_invitation_discounts_smoke$;

ROLLBACK;
