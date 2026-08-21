-- Serialize Stripe subscription replacement with the billing account row.
-- Server-side checks remain defense-in-depth; this wrapper is the atomic
-- generation fence that prevents late events from an older subscription from
-- replacing the subscription created by the current Checkout Session.

ALTER FUNCTION public.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) SET SCHEMA private;

ALTER FUNCTION private.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) RENAME TO apply_organization_billing_snapshot_unchecked_v1;

REVOKE ALL ON FUNCTION private.apply_organization_billing_snapshot_unchecked_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.apply_organization_billing_snapshot(
  p_organization_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_checkout_session_id text,
  p_stripe_price_id text,
  p_subscription_status text,
  p_livemode boolean,
  p_current_period_start timestamp with time zone,
  p_current_period_end timestamp with time zone,
  p_cancel_at_period_end boolean,
  p_grace_until timestamp with time zone,
  p_event_created bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  existing_account public.organization_billing_accounts;
  snapshot_result jsonb;
  same_subscription boolean;
  authorized_checkout boolean;
  replacing_subscription boolean;
  effective_event_created bigint := p_event_created;
BEGIN
  IF p_organization_id IS NULL
     OR p_event_created IS NULL
     OR p_event_created < 0
     OR p_livemode IS NULL
     OR p_cancel_at_period_end IS NULL THEN
    RAISE EXCEPTION 'invalid_billing_snapshot' USING ERRCODE = '22023';
  END IF;
  IF p_stripe_customer_id IS NULL
     OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
     OR p_stripe_subscription_id IS NULL
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_stripe_price_id IS NULL
     OR p_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
     OR (
       p_stripe_checkout_session_id IS NOT NULL
       AND p_stripe_checkout_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     ) THEN
    RAISE EXCEPTION 'invalid_stripe_billing_identifiers' USING ERRCODE = '22023';
  END IF;

  -- Keep the established lock order used by the entitlement and seat
  -- functions: organization first, billing account second.
  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF organization_record.kind <> 'application' THEN
    RAISE EXCEPTION 'application_organization_required' USING ERRCODE = '23514';
  END IF;

  SELECT account.* INTO existing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  -- A durable Customer and Checkout Session are recorded before Checkout is
  -- opened. Without that row there is no trusted generation to bind.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'subscriptionAccepted', false,
      'subscriptionReplaced', false,
      'organizationId', p_organization_id,
      'billingAccessState', organization_record.billing_access_state,
      'stripeSubscriptionStatus', NULL,
      'lastStripeEventCreatedAt', 0
    );
  END IF;

  IF existing_account.stripe_customer_id IS NOT NULL
     AND existing_account.stripe_customer_id <> p_stripe_customer_id THEN
    RAISE EXCEPTION 'stripe_customer_mismatch' USING ERRCODE = '23514';
  END IF;
  IF existing_account.stripe_customer_id IS NOT NULL
     AND existing_account.livemode IS DISTINCT FROM p_livemode THEN
    RAISE EXCEPTION 'stripe_livemode_mismatch' USING ERRCODE = '23514';
  END IF;

  same_subscription := existing_account.stripe_subscription_id IS NOT DISTINCT FROM
    p_stripe_subscription_id;
  authorized_checkout := p_stripe_checkout_session_id IS NOT NULL
    AND p_stripe_checkout_session_id = existing_account.stripe_checkout_session_id;
  replacing_subscription := NOT same_subscription;

  -- A supplied Checkout ID must always be the current stored generation. A
  -- different Subscription can only be bound by that exact Checkout.
  IF (p_stripe_checkout_session_id IS NOT NULL AND NOT authorized_checkout)
     OR (replacing_subscription AND NOT authorized_checkout) THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'subscriptionAccepted', false,
      'subscriptionReplaced', false,
      'organizationId', p_organization_id,
      'billingAccessState', organization_record.billing_access_state,
      'stripeSubscriptionStatus', existing_account.stripe_subscription_status,
      'stripeSubscriptionId', existing_account.stripe_subscription_id,
      'lastStripeEventCreatedAt', existing_account.last_stripe_event_created_at
    );
  END IF;

  IF replacing_subscription THEN
    -- Event timestamps are monotonic only within a subscription generation.
    -- The current Checkout must win even if a late event from the previous
    -- generation advanced the account timestamp while waiting for this lock.
    effective_event_created := greatest(
      existing_account.last_stripe_event_created_at,
      p_event_created
    );

    -- A replacement past_due period starts its own grace window. Prevent the
    -- unchecked compatibility function from inheriting grace from the old
    -- generation. This mutation rolls back if the snapshot fails.
    IF existing_account.stripe_subscription_status = 'past_due' THEN
      UPDATE public.organization_billing_accounts
      SET stripe_subscription_status = 'canceled',
          grace_until = NULL
      WHERE organization_id = p_organization_id;
    END IF;
  END IF;

  snapshot_result := private.apply_organization_billing_snapshot_unchecked_v1(
    p_organization_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_checkout_session_id,
    p_stripe_price_id,
    p_subscription_status,
    p_livemode,
    p_current_period_start,
    p_current_period_end,
    p_cancel_at_period_end,
    p_grace_until,
    effective_event_created
  );

  RETURN snapshot_result || jsonb_build_object(
    'subscriptionAccepted', true,
    'subscriptionReplaced', replacing_subscription
  );
END
$function$;

ALTER FUNCTION private.apply_organization_billing_snapshot_unchecked_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) OWNER TO openexpert_owner;

ALTER FUNCTION public.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) TO openexpert_service;

COMMENT ON FUNCTION public.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) IS
  'Applies a Stripe billing snapshot with an atomic Checkout-bound subscription generation fence.';

NOTIFY pgrst, 'reload schema';
