-- Client portal access is deliberately separate from organization membership.
-- A Better Auth identity first proves control of a CRM person's current email
-- and then receives an explicit, person-scoped grant for each shared case.

CREATE TABLE public.client_portal_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  client_person_id uuid NOT NULL,
  email_normalized text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  invited_by_user_id uuid,
  revision bigint DEFAULT 1 NOT NULL,
  delivery_attempts integer DEFAULT 0 NOT NULL,
  last_delivery_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT client_portal_invitations_email_check CHECK (
    btrim(email_normalized) <> ''
    AND email_normalized = lower(btrim(email_normalized))
    AND length(email_normalized) <= 320
  ),
  CONSTRAINT client_portal_invitations_status_check CHECK (
    status = ANY (ARRAY['pending', 'accepted', 'expired', 'revoked'])
  ),
  CONSTRAINT client_portal_invitations_lifecycle_check CHECK (
    (status = 'pending' AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (status = 'accepted' AND accepted_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'expired' AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND accepted_at IS NULL AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT client_portal_invitations_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT client_portal_invitations_revision_check CHECK (revision >= 1),
  CONSTRAINT client_portal_invitations_delivery_attempts_check CHECK (
    delivery_attempts >= 0
  ),
  CONSTRAINT client_portal_invitations_last_delivery_error_check CHECK (
    last_delivery_error IS NULL OR length(last_delivery_error) <= 2000
  ),
  CONSTRAINT client_portal_invitations_person_fkey FOREIGN KEY (
    organization_id,
    client_id,
    client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    client_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT client_portal_invitations_inviter_fkey FOREIGN KEY (
    organization_id,
    invited_by_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE SET NULL (invited_by_user_id)
);

COMMENT ON TABLE public.client_portal_invitations IS
  'One-time client portal invitations. The email is rechecked against Better Auth and the CRM person during acceptance.';

CREATE UNIQUE INDEX client_portal_invitations_pending_person_idx
  ON public.client_portal_invitations (organization_id, client_person_id)
  WHERE status = 'pending' AND revoked_at IS NULL;

CREATE INDEX client_portal_invitations_email_idx
  ON public.client_portal_invitations (email_normalized, expires_at DESC);

CREATE TRIGGER set_client_portal_invitations_updated_at
  BEFORE UPDATE ON public.client_portal_invitations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.client_portal_case_grants (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  client_person_id uuid NOT NULL,
  client_id uuid NOT NULL,
  portal_enabled boolean DEFAULT true NOT NULL,
  multiform_enabled boolean DEFAULT false NOT NULL,
  granted_by_user_id uuid,
  portal_enabled_at timestamp with time zone,
  multiform_enabled_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revision bigint DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT client_portal_case_grants_pkey PRIMARY KEY (
    organization_id,
    case_id,
    client_person_id
  ),
  CONSTRAINT client_portal_case_grants_revision_check CHECK (revision >= 1),
  CONSTRAINT client_portal_case_grants_multiform_requires_portal CHECK (
    NOT multiform_enabled OR portal_enabled
  ),
  CONSTRAINT client_portal_case_grants_revoked_shape CHECK (
    revoked_at IS NULL OR (NOT portal_enabled AND NOT multiform_enabled)
  ),
  CONSTRAINT client_portal_case_grants_case_fkey FOREIGN KEY (
    organization_id,
    case_id
  ) REFERENCES public.crm_cases (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT client_portal_case_grants_case_client_fkey FOREIGN KEY (
    case_id,
    client_id
  ) REFERENCES public.crm_case_clients (
    case_id,
    client_id
  ) ON DELETE CASCADE,
  CONSTRAINT client_portal_case_grants_person_fkey FOREIGN KEY (
    organization_id,
    client_id,
    client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    client_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT client_portal_case_grants_granter_fkey FOREIGN KEY (
    organization_id,
    granted_by_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE SET NULL (granted_by_user_id)
);

COMMENT ON TABLE public.client_portal_case_grants IS
  'Explicit person-level access to one CRM case; this never grants tenant staff membership.';

CREATE INDEX client_portal_case_grants_person_idx
  ON public.client_portal_case_grants (
    client_person_id,
    organization_id,
    portal_enabled,
    revoked_at
  );

CREATE INDEX client_portal_case_grants_case_idx
  ON public.client_portal_case_grants (organization_id, case_id);

CREATE TRIGGER set_client_portal_case_grants_updated_at
  BEFORE UPDATE ON public.client_portal_case_grants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Portal writes retain both the CRM person and the Better Auth identity. Staff
-- writes continue to use the original organization-membership actor column.
ALTER TABLE public.crm_case_multiform_drafts
  ADD COLUMN updated_by_client_person_id uuid,
  ADD COLUMN updated_by_auth_user_id uuid,
  ADD COLUMN client_portal_step smallint DEFAULT 1 NOT NULL,
  ADD COLUMN client_portal_completed_at timestamp with time zone,
  ADD CONSTRAINT crm_case_multiform_drafts_portal_step_check CHECK (
    client_portal_step BETWEEN 1 AND 3
  ),
  ADD CONSTRAINT crm_case_multiform_drafts_portal_actor_pair_check CHECK (
    (updated_by_client_person_id IS NULL) = (updated_by_auth_user_id IS NULL)
  ),
  ADD CONSTRAINT crm_case_multiform_drafts_actor_exclusive_check CHECK (
    updated_by_user_id IS NULL OR updated_by_client_person_id IS NULL
  ),
  ADD CONSTRAINT crm_case_multiform_drafts_portal_person_fkey FOREIGN KEY (
    organization_id,
    updated_by_client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    id
  ) ON DELETE SET NULL (updated_by_client_person_id),
  ADD CONSTRAINT crm_case_multiform_drafts_portal_auth_user_fkey FOREIGN KEY (
    updated_by_auth_user_id
  ) REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION private.normalize_crm_case_multiform_draft_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF current_user <> 'openexpert_service'
     AND (
       (tg_op = 'INSERT' AND (
         new.updated_by_client_person_id IS NOT NULL
         OR new.updated_by_auth_user_id IS NOT NULL
       ))
       OR (tg_op = 'UPDATE' AND (
         new.updated_by_client_person_id IS DISTINCT FROM old.updated_by_client_person_id
         OR new.updated_by_auth_user_id IS DISTINCT FROM old.updated_by_auth_user_id
       ))
     )
     AND NOT (
       tg_op = 'UPDATE'
       AND pg_trigger_depth() > 1
       AND (
         (
           old.updated_by_client_person_id IS NOT NULL
           AND new.updated_by_client_person_id IS NULL
           AND new.updated_by_auth_user_id IS NOT DISTINCT FROM old.updated_by_auth_user_id
         )
         OR (
           old.updated_by_auth_user_id IS NOT NULL
           AND new.updated_by_auth_user_id IS NULL
           AND new.updated_by_client_person_id IS NOT DISTINCT FROM old.updated_by_client_person_id
         )
       )
     ) THEN
    RAISE EXCEPTION 'only the client portal service may set a portal draft actor'
      USING ERRCODE = '42501';
  END IF;

  -- ON DELETE SET NULL foreign-key actions update one column at a time. Clear
  -- the full portal actor pair so no half-identity can survive that update.
  IF (new.updated_by_client_person_id IS NULL)
     <> (new.updated_by_auth_user_id IS NULL) THEN
    new.updated_by_client_person_id := NULL;
    new.updated_by_auth_user_id := NULL;
  END IF;

  IF tg_op = 'INSERT' THEN
    IF new.updated_by_client_person_id IS NOT NULL
       OR new.updated_by_auth_user_id IS NOT NULL THEN
      new.updated_by_user_id := NULL;
    ELSIF new.updated_by_user_id IS NOT NULL THEN
      new.updated_by_client_person_id := NULL;
      new.updated_by_auth_user_id := NULL;
    END IF;
  ELSIF new.updated_by_client_person_id IS DISTINCT FROM old.updated_by_client_person_id
     OR new.updated_by_auth_user_id IS DISTINCT FROM old.updated_by_auth_user_id THEN
    new.updated_by_user_id := NULL;
  ELSIF new.updated_by_user_id IS DISTINCT FROM old.updated_by_user_id
     AND new.updated_by_user_id IS NOT NULL THEN
    new.updated_by_client_person_id := NULL;
    new.updated_by_auth_user_id := NULL;
  END IF;

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.normalize_crm_case_multiform_draft_actor()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER normalize_crm_case_multiform_draft_actor
  BEFORE INSERT OR UPDATE ON public.crm_case_multiform_drafts
  FOR EACH ROW EXECUTE FUNCTION private.normalize_crm_case_multiform_draft_actor();

ALTER TABLE public.crm_documents
  ADD COLUMN uploaded_by_client_person_id uuid,
  ADD COLUMN uploaded_by_auth_user_id uuid,
  ADD CONSTRAINT crm_documents_portal_actor_pair_check CHECK (
    (uploaded_by_client_person_id IS NULL) = (uploaded_by_auth_user_id IS NULL)
  ),
  ADD CONSTRAINT crm_documents_actor_exclusive_check CHECK (
    uploaded_by_user_id IS NULL OR uploaded_by_client_person_id IS NULL
  ),
  ADD CONSTRAINT crm_documents_portal_person_fkey FOREIGN KEY (
    organization_id,
    uploaded_by_client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    id
  ) ON DELETE SET NULL (uploaded_by_client_person_id),
  ADD CONSTRAINT crm_documents_portal_auth_user_fkey FOREIGN KEY (
    uploaded_by_auth_user_id
  ) REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION private.normalize_crm_document_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF current_user <> 'openexpert_service'
     AND (
       (tg_op = 'INSERT' AND (
         new.uploaded_by_client_person_id IS NOT NULL
         OR new.uploaded_by_auth_user_id IS NOT NULL
       ))
       OR (tg_op = 'UPDATE' AND (
         new.uploaded_by_client_person_id IS DISTINCT FROM old.uploaded_by_client_person_id
         OR new.uploaded_by_auth_user_id IS DISTINCT FROM old.uploaded_by_auth_user_id
       ))
     )
     AND NOT (
       tg_op = 'UPDATE'
       AND pg_trigger_depth() > 1
       AND (
         (
           old.uploaded_by_client_person_id IS NOT NULL
           AND new.uploaded_by_client_person_id IS NULL
           AND new.uploaded_by_auth_user_id IS NOT DISTINCT FROM old.uploaded_by_auth_user_id
         )
         OR (
           old.uploaded_by_auth_user_id IS NOT NULL
           AND new.uploaded_by_auth_user_id IS NULL
           AND new.uploaded_by_client_person_id IS NOT DISTINCT FROM old.uploaded_by_client_person_id
         )
       )
     ) THEN
    RAISE EXCEPTION 'only the client portal service may set a portal document actor'
      USING ERRCODE = '42501';
  END IF;

  IF (new.uploaded_by_client_person_id IS NULL)
     <> (new.uploaded_by_auth_user_id IS NULL) THEN
    new.uploaded_by_client_person_id := NULL;
    new.uploaded_by_auth_user_id := NULL;
  END IF;

  IF tg_op = 'INSERT' THEN
    IF new.uploaded_by_client_person_id IS NOT NULL THEN
      new.uploaded_by_user_id := NULL;
    ELSIF new.uploaded_by_user_id IS NOT NULL THEN
      new.uploaded_by_client_person_id := NULL;
      new.uploaded_by_auth_user_id := NULL;
    END IF;
  ELSIF new.uploaded_by_client_person_id
           IS DISTINCT FROM old.uploaded_by_client_person_id
     OR new.uploaded_by_auth_user_id
           IS DISTINCT FROM old.uploaded_by_auth_user_id THEN
    new.uploaded_by_user_id := NULL;
  ELSIF new.uploaded_by_user_id IS DISTINCT FROM old.uploaded_by_user_id
     AND new.uploaded_by_user_id IS NOT NULL THEN
    new.uploaded_by_client_person_id := NULL;
    new.uploaded_by_auth_user_id := NULL;
  END IF;

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.normalize_crm_document_actor()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER normalize_crm_document_actor
  BEFORE INSERT OR UPDATE ON public.crm_documents
  FOR EACH ROW EXECUTE FUNCTION private.normalize_crm_document_actor();

ALTER TABLE public.crm_documents
  DROP CONSTRAINT crm_documents_case_file_integrity_check;

ALTER TABLE public.crm_documents
  ADD CONSTRAINT crm_documents_case_file_integrity_check CHECK (
    storage_bucket <> 'crm-case-documents'
    OR (
      case_id IS NOT NULL
      AND (
        uploaded_by_user_id IS NOT NULL
        OR (
          uploaded_by_client_person_id IS NOT NULL
          AND uploaded_by_auth_user_id IS NOT NULL
        )
      )
      AND mime_type IS NOT NULL
      AND size_bytes IS NOT NULL
      AND sha256 IS NOT NULL
      AND storage_path LIKE organization_id::text || '/' || case_id::text || '/%'
    )
  );

COMMENT ON COLUMN public.crm_documents.uploaded_by_client_person_id IS
  'CRM person that uploaded a case file through the client portal.';
COMMENT ON COLUMN public.crm_documents.uploaded_by_auth_user_id IS
  'Better Auth identity used for a client portal upload.';
COMMENT ON COLUMN public.crm_case_multiform_drafts.updated_by_client_person_id IS
  'CRM person responsible for the latest client portal draft write.';
COMMENT ON COLUMN public.crm_case_multiform_drafts.updated_by_auth_user_id IS
  'Better Auth identity responsible for the latest client portal draft write.';

-- Messages and client-side document actions appear in the existing staff case
-- timeline without pretending that a portal identity is an organization user.
ALTER TABLE public.crm_activities
  ADD COLUMN actor_client_person_id uuid,
  ADD COLUMN actor_auth_user_id uuid,
  ADD CONSTRAINT crm_activities_portal_actor_pair_check CHECK (
    (actor_client_person_id IS NULL) = (actor_auth_user_id IS NULL)
  ),
  ADD CONSTRAINT crm_activities_actor_exclusive_check CHECK (
    actor_user_id IS NULL OR actor_client_person_id IS NULL
  ),
  ADD CONSTRAINT crm_activities_portal_person_fkey FOREIGN KEY (
    organization_id,
    actor_client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    id
  ) ON DELETE SET NULL (actor_client_person_id),
  ADD CONSTRAINT crm_activities_portal_auth_user_fkey FOREIGN KEY (
    actor_auth_user_id
  ) REFERENCES public.profiles (id) ON DELETE SET NULL;

CREATE INDEX crm_activities_portal_actor_idx
  ON public.crm_activities (
    organization_id,
    actor_client_person_id,
    actor_auth_user_id,
    created_at DESC
  ) WHERE actor_client_person_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.normalize_crm_activity_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF current_user <> 'openexpert_service'
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

CREATE TRIGGER normalize_crm_activity_actor
  BEFORE INSERT OR UPDATE ON public.crm_activities
  FOR EACH ROW EXECUTE FUNCTION private.normalize_crm_activity_actor();

COMMENT ON COLUMN public.crm_activities.actor_client_person_id IS
  'CRM person responsible for a client portal timeline event.';
COMMENT ON COLUMN public.crm_activities.actor_auth_user_id IS
  'Better Auth identity responsible for a client portal timeline event.';

-- Atomic invitation acceptance. The service passes only the session identity;
-- the database independently loads its verified email from the private Better
-- Auth schema and compares it with both invitation and current CRM person.
CREATE OR REPLACE FUNCTION public.claim_client_portal_invitation(
  p_invitation_id uuid,
  p_auth_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  invitation public.client_portal_invitations%ROWTYPE;
  auth_email text;
  person_email text;
  conflicting_auth_user_id uuid;
BEGIN
  SELECT lower(btrim(auth_user.email))
  INTO auth_email
  FROM identity.users AS auth_user
  WHERE auth_user.id = p_auth_user_id
    AND auth_user.email_verified;

  IF auth_email IS NULL THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT candidate.*
  INTO invitation
  FROM public.client_portal_invitations AS candidate
  WHERE candidate.id = p_invitation_id
    AND candidate.status = 'pending'
    AND candidate.revoked_at IS NULL
    AND candidate.expires_at > now()
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

  IF person_email IS NULL
     OR auth_email <> invitation.email_normalized
     OR auth_email <> person_email THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT account_link.auth_user_id
  INTO conflicting_auth_user_id
  FROM public.client_account_links AS account_link
  WHERE account_link.organization_id = invitation.organization_id
    AND account_link.client_person_id = invitation.client_person_id
    AND account_link.revoked_at IS NULL
    AND account_link.auth_user_id <> p_auth_user_id
  FOR UPDATE;

  IF conflicting_auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'client_person_already_linked'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.client_account_links (
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
    invitation.organization_id,
    invitation.client_id,
    invitation.client_person_id,
    NULL,
    'email',
    auth_email,
    now(),
    NULL
  )
  ON CONFLICT (auth_user_id, organization_id, client_person_id)
  DO UPDATE SET
    client_id = excluded.client_id,
    source_appointment_id = NULL,
    verification_method = excluded.verification_method,
    verified_contact_normalized = excluded.verified_contact_normalized,
    verified_at = excluded.verified_at,
    revoked_at = NULL;

  UPDATE public.client_portal_invitations
  SET status = 'accepted',
      accepted_at = now(),
      revision = revision + 1,
      last_delivery_error = NULL
  WHERE id = invitation.id;

  RETURN jsonb_build_object(
    'accepted', true,
    'invitationId', invitation.id,
    'organizationId', invitation.organization_id,
    'clientId', invitation.client_id,
    'clientPersonId', invitation.client_person_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.claim_client_portal_invitation(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_client_portal_invitation(uuid, uuid)
  TO openexpert_service;

ALTER TABLE public.client_portal_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_portal_case_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all
  ON public.client_portal_invitations
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY openexpert_service_all
  ON public.client_portal_case_grants
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

-- CRM staff manage sharing through their normal tenant-scoped Data API
-- session. Client portal sessions never receive this membership-based policy.
CREATE POLICY client_portal_case_grants_organization_members
  ON public.client_portal_case_grants
  FOR ALL TO authenticated
  USING (private.is_organization_member(organization_id))
  WITH CHECK (private.is_organization_member(organization_id));

REVOKE ALL ON TABLE public.client_portal_invitations
  FROM PUBLIC, anonymous, authenticated;
REVOKE ALL ON TABLE public.client_portal_case_grants
  FROM PUBLIC, anonymous, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.client_portal_invitations
  TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.client_portal_case_grants
  TO openexpert_service;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.client_portal_case_grants
  TO authenticated;
