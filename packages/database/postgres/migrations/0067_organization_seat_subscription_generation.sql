-- The billing snapshot is the atomic authority for the current Stripe
-- subscription generation (0066). A seat snapshot from an older generation is
-- therefore stale, not a quantity mismatch, and must never block paid access.

ALTER FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) SET SCHEMA private;

ALTER FUNCTION private.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) RENAME TO apply_organization_seat_snapshot_unchecked_v1;

REVOKE ALL ON FUNCTION private.apply_organization_seat_snapshot_unchecked_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.apply_organization_seat_snapshot_v1(
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_subscription_item_id text,
  p_quantity integer,
  p_event_created bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  membership_count integer;
BEGIN
  IF p_organization_id IS NULL
     OR p_stripe_subscription_id IS NULL
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_stripe_subscription_item_id IS NULL
     OR p_stripe_subscription_item_id !~ '^si_[A-Za-z0-9]+$'
     OR p_quantity IS NULL
     OR p_quantity < 1
     OR p_quantity > 1000
     OR p_event_created IS NULL
     OR p_event_created < 0 THEN
    RAISE EXCEPTION 'invalid_organization_seat_snapshot'
      USING ERRCODE = '22023';
  END IF;

  -- Preserve the shared organization -> billing-account lock order before the
  -- unchecked compatibility function takes the same locks reentrantly.
  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF organization_record.kind <> 'application' THEN
    RAISE EXCEPTION 'application_organization_required'
      USING ERRCODE = '23514';
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF billing_account.stripe_subscription_id IS DISTINCT FROM
     p_stripe_subscription_id THEN
    SELECT count(*)::integer INTO membership_count
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id;

    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'mismatch', false,
      'subscriptionAccepted', false,
      'organizationId', p_organization_id,
      'licensedSeatCount', billing_account.licensed_seat_count,
      'seatRevision', billing_account.seat_revision,
      'membershipSeatCount', membership_count,
      'completedSeatChangeId', NULL,
      'membershipCreated', false
    );
  END IF;

  RETURN private.apply_organization_seat_snapshot_unchecked_v1(
    p_organization_id,
    p_stripe_subscription_id,
    p_stripe_subscription_item_id,
    p_quantity,
    p_event_created
  ) || jsonb_build_object('subscriptionAccepted', true);
END
$function$;

ALTER FUNCTION private.apply_organization_seat_snapshot_unchecked_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) OWNER TO openexpert_owner;

ALTER FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) TO openexpert_service;

COMMENT ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) IS
  'Applies canonical seats only for the billing account current subscription generation; older generations are ignored as stale.';

NOTIFY pgrst, 'reload schema';
