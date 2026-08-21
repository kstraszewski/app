-- A delayed invoice event may update its own per-invoice ledger row, but it
-- must not reopen an organization that a newer canonical billing/seat snapshot
-- explicitly blocked. Only an equal-or-newer snapshot is allowed to restore
-- access after revalidating the current subscription and seat invariants.

ALTER FUNCTION public.apply_organization_invoice_billing_state_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) SET SCHEMA private;

ALTER FUNCTION private.apply_organization_invoice_billing_state_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) RENAME TO apply_organization_invoice_billing_state_unfenced_v1;

REVOKE ALL ON FUNCTION private.apply_organization_invoice_billing_state_unfenced_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.apply_organization_invoice_billing_state_v1(
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
  account_last_event_created bigint;
  preserve_newer_block boolean := false;
  invoice_result jsonb;
  effective_access_state text;
BEGIN
  -- Preserve the shared organization -> billing-account lock order. The inner
  -- compatibility function takes the same row locks reentrantly.
  SELECT organization.billing_access_state INTO organization_access_state
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT account.last_stripe_event_created_at
  INTO account_last_event_created
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  preserve_newer_block := organization_access_state = 'blocked'
    AND p_event_created IS NOT NULL
    AND p_event_created < account_last_event_created;

  invoice_result := private.apply_organization_invoice_billing_state_unfenced_v1(
    p_organization_id,
    p_stripe_subscription_id,
    p_stripe_invoice_id,
    p_event_created,
    p_state,
    p_failure_kind
  );

  IF preserve_newer_block THEN
    UPDATE public.organizations
    SET billing_access_state = 'blocked'
    WHERE id = p_organization_id;
  END IF;

  SELECT organization.billing_access_state INTO STRICT effective_access_state
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id;

  RETURN invoice_result || jsonb_build_object(
    'billingAccessState', effective_access_state,
    'newerBlockPreserved', preserve_newer_block
  );
END
$function$;

ALTER FUNCTION private.apply_organization_invoice_billing_state_unfenced_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) OWNER TO openexpert_owner;

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
  'Updates a per-invoice anomaly monotonically without reopening access blocked by a newer canonical billing/seat snapshot.';

NOTIFY pgrst, 'reload schema';
