-- Run after 0049 and 0050 inside a disposable transaction. The caller rolls
-- back the fixture rows and the temporary FK pin at the end of the smoke run.

CREATE TABLE public.__crm_document_storage_cleanup_smoke_pins (
  document_id uuid PRIMARY KEY
    REFERENCES public.crm_documents (id) ON DELETE RESTRICT
);

DO $document_storage_cleanup_smoke$
DECLARE
  application_record record;
  actor_id uuid;
  unauthorized_actor_id uuid;
  cleanup_id uuid;
  retried_cleanup_id uuid;
  raw_cleanup_id uuid;
  raw_storage_path text;
  document_id_value uuid := gen_random_uuid();
  storage_path_value text;
  claim_record record;
  preparation jsonb;
  cleanup_status text;
  cleanup_attempts integer;
BEGIN
  SELECT
    application.organization_id,
    application.case_id,
    application.submission_id AS application_id,
    application.case_item_id
  INTO application_record
  FROM public.crm_case_bank_applications AS application
  WHERE EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = application.organization_id
  )
  ORDER BY application.created_at, application.submission_id
  LIMIT 1;

  IF application_record.application_id IS NULL THEN
    RAISE EXCEPTION 'document_storage_cleanup_smoke_fixture_missing';
  END IF;

  SELECT membership.user_id
  INTO actor_id
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = application_record.organization_id
  ORDER BY (membership.role = 'admin') DESC, membership.user_id
  LIMIT 1;

  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'document_storage_cleanup_smoke_actor_missing';
  END IF;

  SELECT membership.user_id
  INTO unauthorized_actor_id
  FROM public.organization_memberships AS membership
  JOIN public.crm_cases AS crm_case
    ON crm_case.organization_id = membership.organization_id
   AND crm_case.id = application_record.case_id
  JOIN public.crm_case_items AS item
    ON item.organization_id = membership.organization_id
   AND item.case_id = crm_case.id
   AND item.id = application_record.case_item_id
  WHERE membership.organization_id = application_record.organization_id
    AND membership.role <> 'admin'
    AND membership.user_id IS DISTINCT FROM crm_case.owner_user_id
    AND membership.user_id IS DISTINCT FROM item.owner_user_id
  ORDER BY membership.user_id
  LIMIT 1;
  IF unauthorized_actor_id IS NULL THEN
    RAISE EXCEPTION 'document_storage_cleanup_non_manager_fixture_missing';
  END IF;

  IF has_table_privilege(
    'authenticated', 'public.crm_document_storage_cleanup_jobs', 'SELECT'
  ) OR has_table_privilege(
    'authenticated', 'public.crm_document_storage_cleanup_jobs', 'INSERT'
  ) OR has_table_privilege(
    'authenticated', 'public.crm_document_storage_cleanup_jobs', 'UPDATE'
  ) OR has_table_privilege(
    'authenticated', 'public.crm_document_storage_cleanup_jobs', 'DELETE'
  ) OR has_table_privilege(
    'openexpert_service', 'public.crm_document_storage_cleanup_jobs', 'SELECT'
  ) THEN
    RAISE EXCEPTION 'document_storage_cleanup_table_acl_invalid';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.reserve_crm_document_storage_cleanup(uuid,uuid,uuid,text,text,interval)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'openexpert_service',
    'public.reserve_crm_document_storage_cleanup(uuid,uuid,uuid,text,text,interval)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.claim_crm_document_storage_cleanups(text,integer,interval)',
    'EXECUTE'
  ) OR NOT has_function_privilege(
    'openexpert_service',
    'public.claim_crm_document_storage_cleanups(text,integer,interval)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'document_storage_cleanup_rpc_acl_invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.crm_documents'::regclass
      AND trigger_row.tgfoid =
        'private.enqueue_crm_document_storage_cleanup()'::regprocedure
      AND trigger_row.tgenabled <> 'D'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'document_storage_cleanup_delete_trigger_missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'public.crm_mortgage_application_artifacts'::regclass
      AND constraint_row.confrelid = 'public.crm_documents'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'document_storage_cleanup_artifact_restrict_fk_missing';
  END IF;

  storage_path_value := application_record.organization_id::text
    || '/' || application_record.case_id::text
    || '/' || document_id_value::text || '.pdf';
  raw_storage_path := application_record.organization_id::text
    || '/' || application_record.case_id::text
    || '/' || gen_random_uuid()::text || '.pdf';

  SELECT reservation.id
  INTO raw_cleanup_id
  FROM public.reserve_crm_document_storage_cleanup(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    'crm-case-documents',
    raw_storage_path,
    interval '30 minutes'
  ) AS reservation;
  PERFORM public.activate_crm_document_storage_cleanup(raw_cleanup_id);
  SELECT claimed.*
  INTO claim_record
  FROM public.claim_crm_document_storage_cleanup(
    raw_cleanup_id,
    '0050-smoke-raw-first',
    interval '5 minutes'
  ) AS claimed;
  preparation := public.prepare_crm_document_storage_cleanup(
    raw_cleanup_id,
    '0050-smoke-raw-first'
  );
  IF preparation->>'action' <> 'delete_blob' THEN
    RAISE EXCEPTION 'document_storage_cleanup_raw_prepare_failed';
  END IF;
  SELECT completed.status, completed.attempts
  INTO cleanup_status, cleanup_attempts
  FROM public.complete_crm_document_storage_cleanup(
    raw_cleanup_id,
    '0050-smoke-raw-first',
    true,
    NULL,
    interval '30 seconds'
  ) AS completed;
  IF cleanup_status IS DISTINCT FROM 'pending'::text OR cleanup_attempts <> 1 THEN
    RAISE EXCEPTION 'document_storage_cleanup_verification_pass_not_scheduled';
  END IF;

  PERFORM public.activate_crm_document_storage_cleanup(raw_cleanup_id);
  SELECT claimed.*
  INTO claim_record
  FROM public.claim_crm_document_storage_cleanup(
    raw_cleanup_id,
    '0050-smoke-raw-verify',
    interval '5 minutes'
  ) AS claimed;
  preparation := public.prepare_crm_document_storage_cleanup(
    raw_cleanup_id,
    '0050-smoke-raw-verify'
  );
  SELECT completed.status, completed.attempts
  INTO cleanup_status, cleanup_attempts
  FROM public.complete_crm_document_storage_cleanup(
    raw_cleanup_id,
    '0050-smoke-raw-verify',
    true,
    NULL,
    interval '30 seconds'
  ) AS completed;
  IF cleanup_status IS DISTINCT FROM 'completed'::text OR cleanup_attempts <> 2 THEN
    RAISE EXCEPTION 'document_storage_cleanup_verification_pass_failed';
  END IF;

  SELECT reservation.id
  INTO cleanup_id
  FROM public.reserve_crm_document_storage_cleanup(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    'crm-case-documents',
    storage_path_value,
    interval '30 minutes'
  ) AS reservation;

  SELECT reservation.id
  INTO retried_cleanup_id
  FROM public.reserve_crm_document_storage_cleanup(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    'crm-case-documents',
    storage_path_value,
    interval '30 minutes'
  ) AS reservation;

  IF cleanup_id IS NULL OR retried_cleanup_id IS DISTINCT FROM cleanup_id THEN
    RAISE EXCEPTION 'document_storage_cleanup_reservation_not_idempotent';
  END IF;

  INSERT INTO public.crm_documents (
    id,
    organization_id,
    case_id,
    submission_id,
    document_type,
    name,
    status_code,
    storage_bucket,
    storage_path,
    received_at,
    uploaded_by_user_id,
    mime_type,
    size_bytes,
    sha256,
    metadata
  ) VALUES (
    document_id_value,
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    'mortgage_esis',
    '0050-storage-cleanup-smoke.pdf',
    'received',
    'crm-case-documents',
    storage_path_value,
    statement_timestamp(),
    actor_id,
    'application/pdf',
    128,
    repeat('5', 64),
    jsonb_build_object('smoke', true)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE cleanup.id = cleanup_id
      AND cleanup.document_id = document_id_value
      AND cleanup.status = 'reserved'
  ) THEN
    RAISE EXCEPTION 'document_storage_cleanup_document_binding_failed';
  END IF;

  PERFORM set_config('app.user_id', unauthorized_actor_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    DELETE FROM public.crm_documents AS document
    WHERE document.organization_id = application_record.organization_id
      AND document.case_id = application_record.case_id
      AND document.id = document_id_value;
    RAISE EXCEPTION 'document_storage_cleanup_non_manager_delete_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_case_manager_permission_required' THEN RAISE; END IF;
  END;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_documents AS document
    WHERE document.id = document_id_value
  ) OR (
    SELECT cleanup.status
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE cleanup.id = cleanup_id
  ) IS DISTINCT FROM 'reserved'::text THEN
    RAISE EXCEPTION 'document_storage_cleanup_non_manager_delete_changed_state';
  END IF;

  INSERT INTO public.__crm_document_storage_cleanup_smoke_pins (document_id)
  VALUES (document_id_value);

  PERFORM set_config('app.user_id', '', true);
  PERFORM public.activate_crm_document_storage_cleanup(cleanup_id);
  SELECT claimed.*
  INTO claim_record
  FROM public.claim_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-pinned',
    interval '5 minutes'
  ) AS claimed;

  IF claim_record.id IS NULL OR claim_record.attempts <> 1 THEN
    RAISE EXCEPTION 'document_storage_cleanup_specific_claim_failed';
  END IF;

  preparation := public.prepare_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-pinned'
  );
  IF preparation->>'action' <> 'retained'
    OR preparation->>'documentId' <> document_id_value::text
  THEN
    RAISE EXCEPTION 'document_storage_cleanup_fk_pin_was_not_retained';
  END IF;

  PERFORM set_config('app.user_id', actor_id::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    DELETE FROM public.crm_documents AS document
    WHERE document.organization_id = application_record.organization_id
      AND document.case_id = application_record.case_id
      AND document.id = document_id_value;
    RAISE EXCEPTION 'document_storage_cleanup_pinned_delete_was_accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  IF (
    SELECT cleanup.status
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE cleanup.id = cleanup_id
  ) IS DISTINCT FROM 'retained'::text THEN
    RAISE EXCEPTION 'document_storage_cleanup_failed_delete_changed_tombstone';
  END IF;

  DELETE FROM public.__crm_document_storage_cleanup_smoke_pins
  WHERE document_id = document_id_value;

  EXECUTE 'SET LOCAL ROLE authenticated';
  DELETE FROM public.crm_documents AS document
  WHERE document.organization_id = application_record.organization_id
    AND document.case_id = application_record.case_id
    AND document.id = document_id_value;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  IF EXISTS (
    SELECT 1
    FROM public.crm_documents AS document
    WHERE document.id = document_id_value
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE cleanup.id = cleanup_id
      AND cleanup.document_id = document_id_value
      AND cleanup.purpose = 'document_delete'
      AND cleanup.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'document_storage_cleanup_authenticated_delete_not_enqueued';
  END IF;

  SELECT claimed.*
  INTO claim_record
  FROM public.claim_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-delete',
    interval '5 minutes'
  ) AS claimed;
  IF claim_record.id IS NULL OR claim_record.attempts <> 2 THEN
    RAISE EXCEPTION 'document_storage_cleanup_delete_claim_failed';
  END IF;

  preparation := public.prepare_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-delete'
  );
  IF preparation->>'action' <> 'delete_blob'
    OR preparation->>'storagePath' <> storage_path_value
  THEN
    RAISE EXCEPTION 'document_storage_cleanup_delete_prepare_failed';
  END IF;

  SELECT completed.status, completed.attempts
  INTO cleanup_status, cleanup_attempts
  FROM public.complete_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-delete',
    false,
    'crm_document_storage_delete_failed',
    interval '1 minute'
  ) AS completed;
  IF cleanup_status IS DISTINCT FROM 'failed'::text OR cleanup_attempts <> 2 THEN
    RAISE EXCEPTION 'document_storage_cleanup_failure_not_retryable';
  END IF;

  PERFORM public.activate_crm_document_storage_cleanup(cleanup_id);
  SELECT claimed.*
  INTO claim_record
  FROM public.claim_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-retry',
    interval '5 minutes'
  ) AS claimed;
  IF claim_record.id IS NULL OR claim_record.attempts <> 3 THEN
    RAISE EXCEPTION 'document_storage_cleanup_retry_claim_failed';
  END IF;

  preparation := public.prepare_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-retry'
  );
  IF preparation->>'action' <> 'delete_blob' THEN
    RAISE EXCEPTION 'document_storage_cleanup_retry_prepare_failed';
  END IF;

  SELECT completed.status, completed.attempts
  INTO cleanup_status, cleanup_attempts
  FROM public.complete_crm_document_storage_cleanup(
    cleanup_id,
    '0050-smoke-retry',
    true,
    NULL,
    interval '30 seconds'
  ) AS completed;
  IF cleanup_status IS DISTINCT FROM 'completed'::text OR cleanup_attempts <> 3 THEN
    RAISE EXCEPTION 'document_storage_cleanup_completion_failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.get_crm_document_storage_cleanup_by_document(
      application_record.organization_id,
      application_record.case_id,
      document_id_value
    ) AS cleanup
    WHERE cleanup.id = cleanup_id
      AND cleanup.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'document_storage_cleanup_completed_tombstone_missing';
  END IF;

  BEGIN
    INSERT INTO public.crm_documents (
      organization_id,
      case_id,
      document_type,
      name,
      status_code,
      storage_bucket,
      storage_path,
      received_at,
      uploaded_by_user_id,
      mime_type,
      size_bytes,
      sha256,
      metadata
    ) VALUES (
      application_record.organization_id,
      application_record.case_id,
      'other',
      '0050-retired-path.pdf',
      'received',
      'crm-case-documents',
      storage_path_value,
      statement_timestamp(),
      actor_id,
      'application/pdf',
      128,
      repeat('6', 64),
      jsonb_build_object('smoke', true)
    );
    RAISE EXCEPTION 'document_storage_cleanup_retired_path_was_reused';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'crm_document_storage_path_is_retired' THEN RAISE; END IF;
  END;
END;
$document_storage_cleanup_smoke$;
