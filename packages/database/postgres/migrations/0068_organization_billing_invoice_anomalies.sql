-- Durable per-invoice billing anomalies. Stripe can leave a Subscription
-- `active` when renewal invoice finalization fails or an invoice is voided.
-- Access therefore cannot be derived from Subscription.status alone.

CREATE TABLE public.organization_billing_invoice_states (
  stripe_invoice_id text PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL,
  state text NOT NULL,
  failure_kind text,
  event_created bigint NOT NULL,
  grace_until timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_billing_invoice_states_invoice_id_check CHECK (
    stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_invoice_states_subscription_id_check CHECK (
    stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_invoice_states_state_check CHECK (
    state IN ('failed', 'resolved')
  ),
  CONSTRAINT organization_billing_invoice_states_event_created_check CHECK (
    event_created > 0
  ),
  CONSTRAINT organization_billing_invoice_states_failure_kind_check CHECK (
    failure_kind IS NULL
    OR failure_kind ~ '^[a-z][a-z0-9_.:-]{0,127}$'
  ),
  CONSTRAINT organization_billing_invoice_states_lifecycle_check CHECK (
    (
      state = 'failed'
      AND failure_kind IS NOT NULL
      AND grace_until IS NOT NULL
    )
    OR (
      state = 'resolved'
      AND failure_kind IS NULL
      AND grace_until IS NULL
    )
  )
);

CREATE INDEX organization_billing_invoice_states_open_idx
  ON public.organization_billing_invoice_states (
    organization_id,
    stripe_subscription_id,
    grace_until
  )
  WHERE state = 'failed';

CREATE TRIGGER set_organization_billing_invoice_states_updated_at
  BEFORE UPDATE ON public.organization_billing_invoice_states
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.organization_billing_invoice_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_billing_invoice_states
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.enforce_organization_invoice_billing_state()
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

CREATE TRIGGER organizations_enforce_invoice_billing_state
  BEFORE UPDATE OF billing_access_state ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_organization_invoice_billing_state();

CREATE OR REPLACE FUNCTION private.has_organization_billing_entitlement(
  target_organization_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    LEFT JOIN public.organization_billing_accounts AS billing_account
      ON billing_account.organization_id = organization.id
    WHERE organization.id = target_organization_id
      AND (
        (
          organization.kind = 'intermediary'
          AND organization.billing_access_state = 'not_required'
        )
        OR (
          organization.kind = 'application'
          AND billing_account.stripe_subscription_item_id IS NOT NULL
          AND billing_account.licensed_seat_count = (
            SELECT count(*)::integer
            FROM public.organization_memberships AS membership
            WHERE membership.organization_id = organization.id
          )
          AND (
            (
              NOT EXISTS (
                SELECT 1
                FROM public.organization_billing_invoice_states AS invoice_state
                WHERE invoice_state.organization_id = organization.id
                  AND invoice_state.stripe_subscription_id =
                    billing_account.stripe_subscription_id
                  AND invoice_state.state = 'failed'
              )
              AND (
                (
                  organization.billing_access_state = 'active'
                  AND billing_account.stripe_subscription_status IN ('active', 'trialing')
                )
                OR (
                  organization.billing_access_state = 'grace'
                  AND billing_account.stripe_subscription_status = 'past_due'
                  AND billing_account.grace_until > statement_timestamp()
                )
              )
            )
            OR (
              organization.billing_access_state = 'grace'
              AND (
                billing_account.stripe_subscription_status IN ('active', 'trialing')
                OR (
                  billing_account.stripe_subscription_status = 'past_due'
                  AND billing_account.grace_until > statement_timestamp()
                )
              )
              AND NOT EXISTS (
                SELECT 1
                FROM public.organization_billing_invoice_states AS invoice_state
                WHERE invoice_state.organization_id = organization.id
                  AND invoice_state.stripe_subscription_id =
                    billing_account.stripe_subscription_id
                  AND invoice_state.state = 'failed'
                  AND invoice_state.grace_until <= statement_timestamp()
              )
              AND EXISTS (
                SELECT 1
                FROM public.organization_billing_invoice_states AS invoice_state
                WHERE invoice_state.organization_id = organization.id
                  AND invoice_state.stripe_subscription_id =
                    billing_account.stripe_subscription_id
                  AND invoice_state.state = 'failed'
              )
            )
          )
        )
      )
  )
$function$;

ALTER FUNCTION private.has_organization_billing_entitlement(uuid)
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.has_organization_billing_entitlement(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.has_organization_billing_entitlement(uuid)
  TO authenticated;

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
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  existing_state public.organization_billing_invoice_states;
  applied_state public.organization_billing_invoice_states;
  normalized_state text := lower(nullif(btrim(p_state), ''));
  normalized_failure_kind text := lower(nullif(btrim(p_failure_kind), ''));
  next_grace_until timestamp with time zone;
  next_access_state text;
BEGIN
  IF p_organization_id IS NULL
     OR p_stripe_subscription_id IS NULL
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_stripe_invoice_id IS NULL
     OR p_stripe_invoice_id !~ '^in_[A-Za-z0-9]+$'
     OR p_event_created IS NULL
     OR p_event_created <= 0
     OR normalized_state NOT IN ('failed', 'resolved')
     OR (
       normalized_state = 'failed'
       AND (
         normalized_failure_kind IS NULL
         OR normalized_failure_kind !~ '^[a-z][a-z0-9_.:-]{0,127}$'
       )
     )
     OR (normalized_state = 'resolved' AND normalized_failure_kind IS NOT NULL) THEN
    RAISE EXCEPTION 'invalid_organization_invoice_billing_state'
      USING ERRCODE = '22023';
  END IF;

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
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'subscriptionAccepted', false,
      'organizationId', p_organization_id,
      'billingAccessState', organization_record.billing_access_state
    );
  END IF;

  SELECT invoice_state.* INTO existing_state
  FROM public.organization_billing_invoice_states AS invoice_state
  WHERE invoice_state.stripe_invoice_id = p_stripe_invoice_id
  FOR UPDATE;

  IF FOUND AND (
    existing_state.organization_id <> p_organization_id
    OR existing_state.stripe_subscription_id <> p_stripe_subscription_id
  ) THEN
    RAISE EXCEPTION 'stripe_invoice_billing_identity_mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF FOUND AND (
    existing_state.event_created > p_event_created
    OR (
      existing_state.event_created = p_event_created
      AND existing_state.state = 'resolved'
      AND normalized_state = 'failed'
    )
  ) THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'subscriptionAccepted', true,
      'organizationId', p_organization_id,
      'billingAccessState', organization_record.billing_access_state,
      'invoiceState', existing_state.state
    );
  END IF;

  next_grace_until := CASE
    WHEN normalized_state = 'resolved' THEN NULL
    WHEN FOUND AND existing_state.state = 'failed'
      THEN existing_state.grace_until
    ELSE to_timestamp(p_event_created) + interval '7 days'
  END;

  INSERT INTO public.organization_billing_invoice_states AS invoice_state (
    stripe_invoice_id,
    organization_id,
    stripe_subscription_id,
    state,
    failure_kind,
    event_created,
    grace_until
  ) VALUES (
    p_stripe_invoice_id,
    p_organization_id,
    p_stripe_subscription_id,
    normalized_state,
    CASE WHEN normalized_state = 'failed' THEN normalized_failure_kind ELSE NULL END,
    p_event_created,
    next_grace_until
  )
  ON CONFLICT (stripe_invoice_id) DO UPDATE
  SET state = excluded.state,
      failure_kind = excluded.failure_kind,
      event_created = excluded.event_created,
      grace_until = excluded.grace_until
  RETURNING * INTO applied_state;

  next_access_state := CASE
    WHEN billing_account.stripe_subscription_status IN ('active', 'trialing')
      THEN 'active'
    WHEN billing_account.stripe_subscription_status = 'incomplete'
      THEN 'subscription_required'
    WHEN billing_account.stripe_subscription_status = 'past_due'
      AND billing_account.grace_until > statement_timestamp()
      THEN 'grace'
    ELSE 'blocked'
  END;

  -- The BEFORE trigger converts active/grace to the earliest unresolved
  -- invoice anomaly grace state, or blocked once its deadline has elapsed.
  UPDATE public.organizations
  SET billing_access_state = next_access_state
  WHERE id = p_organization_id
  RETURNING * INTO organization_record;

  RETURN jsonb_build_object(
    'applied', true,
    'stale', false,
    'subscriptionAccepted', true,
    'organizationId', p_organization_id,
    'billingAccessState', organization_record.billing_access_state,
    'stripeInvoiceId', applied_state.stripe_invoice_id,
    'invoiceState', applied_state.state,
    'failureKind', applied_state.failure_kind,
    'graceUntil', applied_state.grace_until
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

COMMENT ON TABLE public.organization_billing_invoice_states IS
  'Durable current-subscription invoice anomalies with per-invoice monotonic resolution and a seven-day access grace deadline.';
COMMENT ON FUNCTION public.apply_organization_invoice_billing_state_v1(
  uuid,
  text,
  text,
  bigint,
  text,
  text
) IS
  'Records or resolves a current-subscription invoice anomaly atomically; service role only.';

NOTIFY pgrst, 'reload schema';
