-- Organization-scoped expert forum. PostgreSQL remains the source of truth
-- for membership, moderation state, full-text search and embedding work.

CREATE TABLE public.forum_categories (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  icon text,
  color text,
  sort_order integer DEFAULT 100 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_categories_pkey PRIMARY KEY (id),
  CONSTRAINT forum_categories_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT forum_categories_organization_slug_key UNIQUE (organization_id, slug),
  CONSTRAINT forum_categories_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT forum_categories_name_check CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT forum_categories_description_check CHECK (
    description IS NULL OR char_length(description) <= 1000
  ),
  CONSTRAINT forum_categories_icon_check CHECK (icon IS NULL OR char_length(icon) <= 100),
  CONSTRAINT forum_categories_color_check CHECK (color IS NULL OR char_length(color) <= 40),
  CONSTRAINT forum_categories_sort_order_check CHECK (sort_order BETWEEN 0 AND 100000),
  CONSTRAINT forum_categories_organization_fkey FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT forum_categories_creator_fkey FOREIGN KEY (
    organization_id,
    created_by_user_id
  ) REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE SET NULL (created_by_user_id)
);

CREATE TABLE public.forum_threads (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  category_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  thread_type text NOT NULL,
  status text DEFAULT 'open' NOT NULL,
  title text NOT NULL,
  language_code text DEFAULT 'pl' NOT NULL,
  visibility text DEFAULT 'organization' NOT NULL,
  accepted_post_id uuid,
  reply_count integer DEFAULT 0 NOT NULL,
  participant_count integer DEFAULT 1 NOT NULL,
  view_count integer DEFAULT 0 NOT NULL,
  has_verified_expert_answer boolean DEFAULT false NOT NULL,
  has_official_admin_answer boolean DEFAULT false NOT NULL,
  client_request_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_hidden boolean DEFAULT false NOT NULL,
  hidden_at timestamp with time zone,
  hidden_by_user_id uuid,
  hidden_reason text,
  last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_threads_pkey PRIMARY KEY (id),
  CONSTRAINT forum_threads_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT forum_threads_organization_thread_accepted_key
    UNIQUE (organization_id, id, accepted_post_id),
  CONSTRAINT forum_threads_type_check CHECK (
    thread_type = ANY (ARRAY['question'::text, 'discussion'::text])
  ),
  CONSTRAINT forum_threads_status_check CHECK (
    status = ANY (ARRAY['open'::text, 'answered'::text, 'resolved'::text, 'closed'::text])
  ),
  CONSTRAINT forum_threads_title_check CHECK (char_length(btrim(title)) BETWEEN 5 AND 240),
  CONSTRAINT forum_threads_language_check CHECK (language_code ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  CONSTRAINT forum_threads_visibility_check CHECK (visibility = 'organization'),
  CONSTRAINT forum_threads_counters_check CHECK (
    reply_count >= 0 AND participant_count >= 0 AND view_count >= 0
  ),
  CONSTRAINT forum_threads_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 32768
  ),
  CONSTRAINT forum_threads_hidden_shape_check CHECK (
    (is_hidden AND hidden_at IS NOT NULL)
    OR (NOT is_hidden AND hidden_at IS NULL AND hidden_by_user_id IS NULL AND hidden_reason IS NULL)
  ),
  CONSTRAINT forum_threads_hidden_reason_check CHECK (
    hidden_reason IS NULL OR char_length(hidden_reason) <= 1000
  ),
  CONSTRAINT forum_threads_organization_fkey FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT forum_threads_category_fkey FOREIGN KEY (organization_id, category_id)
    REFERENCES public.forum_categories (organization_id, id),
  CONSTRAINT forum_threads_author_fkey FOREIGN KEY (organization_id, author_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id),
  CONSTRAINT forum_threads_hidden_by_fkey FOREIGN KEY (organization_id, hidden_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE SET NULL (hidden_by_user_id)
);

CREATE UNIQUE INDEX forum_threads_client_request_key
  ON public.forum_threads (organization_id, author_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX forum_threads_feed_idx
  ON public.forum_threads (organization_id, last_activity_at DESC, id)
  WHERE NOT is_hidden;

CREATE INDEX forum_threads_filter_idx
  ON public.forum_threads (
    organization_id,
    category_id,
    status,
    thread_type,
    last_activity_at DESC
  ) WHERE NOT is_hidden;

CREATE TABLE public.forum_posts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  author_user_id uuid NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  is_verified_expert_answer boolean DEFAULT false NOT NULL,
  is_official_admin_answer boolean DEFAULT false NOT NULL,
  is_accepted_answer boolean DEFAULT false NOT NULL,
  client_request_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_hidden boolean DEFAULT false NOT NULL,
  hidden_at timestamp with time zone,
  hidden_by_user_id uuid,
  hidden_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_posts_pkey PRIMARY KEY (id),
  CONSTRAINT forum_posts_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT forum_posts_thread_identity_key UNIQUE (organization_id, thread_id, id),
  CONSTRAINT forum_posts_kind_check CHECK (kind = ANY (ARRAY['question'::text, 'reply'::text])),
  CONSTRAINT forum_posts_content_check CHECK (char_length(btrim(content)) BETWEEN 2 AND 30000),
  CONSTRAINT forum_posts_answer_flags_check CHECK (
    kind = 'reply'
    OR (
      NOT is_verified_expert_answer
      AND NOT is_official_admin_answer
      AND NOT is_accepted_answer
    )
  ),
  CONSTRAINT forum_posts_accepted_verified_check CHECK (
    NOT is_accepted_answer
    OR is_verified_expert_answer
    OR is_official_admin_answer
  ),
  CONSTRAINT forum_posts_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 32768
  ),
  CONSTRAINT forum_posts_hidden_shape_check CHECK (
    (is_hidden AND hidden_at IS NOT NULL)
    OR (NOT is_hidden AND hidden_at IS NULL AND hidden_by_user_id IS NULL AND hidden_reason IS NULL)
  ),
  CONSTRAINT forum_posts_hidden_reason_check CHECK (
    hidden_reason IS NULL OR char_length(hidden_reason) <= 1000
  ),
  CONSTRAINT forum_posts_thread_fkey FOREIGN KEY (organization_id, thread_id)
    REFERENCES public.forum_threads (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT forum_posts_author_fkey FOREIGN KEY (organization_id, author_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id),
  CONSTRAINT forum_posts_hidden_by_fkey FOREIGN KEY (organization_id, hidden_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE SET NULL (hidden_by_user_id)
);

CREATE UNIQUE INDEX forum_posts_question_key
  ON public.forum_posts (organization_id, thread_id)
  WHERE kind = 'question';

CREATE UNIQUE INDEX forum_posts_accepted_answer_key
  ON public.forum_posts (organization_id, thread_id)
  WHERE is_accepted_answer AND NOT is_hidden;

CREATE UNIQUE INDEX forum_posts_client_request_key
  ON public.forum_posts (organization_id, author_user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX forum_posts_thread_timeline_idx
  ON public.forum_posts (organization_id, thread_id, created_at, id)
  WHERE NOT is_hidden;

ALTER TABLE public.forum_threads
  ADD CONSTRAINT forum_threads_accepted_post_fkey FOREIGN KEY (
    organization_id,
    id,
    accepted_post_id
  ) REFERENCES public.forum_posts (organization_id, thread_id, id)
    ON DELETE SET NULL (accepted_post_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.forum_thread_reads (
  organization_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  user_id uuid NOT NULL,
  last_read_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_thread_reads_pkey PRIMARY KEY (organization_id, thread_id, user_id),
  CONSTRAINT forum_thread_reads_thread_fkey FOREIGN KEY (organization_id, thread_id)
    REFERENCES public.forum_threads (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT forum_thread_reads_member_fkey FOREIGN KEY (organization_id, user_id)
    REFERENCES public.organization_memberships (organization_id, user_id) ON DELETE CASCADE
);

CREATE TABLE public.forum_search_documents (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  thread_id uuid NOT NULL,
  post_id uuid NOT NULL,
  category_id uuid NOT NULL,
  document_kind text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  language_code text DEFAULT 'pl' NOT NULL,
  is_searchable boolean DEFAULT true NOT NULL,
  source_sha256 text NOT NULL,
  revision bigint DEFAULT 1 NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A')
    || setweight(to_tsvector('simple'::regconfig, coalesce(content, '')), 'B')
  ) STORED,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_search_documents_pkey PRIMARY KEY (id),
  CONSTRAINT forum_search_documents_organization_id_id_key UNIQUE (organization_id, id),
  CONSTRAINT forum_search_documents_post_key UNIQUE (post_id),
  CONSTRAINT forum_search_documents_kind_check CHECK (
    document_kind = ANY (ARRAY['question'::text, 'reply'::text])
  ),
  CONSTRAINT forum_search_documents_sha_check CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT forum_search_documents_revision_check CHECK (revision >= 1),
  CONSTRAINT forum_search_documents_thread_fkey FOREIGN KEY (organization_id, thread_id)
    REFERENCES public.forum_threads (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT forum_search_documents_post_fkey FOREIGN KEY (organization_id, post_id)
    REFERENCES public.forum_posts (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT forum_search_documents_category_fkey FOREIGN KEY (organization_id, category_id)
    REFERENCES public.forum_categories (organization_id, id)
);

CREATE INDEX forum_search_documents_fts_idx
  ON public.forum_search_documents USING gin (search_vector);

CREATE INDEX forum_search_documents_acl_idx
  ON public.forum_search_documents (organization_id, category_id, thread_id)
  WHERE is_searchable;

CREATE TABLE public.forum_search_embeddings (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  model text DEFAULT 'gemini-embedding-2' NOT NULL,
  dimensions integer DEFAULT 768 NOT NULL,
  recipe_version text DEFAULT 'forum-search-v1' NOT NULL,
  source_sha256 text NOT NULL,
  source_revision bigint NOT NULL,
  embedding extensions.vector(768) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_search_embeddings_pkey PRIMARY KEY (id),
  CONSTRAINT forum_search_embeddings_unique UNIQUE (
    document_id,
    model,
    recipe_version,
    source_revision
  ),
  CONSTRAINT forum_search_embeddings_model_check CHECK (model = 'gemini-embedding-2'),
  CONSTRAINT forum_search_embeddings_dimensions_check CHECK (dimensions = 768),
  CONSTRAINT forum_search_embeddings_recipe_check CHECK (recipe_version = 'forum-search-v1'),
  CONSTRAINT forum_search_embeddings_sha_check CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT forum_search_embeddings_revision_check CHECK (source_revision >= 1),
  CONSTRAINT forum_search_embeddings_document_fkey FOREIGN KEY (organization_id, document_id)
    REFERENCES public.forum_search_documents (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX forum_search_embeddings_hnsw_idx
  ON public.forum_search_embeddings USING hnsw
  (embedding extensions.vector_cosine_ops)
  WHERE model = 'gemini-embedding-2'
    AND dimensions = 768
    AND recipe_version = 'forum-search-v1';

CREATE INDEX forum_search_embeddings_document_idx
  ON public.forum_search_embeddings (
    organization_id,
    document_id,
    source_revision DESC
  );

CREATE TABLE public.forum_embedding_jobs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  model text DEFAULT 'gemini-embedding-2' NOT NULL,
  dimensions integer DEFAULT 768 NOT NULL,
  recipe_version text DEFAULT 'forum-search-v1' NOT NULL,
  source_sha256 text NOT NULL,
  source_revision bigint NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 8 NOT NULL,
  available_at timestamp with time zone DEFAULT now() NOT NULL,
  locked_at timestamp with time zone,
  locked_by text,
  last_error text,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT forum_embedding_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT forum_embedding_jobs_unique UNIQUE (
    document_id,
    model,
    recipe_version,
    source_revision
  ),
  CONSTRAINT forum_embedding_jobs_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'processing'::text,
      'completed'::text,
      'failed'::text,
      'cancelled'::text
    ])
  ),
  CONSTRAINT forum_embedding_jobs_model_check CHECK (model = 'gemini-embedding-2'),
  CONSTRAINT forum_embedding_jobs_dimensions_check CHECK (dimensions = 768),
  CONSTRAINT forum_embedding_jobs_recipe_check CHECK (recipe_version = 'forum-search-v1'),
  CONSTRAINT forum_embedding_jobs_sha_check CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT forum_embedding_jobs_revision_check CHECK (source_revision >= 1),
  CONSTRAINT forum_embedding_jobs_attempts_check CHECK (
    attempts >= 0 AND max_attempts BETWEEN 1 AND 100 AND attempts <= max_attempts
  ),
  CONSTRAINT forum_embedding_jobs_lock_shape_check CHECK (
    (
      status = 'processing'
      AND locked_at IS NOT NULL
      AND nullif(btrim(locked_by), '') IS NOT NULL
      AND attempts >= 1
    )
    OR (status <> 'processing' AND locked_at IS NULL AND locked_by IS NULL)
  ),
  CONSTRAINT forum_embedding_jobs_processed_shape_check CHECK (
    (status = 'completed' AND processed_at IS NOT NULL)
    OR (status <> 'completed' AND processed_at IS NULL)
  ),
  CONSTRAINT forum_embedding_jobs_error_check CHECK (
    last_error IS NULL OR char_length(last_error) <= 4000
  ),
  CONSTRAINT forum_embedding_jobs_worker_check CHECK (
    locked_by IS NULL OR char_length(locked_by) <= 200
  ),
  CONSTRAINT forum_embedding_jobs_document_fkey FOREIGN KEY (organization_id, document_id)
    REFERENCES public.forum_search_documents (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX forum_embedding_jobs_ready_idx
  ON public.forum_embedding_jobs (available_at, created_at, id)
  WHERE status = ANY (ARRAY['pending'::text, 'failed'::text])
    AND attempts < max_attempts;

CREATE INDEX forum_embedding_jobs_stale_lock_idx
  ON public.forum_embedding_jobs (locked_at, id)
  WHERE status = 'processing';

COMMENT ON TABLE public.forum_search_documents IS
  'Search projection separated from author posts; hidden content is synchronously marked non-searchable.';
COMMENT ON TABLE public.forum_search_embeddings IS
  'Versioned Gemini Embedding 2 vectors for the forum-search-v1 recipe.';
COMMENT ON TABLE public.forum_embedding_jobs IS
  'Idempotent lease-based queue for refreshing forum search embeddings.';

CREATE FUNCTION private.validate_forum_post()
RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
DECLARE
  target_thread public.forum_threads%rowtype;
  author_role text;
BEGIN
  SELECT thread.*
  INTO target_thread
  FROM public.forum_threads AS thread
  WHERE thread.organization_id = new.organization_id
    AND thread.id = new.thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_thread_not_found' USING errcode = '23503';
  END IF;

  SELECT membership.role
  INTO author_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = new.organization_id
    AND membership.user_id = new.author_user_id;

  IF author_role IS NULL THEN
    RAISE EXCEPTION 'forum_author_membership_required' USING errcode = '23503';
  END IF;

  IF new.kind = 'question' AND new.author_user_id <> target_thread.author_user_id THEN
    RAISE EXCEPTION 'forum_question_author_mismatch' USING errcode = '23514';
  END IF;

  IF new.is_verified_expert_answer AND author_role <> 'expert' THEN
    RAISE EXCEPTION 'forum_verified_answer_requires_expert' USING errcode = '23514';
  END IF;

  IF new.is_official_admin_answer AND author_role <> 'admin' THEN
    RAISE EXCEPTION 'forum_official_answer_requires_admin' USING errcode = '23514';
  END IF;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION private.validate_forum_post()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.upsert_forum_search_document(
  p_organization_id uuid,
  p_post_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  source_row record;
  existing_document public.forum_search_documents%rowtype;
  projected_document public.forum_search_documents%rowtype;
  next_sha256 text;
  projection_changed boolean := false;
BEGIN
  SELECT
    post.organization_id,
    post.id AS post_id,
    post.thread_id,
    thread.category_id,
    post.kind AS document_kind,
    thread.title,
    post.content,
    thread.language_code,
    (
      NOT post.is_hidden
      AND NOT thread.is_hidden
      AND category.is_active
    ) AS is_searchable
  INTO source_row
  FROM public.forum_posts AS post
  JOIN public.forum_threads AS thread
    ON thread.organization_id = post.organization_id
   AND thread.id = post.thread_id
  JOIN public.forum_categories AS category
    ON category.organization_id = thread.organization_id
   AND category.id = thread.category_id
  WHERE post.organization_id = p_organization_id
    AND post.id = p_post_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  next_sha256 := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'title: ' || source_row.title || ' | text: ' || source_row.content,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT document.*
  INTO existing_document
  FROM public.forum_search_documents AS document
  WHERE document.post_id = source_row.post_id
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.forum_search_documents (
      organization_id,
      thread_id,
      post_id,
      category_id,
      document_kind,
      title,
      content,
      language_code,
      is_searchable,
      source_sha256,
      revision
    ) VALUES (
      source_row.organization_id,
      source_row.thread_id,
      source_row.post_id,
      source_row.category_id,
      source_row.document_kind,
      source_row.title,
      source_row.content,
      source_row.language_code,
      source_row.is_searchable,
      next_sha256,
      1
    )
    RETURNING * INTO projected_document;
    projection_changed := true;
  ELSE
    projection_changed := (
      existing_document.thread_id,
      existing_document.category_id,
      existing_document.document_kind,
      existing_document.title,
      existing_document.content,
      existing_document.language_code,
      existing_document.is_searchable,
      existing_document.source_sha256
    ) IS DISTINCT FROM (
      source_row.thread_id,
      source_row.category_id,
      source_row.document_kind,
      source_row.title,
      source_row.content,
      source_row.language_code,
      source_row.is_searchable,
      next_sha256
    );

    IF projection_changed THEN
      UPDATE public.forum_search_documents AS document
      SET
        thread_id = source_row.thread_id,
        category_id = source_row.category_id,
        document_kind = source_row.document_kind,
        title = source_row.title,
        content = source_row.content,
        language_code = source_row.language_code,
        is_searchable = source_row.is_searchable,
        source_sha256 = next_sha256,
        revision = document.revision + 1,
        updated_at = statement_timestamp()
      WHERE document.id = existing_document.id
      RETURNING * INTO projected_document;
    ELSE
      projected_document := existing_document;
    END IF;
  END IF;

  IF projection_changed AND projected_document.is_searchable THEN
    INSERT INTO public.forum_embedding_jobs (
      organization_id,
      document_id,
      model,
      dimensions,
      recipe_version,
      source_sha256,
      source_revision
    ) VALUES (
      projected_document.organization_id,
      projected_document.id,
      'gemini-embedding-2',
      768,
      'forum-search-v1',
      projected_document.source_sha256,
      projected_document.revision
    )
    ON CONFLICT (
      document_id,
      model,
      recipe_version,
      source_revision
    ) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.upsert_forum_search_document(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.sync_forum_post_search_document()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  PERFORM private.upsert_forum_search_document(new.organization_id, new.id);
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_forum_post_search_document()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.refresh_forum_thread_search_documents()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_post record;
BEGIN
  FOR target_post IN
    SELECT post.id
    FROM public.forum_posts AS post
    WHERE post.organization_id = new.organization_id
      AND post.thread_id = new.id
  LOOP
    PERFORM private.upsert_forum_search_document(new.organization_id, target_post.id);
  END LOOP;
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_forum_thread_search_documents()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.recalculate_forum_thread_stats(
  p_organization_id uuid,
  p_thread_id uuid
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  stats record;
BEGIN
  SELECT
    count(*) FILTER (WHERE post.kind = 'reply' AND NOT post.is_hidden)::integer AS reply_count,
    count(DISTINCT post.author_user_id) FILTER (WHERE NOT post.is_hidden)::integer AS participant_count,
    max(post.created_at) FILTER (WHERE NOT post.is_hidden) AS last_activity_at,
    bool_or(post.is_verified_expert_answer AND NOT post.is_hidden) AS has_verified,
    bool_or(post.is_official_admin_answer AND NOT post.is_hidden) AS has_official,
    (
      array_agg(post.id ORDER BY post.created_at, post.id)
        FILTER (WHERE post.is_accepted_answer AND NOT post.is_hidden)
    )[1] AS accepted_post_id
  INTO stats
  FROM public.forum_posts AS post
  WHERE post.organization_id = p_organization_id
    AND post.thread_id = p_thread_id;

  UPDATE public.forum_threads AS thread
  SET
    reply_count = coalesce(stats.reply_count, 0),
    participant_count = coalesce(stats.participant_count, 0),
    last_activity_at = coalesce(stats.last_activity_at, thread.created_at),
    has_verified_expert_answer = coalesce(stats.has_verified, false),
    has_official_admin_answer = coalesce(stats.has_official, false),
    accepted_post_id = stats.accepted_post_id,
    status = CASE
      WHEN thread.status = 'closed' THEN thread.status
      WHEN thread.thread_type = 'question' AND stats.accepted_post_id IS NOT NULL THEN 'resolved'
      WHEN thread.thread_type = 'question' AND coalesce(stats.reply_count, 0) > 0 THEN 'answered'
      WHEN thread.thread_type = 'question' THEN 'open'
      ELSE thread.status
    END
  WHERE thread.organization_id = p_organization_id
    AND thread.id = p_thread_id;
END;
$$;

REVOKE ALL ON FUNCTION private.recalculate_forum_thread_stats(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.sync_forum_thread_stats()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF tg_op = 'DELETE' THEN
    PERFORM private.recalculate_forum_thread_stats(old.organization_id, old.thread_id);
    RETURN old;
  END IF;
  PERFORM private.recalculate_forum_thread_stats(new.organization_id, new.thread_id);
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_forum_thread_stats()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER validate_forum_post
  BEFORE INSERT OR UPDATE ON public.forum_posts
  FOR EACH ROW EXECUTE FUNCTION private.validate_forum_post();

CREATE TRIGGER set_forum_categories_updated_at
  BEFORE UPDATE ON public.forum_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_forum_threads_updated_at
  BEFORE UPDATE ON public.forum_threads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_forum_posts_updated_at
  BEFORE UPDATE ON public.forum_posts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_forum_thread_reads_updated_at
  BEFORE UPDATE ON public.forum_thread_reads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_forum_embedding_jobs_updated_at
  BEFORE UPDATE ON public.forum_embedding_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER sync_forum_post_search_document
  AFTER INSERT OR UPDATE OF content, is_hidden ON public.forum_posts
  FOR EACH ROW EXECUTE FUNCTION private.sync_forum_post_search_document();

CREATE TRIGGER refresh_forum_thread_search_documents
  AFTER UPDATE OF title, category_id, language_code, is_hidden ON public.forum_threads
  FOR EACH ROW EXECUTE FUNCTION private.refresh_forum_thread_search_documents();

CREATE TRIGGER sync_forum_thread_stats
  AFTER INSERT OR DELETE OR UPDATE OF
    is_hidden,
    is_verified_expert_answer,
    is_official_admin_answer,
    is_accepted_answer,
    author_user_id
  ON public.forum_posts
  FOR EACH ROW EXECUTE FUNCTION private.sync_forum_thread_stats();

CREATE FUNCTION private.forum_author_json(
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
    'roleLabel', CASE membership.role
      WHEN 'admin' THEN 'Administracja'
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

REVOKE ALL ON FUNCTION private.forum_author_json(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.forum_post_json(p_post_id uuid)
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
    'content', post.content,
    'body', post.content,
    'author', private.forum_author_json(post.organization_id, post.author_user_id),
    'isVerifiedExpertAnswer', post.is_verified_expert_answer,
    'isOfficialAdminAnswer', post.is_official_admin_answer,
    'isAcceptedAnswer', post.is_accepted_answer,
    'createdAt', post.created_at,
    'updatedAt', post.updated_at,
    'sources', '[]'::jsonb
  )
  FROM public.forum_posts AS post
  WHERE post.id = p_post_id
  $$;

REVOKE ALL ON FUNCTION private.forum_post_json(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.forum_thread_summary_json(
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
    'excerpt', left(regexp_replace(question.content, '\s+', ' ', 'g'), 360),
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
    'visibility', thread.visibility
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

REVOKE ALL ON FUNCTION private.forum_thread_summary_json(uuid, text, text, double precision)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.search_organization_forum(
  p_organization_id uuid,
  p_query text,
  p_query_embedding extensions.vector DEFAULT NULL::extensions.vector,
  p_category_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_thread_type text DEFAULT NULL,
  p_match_count integer DEFAULT 30,
  p_full_text_weight double precision DEFAULT 1.2,
  p_semantic_weight double precision DEFAULT 1.0,
  p_rrf_k integer DEFAULT 60
) RETURNS TABLE(
  thread_id uuid,
  matched_post_id uuid,
  matched_in text,
  snippet text,
  score double precision
)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  SET hnsw.iterative_scan TO 'relaxed_order'
  AS $$
DECLARE
  normalized_query text := nullif(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'), '');
  candidate_limit integer;
BEGIN
  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  IF normalized_query IS NULL
    OR char_length(normalized_query) > 300
    OR p_match_count NOT BETWEEN 1 AND 100
    OR p_full_text_weight < 0
    OR p_semantic_weight < 0
    OR p_rrf_k NOT BETWEEN 1 AND 1000
    OR (p_status IS NOT NULL AND p_status <> ALL (ARRAY['open', 'answered', 'resolved', 'closed']))
    OR (p_thread_type IS NOT NULL AND p_thread_type <> ALL (ARRAY['question', 'discussion']))
  THEN
    RAISE EXCEPTION 'invalid_forum_search_request' USING errcode = '22023';
  END IF;

  candidate_limit := least(200, greatest(50, p_match_count * 4));

  RETURN QUERY
  WITH search_query AS MATERIALIZED (
    SELECT websearch_to_tsquery('simple'::regconfig, normalized_query) AS value
  ),
  eligible AS MATERIALIZED (
    SELECT
      document.id,
      document.thread_id,
      document.post_id,
      document.document_kind,
      document.title,
      document.content,
      document.search_vector,
      document.source_sha256,
      document.revision
    FROM public.forum_search_documents AS document
    JOIN public.forum_threads AS thread
      ON thread.organization_id = document.organization_id
     AND thread.id = document.thread_id
    JOIN public.forum_categories AS category
      ON category.organization_id = document.organization_id
     AND category.id = document.category_id
    WHERE document.organization_id = p_organization_id
      AND document.is_searchable
      AND NOT thread.is_hidden
      AND category.is_active
      AND (p_category_id IS NULL OR document.category_id = p_category_id)
      AND (p_status IS NULL OR thread.status = p_status)
      AND (p_thread_type IS NULL OR thread.thread_type = p_thread_type)
  ),
  lexical AS MATERIALIZED (
    SELECT
      eligible.id AS document_id,
      row_number() OVER (
        ORDER BY
          ts_rank_cd(eligible.search_vector, search_query.value) DESC,
          eligible.id
      ) AS rank_ix,
      CASE
        WHEN to_tsvector('simple'::regconfig, eligible.title) @@ search_query.value THEN 'title'
        ELSE eligible.document_kind
      END AS matched_in,
      regexp_replace(
        replace(
          replace(
            ts_headline(
              'simple'::regconfig,
              eligible.content,
              search_query.value,
              'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=30,MinWords=8,FragmentDelimiter= … '
            ),
            '<mark>',
            ''
          ),
          '</mark>',
          ''
        ),
        '\s+',
        ' ',
        'g'
      ) AS snippet
    FROM eligible
    CROSS JOIN search_query
    WHERE eligible.search_vector @@ search_query.value
    ORDER BY ts_rank_cd(eligible.search_vector, search_query.value) DESC, eligible.id
    LIMIT candidate_limit
  ),
  semantic AS MATERIALIZED (
    SELECT
      embedding.document_id,
      row_number() OVER (
        ORDER BY embedding.embedding OPERATOR(extensions.<=>) p_query_embedding
      ) AS rank_ix
    FROM public.forum_search_embeddings AS embedding
    JOIN eligible
      ON eligible.id = embedding.document_id
     AND eligible.source_sha256 = embedding.source_sha256
     AND eligible.revision = embedding.source_revision
    WHERE p_query_embedding IS NOT NULL
      AND embedding.organization_id = p_organization_id
      AND embedding.model = 'gemini-embedding-2'
      AND embedding.dimensions = 768
      AND embedding.recipe_version = 'forum-search-v1'
    ORDER BY embedding.embedding OPERATOR(extensions.<=>) p_query_embedding
    LIMIT candidate_limit
  ),
  fused AS MATERIALIZED (
    SELECT
      coalesce(lexical.document_id, semantic.document_id) AS document_id,
      lexical.matched_in,
      lexical.snippet,
      coalesce(p_full_text_weight / (p_rrf_k + lexical.rank_ix), 0.0)
        + coalesce(p_semantic_weight / (p_rrf_k + semantic.rank_ix), 0.0) AS score
    FROM lexical
    FULL JOIN semantic USING (document_id)
  ),
  per_thread AS (
    SELECT
      eligible.thread_id,
      eligible.post_id,
      coalesce(fused.matched_in, eligible.document_kind) AS matched_in,
      coalesce(
        fused.snippet,
        left(regexp_replace(eligible.content, '\s+', ' ', 'g'), 360)
      ) AS snippet,
      fused.score,
      row_number() OVER (
        PARTITION BY eligible.thread_id
        ORDER BY fused.score DESC, eligible.post_id
      ) AS thread_rank
    FROM fused
    JOIN eligible ON eligible.id = fused.document_id
  )
  SELECT
    per_thread.thread_id,
    per_thread.post_id,
    per_thread.matched_in,
    per_thread.snippet,
    per_thread.score
  FROM per_thread
  WHERE per_thread.thread_rank = 1
  ORDER BY per_thread.score DESC, per_thread.thread_id
  LIMIT p_match_count;
END;
$$;

COMMENT ON FUNCTION public.search_organization_forum(
  uuid,
  text,
  extensions.vector,
  uuid,
  text,
  text,
  integer,
  double precision,
  double precision,
  integer
) IS
  'Organization-authorized weighted RRF over GIN full-text and HNSW cosine candidates, deduplicated per thread.';

CREATE FUNCTION public.get_organization_forum_thread(
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

  can_view_hidden := private.is_organization_admin(p_organization_id);

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

CREATE FUNCTION public.list_organization_forum_threads(
  p_organization_id uuid,
  p_query text DEFAULT NULL,
  p_query_embedding extensions.vector DEFAULT NULL::extensions.vector,
  p_category_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_thread_type text DEFAULT NULL,
  p_limit integer DEFAULT 30
) RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_query text := nullif(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'), '');
  categories_json jsonb;
  threads_json jsonb;
  result_total integer;
BEGIN
  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  IF p_limit NOT BETWEEN 1 AND 100
    OR (normalized_query IS NOT NULL AND char_length(normalized_query) > 300)
    OR (p_status IS NOT NULL AND p_status <> ALL (ARRAY['open', 'answered', 'resolved', 'closed']))
    OR (p_thread_type IS NOT NULL AND p_thread_type <> ALL (ARRAY['question', 'discussion']))
  THEN
    RAISE EXCEPTION 'invalid_forum_list_request' USING errcode = '22023';
  END IF;

  IF p_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.forum_categories AS category
    WHERE category.organization_id = p_organization_id
      AND category.id = p_category_id
      AND category.is_active
  ) THEN
    RAISE EXCEPTION 'forum_category_not_found' USING errcode = 'P0002';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', category.id,
        'slug', category.slug,
        'name', category.name,
        'description', category.description,
        'icon', category.icon,
        'color', category.color,
        'sortOrder', category.sort_order,
        'threadCount', (
          SELECT count(*)
          FROM public.forum_threads AS counted_thread
          WHERE counted_thread.organization_id = category.organization_id
            AND counted_thread.category_id = category.id
            AND NOT counted_thread.is_hidden
        )
      )
      ORDER BY category.sort_order, category.name, category.id
    ),
    '[]'::jsonb
  )
  INTO categories_json
  FROM public.forum_categories AS category
  WHERE category.organization_id = p_organization_id
    AND category.is_active;

  IF normalized_query IS NULL THEN
    SELECT count(*)::integer
    INTO result_total
    FROM public.forum_threads AS thread
    JOIN public.forum_categories AS category
      ON category.organization_id = thread.organization_id
     AND category.id = thread.category_id
    WHERE thread.organization_id = p_organization_id
      AND NOT thread.is_hidden
      AND category.is_active
      AND (p_category_id IS NULL OR thread.category_id = p_category_id)
      AND (p_status IS NULL OR thread.status = p_status)
      AND (p_thread_type IS NULL OR thread.thread_type = p_thread_type);

    SELECT coalesce(
      jsonb_agg(private.forum_thread_summary_json(feed.id) ORDER BY feed.last_activity_at DESC, feed.id),
      '[]'::jsonb
    )
    INTO threads_json
    FROM (
      SELECT thread.id, thread.last_activity_at
      FROM public.forum_threads AS thread
      JOIN public.forum_categories AS category
        ON category.organization_id = thread.organization_id
       AND category.id = thread.category_id
      WHERE thread.organization_id = p_organization_id
        AND NOT thread.is_hidden
        AND category.is_active
        AND (p_category_id IS NULL OR thread.category_id = p_category_id)
        AND (p_status IS NULL OR thread.status = p_status)
        AND (p_thread_type IS NULL OR thread.thread_type = p_thread_type)
      ORDER BY thread.last_activity_at DESC, thread.id
      LIMIT p_limit
    ) AS feed;
  ELSE
    SELECT
      coalesce(
        jsonb_agg(
          private.forum_thread_summary_json(
            hit.thread_id,
            hit.matched_in,
            hit.snippet,
            hit.score
          )
          ORDER BY hit.score DESC, hit.thread_id
        ),
        '[]'::jsonb
      ),
      count(*)::integer
    INTO threads_json, result_total
    FROM public.search_organization_forum(
      p_organization_id,
      normalized_query,
      p_query_embedding,
      p_category_id,
      p_status,
      p_thread_type,
      p_limit,
      1.2,
      1.0,
      60
    ) AS hit;
  END IF;

  RETURN jsonb_build_object(
    'categories', categories_json,
    'threads', threads_json,
    'searchMode', CASE
      WHEN normalized_query IS NULL THEN 'browse'
      WHEN p_query_embedding IS NULL THEN 'lexical'
      ELSE 'hybrid'
    END,
    'query', normalized_query,
    'total', coalesce(result_total, 0)
  );
END;
$$;

CREATE FUNCTION public.create_organization_forum_thread(
  p_organization_id uuid,
  p_category_id uuid,
  p_thread_type text,
  p_title text,
  p_body text,
  p_language_code text DEFAULT 'pl',
  p_visibility text DEFAULT 'organization',
  p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  normalized_title text := nullif(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  normalized_body text := nullif(btrim(p_body), '');
  normalized_language text := nullif(btrim(p_language_code), '');
  existing_thread public.forum_threads%rowtype;
  existing_body text;
  inserted_thread public.forum_threads%rowtype;
BEGIN
  IF actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = actor_user_id
  ) THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  IF p_category_id IS NULL
    OR p_thread_type IS NULL
    OR p_thread_type <> ALL (ARRAY['question', 'discussion'])
    OR normalized_title IS NULL
    OR char_length(normalized_title) NOT BETWEEN 5 AND 240
    OR normalized_body IS NULL
    OR char_length(normalized_body) NOT BETWEEN 2 AND 30000
    OR normalized_language IS NULL
    OR normalized_language !~ '^[a-z]{2}(?:-[A-Z]{2})?$'
    OR p_visibility IS NULL
    OR p_visibility <> 'organization'
  THEN
    RAISE EXCEPTION 'invalid_forum_thread_request' USING errcode = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.forum_categories AS category
    WHERE category.organization_id = p_organization_id
      AND category.id = p_category_id
      AND category.is_active
  ) THEN
    RAISE EXCEPTION 'forum_category_not_found' USING errcode = 'P0002';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT thread.*
    INTO existing_thread
    FROM public.forum_threads AS thread
    WHERE thread.organization_id = p_organization_id
      AND thread.author_user_id = actor_user_id
      AND thread.client_request_id = p_client_request_id;

    IF FOUND THEN
      SELECT question.content
      INTO existing_body
      FROM public.forum_posts AS question
      WHERE question.organization_id = existing_thread.organization_id
        AND question.thread_id = existing_thread.id
        AND question.kind = 'question';

      IF existing_thread.category_id IS DISTINCT FROM p_category_id
        OR existing_thread.thread_type IS DISTINCT FROM p_thread_type
        OR existing_thread.title IS DISTINCT FROM normalized_title
        OR existing_thread.language_code IS DISTINCT FROM normalized_language
        OR existing_thread.visibility IS DISTINCT FROM p_visibility
        OR existing_body IS DISTINCT FROM normalized_body
      THEN
        RAISE EXCEPTION 'forum_thread_idempotency_key_reused' USING errcode = '23505';
      END IF;
      RETURN public.get_organization_forum_thread(p_organization_id, existing_thread.id);
    END IF;
  END IF;

  INSERT INTO public.forum_threads (
    organization_id,
    category_id,
    author_user_id,
    thread_type,
    status,
    title,
    language_code,
    visibility,
    client_request_id
  ) VALUES (
    p_organization_id,
    p_category_id,
    actor_user_id,
    p_thread_type,
    'open',
    normalized_title,
    normalized_language,
    p_visibility,
    p_client_request_id
  )
  RETURNING * INTO inserted_thread;

  INSERT INTO public.forum_posts (
    organization_id,
    thread_id,
    author_user_id,
    kind,
    content
  ) VALUES (
    p_organization_id,
    inserted_thread.id,
    actor_user_id,
    'question',
    normalized_body
  );

  RETURN public.get_organization_forum_thread(p_organization_id, inserted_thread.id);
END;
$$;

CREATE FUNCTION public.create_organization_forum_reply(
  p_organization_id uuid,
  p_thread_id uuid,
  p_body text,
  p_client_request_id uuid DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  actor_role text;
  normalized_body text := nullif(btrim(p_body), '');
  target_thread public.forum_threads%rowtype;
  existing_post public.forum_posts%rowtype;
  inserted_post public.forum_posts%rowtype;
  thread_payload jsonb;
BEGIN
  SELECT membership.role
  INTO actor_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = p_organization_id
    AND membership.user_id = actor_user_id;

  IF actor_user_id IS NULL OR actor_role IS NULL THEN
    RAISE EXCEPTION 'organization_membership_required' USING errcode = '42501';
  END IF;

  IF normalized_body IS NULL OR char_length(normalized_body) NOT BETWEEN 2 AND 30000 THEN
    RAISE EXCEPTION 'invalid_forum_reply_request' USING errcode = '22023';
  END IF;

  SELECT thread.*
  INTO target_thread
  FROM public.forum_threads AS thread
  WHERE thread.organization_id = p_organization_id
    AND thread.id = p_thread_id
    AND NOT thread.is_hidden
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_thread_not_found' USING errcode = 'P0002';
  END IF;
  IF target_thread.status = 'closed' THEN
    RAISE EXCEPTION 'forum_thread_closed' USING errcode = '23514';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    SELECT post.*
    INTO existing_post
    FROM public.forum_posts AS post
    WHERE post.organization_id = p_organization_id
      AND post.author_user_id = actor_user_id
      AND post.client_request_id = p_client_request_id;

    IF FOUND THEN
      IF existing_post.thread_id IS DISTINCT FROM p_thread_id
        OR existing_post.content IS DISTINCT FROM normalized_body
      THEN
        RAISE EXCEPTION 'forum_reply_idempotency_key_reused' USING errcode = '23505';
      END IF;
      thread_payload := public.get_organization_forum_thread(p_organization_id, p_thread_id);
      RETURN jsonb_build_object(
        'post', private.forum_post_json(existing_post.id),
        'thread', thread_payload -> 'thread'
      );
    END IF;
  END IF;

  INSERT INTO public.forum_posts (
    organization_id,
    thread_id,
    author_user_id,
    kind,
    content,
    is_verified_expert_answer,
    is_official_admin_answer,
    client_request_id
  ) VALUES (
    p_organization_id,
    p_thread_id,
    actor_user_id,
    'reply',
    normalized_body,
    actor_role = 'expert',
    actor_role = 'admin',
    p_client_request_id
  )
  RETURNING * INTO inserted_post;

  thread_payload := public.get_organization_forum_thread(p_organization_id, p_thread_id);
  RETURN jsonb_build_object(
    'post', private.forum_post_json(inserted_post.id),
    'thread', thread_payload -> 'thread'
  );
END;
$$;

CREATE FUNCTION public.claim_forum_embedding_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lock_timeout interval DEFAULT interval '5 minutes'
) RETURNS TABLE(
  id uuid,
  organization_id uuid,
  document_id uuid,
  source_sha256 text,
  source_revision bigint,
  attempts integer,
  max_attempts integer,
  title text,
  content text,
  model text,
  dimensions integer,
  recipe_version text
)
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
    RAISE EXCEPTION 'invalid_forum_embedding_job_claim' USING errcode = '22023';
  END IF;

  UPDATE public.forum_embedding_jobs AS job
  SET
    status = 'failed',
    locked_at = NULL,
    locked_by = NULL,
    last_error = coalesce(job.last_error, 'forum_embedding_lease_expired_after_max_attempts')
  WHERE job.status = 'processing'
    AND job.locked_at < claim_time - p_lock_timeout
    AND job.attempts >= job.max_attempts;

  RETURN QUERY
  WITH candidates AS (
    SELECT job.id
    FROM public.forum_embedding_jobs AS job
    JOIN public.forum_search_documents AS document
      ON document.organization_id = job.organization_id
     AND document.id = job.document_id
    WHERE (
      (
        job.status = ANY (ARRAY['pending'::text, 'failed'::text])
        AND job.available_at <= claim_time
      )
      OR (
        job.status = 'processing'
        AND job.locked_at < claim_time - p_lock_timeout
      )
    )
      AND job.attempts < job.max_attempts
      AND document.is_searchable
      AND document.source_sha256 = job.source_sha256
      AND document.revision = job.source_revision
    ORDER BY job.available_at, job.created_at, job.id
    FOR UPDATE OF job SKIP LOCKED
    LIMIT p_limit
  ),
  claimed AS (
    UPDATE public.forum_embedding_jobs AS job
    SET
      status = 'processing',
      attempts = job.attempts + 1,
      locked_at = claim_time,
      locked_by = normalized_worker_id,
      last_error = NULL,
      processed_at = NULL
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  )
  SELECT
    claimed.id,
    claimed.organization_id,
    claimed.document_id,
    claimed.source_sha256,
    claimed.source_revision,
    claimed.attempts,
    claimed.max_attempts,
    document.title,
    document.content,
    claimed.model,
    claimed.dimensions,
    claimed.recipe_version
  FROM claimed
  JOIN public.forum_search_documents AS document
    ON document.organization_id = claimed.organization_id
   AND document.id = claimed.document_id
  ORDER BY claimed.available_at, claimed.created_at, claimed.id;
END;
$$;

CREATE FUNCTION public.complete_forum_embedding_job(
  p_job_id uuid,
  p_worker_id text,
  p_embedding extensions.vector
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  completion_time timestamp with time zone := statement_timestamp();
  target_job public.forum_embedding_jobs%rowtype;
  target_document public.forum_search_documents%rowtype;
BEGIN
  IF p_job_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_embedding IS NULL
  THEN
    RAISE EXCEPTION 'invalid_forum_embedding_job_completion' USING errcode = '22023';
  END IF;

  SELECT job.*
  INTO target_job
  FROM public.forum_embedding_jobs AS job
  WHERE job.id = p_job_id
    AND job.status = 'processing'
    AND job.locked_by = normalized_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_embedding_job_claim_not_found' USING errcode = 'P0002';
  END IF;

  SELECT document.*
  INTO target_document
  FROM public.forum_search_documents AS document
  WHERE document.organization_id = target_job.organization_id
    AND document.id = target_job.document_id
  FOR UPDATE;

  IF NOT FOUND
    OR NOT target_document.is_searchable
    OR target_document.source_sha256 IS DISTINCT FROM target_job.source_sha256
    OR target_document.revision IS DISTINCT FROM target_job.source_revision
  THEN
    UPDATE public.forum_embedding_jobs AS job
    SET
      status = 'cancelled',
      locked_at = NULL,
      locked_by = NULL,
      last_error = 'forum_embedding_source_revision_stale',
      processed_at = NULL
    WHERE job.id = target_job.id;

    RETURN jsonb_build_object(
      'id', target_job.id,
      'status', 'cancelled',
      'stale', true
    );
  END IF;

  INSERT INTO public.forum_search_embeddings (
    organization_id,
    document_id,
    model,
    dimensions,
    recipe_version,
    source_sha256,
    source_revision,
    embedding
  ) VALUES (
    target_job.organization_id,
    target_job.document_id,
    target_job.model,
    target_job.dimensions,
    target_job.recipe_version,
    target_job.source_sha256,
    target_job.source_revision,
    p_embedding
  )
  ON CONFLICT (document_id, model, recipe_version, source_revision)
  DO UPDATE SET
    source_sha256 = excluded.source_sha256,
    dimensions = excluded.dimensions,
    embedding = excluded.embedding,
    created_at = completion_time;

  UPDATE public.forum_embedding_jobs AS job
  SET
    status = 'completed',
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    processed_at = completion_time
  WHERE job.id = target_job.id;

  RETURN jsonb_build_object(
    'id', target_job.id,
    'status', 'completed',
    'stale', false,
    'processedAt', completion_time
  );
END;
$$;

CREATE FUNCTION public.retry_forum_embedding_job(
  p_job_id uuid,
  p_worker_id text,
  p_error text,
  p_retry_delay interval DEFAULT interval '15 seconds'
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  normalized_error text := nullif(btrim(p_error), '');
  retry_time timestamp with time zone := statement_timestamp();
  target_job public.forum_embedding_jobs%rowtype;
BEGIN
  IF p_job_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR normalized_error IS NULL
    OR char_length(normalized_error) > 4000
    OR p_retry_delay < interval '0 seconds'
    OR p_retry_delay > interval '1 day'
  THEN
    RAISE EXCEPTION 'invalid_forum_embedding_job_retry' USING errcode = '22023';
  END IF;

  SELECT job.*
  INTO target_job
  FROM public.forum_embedding_jobs AS job
  WHERE job.id = p_job_id
    AND job.status = 'processing'
    AND job.locked_by = normalized_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forum_embedding_job_claim_not_found' USING errcode = 'P0002';
  END IF;

  UPDATE public.forum_embedding_jobs AS job
  SET
    status = 'failed',
    available_at = retry_time + p_retry_delay,
    locked_at = NULL,
    locked_by = NULL,
    last_error = normalized_error,
    processed_at = NULL
  WHERE job.id = target_job.id;

  RETURN jsonb_build_object(
    'id', target_job.id,
    'status', 'failed',
    'attempts', target_job.attempts,
    'maxAttempts', target_job.max_attempts,
    'availableAt', retry_time + p_retry_delay
  );
END;
$$;

ALTER TABLE public.forum_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_thread_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_search_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_search_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_embedding_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all ON public.forum_categories
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);
CREATE POLICY openexpert_service_all ON public.forum_threads
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);
CREATE POLICY openexpert_service_all ON public.forum_posts
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);
CREATE POLICY openexpert_service_all ON public.forum_thread_reads
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);
CREATE POLICY openexpert_service_all ON public.forum_search_documents
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);
CREATE POLICY openexpert_service_all ON public.forum_search_embeddings
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);
CREATE POLICY openexpert_service_all ON public.forum_embedding_jobs
  FOR ALL TO openexpert_service USING (true) WITH CHECK (true);

CREATE POLICY forum_categories_member_read ON public.forum_categories
  FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

CREATE POLICY forum_threads_member_read ON public.forum_threads
  FOR SELECT TO authenticated
  USING (
    private.is_organization_member(organization_id)
    AND (NOT is_hidden OR private.is_organization_admin(organization_id))
  );

CREATE POLICY forum_posts_member_read ON public.forum_posts
  FOR SELECT TO authenticated
  USING (
    private.is_organization_member(organization_id)
    AND (NOT is_hidden OR private.is_organization_admin(organization_id))
  );

CREATE POLICY forum_thread_reads_own_all ON public.forum_thread_reads
  FOR ALL TO authenticated
  USING (
    private.is_organization_member(organization_id)
    AND user_id = (SELECT app.current_user_id())
  )
  WITH CHECK (
    private.is_organization_member(organization_id)
    AND user_id = (SELECT app.current_user_id())
  );

REVOKE ALL ON TABLE public.forum_categories
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.forum_threads
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.forum_posts
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.forum_thread_reads
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.forum_search_documents
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.forum_search_embeddings
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.forum_embedding_jobs
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_categories TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_threads TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_posts TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_thread_reads TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_search_documents TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_search_embeddings TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_embedding_jobs TO openexpert_service;

GRANT SELECT ON TABLE public.forum_categories TO authenticated;
GRANT SELECT ON TABLE public.forum_threads TO authenticated;
GRANT SELECT ON TABLE public.forum_posts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.forum_thread_reads TO authenticated;

REVOKE ALL ON FUNCTION public.search_organization_forum(
  uuid, text, extensions.vector, uuid, text, text, integer,
  double precision, double precision, integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.search_organization_forum(
  uuid, text, extensions.vector, uuid, text, text, integer,
  double precision, double precision, integer
) TO authenticated, openexpert_service;

REVOKE ALL ON FUNCTION public.list_organization_forum_threads(
  uuid, text, extensions.vector, uuid, text, text, integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.list_organization_forum_threads(
  uuid, text, extensions.vector, uuid, text, text, integer
) TO authenticated, openexpert_service;

REVOKE ALL ON FUNCTION public.get_organization_forum_thread(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_organization_forum_thread(uuid, uuid)
  TO authenticated, openexpert_service;

REVOKE ALL ON FUNCTION public.create_organization_forum_thread(
  uuid, uuid, text, text, text, text, text, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_organization_forum_thread(
  uuid, uuid, text, text, text, text, text, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.create_organization_forum_reply(
  uuid, uuid, text, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.create_organization_forum_reply(
  uuid, uuid, text, uuid
) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_forum_embedding_jobs(text, integer, interval)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_forum_embedding_jobs(text, integer, interval)
  TO openexpert_service;

REVOKE ALL ON FUNCTION public.complete_forum_embedding_job(
  uuid, text, extensions.vector
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.complete_forum_embedding_job(
  uuid, text, extensions.vector
) TO openexpert_service;

REVOKE ALL ON FUNCTION public.retry_forum_embedding_job(
  uuid, text, text, interval
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.retry_forum_embedding_job(
  uuid, text, text, interval
) TO openexpert_service;
