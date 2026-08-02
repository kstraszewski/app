-- Durable organization-scoped invalidation cursor for the expert forum.
-- PostgreSQL remains the source of truth. Realtime transports only fan out
-- identifiers and a revision; clients always rehydrate committed rows.

CREATE TABLE public.forum_realtime_state (
  organization_id uuid NOT NULL,
  revision bigint DEFAULT 0 NOT NULL,
  last_event jsonb,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_realtime_state_pkey PRIMARY KEY (organization_id),
  CONSTRAINT forum_realtime_state_revision_check CHECK (revision >= 0),
  CONSTRAINT forum_realtime_state_event_check CHECK (
    last_event IS NULL
    OR (
      jsonb_typeof(last_event) = 'object'
      AND pg_column_size(last_event) <= 4096
    )
  ),
  CONSTRAINT forum_realtime_state_organization_fkey FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id) ON DELETE CASCADE
);

COMMENT ON TABLE public.forum_realtime_state IS
  'One monotonic forum-change cursor per organization. Payloads contain identifiers only and are safe to fan out through realtime transports.';

CREATE FUNCTION private.capture_forum_realtime_change()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_organization_id uuid;
  target_thread_id uuid;
  target_post_id uuid;
  target_category_id uuid;
  event_kind text;
  event_payload jsonb;
BEGIN
  -- Ignore timestamp-only category writes.
  IF TG_TABLE_NAME = 'forum_categories' THEN
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(OLD) - ARRAY['updated_at']::text[])
         = (to_jsonb(NEW) - ARRAY['updated_at']::text[]) THEN
      RETURN NEW;
    END IF;

    target_organization_id := NEW.organization_id;
    target_category_id := NEW.id;
    event_kind := CASE WHEN TG_OP = 'INSERT'
      THEN 'category.created'
      ELSE 'category.updated'
    END;
  -- Opening a thread may change view_count. That is intentionally not a
  -- broadcast event; every visible/content/status change still advances the cursor.
  ELSIF TG_TABLE_NAME = 'forum_threads' THEN
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(OLD) - ARRAY['view_count', 'updated_at']::text[])
         = (to_jsonb(NEW) - ARRAY['view_count', 'updated_at']::text[]) THEN
      RETURN NEW;
    END IF;

    target_organization_id := NEW.organization_id;
    target_thread_id := NEW.id;
    target_category_id := NEW.category_id;
    event_kind := CASE WHEN TG_OP = 'INSERT'
      THEN 'thread.created'
      ELSE 'thread.updated'
    END;
  ELSIF TG_TABLE_NAME = 'forum_posts' THEN
    IF TG_OP = 'UPDATE'
       AND (to_jsonb(OLD) - ARRAY['updated_at']::text[])
         = (to_jsonb(NEW) - ARRAY['updated_at']::text[]) THEN
      RETURN NEW;
    END IF;

    target_organization_id := NEW.organization_id;
    target_thread_id := NEW.thread_id;
    target_post_id := NEW.id;
    event_kind := CASE
      WHEN TG_OP = 'INSERT' AND NEW.kind = 'reply' THEN 'reply.created'
      WHEN TG_OP = 'INSERT' THEN 'post.created'
      ELSE 'post.updated'
    END;
  ELSE
    RETURN NEW;
  END IF;

  event_payload := jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1,
    'eventId', gen_random_uuid(),
    'kind', event_kind,
    'organizationId', target_organization_id,
    'threadId', target_thread_id,
    'postId', target_post_id,
    'categoryId', target_category_id,
    'occurredAt', statement_timestamp()
  ));

  INSERT INTO public.forum_realtime_state (
    organization_id,
    revision,
    last_event,
    updated_at
  ) VALUES (
    target_organization_id,
    1,
    event_payload,
    statement_timestamp()
  )
  ON CONFLICT (organization_id) DO UPDATE
  SET
    revision = public.forum_realtime_state.revision + 1,
    last_event = excluded.last_event,
    updated_at = excluded.updated_at;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.capture_forum_realtime_change()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER capture_forum_category_realtime_change
  AFTER INSERT OR UPDATE ON public.forum_categories
  FOR EACH ROW EXECUTE FUNCTION private.capture_forum_realtime_change();

CREATE TRIGGER capture_forum_thread_realtime_change
  AFTER INSERT OR UPDATE ON public.forum_threads
  FOR EACH ROW EXECUTE FUNCTION private.capture_forum_realtime_change();

CREATE TRIGGER capture_forum_post_realtime_change
  AFTER INSERT OR UPDATE ON public.forum_posts
  FOR EACH ROW EXECUTE FUNCTION private.capture_forum_realtime_change();

CREATE FUNCTION public.get_organization_forum_realtime_state(
  p_organization_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  current_revision bigint;
  current_event jsonb;
  current_updated_at timestamp with time zone;
BEGIN
  IF (SELECT app.current_user_id()) IS NULL
     OR NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  SELECT
    state.revision,
    state.last_event,
    state.updated_at
  INTO
    current_revision,
    current_event,
    current_updated_at
  FROM public.forum_realtime_state AS state
  WHERE state.organization_id = p_organization_id;

  current_revision := coalesce(current_revision, 0);

  RETURN jsonb_build_object(
    'revision', current_revision,
    'lastEvent', CASE
      WHEN current_event IS NULL THEN NULL
      ELSE current_event || jsonb_build_object('revision', current_revision)
    END,
    'updatedAt', current_updated_at
  );
END;
$$;

ALTER TABLE public.forum_realtime_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all ON public.forum_realtime_state
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);

CREATE POLICY forum_realtime_state_member_read ON public.forum_realtime_state
  FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

REVOKE ALL ON TABLE public.forum_realtime_state
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT ON TABLE public.forum_realtime_state TO authenticated;

REVOKE ALL ON FUNCTION public.get_organization_forum_realtime_state(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_organization_forum_realtime_state(uuid)
  TO authenticated;
