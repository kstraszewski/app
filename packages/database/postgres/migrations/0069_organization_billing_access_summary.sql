-- One authoritative billing-access projection for server sessions. It applies
-- the earliest of Subscription past_due grace and unresolved invoice-anomaly
-- grace, while retaining the seat-count fail-closed invariant.

CREATE FUNCTION public.get_organization_billing_access_v1(
  p_organization_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  membership_count integer;
  invoice_failure_grace timestamp with time zone;
  effective_grace timestamp with time zone;
  effective_state text;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id_required' USING ERRCODE = '22023';
  END IF;

  SELECT organization.* INTO organization_record
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF organization_record.kind = 'intermediary' THEN
    RETURN jsonb_build_object(
      'organizationId', p_organization_id,
      'billingAccessState', 'not_required',
      'entitled', true,
      'graceUntil', NULL
    );
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id;

  IF NOT FOUND THEN
    effective_state := CASE
      WHEN organization_record.billing_access_state = 'subscription_required'
        THEN 'subscription_required'
      ELSE 'blocked'
    END;
    RETURN jsonb_build_object(
      'organizationId', p_organization_id,
      'billingAccessState', effective_state,
      'entitled', false,
      'graceUntil', NULL
    );
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  SELECT min(invoice_state.grace_until)
  INTO invoice_failure_grace
  FROM public.organization_billing_invoice_states AS invoice_state
  WHERE invoice_state.organization_id = p_organization_id
    AND invoice_state.stripe_subscription_id = billing_account.stripe_subscription_id
    AND invoice_state.state = 'failed';

  IF organization_record.billing_access_state = 'subscription_required' THEN
    effective_state := 'subscription_required';
  ELSIF organization_record.billing_access_state = 'blocked'
        OR billing_account.stripe_subscription_item_id IS NULL
        OR billing_account.licensed_seat_count <> membership_count THEN
    effective_state := 'blocked';
  ELSIF billing_account.stripe_subscription_status IN ('active', 'trialing') THEN
    IF invoice_failure_grace IS NULL
       AND organization_record.billing_access_state = 'active' THEN
      effective_state := 'active';
    ELSIF invoice_failure_grace > statement_timestamp()
          AND organization_record.billing_access_state = 'grace' THEN
      effective_state := 'grace';
      effective_grace := invoice_failure_grace;
    ELSE
      effective_state := 'blocked';
    END IF;
  ELSIF billing_account.stripe_subscription_status = 'past_due'
        AND billing_account.grace_until IS NOT NULL
        AND organization_record.billing_access_state = 'grace' THEN
    effective_grace := billing_account.grace_until;
    IF invoice_failure_grace IS NOT NULL THEN
      effective_grace := least(effective_grace, invoice_failure_grace);
    END IF;
    effective_state := CASE
      WHEN effective_grace > statement_timestamp() THEN 'grace'
      ELSE 'blocked'
    END;
  ELSE
    effective_state := 'blocked';
  END IF;

  RETURN jsonb_build_object(
    'organizationId', p_organization_id,
    'billingAccessState', effective_state,
    'entitled', effective_state IN ('active', 'grace'),
    'graceUntil', effective_grace
  );
END
$function$;

ALTER FUNCTION public.get_organization_billing_access_v1(uuid)
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION public.get_organization_billing_access_v1(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_organization_billing_access_v1(uuid)
  TO openexpert_service;

COMMENT ON FUNCTION public.get_organization_billing_access_v1(uuid) IS
  'Returns the authoritative seat-, subscription-, and invoice-aware billing access projection for a server session.';

NOTIFY pgrst, 'reload schema';
