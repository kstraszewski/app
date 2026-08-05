-- Durable deletion queue for private message-attachment objects. Every row
-- deletion, including FK cascades, records the opaque Blob path in the same
-- transaction. Object deletion can then be retried independently without
-- losing the only reference to the private object.

CREATE TABLE public.crm_case_message_attachment_blob_deletions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  storage_path text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  locked_at timestamp with time zone,
  locked_by text,
  last_error text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_message_attachment_blob_deletions_pkey PRIMARY KEY (id),
  CONSTRAINT crm_case_message_attachment_blob_deletions_storage_path_key
    UNIQUE (storage_path),
  CONSTRAINT crm_case_message_attachment_blob_deletions_path_check CHECK (
    nullif(btrim(storage_path), '') IS NOT NULL
    AND char_length(storage_path) <= 1024
  ),
  CONSTRAINT crm_case_message_attachment_blob_deletions_attempts_check CHECK (
    attempts >= 0
  ),
  CONSTRAINT crm_case_message_attachment_blob_deletions_lock_shape_check CHECK (
    (
      locked_at IS NULL
      AND locked_by IS NULL
    )
    OR (
      locked_at IS NOT NULL
      AND nullif(btrim(locked_by), '') IS NOT NULL
      AND char_length(locked_by) <= 200
      AND locked_at >= created_at
    )
  ),
  CONSTRAINT crm_case_message_attachment_blob_deletions_error_check CHECK (
    last_error IS NULL OR char_length(last_error) <= 4000
  )
);

COMMENT ON TABLE public.crm_case_message_attachment_blob_deletions IS
  'Durable, retryable deletion queue for private Blob paths copied before attachment metadata is removed.';

CREATE INDEX crm_case_message_attachment_blob_deletions_claim_idx
  ON public.crm_case_message_attachment_blob_deletions (
    created_at,
    locked_at,
    id
  );

CREATE FUNCTION private.enqueue_case_message_attachment_blob_deletion()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  INSERT INTO public.crm_case_message_attachment_blob_deletions (
    storage_path
  ) VALUES (
    OLD.storage_path
  )
  ON CONFLICT (storage_path) DO NOTHING;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_case_message_attachment_blob_deletion()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_message_attachments_enqueue_blob_deletion
  BEFORE DELETE ON public.crm_case_message_attachments
  FOR EACH ROW
  EXECUTE FUNCTION private.enqueue_case_message_attachment_blob_deletion();

-- The former one-phase function remains safe because the trigger above now
-- captures every deleted path, but new application workers use the explicit
-- enqueue/claim/complete protocol below.
REVOKE ALL ON FUNCTION public.delete_expired_case_message_attachment_reservations(
  integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.enqueue_expired_case_message_attachment_deletions(
  p_limit integer DEFAULT 100
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  cleanup_time timestamp with time zone := statement_timestamp();
  deleted_count integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_cleanup_limit'
      USING errcode = '22023';
  END IF;

  WITH candidates AS (
    SELECT attachment.id
    FROM public.crm_case_message_attachments AS attachment
    WHERE attachment.message_id IS NULL
      AND attachment.expires_at < cleanup_time
    ORDER BY attachment.expires_at, attachment.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ),
  deleted AS (
    DELETE FROM public.crm_case_message_attachments AS attachment
    USING candidates
    WHERE attachment.id = candidates.id
      AND attachment.message_id IS NULL
    RETURNING attachment.id
  )
  SELECT count(*)::integer
  INTO deleted_count
  FROM deleted;

  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_expired_case_message_attachment_deletions(
  integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.enqueue_expired_case_message_attachment_deletions(
  integer
) TO openexpert_service;

CREATE FUNCTION public.claim_case_message_attachment_blob_deletions(
  p_worker_id text,
  p_limit integer DEFAULT 100,
  p_lock_timeout interval DEFAULT interval '5 minutes'
) RETURNS TABLE (id uuid, storage_path text)
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
    OR p_limit NOT BETWEEN 1 AND 200
    OR p_lock_timeout IS NULL
    OR p_lock_timeout <= interval '0 seconds'
    OR p_lock_timeout > interval '1 hour'
  THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_blob_deletion_claim'
      USING errcode = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT deletion.id
    FROM public.crm_case_message_attachment_blob_deletions AS deletion
    WHERE deletion.locked_at IS NULL
      OR deletion.locked_at < claim_time - p_lock_timeout
    ORDER BY deletion.created_at, deletion.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.crm_case_message_attachment_blob_deletions AS deletion
  SET
    locked_at = claim_time,
    locked_by = normalized_worker_id,
    attempts = deletion.attempts + 1,
    last_error = NULL
  FROM candidates
  WHERE deletion.id = candidates.id
  RETURNING deletion.id, deletion.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_case_message_attachment_blob_deletions(
  text,
  integer,
  interval
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_case_message_attachment_blob_deletions(
  text,
  integer,
  interval
) TO openexpert_service;

CREATE FUNCTION public.complete_case_message_attachment_blob_deletion(
  p_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  normalized_error text := nullif(btrim(p_error), '');
  target_deletion public.crm_case_message_attachment_blob_deletions%rowtype;
BEGIN
  IF p_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_succeeded IS NULL
    OR (
      normalized_error IS NOT NULL
      AND char_length(normalized_error) > 4000
    )
  THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_blob_deletion_completion'
      USING errcode = '22023';
  END IF;

  SELECT deletion.*
  INTO target_deletion
  FROM public.crm_case_message_attachment_blob_deletions AS deletion
  WHERE deletion.id = p_id
    AND deletion.locked_by = normalized_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_message_attachment_blob_deletion_claim_not_found'
      USING errcode = 'P0002';
  END IF;

  IF p_succeeded THEN
    DELETE FROM public.crm_case_message_attachment_blob_deletions AS deletion
    WHERE deletion.id = target_deletion.id;

    RETURN jsonb_build_object(
      'id', target_deletion.id,
      'status', 'deleted',
      'attempts', target_deletion.attempts
    );
  END IF;

  UPDATE public.crm_case_message_attachment_blob_deletions AS deletion
  SET
    locked_at = NULL,
    locked_by = NULL,
    last_error = coalesce(
      normalized_error,
      'case_message_attachment_blob_delete_failed'::text
    )
  WHERE deletion.id = target_deletion.id
  RETURNING * INTO target_deletion;

  RETURN jsonb_build_object(
    'id', target_deletion.id,
    'status', 'retryable',
    'attempts', target_deletion.attempts,
    'lastError', target_deletion.last_error
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_case_message_attachment_blob_deletion(
  uuid,
  text,
  boolean,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.complete_case_message_attachment_blob_deletion(
  uuid,
  text,
  boolean,
  text
) TO openexpert_service;

ALTER TABLE public.crm_case_message_attachment_blob_deletions
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_case_message_attachment_blob_deletions
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Client anonymization must never report success while message bodies, file
-- names, or file bytes still require an explicit retention decision. This
-- mirrors the existing manual-review guard for documents and offer snapshots.
CREATE FUNCTION private.require_case_message_retention_review()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  message_count integer := 0;
  attachment_count integer := 0;
BEGIN
  IF NEW.status = 'completed'::text
    AND OLD.status IS DISTINCT FROM 'completed'::text
  THEN
    SELECT count(*)::integer
    INTO message_count
    FROM public.crm_case_messages AS message
    JOIN public.crm_case_conversations AS conversation
      ON conversation.organization_id = message.organization_id
     AND conversation.id = message.conversation_id
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.client_id = NEW.client_id;

    SELECT count(*)::integer
    INTO attachment_count
    FROM public.crm_case_message_attachments AS attachment
    JOIN public.crm_case_conversations AS conversation
      ON conversation.organization_id = attachment.organization_id
     AND conversation.id = attachment.conversation_id
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.client_id = NEW.client_id;

    IF message_count > 0 OR attachment_count > 0 THEN
      RAISE EXCEPTION 'anonymization_documents_require_manual_retention_review'
        USING
          errcode = '23514',
          detail = jsonb_build_object(
            'messageCount', message_count,
            'messageAttachmentCount', attachment_count
          )::text;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.require_case_message_retention_review()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_client_anonymization_requires_message_retention_review
  BEFORE UPDATE OF status ON public.crm_client_anonymization_requests
  FOR EACH ROW
  EXECUTE FUNCTION private.require_case_message_retention_review();
