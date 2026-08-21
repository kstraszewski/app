-- Invoice-anomaly enforcement is implemented by an organizations trigger.
-- Return the state actually persisted by that trigger, rather than the raw
-- Subscription-derived candidate returned by the compatibility function.

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
) RENAME TO apply_organization_billing_snapshot_generation_v1;

REVOKE ALL ON FUNCTION private.apply_organization_billing_snapshot_generation_v1(
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
  snapshot_result jsonb;
  effective_access_state text;
BEGIN
  snapshot_result := private.apply_organization_billing_snapshot_generation_v1(
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
    p_event_created
  );

  SELECT organization.billing_access_state INTO effective_access_state
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id;

  IF effective_access_state IS NULL THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN snapshot_result || jsonb_build_object(
    'billingAccessState', effective_access_state
  );
END
$function$;

ALTER FUNCTION private.apply_organization_billing_snapshot_generation_v1(
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
  'Applies an atomically generation-fenced Stripe snapshot and returns the effective invoice-aware organization access state.';

NOTIFY pgrst, 'reload schema';
