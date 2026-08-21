-- Organization kinds, invitation-only onboarding and Stripe Billing state.
-- Existing tenants stay intermediary organizations and therefore retain access.

ALTER TABLE public.organizations
  ADD COLUMN kind text DEFAULT 'intermediary' NOT NULL,
  ADD COLUMN billing_access_state text DEFAULT 'not_required' NOT NULL;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_kind_check
    CHECK (kind = ANY (ARRAY['intermediary', 'application'])),
  ADD CONSTRAINT organizations_billing_access_state_check
    CHECK (billing_access_state = ANY (
      ARRAY['not_required', 'subscription_required', 'active', 'grace', 'blocked']
    )),
  ADD CONSTRAINT organizations_kind_billing_state_check
    CHECK (
      (kind = 'intermediary' AND billing_access_state = 'not_required')
      OR
      (kind = 'application' AND billing_access_state <> 'not_required')
    );

COMMENT ON COLUMN public.organizations.kind IS
  'Tenant product kind. This is independent from workforce roles and the intermediary legal providerRole.';
COMMENT ON COLUMN public.organizations.billing_access_state IS
  'Coarse server-side entitlement mirror. Stripe identifiers and raw subscription state live in organization_billing_accounts.';

-- Product kind is a durable tenant identity, not an editable organization
-- setting. A future conversion must be an explicit, audited migration.
CREATE FUNCTION private.prevent_organization_kind_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF new.kind IS DISTINCT FROM old.kind THEN
    RAISE EXCEPTION 'organization_kind_is_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.prevent_organization_kind_change()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER organizations_prevent_kind_change
  BEFORE UPDATE OF kind ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION private.prevent_organization_kind_change();

CREATE TABLE public.organization_onboarding_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  email_normalized text NOT NULL,
  organization_name text NOT NULL,
  organization_kind text NOT NULL,
  administrator_name text,
  status text DEFAULT 'pending' NOT NULL,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT,
  invited_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  accepted_by_user_id uuid REFERENCES identity.users(id) ON DELETE RESTRICT,
  expires_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  accepted_at timestamp with time zone,
  completed_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revision bigint DEFAULT 1 NOT NULL,
  delivery_attempts integer DEFAULT 0 NOT NULL,
  last_delivery_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_onboarding_invitations_token_hash_check CHECK (
    token_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT organization_onboarding_invitations_email_check CHECK (
    length(email_normalized) BETWEEN 3 AND 320
    AND email_normalized = lower(btrim(email_normalized))
  ),
  CONSTRAINT organization_onboarding_invitations_name_check CHECK (
    organization_name = btrim(organization_name)
    AND length(organization_name) BETWEEN 1 AND 160
  ),
  CONSTRAINT organization_onboarding_invitations_kind_check CHECK (
    organization_kind = ANY (ARRAY['intermediary', 'application'])
  ),
  CONSTRAINT organization_onboarding_invitations_administrator_name_check CHECK (
    administrator_name IS NULL
    OR (
      administrator_name = btrim(administrator_name)
      AND length(administrator_name) BETWEEN 1 AND 200
    )
  ),
  CONSTRAINT organization_onboarding_invitations_status_check CHECK (
    status = ANY (ARRAY['pending', 'accepted', 'completed', 'expired', 'revoked'])
  ),
  CONSTRAINT organization_onboarding_invitations_lifecycle_check CHECK (
    (
      status = 'pending'
      AND organization_id IS NULL
      AND accepted_by_user_id IS NULL
      AND accepted_at IS NULL
      AND completed_at IS NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'accepted'
      AND organization_kind = 'application'
      AND organization_id IS NOT NULL
      AND accepted_by_user_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND completed_at IS NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'completed'
      AND organization_id IS NOT NULL
      AND accepted_by_user_id IS NOT NULL
      AND accepted_at IS NOT NULL
      AND completed_at IS NOT NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'expired'
      AND organization_id IS NULL
      AND accepted_by_user_id IS NULL
      AND accepted_at IS NULL
      AND completed_at IS NULL
      AND revoked_at IS NULL
    )
    OR (
      status = 'revoked'
      AND organization_id IS NULL
      AND accepted_by_user_id IS NULL
      AND accepted_at IS NULL
      AND completed_at IS NULL
      AND revoked_at IS NOT NULL
    )
  ),
  CONSTRAINT organization_onboarding_invitations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT organization_onboarding_invitations_revision_check CHECK (revision >= 1),
  CONSTRAINT organization_onboarding_invitations_delivery_attempts_check CHECK (delivery_attempts >= 0),
  CONSTRAINT organization_onboarding_invitations_last_delivery_error_check CHECK (
    last_delivery_error IS NULL OR length(last_delivery_error) <= 2000
  )
);

CREATE INDEX organization_onboarding_invitations_email_status_idx
  ON public.organization_onboarding_invitations (email_normalized, status, expires_at DESC);
CREATE INDEX organization_onboarding_invitations_status_created_idx
  ON public.organization_onboarding_invitations (status, created_at DESC);
CREATE UNIQUE INDEX organization_onboarding_invitations_organization_unique
  ON public.organization_onboarding_invitations (organization_id)
  WHERE organization_id IS NOT NULL;

CREATE TRIGGER set_organization_onboarding_invitations_updated_at
  BEFORE UPDATE ON public.organization_onboarding_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION private.validate_onboarding_invitation_organization()
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

  -- Application invitations become completed only after the billing snapshot
  -- has granted entitlement. Once completed, later billing suspension does not
  -- rewrite this historical onboarding state.
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
    RAISE EXCEPTION 'active_application_entitlement_required'
      USING ERRCODE = '23514';
  END IF;
  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.validate_onboarding_invitation_organization()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER organization_onboarding_invitations_validate_organization
  BEFORE INSERT OR UPDATE ON public.organization_onboarding_invitations
  FOR EACH ROW EXECUTE FUNCTION private.validate_onboarding_invitation_organization();

COMMENT ON TABLE public.organization_onboarding_invitations IS
  'Invitation-only organization onboarding. Only a SHA-256 digest is persisted; acceptance rechecks Better Auth identity email.';

CREATE TABLE public.organization_billing_accounts (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  stripe_checkout_session_id text UNIQUE,
  stripe_price_id text,
  stripe_subscription_status text,
  livemode boolean DEFAULT false NOT NULL,
  current_period_start timestamp with time zone,
  current_period_end timestamp with time zone,
  cancel_at_period_end boolean DEFAULT false NOT NULL,
  grace_until timestamp with time zone,
  last_stripe_event_created_at bigint DEFAULT 0 NOT NULL,
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT organization_billing_accounts_customer_id_check CHECK (
    stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_accounts_subscription_id_check CHECK (
    stripe_subscription_id IS NULL OR stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_accounts_checkout_id_check CHECK (
    stripe_checkout_session_id IS NULL OR stripe_checkout_session_id ~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_accounts_price_id_check CHECK (
    stripe_price_id IS NULL OR stripe_price_id ~ '^price_[A-Za-z0-9]+$'
  ),
  CONSTRAINT organization_billing_accounts_status_length_check CHECK (
    stripe_subscription_status IS NULL
    OR (
      stripe_subscription_status = lower(btrim(stripe_subscription_status))
      AND stripe_subscription_status ~ '^[a-z][a-z0-9_]{0,79}$'
    )
  ),
  CONSTRAINT organization_billing_accounts_period_check CHECK (
    (current_period_start IS NULL) = (current_period_end IS NULL)
    AND (
      current_period_start IS NULL
      OR current_period_end > current_period_start
    )
  ),
  CONSTRAINT organization_billing_accounts_subscription_snapshot_check CHECK (
    (
      stripe_subscription_status IS NULL
      AND stripe_subscription_id IS NULL
      AND current_period_start IS NULL
      AND current_period_end IS NULL
      AND grace_until IS NULL
    )
    OR (
      stripe_subscription_status IS NOT NULL
      AND stripe_customer_id IS NOT NULL
      AND stripe_subscription_id IS NOT NULL
      AND stripe_price_id IS NOT NULL
      AND current_period_start IS NOT NULL
      AND current_period_end IS NOT NULL
      AND last_synced_at IS NOT NULL
      AND (
        grace_until IS NULL
        OR stripe_subscription_status = 'past_due'
      )
    )
  ),
  CONSTRAINT organization_billing_accounts_event_created_check CHECK (
    last_stripe_event_created_at >= 0
  )
);

CREATE TRIGGER set_organization_billing_accounts_updated_at
  BEFORE UPDATE ON public.organization_billing_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION private.validate_application_billing_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organizations AS organization
    WHERE organization.id = new.organization_id
      AND organization.kind = 'application'
  ) THEN
    RAISE EXCEPTION 'application_organization_required' USING ERRCODE = '23514';
  END IF;
  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.validate_application_billing_account()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER organization_billing_accounts_validate_application
  BEFORE INSERT OR UPDATE ON public.organization_billing_accounts
  FOR EACH ROW EXECUTE FUNCTION private.validate_application_billing_account();

COMMENT ON TABLE public.organization_billing_accounts IS
  'Server-only Stripe customer and subscription mirror. Organization access is derived into organizations.billing_access_state.';

CREATE TABLE public.stripe_webhook_events (
  stripe_event_id text PRIMARY KEY,
  event_type text NOT NULL,
  stripe_object_id text,
  livemode boolean NOT NULL,
  api_version text,
  event_created_at bigint NOT NULL,
  status text DEFAULT 'processing' NOT NULL,
  attempts integer DEFAULT 1 NOT NULL,
  last_error text,
  received_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT stripe_webhook_events_id_check CHECK (stripe_event_id ~ '^evt_[A-Za-z0-9]+$'),
  CONSTRAINT stripe_webhook_events_type_check CHECK (
    event_type = btrim(event_type)
    AND length(event_type) BETWEEN 1 AND 200
  ),
  CONSTRAINT stripe_webhook_events_object_id_check CHECK (
    stripe_object_id IS NULL
    OR (
      stripe_object_id = btrim(stripe_object_id)
      AND length(stripe_object_id) BETWEEN 1 AND 255
    )
  ),
  CONSTRAINT stripe_webhook_events_api_version_check CHECK (
    api_version IS NULL OR length(api_version) BETWEEN 1 AND 80
  ),
  CONSTRAINT stripe_webhook_events_created_check CHECK (event_created_at >= 0),
  CONSTRAINT stripe_webhook_events_status_check CHECK (
    status = ANY (ARRAY['processing', 'processed', 'failed', 'ignored'])
  ),
  CONSTRAINT stripe_webhook_events_attempts_check CHECK (attempts >= 1),
  CONSTRAINT stripe_webhook_events_error_check CHECK (
    last_error IS NULL OR length(last_error) <= 2000
  ),
  CONSTRAINT stripe_webhook_events_lifecycle_check CHECK (
    (
      status = 'processing'
      AND processed_at IS NULL
      AND last_error IS NULL
    )
    OR (
      status = 'failed'
      AND processed_at IS NULL
      AND last_error IS NOT NULL
    )
    OR (
      status = ANY (ARRAY['processed', 'ignored'])
      AND processed_at IS NOT NULL
      AND last_error IS NULL
    )
  )
);

CREATE INDEX stripe_webhook_events_status_received_idx
  ON public.stripe_webhook_events (status, received_at DESC);

CREATE TRIGGER set_stripe_webhook_events_updated_at
  BEFORE UPDATE ON public.stripe_webhook_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION private.protect_stripe_webhook_event_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF new.stripe_event_id IS DISTINCT FROM old.stripe_event_id
     OR new.event_type IS DISTINCT FROM old.event_type
     OR new.stripe_object_id IS DISTINCT FROM old.stripe_object_id
     OR new.livemode IS DISTINCT FROM old.livemode
     OR new.api_version IS DISTINCT FROM old.api_version
     OR new.event_created_at IS DISTINCT FROM old.event_created_at
     OR new.received_at IS DISTINCT FROM old.received_at THEN
    RAISE EXCEPTION 'stripe_webhook_event_identity_is_immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.protect_stripe_webhook_event_identity()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER stripe_webhook_events_protect_identity
  BEFORE UPDATE ON public.stripe_webhook_events
  FOR EACH ROW EXECUTE FUNCTION private.protect_stripe_webhook_event_identity();

COMMENT ON TABLE public.stripe_webhook_events IS
  'Minimal Stripe event ledger used for signature-verified idempotency. Payloads are deliberately not persisted.';

CREATE OR REPLACE FUNCTION private.create_organization_for_identity(
  p_actor_user_id uuid,
  p_organization_name text,
  p_requested_full_name text,
  p_organization_kind text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  auth_user identity.users;
  new_organization_id uuid := gen_random_uuid();
  normalized_name text := nullif(btrim(p_organization_name), '');
  normalized_full_name text := nullif(btrim(p_requested_full_name), '');
  normalized_kind text := lower(nullif(btrim(p_organization_kind), ''));
  new_slug text;
  existing_profile public.users;
  is_default boolean := false;
  access_state text;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF normalized_name IS NULL OR length(normalized_name) > 160 THEN
    RAISE EXCEPTION 'invalid_organization_name' USING ERRCODE = '22023';
  END IF;
  IF normalized_full_name IS NOT NULL AND length(normalized_full_name) > 200 THEN
    RAISE EXCEPTION 'invalid_full_name' USING ERRCODE = '22023';
  END IF;
  IF normalized_kind IS NULL OR normalized_kind NOT IN ('intermediary', 'application') THEN
    RAISE EXCEPTION 'invalid_organization_kind' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO auth_user
  FROM identity.users
  WHERE id = p_actor_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth_user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT auth_user.email_verified THEN
    RAISE EXCEPTION 'verified_email_required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(auth_user.email), '') IS NULL THEN
    RAISE EXCEPTION 'workforce_email_required' USING ERRCODE = '22023';
  END IF;

  -- Two different invitations can be accepted concurrently by the same
  -- identity. Serialize the first public.users row creation while still
  -- allowing that identity to become an admin of multiple organizations.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text, 0));

  access_state := CASE
    WHEN normalized_kind = 'application' THEN 'subscription_required'
    ELSE 'not_required'
  END;
  new_slug := private.organization_slug(normalized_name, new_organization_id);

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    new_organization_id,
    normalized_name,
    new_slug,
    normalized_kind,
    access_state
  );

  SELECT * INTO existing_profile
  FROM public.users
  WHERE id = p_actor_user_id
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.users
    SET full_name = coalesce(
      public.users.full_name,
      normalized_full_name,
      nullif(btrim(auth_user.name), '')
    )
    WHERE id = p_actor_user_id;
  ELSE
    is_default := true;
    INSERT INTO public.users (
      id,
      organization_id,
      email,
      role,
      full_name
    ) VALUES (
      p_actor_user_id,
      new_organization_id,
      lower(btrim(auth_user.email)),
      'admin',
      coalesce(normalized_full_name, nullif(btrim(auth_user.name), ''))
    );
  END IF;

  INSERT INTO public.organization_memberships (
    organization_id,
    user_id,
    role
  ) VALUES (new_organization_id, p_actor_user_id, 'admin');

  INSERT INTO public.profiles (id, display_name)
  VALUES (
    p_actor_user_id,
    coalesce(normalized_full_name, nullif(btrim(auth_user.name), ''))
  )
  ON CONFLICT (id) DO UPDATE
  SET display_name = coalesce(public.profiles.display_name, excluded.display_name);

  RETURN jsonb_build_object(
    'id', new_organization_id,
    'name', normalized_name,
    'slug', new_slug,
    'kind', normalized_kind,
    'billingAccessState', access_state,
    'role', 'admin',
    'isDefault', is_default
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.create_organization_with_admin_v2(
  organization_name text,
  full_name text DEFAULT NULL,
  organization_kind text DEFAULT 'intermediary'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  current_user_id uuid := (SELECT app.current_user_id());
  normalized_kind text := lower(nullif(btrim(organization_kind), ''));
BEGIN
  RETURN private.create_organization_for_identity(
    current_user_id,
    organization_name,
    full_name,
    normalized_kind
  );
END
$function$;

-- Keep the legacy RPC compatible for local provisioning and older clients, but
-- route it through the verified, multi-organization implementation. The old
-- private SECURITY DEFINER helper is revoked below so it cannot bypass the
-- verified-email check through the Data API.
CREATE OR REPLACE FUNCTION public.create_organization_with_admin(
  organization_name text,
  full_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $function$
  SELECT public.create_organization_with_admin_v2(
    $1,
    $2,
    'intermediary'
  )
$function$;

CREATE OR REPLACE FUNCTION public.accept_organization_onboarding_invitation(
  p_token_hash text,
  p_actor_user_id uuid,
  p_full_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  invitation public.organization_onboarding_invitations%ROWTYPE;
  auth_user identity.users;
  organization_payload jsonb;
  organization_record public.organizations;
  next_status text;
  is_default boolean;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_invitation_token' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO invitation
  FROM public.organization_onboarding_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO auth_user
  FROM identity.users
  WHERE id = p_actor_user_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'auth_user_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT auth_user.email_verified THEN
    RAISE EXCEPTION 'verified_email_required' USING ERRCODE = '42501';
  END IF;
  IF lower(btrim(auth_user.email)) <> invitation.email_normalized THEN
    RAISE EXCEPTION 'invitation_email_mismatch' USING ERRCODE = '42501';
  END IF;

  IF invitation.status IN ('accepted', 'completed')
     AND invitation.accepted_by_user_id = p_actor_user_id
     AND invitation.organization_id IS NOT NULL THEN
    SELECT * INTO organization_record
    FROM public.organizations
    WHERE id = invitation.organization_id;

    IF NOT FOUND
       OR organization_record.kind IS DISTINCT FROM invitation.organization_kind
       OR NOT EXISTS (
         SELECT 1
         FROM public.organization_memberships AS membership
         WHERE membership.organization_id = invitation.organization_id
           AND membership.user_id = p_actor_user_id
           AND membership.role = 'admin'
       ) THEN
      RAISE EXCEPTION 'invitation_acceptance_state_invalid' USING ERRCODE = '23514';
    END IF;

    SELECT app_user.organization_id = invitation.organization_id
    INTO is_default
    FROM public.users AS app_user
    WHERE app_user.id = p_actor_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'workforce_profile_not_found' USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
      'id', organization_record.id,
      'name', organization_record.name,
      'slug', organization_record.slug,
      'kind', organization_record.kind,
      'billingAccessState', organization_record.billing_access_state,
      'role', 'admin',
      'isDefault', is_default,
      'invitationId', invitation.id
    );
  END IF;

  IF invitation.status <> 'pending' THEN
    RAISE EXCEPTION 'invitation_not_pending' USING ERRCODE = '23514';
  END IF;
  IF invitation.expires_at <= statement_timestamp() THEN
    RAISE EXCEPTION 'invitation_expired' USING ERRCODE = '23514';
  END IF;

  organization_payload := private.create_organization_for_identity(
    p_actor_user_id,
    invitation.organization_name,
    coalesce(nullif(btrim(p_full_name), ''), invitation.administrator_name),
    invitation.organization_kind
  );
  next_status := CASE
    WHEN invitation.organization_kind = 'application' THEN 'accepted'
    ELSE 'completed'
  END;

  UPDATE public.organization_onboarding_invitations
  SET status = next_status,
      organization_id = (organization_payload ->> 'id')::uuid,
      accepted_by_user_id = p_actor_user_id,
      accepted_at = statement_timestamp(),
      completed_at = CASE
        WHEN next_status = 'completed' THEN statement_timestamp()
        ELSE NULL
      END,
      last_delivery_error = NULL,
      revision = revision + 1
  WHERE id = invitation.id;

  RETURN organization_payload || jsonb_build_object('invitationId', invitation.id);
END
$function$;

CREATE OR REPLACE FUNCTION public.apply_organization_billing_snapshot(
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
  p_event_created bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  organization_record public.organizations;
  existing_account public.organization_billing_accounts;
  applied_account public.organization_billing_accounts;
  normalized_status text := lower(nullif(btrim(p_subscription_status), ''));
  next_access_state text;
  effective_grace_until timestamp with time zone;
  completed_invitation_id uuid;
  has_existing_account boolean;
BEGIN
  IF p_organization_id IS NULL
     OR p_event_created IS NULL
     OR p_event_created < 0
     OR p_livemode IS NULL
     OR p_cancel_at_period_end IS NULL THEN
    RAISE EXCEPTION 'invalid_billing_snapshot' USING ERRCODE = '22023';
  END IF;
  IF p_stripe_customer_id IS NULL
     OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
     OR p_stripe_subscription_id IS NULL
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_stripe_price_id IS NULL
     OR p_stripe_price_id !~ '^price_[A-Za-z0-9]+$'
     OR (
       p_stripe_checkout_session_id IS NOT NULL
       AND p_stripe_checkout_session_id !~ '^cs_(test_|live_)?[A-Za-z0-9]+$'
     ) THEN
    RAISE EXCEPTION 'invalid_stripe_billing_identifiers' USING ERRCODE = '22023';
  END IF;
  -- Unknown future Stripe statuses fail closed to `blocked` instead of making
  -- the webhook retry forever solely because Stripe extended its enum.
  IF normalized_status IS NULL
     OR normalized_status !~ '^[a-z][a-z0-9_]{0,79}$' THEN
    RAISE EXCEPTION 'invalid_stripe_subscription_status' USING ERRCODE = '22023';
  END IF;
  IF (p_current_period_start IS NULL) <> (p_current_period_end IS NULL)
     OR (
       p_current_period_start IS NOT NULL
       AND p_current_period_end <= p_current_period_start
     ) THEN
    RAISE EXCEPTION 'invalid_subscription_period' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO organization_record
  FROM public.organizations
  WHERE id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF organization_record.kind <> 'application' THEN
    RAISE EXCEPTION 'application_organization_required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO existing_account
  FROM public.organization_billing_accounts
  WHERE organization_id = p_organization_id
  FOR UPDATE;
  has_existing_account := FOUND;

  IF has_existing_account
     AND existing_account.last_stripe_event_created_at > p_event_created THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'organizationId', p_organization_id,
      'billingAccessState', organization_record.billing_access_state,
      'stripeSubscriptionStatus', existing_account.stripe_subscription_status,
      'lastStripeEventCreatedAt', existing_account.last_stripe_event_created_at
    );
  END IF;
  IF has_existing_account
     AND existing_account.stripe_customer_id IS NOT NULL
     AND existing_account.stripe_customer_id <> p_stripe_customer_id THEN
    RAISE EXCEPTION 'stripe_customer_mismatch' USING ERRCODE = '23514';
  END IF;
  IF has_existing_account
     AND existing_account.stripe_customer_id IS NOT NULL
     AND existing_account.livemode IS DISTINCT FROM p_livemode THEN
    RAISE EXCEPTION 'stripe_livemode_mismatch' USING ERRCODE = '23514';
  END IF;

  effective_grace_until := CASE
    WHEN normalized_status <> 'past_due' THEN NULL
    WHEN has_existing_account
      AND existing_account.stripe_subscription_status = 'past_due'
      THEN existing_account.grace_until
    ELSE p_grace_until
  END;

  next_access_state := CASE
    WHEN normalized_status IN ('active', 'trialing') THEN 'active'
    WHEN normalized_status = 'incomplete' THEN 'subscription_required'
    WHEN normalized_status = 'past_due'
      AND effective_grace_until IS NOT NULL
      AND effective_grace_until > statement_timestamp() THEN 'grace'
    ELSE 'blocked'
  END;

  INSERT INTO public.organization_billing_accounts AS billing_account (
    organization_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_checkout_session_id,
    stripe_price_id,
    stripe_subscription_status,
    livemode,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    grace_until,
    last_stripe_event_created_at,
    last_synced_at
  ) VALUES (
    p_organization_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_checkout_session_id,
    p_stripe_price_id,
    normalized_status,
    p_livemode,
    p_current_period_start,
    p_current_period_end,
    p_cancel_at_period_end,
    effective_grace_until,
    p_event_created,
    statement_timestamp()
  )
  ON CONFLICT (organization_id) DO UPDATE
  SET stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      stripe_checkout_session_id = coalesce(
        excluded.stripe_checkout_session_id,
        billing_account.stripe_checkout_session_id
      ),
      stripe_price_id = excluded.stripe_price_id,
      stripe_subscription_status = excluded.stripe_subscription_status,
      livemode = excluded.livemode,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      grace_until = excluded.grace_until,
      last_stripe_event_created_at = excluded.last_stripe_event_created_at,
      last_synced_at = excluded.last_synced_at
  WHERE billing_account.last_stripe_event_created_at <= excluded.last_stripe_event_created_at
  RETURNING * INTO applied_account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applied', false,
      'stale', true,
      'replayed', true,
      'organizationId', p_organization_id,
      'billingAccessState', organization_record.billing_access_state
    );
  END IF;

  UPDATE public.organizations
  SET billing_access_state = next_access_state
  WHERE id = p_organization_id;

  IF normalized_status IN ('active', 'trialing') THEN
    UPDATE public.organization_onboarding_invitations
    SET status = 'completed',
        completed_at = statement_timestamp(),
        revision = revision + 1
    WHERE organization_id = p_organization_id
      AND organization_kind = 'application'
      AND status = 'accepted'
    RETURNING id INTO completed_invitation_id;
  END IF;

  RETURN jsonb_build_object(
    'applied', true,
    'stale', false,
    'replayed', false,
    'organizationId', p_organization_id,
    'billingAccessState', next_access_state,
    'stripeSubscriptionStatus', normalized_status,
    'lastStripeEventCreatedAt', applied_account.last_stripe_event_created_at,
    'invitationCompleted', completed_invitation_id IS NOT NULL
  );
END
$function$;

REVOKE ALL ON FUNCTION private.create_organization_for_identity(uuid, text, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION private.create_organization_with_admin(text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.create_organization_with_admin_v2(text, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_organization_with_admin_v2(text, text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.create_organization_with_admin(text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_organization_with_admin(text, text)
  TO authenticated;
REVOKE ALL ON FUNCTION public.accept_organization_onboarding_invitation(text, uuid, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.accept_organization_onboarding_invitation(text, uuid, text)
  TO openexpert_service;
REVOKE ALL ON FUNCTION public.apply_organization_billing_snapshot(
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
GRANT EXECUTE ON FUNCTION public.apply_organization_billing_snapshot(
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
) TO openexpert_service;

ALTER TABLE public.organization_onboarding_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_onboarding_invitations_service_all
  ON public.organization_onboarding_invitations
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);
CREATE POLICY organization_billing_accounts_service_all
  ON public.organization_billing_accounts
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);
CREATE POLICY stripe_webhook_events_service_all
  ON public.stripe_webhook_events
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.organization_onboarding_invitations
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.organization_billing_accounts
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.stripe_webhook_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.organization_onboarding_invitations
  TO openexpert_service;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.organization_billing_accounts
  TO openexpert_service;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.stripe_webhook_events
  TO openexpert_service;

COMMENT ON TABLE public.platform_user_roles IS
  'Global platform roles. Super admins manage the organization onboarding flow and shared mortgage catalogs.';
