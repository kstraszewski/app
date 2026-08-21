-- A Stripe idempotency key is not a permanent replay fence: Stripe may prune
-- results after its retention window. Therefore every seat saga may authorize
-- exactly one external quantity mutation. Later requests only read canonical
-- Stripe state and let stale recovery terminate a genuinely abandoned saga.

CREATE OR REPLACE FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  p_seat_change_id uuid,
  p_expected_updated_at timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  seat_change public.organization_billing_seat_changes;
  claimed_change public.organization_billing_seat_changes;
BEGIN
  IF p_seat_change_id IS NULL OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'invalid_organization_seat_change_claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT candidate.* INTO seat_change
  FROM public.organization_billing_seat_changes AS candidate
  WHERE candidate.id = p_seat_change_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_seat_change_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- The transition itself is the durable one-shot fence. A pending row has
  -- already crossed the external-side-effect boundary, even when the original
  -- request lost its Stripe response and could not persist an Invoice ID.
  UPDATE public.organization_billing_seat_changes
  SET status = 'pending',
      attempts = 1
  WHERE id = p_seat_change_id
    AND status = 'prepared'
    AND attempts = 0
    AND stripe_invoice_id IS NULL
    AND payment_url IS NULL
    AND updated_at = p_expected_updated_at
  RETURNING * INTO claimed_change;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'seatChangeId', claimed_change.id,
      'status', claimed_change.status,
      'attempts', claimed_change.attempts,
      'updatedAt', claimed_change.updated_at
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', false,
    'seatChangeId', seat_change.id,
    'status', seat_change.status,
    'attempts', seat_change.attempts,
    'updatedAt', seat_change.updated_at
  );
END
$function$;

ALTER FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) TO openexpert_service;

COMMENT ON FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) IS
  'One-shot CAS from prepared/attempts=0 to pending/attempts=1 immediately before the saga only external Stripe mutation.';

NOTIFY pgrst, 'reload schema';
