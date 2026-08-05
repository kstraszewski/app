-- Direct-to-object-storage attachments for durable case messages. Uploads are
-- reserved before bytes leave the browser and become visible only when the
-- reservation is atomically attached to a committed message.

ALTER TABLE public.crm_case_messages
  DROP CONSTRAINT crm_case_messages_body_check;

ALTER TABLE public.crm_case_messages
  ADD CONSTRAINT crm_case_messages_body_check CHECK (
    body = btrim(body)
    AND char_length(body) <= 4000
  ),
  ADD CONSTRAINT crm_case_messages_attachment_identity_key UNIQUE (
    organization_id,
    id,
    conversation_id,
    client_message_id
  );

COMMENT ON COLUMN public.crm_case_messages.body IS
  'Normalized message text. An empty string is allowed only when append_case_message_v2 atomically attaches at least one uploaded file.';

CREATE TABLE public.crm_case_message_attachments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  client_message_id uuid NOT NULL,
  message_id uuid,
  position smallint,
  uploader_kind text NOT NULL,
  uploader_user_id uuid,
  uploader_client_person_id uuid,
  uploader_auth_user_id uuid,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  etag text,
  uploaded_at timestamp with time zone,
  expires_at timestamp with time zone NOT NULL,
  discarded_at timestamp with time zone,
  attached_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_message_attachments_pkey PRIMARY KEY (id),
  CONSTRAINT crm_case_message_attachments_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT crm_case_message_attachments_storage_path_key
    UNIQUE (storage_path),
  CONSTRAINT crm_case_message_attachments_uploader_kind_check CHECK (
    uploader_kind = ANY (ARRAY['staff'::text, 'client'::text])
  ),
  CONSTRAINT crm_case_message_attachments_uploader_shape_check CHECK (
    (
      uploader_kind = 'staff'::text
      AND uploader_client_person_id IS NULL
      AND uploader_auth_user_id IS NULL
    )
    OR (
      uploader_kind = 'client'::text
      AND uploader_user_id IS NULL
      AND uploader_client_person_id IS NOT NULL
    )
  ),
  CONSTRAINT crm_case_message_attachments_file_name_check CHECK (
    file_name = btrim(file_name)
    AND char_length(file_name) BETWEEN 1 AND 255
    AND file_name !~ '[[:cntrl:]/]'::text
    AND strpos(file_name, '\') = 0
  ),
  CONSTRAINT crm_case_message_attachments_content_type_check CHECK (
    content_type = ANY (ARRAY[
      'image/jpeg'::text,
      'image/png'::text,
      'image/webp'::text,
      'application/pdf'::text,
      'application/msword'::text,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text,
      'application/vnd.ms-excel'::text,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text,
      'text/plain'::text,
      'text/csv'::text
    ])
  ),
  CONSTRAINT crm_case_message_attachments_size_check CHECK (
    size_bytes BETWEEN 1 AND 26214400
  ),
  CONSTRAINT crm_case_message_attachments_storage_path_check CHECK (
    char_length(storage_path) <= 1024
    AND storage_path ~ (
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      || '\.(jpg|png|webp|pdf|doc|docx|xls|xlsx|txt|csv)$'
    )
  ),
  CONSTRAINT crm_case_message_attachments_etag_check CHECK (
    etag IS NULL OR (nullif(btrim(etag), '') IS NOT NULL AND char_length(etag) <= 200)
  ),
  CONSTRAINT crm_case_message_attachments_upload_shape_check CHECK (
    (uploaded_at IS NULL AND etag IS NULL)
    OR (uploaded_at IS NOT NULL AND etag IS NOT NULL)
  ),
  CONSTRAINT crm_case_message_attachments_message_shape_check CHECK (
    (
      message_id IS NULL
      AND position IS NULL
      AND attached_at IS NULL
    )
    OR (
      message_id IS NOT NULL
      AND position BETWEEN 1 AND 10
      AND uploaded_at IS NOT NULL
      AND attached_at IS NOT NULL
      AND discarded_at IS NULL
    )
  ),
  CONSTRAINT crm_case_message_attachments_discard_shape_check CHECK (
    discarded_at IS NULL OR message_id IS NULL
  ),
  CONSTRAINT crm_case_message_attachments_timestamp_check CHECK (
    expires_at > created_at
    AND (uploaded_at IS NULL OR uploaded_at >= created_at)
    AND (discarded_at IS NULL OR discarded_at >= created_at)
    AND (attached_at IS NULL OR attached_at >= created_at)
  ),
  CONSTRAINT crm_case_message_attachments_conversation_fkey FOREIGN KEY (
    organization_id,
    conversation_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_message_attachments_message_fkey FOREIGN KEY (
    organization_id,
    message_id,
    conversation_id,
    client_message_id
  ) REFERENCES public.crm_case_messages (
    organization_id,
    id,
    conversation_id,
    client_message_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_message_attachments_client_uploader_fkey FOREIGN KEY (
    organization_id,
    conversation_id,
    uploader_client_person_id
  ) REFERENCES public.crm_case_conversations (
    organization_id,
    id,
    client_person_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_message_attachments_staff_uploader_fkey FOREIGN KEY (
    organization_id,
    uploader_user_id
  ) REFERENCES public.organization_memberships (
    organization_id,
    user_id
  ) ON DELETE SET NULL (uploader_user_id),
  CONSTRAINT crm_case_message_attachments_auth_uploader_fkey FOREIGN KEY (
    uploader_auth_user_id
  ) REFERENCES public.profiles (id) ON DELETE SET NULL
);

COMMENT ON TABLE public.crm_case_message_attachments IS
  'Private Blob upload reservations which become immutable message attachments when atomically claimed by append_case_message_v2.';
COMMENT ON COLUMN public.crm_case_message_attachments.storage_path IS
  'Provider-independent path relative to the private crm-message-attachments namespace; never exposed in message responses.';
COMMENT ON COLUMN public.crm_case_message_attachments.client_message_id IS
  'Binds a reservation to the idempotency key of exactly one future message.';

CREATE UNIQUE INDEX crm_case_message_attachments_message_position_key
  ON public.crm_case_message_attachments (message_id, position)
  WHERE message_id IS NOT NULL;

CREATE INDEX crm_case_message_attachments_message_idx
  ON public.crm_case_message_attachments (message_id, position, id)
  WHERE message_id IS NOT NULL;

CREATE INDEX crm_case_message_attachments_cleanup_idx
  ON public.crm_case_message_attachments (expires_at, id)
  WHERE message_id IS NULL;

CREATE INDEX crm_case_message_attachments_staff_reservation_rate_idx
  ON public.crm_case_message_attachments (
    organization_id,
    uploader_user_id,
    created_at DESC,
    id
  ) WHERE uploader_kind = 'staff'::text;

CREATE INDEX crm_case_message_attachments_client_reservation_rate_idx
  ON public.crm_case_message_attachments (
    organization_id,
    uploader_auth_user_id,
    created_at DESC,
    id
  ) WHERE uploader_kind = 'client'::text;

CREATE FUNCTION private.case_message_attachment_extension(p_content_type text)
RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path TO ''
  AS $$
    SELECT CASE p_content_type
      WHEN 'image/jpeg'::text THEN 'jpg'::text
      WHEN 'image/png'::text THEN 'png'::text
      WHEN 'image/webp'::text THEN 'webp'::text
      WHEN 'application/pdf'::text THEN 'pdf'::text
      WHEN 'application/msword'::text THEN 'doc'::text
      WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text
        THEN 'docx'::text
      WHEN 'application/vnd.ms-excel'::text THEN 'xls'::text
      WHEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'::text
        THEN 'xlsx'::text
      WHEN 'text/plain'::text THEN 'txt'::text
      WHEN 'text/csv'::text THEN 'csv'::text
      ELSE NULL
    END;
  $$;

REVOKE ALL ON FUNCTION private.case_message_attachment_extension(text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.case_message_attachments_json(p_message_id uuid)
RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', attachment.id,
          'name', attachment.file_name,
          'mimeType', attachment.content_type,
          'sizeBytes', attachment.size_bytes
        ) ORDER BY attachment.position, attachment.id
      ),
      '[]'::jsonb
    )
    FROM public.crm_case_message_attachments AS attachment
    WHERE attachment.message_id = p_message_id;
  $$;

REVOKE ALL ON FUNCTION private.case_message_attachments_json(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.reserve_case_message_attachment(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_uploader_kind text,
  p_uploader_user_id uuid,
  p_uploader_client_person_id uuid,
  p_uploader_auth_user_id uuid,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_conversation public.crm_case_conversations%rowtype;
  inserted_attachment public.crm_case_message_attachments%rowtype;
  attachment_id uuid := gen_random_uuid();
  normalized_file_name text := nullif(btrim(p_file_name), '');
  normalized_content_type text := lower(nullif(btrim(p_content_type), ''));
  attachment_extension text;
  actor_lock_key text;
  recent_reservation_count bigint;
  active_reservation_count bigint;
  reservation_time timestamp with time zone := statement_timestamp();
BEGIN
  IF p_conversation_id IS NULL
    OR p_client_message_id IS NULL
    OR normalized_file_name IS NULL
    OR char_length(normalized_file_name) > 255
    OR normalized_file_name ~ '[[:cntrl:]/]'::text
    OR strpos(normalized_file_name, '\') > 0
    OR p_size_bytes IS NULL
    OR p_size_bytes NOT BETWEEN 1 AND 26214400
    OR p_uploader_kind <> ALL (ARRAY['staff'::text, 'client'::text])
    OR (
      p_uploader_kind = 'staff'::text
      AND (
        p_uploader_user_id IS NULL
        OR p_uploader_client_person_id IS NOT NULL
        OR p_uploader_auth_user_id IS NOT NULL
      )
    )
    OR (
      p_uploader_kind = 'client'::text
      AND (
        p_uploader_user_id IS NOT NULL
        OR p_uploader_client_person_id IS NULL
        OR p_uploader_auth_user_id IS NULL
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_reservation'
      USING errcode = '22023';
  END IF;

  attachment_extension := private.case_message_attachment_extension(
    normalized_content_type
  );
  IF attachment_extension IS NULL THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_content_type'
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

  IF EXISTS (
    SELECT 1
    FROM public.crm_case_messages AS message
    WHERE message.conversation_id = target_conversation.id
      AND message.client_message_id = p_client_message_id
  ) THEN
    RAISE EXCEPTION 'case_message_already_sent'
      USING errcode = '23505';
  END IF;

  actor_lock_key := CASE p_uploader_kind
    WHEN 'staff'::text THEN concat(
      'case-message-attachment:staff:',
      target_conversation.organization_id,
      ':',
      p_uploader_user_id
    )
    ELSE concat(
      'case-message-attachment:client:',
      target_conversation.organization_id,
      ':',
      p_uploader_auth_user_id
    )
  END;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(actor_lock_key, 0)
  );

  SELECT
    count(*) FILTER (
      WHERE attachment.created_at >= reservation_time - interval '60 seconds'
    ),
    count(*) FILTER (
      WHERE attachment.message_id IS NULL
        AND attachment.discarded_at IS NULL
        AND attachment.expires_at > reservation_time
    )
  INTO recent_reservation_count, active_reservation_count
  FROM public.crm_case_message_attachments AS attachment
  WHERE attachment.organization_id = target_conversation.organization_id
    AND attachment.uploader_kind = p_uploader_kind
    AND (
      (
        p_uploader_kind = 'staff'::text
        AND attachment.uploader_user_id = p_uploader_user_id
      )
      OR (
        p_uploader_kind = 'client'::text
        AND attachment.uploader_auth_user_id = p_uploader_auth_user_id
      )
    );

  IF recent_reservation_count >= 20 THEN
    RAISE EXCEPTION 'case_message_attachment_reservation_rate_limited'
      USING errcode = 'P0001';
  END IF;
  IF active_reservation_count >= 50 THEN
    RAISE EXCEPTION 'too_many_active_case_message_attachment_reservations'
      USING errcode = 'P0001';
  END IF;

  INSERT INTO public.crm_case_message_attachments (
    id,
    organization_id,
    conversation_id,
    client_message_id,
    uploader_kind,
    uploader_user_id,
    uploader_client_person_id,
    uploader_auth_user_id,
    storage_path,
    file_name,
    content_type,
    size_bytes,
    expires_at,
    created_at
  ) VALUES (
    attachment_id,
    target_conversation.organization_id,
    target_conversation.id,
    p_client_message_id,
    p_uploader_kind,
    p_uploader_user_id,
    p_uploader_client_person_id,
    p_uploader_auth_user_id,
    concat_ws(
      '/',
      target_conversation.organization_id::text,
      target_conversation.case_id::text,
      target_conversation.id::text,
      p_client_message_id::text,
      attachment_id::text || '.' || attachment_extension
    ),
    normalized_file_name,
    normalized_content_type,
    p_size_bytes,
    reservation_time + interval '24 hours',
    reservation_time
  )
  RETURNING * INTO inserted_attachment;

  RETURN jsonb_build_object(
    'id', inserted_attachment.id,
    'conversationId', inserted_attachment.conversation_id,
    'clientMessageId', inserted_attachment.client_message_id,
    'name', inserted_attachment.file_name,
    'mimeType', inserted_attachment.content_type,
    'sizeBytes', inserted_attachment.size_bytes,
    'storagePath', inserted_attachment.storage_path,
    'expiresAt', inserted_attachment.expires_at,
    'createdAt', inserted_attachment.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION private.reserve_case_message_attachment(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.reserve_client_case_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_client_message_id uuid,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
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
    RAISE EXCEPTION 'invalid_case_message_attachment_reservation'
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

  RETURN private.reserve_case_message_attachment(
    target_conversation.id,
    p_client_message_id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_auth_user_id,
    p_file_name,
    p_content_type,
    p_size_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_client_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.reserve_client_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) TO openexpert_service;

CREATE FUNCTION public.reserve_staff_case_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_actor_user_id uuid,
  p_client_message_id uuid,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint
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
    RAISE EXCEPTION 'invalid_case_message_attachment_reservation'
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

  RETURN private.reserve_case_message_attachment(
    target_conversation.id,
    p_client_message_id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    NULL,
    p_file_name,
    p_content_type,
    p_size_bytes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_staff_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.reserve_staff_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  bigint
) TO openexpert_service;

CREATE FUNCTION public.complete_case_message_attachment_upload(
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

  IF target_attachment.discarded_at IS NOT NULL
    OR target_attachment.expires_at <= completion_time
  THEN
    RAISE EXCEPTION 'case_message_attachment_reservation_expired'
      USING errcode = '55000';
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

CREATE FUNCTION private.discard_case_message_attachment(
  p_conversation_id uuid,
  p_attachment_id uuid,
  p_uploader_kind text,
  p_uploader_user_id uuid,
  p_uploader_client_person_id uuid,
  p_uploader_auth_user_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_attachment public.crm_case_message_attachments%rowtype;
  discard_time timestamp with time zone := statement_timestamp();
  changed boolean := false;
BEGIN
  IF p_conversation_id IS NULL
    OR p_attachment_id IS NULL
    OR p_uploader_kind <> ALL (ARRAY['staff'::text, 'client'::text])
  THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_discard'
      USING errcode = '22023';
  END IF;

  SELECT attachment.*
  INTO target_attachment
  FROM public.crm_case_message_attachments AS attachment
  WHERE attachment.id = p_attachment_id
    AND attachment.conversation_id = p_conversation_id
    AND attachment.uploader_kind = p_uploader_kind
    AND attachment.uploader_user_id IS NOT DISTINCT FROM p_uploader_user_id
    AND attachment.uploader_client_person_id
      IS NOT DISTINCT FROM p_uploader_client_person_id
    AND attachment.uploader_auth_user_id
      IS NOT DISTINCT FROM p_uploader_auth_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_message_attachment_not_found'
      USING errcode = 'P0002';
  END IF;
  IF target_attachment.message_id IS NOT NULL THEN
    RAISE EXCEPTION 'case_message_attachment_already_sent'
      USING errcode = '55000';
  END IF;

  IF target_attachment.discarded_at IS NULL THEN
    UPDATE public.crm_case_message_attachments AS attachment
    SET discarded_at = discard_time
    WHERE attachment.id = target_attachment.id
    RETURNING * INTO target_attachment;
    changed := true;
  END IF;

  RETURN jsonb_build_object(
    'id', target_attachment.id,
    'storagePath', target_attachment.storage_path,
    'discardedAt', target_attachment.discarded_at,
    'changed', changed
  );
END;
$$;

REVOKE ALL ON FUNCTION private.discard_case_message_attachment(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.discard_client_case_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_attachment_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_conversation_id uuid;
BEGIN
  SELECT conversation.id
  INTO target_conversation_id
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

  RETURN private.discard_case_message_attachment(
    target_conversation_id,
    p_attachment_id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_auth_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.discard_client_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.discard_client_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) TO openexpert_service;

CREATE FUNCTION public.discard_staff_case_message_attachment(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_actor_user_id uuid,
  p_attachment_id uuid
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_case public.crm_cases%rowtype;
  actor_role text;
  target_conversation_id uuid;
BEGIN
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

  SELECT conversation.id
  INTO target_conversation_id
  FROM public.crm_case_conversations AS conversation
  WHERE conversation.organization_id = p_organization_id
    AND conversation.case_id = p_case_id
    AND conversation.client_person_id = p_client_person_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case_conversation_not_found'
      USING errcode = 'P0002';
  END IF;

  RETURN private.discard_case_message_attachment(
    target_conversation_id,
    p_attachment_id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.discard_staff_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.discard_staff_case_message_attachment(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid
) TO openexpert_service;

CREATE FUNCTION public.delete_expired_case_message_attachment_reservations(
  p_limit integer DEFAULT 100
) RETURNS TABLE (id uuid, storage_path text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  cleanup_time timestamp with time zone := statement_timestamp();
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'invalid_case_message_attachment_cleanup_limit'
      USING errcode = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT attachment.id
    FROM public.crm_case_message_attachments AS attachment
    WHERE attachment.message_id IS NULL
      AND attachment.expires_at < cleanup_time
    ORDER BY attachment.expires_at, attachment.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  DELETE FROM public.crm_case_message_attachments AS attachment
  USING candidates
  WHERE attachment.id = candidates.id
    AND attachment.message_id IS NULL
  RETURNING attachment.id, attachment.storage_path;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_expired_case_message_attachment_reservations(
  integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.delete_expired_case_message_attachment_reservations(
  integer
) TO openexpert_service;

-- V2 preserves the original message transaction while atomically claiming an
-- ordered set of completed upload reservations. The original append function
-- and public text-only RPCs remain available for rolling deployments.
CREATE FUNCTION private.append_case_message_v2(
  p_conversation_id uuid,
  p_client_message_id uuid,
  p_sender_kind text,
  p_sender_user_id uuid,
  p_sender_client_person_id uuid,
  p_sender_auth_user_id uuid,
  p_body text,
  p_attachment_ids uuid[]
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_body text := coalesce(nullif(btrim(p_body), ''), '');
  normalized_attachment_ids uuid[] := coalesce(
    p_attachment_ids,
    ARRAY[]::uuid[]
  );
  target_conversation public.crm_case_conversations%rowtype;
  existing_message public.crm_case_messages%rowtype;
  inserted_message public.crm_case_messages%rowtype;
  target_outbox public.crm_message_outbox%rowtype;
  existing_attachment_ids uuid[];
  message_sequence bigint;
  message_time timestamp with time zone := statement_timestamp();
  attachment_count integer;
  distinct_attachment_count integer;
  valid_attachment_count integer := 0;
  updated_attachment_count integer := 0;
  attachment_total_bytes bigint := 0;
BEGIN
  attachment_count := cardinality(normalized_attachment_ids);
  SELECT count(DISTINCT requested.id)::integer
  INTO distinct_attachment_count
  FROM unnest(normalized_attachment_ids) AS requested(id);

  IF p_conversation_id IS NULL
    OR p_client_message_id IS NULL
    OR char_length(normalized_body) > 4000
    OR (normalized_body = '' AND attachment_count = 0)
    OR attachment_count > 10
    OR array_position(normalized_attachment_ids, NULL::uuid) IS NOT NULL
    OR distinct_attachment_count <> attachment_count
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
    SELECT coalesce(
      array_agg(attachment.id ORDER BY attachment.position),
      ARRAY[]::uuid[]
    )
    INTO existing_attachment_ids
    FROM public.crm_case_message_attachments AS attachment
    WHERE attachment.message_id = existing_message.id;

    IF existing_message.sender_kind IS DISTINCT FROM p_sender_kind
      OR existing_message.sender_user_id IS DISTINCT FROM p_sender_user_id
      OR existing_message.sender_client_person_id
        IS DISTINCT FROM p_sender_client_person_id
      OR existing_message.sender_auth_user_id
        IS DISTINCT FROM p_sender_auth_user_id
      OR existing_message.body IS DISTINCT FROM normalized_body
      OR existing_attachment_ids IS DISTINCT FROM normalized_attachment_ids
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
        'attachments', private.case_message_attachments_json(
          existing_message.id
        ),
        'createdAt', existing_message.created_at
      ),
      'outboxId', target_outbox.id,
      'created', false,
      'replayed', true
    );
  END IF;

  IF attachment_count > 0 THEN
    -- Lock in the request's order. A concurrent discard or completion cannot
    -- alter a reservation between validation and attachment.
    PERFORM attachment.id
    FROM unnest(normalized_attachment_ids) WITH ORDINALITY
      AS requested(id, position)
    JOIN public.crm_case_message_attachments AS attachment
      ON attachment.id = requested.id
    ORDER BY requested.position
    FOR UPDATE OF attachment;

    SELECT
      count(*)::integer,
      coalesce(sum(attachment.size_bytes), 0)::bigint
    INTO valid_attachment_count, attachment_total_bytes
    FROM unnest(normalized_attachment_ids) WITH ORDINALITY
      AS requested(id, position)
    JOIN public.crm_case_message_attachments AS attachment
      ON attachment.id = requested.id
    WHERE attachment.organization_id = target_conversation.organization_id
      AND attachment.conversation_id = target_conversation.id
      AND attachment.client_message_id = p_client_message_id
      AND attachment.uploader_kind = p_sender_kind
      AND attachment.uploader_user_id IS NOT DISTINCT FROM p_sender_user_id
      AND attachment.uploader_client_person_id
        IS NOT DISTINCT FROM p_sender_client_person_id
      AND attachment.uploader_auth_user_id
        IS NOT DISTINCT FROM p_sender_auth_user_id
      AND attachment.message_id IS NULL
      AND attachment.uploaded_at IS NOT NULL
      AND attachment.discarded_at IS NULL
      AND attachment.expires_at > message_time;

    IF valid_attachment_count <> attachment_count THEN
      RAISE EXCEPTION 'case_message_attachment_unavailable'
        USING errcode = '55000';
    END IF;
    IF attachment_total_bytes > 52428800 THEN
      RAISE EXCEPTION 'case_message_attachments_too_large'
        USING errcode = '22023';
    END IF;
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

  IF attachment_count > 0 THEN
    WITH requested AS (
      SELECT id, position
      FROM unnest(normalized_attachment_ids) WITH ORDINALITY
        AS input(id, position)
    )
    UPDATE public.crm_case_message_attachments AS attachment
    SET
      message_id = inserted_message.id,
      position = requested.position::smallint,
      attached_at = message_time
    FROM requested
    WHERE attachment.id = requested.id
      AND attachment.message_id IS NULL
      AND attachment.uploaded_at IS NOT NULL
      AND attachment.discarded_at IS NULL;
    GET DIAGNOSTICS updated_attachment_count = ROW_COUNT;

    IF updated_attachment_count <> attachment_count THEN
      RAISE EXCEPTION 'case_message_attachment_unavailable'
        USING errcode = '55000';
    END IF;
  END IF;

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
      'attachments', private.case_message_attachments_json(
        inserted_message.id
      ),
      'createdAt', inserted_message.created_at
    ),
    'outboxId', target_outbox.id,
    'created', true,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.append_case_message_v2(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.send_client_case_message_v2(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_auth_user_id uuid,
  p_client_message_id uuid,
  p_body text,
  p_attachment_ids uuid[]
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

  RETURN private.append_case_message_v2(
    target_conversation.id,
    p_client_message_id,
    'client'::text,
    NULL,
    p_client_person_id,
    p_auth_user_id,
    p_body,
    p_attachment_ids
  );
END;
$$;

COMMENT ON FUNCTION public.send_client_case_message_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) IS
  'Validates portal access and atomically sends text, uploaded attachments, or both.';

REVOKE ALL ON FUNCTION public.send_client_case_message_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_client_case_message_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) TO openexpert_service;

CREATE FUNCTION public.send_staff_case_message_v2(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_person_id uuid,
  p_actor_user_id uuid,
  p_client_message_id uuid,
  p_body text,
  p_attachment_ids uuid[]
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

  RETURN private.append_case_message_v2(
    target_conversation.id,
    p_client_message_id,
    'staff'::text,
    p_actor_user_id,
    NULL,
    NULL,
    p_body,
    p_attachment_ids
  );
END;
$$;

COMMENT ON FUNCTION public.send_staff_case_message_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) IS
  'Lets a case owner or organization admin atomically send text, uploaded attachments, or both.';

REVOKE ALL ON FUNCTION public.send_staff_case_message_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.send_staff_case_message_v2(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  uuid[]
) TO openexpert_service;

ALTER TABLE public.crm_case_message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all
  ON public.crm_case_message_attachments
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY crm_case_message_attachments_owner_or_admin_read
  ON public.crm_case_message_attachments
  FOR SELECT TO authenticated
  USING (
    message_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.crm_case_conversations AS conversation
      JOIN public.crm_cases AS crm_case
        ON crm_case.organization_id = conversation.organization_id
       AND crm_case.id = conversation.case_id
      WHERE conversation.organization_id =
          crm_case_message_attachments.organization_id
        AND conversation.id = crm_case_message_attachments.conversation_id
        AND (
          crm_case.owner_user_id = (SELECT app.current_user_id())
          OR private.is_organization_admin(
            crm_case_message_attachments.organization_id
          )
        )
    )
  );

REVOKE ALL ON TABLE public.crm_case_message_attachments
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Reservations and attachment rows are immutable from the application. All
-- lifecycle mutations go through the actor-aware SECURITY DEFINER RPCs above.
GRANT SELECT
  ON TABLE public.crm_case_message_attachments TO openexpert_service;
GRANT SELECT
  ON TABLE public.crm_case_message_attachments TO authenticated;
