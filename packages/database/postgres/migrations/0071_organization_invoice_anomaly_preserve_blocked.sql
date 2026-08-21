-- An invoice anomaly may restrict otherwise valid active/grace access, but it
-- must never reopen access that another fail-closed billing invariant blocked
-- (for example, a canonical Stripe seat-item or quantity mismatch).

CREATE OR REPLACE FUNCTION private.enforce_organization_invoice_billing_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  billing_account public.organization_billing_accounts;
  earliest_failure_grace timestamp with time zone;
BEGIN
  IF NEW.kind <> 'application' THEN
    RETURN NEW;
  END IF;

  -- `blocked` and `subscription_required` can encode a stricter invariant
  -- than invoice collection. An invoice grace window may only narrow a state
  -- that the subscription snapshot otherwise considered usable.
  IF NEW.billing_access_state NOT IN ('active', 'grace') THEN
    RETURN NEW;
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = NEW.id;

  IF NOT FOUND OR billing_account.stripe_subscription_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT min(invoice_state.grace_until)
  INTO earliest_failure_grace
  FROM public.organization_billing_invoice_states AS invoice_state
  WHERE invoice_state.organization_id = NEW.id
    AND invoice_state.stripe_subscription_id = billing_account.stripe_subscription_id
    AND invoice_state.state = 'failed';

  IF earliest_failure_grace IS NULL THEN
    RETURN NEW;
  END IF;

  IF earliest_failure_grace > statement_timestamp()
     AND (
       billing_account.stripe_subscription_status IN ('active', 'trialing')
       OR (
         billing_account.stripe_subscription_status = 'past_due'
         AND billing_account.grace_until > statement_timestamp()
       )
     ) THEN
    NEW.billing_access_state := 'grace';
  ELSE
    NEW.billing_access_state := 'blocked';
  END IF;
  RETURN NEW;
END
$function$;

ALTER FUNCTION private.enforce_organization_invoice_billing_state()
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.enforce_organization_invoice_billing_state()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

COMMENT ON FUNCTION private.enforce_organization_invoice_billing_state() IS
  'Narrows active/grace access for current-subscription invoice anomalies while preserving stricter fail-closed billing states.';

NOTIFY pgrst, 'reload schema';
