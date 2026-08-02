-- Durable one-to-one case messaging. PostgreSQL is the source of truth;
-- realtime transports only fan out identifiers that make clients refetch the
-- committed rows. A conversation is scoped to one case and one CRM person.

CREATE TABLE public.crm_case_conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  client_id uuid NOT NULL,
  client_person_id uuid NOT NULL,
  next_sequence bigint DEFAULT 1 NOT NULL,
  last_message_sequence bigint DEFAULT 0 NOT NULL,
  last_message_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_conversations_pkey PRIMARY KEY (id),
  CONSTRAINT crm_case_conversations_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT crm_case_conversations_case_person_key
    UNIQUE (organization_id, case_id, client_person_id),
  CONSTRAINT crm_case_conversations_person_identity_key
    UNIQUE (organization_id, id, client_person_id),
  CONSTRAINT crm_case_conversations_sequence_check CHECK (
    last_message_sequence >= 0
    AND next_sequence = last_message_sequence + 1
  ),
  CONSTRAINT crm_case_conversations_last_message_shape_check CHECK (
    (last_message_sequence = 0 AND last_message_at IS NULL)
    OR (last_message_sequence > 0 AND last_message_at IS NOT NULL)
  ),
  CONSTRAINT crm_case_conversations_case_fkey FOREIGN KEY (
    organization_id,
    case_id
  ) REFERENCES public.crm_cases (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_conversations_case_client_fkey FOREIGN KEY (
    case_id,
    client_id
  ) REFERENCES public.crm_case_clients (
    case_id,
    client_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_conversations_person_fkey FOREIGN KEY (
    organization_id,
    client_id,
    client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    client_id,
    id
  ) ON DELETE CASCADE
);

COMMENT ON TABLE public.crm_case_conversations IS
  'One durable, person-scoped message thread for a CRM case.';
COMMENT ON COLUMN public.crm_case_conversations.next_sequence IS
  'Sequence reserved for the next committed message; advanced under a row lock.';

CREATE INDEX crm_case_conversations_staff_inbox_idx
  ON public.crm_case_conversations (
    organization_id,
    last_message_at DESC,
    id
  ) WHERE last_message_sequence > 0;

CREATE INDEX crm_case_conversations_client_person_idx
  ON public.crm_case_conversations (
    client_person_id,
    organization_id,
    last_message_at DESC,
    id
  );

CREATE TABLE public.crm_case_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  sequence bigint NOT NULL,
  client_message_id uuid NOT NULL,
  sender_kind text NOT NULL,
  sender_user_id uuid,
  sender_client_person_id uuid,
  sender_auth_user_id uuid,
  body text NOT NULL,
  legacy_activity_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_messages_pkey PRIMARY KEY (id),
  CONSTRAINT crm_case_messages_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT crm_case_messages_sequence_key
    UNIQUE (conversation_id, sequence),
  CONSTRAINT crm_case_messages_client_message_key
    UNIQUE (conversation_id, client_message_id),
  CONSTRAINT crm_case_messages_sequence_check CHECK (sequence >= 1),
  CONSTRAINT crm_case_messages_sender_kind_check CHECK (
    sender_kind = ANY (ARRAY['staff'::text, 'client'::text])
  ),
  -- A staff identifier may later be cleared when a workforce account is
  -- removed. Client messages remain tied to the CRM person for as long as the
  -- conversation itself exists; the Better Auth identity is audit metadata.
  CONSTRAINT crm_case_messages_sender_shape_check CHECK (
    (
      sender_kind = 'staff'::text
      AND sender_client_person_id IS NULL
      AND sender_auth_user_id IS NULL
    )
    OR (
      sender_kind = 'client'::text
      AND sender_user_id IS NULL
      AND sender_client_person_id IS NOT NULL
    )
  ),
  CONSTRAINT crm_case_messages_body_check CHECK (
    btrim(body) <> ''::text
    AND char_length(body) <= 4000
  ),
  CONSTRAINT crm_case_messages_conversation_fkey FOREIGN KEY (
    organization_id,
    conversation_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_messages_client_sender_fkey FOREIGN KEY (
    organization_id,
    conversation_id,
    sender_client_person_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id,
    client_person_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_messages_staff_sender_fkey FOREIGN KEY (
    organization_id,
    sender_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE SET NULL (sender_user_id),
  CONSTRAINT crm_case_messages_auth_sender_fkey FOREIGN KEY (
    sender_auth_user_id
  ) REFERENCES public.profiles (id) ON DELETE SET NULL,
  CONSTRAINT crm_case_messages_legacy_activity_fkey FOREIGN KEY (
    legacy_activity_id
  ) REFERENCES public.crm_activities (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.crm_case_messages IS
  'Immutable, ordered case messages. client_message_id provides conversation-scoped idempotency.';
COMMENT ON COLUMN public.crm_case_messages.legacy_activity_id IS
  'Original crm_activities row for messages migrated from the first client portal implementation.';

CREATE INDEX crm_case_messages_timeline_idx
  ON public.crm_case_messages (conversation_id, sequence DESC);

CREATE INDEX crm_case_messages_sender_staff_idx
  ON public.crm_case_messages (
    organization_id,
    sender_user_id,
    created_at DESC,
    id
  ) WHERE sender_kind = 'staff'::text AND sender_user_id IS NOT NULL;

CREATE INDEX crm_case_messages_sender_client_idx
  ON public.crm_case_messages (
    organization_id,
    sender_client_person_id,
    created_at DESC,
    id
  ) WHERE sender_kind = 'client'::text;

CREATE UNIQUE INDEX crm_case_messages_legacy_activity_idx
  ON public.crm_case_messages (legacy_activity_id)
  WHERE legacy_activity_id IS NOT NULL;

CREATE TABLE public.crm_case_conversation_states (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  participant_kind text NOT NULL,
  participant_user_id uuid,
  participant_client_person_id uuid,
  delivered_through_sequence bigint DEFAULT 0 NOT NULL,
  read_through_sequence bigint DEFAULT 0 NOT NULL,
  delivered_at timestamp with time zone,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_conversation_states_pkey PRIMARY KEY (id),
  CONSTRAINT crm_case_conversation_states_participant_kind_check CHECK (
    participant_kind = ANY (ARRAY['staff'::text, 'client'::text])
  ),
  CONSTRAINT crm_case_conversation_states_participant_shape_check CHECK (
    (
      participant_kind = 'staff'::text
      AND participant_user_id IS NOT NULL
      AND participant_client_person_id IS NULL
    )
    OR (
      participant_kind = 'client'::text
      AND participant_user_id IS NULL
      AND participant_client_person_id IS NOT NULL
    )
  ),
  CONSTRAINT crm_case_conversation_states_sequence_check CHECK (
    delivered_through_sequence >= 0
    AND read_through_sequence >= 0
    AND read_through_sequence <= delivered_through_sequence
  ),
  CONSTRAINT crm_case_conversation_states_timestamp_shape_check CHECK (
    (delivered_through_sequence = 0 OR delivered_at IS NOT NULL)
    AND (read_through_sequence = 0 OR read_at IS NOT NULL)
  ),
  CONSTRAINT crm_case_conversation_states_conversation_fkey FOREIGN KEY (
    organization_id,
    conversation_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_conversation_states_staff_participant_fkey FOREIGN KEY (
    organization_id,
    participant_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_conversation_states_client_participant_fkey FOREIGN KEY (
    organization_id,
    conversation_id,
    participant_client_person_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id,
    client_person_id
  ) ON DELETE CASCADE
);

COMMENT ON TABLE public.crm_case_conversation_states IS
  'Per-participant delivered/read high-water marks; updates are monotonic.';

CREATE UNIQUE INDEX crm_case_conversation_states_staff_key
  ON public.crm_case_conversation_states (
    organization_id,
    conversation_id,
    participant_user_id
  ) WHERE participant_kind = 'staff'::text;

CREATE UNIQUE INDEX crm_case_conversation_states_client_key
  ON public.crm_case_conversation_states (
    organization_id,
    conversation_id,
    participant_client_person_id
  ) WHERE participant_kind = 'client'::text;

CREATE INDEX crm_case_conversation_states_staff_unread_idx
  ON public.crm_case_conversation_states (
    organization_id,
    participant_user_id,
    conversation_id
  ) WHERE participant_kind = 'staff'::text;

CREATE TABLE public.crm_message_outbox (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  message_id uuid,
  event_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 10 NOT NULL,
  available_at timestamp with time zone DEFAULT now() NOT NULL,
  locked_at timestamp with time zone,
  locked_by text,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  CONSTRAINT crm_message_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT crm_message_outbox_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'processing'::text,
      'completed'::text,
      'failed'::text
    ])
  ),
  CONSTRAINT crm_message_outbox_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'message.created'::text,
      'receipt.updated'::text
    ])
  ),
  CONSTRAINT crm_message_outbox_event_shape_check CHECK (
    (event_type = 'message.created'::text AND message_id IS NOT NULL)
    OR (event_type = 'receipt.updated'::text AND message_id IS NULL)
  ),
  CONSTRAINT crm_message_outbox_payload_check CHECK (
    jsonb_typeof(payload) = 'object'::text
    AND pg_column_size(payload) <= 16384
  ),
  CONSTRAINT crm_message_outbox_attempts_check CHECK (
    attempts >= 0
    AND max_attempts BETWEEN 1 AND 100
    AND attempts <= max_attempts
  ),
  CONSTRAINT crm_message_outbox_lock_shape_check CHECK (
    (
      status = 'processing'::text
      AND locked_at IS NOT NULL
      AND nullif(btrim(locked_by), '') IS NOT NULL
      AND attempts >= 1
    )
    OR (
      status <> 'processing'::text
      AND locked_at IS NULL
      AND locked_by IS NULL
    )
  ),
  CONSTRAINT crm_message_outbox_processed_shape_check CHECK (
    (status = 'completed'::text AND processed_at IS NOT NULL)
    OR (status <> 'completed'::text AND processed_at IS NULL)
  ),
  CONSTRAINT crm_message_outbox_processed_order_check CHECK (
    processed_at IS NULL OR processed_at >= created_at
  ),
  CONSTRAINT crm_message_outbox_locked_by_check CHECK (
    locked_by IS NULL OR char_length(locked_by) <= 200
  ),
  CONSTRAINT crm_message_outbox_last_error_check CHECK (
    last_error IS NULL OR char_length(last_error) <= 4000
  ),
  CONSTRAINT crm_message_outbox_conversation_fkey FOREIGN KEY (
    organization_id,
    conversation_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_message_outbox_message_fkey FOREIGN KEY (
    organization_id,
    message_id
  ) REFERENCES public.crm_case_messages (
    organization_id,
    id
  ) ON DELETE CASCADE
);

COMMENT ON TABLE public.crm_message_outbox IS
  'Transactional realtime/push delivery queue. Payloads contain identifiers and receipt cursors, never message bodies.';

CREATE UNIQUE INDEX crm_message_outbox_message_created_key
  ON public.crm_message_outbox (message_id)
  WHERE event_type = 'message.created'::text;

CREATE INDEX crm_message_outbox_ready_idx
  ON public.crm_message_outbox (available_at, created_at, id)
  WHERE status = ANY (ARRAY['pending'::text, 'failed'::text])
    AND attempts < max_attempts;

CREATE INDEX crm_message_outbox_stale_lock_idx
  ON public.crm_message_outbox (locked_at, id)
  WHERE status = 'processing'::text;

CREATE INDEX crm_message_outbox_conversation_idx
  ON public.crm_message_outbox (
    organization_id,
    conversation_id,
    created_at DESC,
    id
  );

-- Copy the original one-way portal messages into durable conversations. The
-- crm_activities rows remain untouched for audit/backward compatibility. Rows
-- whose actor or body can no longer satisfy the new integrity rules are left
-- in the legacy timeline rather than being mutated or partially guessed.
INSERT INTO public.crm_case_conversations (
  organization_id,
  case_id,
  client_id,
  client_person_id,
  created_at,
  updated_at
)
SELECT
  activity.organization_id,
  activity.case_id,
  activity.client_id,
  activity.actor_client_person_id,
  min(activity.created_at),
  max(activity.created_at)
FROM public.crm_activities AS activity
JOIN public.crm_case_clients AS case_client
  ON case_client.organization_id = activity.organization_id
 AND case_client.case_id = activity.case_id
 AND case_client.client_id = activity.client_id
JOIN public.crm_client_people AS person
  ON person.organization_id = activity.organization_id
 AND person.client_id = activity.client_id
 AND person.id = activity.actor_client_person_id
WHERE activity.activity_type = 'client_portal_message'::text
  AND activity.case_id IS NOT NULL
  AND activity.client_id IS NOT NULL
  AND activity.actor_client_person_id IS NOT NULL
  AND activity.body IS NOT NULL
  AND btrim(activity.body) <> ''::text
  AND char_length(btrim(activity.body)) <= 4000
GROUP BY
  activity.organization_id,
  activity.case_id,
  activity.client_id,
  activity.actor_client_person_id
ON CONFLICT (organization_id, case_id, client_person_id) DO NOTHING;

WITH historical_messages AS (
  SELECT
    activity.id,
    activity.organization_id,
    conversation.id AS conversation_id,
    row_number() OVER (
      PARTITION BY conversation.id
      ORDER BY activity.created_at, activity.id
    )::bigint AS sequence,
    activity.actor_client_person_id,
    activity.actor_auth_user_id,
    btrim(activity.body) AS body,
    activity.created_at
  FROM public.crm_activities AS activity
  JOIN public.crm_case_conversations AS conversation
    ON conversation.organization_id = activity.organization_id
   AND conversation.case_id = activity.case_id
   AND conversation.client_id = activity.client_id
   AND conversation.client_person_id = activity.actor_client_person_id
  WHERE activity.activity_type = 'client_portal_message'::text
    AND activity.actor_client_person_id IS NOT NULL
    AND activity.body IS NOT NULL
    AND btrim(activity.body) <> ''::text
    AND char_length(btrim(activity.body)) <= 4000
)
INSERT INTO public.crm_case_messages (
  id,
  organization_id,
  conversation_id,
  sequence,
  client_message_id,
  sender_kind,
  sender_client_person_id,
  sender_auth_user_id,
  body,
  legacy_activity_id,
  created_at
)
SELECT
  historical.id,
  historical.organization_id,
  historical.conversation_id,
  historical.sequence,
  historical.id,
  'client'::text,
  historical.actor_client_person_id,
  historical.actor_auth_user_id,
  historical.body,
  historical.id,
  historical.created_at
FROM historical_messages AS historical;

WITH conversation_stats AS (
  SELECT
    message.organization_id,
    message.conversation_id,
    count(*)::bigint AS message_count,
    max(message.created_at) AS last_message_at
  FROM public.crm_case_messages AS message
  GROUP BY message.organization_id, message.conversation_id
)
UPDATE public.crm_case_conversations AS conversation
SET
  next_sequence = stats.message_count + 1,
  last_message_sequence = stats.message_count,
  last_message_at = stats.last_message_at,
  updated_at = greatest(conversation.updated_at, stats.last_message_at)
FROM conversation_stats AS stats
WHERE stats.organization_id = conversation.organization_id
  AND stats.conversation_id = conversation.id;

INSERT INTO public.crm_case_conversation_states (
  organization_id,
  conversation_id,
  participant_kind,
  participant_client_person_id,
  delivered_through_sequence,
  read_through_sequence,
  delivered_at,
  read_at,
  created_at,
  updated_at
)
SELECT
  conversation.organization_id,
  conversation.id,
  'client'::text,
  conversation.client_person_id,
  conversation.last_message_sequence,
  conversation.last_message_sequence,
  conversation.last_message_at,
  conversation.last_message_at,
  conversation.created_at,
  conversation.updated_at
FROM public.crm_case_conversations AS conversation
WHERE conversation.last_message_sequence > 0;

CREATE FUNCTION private.validate_crm_case_conversation_state()
RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
DECLARE
  conversation_last_sequence bigint;
BEGIN
  SELECT conversation.last_message_sequence
  INTO conversation_last_sequence
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = new.organization_id
    AND conversation.id = new.conversation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = '23503';
  END IF;

  IF new.delivered_through_sequence > conversation_last_sequence
    OR new.read_through_sequence > conversation_last_sequence
  THEN
    RAISE EXCEPTION 'case_message_receipt_beyond_conversation'
      USING errcode = '23514';
  END IF;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_crm_case_conversation_state()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER set_crm_case_conversations_updated_at
  BEFORE UPDATE ON public.crm_case_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER validate_crm_case_conversation_state
  BEFORE INSERT OR UPDATE ON public.crm_case_conversation_states
  FOR EACH ROW EXECUTE FUNCTION private.validate_crm_case_conversation_state();

CREATE TRIGGER set_crm_case_conversation_states_updated_at
  BEFORE UPDATE ON public.crm_case_conversation_states
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_crm_message_outbox_updated_at
  BEFORE UPDATE ON public.crm_message_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Caller-specific RPCs validate access and then enter this single append path.
-- Locking the conversation serializes both idempotency checks and sequence
-- allocation without a separate sequence object or gaps from failed writes.
CREATE FUNCTION private.append_case_message(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_sender_kind text,
  p_sender_user_id uuid,
  p_sender_client_person_id uuid,
  p_sender_auth_user_id uuid,
  p_body text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_body text := nullif(btrim(p_body), '');
  target_conversation public.crm_case_conversations%rowtype;
  existing_message public.crm_case_messages%rowtype;
  inserted_message public.crm_case_messages%rowtype;
  target_outbox public.crm_message_outbox%rowtype;
  message_sequence bigint;
  message_time timestamp with time zone := statement_timestamp();
BEGIN
  IF p_conversation_id IS NULL
    OR p_client_message_id IS NULL
    OR normalized_body IS NULL
    OR char_length(normalized_body) > 4000
    OR p_sender_kind <> ALL (ARRAY['staff'::text, 'client'::text])
    OR (
      p_sender_kind = 'staff'::text
      AND (
        p_sender_user_id IS NULL
        OR p_sender_client_person_id IS NOT NULL
        OR p_sender_auth_user_id IS NOT NULL
      )
    )
    OR (
      p_sender_kind = 'client'::text
      AND (
        p_sender_user_id IS NOT NULL
        OR p_sender_client_person_id IS NULL
        OR p_sender_auth_user_id IS NULL
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_case_message_request'
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

  SELECT message.*
  INTO existing_message
  FROM public.crm_case_messages AS message
  WHERE message.conversation_id = target_conversation.id
    AND message.client_message_id = p_client_message_id;

  IF FOUND THEN
    IF existing_message.sender_kind IS DISTINCT FROM p_sender_kind
      OR existing_message.sender_user_id IS DISTINCT FROM p_sender_user_id
      OR existing_message.sender_client_person_id
        IS DISTINCT FROM p_sender_client_person_id
      OR existing_message.sender_auth_user_id
        IS DISTINCT FROM p_sender_auth_user_id
      OR existing_message.body IS DISTINCT FROM normalized_body
    THEN
      RAISE EXCEPTION 'case_message_idempotency_key_reused'
        USING errcode = '23505';
    END IF;

    SELECT outbox.*
    INTO target_outbox
    FROM public.crm_message_outbox AS outbox
    WHERE outbox.message_id = existing_message.id
      AND outbox.event_type = 'message.created'::text;

    RETURN jsonb_build_object(
      'conversationId', existing_message.conversation_id,
      'message', jsonb_build_object(
        'id', existing_message.id,
        'organizationId', existing_message.organization_id,
        'conversationId', existing_message.conversation_id,
        'sequence', existing_message.sequence,
        'clientMessageId', existing_message.client_message_id,
        'senderKind', existing_message.sender_kind,
        'senderUserId', existing_message.sender_user_id,
        'senderClientPersonId', existing_message.sender_client_person_id,
        'senderAuthUserId', existing_message.sender_auth_user_id,
        'body', existing_message.body,
        'createdAt', existing_message.created_at
      ),
      'outboxId', target_outbox.id,
      'created', false,
      'replayed', true
    );
  END IF;

  message_sequence := target_conversation.next_sequence;

  INSERT INTO public.crm_case_messages (
    organization_id,
    conversation_id,
    sequence,
    client_message_id,
    sender_kind,
    sender_user_id,
    sender_client_person_id,
    sender_auth_user_id,
    body,
    created_at
  ) VALUES (
    target_conversation.organization_id,
    target_conversation.id,
    message_sequence,
    p_client_message_id,
    p_sender_kind,
    p_sender_user_id,
    p_sender_client_person_id,
    p_sender_auth_user_id,
    normalized_body,
    message_time
  )
  RETURNING * INTO inserted_message;

  UPDATE public.crm_case_conversations AS conversation
  SET
    next_sequence = conversation.next_sequence + 1,
    last_message_sequence = message_sequence,
    last_message_at = message_time
  WHERE conversation.id = target_conversation.id;

  IF p_sender_kind = 'staff'::text THEN
    INSERT INTO public.crm_case_conversation_states (
      organization_id,
      conversation_id,
      participant_kind,
      participant_user_id,
      delivered_through_sequence,
      read_through_sequence,
      delivered_at,
      read_at
    ) VALUES (
      target_conversation.organization_id,
      target_conversation.id,
      'staff'::text,
      p_sender_user_id,
      message_sequence,
      message_sequence,
      message_time,
      message_time
    )
    ON CONFLICT (
      organization_id,
      conversation_id,
      participant_user_id
    ) WHERE participant_kind = 'staff'::text
    DO UPDATE SET
      delivered_through_sequence = greatest(
        crm_case_conversation_states.delivered_through_sequence,
        excluded.delivered_through_sequence
      ),
      read_through_sequence = greatest(
        crm_case_conversation_states.read_through_sequence,
        excluded.read_through_sequence
      ),
      delivered_at = excluded.delivered_at,
      read_at = excluded.read_at;
  ELSE
    INSERT INTO public.crm_case_conversation_states (
      organization_id,
      conversation_id,
      participant_kind,
      participant_client_person_id,
      delivered_through_sequence,
      read_through_sequence,
      delivered_at,
      read_at
    ) VALUES (
      target_conversation.organization_id,
      target_conversation.id,
      'client'::text,
      p_sender_client_person_id,
      message_sequence,
      message_sequence,
      message_time,
      message_time
    )
    ON CONFLICT (
      organization_id,
      conversation_id,
      participant_client_person_id
    ) WHERE participant_kind = 'client'::text
    DO UPDATE SET
      delivered_through_sequence = greatest(
        crm_case_conversation_states.delivered_through_sequence,
        excluded.delivered_through_sequence
      ),
      read_through_sequence = greatest(
        crm_case_conversation_states.read_through_sequence,
        excluded.read_through_sequence
      ),
      delivered_at = excluded.delivered_at,
      read_at = excluded.read_at;
  END IF;

  INSERT INTO public.crm_message_outbox (
    organization_id,
    conversation_id,
    message_id,
    event_type,
    payload
  ) VALUES (
    target_conversation.organization_id,
    target_conversation.id,
    inserted_message.id,
    'message.created'::text,
    jsonb_build_object(
      'conversationId', target_conversation.id,
      'messageId', inserted_message.id,
      'sequence', inserted_message.sequence,
      'senderKind', inserted_message.sender_kind
    )
  )
  RETURNING * INTO target_outbox;

  RETURN jsonb_build_object(
    'conversationId', inserted_message.conversation_id,
    'message', jsonb_build_object(
      'id', inserted_message.id,
      'organizationId', inserted_message.organization_id,
      'conversationId', inserted_message.conversation_id,
      'sequence', inserted_message.sequence,
      'clientMessageId', inserted_message.client_message_id,
      'senderKind', inserted_message.sender_kind,
      'senderUserId', inserted_message.sender_user_id,
      'senderClientPersonId', inserted_message.sender_client_person_id,
      'senderAuthUserId', inserted_message.sender_auth_user_id,
      'body', inserted_message.body,
      'createdAt', inserted_message.created_at
    ),
    'outboxId', target_outbox.id,
    'created', true,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.append_case_message(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.update_case_message_receipt(
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
    IF p_participant_client_person_id
      IS DISTINCT FROM target_conversation.client_person_id
    THEN
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

CREATE FUNCTION public.send_client_case_message(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_client_message_id uuid,
  p_body text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_client_id uuid;
  target_conversation public.crm_case_conversations%rowtype;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_client_person_id IS NULL
    OR p_auth_user_id IS NULL
    OR p_client_message_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_case_message_request'
      USING errcode = '22023';
  END IF;

  SELECT portal_grant.client_id
  INTO target_client_id
  FROM public.client_portal_case_grants AS portal_grant
  JOIN public.client_account_links AS account_link
    ON account_link.organization_id = portal_grant.organization_id
   AND account_link.client_id = portal_grant.client_id
   AND account_link.client_person_id = portal_grant.client_person_id
   AND account_link.auth_user_id = p_auth_user_id
   AND account_link.revoked_at IS NULL
  WHERE portal_grant.organization_id = p_organization_id
    AND portal_grant.case_id = p_case_id
    AND portal_grant.client_person_id = p_client_person_id
    AND portal_grant.portal_enabled
    AND portal_grant.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_case_message_access_denied'
      USING errcode = '42501';
  END IF;

  INSERT INTO public.crm_case_conversations (
    organization_id,
    case_id,
    client_id,
    client_person_id
  ) VALUES (
    p_organization_id,
    p_case_id,
    target_client_id,
    p_client_person_id
  )
  ON CONFLICT (organization_id, case_id, client_person_id) DO NOTHING;

  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.client_person_id = p_client_person_id;

  RETURN private.append_case_message(
    target_conversation.id,
    p_client_message_id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_auth_user_id,
    p_body
  );
END;
$$;

COMMENT ON FUNCTION public.send_client_case_message(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) IS
  'Validates an active portal link/grant and atomically appends an idempotent client message.';

REVOKE ALL ON FUNCTION public.send_client_case_message(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_client_case_message(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) TO openexpert_service;

CREATE FUNCTION public.send_staff_case_message(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_actor_user_id uuid,
  p_client_message_id uuid,
  p_body text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_case public.crm_cases%rowtype;
  actor_role text;
  target_client_id uuid;
  target_conversation public.crm_case_conversations%rowtype;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_client_person_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_client_message_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_case_message_request'
      USING errcode = '22023';
  END IF;

  SELECT crm_case.*
  INTO target_case
  FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = p_organization_id
    AND crm_case.id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT membership.role
  INTO actor_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = p_actor_user_id;

  IF NOT FOUND
    OR (
      p_actor_user_id IS DISTINCT FROM target_case.owner_user_id
      AND actor_role <> 'admin'::text
    )
  THEN
    RAISE EXCEPTION 'staff_case_message_access_denied'
      USING errcode = '42501';
  END IF;

  SELECT portal_grant.client_id
  INTO target_client_id
  FROM public.client_portal_case_grants AS portal_grant
  WHERE portal_grant.organization_id = p_organization_id
    AND portal_grant.case_id = p_case_id
    AND portal_grant.client_person_id = p_client_person_id
    AND portal_grant.portal_enabled
    AND portal_grant.revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff_case_message_client_not_available'
      USING errcode = 'P0002';
  END IF;

  INSERT INTO public.crm_case_conversations (
    organization_id,
    case_id,
    client_id,
    client_person_id
  ) VALUES (
    p_organization_id,
    p_case_id,
    target_client_id,
    p_client_person_id
  )
  ON CONFLICT (organization_id, case_id, client_person_id) DO NOTHING;

  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.client_person_id = p_client_person_id;

  RETURN private.append_case_message(
    target_conversation.id,
    p_client_message_id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    NULL,
    p_body
  );
END;
$$;

COMMENT ON FUNCTION public.send_staff_case_message(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) IS
  'Lets only the case owner or an organization admin atomically append an idempotent staff message.';

REVOKE ALL ON FUNCTION public.send_staff_case_message(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_staff_case_message(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text
) TO openexpert_service;

CREATE FUNCTION public.update_client_case_message_receipt(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_delivered_through_sequence bigint DEFAULT NULL,
  p_read_through_sequence bigint DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_conversation public.crm_case_conversations%rowtype;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_client_person_id IS NULL
    OR p_auth_user_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_case_message_receipt_request'
      USING errcode = '22023';
  END IF;

  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  JOIN public.client_portal_case_grants AS portal_grant
    ON portal_grant.organization_id = conversation.organization_id
   AND portal_grant.case_id = conversation.case_id
   AND portal_grant.client_id = conversation.client_id
   AND portal_grant.client_person_id = conversation.client_person_id
   AND portal_grant.portal_enabled
   AND portal_grant.revoked_at IS NULL
  JOIN public.client_account_links AS account_link
    ON account_link.organization_id = conversation.organization_id
   AND account_link.client_id = conversation.client_id
   AND account_link.client_person_id = conversation.client_person_id
   AND account_link.auth_user_id = p_auth_user_id
   AND account_link.revoked_at IS NULL
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.client_person_id = p_client_person_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_case_message_access_denied'
      USING errcode = '42501';
  END IF;

  RETURN private.update_case_message_receipt(
    target_conversation.id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_delivered_through_sequence,
    p_read_through_sequence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_client_case_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.update_client_case_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) TO openexpert_service;

CREATE FUNCTION public.update_staff_case_message_receipt(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_actor_user_id uuid,
  p_delivered_through_sequence bigint DEFAULT NULL,
  p_read_through_sequence bigint DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_case public.crm_cases%rowtype;
  target_conversation public.crm_case_conversations%rowtype;
  actor_role text;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_client_person_id IS NULL
    OR p_actor_user_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_case_message_receipt_request'
      USING errcode = '22023';
  END IF;

  SELECT crm_case.*
  INTO target_case
  FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = p_organization_id
    AND crm_case.id = p_case_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT membership.role
  INTO actor_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = p_actor_user_id;

  IF NOT FOUND
    OR (
      p_actor_user_id IS DISTINCT FROM target_case.owner_user_id
      AND actor_role <> 'admin'::text
    )
  THEN
    RAISE EXCEPTION 'staff_case_message_access_denied'
      USING errcode = '42501';
  END IF;

  SELECT conversation.*
  INTO target_conversation
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.client_person_id = p_client_person_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = 'P0002';
  END IF;

  RETURN private.update_case_message_receipt(
    target_conversation.id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    p_delivered_through_sequence,
    p_read_through_sequence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_staff_case_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.update_staff_case_message_receipt(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint,
  bigint
) TO openexpert_service;

-- Workers atomically claim ready rows with SKIP LOCKED. A crashed worker's
-- stale lock becomes eligible again until max_attempts is exhausted.
CREATE FUNCTION public.claim_crm_message_outbox(
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_lock_timeout interval DEFAULT interval '5 minutes'
) RETURNS SETOF public.crm_message_outbox
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  claim_time timestamp with time zone := statement_timestamp();
BEGIN
  IF normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lock_timeout <= interval '0 seconds'
    OR p_lock_timeout > interval '1 hour'
  THEN
    RAISE EXCEPTION 'invalid_crm_message_outbox_claim'
      USING errcode = '22023';
  END IF;

  UPDATE public.crm_message_outbox AS outbox
  SET
    status = 'failed'::text,
    locked_at = NULL,
    locked_by = NULL,
    last_error = coalesce(
      outbox.last_error,
      'message_outbox_lock_expired_after_max_attempts'::text
    )
  WHERE outbox.status = 'processing'::text
    AND outbox.locked_at < claim_time - p_lock_timeout
    AND outbox.attempts >= outbox.max_attempts;

  RETURN QUERY
  WITH candidates AS (
    SELECT outbox.id
    FROM public.crm_message_outbox AS outbox
    WHERE (
      outbox.status = ANY (ARRAY['pending'::text, 'failed'::text])
      AND outbox.available_at <= claim_time
      AND outbox.attempts < outbox.max_attempts
    ) OR (
      outbox.status = 'processing'::text
      AND outbox.locked_at < claim_time - p_lock_timeout
      AND outbox.attempts < outbox.max_attempts
    )
    ORDER BY outbox.available_at, outbox.created_at, outbox.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.crm_message_outbox AS outbox
  SET
    status = 'processing'::text,
    attempts = outbox.attempts + 1,
    locked_at = claim_time,
    locked_by = normalized_worker_id,
    processed_at = NULL
  FROM candidates
  WHERE outbox.id = candidates.id
  RETURNING outbox.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_crm_message_outbox(
  text,
  integer,
  interval
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_crm_message_outbox(
  text,
  integer,
  interval
) TO openexpert_service;

CREATE FUNCTION public.complete_crm_message_outbox(
  p_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error text DEFAULT NULL,
  p_retry_delay interval DEFAULT interval '5 seconds'
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  normalized_error text := nullif(btrim(p_error), '');
  completion_time timestamp with time zone := statement_timestamp();
  target_outbox public.crm_message_outbox%rowtype;
BEGIN
  IF p_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_succeeded IS NULL
    OR (normalized_error IS NOT NULL AND char_length(normalized_error) > 4000)
    OR p_retry_delay < interval '0 seconds'
    OR p_retry_delay > interval '1 day'
  THEN
    RAISE EXCEPTION 'invalid_crm_message_outbox_completion'
      USING errcode = '22023';
  END IF;

  SELECT outbox.*
  INTO target_outbox
  FROM public.crm_message_outbox AS outbox
  WHERE outbox.id = p_id
    AND outbox.status = 'processing'::text
    AND outbox.locked_by = normalized_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_message_outbox_claim_not_found'
      USING errcode = 'P0002';
  END IF;

  IF p_succeeded THEN
    UPDATE public.crm_message_outbox AS outbox
    SET
      status = 'completed'::text,
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      processed_at = completion_time
    WHERE outbox.id = target_outbox.id
    RETURNING * INTO target_outbox;
  ELSE
    UPDATE public.crm_message_outbox AS outbox
    SET
      status = 'failed'::text,
      available_at = completion_time + p_retry_delay,
      locked_at = NULL,
      locked_by = NULL,
      last_error = coalesce(
        normalized_error,
        'message_outbox_publish_failed'::text
      ),
      processed_at = NULL
    WHERE outbox.id = target_outbox.id
    RETURNING * INTO target_outbox;
  END IF;

  RETURN jsonb_build_object(
    'id', target_outbox.id,
    'status', target_outbox.status,
    'attempts', target_outbox.attempts,
    'maxAttempts', target_outbox.max_attempts,
    'availableAt', target_outbox.available_at,
    'processedAt', target_outbox.processed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_crm_message_outbox(
  uuid,
  text,
  boolean,
  text,
  interval
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.complete_crm_message_outbox(
  uuid,
  text,
  boolean,
  text,
  interval
) TO openexpert_service;

ALTER TABLE public.crm_case_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_case_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_case_conversation_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_message_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all
  ON public.crm_case_conversations
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY openexpert_service_all
  ON public.crm_case_messages
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY openexpert_service_all
  ON public.crm_case_conversation_states
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY openexpert_service_all
  ON public.crm_message_outbox
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY crm_case_conversations_owner_or_admin_read
  ON public.crm_case_conversations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_cases AS crm_case
      WHERE crm_case.organization_id = crm_case_conversations.organization_id
        AND crm_case.id = crm_case_conversations.case_id
        AND (
          crm_case.owner_user_id = (SELECT app.current_user_id())
          OR private.is_organization_admin(
            crm_case_conversations.organization_id
          )
        )
    )
  );

CREATE POLICY crm_case_messages_owner_or_admin_read
  ON public.crm_case_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_case_conversations AS conversation
      JOIN public.crm_cases AS crm_case
        ON crm_case.organization_id = conversation.organization_id
       AND crm_case.id = conversation.case_id
      WHERE conversation.organization_id = crm_case_messages.organization_id
        AND conversation.id = crm_case_messages.conversation_id
        AND (
          crm_case.owner_user_id = (SELECT app.current_user_id())
          OR private.is_organization_admin(crm_case_messages.organization_id)
        )
    )
  );

CREATE POLICY crm_case_conversation_states_owner_or_admin_read
  ON public.crm_case_conversation_states
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.crm_case_conversations AS conversation
      JOIN public.crm_cases AS crm_case
        ON crm_case.organization_id = conversation.organization_id
       AND crm_case.id = conversation.case_id
      WHERE conversation.organization_id =
          crm_case_conversation_states.organization_id
        AND conversation.id = crm_case_conversation_states.conversation_id
        AND (
          crm_case.owner_user_id = (SELECT app.current_user_id())
          OR private.is_organization_admin(
            crm_case_conversation_states.organization_id
          )
        )
    )
  );

REVOKE ALL ON TABLE public.crm_case_conversations
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_case_messages
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_case_conversation_states
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_message_outbox
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.crm_case_conversations TO openexpert_service;
-- Messages and participant state are append-only from the application's
-- perspective. All writes go through the SECURITY DEFINER RPCs above, which
-- enforce actor access, idempotency, ordering, and monotonic receipts.
GRANT SELECT
  ON TABLE public.crm_case_messages TO openexpert_service;
GRANT SELECT
  ON TABLE public.crm_case_conversation_states TO openexpert_service;
-- HTTP handlers acknowledge direct delivery through a constrained status
-- update; inserts and worker state transitions remain RPC-only.
GRANT SELECT, UPDATE
  ON TABLE public.crm_message_outbox TO openexpert_service;

GRANT SELECT
  ON TABLE public.crm_case_conversations TO authenticated;
GRANT SELECT
  ON TABLE public.crm_case_messages TO authenticated;
GRANT SELECT
  ON TABLE public.crm_case_conversation_states TO authenticated;
