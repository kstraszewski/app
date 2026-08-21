-- Rollback-only structural/runtime smoke for the deterministic OpenExpert
-- mock ESIS import.  It deliberately uses synthetic dispatch rows and never
-- reads a mailbox, object storage, applicant name or applicant credential.

BEGIN;
SET LOCAL row_security = off;

-- Cross-language golden vector shared with
-- apps/crm/test/openexpert-mock-bank-payload.test.ts.  This exercises UTF-8
-- byte framing, UTC millisecond normalization, ordered applicants and
-- decimal strings without JavaScript/PostgreSQL JSON-number ambiguity.
DO $generation_context_golden$
DECLARE
  preimage text;
  actual text;
BEGIN
  preimage :=
    private.crm_mock_bank_generation_context_part(
      'domain', 'openexpert-mock-bank-generation-context-v1'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.dispatchId', '3e89f378-c125-4842-927e-98201bbcb9f0'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.payloadId', '9bc02176-7104-4a4f-92cf-f8b509db6eaa'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.applicationId', '9427198c-bf6c-4b2d-8530-68a5117c5679'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.applicationNumber', 'OEB-20260819-123456'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.kind', 'esis'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.generation', '2'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.generationStartedAt', '2026-08-19T10:15:00.123Z'
    ) || private.crm_mock_bank_generation_context_part(
      'document.pdfFileName', 'OEB-20260819-123456-formularz-ESIS.pdf'
    ) || private.crm_mock_bank_generation_context_part(
      'document.issueDate', '2026-08-19'
    ) || private.crm_mock_bank_generation_context_part(
      'document.validUntil', '2026-09-18'
    ) || private.crm_mock_bank_generation_context_part(
      'document.decisionOutcome', 'null'
    ) || private.crm_mock_bank_generation_context_part(
      'document.applicantCount', '2'
    ) || private.crm_mock_bank_generation_context_part(
      'document.applicantNames.0', 'Żaneta Łęcka'
    ) || private.crm_mock_bank_generation_context_part(
      'document.applicantNames.1', 'Michał O''Connor'
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.loanAmount',
      private.crm_mock_bank_canonical_numeric(500000.00)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.currency', 'PLN'
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.annualInterestRate',
      private.crm_mock_bank_canonical_numeric(0.00001)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.aprc',
      private.crm_mock_bank_canonical_numeric(6.90000)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.monthlyInstallment',
      private.crm_mock_bank_canonical_numeric(2963.10)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.termMonths',
      private.crm_mock_bank_canonical_numeric(360)
    );
  actual := encode(
    extensions.digest(convert_to(preimage, 'UTF8'), 'sha256'), 'hex'
  );
  IF actual <> 'd8aecee0a6bc474e22574e0c3119600a88fab5fe4b2209fffe01d5806551f713'
  THEN
    RAISE EXCEPTION 'generation_context_cross_language_golden_mismatch';
  END IF;
END
$generation_context_golden$;

CREATE TEMP TABLE bank_mail_0087_dispatch_state (
  scenario text PRIMARY KEY,
  dispatch_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  request_id uuid NOT NULL,
  payload_id uuid NOT NULL,
  manifest_path text NOT NULL,
  archive_path text NOT NULL
) ON COMMIT DROP;

-- Synthetic dispatches are sufficient for testing the dispatch-local
-- pin/rotation/cleanup protocol.  FK triggers are disabled only for these
-- inserts, then restored before every transition under test.
ALTER TABLE public.crm_mock_bank_dispatches DISABLE TRIGGER ALL;
DO $insert_synthetic_dispatches$
DECLARE
  scenario_value text;
  dispatch_id_value uuid;
  organization_id_value uuid;
  case_id_value uuid;
  application_id_value uuid;
  request_id_value uuid;
  payload_id_value uuid;
  started_at_value timestamptz := clock_timestamp() - interval '1 minute';
  prepared boolean;
BEGIN
  FOREACH scenario_value IN ARRAY ARRAY[
    'legacy', 'partial', 'context_changed', 'uncommitted_invalid',
    'manifest_retention'
  ] LOOP
    dispatch_id_value := gen_random_uuid();
    organization_id_value := gen_random_uuid();
    case_id_value := gen_random_uuid();
    application_id_value := gen_random_uuid();
    request_id_value := gen_random_uuid();
    payload_id_value := gen_random_uuid();
    prepared := scenario_value = 'manifest_retention';

    INSERT INTO public.crm_mock_bank_dispatches (
      id, organization_id, case_id, application_id, kind, status,
      generation, generation_started_at, attempts, request_id,
      requested_by_user_id, recipient_connection_id, payload_id,
      manifest_storage_path, manifest_sha256, manifest_size_bytes,
      archive_storage_path, archive_sha256, archive_size_bytes,
      payload_sha256, payload_ready_at, last_attempt_at, lease_expires_at,
      created_at, updated_at,
      generation_context_sha256,
      generation_applicant_context_sha256,
      generation_bank_context_sha256,
      generation_expectation_sha256,
      generation_valid_until,
      generation_context_pinned_at
    ) VALUES (
      dispatch_id_value, organization_id_value, case_id_value,
      application_id_value, 'esis', 'pending', 1, started_at_value, 1,
      request_id_value, NULL, NULL, payload_id_value,
      organization_id_value::text || '/' || application_id_value::text || '/' ||
        dispatch_id_value::text || '/esis/generation-1-' ||
        payload_id_value::text || '.json',
      CASE WHEN prepared THEN repeat('1', 64) ELSE NULL END,
      CASE WHEN prepared THEN 1024 ELSE NULL END,
      organization_id_value::text || '/' || application_id_value::text || '/' ||
        dispatch_id_value::text || '/esis/generation-1-' ||
        payload_id_value::text || '.zip',
      CASE WHEN prepared THEN repeat('2', 64) ELSE NULL END,
      CASE WHEN prepared THEN 2048 ELSE NULL END,
      CASE WHEN prepared THEN repeat('3', 64) ELSE NULL END,
      CASE WHEN prepared THEN started_at_value + interval '10 seconds' ELSE NULL END,
      started_at_value, clock_timestamp() + interval '5 minutes',
      started_at_value, started_at_value,
      CASE WHEN prepared THEN repeat('4', 64) ELSE NULL END,
      CASE WHEN prepared THEN repeat('5', 64) ELSE NULL END,
      CASE WHEN prepared THEN repeat('6', 64) ELSE NULL END,
      CASE WHEN prepared THEN repeat('7', 64) ELSE NULL END,
      CASE WHEN prepared THEN date_trunc('day', started_at_value) + interval '30 days' ELSE NULL END,
      CASE WHEN prepared THEN started_at_value + interval '10 seconds' ELSE NULL END
    );

    INSERT INTO bank_mail_0087_dispatch_state VALUES (
      scenario_value, dispatch_id_value, organization_id_value, case_id_value,
      application_id_value, request_id_value, payload_id_value,
      organization_id_value::text || '/' || application_id_value::text || '/' ||
        dispatch_id_value::text || '/esis/generation-1-' ||
        payload_id_value::text || '.json',
      organization_id_value::text || '/' || application_id_value::text || '/' ||
        dispatch_id_value::text || '/esis/generation-1-' ||
        payload_id_value::text || '.zip'
    );
  END LOOP;
END
$insert_synthetic_dispatches$;
-- Re-enable application triggers under test while keeping RI triggers off for
-- these synthetic, rollback-only rows.
ALTER TABLE public.crm_mock_bank_dispatches ENABLE TRIGGER USER;
ALTER TABLE public.crm_mock_bank_dispatches
  DISABLE TRIGGER crm_mock_bank_dispatches_record_sent_activity;

DO $legacy_and_partial_pin$
DECLARE
  fixture bank_mail_0087_dispatch_state%rowtype;
  partial_rejected boolean := false;
BEGIN
  SELECT * INTO STRICT fixture FROM bank_mail_0087_dispatch_state
  WHERE scenario = 'legacy';
  PERFORM set_config('request.jwt.claims', '{}'::jsonb::text, true);
  PERFORM public.commit_crm_mock_bank_dispatch_payload(
    fixture.dispatch_id, fixture.request_id, 1, repeat('a', 64), 100,
    repeat('b', 64), 200, repeat('c', 64)
  );
  IF EXISTS (
    SELECT 1 FROM public.crm_mock_bank_dispatches AS dispatch
    WHERE dispatch.id = fixture.dispatch_id
      AND dispatch.generation_context_sha256 IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'legacy_payload_commit_unexpectedly_pinned';
  END IF;

  SELECT * INTO STRICT fixture FROM bank_mail_0087_dispatch_state
  WHERE scenario = 'partial';
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'openexpert-mock-bank-generation-context-v1'
    )::text,
    true
  );
  BEGIN
    PERFORM public.commit_crm_mock_bank_dispatch_payload(
      fixture.dispatch_id, fixture.request_id, 1, repeat('a', 64), 100,
      repeat('b', 64), 200, repeat('c', 64)
    );
  EXCEPTION WHEN insufficient_privilege THEN
    partial_rejected := SQLERRM = 'crm_mock_bank_generation_context_claims_invalid';
  END;
  IF NOT partial_rejected THEN
    RAISE EXCEPTION 'partial_generation_claims_were_accepted';
  END IF;
END
$legacy_and_partial_pin$;

DO $context_change_and_safe_rotation$
DECLARE
  fixture bank_mail_0087_dispatch_state%rowtype;
  context_rejected boolean := false;
  new_request_id uuid := gen_random_uuid();
  rotated public.crm_mock_bank_dispatches%rowtype;
BEGIN
  SELECT * INTO STRICT fixture FROM bank_mail_0087_dispatch_state
  WHERE scenario = 'context_changed';
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'openexpert-mock-bank-generation-context-v1',
      'serviceId', 'openexpert-crm-mock-bank',
      'preset', 'mock-bank-payload-commit',
      'organizationId', fixture.organization_id,
      'caseId', fixture.case_id,
      'applicationId', fixture.application_id,
      'kind', 'esis',
      'requestId', fixture.request_id,
      'recipientConnectionId', NULL,
      'dispatchId', fixture.dispatch_id,
      'generation', 1,
      'generationContextSha256', repeat('d', 64),
      'applicantContextSha256', repeat('e', 64),
      'bankContextSha256', repeat('f', 64),
      'expectationSha256', repeat('0', 64),
      'validUntil', '2026-09-20T00:00:00.000Z',
      'manifestSha256', repeat('a', 64),
      'manifestSizeBytes', 100,
      'archiveSha256', repeat('b', 64),
      'archiveSizeBytes', 200,
      'payloadSha256', repeat('c', 64)
    )::text,
    true
  );
  BEGIN
    PERFORM public.commit_crm_mock_bank_dispatch_payload(
      fixture.dispatch_id, fixture.request_id, 1, repeat('a', 64), 100,
      repeat('b', 64), 200, repeat('c', 64)
    );
  EXCEPTION WHEN serialization_failure THEN
    context_rejected := SQLERRM = 'crm_mock_bank_generation_context_changed';
  END;
  IF NOT context_rejected THEN
    RAISE EXCEPTION 'context_mutation_between_build_and_commit_was_accepted';
  END IF;

  PERFORM set_config('request.jwt.claims', '{}'::jsonb::text, true);
  PERFORM public.finalize_crm_mock_bank_dispatch(
    fixture.dispatch_id, fixture.request_id, 'failed', NULL,
    'generation_context_changed'
  );
  UPDATE public.crm_mock_bank_dispatches AS dispatch
  SET status = 'pending', request_id = new_request_id, attempts = attempts + 1,
      error_code = NULL, failed_at = NULL,
      last_attempt_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + interval '5 minutes'
  WHERE dispatch.id = fixture.dispatch_id
  RETURNING * INTO STRICT rotated;

  IF rotated.generation <> 2
    OR rotated.payload_id = fixture.payload_id
    OR rotated.manifest_storage_path = fixture.manifest_path
    OR rotated.archive_storage_path = fixture.archive_path
    OR rotated.payload_ready_at IS NOT NULL
    OR rotated.generation_context_sha256 IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM public.crm_mock_bank_payload_cleanup_jobs AS cleanup
      WHERE cleanup.storage_path = fixture.manifest_path
        AND cleanup.object_kind = 'manifest'
        AND cleanup.object_sha256 IS NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM public.crm_mock_bank_payload_cleanup_jobs AS cleanup
      WHERE cleanup.storage_path = fixture.archive_path
        AND cleanup.object_kind = 'archive'
        AND cleanup.object_sha256 IS NULL
    )
  THEN
    RAISE EXCEPTION 'uncommitted_context_retry_did_not_rotate_paths';
  END IF;
END
$context_change_and_safe_rotation$;

DO $uncommitted_invalid_safe_rotation$
DECLARE
  fixture bank_mail_0087_dispatch_state%rowtype;
  new_request_id uuid := gen_random_uuid();
  rotated public.crm_mock_bank_dispatches%rowtype;
BEGIN
  SELECT * INTO STRICT fixture FROM bank_mail_0087_dispatch_state
  WHERE scenario = 'uncommitted_invalid';
  PERFORM public.finalize_crm_mock_bank_dispatch(
    fixture.dispatch_id, fixture.request_id, 'failed', NULL,
    'uncommitted_payload_invalid'
  );
  UPDATE public.crm_mock_bank_dispatches AS dispatch
  SET status = 'pending', request_id = new_request_id, attempts = attempts + 1,
      error_code = NULL, failed_at = NULL,
      last_attempt_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + interval '5 minutes'
  WHERE dispatch.id = fixture.dispatch_id
  RETURNING * INTO STRICT rotated;

  IF rotated.generation <> 2
    OR rotated.payload_id = fixture.payload_id
    OR rotated.manifest_storage_path = fixture.manifest_path
    OR rotated.archive_storage_path = fixture.archive_path
    OR NOT EXISTS (
      SELECT 1 FROM public.crm_mock_bank_payload_cleanup_jobs AS cleanup
      WHERE cleanup.storage_path = fixture.manifest_path
        AND cleanup.object_kind = 'manifest'
        AND cleanup.object_sha256 IS NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM public.crm_mock_bank_payload_cleanup_jobs AS cleanup
      WHERE cleanup.storage_path = fixture.archive_path
        AND cleanup.object_kind = 'archive'
        AND cleanup.object_sha256 IS NULL
    )
  THEN
    RAISE EXCEPTION 'uncommitted_invalid_retry_did_not_rotate_paths';
  END IF;
END
$uncommitted_invalid_safe_rotation$;

DO $manifest_retention$
DECLARE
  fixture bank_mail_0087_dispatch_state%rowtype;
  transition_now timestamptz := clock_timestamp();
  manifest_available timestamptz;
  archive_available timestamptz;
BEGIN
  SELECT * INTO STRICT fixture FROM bank_mail_0087_dispatch_state
  WHERE scenario = 'manifest_retention';
  UPDATE public.crm_mock_bank_dispatches AS dispatch
  SET status = 'sent', provider_message_id = '0087-smoke-provider-message',
      lease_expires_at = NULL, sent_at = transition_now
  WHERE dispatch.id = fixture.dispatch_id;

  SELECT cleanup.available_at INTO STRICT manifest_available
  FROM public.crm_mock_bank_payload_cleanup_jobs AS cleanup
  WHERE cleanup.storage_path = fixture.manifest_path;
  SELECT cleanup.available_at INTO STRICT archive_available
  FROM public.crm_mock_bank_payload_cleanup_jobs AS cleanup
  WHERE cleanup.storage_path = fixture.archive_path;

  IF manifest_available < transition_now + interval '6 days 23 hours'
    OR archive_available > clock_timestamp() + interval '1 minute'
  THEN
    RAISE EXCEPTION 'manifest_v2_cleanup_was_not_delayed';
  END IF;
END
$manifest_retention$;

-- Runtime catalog gates for force-resend, stale import replay, status
-- truthfulness and lease fencing.  These fail if a future rewrite silently
-- removes the protocol even when the migration still parses.
DO $catalog_protocol_gates$
DECLARE
  jobs_oid regclass := 'private.mail_bank_agent_pdf_attachment_jobs'::regclass;
  begin_definition text;
  status_definition text;
  fail_definition text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = jobs_oid
      AND constraint_row.contype = 'u'
      AND pg_get_constraintdef(constraint_row.oid) ~
        'dispatch_id, dispatch_generation'
  ) THEN
    RAISE EXCEPTION 'late_generation_mail_blocked_fresh_generation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = jobs_oid
      AND constraint_row.contype = 'f'
      AND pg_get_constraintdef(constraint_row.oid) ~
        'dispatch_id, dispatch_generation, dispatch_payload_id'
  ) THEN
    RAISE EXCEPTION 'mutable_dispatch_generation_fk_blocked_force_resend';
  END IF;

  begin_definition := pg_get_functiondef(
    'public.begin_bank_mail_agent_pdf_attachment_import(uuid,text,text,bigint,timestamptz)'::regprocedure
  );
  IF begin_definition !~ 'cleanup_row.status <> ''reserved'''
    OR begin_definition !~ 'cleanup_row.locked_at IS NOT NULL'
  THEN
    RAISE EXCEPTION 'completed_cleanup_replay_returned_upload_path';
  END IF;
  IF begin_definition !~
    'available_at = import_now \+ ''00:45:00''::interval|available_at = import_now \+ interval ''45 minutes'''
  THEN
    RAISE EXCEPTION 'cleanup_reservation_was_not_extended_before_replay';
  END IF;

  status_definition := pg_get_functiondef(
    'private.get_bank_mail_agent_pdf_attachment_status(uuid)'::regprocedure
  );
  IF status_definition !~ 'applicantContextSha256'
    OR status_definition !~ 'bankContextSha256'
    OR status_definition !~ 'expectationSha256'
    OR status_definition !~ 'validUntil'
  THEN
    RAISE EXCEPTION 'attached_status_ignored_current_context_change';
  END IF;

  fail_definition := pg_get_functiondef(
    'public.fail_bank_mail_agent_pdf_attachment(uuid,text,text,boolean,integer)'::regprocedure
  );
  IF fail_definition !~ 'lease_expires_at <= fail_now' THEN
    RAISE EXCEPTION 'expired_worker_failure_was_not_fenced';
  END IF;
END
$catalog_protocol_gates$;

-- UPDATE must not turn a pre-existing row into ESIS or mutate the binary
-- identity of an automated document.  Inserts bypass FK triggers only to
-- keep this smoke independent from the much larger mortgage fixture.
ALTER TABLE public.crm_documents DISABLE TRIGGER ALL;
DO $insert_document_guard_fixtures$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  case_id_value uuid := gen_random_uuid();
  application_id_value uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.crm_documents (
    id, organization_id, case_id, submission_id, document_type, name
  ) VALUES (
    '87000000-0000-4000-8000-000000000001', organization_id_value,
    case_id_value, application_id_value, 'other', 'other.pdf'
  );
  INSERT INTO public.crm_documents (
    id, organization_id, case_id, submission_id, document_type, name,
    mime_type, size_bytes, sha256, bank_mail_attachment_job_id, actor_kind
  ) VALUES (
    '87000000-0000-4000-8000-000000000002', organization_id_value,
    case_id_value, application_id_value, 'mortgage_esis', 'trusted.pdf',
    'application/pdf', 100, repeat('8', 64),
    '87000000-0000-4000-8000-000000000003', 'bank_mail_agent'
  );
END
$insert_document_guard_fixtures$;
ALTER TABLE public.crm_documents ENABLE TRIGGER USER;

DO $document_update_guards$
DECLARE
  rejected boolean := false;
BEGIN
  BEGIN
    UPDATE public.crm_documents SET document_type = 'mortgage_esis'
    WHERE id = '87000000-0000-4000-8000-000000000001';
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := SQLERRM = 'mortgage_esis_document_identity_is_immutable';
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'non_esis_to_esis_update_bypassed_active_job';
  END IF;

  rejected := false;
  BEGIN
    UPDATE public.crm_documents SET name = 'tampered.pdf'
    WHERE id = '87000000-0000-4000-8000-000000000002';
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := SQLERRM = 'mortgage_esis_document_identity_is_immutable';
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'bank_agent_document_binary_identity_was_mutable';
  END IF;
END
$document_update_guards$;

DO $identity_scope_guards$
DECLARE
  identity_id_value uuid;
  bank_id_value uuid;
  rejected boolean;
BEGIN
  SELECT identity.id, identity.bank_id
  INTO STRICT identity_id_value, bank_id_value
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
  WHERE identity.auto_attach_pdf_enabled
    AND bank.slug = 'openexpert-bank'
    AND bank.is_mock
  LIMIT 1;

  rejected := false;
  BEGIN
    UPDATE public.mortgage_bank_email_identities
    SET sender_domain = 'evil.example'
    WHERE id = identity_id_value;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'enabled_identity_scope_was_mutable';
  END IF;

  rejected := false;
  BEGIN
    UPDATE public.mortgage_banks SET is_mock = false WHERE id = bank_id_value;
  EXCEPTION WHEN check_violation THEN rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'enabled_bank_scope_was_mutable';
  END IF;
END
$identity_scope_guards$;

-- Full canonical no-job status regression: a byte-identical pinned/sent
-- generation remains the delivery snapshot, but a later applicant-context
-- edit is presented as a controlled attachment conflict.  An intake that
-- predates the current generation cutoff must not be attributed to it.
CREATE TEMP TABLE bank_mail_0087_canonical_state (
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  person_id uuid NOT NULL,
  generation_started_at timestamptz NOT NULL,
  provider_message_hash text NOT NULL
) ON COMMIT DROP;

DO $canonical_drift_setup$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  owner_user_id_value uuid := gen_random_uuid();
  connection_id_value uuid := gen_random_uuid();
  client_id_value uuid := gen_random_uuid();
  person_id_value uuid := gen_random_uuid();
  case_id_value uuid := gen_random_uuid();
  case_item_id_value uuid := gen_random_uuid();
  application_id_value uuid := gen_random_uuid();
  offer_id_value uuid := gen_random_uuid();
  dispatch_id_value uuid := gen_random_uuid();
  payload_id_value uuid := gen_random_uuid();
  request_id_value uuid := gen_random_uuid();
  product_type_id_value uuid;
  bank_id_value uuid;
  generation_started_value timestamptz := clock_timestamp() - interval '1 minute';
  generation_context jsonb;
  claim_result jsonb;
  run_result jsonb;
  intake_id_value uuid;
  provider_hash_value text := encode(
    extensions.digest(convert_to(gen_random_uuid()::text, 'utf8'), 'sha256'),
    'hex'
  );
  source_hash_value text := encode(
    extensions.digest(convert_to(gen_random_uuid()::text, 'utf8'), 'sha256'),
    'hex'
  );
  email_value text := '0087-drift-' ||
    replace(owner_user_id_value::text, '-', '') || '@example.test';
BEGIN
  SELECT bank.id INTO STRICT bank_id_value
  FROM public.mortgage_banks AS bank
  JOIN public.mortgage_bank_email_identities AS identity
    ON identity.bank_id = bank.id
  WHERE bank.slug = 'openexpert-bank'
    AND bank.is_mock
    AND identity.sender_domain = 'openexpert.app'
    AND NOT identity.allow_subdomains
    AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
    AND identity.is_active
    AND identity.auto_attach_pdf_enabled;

  SELECT product_type.id INTO STRICT product_type_id_value
  FROM public.crm_product_types AS product_type
  WHERE product_type.code = 'credit_mortgage'
    AND product_type.organization_id IS NULL
    AND product_type.is_active
  ORDER BY product_type.id LIMIT 1;

  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES (owner_user_id_value, '0087 Drift Owner', email_value, true);
  INSERT INTO public.organizations (
    id, name, slug, kind, billing_access_state
  ) VALUES (
    organization_id_value, '0087 canonical drift',
    '0087-canonical-drift-' || replace(organization_id_value::text, '-', ''),
    'intermediary', 'not_required'
  );
  INSERT INTO public.users (id, organization_id, email, role, full_name)
  VALUES (
    owner_user_id_value, organization_id_value, email_value, 'admin',
    '0087 Drift Owner'
  );
  EXECUTE 'ALTER TABLE public.organization_memberships DISABLE TRIGGER USER';
  INSERT INTO public.organization_memberships (organization_id, user_id, role)
  VALUES (organization_id_value, owner_user_id_value, 'admin');
  EXECUTE 'ALTER TABLE public.organization_memberships ENABLE TRIGGER USER';
  INSERT INTO public.mail_connections (
    id, organization_id, owner_user_id, provider, account_id,
    account_email, status
  ) VALUES (
    connection_id_value, organization_id_value, owner_user_id_value, 'google',
    '0087-drift-' || connection_id_value::text, email_value, 'active'
  );

  EXECUTE 'ALTER TABLE public.crm_clients DISABLE TRIGGER USER';
  INSERT INTO public.crm_clients (
    id, organization_id, owner_user_id, display_name
  ) VALUES (
    client_id_value, organization_id_value, owner_user_id_value,
    '0087 Drift Client'
  );
  EXECUTE 'ALTER TABLE public.crm_clients ENABLE TRIGGER USER';
  INSERT INTO public.crm_client_people (
    id, organization_id, client_id, role, first_name, last_name,
    display_name, pesel
  ) VALUES (
    person_id_value, organization_id_value, client_id_value, 'primary',
    'Konrad', 'Straszewski', 'Konrad Straszewski', '85010112345'
  );
  EXECUTE 'ALTER TABLE public.crm_cases DISABLE TRIGGER USER';
  INSERT INTO public.crm_cases (
    id, organization_id, client_id, owner_user_id, title
  ) VALUES (
    case_id_value, organization_id_value, client_id_value,
    owner_user_id_value, '0087 Drift Case'
  );
  EXECUTE 'ALTER TABLE public.crm_cases ENABLE TRIGGER USER';
  INSERT INTO public.crm_case_clients (
    organization_id, case_id, client_id, is_primary
  ) VALUES (organization_id_value, case_id_value, client_id_value, true);
  INSERT INTO public.crm_case_items (
    id, organization_id, case_id, product_type_id, owner_user_id, title,
    amount_value, currency
  ) VALUES (
    case_item_id_value, organization_id_value, case_id_value,
    product_type_id_value, owner_user_id_value, '0087 Mortgage', 500000, 'PLN'
  );
  INSERT INTO public.crm_item_submissions (
    id, organization_id, case_item_id, external_reference
  ) VALUES (
    application_id_value, organization_id_value, case_item_id_value,
    'OEB-20260821-870001'
  );

  EXECUTE 'ALTER TABLE public.crm_case_offer_snapshots DISABLE TRIGGER USER';
  INSERT INTO public.crm_case_offer_snapshots (
    id, organization_id, case_id, bank_id, saved_by_user_id,
    bank_name, product_name, calculator_version, currency, loan_amount,
    first_installment, representative_apr_pct,
    scenario_snapshot, catalog_snapshot, calculation_snapshot
  ) VALUES (
    offer_id_value, organization_id_value, case_id_value, bank_id_value,
    owner_user_id_value, 'OpenExpert Bank', '0087 Product', '0087-smoke',
    'PLN', 500000, 2963.10, 6.9,
    jsonb_build_object('years', 30),
    jsonb_build_object('version', jsonb_build_object(
      'fixed_rate_pct', '5.89', 'representative_apr_pct', '6.9'
    )),
    jsonb_build_object('currency', 'PLN')
  );
  EXECUTE 'ALTER TABLE public.crm_case_offer_snapshots ENABLE TRIGGER USER';

  EXECUTE 'ALTER TABLE public.crm_case_bank_applications DISABLE TRIGGER USER';
  INSERT INTO public.crm_case_bank_applications (
    submission_id, organization_id, case_id, case_item_id, offer_id,
    bank_id, slot, created_by_user_id, scenario_snapshot,
    calculation_snapshot, net_loan_amount, gross_loan_amount,
    first_installment
  ) VALUES (
    application_id_value, organization_id_value, case_id_value,
    case_item_id_value, offer_id_value, bank_id_value, 1,
    owner_user_id_value, jsonb_build_object('currency', 'PLN'),
    jsonb_build_object('currency', 'PLN'), 500000, 500000, 2963.10
  );
  EXECUTE 'ALTER TABLE public.crm_case_bank_applications ENABLE TRIGGER USER';
  INSERT INTO public.crm_mortgage_application_processes (
    application_id, organization_id, case_id, stage, created_by_user_id
  ) VALUES (
    application_id_value, organization_id_value, case_id_value,
    'pre_application', owner_user_id_value
  );

  -- Insert an unpinned prepared row, recompute the authoritative context, then
  -- install those exact pins as if the scoped commit trigger had done so.
  INSERT INTO public.crm_mock_bank_dispatches (
    id, organization_id, case_id, application_id, kind, status, generation,
    generation_started_at, attempts, request_id, requested_by_user_id,
    recipient_connection_id, payload_id, manifest_storage_path,
    archive_storage_path, last_attempt_at, lease_expires_at, created_at,
    updated_at
  ) VALUES (
    dispatch_id_value, organization_id_value, case_id_value,
    application_id_value, 'esis', 'pending', 1, generation_started_value, 1,
    request_id_value, owner_user_id_value, connection_id_value, payload_id_value,
    organization_id_value::text || '/' || application_id_value::text || '/' ||
      dispatch_id_value::text || '/esis/generation-1-' ||
      payload_id_value::text || '.json',
    organization_id_value::text || '/' || application_id_value::text || '/' ||
      dispatch_id_value::text || '/esis/generation-1-' ||
      payload_id_value::text || '.zip',
    generation_started_value, clock_timestamp() + interval '5 minutes',
    generation_started_value, generation_started_value
  );
  generation_context := private.crm_mock_bank_generation_context(
    dispatch_id_value, payload_id_value, 1, generation_started_value
  );
  IF generation_context IS NULL THEN
    RAISE EXCEPTION 'canonical_drift_generation_context_missing';
  END IF;
  EXECUTE 'ALTER TABLE public.crm_mock_bank_dispatches DISABLE TRIGGER crm_mock_bank_dispatches_pin_generation_context';
  UPDATE public.crm_mock_bank_dispatches AS dispatch
  SET manifest_sha256 = repeat('a', 64), manifest_size_bytes = 1000,
      archive_sha256 = repeat('b', 64), archive_size_bytes = 2000,
      payload_sha256 = repeat('c', 64),
      payload_ready_at = clock_timestamp(),
      generation_context_sha256 = generation_context ->> 'generationContextSha256',
      generation_applicant_context_sha256 = generation_context ->> 'applicantContextSha256',
      generation_bank_context_sha256 = generation_context ->> 'bankContextSha256',
      generation_expectation_sha256 = generation_context ->> 'expectationSha256',
      generation_valid_until = (generation_context ->> 'validUntil')::timestamptz,
      generation_context_pinned_at = clock_timestamp()
  WHERE dispatch.id = dispatch_id_value;
  EXECUTE 'ALTER TABLE public.crm_mock_bank_dispatches ENABLE TRIGGER crm_mock_bank_dispatches_pin_generation_context';
  PERFORM public.finalize_crm_mock_bank_dispatch(
    dispatch_id_value, request_id_value, 'sent', '0087-drift-provider', NULL
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'crm-bank-mail-ingress-v1',
      'serviceId', 'openexpert-crm-bank-mail-ingestion',
      'preset', 'bank-mail-intake',
      'organizationId', organization_id_value,
      'connectionId', connection_id_value,
      'mailboxOwnerUserId', owner_user_id_value,
      'provider', 'google',
      'threadKeySha256', repeat('9', 64),
      'threadReference', '0087-canonical-drift-thread',
      'dkimAligned', true
    )::text,
    true
  );
  claim_result := public.claim_bank_mail_agent_intake(
    organization_id_value, connection_id_value, owner_user_id_value,
    'google', provider_hash_value, source_hash_value, 'openexpert.app',
    'failed', false, false, bank_id_value
  );
  intake_id_value := (claim_result ->> 'intakeId')::uuid;
  run_result := public.claim_bank_mail_agent_run(
    intake_id_value, 'deepseek/deepseek-v4-flash-0731'
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'openexpert_service')::text,
    true
  );
  PERFORM public.bind_bank_mail_agent_run_session(
    (run_result ->> 'runId')::uuid,
    run_result ->> 'leaseToken',
    'eve_0087_canonical_drift'
  );
  PERFORM public.propose_bank_mail_case_match(
    intake_id_value, (run_result ->> 'runId')::uuid,
    case_id_value, application_id_value, 'strong_candidate',
    ARRAY['bank_application_reference']::text[], ARRAY[]::text[]
  );

  INSERT INTO bank_mail_0087_canonical_state VALUES (
    organization_id_value, owner_user_id_value, connection_id_value,
    intake_id_value, person_id_value, generation_started_value,
    provider_hash_value
  );
END
$canonical_drift_setup$;

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- The production runner installs these owner privileges before smoke.  Direct
-- isolated migration compiles do not, so mirror them transaction-locally.
GRANT USAGE ON SCHEMA app TO openexpert_owner;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO openexpert_owner;
GRANT EXECUTE ON FUNCTION app.request_jwt_subject() TO openexpert_owner;
GRANT USAGE ON SCHEMA private TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_organization_member(uuid)
  TO openexpert_owner;
-- The production runner reassigns all existing tables to openexpert_owner;
-- this direct-migration compile leaves them owned by postgres.  Transactional
-- BYPASSRLS mirrors owner access for this smoke and is rolled back below.
ALTER ROLE openexpert_owner BYPASSRLS;
GRANT SELECT ON ALL TABLES IN SCHEMA public, private TO openexpert_owner;

DO $canonical_no_job_drift_status$
DECLARE
  fixture bank_mail_0087_canonical_state%rowtype;
  statuses jsonb;
BEGIN
  SELECT * INTO STRICT fixture FROM bank_mail_0087_canonical_state;
  IF NOT EXISTS (
    SELECT 1 FROM private.mail_bank_agent_thread_link_jobs AS link_job
    WHERE link_job.intake_id = fixture.intake_id AND link_job.state = 'linked'
  ) OR EXISTS (
    SELECT 1 FROM private.mail_bank_agent_pdf_attachment_jobs AS job
    WHERE job.intake_id = fixture.intake_id
  ) THEN
    RAISE EXCEPTION 'canonical_drift_fixture_not_linked_without_job';
  END IF;

  UPDATE public.crm_clients AS client
  SET display_name = 'Konrad Straszewski Zmieniony'
  WHERE client.id = (
    SELECT person.client_id
    FROM public.crm_client_people AS person
    WHERE person.id = fixture.person_id
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated', 'sub', fixture.owner_user_id
    )::text,
    true
  );

  UPDATE public.mail_bank_agent_intakes AS intake
  SET claimed_at = fixture.generation_started_at - interval '1 day'
  WHERE intake.id = fixture.intake_id;
  statuses := public.get_my_mail_bank_agent_statuses(
    fixture.organization_id, fixture.connection_id,
    ARRAY[fixture.provider_message_hash]::text[]
  );
  IF statuses #> '{0,attachment}' IS DISTINCT FROM 'null'::jsonb THEN
    RAISE EXCEPTION 'old_generation_intake_was_attributed_to_current_dispatch';
  END IF;

  UPDATE public.mail_bank_agent_intakes AS intake
  SET claimed_at = fixture.generation_started_at + interval '1 second'
  WHERE intake.id = fixture.intake_id;
  statuses := public.get_my_mail_bank_agent_statuses(
    fixture.organization_id, fixture.connection_id,
    ARRAY[fixture.provider_message_hash]::text[]
  );
  IF statuses #>> '{0,attachment,state}' <> 'conflict'
    OR statuses #>> '{0,attachment,resolutionCode}'
      <> 'attachment_scope_conflict'
    OR statuses #> '{0,attachment,documentId}' IS DISTINCT FROM 'null'::jsonb
    OR EXISTS (
      SELECT 1 FROM private.mail_bank_agent_pdf_attachment_jobs AS job
      WHERE job.intake_id = fixture.intake_id
    )
  THEN
    RAISE EXCEPTION 'attached_status_ignored_current_context_change';
  END IF;
END
$canonical_no_job_drift_status$;

ROLLBACK;
