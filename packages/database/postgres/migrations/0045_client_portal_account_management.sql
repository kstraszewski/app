-- Client portal account closure is an access-lifecycle operation, not an
-- identity or CRM data deletion. Every verified Auth-to-person scope receives
-- a durable lifecycle row and an append-only audit trail. The separately
-- authorized CRM anonymization workflow is the sole exception: it deletes the
-- source link and cascades away this identity-to-person mapping and its audit.

CREATE TABLE public.client_portal_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  auth_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  client_person_id uuid NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  activated_at timestamp with time zone DEFAULT now() NOT NULL,
  archived_at timestamp with time zone,
  archived_by_auth_user_id uuid,
  archive_idempotency_key uuid,
  archive_reason text,
  archive_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  revision bigint DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT client_portal_accounts_scope_key UNIQUE (
    auth_user_id,
    organization_id,
    client_person_id
  ),
  CONSTRAINT client_portal_accounts_identity_key UNIQUE (
    id,
    auth_user_id,
    organization_id,
    client_id,
    client_person_id
  ),
  CONSTRAINT client_portal_accounts_status_check CHECK (
    status = ANY (ARRAY['active'::text, 'archived'::text])
  ),
  CONSTRAINT client_portal_accounts_revision_check CHECK (revision >= 1),
  CONSTRAINT client_portal_accounts_archive_reason_check CHECK (
    archive_reason IS NULL
    OR (
      btrim(archive_reason) <> ''::text
      AND char_length(archive_reason) <= 1000
    )
  ),
  CONSTRAINT client_portal_accounts_archive_metadata_check CHECK (
    jsonb_typeof(archive_metadata) = 'object'::text
  ),
  CONSTRAINT client_portal_accounts_lifecycle_check CHECK (
    (
      status = 'active'::text
      AND archived_at IS NULL
      AND archived_by_auth_user_id IS NULL
      AND archive_idempotency_key IS NULL
      AND archive_reason IS NULL
      AND archive_metadata = '{}'::jsonb
    )
    OR (
      status = 'archived'::text
      AND archived_at IS NOT NULL
      AND archived_by_auth_user_id = auth_user_id
      AND archive_idempotency_key IS NOT NULL
      AND archive_reason IS NOT NULL
    )
  ),
  CONSTRAINT client_portal_accounts_auth_user_fkey FOREIGN KEY (auth_user_id)
    REFERENCES public.profiles(id),
  CONSTRAINT client_portal_accounts_archived_by_fkey FOREIGN KEY (
    archived_by_auth_user_id
  ) REFERENCES public.profiles(id),
  CONSTRAINT client_portal_accounts_link_fkey FOREIGN KEY (
    auth_user_id,
    organization_id,
    client_person_id
  ) REFERENCES public.client_account_links (
    auth_user_id,
    organization_id,
    client_person_id
  ) ON DELETE CASCADE,
  CONSTRAINT client_portal_accounts_person_fkey FOREIGN KEY (
    organization_id,
    client_id,
    client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    client_id,
    id
  )
);

COMMENT ON TABLE public.client_portal_accounts IS
  'Durable lifecycle for one Better Auth identity and one organization-scoped CRM person. Self-service archival never hard-deletes it; trusted CRM anonymization removes it with the source link so no Auth-to-person mapping survives.';
COMMENT ON COLUMN public.client_portal_accounts.archive_metadata IS
  'Technical summary for this exact organization/person scope only. It must not contain cross-tenant totals, identifiers, or CRM personal data.';

CREATE INDEX client_portal_accounts_organization_status_idx
  ON public.client_portal_accounts (
    organization_id,
    status,
    updated_at DESC,
    id
  );

CREATE INDEX client_portal_accounts_auth_status_idx
  ON public.client_portal_accounts (
    auth_user_id,
    status,
    updated_at DESC,
    id
  );

CREATE TRIGGER set_client_portal_accounts_updated_at
  BEFORE UPDATE ON public.client_portal_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.client_portal_account_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL,
  auth_user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  client_person_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_auth_user_id uuid NOT NULL,
  idempotency_key uuid,
  reason text,
  account_revision bigint NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT client_portal_account_events_event_type_check CHECK (
    event_type = ANY (ARRAY['activated'::text, 'archived'::text])
  ),
  CONSTRAINT client_portal_account_events_status_check CHECK (
    (from_status IS NULL OR from_status = ANY (
      ARRAY['active'::text, 'archived'::text]
    ))
    AND to_status = ANY (ARRAY['active'::text, 'archived'::text])
  ),
  CONSTRAINT client_portal_account_events_transition_check CHECK (
    (
      event_type = 'activated'::text
      AND (from_status IS NULL OR from_status = 'active'::text)
      AND to_status = 'active'::text
      AND idempotency_key IS NULL
      AND reason IS NULL
    )
    OR (
      event_type = 'archived'::text
      AND from_status = 'active'::text
      AND to_status = 'archived'::text
      AND idempotency_key IS NOT NULL
      AND reason IS NOT NULL
    )
  ),
  CONSTRAINT client_portal_account_events_actor_check CHECK (
    actor_auth_user_id = auth_user_id
  ),
  CONSTRAINT client_portal_account_events_revision_check CHECK (
    account_revision >= 1
  ),
  CONSTRAINT client_portal_account_events_reason_check CHECK (
    reason IS NULL
    OR (
      btrim(reason) <> ''::text
      AND char_length(reason) <= 1000
    )
  ),
  CONSTRAINT client_portal_account_events_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object'::text
  ),
  CONSTRAINT client_portal_account_events_account_fkey FOREIGN KEY (
    account_id,
    auth_user_id,
    organization_id,
    client_id,
    client_person_id
  ) REFERENCES public.client_portal_accounts (
    id,
    auth_user_id,
    organization_id,
    client_id,
    client_person_id
  ) ON DELETE CASCADE,
  CONSTRAINT client_portal_account_events_actor_fkey FOREIGN KEY (
    actor_auth_user_id
  ) REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.client_portal_account_events IS
  'Append-only while its lifecycle exists. Trusted CRM anonymization cascades it with the Auth-to-person lifecycle mapping.';

CREATE INDEX client_portal_account_events_account_idx
  ON public.client_portal_account_events (
    account_id,
    occurred_at DESC,
    id DESC
  );

CREATE INDEX client_portal_account_events_organization_idx
  ON public.client_portal_account_events (
    organization_id,
    occurred_at DESC,
    id DESC
  );

CREATE UNIQUE INDEX client_portal_account_events_archive_idempotency_idx
  ON public.client_portal_account_events (
    actor_auth_user_id,
    idempotency_key,
    account_id
  )
  WHERE event_type = 'archived'::text;

CREATE FUNCTION private.protect_client_portal_account()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF tg_op = 'DELETE' THEN
    -- Direct writes are owner-only. The legal CRM anonymization function is
    -- the only repository path that deletes client_account_links, whose FK
    -- cascade must be allowed to erase this identity-to-person mapping.
    RETURN old;
  END IF;

  IF old.id IS DISTINCT FROM new.id
    OR old.auth_user_id IS DISTINCT FROM new.auth_user_id
    OR old.organization_id IS DISTINCT FROM new.organization_id
    OR old.client_id IS DISTINCT FROM new.client_id
    OR old.client_person_id IS DISTINCT FROM new.client_person_id
    OR old.created_at IS DISTINCT FROM new.created_at
  THEN
    RAISE EXCEPTION 'client_portal_account_identity_is_immutable'
      USING errcode = '55000';
  END IF;

  IF old.status = 'archived'::text THEN
    RAISE EXCEPTION 'client_portal_account_is_archived'
      USING errcode = '55000';
  END IF;

  IF new.revision <> old.revision + 1 THEN
    RAISE EXCEPTION 'client_portal_account_revision_must_advance'
      USING errcode = '55000';
  END IF;

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.protect_client_portal_account()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER protect_client_portal_account
  BEFORE UPDATE OR DELETE ON public.client_portal_accounts
  FOR EACH ROW EXECUTE FUNCTION private.protect_client_portal_account();

CREATE FUNCTION private.protect_client_portal_account_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF tg_op = 'DELETE' THEN
    -- Allow only the owner-side cascade from the lifecycle row. Public roles
    -- have SELECT-only ACLs on both lifecycle tables.
    RETURN old;
  END IF;

  RAISE EXCEPTION 'client_portal_account_events_are_append_only'
    USING errcode = '55000';
END
$function$;

REVOKE ALL ON FUNCTION private.protect_client_portal_account_event()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER protect_client_portal_account_event
  BEFORE UPDATE OR DELETE ON public.client_portal_account_events
  FOR EACH ROW EXECUTE FUNCTION private.protect_client_portal_account_event();

-- Every currently usable link starts as an active lifecycle scope. Historical
-- revoked links are intentionally not revived by this backfill. Block link
-- writes through the backfill and later trigger installation so no activation
-- can commit in the otherwise unobserved interval between those statements.
LOCK TABLE public.client_account_links IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO public.client_portal_accounts (
  auth_user_id,
  organization_id,
  client_id,
  client_person_id,
  status,
  activated_at,
  revision,
  created_at,
  updated_at
)
SELECT
  account_link.auth_user_id,
  account_link.organization_id,
  account_link.client_id,
  account_link.client_person_id,
  'active'::text,
  account_link.verified_at,
  1,
  account_link.created_at,
  greatest(account_link.created_at, account_link.verified_at)
FROM public.client_account_links AS account_link
WHERE account_link.revoked_at IS NULL
ON CONFLICT (auth_user_id, organization_id, client_person_id) DO NOTHING;

INSERT INTO public.client_portal_account_events (
  account_id,
  auth_user_id,
  organization_id,
  client_id,
  client_person_id,
  event_type,
  from_status,
  to_status,
  actor_auth_user_id,
  account_revision,
  metadata,
  occurred_at,
  created_at
)
SELECT
  portal_account.id,
  portal_account.auth_user_id,
  portal_account.organization_id,
  portal_account.client_id,
  portal_account.client_person_id,
  'activated'::text,
  NULL,
  'active'::text,
  portal_account.auth_user_id,
  portal_account.revision,
  jsonb_build_object('source', 'active_link_backfill'),
  portal_account.activated_at,
  portal_account.created_at
FROM public.client_portal_accounts AS portal_account;

-- Link activation is the only path that creates or advances an active scope.
-- Once its lifecycle is archived, a later invitation cannot reactivate it.
CREATE FUNCTION private.sync_client_portal_account_from_link_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  portal_account public.client_portal_accounts%rowtype;
  previous_status text;
  activation_time timestamp with time zone := statement_timestamp();
BEGIN
  IF new.revoked_at IS NOT NULL
    OR (
      tg_op = 'UPDATE'
      AND old.revoked_at IS NULL
      AND new.auth_user_id IS NOT DISTINCT FROM old.auth_user_id
      AND new.organization_id IS NOT DISTINCT FROM old.organization_id
      AND new.client_id IS NOT DISTINCT FROM old.client_id
      AND new.client_person_id IS NOT DISTINCT FROM old.client_person_id
    )
  THEN
    RETURN new;
  END IF;

  -- Account closure applies to the whole client-portal identity, not only to
  -- scopes that existed at closure time. Serialize with archival and reject a
  -- later invitation for any organization/person until an explicit restore
  -- workflow is introduced.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'client_portal_account_archive:'::text || new.auth_user_id::text,
      0
    )
  );

  IF EXISTS (
    SELECT 1
    FROM public.client_portal_accounts AS archived_account
    WHERE archived_account.auth_user_id = new.auth_user_id
      AND archived_account.status = 'archived'::text
  ) THEN
    RAISE EXCEPTION 'client_portal_account_is_archived'
      USING errcode = '55000';
  END IF;

  SELECT account_row.*
  INTO portal_account
  FROM public.client_portal_accounts AS account_row
  WHERE account_row.auth_user_id = new.auth_user_id
    AND account_row.organization_id = new.organization_id
    AND account_row.client_id = new.client_id
    AND account_row.client_person_id = new.client_person_id
  FOR UPDATE;

  IF found AND portal_account.status = 'archived'::text THEN
    RAISE EXCEPTION 'client_portal_account_is_archived'
      USING errcode = '55000';
  END IF;

  IF found THEN
    previous_status := portal_account.status;

    UPDATE public.client_portal_accounts
    SET
      activated_at = activation_time,
      revision = revision + 1,
      updated_at = activation_time
    WHERE id = portal_account.id
    RETURNING * INTO portal_account;
  ELSE
    previous_status := NULL;

    INSERT INTO public.client_portal_accounts (
      auth_user_id,
      organization_id,
      client_id,
      client_person_id,
      status,
      activated_at,
      revision,
      created_at,
      updated_at
    ) VALUES (
      new.auth_user_id,
      new.organization_id,
      new.client_id,
      new.client_person_id,
      'active'::text,
      activation_time,
      1,
      activation_time,
      activation_time
    )
    RETURNING * INTO portal_account;
  END IF;

  INSERT INTO public.client_portal_account_events (
    account_id,
    auth_user_id,
    organization_id,
    client_id,
    client_person_id,
    event_type,
    from_status,
    to_status,
    actor_auth_user_id,
    account_revision,
    metadata,
    occurred_at
  ) VALUES (
    portal_account.id,
    portal_account.auth_user_id,
    portal_account.organization_id,
    portal_account.client_id,
    portal_account.client_person_id,
    'activated'::text,
    previous_status,
    'active'::text,
    portal_account.auth_user_id,
    portal_account.revision,
    jsonb_build_object(
      'source', 'client_account_link_activation',
      'verificationMethod', new.verification_method
    ),
    activation_time
  );

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.sync_client_portal_account_from_link_activation()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER client_account_links_sync_portal_account_activation
  AFTER INSERT OR UPDATE ON public.client_account_links
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_client_portal_account_from_link_activation();

-- Account archival locks every link for the identity before it revokes pending
-- invitations. Preserve that link -> invitation order during invitation claim
-- as well; otherwise claim and archive can each own the row the other needs.
CREATE OR REPLACE FUNCTION public.claim_client_portal_invitation(
  p_invitation_id uuid,
  p_auth_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  invitation_snapshot public.client_portal_invitations%ROWTYPE;
  invitation public.client_portal_invitations%ROWTYPE;
  target_organization_id uuid;
  target_client_id uuid;
  target_client_person_id uuid;
  auth_email text;
  person_email text;
  conflicting_auth_user_id uuid;
BEGIN
  SELECT lower(btrim(auth_user.email))
  INTO auth_email
  FROM identity.users AS auth_user
  WHERE auth_user.id = p_auth_user_id
    AND auth_user.email_verified
  FOR SHARE OF auth_user;

  IF auth_email IS NULL THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- First discover the target without owning its invitation tuple. Besides
  -- this identity's own links, a claim may revoke a previous owner's active
  -- link after staff changed the CRM e-mail. Lock both sets in one stable
  -- order before locking the invitation; archive uses link -> invitation too.
  SELECT candidate.*
  INTO invitation_snapshot
  FROM public.client_portal_invitations AS candidate
  WHERE candidate.id = p_invitation_id;

  IF NOT found THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  target_organization_id := invitation_snapshot.organization_id;
  target_client_id := invitation_snapshot.client_id;
  target_client_person_id := invitation_snapshot.client_person_id;

  SELECT person.email_normalized
  INTO person_email
  FROM public.crm_client_people AS person
  WHERE person.organization_id = target_organization_id
    AND person.client_id = target_client_id
    AND person.id = target_client_person_id;

  -- Reject an invalid snapshot before touching any link. Every value is
  -- checked again after the final invitation lock below, so a concurrent
  -- archive or trusted invitation/person edit rolls the link work back.
  IF person_email IS NULL
    OR auth_email <> invitation_snapshot.email_normalized
    OR auth_email <> person_email
    OR invitation_snapshot.status NOT IN ('pending'::text, 'accepted'::text)
    OR invitation_snapshot.revoked_at IS NOT NULL
    OR (
      invitation_snapshot.status = 'pending'::text
      AND invitation_snapshot.expires_at <= now()
    )
  THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.client_account_links AS account_link
  WHERE account_link.auth_user_id = p_auth_user_id
    OR (
      account_link.organization_id = target_organization_id
      AND account_link.client_person_id = target_client_person_id
    )
  ORDER BY
    account_link.auth_user_id,
    account_link.organization_id,
    account_link.client_person_id
  FOR UPDATE;

  IF invitation_snapshot.status = 'accepted'::text THEN
    -- Accepted replay never mutates a link. Lock the invitation only after the
    -- links, then validate the current durable result exactly as 0008 did.
    SELECT candidate.*
    INTO invitation
    FROM public.client_portal_invitations AS candidate
    WHERE candidate.id = p_invitation_id
    FOR UPDATE;

    SELECT person.email_normalized
    INTO person_email
    FROM public.crm_client_people AS person
    WHERE person.organization_id = invitation.organization_id
      AND person.client_id = invitation.client_id
      AND person.id = invitation.client_person_id;

    IF NOT found
      OR invitation.organization_id IS DISTINCT FROM target_organization_id
      OR invitation.client_id IS DISTINCT FROM target_client_id
      OR invitation.client_person_id IS DISTINCT FROM target_client_person_id
      OR invitation.email_normalized
        IS DISTINCT FROM invitation_snapshot.email_normalized
      OR invitation.status <> 'accepted'::text
      OR invitation.revoked_at IS NOT NULL
      OR person_email IS NULL
      OR auth_email <> invitation.email_normalized
      OR auth_email <> person_email
    THEN
      RAISE EXCEPTION 'client_portal_invitation_not_found'
        USING ERRCODE = 'P0002';
    END IF;

    PERFORM 1
    FROM public.client_account_links AS account_link
    WHERE account_link.auth_user_id = p_auth_user_id
      AND account_link.organization_id = invitation.organization_id
      AND account_link.client_id = invitation.client_id
      AND account_link.client_person_id = invitation.client_person_id
      AND account_link.verification_method = 'email'
      AND account_link.verified_contact_normalized = auth_email
      AND account_link.verified_at IS NOT NULL
      AND account_link.revoked_at IS NULL;

    IF NOT found THEN
      RAISE EXCEPTION 'client_portal_invitation_not_found'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
      'accepted', true,
      'replayed', true,
      'invitationId', invitation.id,
      'organizationId', invitation.organization_id,
      'clientId', invitation.client_id,
      'clientPersonId', invitation.client_person_id
    );
  END IF;

  -- A staff-confirmed CRM email change invalidates the previous email proof.
  -- Pending claim intentionally does not own the invitation while it waits on
  -- or mutates links. This preserves link -> invitation ordering even if the
  -- pre-lock found no row and a concurrent activation inserts a phantom link.
  UPDATE public.client_account_links AS account_link
  SET revoked_at = now()
  WHERE account_link.organization_id = target_organization_id
    AND account_link.client_person_id = target_client_person_id
    AND account_link.verification_method = 'email'
    AND account_link.verified_contact_normalized <> auth_email
    AND account_link.revoked_at IS NULL;

  SELECT account_link.auth_user_id
  INTO conflicting_auth_user_id
  FROM public.client_account_links AS account_link
  WHERE account_link.organization_id = target_organization_id
    AND account_link.client_person_id = target_client_person_id
    AND account_link.revoked_at IS NULL
    AND account_link.auth_user_id <> p_auth_user_id
  FOR UPDATE;

  IF conflicting_auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'client_person_already_linked'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.client_account_links AS existing_link (
    auth_user_id,
    organization_id,
    client_id,
    client_person_id,
    source_appointment_id,
    verification_method,
    verified_contact_normalized,
    verified_at,
    revoked_at
  ) VALUES (
    p_auth_user_id,
    target_organization_id,
    target_client_id,
    target_client_person_id,
    NULL,
    'email',
    auth_email,
    now(),
    NULL
  )
  ON CONFLICT (auth_user_id, organization_id, client_person_id)
  DO UPDATE SET
    client_id = excluded.client_id,
    verification_method = excluded.verification_method,
    verified_contact_normalized = excluded.verified_contact_normalized,
    verified_at = excluded.verified_at,
    revoked_at = NULL
  WHERE existing_link.client_id IS DISTINCT FROM excluded.client_id
    OR existing_link.verification_method
      IS DISTINCT FROM excluded.verification_method
    OR existing_link.verified_contact_normalized
      IS DISTINCT FROM excluded.verified_contact_normalized
    OR existing_link.verified_at IS NULL
    OR existing_link.revoked_at IS NOT NULL;

  -- Only now own the invitation. Re-read every authorization-relevant field;
  -- any concurrent archive/claim/edit raises and atomically undoes link and
  -- lifecycle changes performed above.
  SELECT candidate.*
  INTO invitation
  FROM public.client_portal_invitations AS candidate
  WHERE candidate.id = p_invitation_id
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT person.email_normalized
  INTO person_email
  FROM public.crm_client_people AS person
  WHERE person.organization_id = invitation.organization_id
    AND person.client_id = invitation.client_id
    AND person.id = invitation.client_person_id;

  IF invitation.organization_id IS DISTINCT FROM target_organization_id
    OR invitation.client_id IS DISTINCT FROM target_client_id
    OR invitation.client_person_id IS DISTINCT FROM target_client_person_id
    OR invitation.email_normalized
      IS DISTINCT FROM invitation_snapshot.email_normalized
    OR invitation.status NOT IN ('pending'::text, 'accepted'::text)
    OR invitation.revoked_at IS NOT NULL
    OR (
      invitation.status = 'pending'::text
      AND invitation.expires_at <= now()
    )
    OR person_email IS NULL
    OR auth_email <> invitation.email_normalized
    OR auth_email <> person_email
  THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF invitation.status = 'accepted'::text THEN
    -- A concurrent callback may have completed after both callers observed a
    -- pending snapshot. Its exact link is already active; return the same
    -- idempotent replay contract without changing verified_at or lifecycle.
    PERFORM 1
    FROM public.client_account_links AS account_link
    WHERE account_link.auth_user_id = p_auth_user_id
      AND account_link.organization_id = target_organization_id
      AND account_link.client_id = target_client_id
      AND account_link.client_person_id = target_client_person_id
      AND account_link.verification_method = 'email'::text
      AND account_link.verified_contact_normalized = auth_email
      AND account_link.verified_at IS NOT NULL
      AND account_link.revoked_at IS NULL;

    IF NOT found THEN
      RAISE EXCEPTION 'client_portal_invitation_not_found'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
      'accepted', true,
      'replayed', true,
      'invitationId', invitation.id,
      'organizationId', invitation.organization_id,
      'clientId', invitation.client_id,
      'clientPersonId', invitation.client_person_id
    );
  END IF;

  UPDATE public.client_portal_invitations
  SET status = 'accepted',
      accepted_at = now(),
      revision = revision + 1,
      last_delivery_error = NULL
  WHERE id = invitation.id;

  RETURN jsonb_build_object(
    'accepted', true,
    'replayed', false,
    'invitationId', invitation.id,
    'organizationId', invitation.organization_id,
    'clientId', invitation.client_id,
    'clientPersonId', invitation.client_person_id
  );
END
$function$;

COMMENT ON FUNCTION public.claim_client_portal_invitation(uuid, uuid) IS
  'Claims or idempotently replays a portal invitation for a verified identity. Identity and target-person link rows are locked before the invitation to share archival lock ordering, including transfer after a staff-confirmed e-mail change.';

REVOKE ALL ON FUNCTION public.claim_client_portal_invitation(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_client_portal_invitation(uuid, uuid)
  TO openexpert_service;

-- Portal timeline actors are normally written by openexpert_service directly.
-- Account archival is SECURITY DEFINER, so its owner write is accepted only
-- when every actor/scope/idempotency field matches an archived lifecycle row.
CREATE OR REPLACE FUNCTION private.normalize_crm_activity_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF current_user <> 'openexpert_service'
     AND NOT (
       current_user = 'openexpert_owner'
       AND new.activity_type = 'client_portal_account_archived'::text
       AND EXISTS (
         SELECT 1
         FROM public.client_portal_accounts AS archived_account
         WHERE archived_account.id::text = new.payload ->> 'accountId'
           AND archived_account.auth_user_id = new.actor_auth_user_id
           AND archived_account.organization_id = new.organization_id
           AND archived_account.client_id = new.client_id
           AND archived_account.client_person_id = new.actor_client_person_id
           AND archived_account.status = 'archived'::text
           AND archived_account.archive_idempotency_key::text =
             new.payload ->> 'idempotencyKey'
           AND archived_account.archive_reason = new.payload ->> 'reason'
       )
     )
     AND (
       (tg_op = 'INSERT' AND (
         new.actor_client_person_id IS NOT NULL
         OR new.actor_auth_user_id IS NOT NULL
       ))
       OR (tg_op = 'UPDATE' AND (
         new.actor_client_person_id IS DISTINCT FROM old.actor_client_person_id
         OR new.actor_auth_user_id IS DISTINCT FROM old.actor_auth_user_id
       ))
     )
     AND NOT (
       tg_op = 'UPDATE'
       AND pg_trigger_depth() > 1
       AND (
         (
           old.actor_client_person_id IS NOT NULL
           AND new.actor_client_person_id IS NULL
           AND new.actor_auth_user_id IS NOT DISTINCT FROM old.actor_auth_user_id
         )
         OR (
           old.actor_auth_user_id IS NOT NULL
           AND new.actor_auth_user_id IS NULL
           AND new.actor_client_person_id IS NOT DISTINCT FROM old.actor_client_person_id
         )
       )
     ) THEN
    RAISE EXCEPTION 'only the client portal service may set a portal activity actor'
      USING ERRCODE = '42501';
  END IF;

  IF (new.actor_client_person_id IS NULL)
     <> (new.actor_auth_user_id IS NULL) THEN
    new.actor_client_person_id := NULL;
    new.actor_auth_user_id := NULL;
  END IF;

  IF tg_op = 'INSERT' THEN
    IF new.actor_client_person_id IS NOT NULL THEN
      new.actor_user_id := NULL;
    ELSIF new.actor_user_id IS NOT NULL THEN
      new.actor_client_person_id := NULL;
      new.actor_auth_user_id := NULL;
    END IF;
  ELSIF new.actor_client_person_id IS DISTINCT FROM old.actor_client_person_id
     OR new.actor_auth_user_id IS DISTINCT FROM old.actor_auth_user_id THEN
    new.actor_user_id := NULL;
  ELSIF new.actor_user_id IS DISTINCT FROM old.actor_user_id
     AND new.actor_user_id IS NOT NULL THEN
    new.actor_client_person_id := NULL;
    new.actor_auth_user_id := NULL;
  END IF;

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.normalize_crm_activity_actor()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- A portal identity may span organizations. Keep the global command result in
-- an owner-only table so idempotent replay does not require copying foreign
-- organization identifiers or totals into tenant-visible lifecycle rows.
CREATE TABLE private.client_portal_account_archive_commands (
  auth_user_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  reason text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT client_portal_account_archive_commands_pkey PRIMARY KEY (
    auth_user_id,
    idempotency_key
  ),
  CONSTRAINT client_portal_account_archive_commands_reason_check CHECK (
    btrim(reason) <> ''::text
    AND char_length(reason) <= 1000
  ),
  CONSTRAINT client_portal_account_archive_commands_response_check CHECK (
    jsonb_typeof(response) = 'object'::text
  ),
  CONSTRAINT client_portal_account_archive_commands_auth_fkey FOREIGN KEY (
    auth_user_id
  ) REFERENCES public.profiles(id) ON DELETE CASCADE
);

COMMENT ON TABLE private.client_portal_account_archive_commands IS
  'Owner-private idempotency responses for identity-wide portal archival. A response may contain scopes from several organizations and must never be exposed through tenant-readable tables.';

REVOKE ALL ON TABLE private.client_portal_account_archive_commands
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.archive_client_portal_account(
  p_auth_user_id uuid,
  p_idempotency_key uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  archive_time timestamp with time zone := statement_timestamp();
  normalized_reason text := nullif(btrim(p_reason), '');
  prior_command private.client_portal_account_archive_commands%rowtype;
  target_account public.client_portal_accounts%rowtype;
  active_account_ids uuid[];
  archived_account_ids uuid[];
  last_archived_at timestamp with time zone;
  archived_account_count integer := 0;
  revoked_link_count integer := 0;
  revoked_case_grant_count integer := 0;
  revoked_invitation_count integer := 0;
  scope_revoked_link_count integer;
  scope_revoked_case_grant_count integer;
  scope_revoked_invitation_count integer;
  scope_summary jsonb;
  archive_response jsonb;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'client_portal_auth_user_id_required'
      USING errcode = '22023';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'client_portal_idempotency_key_required'
      USING errcode = '22023';
  END IF;

  IF normalized_reason IS NULL OR char_length(normalized_reason) > 1000 THEN
    RAISE EXCEPTION 'client_portal_archive_reason_required'
      USING errcode = '22023';
  END IF;

  -- Link activation already owns its link tuple before its AFTER trigger takes
  -- the identity advisory lock. Use the same tuple -> advisory -> lifecycle
  -- order here to avoid a reactivation/archive deadlock.
  PERFORM 1
  FROM public.client_account_links AS account_link
  WHERE account_link.auth_user_id = p_auth_user_id
  ORDER BY account_link.organization_id, account_link.client_person_id
  FOR UPDATE;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'client_portal_account_archive:'::text || p_auth_user_id::text,
      0
    )
  );

  SELECT command.*
  INTO prior_command
  FROM private.client_portal_account_archive_commands AS command
  WHERE command.auth_user_id = p_auth_user_id
    AND command.idempotency_key = p_idempotency_key;

  IF found THEN
    IF prior_command.reason IS DISTINCT FROM normalized_reason THEN
      RAISE EXCEPTION 'client_portal_idempotency_key_reused'
        USING errcode = '23505';
    END IF;

    RETURN prior_command.response || jsonb_build_object('replayed', true);
  END IF;

  SELECT COALESCE(
    array_agg(locked_account.id ORDER BY locked_account.id),
    ARRAY[]::uuid[]
  )
  INTO active_account_ids
  FROM (
    SELECT portal_account.id
    FROM public.client_portal_accounts AS portal_account
    JOIN public.client_account_links AS account_link
      ON account_link.auth_user_id = portal_account.auth_user_id
     AND account_link.organization_id = portal_account.organization_id
     AND account_link.client_id = portal_account.client_id
     AND account_link.client_person_id = portal_account.client_person_id
     AND account_link.revoked_at IS NULL
    WHERE portal_account.auth_user_id = p_auth_user_id
      AND portal_account.status = 'active'::text
    ORDER BY portal_account.id
    FOR UPDATE OF portal_account
  ) AS locked_account;

  IF cardinality(active_account_ids) = 0 THEN
    SELECT
      COALESCE(
        array_agg(portal_account.id ORDER BY portal_account.id),
        ARRAY[]::uuid[]
      ),
      max(portal_account.archived_at)
    INTO archived_account_ids, last_archived_at
    FROM public.client_portal_accounts AS portal_account
    WHERE portal_account.auth_user_id = p_auth_user_id
      AND portal_account.status = 'archived'::text;

    IF cardinality(archived_account_ids) = 0 THEN
      RAISE EXCEPTION 'client_portal_account_not_found'
        USING errcode = 'P0002';
    END IF;

    archive_response := jsonb_build_object(
      'authUserId', p_auth_user_id,
      'status', 'archived',
      'archivedAccountCount', 0,
      'revokedLinkCount', 0,
      'revokedCaseGrantCount', 0,
      'revokedInvitationCount', 0,
      'accountIds', to_jsonb(archived_account_ids),
      'archivedAt', last_archived_at,
      'replayed', true
    );

    INSERT INTO private.client_portal_account_archive_commands (
      auth_user_id,
      idempotency_key,
      reason,
      response,
      created_at
    ) VALUES (
      p_auth_user_id,
      p_idempotency_key,
      normalized_reason,
      archive_response,
      archive_time
    );

    RETURN archive_response;
  END IF;

  archived_account_count := cardinality(active_account_ids);

  FOR target_account IN
    SELECT account_row.*
    FROM public.client_portal_accounts AS account_row
    WHERE account_row.id = ANY (active_account_ids)
    ORDER BY account_row.id
  LOOP
    UPDATE public.client_account_links AS account_link
    SET revoked_at = archive_time
    WHERE account_link.auth_user_id = target_account.auth_user_id
      AND account_link.organization_id = target_account.organization_id
      AND account_link.client_id = target_account.client_id
      AND account_link.client_person_id = target_account.client_person_id
      AND account_link.revoked_at IS NULL;
    GET DIAGNOSTICS scope_revoked_link_count = ROW_COUNT;

    UPDATE public.client_portal_case_grants AS portal_grant
    SET
      portal_enabled = false,
      multiform_enabled = false,
      revoked_at = COALESCE(portal_grant.revoked_at, archive_time),
      revision = portal_grant.revision + 1,
      updated_at = archive_time
    WHERE portal_grant.organization_id = target_account.organization_id
      AND portal_grant.client_id = target_account.client_id
      AND portal_grant.client_person_id = target_account.client_person_id
      AND (
        portal_grant.portal_enabled
        OR portal_grant.multiform_enabled
        OR portal_grant.revoked_at IS NULL
      );
    GET DIAGNOSTICS scope_revoked_case_grant_count = ROW_COUNT;

    UPDATE public.client_portal_invitations AS invitation
    SET
      status = 'revoked'::text,
      revoked_at = archive_time,
      revision = invitation.revision + 1,
      last_delivery_error = NULL,
      updated_at = archive_time
    WHERE invitation.organization_id = target_account.organization_id
      AND invitation.client_id = target_account.client_id
      AND invitation.client_person_id = target_account.client_person_id
      AND invitation.status = 'pending'::text
      AND invitation.revoked_at IS NULL;
    GET DIAGNOSTICS scope_revoked_invitation_count = ROW_COUNT;

    revoked_link_count := revoked_link_count + scope_revoked_link_count;
    revoked_case_grant_count := revoked_case_grant_count
      + scope_revoked_case_grant_count;
    revoked_invitation_count := revoked_invitation_count
      + scope_revoked_invitation_count;

    -- Every tenant-visible copy contains only this exact scope's counts. The
    -- identity-wide account list and totals remain in the private command row.
    scope_summary := jsonb_build_object(
      'archivedAccountCount', 1,
      'revokedLinkCount', scope_revoked_link_count,
      'revokedCaseGrantCount', scope_revoked_case_grant_count,
      'revokedInvitationCount', scope_revoked_invitation_count
    );

    UPDATE public.client_portal_accounts AS account_row
    SET
      status = 'archived'::text,
      archived_at = archive_time,
      archived_by_auth_user_id = p_auth_user_id,
      archive_idempotency_key = p_idempotency_key,
      archive_reason = normalized_reason,
      archive_metadata = scope_summary,
      revision = account_row.revision + 1,
      updated_at = archive_time
    WHERE account_row.id = target_account.id
    RETURNING * INTO target_account;

    INSERT INTO public.client_portal_account_events (
      account_id,
      auth_user_id,
      organization_id,
      client_id,
      client_person_id,
      event_type,
      from_status,
      to_status,
      actor_auth_user_id,
      idempotency_key,
      reason,
      account_revision,
      metadata,
      occurred_at
    ) VALUES (
      target_account.id,
      target_account.auth_user_id,
      target_account.organization_id,
      target_account.client_id,
      target_account.client_person_id,
      'archived'::text,
      'active'::text,
      'archived'::text,
      p_auth_user_id,
      p_idempotency_key,
      normalized_reason,
      target_account.revision,
      scope_summary,
      archive_time
    );

    INSERT INTO public.crm_activities (
      organization_id,
      actor_user_id,
      actor_client_person_id,
      actor_auth_user_id,
      client_id,
      activity_type,
      title,
      body,
      payload,
      created_at
    ) VALUES (
      target_account.organization_id,
      NULL,
      target_account.client_person_id,
      p_auth_user_id,
      target_account.client_id,
      'client_portal_account_archived'::text,
      'Zarchiwizowano konto portalu klienta'::text,
      'Klient samodzielnie zarchiwizował konto w portalu.'::text,
      scope_summary || jsonb_build_object(
        'accountId', target_account.id,
        'clientPersonId', target_account.client_person_id,
        'idempotencyKey', p_idempotency_key,
        'reason', normalized_reason,
        'revision', target_account.revision
      ),
      archive_time
    );
  END LOOP;

  archive_response := jsonb_build_object(
    'authUserId', p_auth_user_id,
    'status', 'archived',
    'archivedAccountCount', archived_account_count,
    'revokedLinkCount', revoked_link_count,
    'revokedCaseGrantCount', revoked_case_grant_count,
    'revokedInvitationCount', revoked_invitation_count,
    'accountIds', to_jsonb(active_account_ids),
    'archivedAt', archive_time,
    'replayed', false
  );

  INSERT INTO private.client_portal_account_archive_commands (
    auth_user_id,
    idempotency_key,
    reason,
    response,
    created_at
  ) VALUES (
    p_auth_user_id,
    p_idempotency_key,
    normalized_reason,
    archive_response,
    archive_time
  );

  RETURN archive_response;
END
$function$;

COMMENT ON FUNCTION public.archive_client_portal_account(uuid, uuid, text) IS
  'Atomically archives every active portal scope for one Auth identity and revokes portal access without deleting identity or CRM data.';

REVOKE ALL ON FUNCTION public.archive_client_portal_account(uuid, uuid, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.archive_client_portal_account(uuid, uuid, text)
  TO openexpert_service;

-- Client portal consent decisions retain the Better Auth actor separately from
-- CRM workforce membership and use a caller-owned idempotency key.
ALTER TABLE public.crm_client_consent_events
  ADD COLUMN recorded_by_auth_user_id uuid,
  ADD COLUMN client_portal_idempotency_key uuid,
  DROP CONSTRAINT crm_client_consent_events_actor_shape,
  DROP CONSTRAINT crm_client_consent_events_source_check;

ALTER TABLE public.crm_client_consent_events
  ADD CONSTRAINT crm_client_consent_events_source_check CHECK (
    source = ANY (ARRAY[
      'client_creation'::text,
      'client_card'::text,
      'import'::text,
      'api'::text,
      'booking_widget'::text,
      'sms_verification'::text,
      'client_portal'::text
    ])
  ) NOT VALID,
  ADD CONSTRAINT crm_client_consent_events_actor_shape CHECK (
    (
      source = 'booking_widget'::text
      AND recorded_by_user_id IS NULL
      AND recorded_by_auth_user_id IS NULL
      AND client_portal_idempotency_key IS NULL
    )
    OR (
      source = 'client_portal'::text
      AND recorded_by_user_id IS NULL
      AND recorded_by_auth_user_id IS NOT NULL
      AND client_portal_idempotency_key IS NOT NULL
    )
    OR (
      source <> ALL (ARRAY['booking_widget'::text, 'client_portal'::text])
      AND recorded_by_user_id IS NOT NULL
      AND recorded_by_auth_user_id IS NULL
      AND client_portal_idempotency_key IS NULL
    )
  ) NOT VALID,
  ADD CONSTRAINT crm_client_consent_events_recorded_by_auth_fkey FOREIGN KEY (
    recorded_by_auth_user_id
  ) REFERENCES public.profiles(id);

ALTER TABLE public.crm_client_consent_events
  VALIDATE CONSTRAINT crm_client_consent_events_source_check;
ALTER TABLE public.crm_client_consent_events
  VALIDATE CONSTRAINT crm_client_consent_events_actor_shape;

COMMENT ON COLUMN public.crm_client_consent_events.recorded_by_auth_user_id IS
  'Better Auth identity that recorded a decision directly in the client portal; never a workforce membership actor.';
COMMENT ON COLUMN public.crm_client_consent_events.client_portal_idempotency_key IS
  'Caller-generated key for one idempotent client portal consent decision.';

CREATE UNIQUE INDEX crm_client_consent_events_portal_idempotency_idx
  ON public.crm_client_consent_events (
    recorded_by_auth_user_id,
    client_portal_idempotency_key
  )
  WHERE source = 'client_portal'::text;

-- Serialize every future semantic consent write (staff, SMS, booking and
-- portal) on a stable CRM tuple. The portal RPC takes this same lock before
-- reading the latest event. PII-only scrubbing of contact/evidence/metadata is
-- intentionally excluded because it cannot change the current decision.
CREATE FUNCTION private.serialize_crm_client_consent_event_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  old_scope_key text;
  new_scope_key text;
  first_scope_key text;
  second_scope_key text;
BEGIN
  IF tg_op = 'UPDATE'
    AND old.organization_id IS NOT DISTINCT FROM new.organization_id
    AND old.client_id IS NOT DISTINCT FROM new.client_id
    AND old.subject_person_id IS NOT DISTINCT FROM new.subject_person_id
    AND old.definition_id IS NOT DISTINCT FROM new.definition_id
    AND old.definition_version_id IS NOT DISTINCT FROM new.definition_version_id
    AND old.decision IS NOT DISTINCT FROM new.decision
    AND old.source IS NOT DISTINCT FROM new.source
    AND old.occurred_at IS NOT DISTINCT FROM new.occurred_at
  THEN
    RETURN new;
  END IF;

  IF tg_op <> 'INSERT' THEN
    old_scope_key := 'crm_client_consent_event_scope:'::text
      || old.organization_id::text || ':'::text
      || old.client_id::text || ':'::text
      || old.subject_person_id::text || ':'::text
      || old.definition_id::text;
  END IF;

  IF tg_op <> 'DELETE' THEN
    new_scope_key := 'crm_client_consent_event_scope:'::text
      || new.organization_id::text || ':'::text
      || new.client_id::text || ':'::text
      || new.subject_person_id::text || ':'::text
      || new.definition_id::text;
  END IF;

  first_scope_key := CASE
    WHEN old_scope_key IS NULL THEN new_scope_key
    WHEN new_scope_key IS NULL THEN old_scope_key
    ELSE least(old_scope_key, new_scope_key)
  END;
  second_scope_key := CASE
    WHEN old_scope_key IS NOT NULL
      AND new_scope_key IS NOT NULL
      AND old_scope_key <> new_scope_key
      THEN greatest(old_scope_key, new_scope_key)
    ELSE NULL
  END;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(first_scope_key, 0)
  );

  IF second_scope_key IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(second_scope_key, 0)
    );
  END IF;

  IF tg_op = 'DELETE' THEN
    RETURN old;
  END IF;

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.serialize_crm_client_consent_event_scope()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER serialize_crm_client_consent_event_scope
  BEFORE INSERT OR UPDATE OR DELETE ON public.crm_client_consent_events
  FOR EACH ROW
  EXECUTE FUNCTION private.serialize_crm_client_consent_event_scope();

CREATE FUNCTION public.withdraw_client_portal_consent(
  p_auth_user_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_client_person_id uuid,
  p_definition_id uuid,
  p_idempotency_key uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  existing_event public.crm_client_consent_events%rowtype;
  latest_event public.crm_client_consent_events%rowtype;
  inserted_event public.crm_client_consent_events%rowtype;
  withdrawal_time timestamp with time zone;
BEGIN
  IF p_auth_user_id IS NULL
    OR p_organization_id IS NULL
    OR p_client_id IS NULL
    OR p_client_person_id IS NULL
    OR p_definition_id IS NULL
  THEN
    RAISE EXCEPTION 'client_portal_consent_scope_required'
      USING errcode = '22023';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'client_portal_idempotency_key_required'
      USING errcode = '22023';
  END IF;

  -- Serialize reuse of one caller key even when a buggy client changes scope.
  -- The CRM tuple lock is intentionally taken later, after the portal link and
  -- archive locks, so every portal account operation follows one lock order.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'client_portal_consent_idempotency:'::text
        || p_auth_user_id::text || ':'::text || p_idempotency_key::text,
      0
    )
  );

  SELECT consent_event.*
  INTO existing_event
  FROM public.crm_client_consent_events AS consent_event
  WHERE consent_event.recorded_by_auth_user_id = p_auth_user_id
    AND consent_event.client_portal_idempotency_key = p_idempotency_key
  LIMIT 1;

  IF found THEN
    IF existing_event.source <> 'client_portal'::text
      OR existing_event.decision <> 'withdrawn'::text
      OR existing_event.organization_id <> p_organization_id
      OR existing_event.client_id <> p_client_id
      OR existing_event.subject_person_id <> p_client_person_id
      OR existing_event.definition_id <> p_definition_id
    THEN
      RAISE EXCEPTION 'client_portal_idempotency_key_reused'
        USING errcode = '23505';
    END IF;

    RETURN jsonb_build_object(
      'consentEventId', existing_event.id,
      'organizationId', existing_event.organization_id,
      'clientId', existing_event.client_id,
      'clientPersonId', existing_event.subject_person_id,
      'definitionId', existing_event.definition_id,
      'definitionVersionId', existing_event.definition_version_id,
      'decision', existing_event.decision,
      'occurredAt', existing_event.occurred_at,
      'replayed', true
    );
  END IF;

  -- Serialize with archival using its link tuple -> identity advisory order.
  -- A successful withdrawal therefore cannot commit after the same account was
  -- archived while this RPC was validating its active scope.
  PERFORM 1
  FROM public.client_account_links AS account_link
  WHERE account_link.auth_user_id = p_auth_user_id
    AND account_link.organization_id = p_organization_id
    AND account_link.client_id = p_client_id
    AND account_link.client_person_id = p_client_person_id
    AND account_link.revoked_at IS NULL
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'client_portal_consent_not_found'
      USING errcode = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'client_portal_account_archive:'::text || p_auth_user_id::text,
      0
    )
  );

  PERFORM 1
  FROM public.client_portal_accounts AS portal_account
  WHERE portal_account.auth_user_id = p_auth_user_id
    AND portal_account.organization_id = p_organization_id
    AND portal_account.client_id = p_client_id
    AND portal_account.client_person_id = p_client_person_id
    AND portal_account.status = 'active'::text
  FOR KEY SHARE;

  IF NOT found THEN
    RAISE EXCEPTION 'client_portal_consent_not_found'
      USING errcode = 'P0002';
  END IF;

  -- All consent INSERT paths acquire this exact key in the table trigger.
  -- Take it before reading the latest decision, after account validation, so
  -- no staff/SMS/booking decision can interleave with the withdrawal.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crm_client_consent_event_scope:'::text
        || p_organization_id::text || ':'::text
        || p_client_id::text || ':'::text
        || p_client_person_id::text || ':'::text
        || p_definition_id::text,
      0
    )
  );

  SELECT consent_event.*
  INTO latest_event
  FROM public.crm_client_consent_events AS consent_event
  WHERE consent_event.organization_id = p_organization_id
    AND consent_event.client_id = p_client_id
    AND consent_event.subject_person_id = p_client_person_id
    AND consent_event.definition_id = p_definition_id
  ORDER BY consent_event.occurred_at DESC, consent_event.id DESC
  LIMIT 1;

  IF NOT found THEN
    RAISE EXCEPTION 'client_portal_consent_not_found'
      USING errcode = 'P0002';
  END IF;

  IF latest_event.decision <> 'granted'::text THEN
    RAISE EXCEPTION 'client_portal_consent_not_active'
      USING errcode = '23514';
  END IF;

  withdrawal_time := greatest(
    clock_timestamp(),
    latest_event.occurred_at + interval '1 microsecond'
  );

  INSERT INTO public.crm_client_consent_events (
    organization_id,
    client_id,
    subject_person_id,
    definition_id,
    definition_version_id,
    decision,
    contact_value,
    source,
    occurred_at,
    recorded_by_user_id,
    recorded_by_auth_user_id,
    client_portal_idempotency_key,
    evidence_reference,
    metadata
  ) VALUES (
    p_organization_id,
    p_client_id,
    p_client_person_id,
    p_definition_id,
    latest_event.definition_version_id,
    'withdrawn'::text,
    NULL,
    'client_portal'::text,
    withdrawal_time,
    NULL,
    p_auth_user_id,
    p_idempotency_key,
    'client-portal:'::text || p_idempotency_key::text,
    jsonb_build_object(
      'method', 'client_portal_account',
      'supersedesConsentEventId', latest_event.id,
      'grantedDefinitionVersionId', latest_event.definition_version_id
    )
  )
  RETURNING * INTO inserted_event;

  RETURN jsonb_build_object(
    'consentEventId', inserted_event.id,
    'organizationId', inserted_event.organization_id,
    'clientId', inserted_event.client_id,
    'clientPersonId', inserted_event.subject_person_id,
    'definitionId', inserted_event.definition_id,
    'definitionVersionId', inserted_event.definition_version_id,
    'decision', inserted_event.decision,
    'occurredAt', inserted_event.occurred_at,
    'replayed', false
  );
END
$function$;

COMMENT ON FUNCTION public.withdraw_client_portal_consent(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) IS
  'Appends an idempotent withdrawal for the latest granted consent after validating the exact active Auth, organization, CRM client and person scope.';

REVOKE ALL ON FUNCTION public.withdraw_client_portal_consent(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.withdraw_client_portal_consent(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) TO openexpert_service;

ALTER TABLE public.client_portal_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_account_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_portal_accounts_service_read
  ON public.client_portal_accounts
  FOR SELECT TO openexpert_service
  USING (true);

CREATE POLICY client_portal_accounts_staff_read
  ON public.client_portal_accounts
  FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

CREATE POLICY client_portal_account_events_service_read
  ON public.client_portal_account_events
  FOR SELECT TO openexpert_service
  USING (true);

CREATE POLICY client_portal_account_events_staff_read
  ON public.client_portal_account_events
  FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

REVOKE ALL ON TABLE public.client_portal_accounts
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.client_portal_account_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT
  ON TABLE public.client_portal_accounts TO openexpert_service;
GRANT SELECT
  ON TABLE public.client_portal_account_events TO openexpert_service;
GRANT SELECT
  ON TABLE public.client_portal_accounts TO authenticated;
GRANT SELECT
  ON TABLE public.client_portal_account_events TO authenticated;
