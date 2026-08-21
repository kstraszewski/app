-- Fence the external Stripe seat mutation against manual stale-saga recovery.
--
-- The database cannot keep a transaction open around Stripe. Instead, the
-- mutating request compares and touches the exact seat-change revision
-- immediately before `subscriptions.update`. Recovery may fail an abandoned
-- change only with the exact revision it observed. Whichever CAS wins makes the
-- other path harmless before it can create a charge or terminate the saga.

ALTER FUNCTION public.begin_organization_member_seat_change_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) SET SCHEMA private;

ALTER FUNCTION private.begin_organization_member_seat_change_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) RENAME TO begin_organization_member_seat_change_unfenced_v1;

REVOKE ALL ON FUNCTION private.begin_organization_member_seat_change_unfenced_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.begin_organization_member_seat_change_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_email text,
  p_target_role text,
  p_idempotency_key uuid,
  p_expected_seat_count integer,
  p_proration_date timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  change_result jsonb;
  change_updated_at timestamp with time zone;
BEGIN
  change_result := private.begin_organization_member_seat_change_unfenced_v1(
    p_organization_id,
    p_actor_user_id,
    p_target_email,
    p_target_role,
    p_idempotency_key,
    p_expected_seat_count,
    p_proration_date
  );

  SELECT seat_change.updated_at INTO STRICT change_updated_at
  FROM public.organization_billing_seat_changes AS seat_change
  WHERE seat_change.id = (change_result ->> 'seatChangeId')::uuid;

  RETURN change_result || jsonb_build_object('updatedAt', change_updated_at);
END
$function$;

CREATE FUNCTION public.claim_organization_member_seat_stripe_update_v1(
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

  UPDATE public.organization_billing_seat_changes
  SET status = 'pending',
      attempts = attempts + 1
  WHERE id = p_seat_change_id
    AND status IN ('prepared', 'pending')
    AND updated_at = p_expected_updated_at
  RETURNING * INTO claimed_change;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'seatChangeId', claimed_change.id,
      'status', claimed_change.status,
      'updatedAt', claimed_change.updated_at
    );
  END IF;

  RETURN jsonb_build_object(
    'claimed', false,
    'seatChangeId', seat_change.id,
    'status', seat_change.status,
    'updatedAt', seat_change.updated_at
  );
END
$function$;

CREATE FUNCTION public.fail_stale_organization_member_seat_change_v1(
  p_seat_change_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_stale_before timestamp with time zone,
  p_failure_code text,
  p_failure_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  seat_change public.organization_billing_seat_changes;
  failed_change public.organization_billing_seat_changes;
  normalized_failure_code text := lower(nullif(btrim(p_failure_code), ''));
  normalized_failure_message text := nullif(btrim(p_failure_message), '');
BEGIN
  IF p_seat_change_id IS NULL
     OR p_expected_updated_at IS NULL
     OR p_stale_before IS NULL
     OR normalized_failure_code IS NULL
     OR normalized_failure_code !~ '^[a-z][a-z0-9_.:-]{0,127}$' THEN
    RAISE EXCEPTION 'invalid_stale_organization_seat_change_failure'
      USING ERRCODE = '22023';
  END IF;
  IF normalized_failure_message IS NOT NULL
     AND length(normalized_failure_message) > 2000 THEN
    RAISE EXCEPTION 'organization_seat_change_failure_message_too_long'
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

  UPDATE public.organization_billing_seat_changes
  SET status = 'failed',
      failure_code = normalized_failure_code,
      failure_message = normalized_failure_message,
      completed_at = statement_timestamp()
  WHERE id = p_seat_change_id
    AND status IN ('prepared', 'pending')
    AND updated_at = p_expected_updated_at
    AND updated_at <= p_stale_before
  RETURNING * INTO failed_change;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'failed', true,
      'seatChangeId', failed_change.id,
      'status', failed_change.status,
      'updatedAt', failed_change.updated_at
    );
  END IF;

  RETURN jsonb_build_object(
    'failed', false,
    'seatChangeId', seat_change.id,
    'status', seat_change.status,
    'updatedAt', seat_change.updated_at
  );
END
$function$;

ALTER FUNCTION private.begin_organization_member_seat_change_unfenced_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) OWNER TO openexpert_owner;

ALTER FUNCTION public.begin_organization_member_seat_change_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) OWNER TO openexpert_owner;

ALTER FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) OWNER TO openexpert_owner;

ALTER FUNCTION public.fail_stale_organization_member_seat_change_v1(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text,
  text
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.begin_organization_member_seat_change_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

REVOKE ALL ON FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

REVOKE ALL ON FUNCTION public.fail_stale_organization_member_seat_change_v1(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.begin_organization_member_seat_change_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) TO openexpert_service;

GRANT EXECUTE ON FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) TO openexpert_service;

GRANT EXECUTE ON FUNCTION public.fail_stale_organization_member_seat_change_v1(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text,
  text
) TO openexpert_service;

COMMENT ON FUNCTION public.claim_organization_member_seat_stripe_update_v1(
  uuid,
  timestamp with time zone
) IS
  'CAS-touches an open seat saga immediately before its one external Stripe quantity mutation.';

COMMENT ON FUNCTION public.fail_stale_organization_member_seat_change_v1(
  uuid,
  timestamp with time zone,
  timestamp with time zone,
  text,
  text
) IS
  'CAS-fails only the unchanged stale seat saga observed by recovery; concurrent Stripe mutation claims win safely.';

NOTIFY pgrst, 'reload schema';
