-- A Stripe seat invoice is a durable correlation identifier even when Stripe
-- does not expose an actionable Hosted Invoice URL (for example, invoice
-- finalization failure). Preserve that identifier independently so delayed
-- terminal events cannot be misclassified as renewal failures.

ALTER TABLE public.organization_billing_seat_changes
  DROP CONSTRAINT organization_billing_seat_changes_payment_reference_pair_check;

ALTER TABLE public.organization_billing_seat_changes
  ADD CONSTRAINT organization_billing_seat_changes_payment_reference_pair_check CHECK (
    payment_url IS NULL OR stripe_invoice_id IS NOT NULL
  );

CREATE OR REPLACE FUNCTION public.mark_organization_member_seat_change_v1(
  p_seat_change_id uuid,
  p_status text,
  p_failure_code text DEFAULT NULL,
  p_failure_message text DEFAULT NULL,
  p_stripe_invoice_id text DEFAULT NULL,
  p_payment_url text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  seat_change public.organization_billing_seat_changes;
  normalized_status text := lower(btrim(p_status));
  normalized_failure_code text := lower(nullif(btrim(p_failure_code), ''));
  normalized_failure_message text := nullif(btrim(p_failure_message), '');
  normalized_invoice_id text := nullif(btrim(p_stripe_invoice_id), '');
  normalized_payment_url text := nullif(btrim(p_payment_url), '');
  was_replayed boolean := false;
BEGIN
  IF p_seat_change_id IS NULL
     OR normalized_status IS NULL
     OR normalized_status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'invalid_organization_seat_change_status'
      USING ERRCODE = '22023';
  END IF;
  IF normalized_status = 'failed'
     AND (
       normalized_failure_code IS NULL
       OR normalized_failure_code !~ '^[a-z][a-z0-9_.:-]{0,127}$'
     ) THEN
    RAISE EXCEPTION 'organization_seat_change_failure_code_required'
      USING ERRCODE = '22023';
  END IF;
  IF normalized_failure_message IS NOT NULL
     AND length(normalized_failure_message) > 2000 THEN
    RAISE EXCEPTION 'organization_seat_change_failure_message_too_long'
      USING ERRCODE = '22023';
  END IF;
  IF (
       normalized_payment_url IS NOT NULL
       AND normalized_invoice_id IS NULL
     )
     OR (
       normalized_invoice_id IS NOT NULL
       AND normalized_invoice_id !~ '^in_[A-Za-z0-9]+$'
     )
     OR (
       normalized_payment_url IS NOT NULL
       AND (
         normalized_payment_url !~ '^https://[^[:space:]]+$'
         OR length(normalized_payment_url) > 2000
       )
     )
     OR (
       normalized_invoice_id IS NOT NULL
       AND normalized_status <> 'pending'
     ) THEN
    RAISE EXCEPTION 'invalid_organization_seat_change_payment_reference'
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

  IF (
       normalized_invoice_id IS NOT NULL
       AND seat_change.stripe_invoice_id IS NOT NULL
       AND seat_change.stripe_invoice_id <> normalized_invoice_id
     )
     OR (
       normalized_payment_url IS NOT NULL
       AND seat_change.payment_url IS NOT NULL
       AND seat_change.payment_url <> normalized_payment_url
     ) THEN
    RAISE EXCEPTION 'organization_seat_change_payment_reference_conflict'
      USING ERRCODE = '23514';
  END IF;

  IF seat_change.status IN ('succeeded', 'failed')
     AND normalized_status = 'pending'
     AND normalized_invoice_id IS NOT NULL THEN
    -- A verified Stripe event can race the saga terminal transition. Preserve
    -- correlation without reopening or otherwise changing that terminal row.
    UPDATE public.organization_billing_seat_changes
    SET stripe_invoice_id = coalesce(stripe_invoice_id, normalized_invoice_id),
        payment_url = coalesce(payment_url, normalized_payment_url)
    WHERE id = p_seat_change_id
    RETURNING * INTO seat_change;
    was_replayed := true;
  ELSIF seat_change.status = 'succeeded' THEN
    was_replayed := true;
  ELSIF seat_change.status = 'failed' THEN
    IF normalized_status <> 'failed' THEN
      RAISE EXCEPTION 'organization_seat_change_is_terminal'
        USING ERRCODE = '55000';
    END IF;
    was_replayed := true;
  ELSIF seat_change.status = 'pending'
        AND normalized_status = 'pending'
        AND (
          normalized_invoice_id IS NULL
          OR seat_change.stripe_invoice_id IS NOT NULL
        )
        AND (
          normalized_payment_url IS NULL
          OR seat_change.payment_url IS NOT NULL
        ) THEN
    was_replayed := true;
  ELSE
    UPDATE public.organization_billing_seat_changes
    SET status = normalized_status,
        attempts = attempts + CASE WHEN normalized_status = 'pending' THEN 1 ELSE 0 END,
        failure_code = CASE
          WHEN normalized_status = 'failed' THEN normalized_failure_code
          ELSE NULL
        END,
        failure_message = CASE
          WHEN normalized_status = 'failed' THEN normalized_failure_message
          ELSE NULL
        END,
        stripe_invoice_id = CASE
          WHEN normalized_status = 'pending' THEN coalesce(
            stripe_invoice_id,
            normalized_invoice_id
          )
          ELSE stripe_invoice_id
        END,
        payment_url = CASE
          WHEN normalized_status = 'pending' THEN coalesce(
            payment_url,
            normalized_payment_url
          )
          ELSE payment_url
        END,
        completed_at = CASE
          WHEN normalized_status = 'failed' THEN statement_timestamp()
          ELSE NULL
        END
    WHERE id = p_seat_change_id
    RETURNING * INTO seat_change;
  END IF;

  RETURN jsonb_build_object(
    'seatChangeId', seat_change.id,
    'organizationId', seat_change.organization_id,
    'status', seat_change.status,
    'replayed', was_replayed,
    'targetUserId', seat_change.target_user_id,
    'targetEmail', seat_change.target_email_normalized,
    'targetRole', seat_change.target_role,
    'currentSeatCount', seat_change.expected_seat_count,
    'targetSeatCount', seat_change.target_seat_count,
    'seatRevision', seat_change.base_seat_revision,
    'stripeSubscriptionId', seat_change.stripe_subscription_id,
    'stripeSubscriptionItemId', seat_change.stripe_subscription_item_id,
    'stripeIdempotencyKey', seat_change.stripe_idempotency_key,
    'stripeInvoiceId', seat_change.stripe_invoice_id,
    'paymentUrl', seat_change.payment_url,
    'prorationDate', seat_change.proration_date,
    'failureCode', seat_change.failure_code
  );
END
$function$;

ALTER FUNCTION public.mark_organization_member_seat_change_v1(
  uuid,
  text,
  text,
  text,
  text,
  text
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.mark_organization_member_seat_change_v1(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.mark_organization_member_seat_change_v1(
  uuid,
  text,
  text,
  text,
  text,
  text
) TO openexpert_service;

COMMENT ON CONSTRAINT organization_billing_seat_changes_payment_reference_pair_check
  ON public.organization_billing_seat_changes IS
  'A Hosted Invoice URL always belongs to the persisted seat Invoice; Invoice correlation remains valid without a hosted payment URL.';

COMMENT ON FUNCTION public.mark_organization_member_seat_change_v1(
  uuid,
  text,
  text,
  text,
  text,
  text
) IS
  'Marks a seat saga pending/failed and durably binds a verified Stripe Invoice ID even when no actionable Hosted Invoice URL exists.';

-- Terminal Invoice ledger transitions and canonical Subscription projection
-- are separate service RPCs. Preserve every pre-existing block across that
-- split: only the atomic billing+seat snapshot may revalidate all invariants
-- and unlock access.
CREATE OR REPLACE FUNCTION public.apply_organization_invoice_billing_state_v1(
  p_organization_id uuid,
  p_stripe_subscription_id text,
  p_stripe_invoice_id text,
  p_event_created bigint,
  p_state text,
  p_failure_kind text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_access_state text;
  preserve_existing_block boolean := false;
  invoice_result jsonb;
  effective_access_state text;
BEGIN
  SELECT organization.billing_access_state INTO organization_access_state
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Keep the organization -> account lock order used by the combined writer.
  PERFORM account.organization_id
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  preserve_existing_block := organization_access_state = 'blocked';

  invoice_result := private.apply_organization_invoice_billing_state_unfenced_v1(
    p_organization_id,
    p_stripe_subscription_id,
    p_stripe_invoice_id,
    p_event_created,
    p_state,
    p_failure_kind
  );

  IF preserve_existing_block THEN
    UPDATE public.organizations
    SET billing_access_state = 'blocked'
    WHERE id = p_organization_id;
  END IF;

  SELECT organization.billing_access_state INTO STRICT effective_access_state
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id;

  RETURN invoice_result || jsonb_build_object(
    'billingAccessState', effective_access_state,
    -- Preserve the deployed response key while exposing the stronger fence.
    'newerBlockPreserved', preserve_existing_block,
    'existingBlockPreserved', preserve_existing_block
  );
END
$function$;

ALTER FUNCTION public.apply_organization_invoice_billing_state_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.apply_organization_invoice_billing_state_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.apply_organization_invoice_billing_state_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) TO openexpert_service;

COMMENT ON FUNCTION public.apply_organization_invoice_billing_state_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) IS
  'Updates a per-Invoice anomaly monotonically while preserving every pre-existing block; only the atomic canonical billing/seat snapshot may unlock access.';

NOTIFY pgrst, 'reload schema';
