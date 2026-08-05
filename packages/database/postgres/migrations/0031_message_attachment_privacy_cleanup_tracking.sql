-- Snapshot ownership in the deletion queue so privacy completion can wait for
-- confirmed Blob removal even after attachment or conversation metadata has
-- been deleted by a cascade.

ALTER TABLE public.crm_case_message_attachment_blob_deletions
  ADD COLUMN organization_id uuid,
  ADD COLUMN conversation_id uuid,
  ADD COLUMN client_id uuid,
  ADD COLUMN attachment_id uuid;

UPDATE public.crm_case_message_attachment_blob_deletions AS deletion
SET
  organization_id = split_part(deletion.storage_path, '/', 1)::uuid,
  conversation_id = split_part(deletion.storage_path, '/', 3)::uuid,
  attachment_id = split_part(
    split_part(deletion.storage_path, '/', 5),
    '.',
    1
  )::uuid;

UPDATE public.crm_case_message_attachment_blob_deletions AS deletion
SET client_id = conversation.client_id
FROM public.crm_case_conversations AS conversation
WHERE conversation.organization_id = deletion.organization_id
  AND conversation.id = deletion.conversation_id;

CREATE INDEX crm_case_message_attachment_blob_deletions_client_idx
  ON public.crm_case_message_attachment_blob_deletions (
    organization_id,
    client_id,
    available_at,
    id
  )
  WHERE client_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.enqueue_case_message_attachment_blob_deletion()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_client_id uuid;
  safe_delete_time timestamp with time zone := greatest(
    statement_timestamp(),
    OLD.created_at + interval '30 minutes'
  );
BEGIN
  SELECT conversation.client_id
  INTO target_client_id
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = OLD.organization_id
    AND conversation.id = OLD.conversation_id;

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
    );

  RETURN OLD;
END;
$$;

CREATE FUNCTION private.enqueue_conversation_attachment_blob_deletions()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  INSERT INTO public.crm_case_message_attachment_blob_deletions (
    storage_path,
    available_at,
    organization_id,
    conversation_id,
    client_id,
    attachment_id
  )
  SELECT
    attachment.storage_path,
    greatest(
      statement_timestamp(),
      attachment.created_at + interval '30 minutes'
    ),
    attachment.organization_id,
    attachment.conversation_id,
    OLD.client_id,
    attachment.id
  FROM public.crm_case_message_attachments AS attachment
  WHERE attachment.organization_id = OLD.organization_id
    AND attachment.conversation_id = OLD.id
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
    );

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_conversation_attachment_blob_deletions()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_conversations_enqueue_attachment_blob_deletions
  BEFORE DELETE ON public.crm_case_conversations
  FOR EACH ROW
  EXECUTE FUNCTION private.enqueue_conversation_attachment_blob_deletions();

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

    SELECT count(*)::integer
    INTO pending_blob_deletion_count
    FROM public.crm_case_message_attachment_blob_deletions AS deletion
    WHERE deletion.organization_id = NEW.organization_id
      AND deletion.client_id = NEW.client_id;

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
      AND conversation.client_id = NEW.client_id
      AND message.organization_id = conversation.organization_id
      AND message.conversation_id = conversation.id;
  END IF;

  RETURN NEW;
END;
$$;
