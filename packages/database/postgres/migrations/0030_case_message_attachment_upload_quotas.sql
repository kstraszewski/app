-- Enforce draft and actor byte quotas before issuing another direct-upload
-- reservation. The reserve RPC already serializes an actor with an advisory
-- lock and each draft through its conversation row lock.

CREATE FUNCTION private.enforce_case_message_attachment_upload_quota()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  quota_time timestamp with time zone := statement_timestamp();
  draft_count bigint := 0;
  draft_bytes bigint := 0;
  recent_actor_bytes bigint := 0;
  active_actor_bytes bigint := 0;
BEGIN
  IF NEW.message_id IS NOT NULL OR NEW.discarded_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*),
    coalesce(sum(attachment.size_bytes), 0)
  INTO draft_count, draft_bytes
  FROM public.crm_case_message_attachments AS attachment
  WHERE attachment.organization_id = NEW.organization_id
    AND attachment.conversation_id = NEW.conversation_id
    AND attachment.client_message_id = NEW.client_message_id
    AND attachment.message_id IS NULL
    AND attachment.discarded_at IS NULL
    AND attachment.expires_at > quota_time;

  IF draft_count >= 10 THEN
    RAISE EXCEPTION 'case_message_attachment_draft_file_limit_exceeded'
      USING errcode = '23514';
  END IF;
  IF draft_bytes + NEW.size_bytes > 52428800 THEN
    RAISE EXCEPTION 'case_message_attachment_draft_size_limit_exceeded'
      USING errcode = '23514';
  END IF;

  SELECT
    coalesce(sum(attachment.size_bytes) FILTER (
      WHERE attachment.created_at >= quota_time - interval '60 seconds'
    ), 0),
    coalesce(sum(attachment.size_bytes) FILTER (
      WHERE attachment.message_id IS NULL
        AND attachment.discarded_at IS NULL
        AND attachment.expires_at > quota_time
    ), 0)
  INTO recent_actor_bytes, active_actor_bytes
  FROM public.crm_case_message_attachments AS attachment
  WHERE attachment.organization_id = NEW.organization_id
    AND attachment.uploader_kind = NEW.uploader_kind
    AND (
      (
        NEW.uploader_kind = 'staff'::text
        AND attachment.uploader_user_id = NEW.uploader_user_id
      )
      OR (
        NEW.uploader_kind = 'client'::text
        AND attachment.uploader_auth_user_id = NEW.uploader_auth_user_id
      )
    );

  IF recent_actor_bytes + NEW.size_bytes > 104857600 THEN
    RAISE EXCEPTION 'case_message_attachment_reservation_rate_limited'
      USING errcode = 'P0001';
  END IF;
  IF active_actor_bytes + NEW.size_bytes > 262144000 THEN
    RAISE EXCEPTION 'too_many_active_case_message_attachment_reservations'
      USING errcode = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_case_message_attachment_upload_quota()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_message_attachments_enforce_upload_quota
  BEFORE INSERT ON public.crm_case_message_attachments
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_case_message_attachment_upload_quota();
