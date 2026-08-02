-- Organization-scoped forum administration and moderation.
-- Administrative permissions are resolved through the existing role catalogue;
-- organization administrators inherit both forum permissions through that catalogue.

INSERT INTO public.administrative_roles (
  role_key,
  label,
  description,
  risk_level,
  sort_order
)
VALUES (
  'forum_admin',
  'Administrator forum',
  'Moderuje dyskusje ekspertów i zarządza kategoriami forum w swojej organizacji.',
  'standard',
  60
)
ON CONFLICT (role_key) DO UPDATE
SET
  label = excluded.label,
  description = excluded.description,
  risk_level = excluded.risk_level,
  sort_order = excluded.sort_order;

INSERT INTO public.administrative_role_permissions (role_key, permission_key)
VALUES
  ('forum_admin', 'forum.moderate'),
  ('forum_admin', 'forum.categories.manage'),
  ('organization_admin', 'forum.moderate'),
  ('organization_admin', 'forum.categories.manage')
ON CONFLICT (role_key, permission_key) DO NOTHING;

ALTER TABLE public.organization_user_admin_roles
  DROP CONSTRAINT organization_user_admin_roles_role_valid;

ALTER TABLE public.organization_user_admin_roles
  ADD CONSTRAINT organization_user_admin_roles_role_valid CHECK (
    role_key = ANY (ARRAY[
      'access_admin'::text,
      'structure_admin'::text,
      'consents_admin'::text,
      'crm_config_admin'::text,
      'forum_admin'::text
    ])
  );

CREATE TABLE public.forum_moderation_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  actor_user_id uuid,
  actor_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  reason text,
  before_state jsonb DEFAULT '{}'::jsonb NOT NULL,
  after_state jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT statement_timestamp() NOT NULL,
  CONSTRAINT forum_moderation_events_pkey PRIMARY KEY (id),
  CONSTRAINT forum_moderation_events_action_check CHECK (
    action = ANY (ARRAY[
      'hide'::text,
      'restore'::text,
      'close'::text,
      'reopen'::text,
      'move'::text,
      'create'::text,
      'update'::text
    ])
  ),
  CONSTRAINT forum_moderation_events_target_type_check CHECK (
    target_type = ANY (ARRAY['thread'::text, 'post'::text, 'category'::text])
  ),
  CONSTRAINT forum_moderation_events_reason_check CHECK (
    reason IS NULL OR char_length(btrim(reason)) BETWEEN 5 AND 1000
  ),
  CONSTRAINT forum_moderation_events_snapshots_check CHECK (
    jsonb_typeof(actor_snapshot) = 'object'
    AND jsonb_typeof(before_state) = 'object'
    AND jsonb_typeof(after_state) = 'object'
    AND pg_column_size(actor_snapshot) <= 16384
    AND pg_column_size(before_state) <= 32768
    AND pg_column_size(after_state) <= 32768
  ),
  CONSTRAINT forum_moderation_events_organization_fkey FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id) ON DELETE RESTRICT
);

CREATE INDEX forum_moderation_events_tenant_timeline_idx
  ON public.forum_moderation_events (organization_id, created_at DESC, id DESC);

COMMENT ON TABLE public.forum_moderation_events IS
  'Append-only, organization-scoped audit history for every forum moderation and category-management change.';

CREATE FUNCTION private.prevent_forum_moderation_event_mutation()
RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
BEGIN
  RAISE EXCEPTION 'forum_moderation_audit_is_immutable' USING errcode = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_forum_moderation_event_mutation()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER prevent_forum_moderation_event_mutation
  BEFORE UPDATE OR DELETE ON public.forum_moderation_events
  FOR EACH ROW EXECUTE FUNCTION private.prevent_forum_moderation_event_mutation();

CREATE FUNCTION private.forum_moderation_actor_snapshot(p_actor_user_id uuid)
RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT coalesce(
    (
      SELECT jsonb_build_object(
        'id', app_user.id,
        'name', coalesce(app_user.full_name, app_user.email, 'Użytkownik'),
        'email', app_user.email,
        'avatarUrl', app_user.avatar_url
      )
      FROM public.users AS app_user
      WHERE app_user.id = p_actor_user_id
    ),
    jsonb_build_object('id', p_actor_user_id)
  )
  $$;

REVOKE ALL ON FUNCTION private.forum_moderation_actor_snapshot(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.forum_thread_moderation_state(
  p_organization_id uuid,
  p_thread_id uuid
) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT jsonb_build_object(
    'id', thread.id,
    'categoryId', thread.category_id,
    'status', thread.status,
    'isHidden', thread.is_hidden,
    'hiddenAt', thread.hidden_at,
    'hiddenByUserId', thread.hidden_by_user_id,
    'hiddenReason', thread.hidden_reason,
    'question', coalesce(
      (
        SELECT jsonb_build_object(
          'id', question.id,
          'isHidden', question.is_hidden,
          'hiddenAt', question.hidden_at,
          'hiddenByUserId', question.hidden_by_user_id,
          'hiddenReason', question.hidden_reason
        )
        FROM public.forum_posts AS question
        WHERE question.organization_id = thread.organization_id
          AND question.thread_id = thread.id
          AND question.kind = 'question'
      ),
      '{}'::jsonb
    )
  )
  FROM public.forum_threads AS thread
  WHERE thread.organization_id = p_organization_id
    AND thread.id = p_thread_id
  $$;

REVOKE ALL ON FUNCTION private.forum_thread_moderation_state(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.forum_post_moderation_state(
  p_organization_id uuid,
  p_post_id uuid
) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT jsonb_build_object(
    'id', post.id,
    'threadId', post.thread_id,
    'kind', post.kind,
    'isHidden', post.is_hidden,
    'hiddenAt', post.hidden_at,
    'hiddenByUserId', post.hidden_by_user_id,
    'hiddenReason', post.hidden_reason,
    'thread', private.forum_thread_moderation_state(post.organization_id, post.thread_id)
  )
  FROM public.forum_posts AS post
  WHERE post.organization_id = p_organization_id
    AND post.id = p_post_id
  $$;

REVOKE ALL ON FUNCTION private.forum_post_moderation_state(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.forum_category_json(
  p_organization_id uuid,
  p_category_id uuid
) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT jsonb_build_object(
    'id', category.id,
    'slug', category.slug,
    'name', category.name,
    'description', category.description,
    'icon', category.icon,
    'color', category.color,
    'sortOrder', category.sort_order,
    'isActive', category.is_active,
    'threadCount', (
      SELECT count(*)
      FROM public.forum_threads AS thread
      WHERE thread.organization_id = category.organization_id
        AND thread.category_id = category.id
        AND NOT thread.is_hidden
    ),
    'createdAt', category.created_at,
    'updatedAt', category.updated_at
  )
  FROM public.forum_categories AS category
  WHERE category.organization_id = p_organization_id
    AND category.id = p_category_id
  $$;

REVOKE ALL ON FUNCTION private.forum_category_json(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.record_forum_moderation_event(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_before_state jsonb,
  p_after_state jsonb
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  inserted_id uuid;
BEGIN
  INSERT INTO public.forum_moderation_events (
    organization_id,
    actor_user_id,
    actor_snapshot,
    action,
    target_type,
    target_id,
    reason,
    before_state,
    after_state
  ) VALUES (
    p_organization_id,
    p_actor_user_id,
    private.forum_moderation_actor_snapshot(p_actor_user_id),
    p_action,
    p_target_type,
    p_target_id,
    nullif(btrim(p_reason), ''),
    coalesce(p_before_state, '{}'::jsonb),
    coalesce(p_after_state, '{}'::jsonb)
  )
  RETURNING id INTO inserted_id;

  RETURN inserted_id;
END;
$$;

REVOKE ALL ON FUNCTION private.record_forum_moderation_event(
  uuid, uuid, text, text, uuid, text, jsonb, jsonb
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.refresh_forum_category_search_documents()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_post record;
BEGIN
  IF old.is_active IS NOT DISTINCT FROM new.is_active THEN
    RETURN new;
  END IF;

  FOR target_post IN
    SELECT post.id
    FROM public.forum_posts AS post
    JOIN public.forum_threads AS thread
      ON thread.organization_id = post.organization_id
     AND thread.id = post.thread_id
    WHERE thread.organization_id = new.organization_id
      AND thread.category_id = new.id
  LOOP
    PERFORM private.upsert_forum_search_document(new.organization_id, target_post.id);
  END LOOP;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_forum_category_search_documents()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER refresh_forum_category_search_documents
  AFTER UPDATE OF is_active ON public.forum_categories
  FOR EACH ROW EXECUTE FUNCTION private.refresh_forum_category_search_documents();

CREATE OR REPLACE FUNCTION private.forum_author_json(
  p_organization_id uuid,
  p_user_id uuid
) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT jsonb_build_object(
    'id', membership.user_id,
    'name', coalesce(app_user.full_name, profile.display_name, app_user.email, 'Użytkownik'),
    'avatarUrl', app_user.avatar_url,
    'role', membership.role,
    'roleLabel', CASE
      WHEN membership.role = 'admin' THEN 'Administracja'
      WHEN private.user_has_administrative_role(
        membership.organization_id,
        membership.user_id,
        'forum_admin'
      ) THEN 'Administrator forum'
      ELSE 'Zweryfikowany ekspert'
    END,
    'expertise', brand.professional_title
  )
  FROM public.organization_memberships AS membership
  LEFT JOIN public.users AS app_user
    ON app_user.id = membership.user_id
  LEFT JOIN public.profiles AS profile
    ON profile.id = membership.user_id
  LEFT JOIN public.expert_brand_profiles AS brand
    ON brand.organization_id = membership.organization_id
   AND brand.user_id = membership.user_id
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = p_user_id
  $$;

CREATE OR REPLACE FUNCTION private.forum_post_json(p_post_id uuid)
RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT jsonb_build_object(
    'id', post.id,
    'threadId', post.thread_id,
    'kind', post.kind,
    'content', CASE
      WHEN NOT post.is_hidden
        OR private.has_administrative_permission(post.organization_id, 'forum.moderate')
      THEN post.content
      ELSE NULL
    END,
    'body', CASE
      WHEN NOT post.is_hidden
        OR private.has_administrative_permission(post.organization_id, 'forum.moderate')
      THEN post.content
      ELSE NULL
    END,
    'author', private.forum_author_json(post.organization_id, post.author_user_id),
    'isVerifiedExpertAnswer', post.is_verified_expert_answer,
    'isOfficialAdminAnswer', post.is_official_admin_answer,
    'isAcceptedAnswer', post.is_accepted_answer,
    'isHidden', post.is_hidden,
    'hiddenAt', post.hidden_at,
    'hiddenReason', CASE
      WHEN private.has_administrative_permission(post.organization_id, 'forum.moderate')
      THEN post.hidden_reason
      ELSE NULL
    END,
    'hiddenBy', CASE
      WHEN post.hidden_by_user_id IS NOT NULL
        AND private.has_administrative_permission(post.organization_id, 'forum.moderate')
      THEN private.forum_author_json(post.organization_id, post.hidden_by_user_id)
      ELSE NULL
    END,
    'createdAt', post.created_at,
    'updatedAt', post.updated_at,
    'sources', '[]'::jsonb
  )
  FROM public.forum_posts AS post
  WHERE post.id = p_post_id
  $$;

CREATE OR REPLACE FUNCTION private.forum_thread_summary_json(
  p_thread_id uuid,
  p_matched_in text DEFAULT NULL,
  p_snippet text DEFAULT NULL,
  p_score double precision DEFAULT NULL
) RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
  SELECT jsonb_build_object(
    'id', thread.id,
    'title', thread.title,
    'type', thread.thread_type,
    'status', thread.status,
    'category', jsonb_build_object(
      'id', category.id,
      'slug', category.slug,
      'name', category.name,
      'icon', category.icon,
      'color', category.color
    ),
    'categoryId', category.id,
    'excerpt', CASE
      WHEN question.is_hidden
        AND NOT private.has_administrative_permission(thread.organization_id, 'forum.moderate')
      THEN NULL
      ELSE left(regexp_replace(question.content, '\s+', ' ', 'g'), 360)
    END,
    'author', private.forum_author_json(thread.organization_id, thread.author_user_id),
    'replyCount', thread.reply_count,
    'participantCount', thread.participant_count,
    'viewCount', thread.view_count,
    'createdAt', thread.created_at,
    'updatedAt', thread.updated_at,
    'lastActivityAt', thread.last_activity_at,
    'acceptedPostId', thread.accepted_post_id,
    'hasVerifiedExpertAnswer', thread.has_verified_expert_answer,
    'hasOfficialAdminAnswer', thread.has_official_admin_answer,
    'matchedIn', p_matched_in,
    'snippet', p_snippet,
    'score', p_score,
    'languageCode', thread.language_code,
    'visibility', thread.visibility,
    'isHidden', thread.is_hidden,
    'hiddenAt', thread.hidden_at,
    'hiddenReason', CASE
      WHEN private.has_administrative_permission(thread.organization_id, 'forum.moderate')
      THEN thread.hidden_reason
      ELSE NULL
    END,
    'hiddenBy', CASE
      WHEN thread.hidden_by_user_id IS NOT NULL
        AND private.has_administrative_permission(thread.organization_id, 'forum.moderate')
      THEN private.forum_author_json(thread.organization_id, thread.hidden_by_user_id)
      ELSE NULL
    END
  )
  FROM public.forum_threads AS thread
  JOIN public.forum_categories AS category
    ON category.organization_id = thread.organization_id
   AND category.id = thread.category_id
  JOIN public.forum_posts AS question
    ON question.organization_id = thread.organization_id
   AND question.thread_id = thread.id
   AND question.kind = 'question'
  WHERE thread.id = p_thread_id
  $$;

CREATE OR REPLACE FUNCTION public.get_organization_forum_thread(
  p_organization_id uuid,
  p_thread_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_thread public.forum_threads%rowtype;
  question_content text;
  posts_json jsonb;
  summary_json jsonb;
  can_view_hidden boolean;
BEGIN
  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  can_view_hidden := private.has_administrative_permission(
    p_organization_id,
    'forum.moderate'
  );

  SELECT thread.*
  INTO target_thread
  FROM public.forum_threads AS thread
  WHERE thread.organization_id = p_organization_id
    AND thread.id = p_thread_id
    AND (NOT thread.is_hidden OR can_view_hidden);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_thread_not_found' USING errcode = 'P0002';
  END IF;

  SELECT post.content
  INTO question_content
  FROM public.forum_posts AS post
  WHERE post.organization_id = target_thread.organization_id
    AND post.thread_id = target_thread.id
    AND post.kind = 'question'
    AND (NOT post.is_hidden OR can_view_hidden);

  SELECT coalesce(
    jsonb_agg(private.forum_post_json(post.id) ORDER BY post.created_at, post.id),
    '[]'::jsonb
  )
  INTO posts_json
  FROM public.forum_posts AS post
  WHERE post.organization_id = target_thread.organization_id
    AND post.thread_id = target_thread.id
    AND (NOT post.is_hidden OR can_view_hidden);

  summary_json := private.forum_thread_summary_json(target_thread.id);

  RETURN jsonb_build_object(
    'thread', summary_json || jsonb_build_object(
      'content', question_content,
      'body', question_content,
      'posts', posts_json,
      'relatedThreads', '[]'::jsonb
    ),
    'posts', posts_json,
    'relatedThreads', '[]'::jsonb
  );
END;
$$;

CREATE FUNCTION public.get_organization_forum_moderation_context(
  p_organization_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  is_organization_admin boolean;
  is_forum_admin boolean;
  can_moderate boolean;
  can_manage_categories boolean;
BEGIN
  IF actor_user_id IS NULL OR NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  is_organization_admin := private.is_organization_admin(p_organization_id);
  is_forum_admin := private.user_has_administrative_role(
    p_organization_id,
    actor_user_id,
    'forum_admin'
  );
  can_moderate := private.has_administrative_permission(
    p_organization_id,
    'forum.moderate'
  );
  can_manage_categories := private.has_administrative_permission(
    p_organization_id,
    'forum.categories.manage'
  );

  RETURN jsonb_build_object(
    'canModerate', can_moderate,
    'canManageCategories', can_manage_categories,
    'isForumAdmin', is_forum_admin,
    'isOrganizationAdmin', is_organization_admin,
    'roleLabel', CASE
      WHEN is_organization_admin THEN 'Administrator organizacji'
      WHEN is_forum_admin THEN 'Administrator forum'
      WHEN can_moderate THEN 'Moderator forum'
      ELSE NULL
    END
  );
END;
$$;

CREATE FUNCTION public.list_organization_forum_moderation_items(
  p_organization_id uuid,
  p_limit integer DEFAULT 50
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  hidden_threads jsonb;
  hidden_posts jsonb;
  item_total integer;
BEGIN
  IF NOT private.has_administrative_permission(p_organization_id, 'forum.moderate') THEN
    RAISE EXCEPTION 'forum_moderation_forbidden' USING errcode = '42501';
  END IF;

  IF p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'forum_moderation_limit_invalid' USING errcode = '22023';
  END IF;

  SELECT coalesce(
    jsonb_agg(item.payload ORDER BY item.hidden_at DESC, item.id DESC),
    '[]'::jsonb
  )
  INTO hidden_threads
  FROM (
    SELECT
      thread.id,
      thread.hidden_at,
      jsonb_build_object(
        'targetType', 'thread',
        'id', thread.id,
        'threadId', thread.id,
        'title', thread.title,
        'excerpt', left(regexp_replace(question.content, '\s+', ' ', 'g'), 220),
        'author', private.forum_author_json(thread.organization_id, thread.author_user_id),
        'hiddenAt', thread.hidden_at,
        'hiddenBy', CASE
          WHEN thread.hidden_by_user_id IS NULL THEN NULL
          ELSE private.forum_author_json(thread.organization_id, thread.hidden_by_user_id)
        END,
        'reason', thread.hidden_reason
      ) AS payload
    FROM public.forum_threads AS thread
    LEFT JOIN public.forum_posts AS question
      ON question.organization_id = thread.organization_id
     AND question.thread_id = thread.id
     AND question.kind = 'question'
    WHERE thread.organization_id = p_organization_id
      AND thread.is_hidden
    ORDER BY thread.hidden_at DESC, thread.id DESC
    LIMIT p_limit
  ) AS item;

  SELECT coalesce(
    jsonb_agg(item.payload ORDER BY item.hidden_at DESC, item.id DESC),
    '[]'::jsonb
  )
  INTO hidden_posts
  FROM (
    SELECT
      post.id,
      post.hidden_at,
      jsonb_build_object(
        'targetType', 'post',
        'id', post.id,
        'postId', post.id,
        'threadId', thread.id,
        'threadTitle', thread.title,
        'title', thread.title,
        'excerpt', left(regexp_replace(post.content, '\s+', ' ', 'g'), 220),
        'author', private.forum_author_json(post.organization_id, post.author_user_id),
        'hiddenAt', post.hidden_at,
        'hiddenBy', CASE
          WHEN post.hidden_by_user_id IS NULL THEN NULL
          ELSE private.forum_author_json(post.organization_id, post.hidden_by_user_id)
        END,
        'reason', post.hidden_reason
      ) AS payload
    FROM public.forum_posts AS post
    JOIN public.forum_threads AS thread
      ON thread.organization_id = post.organization_id
     AND thread.id = post.thread_id
    WHERE post.organization_id = p_organization_id
      AND post.is_hidden
    ORDER BY post.hidden_at DESC, post.id DESC
    LIMIT p_limit
  ) AS item;

  SELECT
    (SELECT count(*) FROM public.forum_threads AS thread
      WHERE thread.organization_id = p_organization_id AND thread.is_hidden)
    +
    (SELECT count(*) FROM public.forum_posts AS post
      WHERE post.organization_id = p_organization_id AND post.is_hidden)
  INTO item_total;

  RETURN jsonb_build_object(
    'hiddenThreads', hidden_threads,
    'hiddenPosts', hidden_posts,
    'total', item_total
  );
END;
$$;

CREATE FUNCTION public.moderate_organization_forum_thread(
  p_organization_id uuid,
  p_thread_id uuid,
  p_action text,
  p_reason text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  normalized_reason text := nullif(btrim(p_reason), '');
  target_thread public.forum_threads%rowtype;
  before_state jsonb;
  after_state jsonb;
  audit_event_id uuid;
  changed boolean := false;
BEGIN
  IF actor_user_id IS NULL
    OR NOT private.has_administrative_permission(p_organization_id, 'forum.moderate')
  THEN
    RAISE EXCEPTION 'forum_moderation_forbidden' USING errcode = '42501';
  END IF;

  IF p_action IS NULL OR p_action <> ALL (ARRAY['hide', 'restore', 'close', 'reopen', 'move']) THEN
    RAISE EXCEPTION 'forum_thread_moderation_action_invalid' USING errcode = '22023';
  END IF;
  IF p_action = 'hide'
    AND (normalized_reason IS NULL OR char_length(normalized_reason) NOT BETWEEN 5 AND 1000)
  THEN
    RAISE EXCEPTION 'forum_hide_reason_required' USING errcode = '22023';
  END IF;
  IF normalized_reason IS NOT NULL
    AND char_length(normalized_reason) NOT BETWEEN 5 AND 1000
  THEN
    RAISE EXCEPTION 'forum_moderation_reason_invalid' USING errcode = '22023';
  END IF;
  IF p_action = 'move' AND p_category_id IS NULL THEN
    RAISE EXCEPTION 'forum_move_category_required' USING errcode = '22023';
  END IF;
  IF p_action <> 'move' AND p_category_id IS NOT NULL THEN
    RAISE EXCEPTION 'forum_move_category_not_allowed' USING errcode = '22023';
  END IF;

  SELECT thread.*
  INTO target_thread
  FROM public.forum_threads AS thread
  WHERE thread.organization_id = p_organization_id
    AND thread.id = p_thread_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_thread_not_found' USING errcode = 'P0002';
  END IF;

  before_state := private.forum_thread_moderation_state(p_organization_id, p_thread_id);

  CASE p_action
    WHEN 'hide' THEN
      IF NOT target_thread.is_hidden THEN
        UPDATE public.forum_threads AS thread
        SET
          is_hidden = true,
          hidden_at = statement_timestamp(),
          hidden_by_user_id = actor_user_id,
          hidden_reason = normalized_reason
        WHERE thread.organization_id = p_organization_id
          AND thread.id = p_thread_id;
        changed := true;
      END IF;

    WHEN 'restore' THEN
      IF target_thread.is_hidden THEN
        UPDATE public.forum_threads AS thread
        SET
          is_hidden = false,
          hidden_at = NULL,
          hidden_by_user_id = NULL,
          hidden_reason = NULL,
          metadata = thread.metadata - 'questionHiddenByPostId'
        WHERE thread.organization_id = p_organization_id
          AND thread.id = p_thread_id;
        changed := true;
      END IF;

      -- A root question is the thread itself from a moderation perspective.
      -- Repair legacy/inconsistent states while restoring the thread.
      UPDATE public.forum_posts AS question
      SET
        is_hidden = false,
        hidden_at = NULL,
        hidden_by_user_id = NULL,
        hidden_reason = NULL
      WHERE question.organization_id = p_organization_id
        AND question.thread_id = p_thread_id
        AND question.kind = 'question'
        AND question.is_hidden;
      changed := changed OR FOUND;

      UPDATE public.forum_threads AS thread
      SET metadata = thread.metadata - 'questionHiddenByPostId'
      WHERE thread.organization_id = p_organization_id
        AND thread.id = p_thread_id
        AND thread.metadata ? 'questionHiddenByPostId';

    WHEN 'close' THEN
      IF target_thread.status <> 'closed' THEN
        UPDATE public.forum_threads AS thread
        SET status = 'closed'
        WHERE thread.organization_id = p_organization_id
          AND thread.id = p_thread_id;
        changed := true;
      END IF;

    WHEN 'reopen' THEN
      IF target_thread.status = 'closed' THEN
        UPDATE public.forum_threads AS thread
        SET status = 'open'
        WHERE thread.organization_id = p_organization_id
          AND thread.id = p_thread_id;
        PERFORM private.recalculate_forum_thread_stats(p_organization_id, p_thread_id);
        changed := true;
      END IF;

    WHEN 'move' THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.forum_categories AS category
        WHERE category.organization_id = p_organization_id
          AND category.id = p_category_id
          AND category.is_active
      ) THEN
        RAISE EXCEPTION 'forum_category_not_found' USING errcode = 'P0002';
      END IF;

      IF target_thread.category_id IS DISTINCT FROM p_category_id THEN
        UPDATE public.forum_threads AS thread
        SET category_id = p_category_id
        WHERE thread.organization_id = p_organization_id
          AND thread.id = p_thread_id;
        changed := true;
      END IF;
  END CASE;

  after_state := private.forum_thread_moderation_state(p_organization_id, p_thread_id);

  IF changed THEN
    audit_event_id := private.record_forum_moderation_event(
      p_organization_id,
      actor_user_id,
      p_action,
      'thread',
      p_thread_id,
      normalized_reason,
      before_state,
      after_state
    );
  END IF;

  RETURN jsonb_build_object(
    'changed', changed,
    'auditEventId', audit_event_id,
    'thread', private.forum_thread_summary_json(p_thread_id)
  );
END;
$$;

CREATE FUNCTION public.moderate_organization_forum_post(
  p_organization_id uuid,
  p_post_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  normalized_reason text := nullif(btrim(p_reason), '');
  target_post public.forum_posts%rowtype;
  target_thread public.forum_threads%rowtype;
  before_state jsonb;
  after_state jsonb;
  audit_event_id uuid;
  changed boolean := false;
  thread_result jsonb;
BEGIN
  IF actor_user_id IS NULL
    OR NOT private.has_administrative_permission(p_organization_id, 'forum.moderate')
  THEN
    RAISE EXCEPTION 'forum_moderation_forbidden' USING errcode = '42501';
  END IF;

  IF p_action IS NULL OR p_action <> ALL (ARRAY['hide', 'restore']) THEN
    RAISE EXCEPTION 'forum_post_moderation_action_invalid' USING errcode = '22023';
  END IF;
  IF p_action = 'hide'
    AND (normalized_reason IS NULL OR char_length(normalized_reason) NOT BETWEEN 5 AND 1000)
  THEN
    RAISE EXCEPTION 'forum_hide_reason_required' USING errcode = '22023';
  END IF;
  IF normalized_reason IS NOT NULL
    AND char_length(normalized_reason) NOT BETWEEN 5 AND 1000
  THEN
    RAISE EXCEPTION 'forum_moderation_reason_invalid' USING errcode = '22023';
  END IF;

  SELECT post.*
  INTO target_post
  FROM public.forum_posts AS post
  WHERE post.organization_id = p_organization_id
    AND post.id = p_post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_post_not_found' USING errcode = 'P0002';
  END IF;

  SELECT thread.*
  INTO target_thread
  FROM public.forum_threads AS thread
  WHERE thread.organization_id = p_organization_id
    AND thread.id = target_post.thread_id
  FOR UPDATE;

  SELECT post.*
  INTO target_post
  FROM public.forum_posts AS post
  WHERE post.organization_id = p_organization_id
    AND post.id = p_post_id
  FOR UPDATE;

  IF target_post.kind = 'question' THEN
    thread_result := public.moderate_organization_forum_thread(
      p_organization_id,
      target_post.thread_id,
      p_action,
      normalized_reason,
      NULL
    );
    RETURN jsonb_build_object(
      'changed', thread_result -> 'changed',
      'auditEventId', thread_result -> 'auditEventId',
      'post', private.forum_post_json(p_post_id),
      'thread', thread_result -> 'thread'
    );
  END IF;

  before_state := private.forum_post_moderation_state(p_organization_id, p_post_id);

  IF p_action = 'hide' THEN
    IF NOT target_post.is_hidden THEN
      UPDATE public.forum_posts AS post
      SET
        is_hidden = true,
        hidden_at = statement_timestamp(),
        hidden_by_user_id = actor_user_id,
        hidden_reason = normalized_reason
      WHERE post.organization_id = p_organization_id
        AND post.id = p_post_id;
      changed := true;
    END IF;

  ELSE
    IF target_post.is_hidden THEN
      UPDATE public.forum_posts AS post
      SET
        is_hidden = false,
        hidden_at = NULL,
        hidden_by_user_id = NULL,
        hidden_reason = NULL
      WHERE post.organization_id = p_organization_id
        AND post.id = p_post_id;
      changed := true;
    END IF;

  END IF;

  after_state := private.forum_post_moderation_state(p_organization_id, p_post_id);

  IF changed THEN
    audit_event_id := private.record_forum_moderation_event(
      p_organization_id,
      actor_user_id,
      p_action,
      'post',
      p_post_id,
      normalized_reason,
      before_state,
      after_state
    );
  END IF;

  RETURN jsonb_build_object(
    'changed', changed,
    'auditEventId', audit_event_id,
    'post', private.forum_post_json(p_post_id),
    'thread', private.forum_thread_summary_json(target_post.thread_id)
  );
END;
$$;

CREATE FUNCTION public.list_organization_forum_categories(
  p_organization_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  can_manage boolean;
  categories_json jsonb;
BEGIN
  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  can_manage := private.has_administrative_permission(
    p_organization_id,
    'forum.categories.manage'
  );

  SELECT coalesce(
    jsonb_agg(
      private.forum_category_json(category.organization_id, category.id)
      ORDER BY category.sort_order, category.name, category.id
    ),
    '[]'::jsonb
  )
  INTO categories_json
  FROM public.forum_categories AS category
  WHERE category.organization_id = p_organization_id
    AND (category.is_active OR can_manage);

  RETURN jsonb_build_object('categories', categories_json);
END;
$$;

CREATE FUNCTION public.create_organization_forum_category(
  p_organization_id uuid,
  p_slug text,
  p_name text,
  p_description text DEFAULT NULL,
  p_icon text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_sort_order integer DEFAULT 100,
  p_reason text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  normalized_slug text := lower(nullif(btrim(p_slug), ''));
  normalized_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  normalized_description text := nullif(btrim(p_description), '');
  normalized_icon text := nullif(btrim(p_icon), '');
  normalized_color text := nullif(btrim(p_color), '');
  normalized_reason text := coalesce(nullif(btrim(p_reason), ''), 'Utworzenie kategorii forum');
  inserted_category public.forum_categories%rowtype;
  after_state jsonb;
  audit_event_id uuid;
BEGIN
  IF actor_user_id IS NULL
    OR NOT private.has_administrative_permission(p_organization_id, 'forum.categories.manage')
  THEN
    RAISE EXCEPTION 'forum_category_management_forbidden' USING errcode = '42501';
  END IF;

  IF normalized_slug IS NULL
    OR normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    OR char_length(normalized_slug) > 100
    OR normalized_name IS NULL
    OR char_length(normalized_name) NOT BETWEEN 2 AND 120
    OR (normalized_description IS NOT NULL AND char_length(normalized_description) > 1000)
    OR (normalized_icon IS NOT NULL AND char_length(normalized_icon) > 100)
    OR (normalized_color IS NOT NULL AND char_length(normalized_color) > 40)
    OR p_sort_order NOT BETWEEN 0 AND 100000
    OR char_length(normalized_reason) NOT BETWEEN 5 AND 1000
  THEN
    RAISE EXCEPTION 'forum_category_request_invalid' USING errcode = '22023';
  END IF;

  INSERT INTO public.forum_categories (
    organization_id,
    slug,
    name,
    description,
    icon,
    color,
    sort_order,
    is_active,
    created_by_user_id
  ) VALUES (
    p_organization_id,
    normalized_slug,
    normalized_name,
    normalized_description,
    normalized_icon,
    normalized_color,
    p_sort_order,
    true,
    actor_user_id
  )
  RETURNING * INTO inserted_category;

  after_state := private.forum_category_json(
    inserted_category.organization_id,
    inserted_category.id
  );
  audit_event_id := private.record_forum_moderation_event(
    p_organization_id,
    actor_user_id,
    'create',
    'category',
    inserted_category.id,
    normalized_reason,
    '{}'::jsonb,
    after_state
  );

  RETURN jsonb_build_object(
    'changed', true,
    'auditEventId', audit_event_id,
    'category', after_state
  );
END;
$$;

CREATE FUNCTION public.update_organization_forum_category(
  p_organization_id uuid,
  p_category_id uuid,
  p_set_slug boolean DEFAULT false,
  p_slug text DEFAULT NULL,
  p_set_name boolean DEFAULT false,
  p_name text DEFAULT NULL,
  p_set_description boolean DEFAULT false,
  p_description text DEFAULT NULL,
  p_set_icon boolean DEFAULT false,
  p_icon text DEFAULT NULL,
  p_set_color boolean DEFAULT false,
  p_color text DEFAULT NULL,
  p_set_sort_order boolean DEFAULT false,
  p_sort_order integer DEFAULT NULL,
  p_set_is_active boolean DEFAULT false,
  p_is_active boolean DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  normalized_slug text := lower(nullif(btrim(p_slug), ''));
  normalized_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
  normalized_description text := nullif(btrim(p_description), '');
  normalized_icon text := nullif(btrim(p_icon), '');
  normalized_color text := nullif(btrim(p_color), '');
  normalized_reason text := coalesce(nullif(btrim(p_reason), ''), 'Aktualizacja kategorii forum');
  target_category public.forum_categories%rowtype;
  before_state jsonb;
  after_state jsonb;
  audit_event_id uuid;
  changed boolean := false;
BEGIN
  IF actor_user_id IS NULL
    OR NOT private.has_administrative_permission(p_organization_id, 'forum.categories.manage')
  THEN
    RAISE EXCEPTION 'forum_category_management_forbidden' USING errcode = '42501';
  END IF;

  IF NOT (
    coalesce(p_set_slug, false)
    OR coalesce(p_set_name, false)
    OR coalesce(p_set_description, false)
    OR coalesce(p_set_icon, false)
    OR coalesce(p_set_color, false)
    OR coalesce(p_set_sort_order, false)
    OR coalesce(p_set_is_active, false)
  ) THEN
    RAISE EXCEPTION 'forum_category_update_empty' USING errcode = '22023';
  END IF;

  IF (p_set_slug AND (
      normalized_slug IS NULL
      OR normalized_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
      OR char_length(normalized_slug) > 100
    ))
    OR (p_set_name AND (
      normalized_name IS NULL
      OR char_length(normalized_name) NOT BETWEEN 2 AND 120
    ))
    OR (p_set_description AND normalized_description IS NOT NULL
      AND char_length(normalized_description) > 1000)
    OR (p_set_icon AND normalized_icon IS NOT NULL AND char_length(normalized_icon) > 100)
    OR (p_set_color AND normalized_color IS NOT NULL AND char_length(normalized_color) > 40)
    OR (p_set_sort_order AND (p_sort_order IS NULL OR p_sort_order NOT BETWEEN 0 AND 100000))
    OR (p_set_is_active AND p_is_active IS NULL)
    OR char_length(normalized_reason) NOT BETWEEN 5 AND 1000
  THEN
    RAISE EXCEPTION 'forum_category_request_invalid' USING errcode = '22023';
  END IF;

  SELECT category.*
  INTO target_category
  FROM public.forum_categories AS category
  WHERE category.organization_id = p_organization_id
    AND category.id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_category_not_found' USING errcode = 'P0002';
  END IF;

  before_state := private.forum_category_json(p_organization_id, p_category_id);

  UPDATE public.forum_categories AS category
  SET
    slug = CASE WHEN p_set_slug THEN normalized_slug ELSE category.slug END,
    name = CASE WHEN p_set_name THEN normalized_name ELSE category.name END,
    description = CASE
      WHEN p_set_description THEN normalized_description
      ELSE category.description
    END,
    icon = CASE WHEN p_set_icon THEN normalized_icon ELSE category.icon END,
    color = CASE WHEN p_set_color THEN normalized_color ELSE category.color END,
    sort_order = CASE WHEN p_set_sort_order THEN p_sort_order ELSE category.sort_order END,
    is_active = CASE WHEN p_set_is_active THEN p_is_active ELSE category.is_active END
  WHERE category.organization_id = p_organization_id
    AND category.id = p_category_id
    AND (
      category.slug,
      category.name,
      category.description,
      category.icon,
      category.color,
      category.sort_order,
      category.is_active
    ) IS DISTINCT FROM (
      CASE WHEN p_set_slug THEN normalized_slug ELSE category.slug END,
      CASE WHEN p_set_name THEN normalized_name ELSE category.name END,
      CASE WHEN p_set_description THEN normalized_description ELSE category.description END,
      CASE WHEN p_set_icon THEN normalized_icon ELSE category.icon END,
      CASE WHEN p_set_color THEN normalized_color ELSE category.color END,
      CASE WHEN p_set_sort_order THEN p_sort_order ELSE category.sort_order END,
      CASE WHEN p_set_is_active THEN p_is_active ELSE category.is_active END
    );

  changed := FOUND;
  after_state := private.forum_category_json(p_organization_id, p_category_id);

  IF changed THEN
    audit_event_id := private.record_forum_moderation_event(
      p_organization_id,
      actor_user_id,
      'update',
      'category',
      p_category_id,
      normalized_reason,
      before_state,
      after_state
    );
  END IF;

  RETURN jsonb_build_object(
    'changed', changed,
    'auditEventId', audit_event_id,
    'category', after_state
  );
END;
$$;

-- Keep the existing administrative-access command semantics while extending
-- its accepted role catalogue with forum_admin.
CREATE OR REPLACE FUNCTION public.set_organization_user_admin_access(
  p_organization_id uuid,
  p_user_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid,
  p_role_keys text[],
  p_consent_publish boolean,
  p_consent_justification text,
  p_consent_expires_at timestamp with time zone,
  p_change_reason text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  actor_snapshot jsonb;
  target_snapshot jsonb;
  normalized_role_keys text[];
  previous_role_keys text[];
  previous_membership_role text;
  requested_membership_role text;
  access_state public.organization_user_access_states%rowtype;
  current_consent_grant public.organization_user_direct_grants%rowtype;
  consent_changed boolean := false;
  roles_changed boolean := false;
  changed boolean := false;
  audit_event_id uuid;
  request_fingerprint text;
  previous_command private.organization_admin_access_commands%rowtype;
  response_payload jsonb;
  previous_state jsonb;
  next_state jsonb;
BEGIN
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication_required' USING errcode = '42501';
  END IF;

  IF NOT private.has_administrative_permission(
    p_organization_id,
    'iam.roles.manage'
  ) THEN
    RAISE EXCEPTION 'administrative_access_manage_forbidden' USING errcode = '42501';
  END IF;

  IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
    RAISE EXCEPTION 'administrative_access_revision_invalid' USING errcode = '22023';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'administrative_access_idempotency_key_required' USING errcode = '22023';
  END IF;
  IF p_change_reason IS NULL
    OR char_length(btrim(p_change_reason)) NOT BETWEEN 10 AND 2000
  THEN
    RAISE EXCEPTION 'administrative_access_change_reason_invalid' USING errcode = '22023';
  END IF;
  IF p_role_keys IS NULL THEN
    RAISE EXCEPTION 'administrative_access_roles_required' USING errcode = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_role_keys) AS requested_role(role_key)
    WHERE requested_role.role_key NOT IN (
      'organization_admin',
      'access_admin',
      'structure_admin',
      'consents_admin',
      'crm_config_admin',
      'forum_admin'
    )
  ) THEN
    RAISE EXCEPTION 'administrative_access_role_invalid' USING errcode = '22023';
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT requested_role.role_key ORDER BY requested_role.role_key),
    ARRAY[]::text[]
  )
  INTO normalized_role_keys
  FROM unnest(p_role_keys) AS requested_role(role_key);

  IF cardinality(normalized_role_keys) <> cardinality(p_role_keys) THEN
    RAISE EXCEPTION 'administrative_access_roles_duplicate' USING errcode = '22023';
  END IF;

  IF coalesce(p_consent_publish, false) THEN
    IF p_consent_justification IS NULL
      OR char_length(btrim(p_consent_justification)) NOT BETWEEN 10 AND 2000
    THEN
      RAISE EXCEPTION 'consent_publishing_justification_invalid' USING errcode = '22023';
    END IF;

    IF p_consent_expires_at IS NULL
      OR p_consent_expires_at <= statement_timestamp()
    THEN
      RAISE EXCEPTION 'consent_publishing_expiry_invalid' USING errcode = '22023';
    END IF;
  ELSIF p_consent_justification IS NOT NULL OR p_consent_expires_at IS NOT NULL THEN
    RAISE EXCEPTION 'consent_publishing_fields_without_grant' USING errcode = '22023';
  END IF;

  request_fingerprint := pg_catalog.md5(
    jsonb_build_object(
      'targetUserId', p_user_id,
      'expectedRevision', p_expected_revision,
      'roleKeys', to_jsonb(normalized_role_keys),
      'consentPublish', coalesce(p_consent_publish, false),
      'consentJustification', CASE
        WHEN coalesce(p_consent_publish, false) THEN btrim(p_consent_justification)
        ELSE NULL
      END,
      'consentExpiresAt', CASE
        WHEN coalesce(p_consent_publish, false) THEN p_consent_expires_at
        ELSE NULL
      END,
      'changeReason', btrim(p_change_reason)
    )::text
  );

  SELECT command.*
  INTO previous_command
  FROM private.organization_admin_access_commands AS command
  WHERE command.organization_id = p_organization_id
    AND command.idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF previous_command.actor_user_id <> actor_user_id
      OR previous_command.target_user_id <> p_user_id
      OR previous_command.command_type <> 'set_admin_access'
      OR previous_command.request_fingerprint <> request_fingerprint
    THEN
      RAISE EXCEPTION 'administrative_access_idempotency_conflict' USING errcode = '23505';
    END IF;

    RETURN jsonb_set(previous_command.response, '{replayed}', 'true'::jsonb, true);
  END IF;

  SELECT membership.role
  INTO previous_membership_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_member_not_found' USING errcode = 'P0002';
  END IF;

  INSERT INTO public.organization_user_access_states (organization_id, user_id)
  VALUES (p_organization_id, p_user_id)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  SELECT state.*
  INTO access_state
  FROM public.organization_user_access_states AS state
  WHERE state.organization_id = p_organization_id
    AND state.user_id = p_user_id
  FOR UPDATE;

  IF access_state.revision <> p_expected_revision THEN
    RAISE EXCEPTION 'administrative_access_revision_conflict'
      USING
        errcode = '40001',
        detail = jsonb_build_object(
          'expectedRevision', p_expected_revision,
          'currentRevision', access_state.revision
        )::text;
  END IF;

  SELECT coalesce(
    array_agg(existing_role.role_key ORDER BY existing_role.role_key),
    ARRAY[]::text[]
  )
  INTO previous_role_keys
  FROM (
    SELECT 'organization_admin'::text AS role_key
    WHERE previous_membership_role = 'admin'

    UNION ALL

    SELECT assignment.role_key
    FROM public.organization_user_admin_roles AS assignment
    WHERE assignment.organization_id = p_organization_id
      AND assignment.user_id = p_user_id
  ) AS existing_role;

  previous_state := private.administrative_access_state_json(
    p_organization_id,
    p_user_id
  );

  requested_membership_role := CASE
    WHEN 'organization_admin' = ANY (normalized_role_keys) THEN 'admin'
    ELSE 'expert'
  END;

  IF previous_membership_role = 'admin'
    AND requested_membership_role <> 'admin'
    AND (
      SELECT count(*)
      FROM public.organization_memberships AS other_admin
      WHERE other_admin.organization_id = p_organization_id
        AND other_admin.role = 'admin'
    ) <= 1
  THEN
    RAISE EXCEPTION 'administrative_access_last_organization_admin' USING errcode = '23514';
  END IF;

  roles_changed := previous_role_keys IS DISTINCT FROM normalized_role_keys;

  IF previous_membership_role IS DISTINCT FROM requested_membership_role THEN
    UPDATE public.organization_memberships
    SET role = requested_membership_role
    WHERE organization_id = p_organization_id
      AND user_id = p_user_id;
  END IF;

  DELETE FROM public.organization_user_admin_roles AS assignment
  WHERE assignment.organization_id = p_organization_id
    AND assignment.user_id = p_user_id
    AND NOT (assignment.role_key = ANY (normalized_role_keys));

  INSERT INTO public.organization_user_admin_roles (
    organization_id,
    user_id,
    role_key,
    assigned_by_user_id,
    reason
  )
  SELECT
    p_organization_id,
    p_user_id,
    requested_role.role_key,
    actor_user_id,
    btrim(p_change_reason)
  FROM unnest(normalized_role_keys) AS requested_role(role_key)
  WHERE requested_role.role_key <> 'organization_admin'
  ON CONFLICT (organization_id, user_id, role_key) DO NOTHING;

  SELECT direct_grant.*
  INTO current_consent_grant
  FROM public.organization_user_direct_grants AS direct_grant
  WHERE direct_grant.organization_id = p_organization_id
    AND direct_grant.user_id = p_user_id
    AND direct_grant.permission_key = 'compliance.consents.definitions.publish'
    AND direct_grant.status = 'active'
  FOR UPDATE;

  IF coalesce(p_consent_publish, false) THEN
    consent_changed :=
      NOT FOUND
      OR current_consent_grant.expires_at <= statement_timestamp()
      OR current_consent_grant.justification IS DISTINCT FROM btrim(p_consent_justification)
      OR current_consent_grant.expires_at IS DISTINCT FROM p_consent_expires_at;

    IF consent_changed AND current_consent_grant.id IS NOT NULL THEN
      UPDATE public.organization_user_direct_grants
      SET
        status = 'revoked',
        revoked_by_user_id = actor_user_id,
        revoked_at = statement_timestamp(),
        revocation_reason = btrim(p_change_reason),
        revision = revision + 1
      WHERE id = current_consent_grant.id;
    END IF;

    IF consent_changed THEN
      INSERT INTO public.organization_user_direct_grants (
        organization_id,
        user_id,
        permission_key,
        justification,
        expires_at,
        granted_by_user_id
      ) VALUES (
        p_organization_id,
        p_user_id,
        'compliance.consents.definitions.publish',
        btrim(p_consent_justification),
        p_consent_expires_at,
        actor_user_id
      );
    END IF;
  ELSE
    consent_changed := current_consent_grant.id IS NOT NULL;

    IF consent_changed THEN
      UPDATE public.organization_user_direct_grants
      SET
        status = 'revoked',
        revoked_by_user_id = actor_user_id,
        revoked_at = statement_timestamp(),
        revocation_reason = btrim(p_change_reason),
        revision = revision + 1
      WHERE id = current_consent_grant.id;
    END IF;
  END IF;

  changed := roles_changed OR consent_changed;

  IF changed THEN
    UPDATE public.organization_user_access_states
    SET
      revision = revision + 1,
      updated_by_user_id = actor_user_id,
      updated_at = statement_timestamp()
    WHERE organization_id = p_organization_id
      AND user_id = p_user_id
    RETURNING * INTO access_state;

    SELECT jsonb_build_object(
      'userId', actor.id,
      'fullName', coalesce(actor.full_name, actor.email),
      'email', actor.email,
      'avatarUrl', actor.avatar_url
    )
    INTO actor_snapshot
    FROM public.users AS actor
    WHERE actor.id = actor_user_id;

    SELECT jsonb_build_object(
      'userId', target.id,
      'fullName', coalesce(target.full_name, target.email),
      'email', target.email,
      'avatarUrl', target.avatar_url
    )
    INTO target_snapshot
    FROM public.users AS target
    WHERE target.id = p_user_id;

    INSERT INTO public.organization_user_audit_events (
      organization_id,
      target_user_id,
      actor_user_id,
      actor_snapshot,
      target_snapshot,
      event_type,
      resource_type,
      resource_id,
      resource_label,
      changes,
      reason,
      source,
      correlation_id,
      revision_before,
      revision_after
    ) VALUES (
      p_organization_id,
      p_user_id,
      actor_user_id,
      coalesce(actor_snapshot, '{}'::jsonb),
      coalesce(target_snapshot, '{}'::jsonb),
      'admin_access_updated',
      'user_admin_access',
      p_user_id::text,
      'Dostęp administracyjny użytkownika',
      jsonb_build_array(
        jsonb_build_object(
          'field', 'roles',
          'before', to_jsonb(previous_role_keys),
          'after', to_jsonb(normalized_role_keys)
        ),
        jsonb_build_object(
          'field', 'consentPublishingGrant',
          'before', previous_state -> 'consentPublishingGrant',
          'after', CASE
            WHEN coalesce(p_consent_publish, false) THEN jsonb_build_object(
              'permissionKey', 'compliance.consents.definitions.publish',
              'expiresAt', p_consent_expires_at
            )
            ELSE NULL
          END
        )
      ),
      btrim(p_change_reason),
      'admin_panel',
      p_idempotency_key,
      p_expected_revision,
      access_state.revision
    )
    RETURNING id INTO audit_event_id;
  END IF;

  next_state := private.administrative_access_state_json(
    p_organization_id,
    p_user_id
  );

  response_payload := jsonb_build_object(
    'data', next_state,
    'changed', changed,
    'replayed', false,
    'auditEventId', audit_event_id
  );

  INSERT INTO private.organization_admin_access_commands (
    organization_id,
    idempotency_key,
    actor_user_id,
    target_user_id,
    command_type,
    request_fingerprint,
    response
  ) VALUES (
    p_organization_id,
    p_idempotency_key,
    actor_user_id,
    p_user_id,
    'set_admin_access',
    request_fingerprint,
    response_payload
  );

  RETURN response_payload;
END;
$$;

ALTER TABLE public.forum_moderation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY forum_moderation_events_admin_read
  ON public.forum_moderation_events
  FOR SELECT TO authenticated
  USING (
    private.has_administrative_permission(organization_id, 'forum.moderate')
    OR private.has_administrative_permission(organization_id, 'forum.categories.manage')
  );

ALTER POLICY forum_threads_member_read ON public.forum_threads
  USING (
    private.is_organization_member(organization_id)
    AND (
      NOT is_hidden
      OR private.has_administrative_permission(organization_id, 'forum.moderate')
    )
  );

ALTER POLICY forum_posts_member_read ON public.forum_posts
  USING (
    private.is_organization_member(organization_id)
    AND (
      NOT is_hidden
      OR private.has_administrative_permission(organization_id, 'forum.moderate')
    )
  );

REVOKE ALL ON TABLE public.forum_moderation_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT ON TABLE public.forum_moderation_events TO authenticated;

REVOKE ALL ON FUNCTION public.get_organization_forum_moderation_context(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_organization_forum_moderation_context(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.list_organization_forum_moderation_items(uuid, integer)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.list_organization_forum_moderation_items(uuid, integer)
  TO authenticated;

REVOKE ALL ON FUNCTION public.moderate_organization_forum_thread(
  uuid, uuid, text, text, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.moderate_organization_forum_thread(
  uuid, uuid, text, text, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.moderate_organization_forum_post(
  uuid, uuid, text, text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.moderate_organization_forum_post(
  uuid, uuid, text, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.list_organization_forum_categories(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.list_organization_forum_categories(uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.create_organization_forum_category(
  uuid, text, text, text, text, text, integer, text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_organization_forum_category(
  uuid, text, text, text, text, text, integer, text
) TO authenticated;

REVOKE ALL ON FUNCTION public.update_organization_forum_category(
  uuid, uuid,
  boolean, text,
  boolean, text,
  boolean, text,
  boolean, text,
  boolean, text,
  boolean, integer,
  boolean, boolean,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.update_organization_forum_category(
  uuid, uuid,
  boolean, text,
  boolean, text,
  boolean, text,
  boolean, text,
  boolean, text,
  boolean, integer,
  boolean, boolean,
  text
) TO authenticated;
