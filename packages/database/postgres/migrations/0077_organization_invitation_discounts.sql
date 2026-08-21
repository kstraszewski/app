-- Optional, invite-bound Stripe discounts for application organizations.
--
-- The commercial definition is written by a super admin together with the
-- invitation and is immutable afterwards. Stripe identifiers are a durable,
-- server-only projection of the external provisioning/Checkout saga. Existing
-- invitations have every new column NULL and therefore keep their old flow.

ALTER TABLE public.organization_onboarding_invitations
  ADD COLUMN discount_kind text,
  ADD COLUMN discount_percent_off_bps integer,
  ADD COLUMN discount_amount_off_minor integer,
  ADD COLUMN discount_currency text,
  ADD COLUMN discount_duration text,
  ADD COLUMN discount_duration_months integer,
  ADD COLUMN discount_status text,
  ADD COLUMN discount_stripe_coupon_id text,
  ADD COLUMN discount_stripe_checkout_session_id text,
  ADD COLUMN discount_stripe_subscription_id text,
  ADD COLUMN discount_livemode boolean,
  ADD COLUMN discount_applied_at timestamp with time zone;

ALTER TABLE public.organization_onboarding_invitations
  ADD CONSTRAINT organization_invitation_discount_presence_check CHECK (
    (
      discount_kind IS NULL
      AND discount_percent_off_bps IS NULL
      AND discount_amount_off_minor IS NULL
      AND discount_currency IS NULL
      AND discount_duration IS NULL
      AND discount_duration_months IS NULL
      AND discount_status IS NULL
      AND discount_stripe_coupon_id IS NULL
      AND discount_stripe_checkout_session_id IS NULL
      AND discount_stripe_subscription_id IS NULL
      AND discount_livemode IS NULL
      AND discount_applied_at IS NULL
    )
    OR
    (
      discount_kind IS NOT NULL
      AND discount_status IS NOT NULL
    )
  ),
  ADD CONSTRAINT organization_invitation_discount_definition_check CHECK (
    discount_kind IS NULL
    OR (
      organization_kind = 'application'
      AND (
        (
          discount_kind = 'percentage'
          AND discount_percent_off_bps IS NOT NULL
          AND discount_percent_off_bps BETWEEN 1 AND 10000
          AND discount_amount_off_minor IS NULL
          AND discount_currency IS NULL
        )
        OR
        (
          discount_kind = 'fixed_amount'
          AND discount_percent_off_bps IS NULL
          AND discount_amount_off_minor IS NOT NULL
          AND discount_amount_off_minor BETWEEN 1 AND 100000000
          AND discount_currency IS NOT DISTINCT FROM 'pln'
        )
      )
      AND discount_duration IS NOT NULL
      AND discount_duration IN ('once', 'repeating', 'forever')
      AND (
        (
          discount_duration = 'repeating'
          AND discount_duration_months IS NOT NULL
          AND discount_duration_months BETWEEN 1 AND 36
        )
        OR
        (
          discount_duration IN ('once', 'forever')
          AND discount_duration_months IS NULL
        )
      )
    )
  ),
  ADD CONSTRAINT organization_invitation_discount_status_check CHECK (
    discount_status IS NULL
    OR discount_status IN ('assigned', 'checkout_created', 'applied', 'revoked')
  ),
  ADD CONSTRAINT organization_invitation_discount_coupon_id_check CHECK (
    discount_stripe_coupon_id IS NULL
    OR discount_stripe_coupon_id ~ '^[A-Za-z0-9_-]{1,255}$'
  ),
  ADD CONSTRAINT organization_invitation_discount_checkout_id_check CHECK (
    discount_stripe_checkout_session_id IS NULL
    OR discount_stripe_checkout_session_id ~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
  ),
  ADD CONSTRAINT organization_invitation_discount_subscription_id_check CHECK (
    discount_stripe_subscription_id IS NULL
    OR discount_stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  ADD CONSTRAINT organization_invitation_discount_lifecycle_check CHECK (
    discount_kind IS NULL
    OR (
      discount_status = 'assigned'
      AND discount_stripe_checkout_session_id IS NULL
      AND discount_stripe_subscription_id IS NULL
      AND discount_applied_at IS NULL
      AND (
        (
          discount_stripe_coupon_id IS NULL
          AND discount_livemode IS NULL
        )
        OR
        (
          discount_stripe_coupon_id IS NOT NULL
          AND discount_livemode IS NOT NULL
        )
      )
    )
    OR (
      discount_status = 'checkout_created'
      AND status IN ('accepted', 'completed')
      AND discount_stripe_coupon_id IS NOT NULL
      AND discount_stripe_checkout_session_id IS NOT NULL
      AND discount_stripe_subscription_id IS NULL
      AND discount_livemode IS NOT NULL
      AND discount_applied_at IS NULL
    )
    OR (
      discount_status = 'applied'
      AND status IN ('accepted', 'completed')
      AND discount_stripe_coupon_id IS NOT NULL
      AND discount_stripe_checkout_session_id IS NOT NULL
      AND discount_stripe_subscription_id IS NOT NULL
      AND discount_livemode IS NOT NULL
      AND discount_applied_at IS NOT NULL
    )
    OR (
      discount_status = 'revoked'
      AND status = 'revoked'
      AND discount_stripe_checkout_session_id IS NULL
      AND discount_stripe_subscription_id IS NULL
      AND discount_applied_at IS NULL
      AND (
        (
          discount_stripe_coupon_id IS NULL
          AND discount_livemode IS NULL
        )
        OR
        (
          discount_stripe_coupon_id IS NOT NULL
          AND discount_livemode IS NOT NULL
        )
      )
    )
  );

CREATE UNIQUE INDEX organization_invitation_discount_coupon_unique
  ON public.organization_onboarding_invitations (discount_stripe_coupon_id)
  WHERE discount_stripe_coupon_id IS NOT NULL;

CREATE UNIQUE INDEX organization_invitation_discount_checkout_unique
  ON public.organization_onboarding_invitations (
    discount_stripe_checkout_session_id
  )
  WHERE discount_stripe_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX organization_invitation_discount_subscription_unique
  ON public.organization_onboarding_invitations (
    discount_stripe_subscription_id
  )
  WHERE discount_stripe_subscription_id IS NOT NULL;

CREATE FUNCTION private.enforce_organization_invitation_discount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  requires_checkout_correlation boolean := false;
  requires_applied_correlation boolean := false;
  billing_account public.organization_billing_accounts%ROWTYPE;
BEGIN
  IF tg_op = 'UPDATE' THEN
    IF ROW(
         new.discount_kind,
         new.discount_percent_off_bps,
         new.discount_amount_off_minor,
         new.discount_currency,
         new.discount_duration,
         new.discount_duration_months
       ) IS DISTINCT FROM ROW(
         old.discount_kind,
         old.discount_percent_off_bps,
         old.discount_amount_off_minor,
         old.discount_currency,
         old.discount_duration,
         old.discount_duration_months
       ) THEN
      RAISE EXCEPTION 'organization_invitation_discount_definition_is_immutable'
        USING ERRCODE = '42501';
    END IF;

    -- Revocation is an invitation transition in the existing application code.
    -- Make the still-unused grant follow it in the same row update so the new
    -- lifecycle constraint is compatible with that code and cannot leave an
    -- assigned grant attached to a revoked token.
    IF new.status = 'revoked'
       AND old.status IS DISTINCT FROM 'revoked'
       AND new.discount_status = 'assigned' THEN
      new.discount_status := 'revoked';
    END IF;

    IF old.discount_status IS DISTINCT FROM new.discount_status
       AND NOT (
         old.discount_status = 'assigned'
         AND new.discount_status IN ('checkout_created', 'revoked')
       )
       AND NOT (
         old.discount_status = 'checkout_created'
         AND new.discount_status = 'applied'
       ) THEN
      RAISE EXCEPTION 'invalid_organization_invitation_discount_transition'
        USING ERRCODE = '23514';
    END IF;

    -- Once an external identity is persisted it is a correlation fence. A
    -- Checkout Session may be replaced before application (for example after
    -- expiry), but the deterministic Coupon, Stripe mode and final Subscription
    -- never change for this invitation grant.
    IF old.discount_stripe_coupon_id IS NOT NULL
       AND new.discount_stripe_coupon_id IS DISTINCT FROM
         old.discount_stripe_coupon_id THEN
      RAISE EXCEPTION 'organization_invitation_discount_coupon_is_immutable'
        USING ERRCODE = '42501';
    END IF;
    IF old.discount_livemode IS NOT NULL
       AND new.discount_livemode IS DISTINCT FROM old.discount_livemode THEN
      RAISE EXCEPTION 'organization_invitation_discount_mode_is_immutable'
        USING ERRCODE = '42501';
    END IF;
    IF old.discount_stripe_subscription_id IS NOT NULL
       AND new.discount_stripe_subscription_id IS DISTINCT FROM
         old.discount_stripe_subscription_id THEN
      RAISE EXCEPTION 'organization_invitation_discount_subscription_is_immutable'
        USING ERRCODE = '42501';
    END IF;
    IF old.discount_status = 'applied'
       AND ROW(
         new.discount_stripe_checkout_session_id,
         new.discount_applied_at
       ) IS DISTINCT FROM ROW(
         old.discount_stripe_checkout_session_id,
         old.discount_applied_at
       ) THEN
      RAISE EXCEPTION 'organization_invitation_applied_discount_is_immutable'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF tg_op = 'INSERT' THEN
    requires_checkout_correlation :=
      new.discount_stripe_checkout_session_id IS NOT NULL;
    requires_applied_correlation := new.discount_status = 'applied';
  ELSE
    requires_checkout_correlation :=
      new.discount_stripe_checkout_session_id IS NOT NULL
      AND ROW(
        new.organization_id,
        new.discount_stripe_checkout_session_id,
        new.discount_livemode
      ) IS DISTINCT FROM ROW(
        old.organization_id,
        old.discount_stripe_checkout_session_id,
        old.discount_livemode
      );
    requires_applied_correlation :=
      new.discount_status = 'applied'
      AND ROW(
        new.discount_status,
        new.organization_id,
        new.discount_stripe_checkout_session_id,
        new.discount_stripe_subscription_id,
        new.discount_livemode
      ) IS DISTINCT FROM ROW(
        old.discount_status,
        old.organization_id,
        old.discount_stripe_checkout_session_id,
        old.discount_stripe_subscription_id,
        old.discount_livemode
      );
  END IF;

  IF requires_checkout_correlation OR requires_applied_correlation THEN
    IF new.organization_id IS NULL THEN
      RAISE EXCEPTION 'organization_invitation_discount_organization_required'
        USING ERRCODE = '23514';
    END IF;

    -- Lock in the same organization -> billing-account order used by the
    -- billing snapshot writers. A concurrent Checkout A -> B rebind must
    -- finish before this projection is checked, so a stale binder cannot
    -- commit the identifiers from A after the account has moved to B.
    PERFORM organization.id
    FROM public.organizations AS organization
    WHERE organization.id = new.organization_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'organization_invitation_discount_organization_not_found'
        USING ERRCODE = '23514';
    END IF;

    SELECT account.*
    INTO billing_account
    FROM public.organization_billing_accounts AS account
    WHERE account.organization_id = new.organization_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'organization_invitation_discount_billing_account_required'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF requires_checkout_correlation
     AND (
       billing_account.stripe_checkout_session_id IS DISTINCT FROM
         new.discount_stripe_checkout_session_id
       OR billing_account.livemode IS DISTINCT FROM new.discount_livemode
     ) THEN
    RAISE EXCEPTION 'organization_invitation_discount_checkout_correlation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF requires_applied_correlation
     AND (
       billing_account.stripe_checkout_session_id IS DISTINCT FROM
         new.discount_stripe_checkout_session_id
       OR billing_account.stripe_subscription_id IS DISTINCT FROM
         new.discount_stripe_subscription_id
       OR billing_account.livemode IS DISTINCT FROM new.discount_livemode
     ) THEN
    RAISE EXCEPTION 'organization_invitation_discount_subscription_correlation_mismatch'
      USING ERRCODE = '23514';
  END IF;

  RETURN new;
END
$function$;

ALTER FUNCTION private.enforce_organization_invitation_discount()
  OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION private.enforce_organization_invitation_discount()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER organization_onboarding_invitations_discount_guard
  BEFORE INSERT OR UPDATE ON public.organization_onboarding_invitations
  FOR EACH ROW EXECUTE FUNCTION private.enforce_organization_invitation_discount();

COMMENT ON COLUMN public.organization_onboarding_invitations.discount_kind IS
  'Immutable invite-bound discount kind: percentage or fixed_amount.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_percent_off_bps IS
  'Percentage discount in basis points (1..10000); 10000 means 100 percent.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_amount_off_minor IS
  'Fixed Stripe invoice-subtotal discount in minor currency units; it is not a per-seat amount.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_currency IS
  'Lowercase ISO currency for fixed_amount discounts; invite grants currently support PLN only.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_duration IS
  'Immutable Stripe Coupon duration: once, repeating or forever.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_duration_months IS
  'Number of months for a repeating discount; NULL for once and forever.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_status IS
  'Durable grant state: assigned, checkout_created, applied or revoked. Applied is terminal verified consumption and remains valid after billing is blocked or the exact subscription is canceled.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_stripe_coupon_id IS
  'Deterministic server-created Stripe Coupon ID; never accepted from the invitation recipient.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_stripe_checkout_session_id IS
  'Latest Stripe Checkout Session carrying this invitation discount.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_stripe_subscription_id IS
  'Stripe Subscription on which the invitation discount was verified as applied; persistence requires exact current billing-account correlation.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_livemode IS
  'Stripe mode of the persisted Coupon and Checkout correlation.';
COMMENT ON COLUMN public.organization_onboarding_invitations.discount_applied_at IS
  'Time at which a verified Stripe subscription first applied this grant.';

NOTIFY pgrst, 'reload schema';
