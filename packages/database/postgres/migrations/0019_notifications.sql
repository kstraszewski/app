-- Durable, tenant-safe staff notification inbox. PostgreSQL is the source of
-- truth; realtime delivery only invalidates clients so they refetch this inbox.

CREATE TABLE public.notification_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  event_type text NOT NULL,
  schema_version integer DEFAULT 1 NOT NULL,
  actor_user_id uuid,
  subject_type text,
  subject_id text,
  dedupe_key text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notification_events_pkey PRIMARY KEY (id),
  CONSTRAINT notification_events_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT notification_events_organization_dedupe_key
    UNIQUE (organization_id, dedupe_key),
  CONSTRAINT notification_events_event_type_check CHECK (
    char_length(event_type) BETWEEN 3 AND 120
    AND event_type ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'::text
  ),
  CONSTRAINT notification_events_schema_version_check CHECK (
    schema_version BETWEEN 1 AND 32767
  ),
  CONSTRAINT notification_events_subject_check CHECK (
    (subject_type IS NULL AND subject_id IS NULL)
    OR (
      subject_type IS NOT NULL
      AND subject_id IS NOT NULL
      AND char_length(subject_type) BETWEEN 1 AND 80
      AND subject_type ~ '^[a-z][a-z0-9_]*$'::text
      AND char_length(subject_id) BETWEEN 1 AND 500
    )
  ),
  CONSTRAINT notification_events_dedupe_key_check CHECK (
    btrim(dedupe_key) <> ''::text
    AND char_length(dedupe_key) <= 500
  ),
  CONSTRAINT notification_events_payload_check CHECK (
    jsonb_typeof(payload) = 'object'::text
    AND pg_column_size(payload) <= 16384
  ),
  CONSTRAINT notification_events_organization_fkey FOREIGN KEY (
    organization_id
  ) REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT notification_events_actor_membership_fkey FOREIGN KEY (
    organization_id,
    actor_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE SET NULL (actor_user_id)
);

COMMENT ON TABLE public.notification_events IS
  'Immutable logical notification events. Payloads are bounded source data; realtime transports never publish them verbatim.';

CREATE INDEX notification_events_subject_idx
  ON public.notification_events (
    organization_id,
    subject_type,
    subject_id,
    occurred_at DESC,
    id DESC
  )
  WHERE subject_type IS NOT NULL;

CREATE INDEX notification_events_actor_idx
  ON public.notification_events (
    organization_id,
    actor_user_id,
    occurred_at DESC,
    id DESC
  )
  WHERE actor_user_id IS NOT NULL;

CREATE TABLE public.user_notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  event_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  priority text DEFAULT 'normal'::text NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT user_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT user_notifications_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT user_notifications_notification_recipient_key
    UNIQUE (organization_id, id, recipient_user_id),
  CONSTRAINT user_notifications_event_recipient_key
    UNIQUE (organization_id, event_id, recipient_user_id),
  CONSTRAINT user_notifications_priority_check CHECK (
    priority = ANY (ARRAY[
      'low'::text,
      'normal'::text,
      'high'::text,
      'urgent'::text
    ])
  ),
  CONSTRAINT user_notifications_read_order_check CHECK (
    read_at IS NULL OR read_at >= created_at
  ),
  CONSTRAINT user_notifications_event_fkey FOREIGN KEY (
    organization_id,
    event_id
  ) REFERENCES public.notification_events (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT user_notifications_recipient_membership_fkey FOREIGN KEY (
    organization_id,
    recipient_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE CASCADE
);

COMMENT ON TABLE public.user_notifications IS
  'Durable per-user inbox entries. Presentation is derived from event_type and the bounded event payload.';

CREATE INDEX user_notifications_feed_idx
  ON public.user_notifications (
    organization_id,
    recipient_user_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX user_notifications_unread_idx
  ON public.user_notifications (
    organization_id,
    recipient_user_id,
    created_at DESC,
    id DESC
  )
  WHERE read_at IS NULL;

CREATE INDEX user_notifications_event_idx
  ON public.user_notifications (organization_id, event_id);

CREATE TABLE public.notification_inbox_states (
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  revision bigint DEFAULT 0 NOT NULL,
  last_event jsonb,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notification_inbox_states_pkey PRIMARY KEY (
    organization_id,
    user_id
  ),
  CONSTRAINT notification_inbox_states_revision_check CHECK (revision >= 0),
  CONSTRAINT notification_inbox_states_event_check CHECK (
    last_event IS NULL
    OR (
      jsonb_typeof(last_event) = 'object'::text
      AND pg_column_size(last_event) <= 4096
    )
  ),
  CONSTRAINT notification_inbox_states_membership_fkey FOREIGN KEY (
    organization_id,
    user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_inbox_states IS
  'Monotonic per-user inbox cursor used by realtime invalidation and polling fallback.';

CREATE TABLE public.notification_delivery_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  notification_id uuid,
  recipient_user_id uuid NOT NULL,
  channel text NOT NULL,
  event_type text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 10 NOT NULL,
  available_at timestamp with time zone DEFAULT now() NOT NULL,
  locked_at timestamp with time zone,
  locked_by text,
  last_error text,
  provider text,
  provider_message_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  processed_at timestamp with time zone,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  CONSTRAINT notification_delivery_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT notification_delivery_jobs_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT notification_delivery_jobs_dedupe_key UNIQUE (
    organization_id,
    recipient_user_id,
    channel,
    dedupe_key
  ),
  CONSTRAINT notification_delivery_jobs_channel_check CHECK (
    channel = ANY (ARRAY[
      'realtime'::text,
      'email'::text,
      'sms'::text,
      'web_push'::text
    ])
  ),
  CONSTRAINT notification_delivery_jobs_event_type_check CHECK (
    event_type = ANY (ARRAY[
      'notification.created'::text,
      'notification.read'::text,
      'notifications.read_through'::text
    ])
  ),
  CONSTRAINT notification_delivery_jobs_event_shape_check CHECK (
    (
      event_type = ANY (ARRAY[
        'notification.created'::text,
        'notification.read'::text
      ])
      AND notification_id IS NOT NULL
    )
    OR (
      event_type = 'notifications.read_through'::text
      AND notification_id IS NULL
    )
  ),
  CONSTRAINT notification_delivery_jobs_dedupe_check CHECK (
    btrim(dedupe_key) <> ''::text
    AND char_length(dedupe_key) <= 500
  ),
  CONSTRAINT notification_delivery_jobs_payload_check CHECK (
    jsonb_typeof(payload) = 'object'::text
    AND pg_column_size(payload) <= 4096
  ),
  CONSTRAINT notification_delivery_jobs_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'processing'::text,
      'completed'::text,
      'failed'::text
    ])
  ),
  CONSTRAINT notification_delivery_jobs_attempts_check CHECK (
    attempts >= 0
    AND max_attempts BETWEEN 1 AND 100
    AND attempts <= max_attempts
  ),
  CONSTRAINT notification_delivery_jobs_lock_shape_check CHECK (
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
  CONSTRAINT notification_delivery_jobs_processed_shape_check CHECK (
    (status = 'completed'::text AND processed_at IS NOT NULL)
    OR (status <> 'completed'::text AND processed_at IS NULL)
  ),
  CONSTRAINT notification_delivery_jobs_timestamp_check CHECK (
    updated_at >= created_at
    AND (processed_at IS NULL OR processed_at >= created_at)
    AND (sent_at IS NULL OR sent_at >= created_at)
    AND (delivered_at IS NULL OR delivered_at >= coalesce(sent_at, created_at))
  ),
  CONSTRAINT notification_delivery_jobs_locked_by_check CHECK (
    locked_by IS NULL OR char_length(locked_by) <= 200
  ),
  CONSTRAINT notification_delivery_jobs_last_error_check CHECK (
    last_error IS NULL OR char_length(last_error) <= 4000
  ),
  CONSTRAINT notification_delivery_jobs_provider_check CHECK (
    provider IS NULL
    OR (btrim(provider) <> ''::text AND char_length(provider) <= 100)
  ),
  CONSTRAINT notification_delivery_jobs_provider_message_check CHECK (
    provider_message_id IS NULL
    OR (
      provider IS NOT NULL
      AND btrim(provider_message_id) <> ''::text
      AND char_length(provider_message_id) <= 500
    )
  ),
  CONSTRAINT notification_delivery_jobs_notification_fkey FOREIGN KEY (
    organization_id,
    notification_id,
    recipient_user_id
  ) REFERENCES public.user_notifications (
    organization_id,
    id,
    recipient_user_id
  ) ON DELETE CASCADE,
  CONSTRAINT notification_delivery_jobs_recipient_membership_fkey FOREIGN KEY (
    organization_id,
    recipient_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE CASCADE
);

COMMENT ON TABLE public.notification_delivery_jobs IS
  'Transactional notification transport outbox. Only realtime jobs are enqueued initially; email, SMS, and web push are reserved channels.';

CREATE INDEX notification_delivery_jobs_ready_idx
  ON public.notification_delivery_jobs (available_at, created_at, id)
  WHERE status = ANY (ARRAY['pending'::text, 'failed'::text])
    AND attempts < max_attempts;

CREATE INDEX notification_delivery_jobs_stale_lock_idx
  ON public.notification_delivery_jobs (locked_at, id)
  WHERE status = 'processing'::text;

CREATE INDEX notification_delivery_jobs_recipient_idx
  ON public.notification_delivery_jobs (
    organization_id,
    recipient_user_id,
    created_at DESC,
    id DESC
  );

CREATE INDEX notification_delivery_jobs_notification_idx
  ON public.notification_delivery_jobs (organization_id, notification_id)
  WHERE notification_id IS NOT NULL;

CREATE UNIQUE INDEX notification_delivery_jobs_provider_message_idx
  ON public.notification_delivery_jobs (
    channel,
    provider,
    provider_message_id
  )
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

-- Advance one user's cursor and enqueue the matching realtime invalidation in
-- the same transaction. The delivery-job id is the realtime event id.
CREATE FUNCTION private.enqueue_notification_realtime_change(
  p_organization_id uuid,
  p_recipient_user_id uuid,
  p_kind text,
  p_notification_id uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb,
  p_occurred_at timestamp with time zone DEFAULT statement_timestamp()
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  current_revision bigint;
  next_revision bigint;
  delivery_job_id uuid := gen_random_uuid();
  event_payload jsonb;
  event_dedupe_key text;
  normalized_details jsonb := coalesce(p_details, '{}'::jsonb);
BEGIN
  IF p_organization_id IS NULL
    OR p_recipient_user_id IS NULL
    OR p_kind IS NULL
    OR p_kind NOT IN (
      'notification.created'::text,
      'notification.read'::text,
      'notifications.read_through'::text
    )
    OR p_occurred_at IS NULL
    OR jsonb_typeof(normalized_details) <> 'object'::text
    OR pg_column_size(normalized_details) > 2048
    OR (
      p_kind IN ('notification.created'::text, 'notification.read'::text)
      AND p_notification_id IS NULL
    )
    OR (
      p_kind = 'notifications.read_through'::text
      AND p_notification_id IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'invalid_notification_realtime_change'
      USING errcode = '22023';
  END IF;

  INSERT INTO public.notification_inbox_states (
    organization_id,
    user_id,
    revision,
    last_event,
    updated_at
  ) VALUES (
    p_organization_id,
    p_recipient_user_id,
    0,
    NULL,
    p_occurred_at
  )
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  SELECT state.revision
  INTO current_revision
  FROM public.notification_inbox_states AS state
  WHERE state.organization_id = p_organization_id
    AND state.user_id = p_recipient_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification_inbox_state_not_found'
      USING errcode = 'P0002';
  END IF;

  next_revision := current_revision + 1;
  event_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'schemaVersion', 1,
      'eventId', delivery_job_id,
      'kind', p_kind,
      'organizationId', p_organization_id,
      'recipientUserId', p_recipient_user_id,
      'notificationId', p_notification_id,
      'occurredAt', p_occurred_at,
      'revision', next_revision
    ) || (
      normalized_details - ARRAY[
        'schemaVersion',
        'eventId',
        'kind',
        'organizationId',
        'recipientUserId',
        'notificationId',
        'occurredAt',
        'revision'
      ]::text[]
    )
  );

  event_dedupe_key := p_kind || ':' || coalesce(
    p_notification_id::text,
    next_revision::text
  );

  UPDATE public.notification_inbox_states AS state
  SET
    revision = next_revision,
    last_event = event_payload,
    updated_at = p_occurred_at
  WHERE state.organization_id = p_organization_id
    AND state.user_id = p_recipient_user_id;

  INSERT INTO public.notification_delivery_jobs (
    id,
    organization_id,
    notification_id,
    recipient_user_id,
    channel,
    event_type,
    dedupe_key,
    payload,
    available_at,
    created_at,
    updated_at
  ) VALUES (
    delivery_job_id,
    p_organization_id,
    p_notification_id,
    p_recipient_user_id,
    'realtime'::text,
    p_kind,
    event_dedupe_key,
    event_payload,
    p_occurred_at,
    p_occurred_at,
    p_occurred_at
  );

  RETURN event_payload;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_notification_realtime_change(
  uuid,
  uuid,
  text,
  uuid,
  jsonb,
  timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Idempotently materialize one logical event for one staff recipient. Domain
-- triggers and the service RPC call this inside their business transaction.
CREATE FUNCTION private.enqueue_staff_notification(
  p_organization_id uuid,
  p_recipient_user_id uuid,
  p_event_type text,
  p_dedupe_key text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_priority text DEFAULT 'normal'::text,
  p_actor_user_id uuid DEFAULT NULL,
  p_subject_type text DEFAULT NULL,
  p_subject_id text DEFAULT NULL,
  p_schema_version integer DEFAULT 1,
  p_occurred_at timestamp with time zone DEFAULT statement_timestamp()
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_event_type text := lower(nullif(btrim(p_event_type), ''));
  normalized_dedupe_key text := nullif(btrim(p_dedupe_key), '');
  normalized_subject_type text := lower(nullif(btrim(p_subject_type), ''));
  normalized_subject_id text := nullif(btrim(p_subject_id), '');
  normalized_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  target_event public.notification_events%rowtype;
  target_notification_id uuid;
  inserted_notification_id uuid;
BEGIN
  IF p_organization_id IS NULL
    OR p_recipient_user_id IS NULL
    OR normalized_event_type IS NULL
    OR normalized_event_type !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$'::text
    OR char_length(normalized_event_type) > 120
    OR normalized_dedupe_key IS NULL
    OR char_length(normalized_dedupe_key) > 500
    OR p_priority IS NULL
    OR p_priority NOT IN ('low'::text, 'normal'::text, 'high'::text, 'urgent'::text)
    OR p_schema_version IS NULL
    OR p_schema_version NOT BETWEEN 1 AND 32767
    OR p_occurred_at IS NULL
    OR jsonb_typeof(normalized_payload) <> 'object'::text
    OR pg_column_size(normalized_payload) > 16384
    OR (
      (normalized_subject_type IS NULL) IS DISTINCT FROM
      (normalized_subject_id IS NULL)
    )
    OR (
      normalized_subject_type IS NOT NULL
      AND (
        normalized_subject_type !~ '^[a-z][a-z0-9_]*$'::text
        OR char_length(normalized_subject_type) > 80
        OR char_length(normalized_subject_id) > 500
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_staff_notification'
      USING errcode = '22023';
  END IF;

  INSERT INTO public.notification_events (
    organization_id,
    event_type,
    schema_version,
    actor_user_id,
    subject_type,
    subject_id,
    dedupe_key,
    payload,
    occurred_at
  ) VALUES (
    p_organization_id,
    normalized_event_type,
    p_schema_version,
    p_actor_user_id,
    normalized_subject_type,
    normalized_subject_id,
    normalized_dedupe_key,
    normalized_payload,
    p_occurred_at
  )
  ON CONFLICT (organization_id, dedupe_key) DO NOTHING
  RETURNING * INTO target_event;

  IF target_event.id IS NULL THEN
    SELECT event.*
    INTO target_event
    FROM public.notification_events AS event
    WHERE event.organization_id = p_organization_id
      AND event.dedupe_key = normalized_dedupe_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'notification_event_idempotency_race'
        USING errcode = '40001';
    END IF;

    IF target_event.event_type IS DISTINCT FROM normalized_event_type
      OR target_event.schema_version IS DISTINCT FROM p_schema_version
      OR target_event.actor_user_id IS DISTINCT FROM p_actor_user_id
      OR target_event.subject_type IS DISTINCT FROM normalized_subject_type
      OR target_event.subject_id IS DISTINCT FROM normalized_subject_id
      OR target_event.payload IS DISTINCT FROM normalized_payload
    THEN
      RAISE EXCEPTION 'notification_event_dedupe_conflict'
        USING errcode = '23505';
    END IF;
  END IF;

  INSERT INTO public.user_notifications (
    organization_id,
    event_id,
    recipient_user_id,
    priority,
    created_at
  ) VALUES (
    p_organization_id,
    target_event.id,
    p_recipient_user_id,
    p_priority,
    p_occurred_at
  )
  ON CONFLICT (organization_id, event_id, recipient_user_id) DO NOTHING
  RETURNING id INTO inserted_notification_id;

  IF inserted_notification_id IS NOT NULL THEN
    target_notification_id := inserted_notification_id;

    PERFORM private.enqueue_notification_realtime_change(
      p_organization_id,
      p_recipient_user_id,
      'notification.created'::text,
      target_notification_id,
      jsonb_build_object(
        'notificationEventId', target_event.id,
        'eventType', target_event.event_type
      ),
      statement_timestamp()
    );
  ELSE
    SELECT notification.id
    INTO target_notification_id
    FROM public.user_notifications AS notification
    WHERE notification.organization_id = p_organization_id
      AND notification.event_id = target_event.id
      AND notification.recipient_user_id = p_recipient_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'user_notification_idempotency_race'
        USING errcode = '40001';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.user_notifications AS notification
      WHERE notification.id = target_notification_id
        AND notification.priority IS DISTINCT FROM p_priority
    ) THEN
      RAISE EXCEPTION 'user_notification_dedupe_conflict'
        USING errcode = '23505';
    END IF;
  END IF;

  RETURN target_notification_id;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_staff_notification(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  text,
  uuid,
  text,
  text,
  integer,
  timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.create_staff_notification_event(p_request jsonb)
RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  request_organization_id uuid;
  request_recipient_user_id uuid;
  request_event_type text;
  request_dedupe_key text;
  request_payload jsonb;
  request_priority text;
  request_actor_user_id uuid;
  request_subject_type text;
  request_subject_id text;
  request_schema_version integer;
  request_occurred_at timestamp with time zone;
  target_notification_id uuid;
  target_event_id uuid;
BEGIN
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object'::text THEN
    RAISE EXCEPTION 'invalid_staff_notification_request'
      USING errcode = '22023';
  END IF;

  BEGIN
    request_organization_id := nullif(btrim(coalesce(
      p_request ->> 'organizationId',
      p_request ->> 'organization_id'
    )), '')::uuid;
    request_recipient_user_id := nullif(btrim(coalesce(
      p_request ->> 'recipientUserId',
      p_request ->> 'recipient_user_id'
    )), '')::uuid;
    request_event_type := nullif(btrim(coalesce(
      p_request ->> 'eventType',
      p_request ->> 'event_type'
    )), '');
    request_dedupe_key := nullif(btrim(coalesce(
      p_request ->> 'dedupeKey',
      p_request ->> 'dedupe_key'
    )), '');
    request_payload := coalesce(p_request -> 'payload', '{}'::jsonb);
    request_priority := coalesce(
      nullif(btrim(p_request ->> 'priority'), ''),
      'normal'::text
    );
    request_actor_user_id := nullif(btrim(coalesce(
      p_request ->> 'actorUserId',
      p_request ->> 'actor_user_id'
    )), '')::uuid;
    request_subject_type := nullif(btrim(coalesce(
      p_request ->> 'subjectType',
      p_request ->> 'subject_type'
    )), '');
    request_subject_id := nullif(btrim(coalesce(
      p_request ->> 'subjectId',
      p_request ->> 'subject_id'
    )), '');
    request_schema_version := coalesce(
      nullif(btrim(coalesce(
        p_request ->> 'schemaVersion',
        p_request ->> 'schema_version'
      )), '')::integer,
      1
    );
    request_occurred_at := coalesce(
      nullif(btrim(coalesce(
        p_request ->> 'occurredAt',
        p_request ->> 'occurred_at'
      )), '')::timestamp with time zone,
      statement_timestamp()
    );
  EXCEPTION
    WHEN invalid_text_representation
      OR datetime_field_overflow
      OR invalid_datetime_format
      OR numeric_value_out_of_range
      OR data_exception
    THEN
      RAISE EXCEPTION 'invalid_staff_notification_request'
        USING errcode = '22023';
  END;

  target_notification_id := private.enqueue_staff_notification(
    request_organization_id,
    request_recipient_user_id,
    request_event_type,
    request_dedupe_key,
    request_payload,
    request_priority,
    request_actor_user_id,
    request_subject_type,
    request_subject_id,
    request_schema_version,
    request_occurred_at
  );

  SELECT notification.event_id
  INTO target_event_id
  FROM public.user_notifications AS notification
  WHERE notification.id = target_notification_id
    AND notification.organization_id = request_organization_id;

  RETURN jsonb_build_object(
    'eventId', target_event_id,
    'notificationId', target_notification_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_staff_notification_event(jsonb)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_staff_notification_event(jsonb)
  TO openexpert_service;

CREATE FUNCTION public.get_my_notification_feed(
  p_organization_id uuid,
  p_limit integer DEFAULT 30,
  p_before_created_at timestamp with time zone DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_unread_only boolean DEFAULT false
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  current_user_id uuid := (SELECT app.current_user_id());
  page_items jsonb;
  unread_count bigint;
  current_revision bigint;
  has_more boolean;
  next_created_at timestamp with time zone;
  next_id uuid;
  generated_at timestamp with time zone := statement_timestamp();
BEGIN
  IF p_organization_id IS NULL
    OR current_user_id IS NULL
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_unread_only IS NULL
    OR (
      (p_before_created_at IS NULL) IS DISTINCT FROM
      (p_before_id IS NULL)
    )
  THEN
    RAISE EXCEPTION 'invalid_notification_feed_request'
      USING errcode = '22023';
  END IF;

  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required'
      USING errcode = '42501';
  END IF;

  WITH candidates AS MATERIALIZED (
    SELECT
      notification.id,
      notification.created_at,
      jsonb_build_object(
        'id', notification.id,
        'eventId', event.id,
        'eventType', event.event_type,
        'schemaVersion', event.schema_version,
        'priority', notification.priority,
        'subjectType', event.subject_type,
        'subjectId', event.subject_id,
        'actor', CASE
          WHEN event.actor_user_id IS NULL THEN 'null'::jsonb
          ELSE jsonb_build_object(
            'id', event.actor_user_id,
            'name', coalesce(
              nullif(btrim(actor.full_name), ''),
              nullif(btrim(actor_profile.display_name), '')
            ),
            'avatarUrl', actor.avatar_url
          )
        END,
        'payload', event.payload,
        'occurredAt', event.occurred_at,
        'readAt', notification.read_at,
        'createdAt', notification.created_at
      ) AS item
    FROM public.user_notifications AS notification
    JOIN public.notification_events AS event
      ON event.organization_id = notification.organization_id
     AND event.id = notification.event_id
    LEFT JOIN public.users AS actor
      ON actor.id = event.actor_user_id
    LEFT JOIN public.profiles AS actor_profile
      ON actor_profile.id = event.actor_user_id
    WHERE notification.organization_id = p_organization_id
      AND notification.recipient_user_id = current_user_id
      AND (NOT p_unread_only OR notification.read_at IS NULL)
      AND (
        p_before_created_at IS NULL
        OR (notification.created_at, notification.id)
          < (p_before_created_at, p_before_id)
      )
    ORDER BY notification.created_at DESC, notification.id DESC
    LIMIT p_limit + 1
  ), page AS (
    SELECT candidate.*
    FROM candidates AS candidate
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT p_limit
  )
  SELECT
    coalesce(
      (
        SELECT jsonb_agg(
          page_row.item
          ORDER BY page_row.created_at DESC, page_row.id DESC
        )
        FROM page AS page_row
      ),
      '[]'::jsonb
    ),
    (SELECT count(*) > p_limit FROM candidates),
    (
      SELECT page_row.created_at
      FROM page AS page_row
      ORDER BY page_row.created_at ASC, page_row.id ASC
      LIMIT 1
    ),
    (
      SELECT page_row.id
      FROM page AS page_row
      ORDER BY page_row.created_at ASC, page_row.id ASC
      LIMIT 1
    ),
    (
      SELECT count(*)
      FROM public.user_notifications AS unread
      WHERE unread.organization_id = p_organization_id
        AND unread.recipient_user_id = current_user_id
        AND unread.read_at IS NULL
    ),
    coalesce(
      (
        SELECT state.revision
        FROM public.notification_inbox_states AS state
        WHERE state.organization_id = p_organization_id
          AND state.user_id = current_user_id
      ),
      0
    )
  INTO
    page_items,
    has_more,
    next_created_at,
    next_id,
    unread_count,
    current_revision;

  RETURN jsonb_build_object(
    'items', page_items,
    'unreadCount', unread_count,
    'generatedAt', generated_at,
    'revision', current_revision,
    'hasMore', has_more,
    'nextCursor', CASE
      WHEN has_more THEN jsonb_build_object(
        'createdAt', next_created_at,
        'id', next_id
      )
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_notification_feed(
  uuid,
  integer,
  timestamp with time zone,
  uuid,
  boolean
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_my_notification_feed(
  uuid,
  integer,
  timestamp with time zone,
  uuid,
  boolean
) TO authenticated;

CREATE FUNCTION public.get_my_notification_realtime_state(
  p_organization_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  current_user_id uuid := (SELECT app.current_user_id());
  current_revision bigint;
  current_event jsonb;
  current_updated_at timestamp with time zone;
BEGIN
  IF p_organization_id IS NULL OR current_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid_notification_realtime_state_request'
      USING errcode = '22023';
  END IF;

  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required'
      USING errcode = '42501';
  END IF;

  SELECT state.revision, state.last_event, state.updated_at
  INTO current_revision, current_event, current_updated_at
  FROM public.notification_inbox_states AS state
  WHERE state.organization_id = p_organization_id
    AND state.user_id = current_user_id;

  RETURN jsonb_build_object(
    'revision', coalesce(current_revision, 0),
    'lastEvent', current_event,
    'updatedAt', current_updated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_notification_realtime_state(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_my_notification_realtime_state(uuid)
  TO authenticated;

CREATE FUNCTION public.mark_notification_read(
  p_organization_id uuid,
  p_notification_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  current_user_id uuid := (SELECT app.current_user_id());
  action_time timestamp with time zone := statement_timestamp();
  target_notification public.user_notifications%rowtype;
  state_event jsonb;
  current_revision bigint;
  current_event jsonb;
  changed boolean := false;
BEGIN
  IF p_organization_id IS NULL
    OR p_notification_id IS NULL
    OR current_user_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_mark_notification_read_request'
      USING errcode = '22023';
  END IF;

  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required'
      USING errcode = '42501';
  END IF;

  SELECT notification.*
  INTO target_notification
  FROM public.user_notifications AS notification
  WHERE notification.organization_id = p_organization_id
    AND notification.id = p_notification_id
    AND notification.recipient_user_id = current_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification_not_found'
      USING errcode = 'P0002';
  END IF;

  IF target_notification.read_at IS NULL THEN
    UPDATE public.user_notifications AS notification
    SET read_at = greatest(action_time, notification.created_at)
    WHERE notification.organization_id = p_organization_id
      AND notification.id = p_notification_id
      AND notification.recipient_user_id = current_user_id
    RETURNING * INTO target_notification;

    state_event := private.enqueue_notification_realtime_change(
      p_organization_id,
      current_user_id,
      'notification.read'::text,
      p_notification_id,
      '{}'::jsonb,
      action_time
    );
    current_revision := (state_event ->> 'revision')::bigint;
    current_event := state_event;
    changed := true;
  ELSE
    SELECT state.revision, state.last_event
    INTO current_revision, current_event
    FROM public.notification_inbox_states AS state
    WHERE state.organization_id = p_organization_id
      AND state.user_id = current_user_id;
  END IF;

  RETURN jsonb_build_object(
    'notificationId', target_notification.id,
    'readAt', target_notification.read_at,
    'changed', changed,
    'revision', coalesce(current_revision, 0),
    'lastEvent', current_event
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid, uuid)
  TO authenticated;

CREATE FUNCTION public.mark_notifications_read_through(
  p_organization_id uuid,
  p_through_at timestamp with time zone
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  current_user_id uuid := (SELECT app.current_user_id());
  transaction_time timestamp with time zone := transaction_timestamp();
  action_time timestamp with time zone := statement_timestamp();
  effective_through_at timestamp with time zone;
  updated_count bigint := 0;
  state_event jsonb;
  current_revision bigint;
  current_event jsonb;
BEGIN
  IF p_organization_id IS NULL
    OR p_through_at IS NULL
    OR current_user_id IS NULL
  THEN
    RAISE EXCEPTION 'invalid_mark_notifications_read_through_request'
      USING errcode = '22023';
  END IF;

  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required'
      USING errcode = '42501';
  END IF;

  -- A client-provided watermark can never cover notifications from the future
  -- relative to this transaction.
  effective_through_at := least(p_through_at, transaction_time);

  UPDATE public.user_notifications AS notification
  SET read_at = greatest(action_time, notification.created_at)
  WHERE notification.organization_id = p_organization_id
    AND notification.recipient_user_id = current_user_id
    AND notification.read_at IS NULL
    AND notification.created_at <= effective_through_at;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    state_event := private.enqueue_notification_realtime_change(
      p_organization_id,
      current_user_id,
      'notifications.read_through'::text,
      NULL,
      jsonb_build_object(
        'throughAt', effective_through_at,
        'updatedCount', updated_count
      ),
      action_time
    );
    current_revision := (state_event ->> 'revision')::bigint;
    current_event := state_event;
  ELSE
    SELECT state.revision, state.last_event
    INTO current_revision, current_event
    FROM public.notification_inbox_states AS state
    WHERE state.organization_id = p_organization_id
      AND state.user_id = current_user_id;
  END IF;

  RETURN jsonb_build_object(
    'updatedCount', updated_count,
    'throughAt', effective_through_at,
    'revision', coalesce(current_revision, 0),
    'lastEvent', current_event
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read_through(
  uuid,
  timestamp with time zone
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read_through(
  uuid,
  timestamp with time zone
) TO authenticated;

CREATE FUNCTION public.claim_notification_delivery_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 50,
  p_lock_timeout interval DEFAULT interval '5 minutes'
) RETURNS SETOF public.notification_delivery_jobs
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
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lock_timeout IS NULL
    OR p_lock_timeout <= interval '0 seconds'
    OR p_lock_timeout > interval '1 hour'
  THEN
    RAISE EXCEPTION 'invalid_notification_delivery_job_claim'
      USING errcode = '22023';
  END IF;

  UPDATE public.notification_delivery_jobs AS job
  SET
    status = 'failed'::text,
    locked_at = NULL,
    locked_by = NULL,
    last_error = coalesce(
      job.last_error,
      'notification_delivery_lock_expired_after_max_attempts'::text
    ),
    updated_at = claim_time
  WHERE job.status = 'processing'::text
    AND job.locked_at < claim_time - p_lock_timeout
    AND job.attempts >= job.max_attempts;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.notification_delivery_jobs AS job
    WHERE (
      job.status = ANY (ARRAY['pending'::text, 'failed'::text])
      AND job.available_at <= claim_time
      AND job.attempts < job.max_attempts
    ) OR (
      job.status = 'processing'::text
      AND job.locked_at < claim_time - p_lock_timeout
      AND job.attempts < job.max_attempts
    )
    ORDER BY job.available_at, job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.notification_delivery_jobs AS job
  SET
    status = 'processing'::text,
    attempts = job.attempts + 1,
    locked_at = claim_time,
    locked_by = normalized_worker_id,
    last_error = CASE
      WHEN job.status = 'processing'::text
        THEN coalesce(job.last_error, 'notification_delivery_lock_expired'::text)
      ELSE job.last_error
    END,
    updated_at = claim_time,
    processed_at = NULL
  FROM candidates
  WHERE job.id = candidates.id
  RETURNING job.*;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_notification_delivery_jobs(
  text,
  integer,
  interval
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_notification_delivery_jobs(
  text,
  integer,
  interval
) TO openexpert_service;

CREATE FUNCTION public.complete_notification_delivery_job(
  p_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error text DEFAULT NULL,
  p_retry_delay interval DEFAULT interval '5 seconds',
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  normalized_error text := nullif(btrim(p_error), '');
  normalized_provider text := nullif(btrim(p_provider), '');
  normalized_provider_message_id text := nullif(
    btrim(p_provider_message_id),
    ''
  );
  completion_time timestamp with time zone := statement_timestamp();
  target_job public.notification_delivery_jobs%rowtype;
BEGIN
  IF p_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_succeeded IS NULL
    OR (normalized_error IS NOT NULL AND char_length(normalized_error) > 4000)
    OR p_retry_delay IS NULL
    OR p_retry_delay < interval '0 seconds'
    OR p_retry_delay > interval '1 day'
    OR (normalized_provider IS NOT NULL AND char_length(normalized_provider) > 100)
    OR (
      normalized_provider_message_id IS NOT NULL
      AND (
        normalized_provider IS NULL
        OR char_length(normalized_provider_message_id) > 500
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_notification_delivery_job_completion'
      USING errcode = '22023';
  END IF;

  SELECT job.*
  INTO target_job
  FROM public.notification_delivery_jobs AS job
  WHERE job.id = p_id
    AND job.status = 'processing'::text
    AND job.locked_by = normalized_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification_delivery_job_claim_not_found'
      USING errcode = 'P0002';
  END IF;

  IF p_succeeded THEN
    UPDATE public.notification_delivery_jobs AS job
    SET
      status = 'completed'::text,
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      provider = coalesce(normalized_provider, job.provider),
      provider_message_id = coalesce(
        normalized_provider_message_id,
        job.provider_message_id
      ),
      updated_at = completion_time,
      processed_at = completion_time,
      sent_at = coalesce(job.sent_at, completion_time)
    WHERE job.id = target_job.id
    RETURNING * INTO target_job;
  ELSE
    UPDATE public.notification_delivery_jobs AS job
    SET
      status = 'failed'::text,
      available_at = completion_time + p_retry_delay,
      locked_at = NULL,
      locked_by = NULL,
      last_error = coalesce(
        normalized_error,
        'notification_delivery_failed'::text
      ),
      provider = coalesce(normalized_provider, job.provider),
      provider_message_id = coalesce(
        normalized_provider_message_id,
        job.provider_message_id
      ),
      updated_at = completion_time,
      processed_at = NULL
    WHERE job.id = target_job.id
    RETURNING * INTO target_job;
  END IF;

  RETURN jsonb_build_object(
    'id', target_job.id,
    'status', target_job.status,
    'channel', target_job.channel,
    'attempts', target_job.attempts,
    'maxAttempts', target_job.max_attempts,
    'availableAt', target_job.available_at,
    'processedAt', target_job.processed_at,
    'provider', target_job.provider,
    'providerMessageId', target_job.provider_message_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_notification_delivery_job(
  uuid,
  text,
  boolean,
  text,
  interval,
  text,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.complete_notification_delivery_job(
  uuid,
  text,
  boolean,
  text,
  interval,
  text,
  text
) TO openexpert_service;

-- Client-authored case messages notify the case owner. Message bodies never
-- enter notification payloads or realtime delivery jobs.
CREATE FUNCTION private.notify_case_owner_about_client_message()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_case_id uuid;
  target_owner_user_id uuid;
  target_case_title text;
  target_priority text;
BEGIN
  IF NEW.sender_kind <> 'client'::text THEN
    RETURN NEW;
  END IF;

  SELECT
    conversation.case_id,
    crm_case.owner_user_id,
    crm_case.title,
    crm_case.priority
  INTO
    target_case_id,
    target_owner_user_id,
    target_case_title,
    target_priority
  FROM public.crm_case_conversations AS conversation
  JOIN public.crm_cases AS crm_case
    ON crm_case.organization_id = conversation.organization_id
   AND crm_case.id = conversation.case_id
  WHERE conversation.organization_id = NEW.organization_id
    AND conversation.id = NEW.conversation_id;

  IF target_owner_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM private.enqueue_staff_notification(
    NEW.organization_id,
    target_owner_user_id,
    'crm.case_message.received'::text,
    'crm.case_message.received:'::text || NEW.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'caseId', target_case_id,
      'conversationId', NEW.conversation_id,
      'messageId', NEW.id,
      'sequence', NEW.sequence,
      'caseTitle', target_case_title
    )),
    coalesce(target_priority, 'normal'::text),
    NULL,
    'crm_case'::text,
    target_case_id::text,
    1,
    NEW.created_at
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_case_owner_about_client_message()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER notify_case_owner_about_client_message
  AFTER INSERT ON public.crm_case_messages
  FOR EACH ROW
  WHEN (NEW.sender_kind = 'client'::text)
  EXECUTE FUNCTION private.notify_case_owner_about_client_message();

-- Delegation lifecycle notifications have one deterministic dedupe key per
-- business transition. A reassignment receives a new delegated_at watermark.
CREATE FUNCTION private.notify_crm_task_delegation_change()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  caller_user_id uuid := (SELECT app.current_user_id());
  event_actor_user_id uuid;
  event_payload jsonb;
  delegation_dedupe_suffix text;
  emit_delegated boolean := false;
  emit_accepted boolean := false;
  emit_rejected boolean := false;
  emit_cancelled boolean := false;
  emit_completed boolean := false;
BEGIN
  IF NEW.delegation_status = 'not_delegated'::text THEN
    RETURN NEW;
  END IF;

  IF caller_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = NEW.organization_id
      AND membership.user_id = caller_user_id
  ) THEN
    caller_user_id := NULL;
  END IF;

  event_payload := jsonb_strip_nulls(jsonb_build_object(
    'taskId', NEW.id,
    'caseId', NEW.case_id,
    'caseItemId', NEW.case_item_id,
    'taskTitle', NEW.title,
    'dueAt', NEW.due_at,
    'taskPriority', NEW.priority,
    'delegationStatus', NEW.delegation_status,
    'statusCode', NEW.status_code,
    'delegatorUserId', NEW.delegator_user_id,
    'assigneeUserId', NEW.assignee_user_id
  ));

  delegation_dedupe_suffix := NEW.id::text || ':'
    || NEW.assignee_user_id::text || ':'
    || coalesce(extract(epoch FROM NEW.delegated_at)::text, 'unknown'::text);

  IF TG_OP = 'INSERT' THEN
    emit_delegated := true;
    emit_accepted := NEW.delegation_status = 'accepted'::text;
    emit_rejected := NEW.delegation_status = 'rejected'::text;
    emit_cancelled := NEW.delegation_status = 'cancelled'::text;
    emit_completed := NEW.status_code = 'done'::text;
  ELSE
    emit_delegated := (
      NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id
      AND NEW.delegation_status = 'pending'::text
    ) OR (
      NEW.delegation_status = 'pending'::text
      AND OLD.delegation_status = 'not_delegated'::text
    );
    emit_accepted := NEW.delegation_status = 'accepted'::text
      AND NEW.delegation_status IS DISTINCT FROM OLD.delegation_status;
    emit_rejected := NEW.delegation_status = 'rejected'::text
      AND NEW.delegation_status IS DISTINCT FROM OLD.delegation_status;
    emit_cancelled := NEW.delegation_status = 'cancelled'::text
      AND NEW.delegation_status IS DISTINCT FROM OLD.delegation_status;
    emit_completed := NEW.status_code = 'done'::text
      AND NEW.status_code IS DISTINCT FROM OLD.status_code;
  END IF;

  IF emit_delegated THEN
    event_actor_user_id := coalesce(caller_user_id, NEW.delegator_user_id);

    PERFORM private.enqueue_staff_notification(
      NEW.organization_id,
      NEW.assignee_user_id,
      'crm.task.delegated'::text,
      'crm.task.delegated:'::text || delegation_dedupe_suffix,
      event_payload,
      NEW.priority,
      event_actor_user_id,
      'crm_task'::text,
      NEW.id::text,
      1,
      coalesce(NEW.delegated_at, NEW.created_at)
    );
  END IF;

  IF emit_accepted THEN
    event_actor_user_id := coalesce(caller_user_id, NEW.assignee_user_id);

    PERFORM private.enqueue_staff_notification(
      NEW.organization_id,
      NEW.delegator_user_id,
      'crm.task.accepted'::text,
      'crm.task.accepted:'::text || NEW.id::text || ':'
        || extract(epoch FROM coalesce(NEW.accepted_at, NEW.updated_at))::text,
      event_payload,
      NEW.priority,
      event_actor_user_id,
      'crm_task'::text,
      NEW.id::text,
      1,
      coalesce(NEW.accepted_at, NEW.updated_at)
    );
  END IF;

  IF emit_rejected THEN
    event_actor_user_id := coalesce(caller_user_id, NEW.assignee_user_id);

    PERFORM private.enqueue_staff_notification(
      NEW.organization_id,
      NEW.delegator_user_id,
      'crm.task.rejected'::text,
      'crm.task.rejected:'::text || NEW.id::text || ':'
        || extract(epoch FROM coalesce(NEW.rejected_at, NEW.updated_at))::text,
      event_payload,
      NEW.priority,
      event_actor_user_id,
      'crm_task'::text,
      NEW.id::text,
      1,
      coalesce(NEW.rejected_at, NEW.updated_at)
    );
  END IF;

  IF emit_cancelled THEN
    event_actor_user_id := coalesce(caller_user_id, NEW.delegator_user_id);

    PERFORM private.enqueue_staff_notification(
      NEW.organization_id,
      NEW.assignee_user_id,
      'crm.task.cancelled'::text,
      'crm.task.cancelled:'::text || NEW.id::text || ':'
        || extract(epoch FROM coalesce(NEW.cancelled_at, NEW.updated_at))::text,
      event_payload,
      NEW.priority,
      event_actor_user_id,
      'crm_task'::text,
      NEW.id::text,
      1,
      coalesce(NEW.cancelled_at, NEW.updated_at)
    );
  END IF;

  IF emit_completed THEN
    event_actor_user_id := coalesce(caller_user_id, NEW.assignee_user_id);

    PERFORM private.enqueue_staff_notification(
      NEW.organization_id,
      NEW.delegator_user_id,
      'crm.task.completed'::text,
      'crm.task.completed:'::text || NEW.id::text || ':'
        || extract(epoch FROM coalesce(NEW.completed_at, NEW.updated_at))::text,
      event_payload,
      NEW.priority,
      event_actor_user_id,
      'crm_task'::text,
      NEW.id::text,
      1,
      coalesce(NEW.completed_at, NEW.updated_at)
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_crm_task_delegation_change()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER notify_crm_task_delegation_change
  AFTER INSERT OR UPDATE OF
    assignee_user_id,
    delegation_status,
    status_code
  ON public.crm_tasks
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_crm_task_delegation_change();

CREATE FUNCTION private.notify_crm_case_item_handoff_change()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  caller_user_id uuid := (SELECT app.current_user_id());
  event_actor_user_id uuid;
  event_recipient_user_id uuid;
  event_type text;
  event_occurred_at timestamp with time zone;
  case_item_title text;
  event_payload jsonb;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  ELSIF NEW.status <> 'pending'::text THEN
    RETURN NEW;
  END IF;

  IF caller_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = NEW.organization_id
      AND membership.user_id = caller_user_id
  ) THEN
    caller_user_id := NULL;
  END IF;

  SELECT item.title
  INTO case_item_title
  FROM public.crm_case_items AS item
  WHERE item.organization_id = NEW.organization_id
    AND item.case_id = NEW.case_id
    AND item.id = NEW.case_item_id;

  IF TG_OP = 'INSERT' THEN
    event_type := 'crm.case_item_handoff.requested'::text;
    event_recipient_user_id := NEW.proposed_owner_user_id;
    event_actor_user_id := coalesce(caller_user_id, NEW.requested_by_user_id);
    event_occurred_at := NEW.requested_at;
  ELSIF NEW.status = 'accepted'::text THEN
    event_type := 'crm.case_item_handoff.accepted'::text;
    event_recipient_user_id := NEW.requested_by_user_id;
    event_actor_user_id := coalesce(caller_user_id, NEW.resolved_by_user_id);
    event_occurred_at := NEW.resolved_at;
  ELSIF NEW.status = 'rejected'::text THEN
    event_type := 'crm.case_item_handoff.rejected'::text;
    event_recipient_user_id := NEW.requested_by_user_id;
    event_actor_user_id := coalesce(caller_user_id, NEW.resolved_by_user_id);
    event_occurred_at := NEW.resolved_at;
  ELSIF NEW.status = 'cancelled'::text THEN
    event_type := 'crm.case_item_handoff.cancelled'::text;
    event_recipient_user_id := NEW.proposed_owner_user_id;
    event_actor_user_id := coalesce(caller_user_id, NEW.resolved_by_user_id);
    event_occurred_at := NEW.resolved_at;
  ELSE
    RETURN NEW;
  END IF;

  event_payload := jsonb_strip_nulls(jsonb_build_object(
    'handoffId', NEW.id,
    'caseId', NEW.case_id,
    'caseItemId', NEW.case_item_id,
    'caseItemTitle', case_item_title,
    'previousOwnerUserId', NEW.previous_owner_user_id,
    'proposedOwnerUserId', NEW.proposed_owner_user_id,
    'status', NEW.status,
    'requestedAt', NEW.requested_at,
    'resolvedAt', NEW.resolved_at
  ));

  PERFORM private.enqueue_staff_notification(
    NEW.organization_id,
    event_recipient_user_id,
    event_type,
    event_type || ':'::text || NEW.id::text,
    event_payload,
    'normal'::text,
    event_actor_user_id,
    'crm_case_item_handoff'::text,
    NEW.id::text,
    1,
    coalesce(event_occurred_at, statement_timestamp())
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.notify_crm_case_item_handoff_change()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER notify_crm_case_item_handoff_change
  AFTER INSERT OR UPDATE OF status
  ON public.crm_case_item_handoffs
  FOR EACH ROW
  EXECUTE FUNCTION private.notify_crm_case_item_handoff_change();

ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_inbox_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_delivery_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all
  ON public.notification_events
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY openexpert_service_all
  ON public.user_notifications
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY openexpert_service_all
  ON public.notification_inbox_states
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY openexpert_service_all
  ON public.notification_delivery_jobs
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

-- Raw event payloads and delivery jobs are intentionally not exposed as
-- tables. Authenticated callers receive their bounded feed through the RPC.
CREATE POLICY user_notifications_recipient_read
  ON public.user_notifications
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = (SELECT app.current_user_id())
    AND private.is_organization_member(organization_id)
  );

CREATE POLICY notification_inbox_states_recipient_read
  ON public.notification_inbox_states
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT app.current_user_id())
    AND private.is_organization_member(organization_id)
  );

REVOKE ALL ON TABLE public.notification_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.user_notifications
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.notification_inbox_states
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.notification_delivery_jobs
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT ON TABLE public.notification_events TO openexpert_service;
GRANT SELECT ON TABLE public.user_notifications TO openexpert_service;
GRANT SELECT ON TABLE public.notification_inbox_states TO openexpert_service;
GRANT SELECT ON TABLE public.notification_delivery_jobs TO openexpert_service;

GRANT SELECT ON TABLE public.user_notifications TO authenticated;
GRANT SELECT ON TABLE public.notification_inbox_states TO authenticated;
