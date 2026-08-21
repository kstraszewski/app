-- Public application billing offers:
--   individual: exactly one licensed seat at 200 PLN net / month
--   team: at least three licensed seats at 150 PLN net / seat / month
-- Existing subscriptions remain on the non-selectable legacy_per_seat plan.

ALTER TABLE public.organization_onboarding_invitations
  ADD COLUMN billing_plan_code text;

UPDATE public.organization_onboarding_invitations
SET billing_plan_code = CASE
  WHEN organization_kind = 'application' THEN 'legacy_per_seat'
  ELSE NULL
END;

ALTER TABLE public.organization_onboarding_invitations
  ADD CONSTRAINT organization_onboarding_invitations_billing_plan_check CHECK (
    billing_plan_code IS NULL
    OR billing_plan_code IN ('individual', 'team', 'legacy_per_seat')
  ) NOT VALID,
  ADD CONSTRAINT organization_onboarding_invitations_plan_kind_check CHECK (
    (
      organization_kind = 'intermediary'
      AND billing_plan_code IS NULL
      AND initial_seat_count = 1
    )
    OR (
      organization_kind = 'application'
      AND billing_plan_code IS NOT NULL
      AND (
        (billing_plan_code = 'individual' AND initial_seat_count = 1)
        OR (billing_plan_code = 'team' AND initial_seat_count BETWEEN 3 AND 1000)
        OR (billing_plan_code = 'legacy_per_seat' AND initial_seat_count BETWEEN 1 AND 1000)
      )
    )
  ) NOT VALID;

ALTER TABLE public.organization_onboarding_invitations
  VALIDATE CONSTRAINT organization_onboarding_invitations_billing_plan_check,
  VALIDATE CONSTRAINT organization_onboarding_invitations_plan_kind_check;

COMMENT ON COLUMN public.organization_onboarding_invitations.billing_plan_code IS
  'Immutable billing offer selected before organization creation. legacy_per_seat is retained only for pre-0081 invitations.';

CREATE OR REPLACE FUNCTION private.enforce_organization_onboarding_capacity_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF ROW(new.onboarding_source, new.initial_seat_count, new.billing_plan_code)
     IS DISTINCT FROM
     ROW(old.onboarding_source, old.initial_seat_count, old.billing_plan_code) THEN
    RAISE EXCEPTION 'organization_onboarding_offer_is_immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN new;
END
$function$;

ALTER FUNCTION private.enforce_organization_onboarding_capacity_immutable()
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.enforce_organization_onboarding_capacity_immutable()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

DROP TRIGGER organization_onboarding_invitations_capacity_immutable
  ON public.organization_onboarding_invitations;
CREATE TRIGGER organization_onboarding_invitations_capacity_immutable
  BEFORE UPDATE OF onboarding_source, initial_seat_count, billing_plan_code
  ON public.organization_onboarding_invitations
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_organization_onboarding_capacity_immutable();

ALTER TABLE public.organization_billing_accounts
  ADD COLUMN billing_plan_code text;

UPDATE public.organization_billing_accounts
SET billing_plan_code = 'legacy_per_seat';

ALTER TABLE public.organization_billing_accounts
  ADD CONSTRAINT organization_billing_accounts_plan_check CHECK (
    billing_plan_code IS NULL
    OR billing_plan_code IN ('individual', 'team', 'legacy_per_seat')
  ) NOT VALID,
  ADD CONSTRAINT organization_billing_accounts_bound_plan_check CHECK (
    stripe_subscription_item_id IS NULL OR billing_plan_code IS NOT NULL
  ) NOT VALID;

ALTER TABLE public.organization_billing_accounts
  VALIDATE CONSTRAINT organization_billing_accounts_plan_check,
  VALIDATE CONSTRAINT organization_billing_accounts_bound_plan_check;

COMMENT ON COLUMN public.organization_billing_accounts.billing_plan_code IS
  'Canonical local billing offer. NULL is allowed only before the first subscription item is bound.';

CREATE TABLE public.organization_billing_plan_changes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE RESTRICT,
  client_idempotency_key uuid NOT NULL UNIQUE,
  from_plan_code text NOT NULL,
  target_plan_code text NOT NULL,
  expected_seat_count integer NOT NULL,
  target_seat_count integer NOT NULL,
  base_seat_revision bigint NOT NULL,
  stripe_subscription_id text NOT NULL,
  stripe_subscription_item_id text NOT NULL,
  from_stripe_price_id text NOT NULL,
  target_stripe_price_id text NOT NULL,
  stripe_idempotency_key text NOT NULL UNIQUE,
  proration_date bigint NOT NULL,
  status text DEFAULT 'prepared' NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  stripe_invoice_id text,
  payment_url text,
  failure_code text,
  failure_message text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
  updated_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
  CONSTRAINT organization_billing_plan_changes_shape_check CHECK (
    from_plan_code = 'individual'
    AND target_plan_code = 'team'
    AND expected_seat_count = 1
    AND target_seat_count = 3
  ),
  CONSTRAINT organization_billing_plan_changes_revision_check CHECK (base_seat_revision >= 1),
  CONSTRAINT organization_billing_plan_changes_subscription_check CHECK (
    stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
    AND stripe_subscription_item_id ~ '^si_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_plan_changes_price_check CHECK (
    from_stripe_price_id ~ '^price_[A-Za-z0-9]+$'
    AND target_stripe_price_id ~ '^price_[A-Za-z0-9]+$'
    AND from_stripe_price_id <> target_stripe_price_id
  ),
  CONSTRAINT organization_billing_plan_changes_idempotency_check CHECK (
    stripe_idempotency_key = 'openexpert-plan-upgrade-' || id::text
  ),
  CONSTRAINT organization_billing_plan_changes_proration_check CHECK (proration_date > 0),
  CONSTRAINT organization_billing_plan_changes_status_check CHECK (
    status IN ('prepared', 'pending', 'succeeded', 'failed')
  ),
  CONSTRAINT organization_billing_plan_changes_attempts_check CHECK (attempts BETWEEN 0 AND 1),
  CONSTRAINT organization_billing_plan_changes_invoice_check CHECK (
    stripe_invoice_id IS NULL OR stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_plan_changes_payment_url_check CHECK (
    payment_url IS NULL OR (
      stripe_invoice_id IS NOT NULL
      AND payment_url ~ '^https://[^[:space:]]+$'
      AND length(payment_url) <= 2048
    )
  ),
  CONSTRAINT organization_billing_plan_changes_failure_check CHECK (
    failure_code IS NULL OR (
      failure_code ~ '^[a-z][a-z0-9_.:-]{0,119}$'
      AND length(coalesce(failure_message, '')) <= 500
    )
  ),
  CONSTRAINT organization_billing_plan_changes_lifecycle_check CHECK (
    (
      status = 'prepared'
      AND attempts = 0
      AND completed_at IS NULL
      AND failure_code IS NULL
    )
    OR (
      status = 'pending'
      AND attempts = 1
      AND completed_at IS NULL
      AND failure_code IS NULL
    )
    OR (
      status = 'succeeded'
      AND attempts = 1
      AND completed_at IS NOT NULL
      AND failure_code IS NULL
    )
    OR (
      status = 'failed'
      AND completed_at IS NOT NULL
      AND failure_code IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX organization_billing_plan_changes_open_unique
  ON public.organization_billing_plan_changes (organization_id)
  WHERE status IN ('prepared', 'pending');

CREATE INDEX organization_billing_plan_changes_organization_created_idx
  ON public.organization_billing_plan_changes (organization_id, created_at DESC);

CREATE UNIQUE INDEX organization_billing_plan_changes_invoice_unique
  ON public.organization_billing_plan_changes (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

CREATE TRIGGER set_organization_billing_plan_changes_updated_at
  BEFORE UPDATE ON public.organization_billing_plan_changes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.organization_billing_plan_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.organization_billing_plan_changes
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
CREATE POLICY organization_billing_plan_changes_service_select
  ON public.organization_billing_plan_changes
  FOR SELECT TO openexpert_service
  USING (true);
GRANT SELECT ON TABLE public.organization_billing_plan_changes
  TO openexpert_service;

CREATE FUNCTION public.begin_organization_plan_upgrade_v1(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_client_idempotency_key uuid,
  p_expected_seat_revision bigint,
  p_from_stripe_price_id text,
  p_target_stripe_price_id text,
  p_proration_date bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  existing_change public.organization_billing_plan_changes;
  created_change public.organization_billing_plan_changes;
  change_id uuid := gen_random_uuid();
  membership_count integer;
BEGIN
  IF p_organization_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_client_idempotency_key IS NULL
     OR p_expected_seat_revision IS NULL
     OR p_proration_date IS NULL
     OR p_proration_date <= 0
     OR p_from_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
     OR p_target_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
     OR p_from_stripe_price_id = p_target_stripe_price_id THEN
    RAISE EXCEPTION 'invalid_plan_upgrade_request' USING ERRCODE = '22023';
  END IF;

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

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = p_actor_user_id
    AND membership.role = 'admin'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_admin_required' USING ERRCODE = '42501';
  END IF;

  SELECT change.* INTO existing_change
  FROM public.organization_billing_plan_changes AS change
  WHERE change.client_idempotency_key = p_client_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_change.organization_id <> p_organization_id
       OR existing_change.actor_user_id <> p_actor_user_id
       OR existing_change.from_stripe_price_id <> p_from_stripe_price_id
       OR existing_change.target_stripe_price_id <> p_target_stripe_price_id
       OR existing_change.proration_date <> p_proration_date THEN
      RAISE EXCEPTION 'plan_upgrade_idempotency_conflict' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'changeId', existing_change.id,
      'status', existing_change.status,
      'attempts', existing_change.attempts,
      'updatedAt', existing_change.updated_at,
      'stripeIdempotencyKey', existing_change.stripe_idempotency_key,
      'stripeInvoiceId', existing_change.stripe_invoice_id,
      'paymentUrl', existing_change.payment_url,
      'replayed', true
    );
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  IF organization_record.billing_access_state NOT IN ('active', 'grace')
     OR billing_account.billing_plan_code <> 'individual'
     OR billing_account.licensed_seat_count <> 1
     OR billing_account.seat_revision <> p_expected_seat_revision
     OR billing_account.stripe_subscription_status NOT IN ('active', 'trialing')
     OR billing_account.stripe_subscription_id IS NULL
     OR billing_account.stripe_subscription_item_id IS NULL
     OR billing_account.stripe_price_id <> p_from_stripe_price_id
     OR membership_count <> 1 THEN
    RAISE EXCEPTION 'individual_plan_upgrade_state_changed' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organization_billing_seat_changes AS seat_change
    WHERE seat_change.organization_id = p_organization_id
      AND seat_change.status IN ('prepared', 'pending')
  ) THEN
    RAISE EXCEPTION 'organization_billing_change_in_progress' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.organization_billing_plan_changes (
    id,
    organization_id,
    actor_user_id,
    client_idempotency_key,
    from_plan_code,
    target_plan_code,
    expected_seat_count,
    target_seat_count,
    base_seat_revision,
    stripe_subscription_id,
    stripe_subscription_item_id,
    from_stripe_price_id,
    target_stripe_price_id,
    stripe_idempotency_key,
    proration_date
  ) VALUES (
    change_id,
    p_organization_id,
    p_actor_user_id,
    p_client_idempotency_key,
    'individual',
    'team',
    1,
    3,
    p_expected_seat_revision,
    billing_account.stripe_subscription_id,
    billing_account.stripe_subscription_item_id,
    p_from_stripe_price_id,
    p_target_stripe_price_id,
    'openexpert-plan-upgrade-' || change_id::text,
    p_proration_date
  )
  RETURNING * INTO created_change;

  RETURN jsonb_build_object(
    'changeId', created_change.id,
    'status', created_change.status,
    'attempts', created_change.attempts,
    'updatedAt', created_change.updated_at,
    'stripeIdempotencyKey', created_change.stripe_idempotency_key,
    'stripeInvoiceId', NULL,
    'paymentUrl', NULL,
    'replayed', false
  );
END
$function$;

CREATE FUNCTION public.claim_organization_plan_upgrade_v1(
  p_change_id uuid,
  p_expected_updated_at timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  current_change public.organization_billing_plan_changes;
BEGIN
  UPDATE public.organization_billing_plan_changes
  SET status = 'pending',
      attempts = 1
  WHERE id = p_change_id
    AND status = 'prepared'
    AND attempts = 0
    AND updated_at = p_expected_updated_at
  RETURNING * INTO current_change;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'claimed', true,
      'status', current_change.status,
      'updatedAt', current_change.updated_at
    );
  END IF;

  SELECT change.* INTO current_change
  FROM public.organization_billing_plan_changes AS change
  WHERE change.id = p_change_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_upgrade_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object(
    'claimed', false,
    'status', current_change.status,
    'updatedAt', current_change.updated_at
  );
END
$function$;

CREATE FUNCTION public.mark_organization_plan_upgrade_v1(
  p_change_id uuid,
  p_status text,
  p_stripe_invoice_id text DEFAULT NULL,
  p_payment_url text DEFAULT NULL,
  p_failure_code text DEFAULT NULL,
  p_failure_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  normalized_status text := lower(nullif(btrim(p_status), ''));
  normalized_failure_code text := lower(nullif(btrim(p_failure_code), ''));
  current_change public.organization_billing_plan_changes;
BEGIN
  IF normalized_status NOT IN ('pending', 'failed') THEN
    RAISE EXCEPTION 'invalid_plan_upgrade_status' USING ERRCODE = '22023';
  END IF;
  IF p_stripe_invoice_id IS NOT NULL
     AND p_stripe_invoice_id !~ '^in_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_plan_upgrade_invoice' USING ERRCODE = '22023';
  END IF;
  IF p_payment_url IS NOT NULL AND (
    p_stripe_invoice_id IS NULL
    OR p_payment_url !~ '^https://[^[:space:]]+$'
    OR length(p_payment_url) > 2048
  ) THEN
    RAISE EXCEPTION 'invalid_plan_upgrade_payment_url' USING ERRCODE = '22023';
  END IF;
  IF normalized_status = 'failed' AND (
    normalized_failure_code IS NULL
    OR normalized_failure_code !~ '^[a-z][a-z0-9_.:-]{0,119}$'
  ) THEN
    RAISE EXCEPTION 'invalid_plan_upgrade_failure' USING ERRCODE = '22023';
  END IF;

  SELECT change.* INTO current_change
  FROM public.organization_billing_plan_changes AS change
  WHERE change.id = p_change_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_upgrade_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_stripe_invoice_id IS NOT NULL
     AND current_change.stripe_invoice_id IS NOT NULL
     AND current_change.stripe_invoice_id <> p_stripe_invoice_id THEN
    RAISE EXCEPTION 'plan_upgrade_invoice_conflict' USING ERRCODE = '23514';
  END IF;
  IF p_payment_url IS NOT NULL
     AND current_change.payment_url IS NOT NULL
     AND current_change.payment_url <> p_payment_url THEN
    RAISE EXCEPTION 'plan_upgrade_payment_url_conflict' USING ERRCODE = '23514';
  END IF;

  UPDATE public.organization_billing_plan_changes
  SET status = normalized_status,
      stripe_invoice_id = coalesce(
        organization_billing_plan_changes.stripe_invoice_id,
        p_stripe_invoice_id
      ),
      payment_url = coalesce(
        organization_billing_plan_changes.payment_url,
        p_payment_url
      ),
      failure_code = CASE WHEN normalized_status = 'failed'
        THEN normalized_failure_code ELSE NULL END,
      failure_message = CASE WHEN normalized_status = 'failed'
        THEN left(nullif(btrim(p_failure_message), ''), 500) ELSE NULL END,
      completed_at = CASE WHEN normalized_status = 'failed'
        THEN statement_timestamp() ELSE NULL END
  WHERE id = p_change_id
    AND status IN ('prepared', 'pending')
  RETURNING * INTO current_change;

  IF NOT FOUND THEN
    SELECT change.* INTO current_change
    FROM public.organization_billing_plan_changes AS change
    WHERE change.id = p_change_id;
  END IF;
  RETURN jsonb_build_object(
    'changeId', current_change.id,
    'status', current_change.status,
    'updatedAt', current_change.updated_at,
    'stripeInvoiceId', current_change.stripe_invoice_id,
    'paymentUrl', current_change.payment_url
  );
END
$function$;

CREATE FUNCTION public.fail_stale_organization_plan_upgrade_v1(
  p_change_id uuid,
  p_expected_updated_at timestamp with time zone
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  current_change public.organization_billing_plan_changes;
BEGIN
  UPDATE public.organization_billing_plan_changes
  SET status = 'failed',
      failure_code = 'stale_plan_upgrade_reconciled',
      failure_message = 'Stripe no longer reports the pending plan update',
      completed_at = statement_timestamp()
  WHERE id = p_change_id
    AND status IN ('prepared', 'pending')
    AND updated_at = p_expected_updated_at
    AND updated_at <= statement_timestamp() - interval '10 minutes'
  RETURNING * INTO current_change;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'failed', true,
      'status', current_change.status,
      'updatedAt', current_change.updated_at
    );
  END IF;

  SELECT change.* INTO current_change
  FROM public.organization_billing_plan_changes AS change
  WHERE change.id = p_change_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_upgrade_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'failed', false,
    'status', current_change.status,
    'updatedAt', current_change.updated_at
  );
END
$function$;

ALTER FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) RENAME TO apply_organization_seat_snapshot_pre_billing_plans_v1;

CREATE FUNCTION private.apply_organization_seat_snapshot_generation_v1(
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
  billing_account public.organization_billing_accounts;
  plan_change public.organization_billing_plan_changes;
  snapshot jsonb;
  membership_count integer;
  invitation_plan_code text;
  had_subscription_item boolean;
  effective_plan_code text;
  plan_shape_valid boolean;
BEGIN
  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found' USING ERRCODE = 'P0002';
  END IF;
  had_subscription_item := billing_account.stripe_subscription_item_id IS NOT NULL;

  SELECT change.* INTO plan_change
  FROM public.organization_billing_plan_changes AS change
  WHERE change.organization_id = p_organization_id
    AND change.status IN ('prepared', 'pending')
  ORDER BY change.created_at
  LIMIT 1
  FOR UPDATE;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  IF plan_change.id IS NOT NULL
     AND plan_change.status = 'pending'
     AND plan_change.attempts = 1
     AND billing_account.billing_plan_code = 'individual'
     AND billing_account.licensed_seat_count = plan_change.expected_seat_count
     AND billing_account.seat_revision = plan_change.base_seat_revision
     AND billing_account.stripe_subscription_id = plan_change.stripe_subscription_id
     AND p_stripe_subscription_id = plan_change.stripe_subscription_id
     AND p_stripe_subscription_item_id = plan_change.stripe_subscription_item_id
     AND billing_account.stripe_price_id = plan_change.target_stripe_price_id
     AND p_quantity = plan_change.target_seat_count
     AND membership_count BETWEEN 1 AND plan_change.target_seat_count
     AND p_event_created >= billing_account.last_stripe_event_created_at THEN
    UPDATE public.organization_billing_accounts
    SET billing_plan_code = 'team',
        licensed_seat_count = plan_change.target_seat_count,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(last_stripe_event_created_at, p_event_created),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    UPDATE public.organization_billing_plan_changes
    SET status = 'succeeded',
        failure_code = NULL,
        failure_message = NULL,
        completed_at = statement_timestamp()
    WHERE id = plan_change.id;

    RETURN jsonb_build_object(
      'applied', true,
      'stale', false,
      'replayed', false,
      'mismatch', false,
      'subscriptionAccepted', true,
      'organizationId', p_organization_id,
      'licensedSeatCount', billing_account.licensed_seat_count,
      'seatRevision', billing_account.seat_revision,
      'membershipSeatCount', membership_count,
      'completedSeatChangeId', NULL,
      'completedPlanChangeId', plan_change.id,
      'membershipCreated', false
    );
  END IF;

  snapshot := private.apply_organization_seat_snapshot_pre_billing_plans_v1(
    p_organization_id,
    p_stripe_subscription_id,
    p_stripe_subscription_item_id,
    p_quantity,
    p_event_created
  );

  IF coalesce((snapshot ->> 'subscriptionAccepted')::boolean, false)
     AND NOT coalesce((snapshot ->> 'stale')::boolean, true)
     AND NOT coalesce((snapshot ->> 'mismatch')::boolean, true) THEN
    SELECT account.* INTO STRICT billing_account
    FROM public.organization_billing_accounts AS account
    WHERE account.organization_id = p_organization_id
    FOR UPDATE;

    IF billing_account.billing_plan_code IS NULL THEN
      SELECT invitation.billing_plan_code
      INTO invitation_plan_code
      FROM public.organization_onboarding_invitations AS invitation
      WHERE invitation.organization_id = p_organization_id
        AND invitation.organization_kind = 'application'
        AND invitation.status IN ('accepted', 'completed')
      LIMIT 1
      FOR SHARE;

      effective_plan_code := coalesce(invitation_plan_code, 'legacy_per_seat');
      UPDATE public.organization_billing_accounts
      SET billing_plan_code = effective_plan_code
      WHERE organization_id = p_organization_id
      RETURNING * INTO billing_account;
    ELSE
      effective_plan_code := billing_account.billing_plan_code;
    END IF;

    IF NOT had_subscription_item THEN
      SELECT invitation.billing_plan_code
      INTO invitation_plan_code
      FROM public.organization_onboarding_invitations AS invitation
      WHERE invitation.organization_id = p_organization_id
        AND invitation.organization_kind = 'application'
        AND invitation.status IN ('accepted', 'completed')
      LIMIT 1
      FOR SHARE;
    END IF;

    plan_shape_valid := (
      effective_plan_code = 'legacy_per_seat'
      AND p_quantity BETWEEN 1 AND 1000
    ) OR (
      effective_plan_code = 'individual'
      AND p_quantity = 1
    ) OR (
      effective_plan_code = 'team'
      AND p_quantity BETWEEN 3 AND 1000
    );

    IF NOT plan_shape_valid
       OR (
         NOT had_subscription_item
         AND invitation_plan_code IS NOT NULL
         AND invitation_plan_code <> effective_plan_code
       ) THEN
      UPDATE public.organizations
      SET billing_access_state = 'blocked'
      WHERE id = p_organization_id;

      RETURN snapshot || jsonb_build_object(
        'mismatch', true,
        'mismatchReason', 'billing_plan_quantity_mismatch'
      );
    END IF;
  END IF;

  RETURN snapshot;
END
$function$;

ALTER FUNCTION private.apply_organization_seat_snapshot_pre_billing_plans_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) OWNER TO openexpert_owner;
ALTER FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.apply_organization_seat_snapshot_pre_billing_plans_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

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
          AND (
            (billing_account.billing_plan_code = 'individual'
              AND billing_account.licensed_seat_count = 1)
            OR (billing_account.billing_plan_code = 'team'
              AND billing_account.licensed_seat_count BETWEEN 3 AND 1000)
            OR (billing_account.billing_plan_code = 'legacy_per_seat'
              AND billing_account.licensed_seat_count BETWEEN 1 AND 1000)
          )
          AND (
            SELECT count(*)::integer
            FROM public.organization_memberships AS membership
            WHERE membership.organization_id = organization.id
          ) BETWEEN 1 AND billing_account.licensed_seat_count
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

CREATE OR REPLACE FUNCTION public.get_organization_billing_access_v1(
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
  plan_shape_valid boolean;
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
      'graceUntil', NULL,
      'billingPlanCode', NULL
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
      'graceUntil', NULL,
      'billingPlanCode', NULL
    );
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  plan_shape_valid := (
    billing_account.billing_plan_code = 'legacy_per_seat'
    AND billing_account.licensed_seat_count BETWEEN 1 AND 1000
  ) OR (
    billing_account.billing_plan_code = 'individual'
    AND billing_account.licensed_seat_count = 1
  ) OR (
    billing_account.billing_plan_code = 'team'
    AND billing_account.licensed_seat_count BETWEEN 3 AND 1000
  );

  SELECT min(invoice_state.grace_until)
  INTO invoice_failure_grace
  FROM public.organization_billing_invoice_states AS invoice_state
  WHERE invoice_state.organization_id = p_organization_id
    AND invoice_state.stripe_subscription_id = billing_account.stripe_subscription_id
    AND invoice_state.state = 'failed';

  IF organization_record.billing_access_state = 'subscription_required' THEN
    effective_state := 'subscription_required';
  ELSIF organization_record.billing_access_state = 'blocked'
        OR NOT plan_shape_valid
        OR billing_account.stripe_subscription_item_id IS NULL
        OR membership_count < 1
        OR membership_count > billing_account.licensed_seat_count THEN
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
    'graceUntil', effective_grace,
    'billingPlanCode', billing_account.billing_plan_code
  );
END
$function$;

ALTER FUNCTION public.begin_organization_plan_upgrade_v1(
  uuid, uuid, uuid, bigint, text, text, bigint
) OWNER TO openexpert_owner;
ALTER FUNCTION public.claim_organization_plan_upgrade_v1(
  uuid, timestamp with time zone
) OWNER TO openexpert_owner;
ALTER FUNCTION public.mark_organization_plan_upgrade_v1(
  uuid, text, text, text, text, text
) OWNER TO openexpert_owner;
ALTER FUNCTION public.fail_stale_organization_plan_upgrade_v1(
  uuid, timestamp with time zone
) OWNER TO openexpert_owner;
ALTER FUNCTION public.get_organization_billing_access_v1(uuid)
  OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.begin_organization_plan_upgrade_v1(
  uuid, uuid, uuid, bigint, text, text, bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.claim_organization_plan_upgrade_v1(
  uuid, timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.mark_organization_plan_upgrade_v1(
  uuid, text, text, text, text, text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.fail_stale_organization_plan_upgrade_v1(
  uuid, timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.get_organization_billing_access_v1(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.begin_organization_plan_upgrade_v1(
  uuid, uuid, uuid, bigint, text, text, bigint
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_organization_plan_upgrade_v1(
  uuid, timestamp with time zone
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.mark_organization_plan_upgrade_v1(
  uuid, text, text, text, text, text
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.fail_stale_organization_plan_upgrade_v1(
  uuid, timestamp with time zone
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_organization_billing_access_v1(uuid)
  TO openexpert_service;

COMMENT ON TABLE public.organization_billing_plan_changes IS
  'One-shot, service-only Individual-to-Team Stripe upgrade saga. The canonical subscription snapshot completes it atomically with paid capacity.';

NOTIFY pgrst, 'reload schema';
