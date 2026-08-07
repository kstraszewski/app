-- Group case messaging extends the existing person-scoped direct threads.
-- Direct rows and every v1-v3 direct RPC remain valid during rolling deploys;
-- group rows use an explicit participant relation and never overload the
-- legacy direct client/person columns.

ALTER TABLE public.crm_case_conversations
  ADD COLUMN kind text DEFAULT 'direct'::text NOT NULL,
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN client_person_id DROP NOT NULL,
  ADD CONSTRAINT crm_case_conversations_kind_check CHECK (
    kind = ANY (ARRAY['direct'::text, 'group'::text])
  ),
  ADD CONSTRAINT crm_case_conversations_kind_shape_check CHECK (
    (
      kind = 'direct'::text
      AND client_id IS NOT NULL
      AND client_person_id IS NOT NULL
    )
    OR (
      kind = 'group'::text
      AND client_id IS NULL
      AND client_person_id IS NULL
    )
  ),
  ADD CONSTRAINT crm_case_conversations_organization_id_id_case_id_key
    UNIQUE (organization_id, id, case_id);

COMMENT ON COLUMN public.crm_case_conversations.kind IS
  'direct keeps the legacy one-person thread; group is the shared borrower thread for the case.';

CREATE UNIQUE INDEX crm_case_conversations_group_case_key
  ON public.crm_case_conversations (organization_id, case_id)
  WHERE kind = 'group'::text;

CREATE TABLE public.crm_case_conversation_participants (
  organization_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  case_id uuid NOT NULL,
  client_id uuid NOT NULL,
  client_person_id uuid NOT NULL,
  joined_at timestamp with time zone DEFAULT now() NOT NULL,
  removed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_conversation_participants_pkey PRIMARY KEY (
    organization_id,
    conversation_id,
    client_person_id
  ),
  CONSTRAINT crm_case_conversation_participants_timeline_check CHECK (
    removed_at IS NULL OR removed_at >= joined_at
  ),
  CONSTRAINT crm_case_conversation_participants_conversation_fkey FOREIGN KEY (
    organization_id,
    conversation_id,
    case_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id,
    case_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_conversation_participants_person_fkey FOREIGN KEY (
    organization_id,
    client_id,
    client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    client_id,
    id
  ) ON DELETE RESTRICT
);

COMMENT ON TABLE public.crm_case_conversation_participants IS
  'Durable client-person membership for direct and shared case conversations. removed_at revokes access without erasing message authorship or receipts.';

CREATE INDEX crm_case_conversation_participants_person_active_idx
  ON public.crm_case_conversation_participants (
    client_person_id,
    organization_id,
    case_id,
    conversation_id
  )
  WHERE removed_at IS NULL;

CREATE INDEX crm_case_conversation_participants_client_idx
  ON public.crm_case_conversation_participants (
    organization_id,
    client_id,
    conversation_id
  );

CREATE FUNCTION private.validate_case_conversation_participant()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_conversation public.crm_case_conversations%rowtype;
BEGIN
  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = NEW.organization_id
    AND conversation.id = NEW.conversation_id
    AND conversation.case_id = NEW.case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = '23503';
  END IF;

  IF target_conversation.kind = 'direct'::text THEN
    IF NEW.client_id IS DISTINCT FROM target_conversation.client_id
      OR NEW.client_person_id
        IS DISTINCT FROM target_conversation.client_person_id
      OR NEW.removed_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'direct_case_conversation_participant_mismatch'
        USING errcode = '23514';
    END IF;
  ELSIF NEW.removed_at IS NULL AND NOT EXISTS (
    SELECT 1
    FROM public.client_portal_case_grants AS portal_grant
    JOIN public.crm_client_people AS person
      ON person.organization_id = portal_grant.organization_id
     AND person.client_id = portal_grant.client_id
     AND person.id = portal_grant.client_person_id
    JOIN public.crm_clients AS client
      ON client.organization_id = portal_grant.organization_id
     AND client.id = portal_grant.client_id
    WHERE portal_grant.organization_id = NEW.organization_id
      AND portal_grant.case_id = NEW.case_id
      AND portal_grant.client_id = NEW.client_id
      AND portal_grant.client_person_id = NEW.client_person_id
      AND portal_grant.portal_enabled
      AND portal_grant.revoked_at IS NULL
      AND client.status_code <> 'anonymized'::text
      AND lower(btrim(person.role)) = ANY (
        ARRAY['primary'::text, 'co_borrower'::text, 'co_applicant'::text]
      )
      AND EXISTS (
        SELECT 1
        FROM public.client_account_links AS account_link
        WHERE account_link.organization_id = portal_grant.organization_id
          AND account_link.client_id = portal_grant.client_id
          AND account_link.client_person_id = portal_grant.client_person_id
          AND account_link.revoked_at IS NULL
          AND account_link.verification_method = 'email'::text
          AND person.email_normalized IS NOT NULL
          AND account_link.verified_contact_normalized = person.email_normalized
      )
  ) THEN
    RAISE EXCEPTION 'case_group_participant_not_eligible'
      USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_case_conversation_participant()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER validate_case_conversation_participant
  BEFORE INSERT OR UPDATE OF
    organization_id,
    conversation_id,
    case_id,
    client_id,
    client_person_id,
    removed_at
  ON public.crm_case_conversation_participants
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_case_conversation_participant();

CREATE TRIGGER set_crm_case_conversation_participants_updated_at
  BEFORE UPDATE ON public.crm_case_conversation_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION private.add_direct_case_conversation_participant()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF NEW.kind = 'direct'::text THEN
    INSERT INTO public.crm_case_conversation_participants (
      organization_id,
      conversation_id,
      case_id,
      client_id,
      client_person_id,
      joined_at,
      created_at,
      updated_at
    ) VALUES (
      NEW.organization_id,
      NEW.id,
      NEW.case_id,
      NEW.client_id,
      NEW.client_person_id,
      NEW.created_at,
      NEW.created_at,
      NEW.updated_at
    )
    ON CONFLICT (organization_id, conversation_id, client_person_id)
    DO UPDATE SET
      client_id = EXCLUDED.client_id,
      case_id = EXCLUDED.case_id,
      removed_at = NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.add_direct_case_conversation_participant()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_conversations_add_direct_participant
  AFTER INSERT ON public.crm_case_conversations
  FOR EACH ROW
  EXECUTE FUNCTION private.add_direct_case_conversation_participant();

CREATE FUNCTION private.reject_case_conversation_identity_change()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.client_person_id IS DISTINCT FROM OLD.client_person_id
  THEN
    RAISE EXCEPTION 'case_conversation_identity_immutable'
      USING errcode = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_case_conversation_identity_change()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_conversations_reject_identity_change
  BEFORE UPDATE OF organization_id, case_id, kind, client_id, client_person_id
  ON public.crm_case_conversations
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_case_conversation_identity_change();

INSERT INTO public.crm_case_conversation_participants (
  organization_id,
  conversation_id,
  case_id,
  client_id,
  client_person_id,
  joined_at,
  created_at,
  updated_at
)
SELECT
  conversation.organization_id,
  conversation.id,
  conversation.case_id,
  conversation.client_id,
  conversation.client_person_id,
  conversation.created_at,
  conversation.created_at,
  conversation.updated_at
FROM public.crm_case_conversations AS conversation
WHERE conversation.kind = 'direct'::text
ON CONFLICT (organization_id, conversation_id, client_person_id) DO NOTHING;

-- Client authors, receipt owners and uploaders may now be any durable
-- participant in the conversation, not only the legacy direct addressee.
ALTER TABLE public.crm_case_messages
  DROP CONSTRAINT crm_case_messages_client_sender_fkey,
  ADD CONSTRAINT crm_case_messages_client_sender_fkey FOREIGN KEY (
    organization_id,
    conversation_id,
    sender_client_person_id
  ) REFERENCES public.crm_case_conversation_participants (
    organization_id,
    conversation_id,
    client_person_id
  ) ON DELETE CASCADE;

ALTER TABLE public.crm_case_conversation_states
  DROP CONSTRAINT crm_case_conversation_states_client_participant_fkey,
  ADD CONSTRAINT crm_case_conversation_states_client_participant_fkey
    FOREIGN KEY (
      organization_id,
      conversation_id,
      participant_client_person_id
    ) REFERENCES public.crm_case_conversation_participants (
      organization_id,
      conversation_id,
      client_person_id
    ) ON DELETE CASCADE;

ALTER TABLE public.crm_case_message_attachments
  DROP CONSTRAINT crm_case_message_attachments_client_uploader_fkey,
  ADD CONSTRAINT crm_case_message_attachments_client_uploader_fkey
    FOREIGN KEY (
      organization_id,
      conversation_id,
      uploader_client_person_id
    ) REFERENCES public.crm_case_conversation_participants (
      organization_id,
      conversation_id,
    client_person_id
  ) ON DELETE CASCADE;

CREATE FUNCTION private.sync_case_group_conversation(
  p_organization_id uuid,
  p_case_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_conversation_id uuid;
  eligible_count integer := 0;
  created_conversation boolean := false;
  sync_time timestamp with time zone := statement_timestamp();
BEGIN
  IF p_organization_id IS NULL OR p_case_id IS NULL THEN
    RAISE EXCEPTION 'invalid_case_group_conversation_request'
      USING errcode = '22023';
  END IF;

  -- Serialize group creation and membership synchronization per case even
  -- before the group conversation row exists.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      concat('case-group-conversation:', p_organization_id, ':', p_case_id),
      0
    )
  );

  SELECT count(*)::integer
  INTO eligible_count
  FROM public.client_portal_case_grants AS portal_grant
  JOIN public.crm_client_people AS person
    ON person.organization_id = portal_grant.organization_id
   AND person.client_id = portal_grant.client_id
   AND person.id = portal_grant.client_person_id
  JOIN public.crm_clients AS client
    ON client.organization_id = portal_grant.organization_id
   AND client.id = portal_grant.client_id
  WHERE portal_grant.organization_id = p_organization_id
    AND portal_grant.case_id = p_case_id
    AND portal_grant.portal_enabled
    AND portal_grant.revoked_at IS NULL
    AND client.status_code <> 'anonymized'::text
    AND lower(btrim(person.role)) = ANY (
      ARRAY['primary'::text, 'co_borrower'::text, 'co_applicant'::text]
    )
    AND EXISTS (
      SELECT 1
      FROM public.client_account_links AS account_link
      WHERE account_link.organization_id = portal_grant.organization_id
        AND account_link.client_id = portal_grant.client_id
        AND account_link.client_person_id = portal_grant.client_person_id
        AND account_link.revoked_at IS NULL
        AND account_link.verification_method = 'email'::text
        AND person.email_normalized IS NOT NULL
        AND account_link.verified_contact_normalized = person.email_normalized
    );

  SELECT conversation.id
  INTO target_conversation_id
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.kind = 'group'::text
  FOR UPDATE;

  IF NOT FOUND AND eligible_count >= 2 THEN
    INSERT INTO public.crm_case_conversations (
      organization_id,
      case_id,
      kind,
      client_id,
      client_person_id
    ) VALUES (
      p_organization_id,
      p_case_id,
      'group'::text,
      NULL,
      NULL
    )
    RETURNING id INTO target_conversation_id;
    created_conversation := true;
  END IF;

  IF target_conversation_id IS NOT NULL THEN
    INSERT INTO public.crm_case_conversation_participants (
      organization_id,
      conversation_id,
      case_id,
      client_id,
      client_person_id,
      joined_at,
      removed_at
    )
    SELECT
      portal_grant.organization_id,
      target_conversation_id,
      portal_grant.case_id,
      portal_grant.client_id,
      portal_grant.client_person_id,
      sync_time,
      NULL
    FROM public.client_portal_case_grants AS portal_grant
    JOIN public.crm_client_people AS person
      ON person.organization_id = portal_grant.organization_id
     AND person.client_id = portal_grant.client_id
     AND person.id = portal_grant.client_person_id
    JOIN public.crm_clients AS client
      ON client.organization_id = portal_grant.organization_id
     AND client.id = portal_grant.client_id
    WHERE portal_grant.organization_id = p_organization_id
      AND portal_grant.case_id = p_case_id
      AND portal_grant.portal_enabled
      AND portal_grant.revoked_at IS NULL
      AND client.status_code <> 'anonymized'::text
      AND lower(btrim(person.role)) = ANY (
        ARRAY['primary'::text, 'co_borrower'::text, 'co_applicant'::text]
      )
      AND EXISTS (
        SELECT 1
        FROM public.client_account_links AS account_link
        WHERE account_link.organization_id = portal_grant.organization_id
          AND account_link.client_id = portal_grant.client_id
          AND account_link.client_person_id = portal_grant.client_person_id
          AND account_link.revoked_at IS NULL
          AND account_link.verification_method = 'email'::text
          AND person.email_normalized IS NOT NULL
          AND account_link.verified_contact_normalized = person.email_normalized
      )
    ON CONFLICT (organization_id, conversation_id, client_person_id)
    DO UPDATE SET
      case_id = EXCLUDED.case_id,
      client_id = EXCLUDED.client_id,
      removed_at = NULL;

    UPDATE public.crm_case_conversation_participants AS participant
    SET removed_at = coalesce(participant.removed_at, sync_time)
    WHERE participant.organization_id = p_organization_id
      AND participant.conversation_id = target_conversation_id
      AND participant.removed_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.client_portal_case_grants AS portal_grant
        JOIN public.crm_client_people AS person
          ON person.organization_id = portal_grant.organization_id
         AND person.client_id = portal_grant.client_id
         AND person.id = portal_grant.client_person_id
        JOIN public.crm_clients AS client
          ON client.organization_id = portal_grant.organization_id
         AND client.id = portal_grant.client_id
        WHERE portal_grant.organization_id = participant.organization_id
          AND portal_grant.case_id = participant.case_id
          AND portal_grant.client_id = participant.client_id
          AND portal_grant.client_person_id = participant.client_person_id
          AND portal_grant.portal_enabled
          AND portal_grant.revoked_at IS NULL
          AND client.status_code <> 'anonymized'::text
          AND lower(btrim(person.role)) = ANY (
            ARRAY['primary'::text, 'co_borrower'::text, 'co_applicant'::text]
          )
          AND EXISTS (
            SELECT 1
            FROM public.client_account_links AS account_link
            WHERE account_link.organization_id = portal_grant.organization_id
              AND account_link.client_id = portal_grant.client_id
              AND account_link.client_person_id = portal_grant.client_person_id
              AND account_link.revoked_at IS NULL
              AND account_link.verification_method = 'email'::text
              AND person.email_normalized IS NOT NULL
              AND account_link.verified_contact_normalized = person.email_normalized
          )
      );
  END IF;

  RETURN jsonb_build_object(
    'conversationId', CASE
      WHEN eligible_count >= 2 THEN target_conversation_id
      ELSE NULL
    END,
    'created', created_conversation,
    'participantCount', eligible_count
  );
END;
$$;

REVOKE ALL ON FUNCTION private.sync_case_group_conversation(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.ensure_case_group_conversation(
  p_organization_id uuid,
  p_case_id uuid
) RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT private.sync_case_group_conversation(
      p_organization_id,
      p_case_id
    );
  $$;

COMMENT ON FUNCTION public.ensure_case_group_conversation(uuid, uuid) IS
  'Synchronizes the shared borrower conversation. With fewer than two eligible borrowers it returns conversationId null, created false, and the current participantCount.';

REVOKE ALL ON FUNCTION public.ensure_case_group_conversation(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.ensure_case_group_conversation(uuid, uuid)
  TO openexpert_service;

CREATE FUNCTION private.sync_case_group_from_portal_grant()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM private.sync_case_group_conversation(
      NEW.organization_id,
      NEW.case_id
    );
  END IF;

  IF TG_OP <> 'INSERT' AND (
    TG_OP = 'DELETE'
    OR OLD.organization_id IS DISTINCT FROM NEW.organization_id
    OR OLD.case_id IS DISTINCT FROM NEW.case_id
  ) THEN
    PERFORM private.sync_case_group_conversation(
      OLD.organization_id,
      OLD.case_id
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_case_group_from_portal_grant()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER client_portal_case_grants_sync_group_conversation
  AFTER INSERT OR UPDATE OR DELETE ON public.client_portal_case_grants
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_case_group_from_portal_grant();

CREATE FUNCTION private.sync_case_group_from_account_link()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_grant record;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    FOR target_grant IN
      SELECT DISTINCT portal_grant.organization_id, portal_grant.case_id
      FROM public.client_portal_case_grants AS portal_grant
      WHERE portal_grant.organization_id = NEW.organization_id
        AND portal_grant.client_id = NEW.client_id
        AND portal_grant.client_person_id = NEW.client_person_id
    LOOP
      PERFORM private.sync_case_group_conversation(
        target_grant.organization_id,
        target_grant.case_id
      );
    END LOOP;
  END IF;

  IF TG_OP <> 'INSERT' THEN
    FOR target_grant IN
      SELECT DISTINCT portal_grant.organization_id, portal_grant.case_id
      FROM public.client_portal_case_grants AS portal_grant
      WHERE portal_grant.organization_id = OLD.organization_id
        AND portal_grant.client_id = OLD.client_id
        AND portal_grant.client_person_id = OLD.client_person_id
    LOOP
      PERFORM private.sync_case_group_conversation(
        target_grant.organization_id,
        target_grant.case_id
      );
    END LOOP;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_case_group_from_account_link()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER client_account_links_sync_group_conversation
  AFTER INSERT OR UPDATE OR DELETE ON public.client_account_links
  FOR EACH ROW
  EXECUTE FUNCTION private.sync_case_group_from_account_link();

-- Existing eligible cases receive their group thread without waiting for the
-- next grant/link mutation or an application read.
DO $$
DECLARE
  target_case record;
BEGIN
  FOR target_case IN
    SELECT portal_grant.organization_id, portal_grant.case_id
    FROM public.client_portal_case_grants AS portal_grant
    JOIN public.crm_client_people AS person
      ON person.organization_id = portal_grant.organization_id
     AND person.client_id = portal_grant.client_id
     AND person.id = portal_grant.client_person_id
    JOIN public.crm_clients AS client
      ON client.organization_id = portal_grant.organization_id
     AND client.id = portal_grant.client_id
    WHERE portal_grant.portal_enabled
      AND portal_grant.revoked_at IS NULL
      AND client.status_code <> 'anonymized'::text
      AND lower(btrim(person.role)) = ANY (
        ARRAY['primary'::text, 'co_borrower'::text, 'co_applicant'::text]
      )
      AND EXISTS (
        SELECT 1
        FROM public.client_account_links AS account_link
        WHERE account_link.organization_id = portal_grant.organization_id
          AND account_link.client_id = portal_grant.client_id
          AND account_link.client_person_id = portal_grant.client_person_id
          AND account_link.revoked_at IS NULL
          AND account_link.verification_method = 'email'::text
          AND person.email_normalized IS NOT NULL
          AND account_link.verified_contact_normalized = person.email_normalized
      )
    GROUP BY portal_grant.organization_id, portal_grant.case_id
    HAVING count(*) >= 2
  LOOP
    PERFORM private.sync_case_group_conversation(
      target_case.organization_id,
      target_case.case_id
    );
  END LOOP;
END;
$$;

CREATE FUNCTION private.require_client_case_group_access(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid
) RETURNS public.crm_case_conversations
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  sync_result jsonb;
  target_conversation public.crm_case_conversations%rowtype;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_conversation_id IS NULL
    OR p_client_person_id IS NULL
    OR p_auth_user_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_case_group_conversation_request'
      USING errcode = '22023';
  END IF;

  sync_result := private.sync_case_group_conversation(
    p_organization_id,
    p_case_id
  );

  IF coalesce((sync_result ->> 'participantCount')::integer, 0) < 2
    OR nullif(sync_result ->> 'conversationId', '')::uuid
      IS DISTINCT FROM p_conversation_id
  THEN
    RAISE EXCEPTION 'case_group_conversation_not_available'
      USING errcode = 'P0002';
  END IF;

  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  JOIN public.crm_case_conversation_participants AS participant
    ON participant.organization_id = conversation.organization_id
   AND participant.conversation_id = conversation.id
   AND participant.case_id = conversation.case_id
   AND participant.client_person_id = p_client_person_id
   AND participant.removed_at IS NULL
  JOIN public.client_portal_case_grants AS portal_grant
    ON portal_grant.organization_id = participant.organization_id
   AND portal_grant.case_id = participant.case_id
   AND portal_grant.client_id = participant.client_id
   AND portal_grant.client_person_id = participant.client_person_id
   AND portal_grant.portal_enabled
   AND portal_grant.revoked_at IS NULL
  JOIN public.crm_client_people AS person
    ON person.organization_id = participant.organization_id
   AND person.client_id = participant.client_id
   AND person.id = participant.client_person_id
  JOIN public.client_account_links AS account_link
    ON account_link.organization_id = participant.organization_id
   AND account_link.client_id = participant.client_id
   AND account_link.client_person_id = participant.client_person_id
   AND account_link.auth_user_id = p_auth_user_id
   AND account_link.revoked_at IS NULL
   AND account_link.verification_method = 'email'::text
   AND person.email_normalized IS NOT NULL
   AND account_link.verified_contact_normalized = person.email_normalized
  JOIN public.crm_clients AS client
    ON client.organization_id = participant.organization_id
   AND client.id = participant.client_id
   AND client.status_code <> 'anonymized'::text
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.id = p_conversation_id
    AND conversation.kind = 'group'::text
    AND lower(btrim(person.role)) = ANY (
      ARRAY['primary'::text, 'co_borrower'::text, 'co_applicant'::text]
    )
  FOR KEY SHARE OF participant, portal_grant, account_link, client;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_case_message_access_denied'
      USING errcode = '42501';
  END IF;

  RETURN target_conversation;
END;
$$;

REVOKE ALL ON FUNCTION private.require_client_case_group_access(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.require_staff_case_group_access(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_actor_user_id uuid
) RETURNS public.crm_case_conversations
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  sync_result jsonb;
  target_conversation public.crm_case_conversations%rowtype;
  actor_role text;
  target_owner_user_id uuid;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_conversation_id IS NULL
    OR p_actor_user_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_case_group_conversation_request'
      USING errcode = '22023';
  END IF;

  SELECT crm_case.owner_user_id, membership.role
  INTO target_owner_user_id, actor_role
  FROM public.crm_cases AS crm_case
  JOIN public.organization_memberships AS membership
    ON membership.organization_id = crm_case.organization_id
   AND membership.user_id = p_actor_user_id
  WHERE crm_case.organization_id = p_organization_id
    AND crm_case.id = p_case_id
  FOR KEY SHARE OF crm_case, membership;

  IF NOT FOUND
    OR (
      p_actor_user_id IS DISTINCT FROM target_owner_user_id
      AND actor_role <> 'admin'::text
    )
  THEN
    RAISE EXCEPTION 'staff_case_message_access_denied'
      USING errcode = '42501';
  END IF;

  sync_result := private.sync_case_group_conversation(
    p_organization_id,
    p_case_id
  );

  IF coalesce((sync_result ->> 'participantCount')::integer, 0) < 2
    OR nullif(sync_result ->> 'conversationId', '')::uuid
      IS DISTINCT FROM p_conversation_id
  THEN
    RAISE EXCEPTION 'case_group_conversation_not_available'
      USING errcode = 'P0002';
  END IF;

  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.id = p_conversation_id
    AND conversation.kind = 'group'::text;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_group_conversation_not_available'
      USING errcode = 'P0002';
  END IF;

  RETURN target_conversation;
END;
$$;

REVOKE ALL ON FUNCTION private.require_staff_case_group_access(
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- The original helper explicitly compared a client receipt owner with the
-- direct addressee. Keep its monotonic/outbox behavior while accepting any
-- active participant in a group conversation.
CREATE OR REPLACE FUNCTION private.update_case_message_receipt(
  p_conversation_id uuid,
  p_participant_kind text,
  p_participant_user_id uuid,
  p_participant_client_person_id uuid,
  p_delivered_through_sequence bigint,
  p_read_through_sequence bigint
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_conversation public.crm_case_conversations%rowtype;
  target_state public.crm_case_conversation_states%rowtype;
  target_outbox public.crm_message_outbox%rowtype;
  state_exists boolean := false;
  old_delivered_sequence bigint := 0;
  old_read_sequence bigint := 0;
  next_delivered_sequence bigint;
  next_read_sequence bigint;
  receipt_time timestamp with time zone := statement_timestamp();
  receipt_changed boolean := false;
BEGIN
  IF p_conversation_id IS NULL
    OR (p_delivered_through_sequence IS NULL AND p_read_through_sequence IS NULL)
    OR coalesce(p_delivered_through_sequence, 0) < 0
    OR coalesce(p_read_through_sequence, 0) < 0
    OR p_participant_kind <> ALL (ARRAY['staff'::text, 'client'::text])
    OR (
      p_participant_kind = 'staff'::text
      AND (
        p_participant_user_id IS NULL
        OR p_participant_client_person_id IS NOT NULL
      )
    )
    OR (
      p_participant_kind = 'client'::text
      AND (
        p_participant_user_id IS NOT NULL
        OR p_participant_client_person_id IS NULL
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_case_message_receipt_request'
      USING errcode = '22023';
  END IF;

  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.id = p_conversation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = 'P0002';
  END IF;

  IF coalesce(p_delivered_through_sequence, 0)
      > target_conversation.last_message_sequence
    OR coalesce(p_read_through_sequence, 0)
      > target_conversation.last_message_sequence
  THEN
    RAISE EXCEPTION 'case_message_receipt_beyond_conversation'
      USING errcode = '23514';
  END IF;

  IF p_participant_kind = 'staff'::text THEN
    SELECT state.*
    INTO target_state
    FROM public.crm_case_conversation_states AS state
    WHERE state.organization_id = target_conversation.organization_id
      AND state.conversation_id = target_conversation.id
      AND state.participant_kind = 'staff'::text
      AND state.participant_user_id = p_participant_user_id
    FOR UPDATE;
  ELSE
    IF (
      target_conversation.kind = 'direct'::text
      AND p_participant_client_person_id
        IS DISTINCT FROM target_conversation.client_person_id
    ) OR (
      target_conversation.kind = 'group'::text
      AND NOT EXISTS (
        SELECT 1
        FROM public.crm_case_conversation_participants AS participant
        WHERE participant.organization_id = target_conversation.organization_id
          AND participant.conversation_id = target_conversation.id
          AND participant.client_person_id = p_participant_client_person_id
          AND participant.removed_at IS NULL
      )
    ) THEN
      RAISE EXCEPTION 'case_message_receipt_participant_mismatch'
        USING errcode = '42501';
    END IF;

    SELECT state.*
    INTO target_state
    FROM public.crm_case_conversation_states AS state
    WHERE state.organization_id = target_conversation.organization_id
      AND state.conversation_id = target_conversation.id
      AND state.participant_kind = 'client'::text
      AND state.participant_client_person_id = p_participant_client_person_id
    FOR UPDATE;
  END IF;

  state_exists := FOUND;
  IF state_exists THEN
    old_delivered_sequence := target_state.delivered_through_sequence;
    old_read_sequence := target_state.read_through_sequence;
  END IF;

  next_read_sequence := greatest(
    old_read_sequence,
    coalesce(p_read_through_sequence, old_read_sequence)
  );
  next_delivered_sequence := greatest(
    old_delivered_sequence,
    coalesce(p_delivered_through_sequence, old_delivered_sequence),
    next_read_sequence
  );
  receipt_changed :=
    next_delivered_sequence > old_delivered_sequence
    OR next_read_sequence > old_read_sequence;

  IF NOT state_exists THEN
    INSERT INTO public.crm_case_conversation_states (
      organization_id,
      conversation_id,
      participant_kind,
      participant_user_id,
      participant_client_person_id,
      delivered_through_sequence,
      read_through_sequence,
      delivered_at,
      read_at
    ) VALUES (
      target_conversation.organization_id,
      target_conversation.id,
      p_participant_kind,
      p_participant_user_id,
      p_participant_client_person_id,
      next_delivered_sequence,
      next_read_sequence,
      CASE WHEN next_delivered_sequence > 0 THEN receipt_time END,
      CASE WHEN next_read_sequence > 0 THEN receipt_time END
    )
    RETURNING * INTO target_state;
  ELSIF receipt_changed THEN
    UPDATE public.crm_case_conversation_states AS state
    SET
      delivered_through_sequence = next_delivered_sequence,
      read_through_sequence = next_read_sequence,
      delivered_at = CASE
        WHEN next_delivered_sequence > old_delivered_sequence THEN receipt_time
        ELSE state.delivered_at
      END,
      read_at = CASE
        WHEN next_read_sequence > old_read_sequence THEN receipt_time
        ELSE state.read_at
      END
    WHERE state.id = target_state.id
    RETURNING * INTO target_state;
  END IF;

  IF receipt_changed THEN
    INSERT INTO public.crm_message_outbox (
      organization_id,
      conversation_id,
      message_id,
      event_type,
      payload
    ) VALUES (
      target_conversation.organization_id,
      target_conversation.id,
      NULL,
      'receipt.updated'::text,
      jsonb_build_object(
        'conversationId', target_conversation.id,
        'participantKind', target_state.participant_kind,
        'participantUserId', target_state.participant_user_id,
        'participantClientPersonId', target_state.participant_client_person_id,
        'deliveredThroughSequence', target_state.delivered_through_sequence,
        'readThroughSequence', target_state.read_through_sequence
      )
    )
    RETURNING * INTO target_outbox;
  END IF;

  RETURN jsonb_build_object(
    'conversationId', target_state.conversation_id,
    'participantKind', target_state.participant_kind,
    'participantUserId', target_state.participant_user_id,
    'participantClientPersonId', target_state.participant_client_person_id,
    'deliveredThroughSequence', target_state.delivered_through_sequence,
    'readThroughSequence', target_state.read_through_sequence,
    'deliveredAt', target_state.delivered_at,
    'readAt', target_state.read_at,
    'updatedAt', target_state.updated_at,
    'outboxId', target_outbox.id,
    'changed', receipt_changed
  );
END;
$$;

REVOKE ALL ON FUNCTION private.update_case_message_receipt(
  uuid,
  text,
  uuid,
  uuid,
  bigint,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.send_client_case_group_message_v1(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_client_message_id uuid,
  p_reply_to_message_id uuid,
  p_body text,
  p_attachment_ids uuid[]
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_client_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_client_person_id,
    p_auth_user_id
  );

  RETURN private.finalize_case_message_reply(
    private.append_case_message_v2(
      p_conversation_id,
      p_client_message_id,
      'client'::text,
      NULL,
      p_client_person_id,
      p_auth_user_id,
      p_body,
      p_attachment_ids
    ),
    p_reply_to_message_id
  );
END;
$$;

COMMENT ON FUNCTION public.send_client_case_group_message_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) IS
  'Sends an idempotent group message after revalidating the caller grant, account link, borrower role and active conversation membership.';

REVOKE ALL ON FUNCTION public.send_client_case_group_message_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_client_case_group_message_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) TO openexpert_service;

CREATE FUNCTION public.send_staff_case_group_message_v1(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_client_message_id uuid,
  p_reply_to_message_id uuid,
  p_body text,
  p_attachment_ids uuid[]
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_staff_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_actor_user_id
  );

  RETURN private.finalize_case_message_reply(
    private.append_case_message_v2(
      p_conversation_id,
      p_client_message_id,
      'staff'::text,
      p_actor_user_id,
      NULL,
      NULL,
      p_body,
      p_attachment_ids
    ),
    p_reply_to_message_id
  );
END;
$$;

COMMENT ON FUNCTION public.send_staff_case_group_message_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) IS
  'Lets the case owner or an organization admin send an attachment-aware group message with an optional same-thread reply.';

REVOKE ALL ON FUNCTION public.send_staff_case_group_message_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_staff_case_group_message_v1(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) TO openexpert_service;

CREATE FUNCTION public.reserve_client_case_group_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_client_message_id uuid,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_client_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_client_person_id,
    p_auth_user_id
  );

  RETURN private.reserve_case_message_attachment(
    p_conversation_id,
    p_client_message_id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_auth_user_id,
    p_file_name,
    p_content_type,
    p_size_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_client_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.reserve_client_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) TO openexpert_service;

CREATE FUNCTION public.reserve_staff_case_group_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_client_message_id uuid,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_staff_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_actor_user_id
  );

  RETURN private.reserve_case_message_attachment(
    p_conversation_id,
    p_client_message_id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    NULL,
    p_file_name,
    p_content_type,
    p_size_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_staff_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.reserve_staff_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) TO openexpert_service;

CREATE FUNCTION public.discard_client_case_group_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_attachment_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_client_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_client_person_id,
    p_auth_user_id
  );

  RETURN private.discard_case_message_attachment(
    p_conversation_id,
    p_attachment_id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_auth_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.discard_client_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.discard_client_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) TO openexpert_service;

CREATE FUNCTION public.discard_staff_case_group_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_attachment_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_staff_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_actor_user_id
  );

  RETURN private.discard_case_message_attachment(
    p_conversation_id,
    p_attachment_id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.discard_staff_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.discard_staff_case_group_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) TO openexpert_service;

CREATE FUNCTION public.update_client_case_group_message_receipt(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_delivered_through_sequence bigint DEFAULT NULL,
  p_read_through_sequence bigint DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_client_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_client_person_id,
    p_auth_user_id
  );

  RETURN private.update_case_message_receipt(
    p_conversation_id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_delivered_through_sequence,
    p_read_through_sequence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_client_case_group_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.update_client_case_group_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) TO openexpert_service;

CREATE FUNCTION public.update_staff_case_group_message_receipt(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_delivered_through_sequence bigint DEFAULT NULL,
  p_read_through_sequence bigint DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.require_staff_case_group_access(
    p_organization_id,
    p_case_id,
    p_conversation_id,
    p_actor_user_id
  );

  RETURN private.update_case_message_receipt(
    p_conversation_id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    p_delivered_through_sequence,
    p_read_through_sequence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_staff_case_group_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.update_staff_case_group_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) TO openexpert_service;

-- Reply previews now identify the concrete client author in a group thread.
-- The additive key is also returned for direct replies and does not change the
-- existing v3 response contract.
CREATE OR REPLACE FUNCTION private.case_message_reply_json(
  p_message_id uuid
) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT jsonb_build_object(
      'id', message.id,
      'sequence', message.sequence,
      'senderKind', message.sender_kind,
      'senderClientPersonId', message.sender_client_person_id,
      'body', message.body,
      'attachments', private.case_message_attachments_json(message.id)
    )
    FROM public.crm_case_messages AS message
    WHERE message.id = p_message_id;
  $$;

REVOKE ALL ON FUNCTION private.case_message_reply_json(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- A deletion job can outlive the attachment, conversation and even the
-- client metadata that caused it. Snapshot every affected client in a durable
-- many-to-many relation instead of relying on the queue's legacy single
-- client_id column.
CREATE TABLE public.crm_case_message_attachment_blob_deletion_clients (
  deletion_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_message_attachment_blob_deletion_clients_pkey
    PRIMARY KEY (deletion_id, client_id),
  CONSTRAINT crm_case_message_attachment_blob_deletion_clients_deletion_fkey
    FOREIGN KEY (deletion_id)
    REFERENCES public.crm_case_message_attachment_blob_deletions (id)
    ON DELETE CASCADE
);

COMMENT ON TABLE public.crm_case_message_attachment_blob_deletion_clients IS
  'Durable privacy-subject snapshot for pending group/direct message-attachment Blob deletion jobs.';

CREATE INDEX crm_case_message_attachment_blob_deletion_clients_client_idx
  ON public.crm_case_message_attachment_blob_deletion_clients (
    organization_id,
    client_id,
    deletion_id
  );

INSERT INTO public.crm_case_message_attachment_blob_deletion_clients (
  deletion_id,
  organization_id,
  client_id
)
SELECT deletion.id, deletion.organization_id, deletion.client_id
FROM public.crm_case_message_attachment_blob_deletions AS deletion
WHERE deletion.organization_id IS NOT NULL
  AND deletion.client_id IS NOT NULL
ON CONFLICT (deletion_id, client_id) DO NOTHING;

-- Lock every client status covered by the conversation before accepting a
-- message or upload. NOWAIT deliberately turns the inverse lock order of a
-- concurrent anonymization (client row -> conversation sync) into a retryable
-- serialization error instead of a deadlock. Staff group writes are checked
-- against every historical participant, not only client-authored writes. A
-- thread that ever included an anonymized client stays frozen; a removed
-- participant cannot disappear from the write barrier while anonymization is
-- still running.
CREATE OR REPLACE FUNCTION private.reject_anonymized_client_message_write()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  row_data jsonb := to_jsonb(NEW);
  actor_kind text := coalesce(
    row_data ->> 'sender_kind',
    row_data ->> 'uploader_kind'
  );
  actor_client_person_id uuid := nullif(
    coalesce(
      row_data ->> 'sender_client_person_id',
      row_data ->> 'uploader_client_person_id'
    ),
    ''
  )::uuid;
  actor_auth_user_id uuid := nullif(
    coalesce(
      row_data ->> 'sender_auth_user_id',
      row_data ->> 'uploader_auth_user_id'
    ),
    ''
  )::uuid;
  target_conversation public.crm_case_conversations%rowtype;
  target_client_status text;
  historical_group_client_found boolean := false;
  actor_membership_found boolean := false;
BEGIN
  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = NEW.organization_id
    AND conversation.id = NEW.conversation_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = '23503';
  END IF;

  IF target_conversation.kind = 'direct'::text THEN
    BEGIN
      SELECT client.status_code
      INTO target_client_status
      FROM public.crm_clients AS client
      WHERE client.organization_id = target_conversation.organization_id
        AND client.id = target_conversation.client_id
      FOR UPDATE NOWAIT;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION 'case_message_client_state_busy'
          USING errcode = '40001';
    END;

    IF target_client_status = 'anonymized'::text THEN
      RAISE EXCEPTION 'case_message_client_anonymized'
        USING errcode = '55000';
    END IF;

    RETURN NEW;
  END IF;

  BEGIN
    PERFORM client.id
    FROM public.crm_clients AS client
    WHERE client.organization_id = target_conversation.organization_id
      AND client.id IN (
        SELECT participant.client_id
        FROM public.crm_case_conversation_participants AS participant
        WHERE participant.organization_id = target_conversation.organization_id
          AND participant.conversation_id = target_conversation.id
      )
    ORDER BY client.id
    FOR UPDATE OF client NOWAIT;
    historical_group_client_found := FOUND;
  EXCEPTION
    WHEN lock_not_available THEN
      RAISE EXCEPTION 'case_message_client_state_busy'
        USING errcode = '40001';
  END;

  IF NOT historical_group_client_found THEN
    RAISE EXCEPTION 'case_group_conversation_not_available'
      USING errcode = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_case_conversation_participants AS participant
    JOIN public.crm_clients AS client
      ON client.organization_id = participant.organization_id
     AND client.id = participant.client_id
    WHERE participant.organization_id = target_conversation.organization_id
      AND participant.conversation_id = target_conversation.id
      AND client.status_code = 'anonymized'::text
  ) THEN
    RAISE EXCEPTION 'case_message_client_anonymized'
      USING errcode = '55000';
  END IF;

  IF actor_kind = 'client'::text THEN
    BEGIN
      PERFORM 1
      FROM public.crm_case_conversation_participants AS participant
      JOIN public.client_portal_case_grants AS portal_grant
        ON portal_grant.organization_id = participant.organization_id
       AND portal_grant.case_id = participant.case_id
       AND portal_grant.client_id = participant.client_id
       AND portal_grant.client_person_id = participant.client_person_id
       AND portal_grant.portal_enabled
       AND portal_grant.revoked_at IS NULL
      JOIN public.crm_client_people AS person
        ON person.organization_id = participant.organization_id
       AND person.client_id = participant.client_id
       AND person.id = participant.client_person_id
      JOIN public.client_account_links AS account_link
        ON account_link.organization_id = participant.organization_id
       AND account_link.client_id = participant.client_id
       AND account_link.client_person_id = participant.client_person_id
       AND account_link.auth_user_id = actor_auth_user_id
       AND account_link.revoked_at IS NULL
       AND account_link.verification_method = 'email'::text
       AND person.email_normalized IS NOT NULL
       AND account_link.verified_contact_normalized = person.email_normalized
      WHERE participant.organization_id = target_conversation.organization_id
        AND participant.conversation_id = target_conversation.id
        AND participant.client_person_id = actor_client_person_id
        AND participant.removed_at IS NULL
        AND lower(btrim(person.role)) = ANY (
          ARRAY['primary'::text, 'co_borrower'::text, 'co_applicant'::text]
        )
      FOR UPDATE OF participant, portal_grant, person, account_link NOWAIT;
      actor_membership_found := FOUND;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION 'case_message_participant_state_busy'
          USING errcode = '40001';
    END;

    IF NOT actor_membership_found THEN
      RAISE EXCEPTION 'case_group_participant_not_active'
        USING errcode = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_anonymized_client_message_write()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Snapshot every privacy subject before attachment/conversation metadata
-- disappears. The queue's legacy client_id remains populated for direct and
-- client-authored group uploads, while the bridge above is authoritative and
-- includes every historical client participant, including for staff uploads.
CREATE OR REPLACE FUNCTION private.enqueue_case_message_attachment_blob_deletion()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_conversation public.crm_case_conversations%rowtype;
  target_deletion_id uuid;
  target_client_id uuid;
  safe_delete_time timestamp with time zone := greatest(
    statement_timestamp(),
    OLD.created_at + interval '30 minutes'
  );
BEGIN
  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = OLD.organization_id
    AND conversation.id = OLD.conversation_id;

  IF FOUND THEN
    IF target_conversation.kind = 'direct'::text THEN
      target_client_id := target_conversation.client_id;
    ELSE
      SELECT participant.client_id
      INTO target_client_id
      FROM public.crm_case_conversation_participants AS participant
      WHERE participant.organization_id = OLD.organization_id
        AND participant.conversation_id = OLD.conversation_id
        AND participant.client_person_id = OLD.uploader_client_person_id;

      IF NOT EXISTS (
        SELECT 1
        FROM public.crm_case_conversation_participants AS participant
        WHERE participant.organization_id = OLD.organization_id
          AND participant.conversation_id = OLD.conversation_id
      ) THEN
        RAISE EXCEPTION 'case_group_attachment_privacy_subject_missing'
          USING errcode = '23514';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.crm_case_message_attachment_blob_deletions (
    storage_path,
    available_at,
    organization_id,
    conversation_id,
    client_id,
    attachment_id
  ) VALUES (
    OLD.storage_path,
    safe_delete_time,
    OLD.organization_id,
    OLD.conversation_id,
    target_client_id,
    OLD.id
  )
  ON CONFLICT (storage_path) DO UPDATE
  SET
    available_at = greatest(
      crm_case_message_attachment_blob_deletions.available_at,
      EXCLUDED.available_at
    ),
    organization_id = coalesce(
      crm_case_message_attachment_blob_deletions.organization_id,
      EXCLUDED.organization_id
    ),
    conversation_id = coalesce(
      crm_case_message_attachment_blob_deletions.conversation_id,
      EXCLUDED.conversation_id
    ),
    client_id = coalesce(
      crm_case_message_attachment_blob_deletions.client_id,
      EXCLUDED.client_id
    ),
    attachment_id = coalesce(
      crm_case_message_attachment_blob_deletions.attachment_id,
      EXCLUDED.attachment_id
    )
  RETURNING id INTO target_deletion_id;

  IF target_conversation.id IS NOT NULL THEN
    IF target_conversation.kind = 'direct'::text THEN
      INSERT INTO public.crm_case_message_attachment_blob_deletion_clients (
        deletion_id,
        organization_id,
        client_id
      ) VALUES (
        target_deletion_id,
        OLD.organization_id,
        target_conversation.client_id
      )
      ON CONFLICT (deletion_id, client_id) DO NOTHING;
    ELSE
      INSERT INTO public.crm_case_message_attachment_blob_deletion_clients (
        deletion_id,
        organization_id,
        client_id
      )
      SELECT DISTINCT
        target_deletion_id,
        participant.organization_id,
        participant.client_id
      FROM public.crm_case_conversation_participants AS participant
      WHERE participant.organization_id = OLD.organization_id
        AND participant.conversation_id = OLD.conversation_id
      ON CONFLICT (deletion_id, client_id) DO NOTHING;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION private.enqueue_conversation_attachment_blob_deletions()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_attachment public.crm_case_message_attachments%rowtype;
  target_deletion_id uuid;
  target_client_id uuid;
BEGIN
  IF OLD.kind = 'group'::text AND NOT EXISTS (
    SELECT 1
    FROM public.crm_case_conversation_participants AS participant
    WHERE participant.organization_id = OLD.organization_id
      AND participant.conversation_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'case_group_attachment_privacy_subject_missing'
      USING errcode = '23514';
  END IF;

  FOR target_attachment IN
    SELECT attachment.*
    FROM public.crm_case_message_attachments AS attachment
    WHERE attachment.organization_id = OLD.organization_id
      AND attachment.conversation_id = OLD.id
    ORDER BY attachment.id
  LOOP
    target_client_id := OLD.client_id;
    IF OLD.kind = 'group'::text THEN
      SELECT participant.client_id
      INTO target_client_id
      FROM public.crm_case_conversation_participants AS participant
      WHERE participant.organization_id = target_attachment.organization_id
        AND participant.conversation_id = target_attachment.conversation_id
        AND participant.client_person_id =
          target_attachment.uploader_client_person_id;
    END IF;

    INSERT INTO public.crm_case_message_attachment_blob_deletions (
      storage_path,
      available_at,
      organization_id,
      conversation_id,
      client_id,
      attachment_id
    ) VALUES (
      target_attachment.storage_path,
      greatest(
        statement_timestamp(),
        target_attachment.created_at + interval '30 minutes'
      ),
      target_attachment.organization_id,
      target_attachment.conversation_id,
      target_client_id,
      target_attachment.id
    )
    ON CONFLICT (storage_path) DO UPDATE
    SET
      available_at = greatest(
        crm_case_message_attachment_blob_deletions.available_at,
        EXCLUDED.available_at
      ),
      organization_id = coalesce(
        crm_case_message_attachment_blob_deletions.organization_id,
        EXCLUDED.organization_id
      ),
      conversation_id = coalesce(
        crm_case_message_attachment_blob_deletions.conversation_id,
        EXCLUDED.conversation_id
      ),
      client_id = coalesce(
        crm_case_message_attachment_blob_deletions.client_id,
        EXCLUDED.client_id
      ),
      attachment_id = coalesce(
        crm_case_message_attachment_blob_deletions.attachment_id,
        EXCLUDED.attachment_id
      )
    RETURNING id INTO target_deletion_id;

    IF OLD.kind = 'direct'::text THEN
      INSERT INTO public.crm_case_message_attachment_blob_deletion_clients (
        deletion_id,
        organization_id,
        client_id
      ) VALUES (
        target_deletion_id,
        OLD.organization_id,
        OLD.client_id
      )
      ON CONFLICT (deletion_id, client_id) DO NOTHING;
    ELSE
      INSERT INTO public.crm_case_message_attachment_blob_deletion_clients (
        deletion_id,
        organization_id,
        client_id
      )
      SELECT DISTINCT
        target_deletion_id,
        participant.organization_id,
        participant.client_id
      FROM public.crm_case_conversation_participants AS participant
      WHERE participant.organization_id = OLD.organization_id
        AND participant.conversation_id = OLD.id
      ON CONFLICT (deletion_id, client_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_conversation_attachment_blob_deletions()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE OR REPLACE FUNCTION private.require_case_message_retention_review()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  attachment_count integer := 0;
  pending_blob_deletion_count integer := 0;
BEGIN
  IF NEW.status = 'completed'::text
    AND OLD.status IS DISTINCT FROM 'completed'::text
  THEN
    PERFORM conversation.id
    FROM public.crm_case_conversations AS conversation
    WHERE conversation.organization_id = NEW.organization_id
      AND (
        (
          conversation.kind = 'direct'::text
          AND conversation.client_id = NEW.client_id
        )
        OR (
          conversation.kind = 'group'::text
          AND EXISTS (
            SELECT 1
            FROM public.crm_case_conversation_participants AS participant
            WHERE participant.organization_id = conversation.organization_id
              AND participant.conversation_id = conversation.id
              AND participant.client_id = NEW.client_id
          )
        )
      )
    ORDER BY conversation.id
    FOR UPDATE OF conversation;

    SELECT count(*)::integer
    INTO attachment_count
    FROM public.crm_case_message_attachments AS attachment
    JOIN public.crm_case_conversations AS conversation
      ON conversation.organization_id = attachment.organization_id
     AND conversation.id = attachment.conversation_id
    WHERE conversation.organization_id = NEW.organization_id
      AND (
        (
          conversation.kind = 'direct'::text
          AND conversation.client_id = NEW.client_id
        )
        OR (
          conversation.kind = 'group'::text
          AND EXISTS (
            SELECT 1
            FROM public.crm_case_conversation_participants AS participant
            WHERE participant.organization_id = conversation.organization_id
              AND participant.conversation_id = conversation.id
              AND participant.client_id = NEW.client_id
          )
        )
      );

    SELECT count(*)::integer
    INTO pending_blob_deletion_count
    FROM public.crm_case_message_attachment_blob_deletion_clients AS subject
    WHERE subject.organization_id = NEW.organization_id
      AND subject.client_id = NEW.client_id;

    IF attachment_count > 0 OR pending_blob_deletion_count > 0 THEN
      RAISE EXCEPTION 'anonymization_documents_require_manual_retention_review'
        USING
          errcode = '23514',
          detail = jsonb_build_object(
            'messageAttachmentCount', attachment_count,
            'pendingMessageAttachmentDeletionCount',
              pending_blob_deletion_count
          )::text;
    END IF;

    UPDATE public.crm_case_messages AS message
    SET
      body = 'Wiadomość zanonimizowana.',
      sender_auth_user_id = NULL
    FROM public.crm_case_conversations AS conversation
    WHERE conversation.organization_id = NEW.organization_id
      AND message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id
      AND (
        (
          conversation.kind = 'direct'::text
          AND conversation.client_id = NEW.client_id
        )
        OR (
          conversation.kind = 'group'::text
          AND EXISTS (
            SELECT 1
            FROM public.crm_case_conversation_participants AS participant
            WHERE participant.organization_id = conversation.organization_id
              AND participant.conversation_id = conversation.id
              AND participant.client_id = NEW.client_id
          )
        )
      );
  END IF;

  RETURN NEW;
END;
$$;

-- The deletion-subject bridge is internal retention metadata. It has no
-- application policy or grant; owner-executed SECURITY DEFINER routines are
-- its only access path.
ALTER TABLE public.crm_case_message_attachment_blob_deletion_clients
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_case_message_attachment_blob_deletion_clients
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Participant metadata is case-scoped like conversations themselves. Portal
-- reads continue through the service role; authenticated table reads remain
-- limited to the case owner or an organization administrator.
ALTER TABLE public.crm_case_conversation_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all
  ON public.crm_case_conversation_participants
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY crm_case_conversation_participants_owner_or_admin_read
  ON public.crm_case_conversation_participants
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_cases AS crm_case
      WHERE crm_case.organization_id =
          crm_case_conversation_participants.organization_id
        AND crm_case.id = crm_case_conversation_participants.case_id
        AND (
          crm_case.owner_user_id = (SELECT app.current_user_id())
          OR private.is_organization_admin(
            crm_case_conversation_participants.organization_id
          )
        )
    )
  );

REVOKE ALL ON TABLE public.crm_case_conversation_participants
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT ON TABLE public.crm_case_conversation_participants
  TO openexpert_service;
GRANT SELECT ON TABLE public.crm_case_conversation_participants
  TO authenticated;
