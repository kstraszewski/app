-- Durable, conversation-scoped replies for case messaging. Existing v2 RPCs
-- stay in place for rolling deployments; v3 adds the reply target without
-- duplicating the attachment-aware append transaction.

ALTER TABLE public.crm_case_messages
  ADD COLUMN reply_to_message_id uuid,
  ADD CONSTRAINT crm_case_messages_conversation_id_id_key
    UNIQUE (conversation_id, id),
  ADD CONSTRAINT crm_case_messages_reply_not_self_check CHECK (
    reply_to_message_id IS NULL OR reply_to_message_id <> id
  ),
  ADD CONSTRAINT crm_case_messages_reply_to_message_fkey FOREIGN KEY (
    conversation_id,
    reply_to_message_id
  ) REFERENCES public.crm_case_messages (
    conversation_id,
    id
  );

COMMENT ON COLUMN public.crm_case_messages.reply_to_message_id IS
  'Optional earlier message in the same conversation that this message answers.';

CREATE INDEX crm_case_messages_reply_to_message_idx
  ON public.crm_case_messages (conversation_id, reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE FUNCTION private.validate_case_message_reply()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  replied_sequence bigint;
BEGIN
  IF NEW.reply_to_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT message.sequence
  INTO replied_sequence
  FROM public.crm_case_messages AS message
  WHERE message.conversation_id = NEW.conversation_id
    AND message.id = NEW.reply_to_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_message_reply_unavailable'
      USING errcode = 'P0002';
  END IF;

  IF replied_sequence >= NEW.sequence THEN
    RAISE EXCEPTION 'case_message_reply_must_precede_message'
      USING errcode = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_case_message_reply()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_messages_validate_reply
  BEFORE INSERT OR UPDATE OF conversation_id, sequence, reply_to_message_id
  ON public.crm_case_messages
  FOR EACH ROW
  EXECUTE FUNCTION private.validate_case_message_reply();

CREATE FUNCTION private.case_message_reply_json(
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
      'body', message.body,
      'attachments', private.case_message_attachments_json(message.id)
    )
    FROM public.crm_case_messages AS message
    WHERE message.id = p_message_id;
  $$;

REVOKE ALL ON FUNCTION private.case_message_reply_json(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.finalize_case_message_reply(
  p_result jsonb,
  p_reply_to_message_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_message public.crm_case_messages%rowtype;
  target_message_id uuid;
  created_message boolean;
  reply_json jsonb;
BEGIN
  target_message_id := nullif(p_result #>> '{message,id}', '')::uuid;
  created_message := coalesce((p_result ->> 'created')::boolean, false);

  IF target_message_id IS NULL THEN
    RAISE EXCEPTION 'invalid_case_message_result'
      USING errcode = '22023';
  END IF;

  SELECT message.*
  INTO target_message
  FROM public.crm_case_messages AS message
  WHERE message.id = target_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_message_not_found'
      USING errcode = 'P0002';
  END IF;

  IF created_message THEN
    UPDATE public.crm_case_messages AS message
    SET reply_to_message_id = p_reply_to_message_id
    WHERE message.id = target_message.id
    RETURNING message.* INTO target_message;
  ELSIF target_message.reply_to_message_id
    IS DISTINCT FROM p_reply_to_message_id
  THEN
    RAISE EXCEPTION 'case_message_idempotency_key_reused'
      USING errcode = '23505';
  END IF;

  reply_json := private.case_message_reply_json(
    target_message.reply_to_message_id
  );
  p_result := jsonb_set(
    p_result,
    '{message,replyToMessageId}',
    coalesce(to_jsonb(target_message.reply_to_message_id), 'null'::jsonb),
    true
  );
  p_result := jsonb_set(
    p_result,
    '{message,replyToMessage}',
    coalesce(reply_json, 'null'::jsonb),
    true
  );

  RETURN p_result;
END;
$$;

REVOKE ALL ON FUNCTION private.finalize_case_message_reply(jsonb, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.send_client_case_message_v3(
  p_organization_id uuid,
  p_case_id uuid,
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
  RETURN private.finalize_case_message_reply(
    public.send_client_case_message_v2(
      p_organization_id,
      p_case_id,
      p_client_person_id,
      p_auth_user_id,
      p_client_message_id,
      p_body,
      p_attachment_ids
    ),
    p_reply_to_message_id
  );
END;
$$;

COMMENT ON FUNCTION public.send_client_case_message_v3(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) IS
  'Validates portal access and atomically sends a message with an optional reply target.';

REVOKE ALL ON FUNCTION public.send_client_case_message_v3(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_client_case_message_v3(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) TO openexpert_service;

CREATE FUNCTION public.send_staff_case_message_v3(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
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
  RETURN private.finalize_case_message_reply(
    public.send_staff_case_message_v2(
      p_organization_id,
      p_case_id,
      p_client_person_id,
      p_actor_user_id,
      p_client_message_id,
      p_body,
      p_attachment_ids
    ),
    p_reply_to_message_id
  );
END;
$$;

COMMENT ON FUNCTION public.send_staff_case_message_v3(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) IS
  'Lets a case owner or organization admin atomically send a message with an optional reply target.';

REVOKE ALL ON FUNCTION public.send_staff_case_message_v3(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_staff_case_message_v3(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) TO openexpert_service;
