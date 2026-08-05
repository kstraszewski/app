-- Delay deletion jobs until every direct-upload URL and in-flight transfer is
-- guaranteed to have expired, then keep the job until Blob absence is verified.

ALTER TABLE public.crm_case_message_attachment_blob_deletions
  ADD COLUMN available_at timestamp with time zone DEFAULT now() NOT NULL;

UPDATE public.crm_case_message_attachment_blob_deletions AS deletion
SET available_at = greatest(
  deletion.available_at,
  deletion.created_at + interval '30 minutes'
);

DROP INDEX public.crm_case_message_attachment_blob_deletions_claim_idx;

CREATE INDEX crm_case_message_attachment_blob_deletions_claim_idx
  ON public.crm_case_message_attachment_blob_deletions (
    available_at,
    created_at,
    locked_at,
    id
  );

CREATE OR REPLACE FUNCTION private.enqueue_case_message_attachment_blob_deletion()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  safe_delete_time timestamp with time zone := greatest(
    statement_timestamp(),
    OLD.created_at + interval '30 minutes'
  );
BEGIN
  INSERT INTO public.crm_case_message_attachment_blob_deletions (
    storage_path,
    available_at
  ) VALUES (
    OLD.storage_path,
    safe_delete_time
  )
  ON CONFLICT (storage_path) DO UPDATE
  SET available_at = greatest(
    crm_case_message_attachment_blob_deletions.available_at,
    EXCLUDED.available_at
  );

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_case_message_attachment_blob_deletions(
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
    WHERE deletion.available_at <= claim_time
      AND (
        deletion.locked_at IS NULL
        OR deletion.locked_at < claim_time - p_lock_timeout
      )
    ORDER BY deletion.available_at, deletion.created_at, deletion.id
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

-- Idempotent completion must not revive an already expired reservation.
CREATE OR REPLACE FUNCTION public.complete_case_message_attachment_upload(
  p_attachment_id uuid,
  p_storage_path text,
  p_content_type text,
  p_size_bytes bigint,
  p_etag text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_attachment public.crm_case_message_attachments%rowtype;
  normalized_path text := nullif(btrim(p_storage_path), '');
  normalized_content_type text := lower(nullif(btrim(p_content_type), ''));
  normalized_etag text := nullif(btrim(p_etag), '');
  completion_time timestamp with time zone := statement_timestamp();
BEGIN
  IF p_attachment_id IS NULL
    OR normalized_path IS NULL
    OR normalized_content_type IS NULL
    OR p_size_bytes IS NULL
    OR p_size_bytes NOT BETWEEN 1 AND 26214400
    OR normalized_etag IS NULL
    OR char_length(normalized_etag) > 200
  THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_upload_completion'
      USING errcode = '22023';
  END IF;

  SELECT attachment.*
  INTO target_attachment
  FROM public.crm_case_message_attachments AS attachment
  WHERE attachment.id = p_attachment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_message_attachment_not_found'
      USING errcode = 'P0002';
  END IF;

  IF target_attachment.storage_path IS DISTINCT FROM normalized_path
    OR target_attachment.content_type IS DISTINCT FROM normalized_content_type
    OR target_attachment.size_bytes IS DISTINCT FROM p_size_bytes
  THEN
    RAISE EXCEPTION 'case_message_attachment_upload_mismatch'
      USING errcode = '23505';
  END IF;

  IF target_attachment.discarded_at IS NOT NULL
    OR target_attachment.expires_at <= completion_time
  THEN
    RAISE EXCEPTION 'case_message_attachment_reservation_expired'
      USING errcode = '55000';
  END IF;

  IF target_attachment.uploaded_at IS NOT NULL THEN
    IF target_attachment.etag IS DISTINCT FROM normalized_etag THEN
      RAISE EXCEPTION 'case_message_attachment_upload_mismatch'
        USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object(
      'id', target_attachment.id,
      'name', target_attachment.file_name,
      'mimeType', target_attachment.content_type,
      'sizeBytes', target_attachment.size_bytes,
      'uploadedAt', target_attachment.uploaded_at,
      'changed', false
    );
  END IF;

  UPDATE public.crm_case_message_attachments AS attachment
  SET
    etag = normalized_etag,
    uploaded_at = completion_time
  WHERE attachment.id = target_attachment.id
  RETURNING * INTO target_attachment;

  RETURN jsonb_build_object(
    'id', target_attachment.id,
    'name', target_attachment.file_name,
    'mimeType', target_attachment.content_type,
    'sizeBytes', target_attachment.size_bytes,
    'uploadedAt', target_attachment.uploaded_at,
    'changed', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_case_message_attachment_upload(
  uuid,
  text,
  text,
  bigint,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.complete_case_message_attachment_upload(
  uuid,
  text,
  text,
  bigint,
  text
) TO openexpert_service;

-- Preserve the conversation timeline during anonymization, but scrub every
-- message body and the client's auth identity. Attachments remain a deliberate
-- manual-retention gate because their bytes cannot be safely anonymized.
CREATE OR REPLACE FUNCTION private.require_case_message_retention_review()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  attachment_count integer := 0;
BEGIN
  IF NEW.status = 'completed'::text
    AND OLD.status IS DISTINCT FROM 'completed'::text
  THEN
    PERFORM 1
    FROM public.crm_case_conversations AS conversation
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.client_id = NEW.client_id
    ORDER BY conversation.id
    FOR UPDATE;

    SELECT count(*)::integer
    INTO attachment_count
    FROM public.crm_case_message_attachments AS attachment
    JOIN public.crm_case_conversations AS conversation
      ON conversation.organization_id = attachment.organization_id
     AND conversation.id = attachment.conversation_id
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.client_id = NEW.client_id;

    IF attachment_count > 0 THEN
      RAISE EXCEPTION 'anonymization_documents_require_manual_retention_review'
        USING
          errcode = '23514',
          detail = jsonb_build_object(
            'messageAttachmentCount', attachment_count
          )::text;
    END IF;

    UPDATE public.crm_case_messages AS message
    SET
      body = 'Wiadomość zanonimizowana.',
      sender_auth_user_id = NULL
    FROM public.crm_case_conversations AS conversation
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.client_id = NEW.client_id
      AND message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION private.reject_anonymized_client_message_write()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.crm_case_conversations AS conversation
    JOIN public.crm_clients AS client
      ON client.organization_id = conversation.organization_id
     AND client.id = conversation.client_id
    WHERE conversation.organization_id = NEW.organization_id
      AND conversation.id = NEW.conversation_id
      AND client.status_code = 'anonymized'::text
  ) THEN
    RAISE EXCEPTION 'case_message_client_anonymized'
      USING errcode = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_anonymized_client_message_write()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_messages_reject_anonymized_client_write
  BEFORE INSERT ON public.crm_case_messages
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_anonymized_client_message_write();

CREATE TRIGGER crm_case_message_attachments_reject_anonymized_client_write
  BEFORE INSERT ON public.crm_case_message_attachments
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_anonymized_client_message_write();
