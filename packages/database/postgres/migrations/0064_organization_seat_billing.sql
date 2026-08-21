-- Per-member Stripe Billing for application organizations.
--
-- A membership is created only after Stripe reports the canonical subscription
-- item quantity for the matching, single-flight seat change. Intermediary
-- organizations keep the legacy member-management RPC and do not use seats.

ALTER TABLE public.organization_billing_accounts
  ADD COLUMN stripe_subscription_item_id text,
  ADD COLUMN licensed_seat_count integer DEFAULT 1 NOT NULL,
  ADD COLUMN seat_revision bigint DEFAULT 1 NOT NULL;

-- Before seat billing, every Checkout subscription was created with quantity
-- one. Never infer this value from memberships: historical direct membership
-- writes must not be legitimized as paid seats by the backfill.
ALTER TABLE public.organization_billing_accounts
  ADD CONSTRAINT organization_billing_accounts_subscription_item_id_check CHECK (
    stripe_subscription_item_id IS NULL
    OR stripe_subscription_item_id ~ '^si_[A-Za-z0-9]+$'
  ),
  ADD CONSTRAINT organization_billing_accounts_licensed_seat_count_check CHECK (
    licensed_seat_count BETWEEN 1 AND 1000
  ),
  ADD CONSTRAINT organization_billing_accounts_seat_revision_check CHECK (
    seat_revision >= 1
  ),
  ADD CONSTRAINT organization_billing_accounts_seat_item_subscription_check CHECK (
    stripe_subscription_item_id IS NULL
    OR stripe_subscription_id IS NOT NULL
  );

CREATE UNIQUE INDEX organization_billing_accounts_subscription_item_unique
  ON public.organization_billing_accounts (stripe_subscription_item_id)
  WHERE stripe_subscription_item_id IS NOT NULL;

COMMENT ON COLUMN public.organization_billing_accounts.stripe_subscription_item_id IS
  'Canonical recurring Stripe subscription item whose quantity licenses organization members.';
COMMENT ON COLUMN public.organization_billing_accounts.licensed_seat_count IS
  'Last canonical Stripe item quantity. It is never derived from organization memberships.';
COMMENT ON COLUMN public.organization_billing_accounts.seat_revision IS
  'Monotonic optimistic-concurrency revision for canonical seat item or quantity changes.';

-- Keep Data API access fail-closed even if a later subscription-status sync
-- temporarily mirrors `active` after a seat mismatch. A pending add remains
-- usable because both canonical and membership counts stay at the old value
-- until Stripe has successfully applied the pending update.
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
      )
  )
$function$;

CREATE TABLE public.organization_billing_seat_changes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL
    REFERENCES identity.users(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL
    REFERENCES identity.users(id) ON DELETE RESTRICT,
  target_email_normalized text NOT NULL,
  target_role text NOT NULL,
  status text DEFAULT 'prepared' NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL,
  stripe_idempotency_key text NOT NULL,
  stripe_subscription_id text NOT NULL,
  stripe_subscription_item_id text NOT NULL,
  stripe_invoice_id text,
  payment_url text,
  expected_seat_count integer NOT NULL,
  target_seat_count integer NOT NULL,
  base_seat_revision bigint NOT NULL,
  proration_date timestamp with time zone NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  failure_code text,
  failure_message text,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_billing_seat_changes_email_check CHECK (
    length(target_email_normalized) BETWEEN 3 AND 320
    AND target_email_normalized = lower(btrim(target_email_normalized))
  ),
  CONSTRAINT organization_billing_seat_changes_role_check CHECK (
    target_role = ANY (ARRAY['expert', 'admin'])
  ),
  CONSTRAINT organization_billing_seat_changes_status_check CHECK (
    status = ANY (ARRAY['prepared', 'pending', 'succeeded', 'failed'])
  ),
  CONSTRAINT organization_billing_seat_changes_request_fingerprint_check CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT organization_billing_seat_changes_stripe_idempotency_key_check CHECK (
    stripe_idempotency_key ~ '^openexpert-seat-change-[0-9a-f]{32}$'
  ),
  CONSTRAINT organization_billing_seat_changes_subscription_id_check CHECK (
    stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_seat_changes_subscription_item_id_check CHECK (
    stripe_subscription_item_id ~ '^si_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_seat_changes_invoice_id_check CHECK (
    stripe_invoice_id IS NULL OR stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_seat_changes_payment_url_check CHECK (
    payment_url IS NULL
    OR (
      payment_url ~ '^https://[^[:space:]]+$'
      AND length(payment_url) <= 2000
    )
  ),
  CONSTRAINT organization_billing_seat_changes_payment_reference_pair_check CHECK (
    (stripe_invoice_id IS NULL) = (payment_url IS NULL)
  ),
  CONSTRAINT organization_billing_seat_changes_counts_check CHECK (
    expected_seat_count BETWEEN 1 AND 999
    AND target_seat_count = expected_seat_count + 1
  ),
  CONSTRAINT organization_billing_seat_changes_revision_check CHECK (
    base_seat_revision >= 1
  ),
  CONSTRAINT organization_billing_seat_changes_attempts_check CHECK (
    attempts >= 0
  ),
  CONSTRAINT organization_billing_seat_changes_failure_code_check CHECK (
    failure_code IS NULL
    OR failure_code ~ '^[a-z][a-z0-9_.:-]{0,127}$'
  ),
  CONSTRAINT organization_billing_seat_changes_failure_message_check CHECK (
    failure_message IS NULL OR length(failure_message) <= 2000
  ),
  CONSTRAINT organization_billing_seat_changes_lifecycle_check CHECK (
    (
      status IN ('prepared', 'pending')
      AND completed_at IS NULL
      AND failure_code IS NULL
      AND failure_message IS NULL
    )
    OR (
      status = 'succeeded'
      AND completed_at IS NOT NULL
      AND failure_code IS NULL
      AND failure_message IS NULL
    )
    OR (
      status = 'failed'
      AND completed_at IS NOT NULL
      AND failure_code IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX organization_billing_seat_changes_idempotency_unique
  ON public.organization_billing_seat_changes (organization_id, idempotency_key);
CREATE UNIQUE INDEX organization_billing_seat_changes_stripe_idempotency_unique
  ON public.organization_billing_seat_changes (stripe_idempotency_key);
CREATE UNIQUE INDEX organization_billing_seat_changes_invoice_unique
  ON public.organization_billing_seat_changes (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
CREATE UNIQUE INDEX organization_billing_seat_changes_single_flight_unique
  ON public.organization_billing_seat_changes (organization_id)
  WHERE status IN ('prepared', 'pending');
CREATE UNIQUE INDEX organization_billing_seat_changes_open_target_unique
  ON public.organization_billing_seat_changes (organization_id, target_user_id)
  WHERE status IN ('prepared', 'pending');
CREATE INDEX organization_billing_seat_changes_timeline_idx
  ON public.organization_billing_seat_changes (organization_id, created_at DESC);

CREATE TRIGGER set_organization_billing_seat_changes_updated_at
  BEFORE UPDATE ON public.organization_billing_seat_changes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.organization_billing_seat_changes IS
  'Service-only add-member saga. Open rows reserve exactly one paid Stripe quantity increase; only the current SCA invoice URL is persisted, while payment history stays live in Stripe.';

ALTER TABLE public.organization_billing_seat_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_billing_seat_changes_service_all
  ON public.organization_billing_seat_changes
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.organization_billing_seat_changes
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT ON TABLE public.organization_billing_seat_changes
  TO openexpert_service;

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
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  target_identity identity.users;
  existing_change public.organization_billing_seat_changes;
  inserted_change public.organization_billing_seat_changes;
  normalized_email text := lower(btrim(p_target_email));
  normalized_role text := lower(btrim(p_target_role));
  fingerprint text;
  membership_count integer;
  change_id uuid := gen_random_uuid();
BEGIN
  IF p_organization_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_proration_date IS NULL
     OR p_expected_seat_count IS NULL
     OR p_expected_seat_count < 1
     OR p_expected_seat_count >= 1000
     OR normalized_email IS NULL
     OR length(normalized_email) NOT BETWEEN 3 AND 320
     OR normalized_role IS NULL
     OR normalized_role NOT IN ('expert', 'admin') THEN
    RAISE EXCEPTION 'invalid_organization_seat_change'
      USING ERRCODE = '22023';
  END IF;

  SELECT identity_user.* INTO target_identity
  FROM identity.users AS identity_user
  WHERE lower(identity_user.email) = normalized_email
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verified_target_user_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT target_identity.email_verified THEN
    RAISE EXCEPTION 'target_user_email_not_verified'
      USING ERRCODE = '42501';
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
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS actor_membership
    WHERE actor_membership.organization_id = p_organization_id
      AND actor_membership.user_id = p_actor_user_id
      AND actor_membership.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'organization_admin_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT account.* INTO billing_account
  FROM public.organization_billing_accounts AS account
  WHERE account.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_billing_account_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'organizationId', p_organization_id,
          'actorUserId', p_actor_user_id,
          'targetUserId', target_identity.id,
          'targetEmail', normalized_email,
          'targetRole', normalized_role,
          'expectedSeatCount', p_expected_seat_count,
          'prorationEpochMicros',
            trunc(extract(epoch FROM p_proration_date) * 1000000)::bigint
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT seat_change.* INTO existing_change
  FROM public.organization_billing_seat_changes AS seat_change
  WHERE seat_change.organization_id = p_organization_id
    AND seat_change.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF existing_change.request_fingerprint <> fingerprint THEN
      RAISE EXCEPTION 'organization_seat_change_idempotency_conflict'
        USING ERRCODE = '23505';
    END IF;

    RETURN jsonb_build_object(
      'seatChangeId', existing_change.id,
      'organizationId', existing_change.organization_id,
      'status', existing_change.status,
      'replayed', true,
      'targetUserId', existing_change.target_user_id,
      'targetEmail', existing_change.target_email_normalized,
      'targetRole', existing_change.target_role,
      'currentSeatCount', existing_change.expected_seat_count,
      'targetSeatCount', existing_change.target_seat_count,
      'seatRevision', existing_change.base_seat_revision,
      'stripeSubscriptionId', existing_change.stripe_subscription_id,
      'stripeSubscriptionItemId', existing_change.stripe_subscription_item_id,
      'stripeIdempotencyKey', existing_change.stripe_idempotency_key,
      'stripeInvoiceId', existing_change.stripe_invoice_id,
      'paymentUrl', existing_change.payment_url,
      'prorationDate', existing_change.proration_date,
      'failureCode', existing_change.failure_code
    );
  END IF;

  IF organization_record.billing_access_state <> 'active'
     OR billing_account.stripe_subscription_status NOT IN ('active', 'trialing') THEN
    RAISE EXCEPTION 'active_application_subscription_required'
      USING ERRCODE = '42501';
  END IF;
  IF billing_account.stripe_subscription_id IS NULL
     OR billing_account.stripe_subscription_item_id IS NULL THEN
    RAISE EXCEPTION 'canonical_subscription_item_required'
      USING ERRCODE = '55000';
  END IF;
  IF billing_account.licensed_seat_count <> p_expected_seat_count THEN
    RAISE EXCEPTION 'organization_seat_count_conflict'
      USING ERRCODE = '40001';
  END IF;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  IF membership_count <> p_expected_seat_count THEN
    RAISE EXCEPTION 'organization_membership_seat_mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = target_identity.id
  ) THEN
    RAISE EXCEPTION 'organization_member_already_exists'
      USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.organization_billing_seat_changes AS seat_change
    WHERE seat_change.organization_id = p_organization_id
      AND seat_change.status IN ('prepared', 'pending')
  ) THEN
    RAISE EXCEPTION 'organization_seat_change_in_progress'
      USING ERRCODE = '55P03';
  END IF;

  INSERT INTO public.organization_billing_seat_changes (
    id,
    organization_id,
    actor_user_id,
    target_user_id,
    target_email_normalized,
    target_role,
    status,
    idempotency_key,
    request_fingerprint,
    stripe_idempotency_key,
    stripe_subscription_id,
    stripe_subscription_item_id,
    expected_seat_count,
    target_seat_count,
    base_seat_revision,
    proration_date
  ) VALUES (
    change_id,
    p_organization_id,
    p_actor_user_id,
    target_identity.id,
    normalized_email,
    normalized_role,
    'prepared',
    p_idempotency_key,
    fingerprint,
    'openexpert-seat-change-' || replace(change_id::text, '-', ''),
    billing_account.stripe_subscription_id,
    billing_account.stripe_subscription_item_id,
    p_expected_seat_count,
    p_expected_seat_count + 1,
    billing_account.seat_revision,
    p_proration_date
  )
  RETURNING * INTO inserted_change;

  RETURN jsonb_build_object(
    'seatChangeId', inserted_change.id,
    'organizationId', inserted_change.organization_id,
    'status', inserted_change.status,
    'replayed', false,
    'targetUserId', inserted_change.target_user_id,
    'targetEmail', inserted_change.target_email_normalized,
    'targetRole', inserted_change.target_role,
    'currentSeatCount', inserted_change.expected_seat_count,
    'targetSeatCount', inserted_change.target_seat_count,
    'seatRevision', inserted_change.base_seat_revision,
    'stripeSubscriptionId', inserted_change.stripe_subscription_id,
    'stripeSubscriptionItemId', inserted_change.stripe_subscription_item_id,
    'stripeIdempotencyKey', inserted_change.stripe_idempotency_key,
    'stripeInvoiceId', inserted_change.stripe_invoice_id,
    'paymentUrl', inserted_change.payment_url,
    'prorationDate', inserted_change.proration_date,
    'failureCode', inserted_change.failure_code
  );
END
$function$;

CREATE FUNCTION public.mark_organization_member_seat_change_v1(
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
  IF (normalized_invoice_id IS NULL) <> (normalized_payment_url IS NULL)
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

  IF normalized_invoice_id IS NOT NULL
     AND (
       (
         seat_change.stripe_invoice_id IS NOT NULL
         AND seat_change.stripe_invoice_id <> normalized_invoice_id
       )
       OR (
         seat_change.payment_url IS NOT NULL
         AND seat_change.payment_url <> normalized_payment_url
       )
     ) THEN
    RAISE EXCEPTION 'organization_seat_change_payment_reference_conflict'
      USING ERRCODE = '23514';
  END IF;

  IF seat_change.status = 'succeeded' THEN
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

CREATE FUNCTION public.resolve_organization_member_seat_target_v1(
  p_organization_id uuid,
  p_target_email text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  normalized_email text := lower(btrim(p_target_email));
  target_identity identity.users;
BEGIN
  IF p_organization_id IS NULL
     OR normalized_email IS NULL
     OR length(normalized_email) NOT BETWEEN 3 AND 320 THEN
    RAISE EXCEPTION 'invalid_organization_seat_target'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    WHERE organization.id = p_organization_id
      AND organization.kind = 'application'
  ) THEN
    RAISE EXCEPTION 'application_organization_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT identity_user.* INTO target_identity
  FROM identity.users AS identity_user
  WHERE lower(identity_user.email) = normalized_email
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'verified_target_user_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF NOT target_identity.email_verified THEN
    RAISE EXCEPTION 'target_user_email_not_verified'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'targetUserId', target_identity.id,
    'targetEmail', lower(btrim(target_identity.email)),
    'alreadyMember', EXISTS (
      SELECT 1
      FROM public.organization_memberships AS membership
      WHERE membership.organization_id = p_organization_id
        AND membership.user_id = target_identity.id
    )
  );
END
$function$;

CREATE FUNCTION public.apply_organization_seat_snapshot_v1(
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
  organization_record public.organizations;
  billing_account public.organization_billing_accounts;
  open_change public.organization_billing_seat_changes;
  target_identity identity.users;
  membership_count integer;
  final_membership_count integer;
  completed_change_id uuid;
  membership_created boolean := false;
  mismatch_reason text;
  event_replayed boolean := false;
  previous_licensed_seat_count integer;
BEGIN
  IF p_organization_id IS NULL
     OR p_stripe_subscription_id IS NULL
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_stripe_subscription_item_id IS NULL
     OR p_stripe_subscription_item_id !~ '^si_[A-Za-z0-9]+$'
     OR p_quantity IS NULL
     OR p_quantity < 1
     OR p_quantity > 1000
     OR p_event_created IS NULL
     OR p_event_created < 0 THEN
    RAISE EXCEPTION 'invalid_organization_seat_snapshot'
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
  previous_licensed_seat_count := billing_account.licensed_seat_count;

  SELECT count(*)::integer INTO membership_count
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id;

  IF p_event_created < billing_account.last_stripe_event_created_at THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'mismatch', false,
      'organizationId', p_organization_id,
      'licensedSeatCount', billing_account.licensed_seat_count,
      'seatRevision', billing_account.seat_revision,
      'membershipSeatCount', membership_count,
      'completedSeatChangeId', NULL,
      'membershipCreated', false
    );
  END IF;
  event_replayed := p_event_created = billing_account.last_stripe_event_created_at;

  SELECT seat_change.* INTO open_change
  FROM public.organization_billing_seat_changes AS seat_change
  WHERE seat_change.organization_id = p_organization_id
    AND seat_change.status IN ('prepared', 'pending')
  ORDER BY seat_change.created_at
  LIMIT 1
  FOR UPDATE;

  IF billing_account.stripe_subscription_id IS DISTINCT FROM p_stripe_subscription_id THEN
    mismatch_reason := 'stripe_subscription_mismatch';
  ELSIF EXISTS (
    SELECT 1
    FROM public.organization_billing_accounts AS other_account
    WHERE other_account.stripe_subscription_item_id = p_stripe_subscription_item_id
      AND other_account.organization_id <> p_organization_id
  ) THEN
    mismatch_reason := 'stripe_subscription_item_already_bound';
  ELSIF billing_account.stripe_subscription_item_id IS NULL THEN
    UPDATE public.organization_billing_accounts
    SET stripe_subscription_item_id = p_stripe_subscription_item_id,
        licensed_seat_count = p_quantity,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    IF p_quantity <> membership_count THEN
      mismatch_reason := 'initial_seat_quantity_membership_mismatch';
    END IF;
  ELSIF billing_account.stripe_subscription_item_id <> p_stripe_subscription_item_id THEN
    mismatch_reason := 'stripe_subscription_item_mismatch';
  ELSIF p_quantity = billing_account.licensed_seat_count THEN
    UPDATE public.organization_billing_accounts
    SET last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    IF membership_count <> p_quantity THEN
      mismatch_reason := 'canonical_quantity_membership_mismatch';
    END IF;
  ELSIF p_quantity > billing_account.licensed_seat_count
        AND open_change.id IS NOT NULL
        AND open_change.stripe_subscription_id = p_stripe_subscription_id
        AND open_change.stripe_subscription_item_id = p_stripe_subscription_item_id
        AND open_change.expected_seat_count = billing_account.licensed_seat_count
        AND open_change.expected_seat_count = membership_count
        AND open_change.target_seat_count = p_quantity
        AND open_change.base_seat_revision = billing_account.seat_revision
        AND NOT EXISTS (
          SELECT 1
          FROM public.organization_memberships AS target_membership
          WHERE target_membership.organization_id = p_organization_id
            AND target_membership.user_id = open_change.target_user_id
        ) THEN
    UPDATE public.organization_billing_accounts
    SET licensed_seat_count = p_quantity,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    SELECT identity_user.* INTO STRICT target_identity
    FROM identity.users AS identity_user
    WHERE identity_user.id = open_change.target_user_id;

    INSERT INTO public.users (
      id,
      organization_id,
      email,
      role,
      full_name,
      avatar_url
    ) VALUES (
      target_identity.id,
      p_organization_id,
      lower(btrim(target_identity.email)),
      open_change.target_role,
      nullif(btrim(target_identity.name), ''),
      NULL
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, display_name)
    VALUES (target_identity.id, nullif(btrim(target_identity.name), ''))
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role
    ) VALUES (
      p_organization_id,
      open_change.target_user_id,
      open_change.target_role
    );
    membership_created := true;

    SELECT count(*)::integer INTO final_membership_count
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id;

    IF final_membership_count = open_change.target_seat_count THEN
      UPDATE public.organization_billing_seat_changes
      SET status = 'succeeded',
          failure_code = NULL,
          failure_message = NULL,
          completed_at = statement_timestamp()
      WHERE id = open_change.id
      RETURNING id INTO completed_change_id;

      RETURN jsonb_build_object(
        'applied', true,
        'stale', false,
        'replayed', false,
        'mismatch', false,
        'organizationId', p_organization_id,
        'licensedSeatCount', billing_account.licensed_seat_count,
        'seatRevision', billing_account.seat_revision,
        'membershipSeatCount', final_membership_count,
        'completedSeatChangeId', completed_change_id,
        'membershipCreated', membership_created
      );
    END IF;

    membership_count := final_membership_count;
    mismatch_reason := 'membership_finalize_count_mismatch';
  ELSE
    UPDATE public.organization_billing_accounts
    SET licensed_seat_count = p_quantity,
        seat_revision = seat_revision + 1,
        last_stripe_event_created_at = greatest(
          last_stripe_event_created_at,
          p_event_created
        ),
        last_synced_at = statement_timestamp()
    WHERE organization_id = p_organization_id
    RETURNING * INTO billing_account;

    mismatch_reason := CASE
      WHEN p_quantity < previous_licensed_seat_count
        THEN 'seat_decrease_unsupported'
      ELSE 'seat_increase_without_matching_change'
    END;
  END IF;

  IF mismatch_reason IS NOT NULL THEN
    UPDATE public.organizations
    SET billing_access_state = 'blocked'
    WHERE id = p_organization_id;

    IF open_change.id IS NOT NULL THEN
      UPDATE public.organization_billing_seat_changes
      SET status = 'failed',
          failure_code = 'canonical_seat_mismatch',
          failure_message = left(mismatch_reason, 2000),
          completed_at = statement_timestamp()
      WHERE id = open_change.id
        AND status IN ('prepared', 'pending');
    END IF;

    RETURN jsonb_build_object(
      'applied', true,
      'stale', false,
      'replayed', event_replayed,
      'mismatch', true,
      'mismatchReason', mismatch_reason,
      'organizationId', p_organization_id,
      'licensedSeatCount', billing_account.licensed_seat_count,
      'seatRevision', billing_account.seat_revision,
      'membershipSeatCount', membership_count,
      'completedSeatChangeId', NULL,
      'membershipCreated', membership_created
    );
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'stale', false,
    'replayed', event_replayed,
    'mismatch', false,
    'organizationId', p_organization_id,
    'licensedSeatCount', billing_account.licensed_seat_count,
    'seatRevision', billing_account.seat_revision,
    'membershipSeatCount', membership_count,
    'completedSeatChangeId', NULL,
    'membershipCreated', false
  );
END
$function$;

ALTER FUNCTION public.begin_organization_member_seat_change_v1(
  uuid,
  uuid,
  text,
  text,
  uuid,
  integer,
  timestamp with time zone
) OWNER TO openexpert_owner;
ALTER FUNCTION public.mark_organization_member_seat_change_v1(
  uuid,
  text,
  text,
  text,
  text,
  text
) OWNER TO openexpert_owner;
ALTER FUNCTION public.resolve_organization_member_seat_target_v1(uuid, text)
  OWNER TO openexpert_owner;
ALTER FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
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
REVOKE ALL ON FUNCTION public.mark_organization_member_seat_change_v1(
  uuid,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.resolve_organization_member_seat_target_v1(uuid, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
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
GRANT EXECUTE ON FUNCTION public.mark_organization_member_seat_change_v1(
  uuid,
  text,
  text,
  text,
  text,
  text
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.resolve_organization_member_seat_target_v1(uuid, text)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.apply_organization_seat_snapshot_v1(
  uuid,
  text,
  text,
  integer,
  bigint
) TO openexpert_service;

-- Authenticated Data API calls must not bypass the seat saga. The trusted
-- service still owns webhook/RPC writes. Intermediary organizations retain the
-- legacy add-member behavior through the guarded public function below.
REVOKE INSERT, DELETE ON TABLE public.organization_memberships
  FROM authenticated;
REVOKE ALL ON FUNCTION private.add_organization_member_by_email(uuid, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE OR REPLACE FUNCTION public.add_organization_member_by_email(
  organization_id uuid,
  email text,
  role text DEFAULT 'expert'
) RETURNS SETOF public.organization_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = off
AS $function$
DECLARE
  organization_kind text;
  target_organization_id uuid := organization_id;
  target_email text := email;
  target_role text := role;
BEGIN
  SELECT organization.kind INTO organization_kind
  FROM public.organizations AS organization
  WHERE organization.id = target_organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF organization_kind = 'application' THEN
    RAISE EXCEPTION 'application_seat_change_required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT inserted_membership.*
  FROM private.add_organization_member_by_email(
    target_organization_id,
    target_email,
    target_role
  ) AS inserted_membership;
END
$function$;

ALTER FUNCTION public.add_organization_member_by_email(uuid, text, text)
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION public.add_organization_member_by_email(uuid, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.add_organization_member_by_email(uuid, text, text)
  TO authenticated;
