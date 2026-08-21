-- Apply the Stripe subscription generation and its canonical seat snapshot in
-- one database transaction. No caller may observe a subscription-derived
-- active state before the seat invariant has either succeeded or blocked it.

-- The legacy billing writer attempts to complete an accepted application
-- invitation whenever Stripe reports active/trialing. Invoice-anomaly triggers
-- can narrow that candidate state to grace/blocked first. In that one update
-- transition, skip the historical completion instead of aborting the whole
-- billing snapshot; invalid inserts and every other invalid transition keep
-- the original fail-closed exception.
CREATE OR REPLACE FUNCTION private.validate_onboarding_invitation_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  requires_active_entitlement boolean := false;
BEGIN
  IF new.organization_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    WHERE organization.id = new.organization_id
      AND organization.kind = new.organization_kind
  ) THEN
    RAISE EXCEPTION 'invitation_organization_kind_mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF new.status IN ('accepted', 'completed') AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = new.organization_id
      AND membership.user_id = new.accepted_by_user_id
      AND membership.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'invitation_administrator_membership_required'
      USING ERRCODE = '23514';
  END IF;

  IF new.status = 'completed' AND new.organization_kind = 'application' THEN
    IF tg_op = 'INSERT' THEN
      requires_active_entitlement := true;
    ELSIF old.status IS DISTINCT FROM 'completed' THEN
      requires_active_entitlement := true;
    END IF;
  END IF;

  IF requires_active_entitlement AND NOT EXISTS (
       SELECT 1
       FROM public.organizations AS organization
       WHERE organization.id = new.organization_id
         AND organization.billing_access_state = 'active'
     ) THEN
    IF tg_op = 'UPDATE'
       AND old.status = 'accepted'
       AND new.status = 'completed' THEN
      RETURN NULL;
    END IF;

    RAISE EXCEPTION 'active_application_entitlement_required'
      USING ERRCODE = '23514';
  END IF;
  RETURN new;
END
$function$;

ALTER FUNCTION private.validate_onboarding_invitation_organization()
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION private.validate_onboarding_invitation_organization()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

COMMENT ON FUNCTION private.validate_onboarding_invitation_organization() IS
  'Validates invitation organization/admin invariants and skips accepted-to-completed application updates until effective billing access is active.';

-- Invoice webhooks for the same Stripe event second can follow a canonical
-- seat mismatch. Equal timestamps must preserve that fail-closed block just
-- like older invoice events; a later/equal combined canonical snapshot is the
-- operation that is allowed to revalidate and reopen access.
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
  account_last_event_created bigint;
  preserve_newer_block boolean := false;
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
    AND p_event_created <= account_last_event_created;

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
  'Updates a per-invoice anomaly monotonically without reopening access blocked by an equal-or-newer canonical billing/seat snapshot.';

ALTER FUNCTION public.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) SET SCHEMA private;

ALTER FUNCTION private.apply_organization_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) RENAME TO apply_organization_billing_snapshot_effective_v1;

REVOKE ALL ON FUNCTION private.apply_organization_billing_snapshot_effective_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

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
) RENAME TO apply_organization_seat_snapshot_generation_v1;

REVOKE ALL ON FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.apply_organization_billing_and_seat_snapshot_v1(
  p_organization_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_checkout_session_id text,
  p_stripe_price_id text,
  p_subscription_status text,
  p_livemode boolean,
  p_current_period_start timestamp with time zone,
  p_current_period_end timestamp with time zone,
  p_cancel_at_period_end boolean,
  p_grace_until timestamp with time zone,
  p_event_created bigint,
  p_stripe_subscription_item_id text,
  p_quantity integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  accepted_invitation_id uuid;
  accepted_invitation_revision bigint;
  billing_snapshot jsonb;
  seat_snapshot jsonb;
  seat_event_created bigint;
  final_access_state text;
  final_invitation_completed boolean;
  seat_snapshot_valid boolean;
BEGIN
  -- The compatibility billing function completes this invitation as soon as an
  -- active subscription is mirrored. Lock and remember it so a later seat
  -- mismatch can restore the pre-snapshot onboarding state without racing a
  -- concurrent invitation mutation.
  SELECT invitation.id, invitation.revision
  INTO accepted_invitation_id, accepted_invitation_revision
  FROM public.organization_onboarding_invitations AS invitation
  WHERE invitation.organization_id = p_organization_id
    AND invitation.organization_kind = 'application'
    AND invitation.status = 'accepted'
  FOR UPDATE;

  billing_snapshot := private.apply_organization_billing_snapshot_effective_v1(
    p_organization_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_checkout_session_id,
    p_stripe_price_id,
    p_subscription_status,
    p_livemode,
    p_current_period_start,
    p_current_period_end,
    p_cancel_at_period_end,
    p_grace_until,
    p_event_created
  );
  final_invitation_completed := coalesce(
    (billing_snapshot ->> 'invitationCompleted')::boolean,
    false
  );

  IF coalesce((billing_snapshot ->> 'subscriptionAccepted')::boolean, false) = false THEN
    IF accepted_invitation_id IS NOT NULL THEN
      SELECT invitation.status = 'completed'
      INTO STRICT final_invitation_completed
      FROM public.organization_onboarding_invitations AS invitation
      WHERE invitation.id = accepted_invitation_id;
    END IF;

    SELECT organization.billing_access_state INTO STRICT final_access_state
    FROM public.organizations AS organization
    WHERE organization.id = p_organization_id;

    RETURN billing_snapshot || jsonb_build_object(
      'billingAccessState', final_access_state,
      'invitationCompleted', final_invitation_completed,
      'seatSnapshot', NULL
    );
  END IF;

  seat_event_created := CASE
    WHEN coalesce((billing_snapshot ->> 'subscriptionReplaced')::boolean, false)
      THEN nullif(billing_snapshot ->> 'lastStripeEventCreatedAt', '')::bigint
    ELSE p_event_created
  END;

  IF seat_event_created IS NULL OR seat_event_created < p_event_created THEN
    RAISE EXCEPTION 'invalid_billing_snapshot_event_created'
      USING ERRCODE = '22023';
  END IF;

  -- Any exception from the seat function escapes this SECURITY DEFINER call and
  -- rolls the billing snapshot back with it.
  seat_snapshot := private.apply_organization_seat_snapshot_generation_v1(
    p_organization_id,
    p_stripe_subscription_id,
    p_stripe_subscription_item_id,
    p_quantity,
    seat_event_created
  );

  seat_snapshot_valid := coalesce(
    (seat_snapshot ->> 'subscriptionAccepted')::boolean,
    false
  )
    AND NOT coalesce((seat_snapshot ->> 'mismatch')::boolean, true)
    AND NOT coalesce((seat_snapshot ->> 'stale')::boolean, true);

  IF NOT seat_snapshot_valid AND accepted_invitation_id IS NOT NULL THEN
    UPDATE public.organization_onboarding_invitations
    SET status = 'accepted',
        completed_at = NULL,
        revision = accepted_invitation_revision
    WHERE id = accepted_invitation_id
      AND status = 'completed'
      AND revision = accepted_invitation_revision + 1;
  END IF;

  IF accepted_invitation_id IS NOT NULL THEN
    SELECT invitation.status = 'completed'
    INTO STRICT final_invitation_completed
    FROM public.organization_onboarding_invitations AS invitation
    WHERE invitation.id = accepted_invitation_id;
  END IF;

  SELECT organization.billing_access_state INTO STRICT final_access_state
  FROM public.organizations AS organization
  WHERE organization.id = p_organization_id;

  RETURN billing_snapshot || jsonb_build_object(
    'billingAccessState', final_access_state,
    'invitationCompleted', final_invitation_completed,
    'seatSnapshot', seat_snapshot
  );
END
$function$;

ALTER FUNCTION private.apply_organization_billing_snapshot_effective_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint
) OWNER TO openexpert_owner;

ALTER FUNCTION private.apply_organization_seat_snapshot_generation_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) OWNER TO openexpert_owner;

ALTER FUNCTION public.apply_organization_billing_and_seat_snapshot_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint,
  text,
  integer
) OWNER TO openexpert_owner;

REVOKE ALL ON FUNCTION public.apply_organization_billing_and_seat_snapshot_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint,
  text,
  integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.apply_organization_billing_and_seat_snapshot_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint,
  text,
  integer
) TO openexpert_service;

COMMENT ON FUNCTION public.apply_organization_billing_and_seat_snapshot_v1(
  uuid,
  text,
  text,
  text,
  text,
  text,
  boolean,
  timestamp with time zone,
  timestamp with time zone,
  boolean,
  timestamp with time zone,
  bigint,
  text,
  integer
) IS
  'Atomically applies the current Stripe subscription generation and canonical seats, returning the final invoice- and seat-aware access state.';

NOTIFY pgrst, 'reload schema';
