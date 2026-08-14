-- Durable cleanup intents for private CRM document objects. A provisional
-- mortgage upload reserves its path before the provider call, while every
-- crm_documents deletion records (or reactivates) the same path in the
-- deleting transaction. Storage cleanup can therefore be retried without
-- losing the only reference to an object, and legal-ledger foreign keys remain
-- the final authority on whether document metadata may be deleted.

CREATE TABLE public.crm_document_storage_cleanup_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  submission_id uuid,
  document_id uuid,
  purpose text NOT NULL,
  storage_bucket text NOT NULL,
  storage_path text NOT NULL,
  status text DEFAULT 'reserved'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  available_at timestamptz DEFAULT now() NOT NULL,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  retained_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_document_storage_cleanup_jobs_object_key
    UNIQUE (storage_bucket, storage_path),
  CONSTRAINT crm_document_storage_cleanup_jobs_purpose_check CHECK (
    purpose IN ('mortgage_artifact_upload', 'document_delete')
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_status_check CHECK (
    status IN ('reserved', 'pending', 'processing', 'failed', 'retained', 'completed')
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_bucket_check CHECK (
    storage_bucket = 'crm-case-documents'::text
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_path_check CHECK (
    storage_path LIKE organization_id::text || '/' || case_id::text || '/%'
    AND char_length(storage_path) <= 1024
    AND strpos(storage_path, chr(92)) = 0
    AND storage_path NOT LIKE '%//%'
    AND storage_path !~ '(^|/)[.]{1,2}(/|$)'
    AND storage_path !~ '[[:cntrl:]]'
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_document_shape_check CHECK (
    purpose <> 'document_delete' OR document_id IS NOT NULL
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_attempts_check CHECK (
    attempts >= 0
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_lock_check CHECK (
    (
      status = 'processing'
      AND locked_at IS NOT NULL
      AND nullif(btrim(locked_by), '') IS NOT NULL
      AND char_length(locked_by) <= 200
    )
    OR (
      status <> 'processing'
      AND locked_at IS NULL
      AND locked_by IS NULL
    )
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_retained_check CHECK (
    (status = 'retained' AND retained_at IS NOT NULL)
    OR (status <> 'retained' AND retained_at IS NULL)
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_completed_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_error_check CHECK (
    last_error IS NULL
    OR last_error = 'crm_document_storage_delete_failed'::text
  ),
  CONSTRAINT crm_document_storage_cleanup_jobs_timestamp_check CHECK (
    updated_at >= created_at
    AND available_at >= created_at
    AND (locked_at IS NULL OR locked_at >= created_at)
    AND (retained_at IS NULL OR retained_at >= created_at)
    AND (completed_at IS NULL OR completed_at >= created_at)
  )
);

COMMENT ON TABLE public.crm_document_storage_cleanup_jobs IS
  'PII-free durable intents for retrying deletion of private CRM document objects. Completed and retained tombstones prevent unsafe path reuse.';

CREATE UNIQUE INDEX crm_document_storage_cleanup_jobs_document_key
  ON public.crm_document_storage_cleanup_jobs (document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX crm_document_storage_cleanup_jobs_ready_idx
  ON public.crm_document_storage_cleanup_jobs (available_at, created_at, id)
  WHERE status IN ('reserved', 'pending', 'failed');

CREATE INDEX crm_document_storage_cleanup_jobs_stale_lock_idx
  ON public.crm_document_storage_cleanup_jobs (locked_at, id)
  WHERE status = 'processing';

CREATE INDEX crm_document_storage_cleanup_jobs_document_lookup_idx
  ON public.crm_document_storage_cleanup_jobs (
    organization_id,
    case_id,
    document_id
  )
  WHERE document_id IS NOT NULL;

CREATE TRIGGER crm_document_storage_cleanup_jobs_set_updated_at
  BEFORE UPDATE ON public.crm_document_storage_cleanup_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION private.bind_crm_document_storage_cleanup_intent()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_job public.crm_document_storage_cleanup_jobs%rowtype;
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket
      OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
    )
    AND (
      OLD.storage_bucket = 'crm-case-documents'::text
      OR NEW.storage_bucket = 'crm-case-documents'::text
    )
  THEN
    RAISE EXCEPTION 'crm_document_storage_identity_is_immutable'
      USING errcode = '23514';
  END IF;

  IF NEW.storage_bucket IS DISTINCT FROM 'crm-case-documents'::text
    OR NEW.storage_path IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT cleanup.*
  INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.storage_bucket = NEW.storage_bucket
    AND cleanup.storage_path = NEW.storage_path
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF target_job.organization_id IS DISTINCT FROM NEW.organization_id
    OR target_job.case_id IS DISTINCT FROM NEW.case_id
    OR target_job.purpose <> 'mortgage_artifact_upload'::text
    OR target_job.status <> 'reserved'::text
    OR (
      target_job.submission_id IS NOT NULL
      AND target_job.submission_id IS DISTINCT FROM NEW.submission_id
    )
    OR (
      target_job.document_id IS NOT NULL
      AND target_job.document_id IS DISTINCT FROM NEW.id
    )
  THEN
    RAISE EXCEPTION 'crm_document_storage_path_is_retired'
      USING errcode = '23505';
  END IF;

  UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
  SET
    document_id = NEW.id,
    submission_id = coalesce(cleanup.submission_id, NEW.submission_id)
  WHERE cleanup.id = target_job.id;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.bind_crm_document_storage_cleanup_intent()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_documents_bind_storage_cleanup_intent
  BEFORE INSERT OR UPDATE OF storage_bucket, storage_path ON public.crm_documents
  FOR EACH ROW
  EXECUTE FUNCTION private.bind_crm_document_storage_cleanup_intent();

CREATE FUNCTION private.enqueue_crm_document_storage_cleanup()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_job public.crm_document_storage_cleanup_jobs%rowtype;
  target_job_found boolean := false;
  actor_user_id uuid;
  actor_can_delete boolean := false;
BEGIN
  IF OLD.storage_bucket IS DISTINCT FROM 'crm-case-documents'::text
    OR OLD.storage_path IS NULL
    OR OLD.case_id IS NULL
  THEN
    RETURN OLD;
  END IF;

  SELECT cleanup.*
  INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.storage_bucket = OLD.storage_bucket
    AND cleanup.storage_path = OLD.storage_path
  FOR UPDATE;
  target_job_found := FOUND;

  IF OLD.submission_id IS NOT NULL
    AND OLD.document_type IN (
      'mortgage_esis'::text,
      'mortgage_credit_decision'::text,
      'mortgage_draft_credit_agreement'::text
    )
  THEN
    actor_user_id := app.current_user_id();
    IF actor_user_id IS NULL THEN
      -- The backend worker has no end-user identity. It may delete mortgage
      -- metadata only while holding a service-only cleanup claim for this
      -- exact bound document/object; arbitrary backend deletes stay blocked.
      IF NOT target_job_found
        OR target_job.status <> 'processing'::text
        OR target_job.locked_by IS NULL
        OR target_job.document_id IS DISTINCT FROM OLD.id
        OR target_job.organization_id IS DISTINCT FROM OLD.organization_id
        OR target_job.case_id IS DISTINCT FROM OLD.case_id
      THEN
        RAISE EXCEPTION 'mortgage_document_delete_requires_cleanup_claim'
          USING errcode = '42501';
      END IF;
    ELSE
      SELECT (
        membership.role = 'admin'::text
        OR crm_case.owner_user_id = actor_user_id
        OR item.owner_user_id = actor_user_id
      )
      INTO actor_can_delete
      FROM public.crm_case_bank_applications AS application
      JOIN public.crm_cases AS crm_case
        ON crm_case.organization_id = application.organization_id
       AND crm_case.id = application.case_id
      JOIN public.crm_case_items AS item
        ON item.organization_id = application.organization_id
       AND item.case_id = application.case_id
       AND item.id = application.case_item_id
      JOIN public.organization_memberships AS membership
        ON membership.organization_id = application.organization_id
       AND membership.user_id = actor_user_id
      WHERE application.organization_id = OLD.organization_id
        AND application.case_id = OLD.case_id
        AND application.submission_id = OLD.submission_id
        AND (
          OLD.case_item_id IS NULL
          OR OLD.case_item_id = application.case_item_id
        );

      IF actor_can_delete IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'mortgage_case_manager_permission_required'
          USING errcode = '42501';
      END IF;
    END IF;
  END IF;

  IF target_job_found THEN
    IF target_job.organization_id IS DISTINCT FROM OLD.organization_id
      OR target_job.case_id IS DISTINCT FROM OLD.case_id
      OR (
        target_job.document_id IS NOT NULL
        AND target_job.document_id IS DISTINCT FROM OLD.id
      )
    THEN
      RAISE EXCEPTION 'crm_document_storage_cleanup_scope_mismatch'
        USING errcode = '23514';
    END IF;

    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET
      submission_id = coalesce(OLD.submission_id, cleanup.submission_id),
      document_id = OLD.id,
      purpose = 'document_delete'::text,
      status = CASE
        WHEN cleanup.status = 'processing'::text THEN cleanup.status
        ELSE 'pending'::text
      END,
      available_at = CASE
        WHEN cleanup.status = 'processing'::text THEN cleanup.available_at
        ELSE statement_timestamp()
      END,
      locked_at = CASE
        WHEN cleanup.status = 'processing'::text THEN cleanup.locked_at
        ELSE NULL
      END,
      locked_by = CASE
        WHEN cleanup.status = 'processing'::text THEN cleanup.locked_by
        ELSE NULL
      END,
      last_error = NULL,
      retained_at = NULL,
      completed_at = NULL
    WHERE cleanup.id = target_job.id;
  ELSE
    INSERT INTO public.crm_document_storage_cleanup_jobs (
      organization_id,
      case_id,
      submission_id,
      document_id,
      purpose,
      storage_bucket,
      storage_path,
      status,
      available_at
    ) VALUES (
      OLD.organization_id,
      OLD.case_id,
      OLD.submission_id,
      OLD.id,
      'document_delete'::text,
      OLD.storage_bucket,
      OLD.storage_path,
      'pending'::text,
      statement_timestamp()
    );
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_crm_document_storage_cleanup()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_documents_enqueue_storage_cleanup
  BEFORE DELETE ON public.crm_documents
  FOR EACH ROW
  EXECUTE FUNCTION private.enqueue_crm_document_storage_cleanup();

CREATE FUNCTION public.reserve_crm_document_storage_cleanup(
  p_organization_id uuid,
  p_case_id uuid,
  p_submission_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_reservation_ttl interval DEFAULT interval '30 minutes'
) RETURNS TABLE (id uuid, status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_job public.crm_document_storage_cleanup_jobs%rowtype;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_storage_bucket IS DISTINCT FROM 'crm-case-documents'::text
    OR p_storage_path IS NULL
    OR p_storage_path NOT LIKE p_organization_id::text || '/' || p_case_id::text || '/%'
    OR p_storage_path = p_organization_id::text || '/' || p_case_id::text || '/'
    OR char_length(p_storage_path) > 1024
    OR strpos(p_storage_path, chr(92)) > 0
    OR p_storage_path LIKE '%//%'
    OR p_storage_path ~ '(^|/)[.]{1,2}(/|$)'
    OR p_storage_path ~ '[[:cntrl:]]'
    OR p_reservation_ttl IS NULL
    OR p_reservation_ttl < interval '5 minutes'
    OR p_reservation_ttl > interval '2 hours'
    OR NOT EXISTS (
      SELECT 1
      FROM public.crm_cases AS target_case
      WHERE target_case.organization_id = p_organization_id
        AND target_case.id = p_case_id
    )
    OR (
      p_submission_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.crm_case_bank_applications AS application
        WHERE application.organization_id = p_organization_id
          AND application.case_id = p_case_id
          AND application.submission_id = p_submission_id
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_crm_document_storage_cleanup_reservation'
      USING errcode = '22023';
  END IF;

  SELECT cleanup.*
  INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.storage_bucket = p_storage_bucket
    AND cleanup.storage_path = p_storage_path
  FOR UPDATE;

  IF FOUND THEN
    IF target_job.organization_id IS DISTINCT FROM p_organization_id
      OR target_job.case_id IS DISTINCT FROM p_case_id
      OR target_job.submission_id IS DISTINCT FROM p_submission_id
      OR target_job.purpose <> 'mortgage_artifact_upload'::text
      OR target_job.status <> 'reserved'::text
      OR target_job.document_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'crm_document_storage_path_is_retired'
        USING errcode = '23505';
    END IF;

    RETURN QUERY SELECT target_job.id, target_job.status;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_documents AS document
    WHERE document.storage_bucket = p_storage_bucket
      AND document.storage_path = p_storage_path
  ) THEN
    RAISE EXCEPTION 'crm_document_storage_path_is_in_use'
      USING errcode = '23505';
  END IF;

  INSERT INTO public.crm_document_storage_cleanup_jobs (
    organization_id,
    case_id,
    submission_id,
    purpose,
    storage_bucket,
    storage_path,
    status,
    available_at
  ) VALUES (
    p_organization_id,
    p_case_id,
    p_submission_id,
    'mortgage_artifact_upload'::text,
    p_storage_bucket,
    p_storage_path,
    'reserved'::text,
    statement_timestamp() + p_reservation_ttl
  )
  RETURNING * INTO target_job;

  RETURN QUERY SELECT target_job.id, target_job.status;
END;
$$;

CREATE FUNCTION public.activate_crm_document_storage_cleanup(
  p_id uuid
) RETURNS TABLE (id uuid, status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_job public.crm_document_storage_cleanup_jobs%rowtype;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid_crm_document_storage_cleanup_activation'
      USING errcode = '22023';
  END IF;

  SELECT cleanup.*
  INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_document_storage_cleanup_not_found'
      USING errcode = 'P0002';
  END IF;

  IF target_job.status IN ('retained'::text, 'completed'::text, 'processing'::text) THEN
    RETURN QUERY SELECT target_job.id, target_job.status;
    RETURN;
  END IF;

  UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
  SET
    status = 'pending'::text,
    available_at = statement_timestamp(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    retained_at = NULL,
    completed_at = NULL
  WHERE cleanup.id = target_job.id
  RETURNING * INTO target_job;

  RETURN QUERY SELECT target_job.id, target_job.status;
END;
$$;

CREATE FUNCTION public.retain_crm_document_storage_cleanup(
  p_id uuid,
  p_document_id uuid
) RETURNS TABLE (id uuid, status text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_job public.crm_document_storage_cleanup_jobs%rowtype;
  target_document public.crm_documents%rowtype;
BEGIN
  IF p_id IS NULL OR p_document_id IS NULL THEN
    RAISE EXCEPTION 'invalid_crm_document_storage_cleanup_retention'
      USING errcode = '22023';
  END IF;

  SELECT cleanup.*
  INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_document_storage_cleanup_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT document.*
  INTO target_document
  FROM public.crm_documents AS document
  WHERE document.id = p_document_id
    AND document.organization_id = target_job.organization_id
    AND document.case_id = target_job.case_id
    AND document.storage_bucket = target_job.storage_bucket
    AND document.storage_path = target_job.storage_path
  FOR UPDATE;

  IF NOT FOUND
    OR NOT EXISTS (
      SELECT 1
      FROM public.crm_mortgage_application_artifacts AS artifact
      WHERE artifact.organization_id = target_job.organization_id
        AND artifact.case_id = target_job.case_id
        AND artifact.document_id = p_document_id
    )
  THEN
    RAISE EXCEPTION 'crm_document_storage_cleanup_artifact_pin_not_found'
      USING errcode = 'P0002';
  END IF;

  UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
  SET
    document_id = p_document_id,
    submission_id = coalesce(cleanup.submission_id, target_document.submission_id),
    status = 'retained'::text,
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    retained_at = statement_timestamp(),
    completed_at = NULL
  WHERE cleanup.id = target_job.id
  RETURNING * INTO target_job;

  RETURN QUERY SELECT target_job.id, target_job.status;
END;
$$;

CREATE FUNCTION public.get_crm_document_storage_cleanup_by_document(
  p_organization_id uuid,
  p_case_id uuid,
  p_document_id uuid
) RETURNS TABLE (
  id uuid,
  submission_id uuid,
  status text
)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
    SELECT cleanup.id, cleanup.submission_id, cleanup.status
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE cleanup.organization_id = p_organization_id
      AND cleanup.case_id = p_case_id
      AND cleanup.document_id = p_document_id
    LIMIT 1
  $$;

CREATE FUNCTION public.claim_crm_document_storage_cleanup(
  p_id uuid,
  p_worker_id text,
  p_lock_timeout interval DEFAULT interval '5 minutes'
) RETURNS TABLE (
  id uuid,
  organization_id uuid,
  case_id uuid,
  document_id uuid,
  storage_bucket text,
  storage_path text,
  attempts integer
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  claim_time timestamptz := statement_timestamp();
BEGIN
  IF p_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_lock_timeout IS NULL
    OR p_lock_timeout <= interval '0 seconds'
    OR p_lock_timeout > interval '1 hour'
  THEN
    RAISE EXCEPTION 'invalid_crm_document_storage_cleanup_claim'
      USING errcode = '22023';
  END IF;

  RETURN QUERY
  UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
  SET
    status = 'processing'::text,
    attempts = least(cleanup.attempts, 2147483646) + 1,
    locked_at = claim_time,
    locked_by = normalized_worker_id,
    last_error = NULL,
    retained_at = NULL,
    completed_at = NULL
  WHERE cleanup.id = p_id
    AND (
      (
        cleanup.status IN ('reserved'::text, 'pending'::text, 'failed'::text)
        AND cleanup.available_at <= claim_time
      )
      OR (
        cleanup.status = 'processing'::text
        AND cleanup.locked_at < claim_time - p_lock_timeout
      )
    )
  RETURNING
    cleanup.id,
    cleanup.organization_id,
    cleanup.case_id,
    cleanup.document_id,
    cleanup.storage_bucket,
    cleanup.storage_path,
    cleanup.attempts;
END;
$$;

CREATE FUNCTION public.claim_crm_document_storage_cleanups(
  p_worker_id text,
  p_limit integer DEFAULT 25,
  p_lock_timeout interval DEFAULT interval '5 minutes'
) RETURNS TABLE (
  id uuid,
  organization_id uuid,
  case_id uuid,
  document_id uuid,
  storage_bucket text,
  storage_path text,
  attempts integer
)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  claim_time timestamptz := statement_timestamp();
BEGIN
  IF normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 100
    OR p_lock_timeout IS NULL
    OR p_lock_timeout <= interval '0 seconds'
    OR p_lock_timeout > interval '1 hour'
  THEN
    RAISE EXCEPTION 'invalid_crm_document_storage_cleanup_claim'
      USING errcode = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT cleanup.id
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE (
      cleanup.status IN ('reserved'::text, 'pending'::text, 'failed'::text)
      AND cleanup.available_at <= claim_time
    ) OR (
      cleanup.status = 'processing'::text
      AND cleanup.locked_at < claim_time - p_lock_timeout
    )
    ORDER BY cleanup.available_at, cleanup.created_at, cleanup.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
  SET
    status = 'processing'::text,
    attempts = least(cleanup.attempts, 2147483646) + 1,
    locked_at = claim_time,
    locked_by = normalized_worker_id,
    last_error = NULL,
    retained_at = NULL,
    completed_at = NULL
  FROM candidates
  WHERE cleanup.id = candidates.id
  RETURNING
    cleanup.id,
    cleanup.organization_id,
    cleanup.case_id,
    cleanup.document_id,
    cleanup.storage_bucket,
    cleanup.storage_path,
    cleanup.attempts;
END;
$$;

CREATE FUNCTION public.prepare_crm_document_storage_cleanup(
  p_id uuid,
  p_worker_id text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  target_job public.crm_document_storage_cleanup_jobs%rowtype;
  target_document public.crm_documents%rowtype;
  document_was_deleted boolean := false;
BEGIN
  IF p_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
  THEN
    RAISE EXCEPTION 'invalid_crm_document_storage_cleanup_prepare'
      USING errcode = '22023';
  END IF;

  SELECT cleanup.*
  INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.id = p_id
    AND cleanup.status = 'processing'::text
    AND cleanup.locked_by = normalized_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_document_storage_cleanup_claim_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT document.*
  INTO target_document
  FROM public.crm_documents AS document
  WHERE document.organization_id = target_job.organization_id
    AND document.case_id = target_job.case_id
    AND document.storage_bucket = target_job.storage_bucket
    AND document.storage_path = target_job.storage_path
  FOR UPDATE;

  IF FOUND THEN
    IF EXISTS (
      SELECT 1
      FROM public.crm_mortgage_application_artifacts AS artifact
      WHERE artifact.organization_id = target_job.organization_id
        AND artifact.case_id = target_job.case_id
        AND artifact.document_id = target_document.id
    ) THEN
      UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
      SET
        document_id = target_document.id,
        submission_id = coalesce(cleanup.submission_id, target_document.submission_id),
        status = 'retained'::text,
        locked_at = NULL,
        locked_by = NULL,
        last_error = NULL,
        retained_at = statement_timestamp(),
        completed_at = NULL
      WHERE cleanup.id = target_job.id;

      RETURN jsonb_build_object(
        'id', target_job.id,
        'action', 'retained',
        'documentId', target_document.id
      );
    END IF;

    BEGIN
      DELETE FROM public.crm_documents AS document
      WHERE document.id = target_document.id
        AND document.organization_id = target_job.organization_id
        AND document.case_id = target_job.case_id
        AND document.storage_bucket = target_job.storage_bucket
        AND document.storage_path = target_job.storage_path;
      document_was_deleted := FOUND;
    EXCEPTION
      WHEN foreign_key_violation THEN
        UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
        SET
          document_id = target_document.id,
          submission_id = coalesce(cleanup.submission_id, target_document.submission_id),
          status = 'retained'::text,
          locked_at = NULL,
          locked_by = NULL,
          last_error = NULL,
          retained_at = statement_timestamp(),
          completed_at = NULL
        WHERE cleanup.id = target_job.id;

        RETURN jsonb_build_object(
          'id', target_job.id,
          'action', 'retained',
          'documentId', target_document.id
        );
    END;

    IF NOT document_was_deleted THEN
      RAISE EXCEPTION 'crm_document_storage_cleanup_document_changed'
        USING errcode = '40001';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', target_job.id,
    'action', 'delete_blob',
    'storageBucket', target_job.storage_bucket,
    'storagePath', target_job.storage_path
  );
END;
$$;

CREATE FUNCTION public.complete_crm_document_storage_cleanup(
  p_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_error text DEFAULT NULL,
  p_retry_delay interval DEFAULT interval '30 seconds'
) RETURNS TABLE (id uuid, status text, attempts integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  normalized_error text := nullif(btrim(p_error), '');
  target_job public.crm_document_storage_cleanup_jobs%rowtype;
BEGIN
  IF p_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_succeeded IS NULL
    OR (p_succeeded AND normalized_error IS NOT NULL)
    OR (
      NOT p_succeeded
      AND normalized_error IS NOT NULL
      AND normalized_error <> 'crm_document_storage_delete_failed'::text
    )
    OR p_retry_delay IS NULL
    OR p_retry_delay <= interval '0 seconds'
    OR p_retry_delay > interval '24 hours'
  THEN
    RAISE EXCEPTION 'invalid_crm_document_storage_cleanup_completion'
      USING errcode = '22023';
  END IF;

  SELECT cleanup.*
  INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.id = p_id
    AND cleanup.status = 'processing'::text
    AND cleanup.locked_by = normalized_worker_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_document_storage_cleanup_claim_not_found'
      USING errcode = 'P0002';
  END IF;

  -- A provider can persist an upload after the caller has already observed a
  -- transport error. The first successful remove therefore schedules one
  -- delayed idempotent verification pass instead of closing a fresh intent.
  -- Jobs which previously failed/reconciled have already outlived that race
  -- window and can complete on their next successful removal.
  IF p_succeeded AND target_job.attempts = 1 THEN
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET
      status = 'pending'::text,
      available_at = statement_timestamp() + interval '1 minute',
      locked_at = NULL,
      locked_by = NULL,
      last_error = NULL,
      retained_at = NULL,
      completed_at = NULL
    WHERE cleanup.id = target_job.id
    RETURNING * INTO target_job;
  ELSE
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET
      status = CASE WHEN p_succeeded THEN 'completed'::text ELSE 'failed'::text END,
      available_at = CASE
        WHEN p_succeeded THEN cleanup.available_at
        ELSE statement_timestamp() + p_retry_delay
      END,
      locked_at = NULL,
      locked_by = NULL,
      last_error = CASE
        WHEN p_succeeded THEN NULL
        ELSE coalesce(normalized_error, 'crm_document_storage_delete_failed'::text)
      END,
      retained_at = NULL,
      completed_at = CASE WHEN p_succeeded THEN statement_timestamp() ELSE NULL END
    WHERE cleanup.id = target_job.id
    RETURNING * INTO target_job;
  END IF;

  RETURN QUERY SELECT target_job.id, target_job.status, target_job.attempts;
END;
$$;

ALTER TABLE public.crm_document_storage_cleanup_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.crm_document_storage_cleanup_jobs
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

REVOKE ALL ON FUNCTION public.reserve_crm_document_storage_cleanup(
  uuid, uuid, uuid, text, text, interval
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.activate_crm_document_storage_cleanup(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.retain_crm_document_storage_cleanup(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.get_crm_document_storage_cleanup_by_document(uuid, uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.claim_crm_document_storage_cleanup(uuid, text, interval)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.claim_crm_document_storage_cleanups(text, integer, interval)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.prepare_crm_document_storage_cleanup(uuid, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION public.complete_crm_document_storage_cleanup(
  uuid, text, boolean, text, interval
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.reserve_crm_document_storage_cleanup(
  uuid, uuid, uuid, text, text, interval
) TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.activate_crm_document_storage_cleanup(uuid)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.retain_crm_document_storage_cleanup(uuid, uuid)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_crm_document_storage_cleanup_by_document(uuid, uuid, uuid)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_crm_document_storage_cleanup(uuid, text, interval)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_crm_document_storage_cleanups(text, integer, interval)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.prepare_crm_document_storage_cleanup(uuid, text)
  TO openexpert_service;
GRANT EXECUTE ON FUNCTION public.complete_crm_document_storage_cleanup(
  uuid, text, boolean, text, interval
) TO openexpert_service;
