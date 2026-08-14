-- Run after 0049 inside a disposable transaction. The outer caller rolls back.
DO $mortgage_deadline_policy$
DECLARE
  failed_cases text;
BEGIN
  WITH test_case(label, completed_at, expected_due_at) AS (
    VALUES
      ('weekday', timestamptz '2026-08-03 10:00 Europe/Warsaw', timestamptz '2026-08-24 23:59:59.999999 Europe/Warsaw'),
      ('weekend', timestamptz '2026-07-18 10:00 Europe/Warsaw', timestamptz '2026-08-10 23:59:59.999999 Europe/Warsaw'),
      ('fixed_holiday', timestamptz '2026-10-21 10:00 Europe/Warsaw', timestamptz '2026-11-12 23:59:59.999999 Europe/Warsaw'),
      ('easter_monday', timestamptz '2026-03-16 10:00 Europe/Warsaw', timestamptz '2026-04-07 23:59:59.999999 Europe/Warsaw'),
      ('corpus_christi', timestamptz '2026-05-14 10:00 Europe/Warsaw', timestamptz '2026-06-05 23:59:59.999999 Europe/Warsaw'),
      ('dst_change', timestamptz '2026-03-08 10:00 Europe/Warsaw', timestamptz '2026-03-30 23:59:59.999999 Europe/Warsaw'),
      ('christmas_eve', timestamptz '2026-12-03 10:00 Europe/Warsaw', timestamptz '2026-12-28 23:59:59.999999 Europe/Warsaw')
  )
  SELECT string_agg(label, ', ' ORDER BY label)
  INTO failed_cases
  FROM test_case
  WHERE private.crm_mortgage_decision_due_at(completed_at) IS DISTINCT FROM expected_due_at;

  IF failed_cases IS NOT NULL THEN
    RAISE EXCEPTION 'mortgage_deadline_policy_failed: %', failed_cases;
  END IF;
END;
$mortgage_deadline_policy$;

CREATE FUNCTION pg_temp.complete_mortgage_ai_attempt(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_actor_user_id uuid,
  p_expected_kind text,
  p_source_sha256 text,
  p_validation_context jsonb,
  p_decision_outcome text,
  p_valid_until timestamptz,
  p_verdict text,
  p_confidence numeric,
  p_reason_codes text[],
  p_pii_free_observations jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  claim_result jsonb;
  completion_result jsonb;
BEGIN
  claim_result := public.claim_crm_mortgage_document_ai_attempt(
    p_organization_id,
    p_case_id,
    p_application_id,
    p_actor_user_id,
    p_expected_kind,
    p_source_sha256,
    p_validation_context ->> 'applicantContextSha256',
    p_validation_context ->> 'bankContextSha256',
    p_validation_context ->> 'expectationSha256',
    'vercel-ai-gateway',
    'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1',
    p_decision_outcome,
    p_valid_until
  );
  IF claim_result ->> 'state' = 'completed' THEN
    IF claim_result ->> 'verdict' IS DISTINCT FROM p_verdict
      OR (claim_result ->> 'confidence')::numeric IS DISTINCT FROM p_confidence
      OR ARRAY(
        SELECT jsonb_array_elements_text(claim_result -> 'reasonCodes')
      ) IS DISTINCT FROM p_reason_codes
      OR claim_result -> 'piiFreeObservations' IS DISTINCT FROM p_pii_free_observations
    THEN
      RAISE EXCEPTION 'mortgage_smoke_attempt_replay_result_mismatch';
    END IF;
    RETURN (claim_result ->> 'attemptId')::uuid;
  END IF;
  IF claim_result ->> 'state' <> 'claimed' THEN
    RAISE EXCEPTION 'mortgage_smoke_attempt_was_not_claimed: %', claim_result;
  END IF;
  completion_result := public.complete_crm_mortgage_document_ai_attempt(
    p_organization_id,
    p_case_id,
    p_application_id,
    p_actor_user_id,
    (claim_result ->> 'attemptId')::uuid,
    claim_result ->> 'leaseToken',
    p_verdict,
    p_confidence,
    p_reason_codes,
    p_pii_free_observations
  );
  IF completion_result ->> 'state' <> 'completed' THEN
    RAISE EXCEPTION 'mortgage_smoke_attempt_was_not_completed: %', completion_result;
  END IF;
  RETURN (completion_result ->> 'attemptId')::uuid;
END;
$$;

GRANT EXECUTE ON FUNCTION pg_temp.complete_mortgage_ai_attempt(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, timestamptz,
  text, numeric, text[], jsonb
) TO openexpert_service;

DO $mortgage_smoke$
DECLARE
  application_record record;
  compat_application_record record;
  contract_record public.crm_case_contract_selections%rowtype;
  actor_id uuid;
  unauthorized_actor_id uuid;
  unauthorized_actor_role text;
  document_id_value uuid;
  ai_validation_id_value uuid;
  ai_attempt_id_value uuid;
  needs_review_attempt_id uuid;
  cleanup_attempt_id uuid;
  expired_esis_attempt_id uuid;
  positive_decision_attempt_id uuid;
  negative_decision_attempt_id uuid;
  needs_review_validation_id uuid;
  cleanup_document_id uuid;
  cleanup_validation_id uuid;
  expired_esis_document_id uuid;
  decision_document_id uuid;
  agreement_document_id uuid;
  spare_client_id uuid;
  compat_spare_client_id uuid;
  mutated_client_id uuid;
  mutated_bank_id uuid;
  original_display_name text;
  original_bank_name text;
  recipients jsonb;
  recipient record;
  command_id_value uuid;
  result_value jsonb;
  attempt_claim_result jsonb;
  attempt_completion_result jsonb;
  attempt_replay_result jsonb;
  artifact_id_value uuid;
  current_revision bigint := 0;
  due_at_value timestamptz;
  expected_client_count integer;
  actual_count integer;
  accepted_esis_observations jsonb;
  accepted_decision_observations jsonb;
  esis_validation_context jsonb;
  expired_esis_validation_context jsonb;
  decision_validation_context jsonb;
  negative_decision_validation_context jsonb;
  esis_valid_until_value timestamptz := statement_timestamp() + interval '30 days';
  applicant_context_sha256_value text;
  bank_context_sha256_value text;
  expectation_sha256_value text;
  validated_bank_id_value uuid;
  validated_offer_id_value uuid;
  validated_loan_amount_value numeric(14,2);
  validated_currency_value text;
BEGIN
  SELECT application.organization_id, application.case_id,
         application.submission_id AS application_id, application.case_item_id
  INTO application_record
  FROM public.crm_case_bank_applications application
  JOIN public.crm_item_submissions submission ON submission.id = application.submission_id
  WHERE submission.status_code = 'draft'
    AND application.snapshot_status = 'complete'
    AND EXISTS (
      SELECT 1 FROM public.crm_case_clients link
      WHERE link.organization_id = application.organization_id
        AND link.case_id = application.case_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.crm_case_contract_selections contract
      WHERE contract.organization_id = application.organization_id
        AND contract.case_id = application.case_id
    )
  ORDER BY application.created_at
  LIMIT 1;

  IF application_record.application_id IS NULL THEN
    RAISE EXCEPTION 'mortgage_smoke_fixture_missing';
  END IF;

  SELECT membership.user_id INTO actor_id
  FROM public.organization_memberships membership
  WHERE membership.organization_id = application_record.organization_id
  ORDER BY (membership.role = 'admin') DESC, membership.user_id
  LIMIT 1;

  -- During phase 1 the old PATCH endpoint is still live. Its status writes
  -- must remain accepted and create an auditable, synchronized process/event
  -- projection until 0051 switches the deployment to command-only writes.
  SELECT application.organization_id, application.case_id,
         application.submission_id AS application_id, application.case_item_id
  INTO compat_application_record
  FROM public.crm_case_bank_applications application
  JOIN public.crm_item_submissions submission
    ON submission.organization_id = application.organization_id
   AND submission.id = application.submission_id
  WHERE application.submission_id <> application_record.application_id
    AND application.organization_id = application_record.organization_id
    AND application.snapshot_status = 'complete'
    AND submission.status_code = 'draft'
    AND NOT EXISTS (
      SELECT 1
      FROM public.crm_case_contract_selections contract
      WHERE contract.organization_id = application.organization_id
        AND contract.case_id = application.case_id
    )
  ORDER BY application.created_at
  LIMIT 1;
  IF compat_application_record.application_id IS NULL THEN
    RAISE EXCEPTION 'mortgage_smoke_legacy_patch_fixture_missing';
  END IF;

  SELECT membership.user_id, membership.role
  INTO unauthorized_actor_id, unauthorized_actor_role
  FROM public.organization_memberships membership
  JOIN public.crm_cases crm_case
    ON crm_case.organization_id = membership.organization_id
   AND crm_case.id = compat_application_record.case_id
  JOIN public.crm_case_items item
    ON item.organization_id = membership.organization_id
   AND item.case_id = crm_case.id
   AND item.id = compat_application_record.case_item_id
  WHERE membership.organization_id = compat_application_record.organization_id
    AND membership.role <> 'admin'
    AND membership.user_id IS DISTINCT FROM crm_case.owner_user_id
    AND membership.user_id IS DISTINCT FROM item.owner_user_id
  ORDER BY membership.user_id
  LIMIT 1;
  IF unauthorized_actor_id IS NULL THEN
    RAISE EXCEPTION 'mortgage_smoke_legacy_patch_non_manager_fixture_missing';
  END IF;
  PERFORM set_config('app.user_id', unauthorized_actor_id::text, true);
  BEGIN
    UPDATE public.crm_item_submissions submission
    SET status_code = 'wycofane'
    WHERE submission.organization_id = compat_application_record.organization_id
      AND submission.case_item_id = compat_application_record.case_item_id
      AND submission.id = compat_application_record.application_id;
    RAISE EXCEPTION 'mortgage_smoke_non_manager_legacy_patch_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_legacy_patch_requires_case_manager' THEN RAISE; END IF;
  END;

  PERFORM set_config('app.user_id', actor_id::text, true);
  UPDATE public.crm_item_submissions submission
  SET status_code = 'wyslane',
      submitted_at = statement_timestamp()
  WHERE submission.organization_id = compat_application_record.organization_id
    AND submission.case_item_id = compat_application_record.case_item_id
    AND submission.id = compat_application_record.application_id;
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_processes process
    WHERE process.application_id = compat_application_record.application_id
      AND process.stage = 'submitted'
      AND process.revision = 1
      AND EXISTS (
        SELECT 1
        FROM public.crm_mortgage_application_events event
        WHERE event.application_id = process.application_id
          AND event.aggregate_revision = process.revision
          AND event.event_type = 'legacy_status_synchronized'
      )
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_phase1_legacy_patch_not_synchronized';
  END IF;
  SELECT count(*) INTO actual_count
  FROM public.crm_mortgage_application_parties party
  WHERE party.organization_id = compat_application_record.organization_id
    AND party.case_id = compat_application_record.case_id
    AND party.application_id = compat_application_record.application_id;
  IF actual_count <> (
    SELECT count(*)
    FROM public.crm_case_clients link
    WHERE link.organization_id = compat_application_record.organization_id
      AND link.case_id = compat_application_record.case_id
  ) OR actual_count = 0 THEN
    RAISE EXCEPTION 'mortgage_smoke_phase1_legacy_patch_parties_not_frozen';
  END IF;

  UPDATE public.crm_item_submissions submission
  SET status_code = 'draft'
  WHERE submission.organization_id = compat_application_record.organization_id
    AND submission.case_item_id = compat_application_record.case_item_id
    AND submission.id = compat_application_record.application_id;
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_processes process
    WHERE process.application_id = compat_application_record.application_id
      AND process.stage = 'pre_application'
      AND process.revision = 2
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_phase1_legacy_patch_reconcile_failed';
  END IF;

  SELECT client.id INTO compat_spare_client_id
  FROM public.crm_clients client
  WHERE client.organization_id = compat_application_record.organization_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.crm_case_clients link
      WHERE link.organization_id = client.organization_id
        AND link.case_id = compat_application_record.case_id
        AND link.client_id = client.id
    )
  ORDER BY client.id
  LIMIT 1;
  IF compat_spare_client_id IS NULL THEN
    RAISE EXCEPTION 'mortgage_smoke_legacy_refreeze_client_fixture_missing';
  END IF;
  INSERT INTO public.crm_case_clients (
    organization_id, case_id, client_id, is_primary
  ) VALUES (
    compat_application_record.organization_id,
    compat_application_record.case_id,
    compat_spare_client_id,
    false
  );
  UPDATE public.crm_item_submissions submission
  SET status_code = 'wyslane'
  WHERE submission.organization_id = compat_application_record.organization_id
    AND submission.case_item_id = compat_application_record.case_item_id
    AND submission.id = compat_application_record.application_id;
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_parties party
    WHERE party.organization_id = compat_application_record.organization_id
      AND party.case_id = compat_application_record.case_id
      AND party.application_id = compat_application_record.application_id
      AND party.client_id = compat_spare_client_id
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_phase1_legacy_resubmit_did_not_refreeze_parties';
  END IF;
  UPDATE public.crm_item_submissions submission
  SET status_code = 'draft'
  WHERE submission.organization_id = compat_application_record.organization_id
    AND submission.case_item_id = compat_application_record.case_item_id
    AND submission.id = compat_application_record.application_id;
  DELETE FROM public.crm_case_clients link
  WHERE link.organization_id = compat_application_record.organization_id
    AND link.case_id = compat_application_record.case_id
    AND link.client_id = compat_spare_client_id;

  BEGIN
    DELETE FROM public.crm_item_submissions submission
    WHERE submission.organization_id = application_record.organization_id
      AND submission.case_item_id = application_record.case_item_id
      AND submission.id = application_record.application_id;
    RAISE EXCEPTION 'mortgage_smoke_untouched_draft_delete_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'mortgage_smoke_untouched_draft_delete_rollback' THEN RAISE; END IF;
  END;

  INSERT INTO public.crm_documents (
    organization_id, case_id, case_item_id, submission_id, document_type,
    name, status_code, storage_bucket, storage_path, received_at,
    metadata, uploaded_by_user_id, mime_type, size_bytes, sha256
  ) VALUES (
    application_record.organization_id,
    application_record.case_id,
    application_record.case_item_id,
    application_record.application_id,
    'mortgage_esis',
    '0049-smoke.pdf',
    'received',
    'crm-case-documents',
    application_record.organization_id::text || '/' || application_record.case_id::text || '/' || gen_random_uuid()::text || '.pdf',
    statement_timestamp(),
    jsonb_build_object('smoke', true),
    actor_id,
    'application/pdf',
    100,
    repeat('a', 64)
  ) RETURNING id INTO document_id_value;

  SELECT jsonb_agg(jsonb_build_object(
    'recipientClientId', link.client_id,
    'deliveredAt', statement_timestamp(),
    'channel', 'other_durable_medium',
    'evidenceReference', '0049-smoke'
  ) ORDER BY link.is_primary DESC, link.client_id), count(*)
  INTO recipients, expected_client_count
  FROM public.crm_case_clients link
  WHERE link.organization_id = application_record.organization_id
    AND link.case_id = application_record.case_id;

  accepted_esis_observations := jsonb_build_object(
    'checks', jsonb_build_object(
      'content', 'match', 'kind', 'match', 'bank', 'match',
      'applicants', 'match', 'decisionOutcome', 'not_applicable',
      'validUntil', 'match', 'loanAmount', 'match',
      'requiredSections', 'match'
    ),
    'expectedApplicantCount', expected_client_count,
    'matchedApplicantCount', expected_client_count,
    'missingSignalCodes', jsonb_build_array(),
    'anomalyCodes', jsonb_build_array()
  );
  accepted_decision_observations := jsonb_set(
    jsonb_set(
      accepted_esis_observations,
      '{checks,decisionOutcome}',
      to_jsonb('match'::text)
    ),
    '{checks,loanAmount}',
    to_jsonb('not_applicable'::text)
  );
  esis_validation_context := public.get_crm_mortgage_document_validation_context(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    'esis',
    NULL,
    esis_valid_until_value
  );
  applicant_context_sha256_value := esis_validation_context ->> 'applicantContextSha256';
  bank_context_sha256_value := esis_validation_context ->> 'bankContextSha256';
  expectation_sha256_value := esis_validation_context ->> 'expectationSha256';
  validated_bank_id_value := (esis_validation_context ->> 'bankId')::uuid;
  validated_offer_id_value := (esis_validation_context ->> 'offerId')::uuid;
  validated_loan_amount_value := nullif(
    esis_validation_context ->> 'loanAmount', ''
  )::numeric;
  validated_currency_value := esis_validation_context ->> 'currency';

  IF has_table_privilege(
    'authenticated', 'public.crm_mortgage_document_ai_validations', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_authenticated_ai_validation_insert_still_granted';
  END IF;
  IF has_column_privilege(
    'openexpert_service', 'public.crm_mortgage_document_ai_validations',
    'created_at', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_service_can_forge_ai_validation_created_at';
  END IF;

  command_id_value := gen_random_uuid();
  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', command_id_value,
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'attach_artifact',
        'kind', 'esis',
        'documentId', document_id_value,
        'receivedAt', statement_timestamp(),
        'validUntil', esis_valid_until_value
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_missing_ai_validation_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'accepted_mortgage_document_ai_validation_required' THEN RAISE; END IF;
  END;

  IF has_table_privilege(
    'openexpert_service', 'public.crm_mortgage_document_ai_attempts', 'INSERT'
  ) OR has_table_privilege(
    'authenticated', 'public.crm_mortgage_document_ai_attempts', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_ai_attempt_direct_insert_still_granted';
  END IF;

  EXECUTE 'SET LOCAL ROLE openexpert_service';
  BEGIN
    PERFORM public.claim_crm_mortgage_document_ai_attempt(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id,
      actor_id,
      'esis',
      repeat('a', 64),
      repeat('f', 64),
      bank_context_sha256_value,
      expectation_sha256_value,
      'vercel-ai-gateway',
      'gemini-3.5-flash-lite',
      'mortgage-document-validation-v1',
      NULL,
      esis_valid_until_value
    );
    RAISE EXCEPTION 'mortgage_smoke_stale_attempt_context_was_claimed';
  EXCEPTION WHEN serialization_failure THEN
    IF SQLERRM <> 'mortgage_document_ai_attempt_context_stale' THEN RAISE; END IF;
  END;

  attempt_claim_result := public.claim_crm_mortgage_document_ai_attempt(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    actor_id,
    'esis',
    repeat('a', 64),
    applicant_context_sha256_value,
    bank_context_sha256_value,
    expectation_sha256_value,
    'vercel-ai-gateway',
    'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1',
    NULL,
    esis_valid_until_value
  );
  IF attempt_claim_result ->> 'state' <> 'claimed'
    OR attempt_claim_result ->> 'leaseToken' !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'mortgage_smoke_ai_attempt_claim_failed: %', attempt_claim_result;
  END IF;
  ai_attempt_id_value := (attempt_claim_result ->> 'attemptId')::uuid;
  needs_review_attempt_id := ai_attempt_id_value;

  BEGIN
    PERFORM public.complete_crm_mortgage_document_ai_attempt(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id,
      actor_id,
      ai_attempt_id_value,
      NULL,
      'needs_review',
      0.6100,
      ARRAY['low_confidence'],
      accepted_esis_observations
    );
    RAISE EXCEPTION 'mortgage_smoke_null_attempt_lease_was_accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_mortgage_document_ai_attempt_result' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.complete_crm_mortgage_document_ai_attempt(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id,
      actor_id,
      ai_attempt_id_value,
      attempt_claim_result ->> 'leaseToken',
      'accepted',
      0.9900,
      ARRAY[]::text[],
      jsonb_set(
        accepted_esis_observations,
        '{checks,bank}',
        to_jsonb('mismatch'::text)
      )
    );
    RAISE EXCEPTION 'mortgage_smoke_inconsistent_accepted_attempt_was_completed';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_mortgage_document_ai_attempt_result' THEN RAISE; END IF;
  END;

  attempt_completion_result := public.complete_crm_mortgage_document_ai_attempt(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    actor_id,
    needs_review_attempt_id,
    attempt_claim_result ->> 'leaseToken',
    'needs_review',
    0.6100,
    ARRAY['low_confidence'],
    accepted_esis_observations
  );
  IF attempt_completion_result ->> 'state' <> 'completed'
    OR attempt_completion_result ->> 'verdict' <> 'needs_review'
  THEN
    RAISE EXCEPTION 'mortgage_smoke_ai_attempt_completion_failed: %', attempt_completion_result;
  END IF;

  -- The cache is intentionally cross-command and cross-manager. A second
  -- authorized expert must replay A's completed result, while the validation
  -- audit actor remains server-owned by the completed attempt.
  EXECUTE 'SET LOCAL ROLE openexpert_owner';
  UPDATE public.organization_memberships membership
  SET role = 'admin'
  WHERE membership.organization_id = application_record.organization_id
    AND membership.user_id = unauthorized_actor_id;
  EXECUTE 'SET LOCAL ROLE openexpert_service';
  attempt_replay_result := public.claim_crm_mortgage_document_ai_attempt(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    unauthorized_actor_id,
    'esis',
    repeat('a', 64),
    applicant_context_sha256_value,
    bank_context_sha256_value,
    expectation_sha256_value,
    'vercel-ai-gateway',
    'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1',
    NULL,
    esis_valid_until_value
  );
  IF attempt_replay_result ->> 'state' <> 'completed'
    OR attempt_replay_result ->> 'verdict' <> 'needs_review'
    OR (attempt_replay_result ->> 'attemptId')::uuid IS DISTINCT FROM ai_attempt_id_value
    OR attempt_replay_result ? 'leaseToken'
  THEN
    RAISE EXCEPTION 'mortgage_smoke_negative_attempt_was_not_replayed: %', attempt_replay_result;
  END IF;

  INSERT INTO public.crm_mortgage_document_ai_validations (
    ai_attempt_id,
    organization_id, case_id, application_id, document_id, expected_kind,
    source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
    validated_bank_id, validated_offer_id, validated_decision_outcome,
    validated_valid_until, validated_loan_amount, validated_currency,
    verdict, provider, model, prompt_version, confidence,
    reason_codes, pii_free_observations
  ) VALUES (
    needs_review_attempt_id,
    application_record.organization_id, application_record.case_id,
    application_record.application_id, document_id_value, 'esis', repeat('a', 64),
    applicant_context_sha256_value, bank_context_sha256_value, expectation_sha256_value,
    validated_bank_id_value, validated_offer_id_value, NULL,
    esis_valid_until_value, validated_loan_amount_value, validated_currency_value,
    'needs_review', 'vercel-ai-gateway', 'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1', 0.6100,
    ARRAY['low_confidence'], accepted_esis_observations
  ) RETURNING id INTO needs_review_validation_id;
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_document_ai_validations validation
    WHERE validation.id = needs_review_validation_id
      AND validation.validated_by_user_id = actor_id
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_cross_manager_validation_actor_not_server_owned';
  END IF;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'attach_artifact',
        'kind', 'esis',
        'documentId', document_id_value,
        'receivedAt', statement_timestamp(),
        'validUntil', esis_valid_until_value
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_needs_review_ai_validation_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'accepted_mortgage_document_ai_validation_required' THEN RAISE; END IF;
  END;

  EXECUTE 'SET LOCAL ROLE openexpert_service';
  INSERT INTO public.crm_mortgage_document_ai_validations (
    ai_attempt_id,
    organization_id, case_id, application_id, document_id, expected_kind,
    source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
    validated_bank_id, validated_offer_id, validated_decision_outcome,
    validated_valid_until, validated_loan_amount, validated_currency,
    verdict, provider, model, prompt_version, confidence,
    reason_codes, pii_free_observations,
    expert_override_reason, expert_overridden_by_user_id
  ) VALUES (
    ai_attempt_id_value,
    application_record.organization_id, application_record.case_id,
    application_record.application_id, document_id_value, 'esis', repeat('a', 64),
    applicant_context_sha256_value, bank_context_sha256_value, expectation_sha256_value,
    validated_bank_id_value, validated_offer_id_value, NULL,
    esis_valid_until_value, validated_loan_amount_value, validated_currency_value,
    'needs_review', 'vercel-ai-gateway', 'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1', 0.6100,
    ARRAY['low_confidence'], accepted_esis_observations,
    'Ekspert zweryfikował zgodność dokumentu z wnioskiem i zatwierdził go ręcznie.',
    unauthorized_actor_id
  ) RETURNING id INTO ai_validation_id_value;
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_document_ai_validations validation
    WHERE validation.id = ai_validation_id_value
      AND validation.validated_by_user_id = actor_id
      AND validation.expert_overridden_by_user_id = unauthorized_actor_id
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_cross_manager_override_audit_failed';
  END IF;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';
  UPDATE public.organization_memberships membership
  SET role = unauthorized_actor_role
  WHERE membership.organization_id = application_record.organization_id
    AND membership.user_id = unauthorized_actor_id;

  BEGIN
    UPDATE public.crm_mortgage_document_ai_validations
    SET verdict = 'rejected'
    WHERE id = ai_validation_id_value;
    RAISE EXCEPTION 'mortgage_smoke_ai_validation_update_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_document_ai_validations_are_append_only' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.crm_mortgage_document_ai_validations
    WHERE id = ai_validation_id_value;
    RAISE EXCEPTION 'mortgage_smoke_ai_validation_delete_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_document_ai_validations_are_append_only' THEN RAISE; END IF;
  END;

  -- A validation may briefly exist before attach. Deleting its unpinned source
  -- metadata cleans that validation through the document FK cascade while the
  -- bytes/context attempt cache survives for conservative replay.
  -- Match the production ordering: AI completes before document metadata exists.
  ai_attempt_id_value := pg_temp.complete_mortgage_ai_attempt(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    actor_id,
    'esis',
    repeat('e', 64),
    esis_validation_context,
    NULL,
    esis_valid_until_value,
    'accepted',
    0.9900,
    ARRAY[]::text[],
    accepted_esis_observations
  );
  cleanup_attempt_id := ai_attempt_id_value;
  INSERT INTO public.crm_documents (
    organization_id, case_id, case_item_id, submission_id, document_type,
    name, status_code, storage_bucket, storage_path, received_at,
    metadata, uploaded_by_user_id, mime_type, size_bytes, sha256
  ) VALUES (
    application_record.organization_id, application_record.case_id,
    application_record.case_item_id, application_record.application_id,
    'mortgage_esis', '0049-smoke-ai-cleanup.pdf', 'received',
    'crm-case-documents',
    application_record.organization_id::text || '/' || application_record.case_id::text || '/' || gen_random_uuid()::text || '.pdf',
    statement_timestamp(), jsonb_build_object('smoke', true, 'cleanup', true),
    actor_id, 'application/pdf', 100, repeat('e', 64)
  ) RETURNING id INTO cleanup_document_id;
  EXECUTE 'SET LOCAL ROLE openexpert_service';
  INSERT INTO public.crm_mortgage_document_ai_validations (
    ai_attempt_id,
    organization_id, case_id, application_id, document_id, expected_kind,
    source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
    validated_bank_id, validated_offer_id, validated_decision_outcome,
    validated_valid_until, validated_loan_amount, validated_currency,
    verdict, provider, model, prompt_version, confidence,
    reason_codes, pii_free_observations
  ) VALUES (
    cleanup_attempt_id,
    application_record.organization_id, application_record.case_id,
    application_record.application_id, cleanup_document_id, 'esis', repeat('e', 64),
    applicant_context_sha256_value, bank_context_sha256_value, expectation_sha256_value,
    validated_bank_id_value, validated_offer_id_value, NULL,
    esis_valid_until_value, validated_loan_amount_value, validated_currency_value,
    'accepted', 'vercel-ai-gateway', 'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1', 0.9900, ARRAY[]::text[],
    accepted_esis_observations
  ) RETURNING id INTO cleanup_validation_id;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';
  DELETE FROM public.crm_documents WHERE id = cleanup_document_id;
  IF EXISTS (
    SELECT 1 FROM public.crm_mortgage_document_ai_validations
    WHERE id = cleanup_validation_id
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_unpinned_ai_validation_cleanup_failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_mortgage_document_ai_attempts
    WHERE id = cleanup_attempt_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_ai_attempt_cache_was_lost_with_document';
  END IF;

  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', command_id_value,
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'attach_artifact',
      'kind', 'esis',
      'documentId', document_id_value,
      'receivedAt', statement_timestamp(),
      'validUntil', esis_valid_until_value
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  artifact_id_value := (result_value ->> 'artifactId')::uuid;
  IF current_revision <> 1 OR artifact_id_value IS NULL THEN
    RAISE EXCEPTION 'mortgage_smoke_attach_esis_failed: %', result_value;
  END IF;
  SELECT artifact.ai_validation_id INTO needs_review_validation_id
  FROM public.crm_mortgage_application_artifacts artifact
  WHERE artifact.id = artifact_id_value;
  IF needs_review_validation_id IS DISTINCT FROM ai_validation_id_value THEN
    RAISE EXCEPTION 'mortgage_smoke_ai_validation_pin_failed';
  END IF;

  BEGIN
    DELETE FROM public.crm_item_submissions submission
    WHERE submission.organization_id = application_record.organization_id
      AND submission.case_item_id = application_record.case_item_id
      AND submission.id = application_record.application_id;
    RAISE EXCEPTION 'mortgage_smoke_audited_draft_delete_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_application_has_auditable_history_and_cannot_be_deleted' THEN
      RAISE;
    END IF;
  END;

  EXECUTE 'SET LOCAL ROLE openexpert_service';
  BEGIN
    INSERT INTO public.crm_mortgage_document_ai_validations (
      ai_attempt_id,
      organization_id, case_id, application_id, document_id, expected_kind,
      source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
      validated_bank_id, validated_offer_id, validated_decision_outcome,
      validated_valid_until, validated_loan_amount, validated_currency,
      verdict, provider, model, prompt_version, confidence,
      reason_codes, pii_free_observations,
      expert_override_reason, expert_overridden_by_user_id
    ) VALUES (
      needs_review_attempt_id,
      application_record.organization_id, application_record.case_id,
      application_record.application_id, document_id_value, 'esis', repeat('a', 64),
      applicant_context_sha256_value, bank_context_sha256_value, expectation_sha256_value,
      validated_bank_id_value, validated_offer_id_value, NULL,
      esis_valid_until_value, validated_loan_amount_value, validated_currency_value,
      'needs_review', 'vercel-ai-gateway', 'gemini-3.5-flash-lite',
      'mortgage-document-validation-v1', 0.6100,
      ARRAY['low_confidence'], accepted_esis_observations,
      'Ekspert ponownie potwierdził ręczną weryfikację dokumentu hipotecznego.',
      actor_id
    );
    RAISE EXCEPTION 'mortgage_smoke_post_attach_revalidation_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_document_ai_validation_already_pinned' THEN RAISE; END IF;
  END;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object('type', 'submit_application')
    ));
    RAISE EXCEPTION 'mortgage_smoke_submission_without_delivery_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'esis_delivery_to_every_applicant_required' THEN RAISE; END IF;
  END;

  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', gen_random_uuid(),
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'deliver_artifact',
      'artifactId', artifact_id_value,
      'recipients', recipients
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  IF current_revision <> 2 THEN
    RAISE EXCEPTION 'mortgage_smoke_deliver_esis_failed: %', result_value;
  END IF;

  SELECT client.id INTO spare_client_id
  FROM public.crm_clients client
  WHERE client.organization_id = application_record.organization_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.crm_case_clients link
      WHERE link.organization_id = client.organization_id
        AND link.case_id = application_record.case_id
        AND link.client_id = client.id
    )
  ORDER BY client.id
  LIMIT 1;
  IF spare_client_id IS NULL THEN
    RAISE EXCEPTION 'mortgage_smoke_spare_client_fixture_missing';
  END IF;
  INSERT INTO public.crm_case_clients (
    organization_id, case_id, client_id, is_primary
  ) VALUES (
    application_record.organization_id, application_record.case_id,
    spare_client_id, false
  );
  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'submit_application',
        'submittedAt', statement_timestamp()
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_stale_applicant_set_ai_validation_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_esis_ai_validation_applicant_context_stale' THEN RAISE; END IF;
  END;
  DELETE FROM public.crm_case_clients link
  WHERE link.organization_id = application_record.organization_id
    AND link.case_id = application_record.case_id
    AND link.client_id = spare_client_id;

  -- The context digest is versioned by crm_clients.updated_at, not only by the
  -- stable client UUID. A name change under the same UUID must therefore make
  -- the validation stale. The exception subtransaction restores both the name
  -- and updated_at after proving the guard.
  SELECT client.id, client.display_name
  INTO mutated_client_id, original_display_name
  FROM public.crm_case_clients link
  JOIN public.crm_clients client
    ON client.organization_id = link.organization_id
   AND client.id = link.client_id
  WHERE link.organization_id = application_record.organization_id
    AND link.case_id = application_record.case_id
  ORDER BY client.id
  LIMIT 1;
  BEGIN
    UPDATE public.crm_clients
    SET display_name = original_display_name || ' [0049 smoke]'
    WHERE organization_id = application_record.organization_id
      AND id = mutated_client_id;

    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'submit_application',
        'submittedAt', statement_timestamp()
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_stale_applicant_identity_ai_validation_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_esis_ai_validation_applicant_context_stale' THEN RAISE; END IF;
  END;

  -- A newer but expired ESIS must block submission even though an older,
  -- delivered version is still valid. The exception subtransaction rolls the
  -- intentionally invalid renewal back before the happy path continues.
  BEGIN
    INSERT INTO public.crm_documents (
      organization_id, case_id, case_item_id, submission_id, document_type,
      name, status_code, storage_bucket, storage_path, received_at,
      metadata, uploaded_by_user_id, mime_type, size_bytes, sha256
    ) VALUES (
      application_record.organization_id,
      application_record.case_id,
      application_record.case_item_id,
      application_record.application_id,
      'mortgage_esis',
      '0049-smoke-expired-newest-esis.pdf',
      'received',
      'crm-case-documents',
      application_record.organization_id::text || '/' || application_record.case_id::text || '/' || gen_random_uuid()::text || '.pdf',
      statement_timestamp(),
      jsonb_build_object('smoke', true, 'invalidNewest', true),
      actor_id,
      'application/pdf',
      100,
      repeat('d', 64)
    ) RETURNING id INTO expired_esis_document_id;

    expired_esis_validation_context :=
      public.get_crm_mortgage_document_validation_context(
        application_record.organization_id,
        application_record.case_id,
        application_record.application_id,
        'esis',
        NULL,
        statement_timestamp() - interval '1 day'
      );

    expired_esis_attempt_id := pg_temp.complete_mortgage_ai_attempt(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id,
      actor_id,
      'esis',
      repeat('d', 64),
      expired_esis_validation_context,
      NULL,
      (expired_esis_validation_context ->> 'validUntil')::timestamptz,
      'accepted',
      0.9900,
      ARRAY[]::text[],
      accepted_esis_observations
    );

    EXECUTE 'SET LOCAL ROLE openexpert_service';
    INSERT INTO public.crm_mortgage_document_ai_validations (
      ai_attempt_id,
      organization_id, case_id, application_id, document_id, expected_kind,
      source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
      validated_bank_id, validated_offer_id, validated_decision_outcome,
      validated_valid_until, validated_loan_amount, validated_currency,
      verdict, provider, model, prompt_version, confidence,
      reason_codes, pii_free_observations
    ) VALUES (
      expired_esis_attempt_id,
      application_record.organization_id, application_record.case_id,
      application_record.application_id, expired_esis_document_id, 'esis', repeat('d', 64),
      expired_esis_validation_context ->> 'applicantContextSha256',
      expired_esis_validation_context ->> 'bankContextSha256',
      expired_esis_validation_context ->> 'expectationSha256',
      (expired_esis_validation_context ->> 'bankId')::uuid,
      (expired_esis_validation_context ->> 'offerId')::uuid,
      NULL,
      (expired_esis_validation_context ->> 'validUntil')::timestamptz,
      nullif(expired_esis_validation_context ->> 'loanAmount', '')::numeric,
      expired_esis_validation_context ->> 'currency',
      'accepted', 'vercel-ai-gateway', 'gemini-3.5-flash-lite',
      'mortgage-document-validation-v1', 0.9900, ARRAY[]::text[],
      accepted_esis_observations
    );
    EXECUTE 'SET LOCAL ROLE openexpert_owner';

    result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'attach_artifact',
        'kind', 'esis',
        'documentId', expired_esis_document_id,
        'receivedAt', statement_timestamp(),
        'validUntil', statement_timestamp() - interval '1 day'
      )
    ));
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', (result_value ->> 'revision')::bigint,
      'command', jsonb_build_object('type', 'submit_application')
    ));
    RAISE EXCEPTION 'mortgage_smoke_expired_newest_esis_was_ignored';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'valid_esis_required_before_submission' THEN RAISE; END IF;
  END;

  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', gen_random_uuid(),
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'submit_application',
      'submittedAt', statement_timestamp()
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  IF current_revision <> 3 OR result_value ->> 'stage' <> 'submitted' THEN
    RAISE EXCEPTION 'mortgage_smoke_submit_failed: %', result_value;
  END IF;
  SELECT count(*) INTO actual_count FROM public.crm_mortgage_application_parties
  WHERE application_id = application_record.application_id;
  IF actual_count <> expected_client_count THEN
    RAISE EXCEPTION 'mortgage_smoke_frozen_parties_failed';
  END IF;

  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', gen_random_uuid(),
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'confirm_completeness',
      'confirmedAt', statement_timestamp()
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  due_at_value := (result_value ->> 'decisionDueAt')::timestamptz;
  IF current_revision <> 4 OR result_value ->> 'stage' <> 'under_review'
    OR due_at_value IS DISTINCT FROM private.crm_mortgage_decision_due_at(statement_timestamp())
  THEN
    RAISE EXCEPTION 'mortgage_smoke_completeness_failed: %', result_value;
  END IF;

  INSERT INTO public.crm_documents (
    organization_id, case_id, case_item_id, submission_id, document_type,
    name, status_code, storage_bucket, storage_path, received_at,
    metadata, uploaded_by_user_id, mime_type, size_bytes, sha256
  ) VALUES (
    application_record.organization_id,
    application_record.case_id,
    application_record.case_item_id,
    application_record.application_id,
    'mortgage_credit_decision',
    '0049-smoke-decision.pdf',
    'received',
    'crm-case-documents',
    application_record.organization_id::text || '/' || application_record.case_id::text || '/' || gen_random_uuid()::text || '.pdf',
    statement_timestamp(),
    jsonb_build_object('smoke', true),
    actor_id,
    'application/pdf',
    100,
    repeat('b', 64)
  ) RETURNING id INTO decision_document_id;

  decision_validation_context := public.get_crm_mortgage_document_validation_context(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    'credit_decision',
    'positive',
    due_at_value + interval '14 days'
  );
  negative_decision_validation_context :=
    public.get_crm_mortgage_document_validation_context(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id,
      'credit_decision',
      'negative',
      due_at_value + interval '14 days'
    );

  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'attach_artifact',
        'kind', 'credit_decision',
        'documentId', decision_document_id,
        'receivedAt', statement_timestamp(),
        'decisionOutcome', 'positive',
        'validUntil', due_at_value + interval '14 days'
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_missing_decision_ai_validation_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'accepted_mortgage_document_ai_validation_required' THEN RAISE; END IF;
  END;

  EXECUTE 'SET LOCAL ROLE openexpert_service';
  attempt_claim_result := public.claim_crm_mortgage_document_ai_attempt(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    actor_id,
    'credit_decision',
    repeat('b', 64),
    decision_validation_context ->> 'applicantContextSha256',
    decision_validation_context ->> 'bankContextSha256',
    decision_validation_context ->> 'expectationSha256',
    'vercel-ai-gateway',
    'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1',
    'positive',
    (decision_validation_context ->> 'validUntil')::timestamptz
  );
  IF attempt_claim_result ->> 'state' <> 'claimed' THEN
    RAISE EXCEPTION 'mortgage_smoke_positive_decision_attempt_not_claimed: %',
      attempt_claim_result;
  END IF;
  positive_decision_attempt_id := (attempt_claim_result ->> 'attemptId')::uuid;
  BEGIN
    PERFORM public.complete_crm_mortgage_document_ai_attempt(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id,
      actor_id,
      positive_decision_attempt_id,
      attempt_claim_result ->> 'leaseToken',
      'accepted',
      0.9900,
      ARRAY[]::text[],
      jsonb_set(
        accepted_decision_observations,
        '{checks,decisionOutcome}',
        to_jsonb('not_applicable'::text)
      )
    );
    RAISE EXCEPTION 'mortgage_smoke_decision_without_outcome_match_was_completed';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'invalid_mortgage_document_ai_attempt_result' THEN RAISE; END IF;
  END;

  negative_decision_attempt_id := pg_temp.complete_mortgage_ai_attempt(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    actor_id,
    'credit_decision',
    repeat('b', 64),
    negative_decision_validation_context,
    'negative',
    (negative_decision_validation_context ->> 'validUntil')::timestamptz,
    'accepted',
    0.9900,
    ARRAY[]::text[],
    accepted_decision_observations
  );

  INSERT INTO public.crm_mortgage_document_ai_validations (
    ai_attempt_id,
    organization_id, case_id, application_id, document_id, expected_kind,
    source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
    validated_bank_id, validated_offer_id, validated_decision_outcome,
    validated_valid_until, validated_loan_amount, validated_currency,
    verdict, provider, model, prompt_version, confidence,
    reason_codes, pii_free_observations
  ) VALUES (
    negative_decision_attempt_id,
    application_record.organization_id, application_record.case_id,
    application_record.application_id, decision_document_id, 'credit_decision', repeat('b', 64),
    negative_decision_validation_context ->> 'applicantContextSha256',
    negative_decision_validation_context ->> 'bankContextSha256',
    negative_decision_validation_context ->> 'expectationSha256',
    (negative_decision_validation_context ->> 'bankId')::uuid,
    (negative_decision_validation_context ->> 'offerId')::uuid,
    'negative',
    (negative_decision_validation_context ->> 'validUntil')::timestamptz,
    NULL,
    NULL,
    'accepted', 'vercel-ai-gateway', 'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1', 0.9900, ARRAY[]::text[],
    accepted_decision_observations
  );
  EXECUTE 'SET LOCAL ROLE openexpert_owner';
  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'attach_artifact',
        'kind', 'credit_decision',
        'documentId', decision_document_id,
        'receivedAt', statement_timestamp(),
        'decisionOutcome', 'positive',
        'validUntil', due_at_value + interval '14 days'
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_negative_validation_reused_as_positive';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_document_ai_validation_artifact_payload_mismatch' THEN RAISE; END IF;
  END;
  EXECUTE 'SET LOCAL ROLE openexpert_service';

  attempt_completion_result := public.complete_crm_mortgage_document_ai_attempt(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id,
    actor_id,
    positive_decision_attempt_id,
    attempt_claim_result ->> 'leaseToken',
    'accepted',
    0.9900,
    ARRAY[]::text[],
    accepted_decision_observations
  );
  IF attempt_completion_result ->> 'state' <> 'completed' THEN
    RAISE EXCEPTION 'mortgage_smoke_positive_decision_attempt_not_completed: %',
      attempt_completion_result;
  END IF;

  INSERT INTO public.crm_mortgage_document_ai_validations (
    ai_attempt_id,
    organization_id, case_id, application_id, document_id, expected_kind,
    source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
    validated_bank_id, validated_offer_id, validated_decision_outcome,
    validated_valid_until, validated_loan_amount, validated_currency,
    verdict, provider, model, prompt_version, confidence,
    reason_codes, pii_free_observations
  ) VALUES (
    positive_decision_attempt_id,
    application_record.organization_id, application_record.case_id,
    application_record.application_id, decision_document_id, 'credit_decision', repeat('b', 64),
    decision_validation_context ->> 'applicantContextSha256',
    decision_validation_context ->> 'bankContextSha256',
    decision_validation_context ->> 'expectationSha256',
    (decision_validation_context ->> 'bankId')::uuid,
    (decision_validation_context ->> 'offerId')::uuid,
    'positive',
    (decision_validation_context ->> 'validUntil')::timestamptz,
    NULL,
    NULL,
    'accepted', 'vercel-ai-gateway', 'gemini-3.5-flash-lite',
    'mortgage-document-validation-v1', 0.9900, ARRAY[]::text[],
    accepted_decision_observations
  ) RETURNING id INTO ai_validation_id_value;
  EXECUTE 'SET LOCAL ROLE openexpert_owner';

  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'attach_artifact',
        'kind', 'credit_decision',
        'documentId', decision_document_id,
        'receivedAt', statement_timestamp(),
        'decisionOutcome', 'positive',
        'validUntil', due_at_value + interval '15 days'
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_decision_validation_reused_with_other_valid_until';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_document_ai_validation_artifact_payload_mismatch' THEN RAISE; END IF;
  END;

  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', gen_random_uuid(),
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'attach_artifact',
      'kind', 'credit_decision',
      'documentId', decision_document_id,
      'receivedAt', statement_timestamp(),
      'decisionOutcome', 'positive',
      'validUntil', due_at_value + interval '14 days'
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  artifact_id_value := (result_value ->> 'artifactId')::uuid;
  IF result_value ->> 'stage' <> 'decision_received' THEN
    RAISE EXCEPTION 'mortgage_smoke_early_decision_attachment_failed: %', result_value;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_artifacts artifact
    WHERE artifact.id = artifact_id_value
      AND artifact.ai_validation_id = ai_validation_id_value
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_decision_ai_validation_pin_failed';
  END IF;

  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'deliver_artifact',
        'artifactId', artifact_id_value,
        'recipients', recipients
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_early_decision_delivery_without_consents_was_accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'early_credit_decision_delivery_requires_applicant_consent' THEN RAISE; END IF;
  END;

  FOR recipient IN
    SELECT party.client_id
    FROM public.crm_mortgage_application_parties party
    WHERE party.application_id = application_record.application_id
    ORDER BY party.client_id
  LOOP
    result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'record_early_decision_consent',
        'clientId', recipient.client_id,
        'decision', 'granted',
        'capturedAt', statement_timestamp(),
        'channel', 'other',
        'evidenceReference', '0049-smoke-consent'
      )
    ));
    current_revision := (result_value ->> 'revision')::bigint;
  END LOOP;

  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', gen_random_uuid(),
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'deliver_artifact',
      'artifactId', artifact_id_value,
      'recipients', recipients
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  IF result_value ->> 'stage' <> 'decision_delivered' THEN
    RAISE EXCEPTION 'mortgage_smoke_decision_failed: %', result_value;
  END IF;

  INSERT INTO public.crm_documents (
    organization_id, case_id, case_item_id, submission_id, document_type,
    name, status_code, storage_bucket, storage_path, received_at,
    metadata, uploaded_by_user_id, mime_type, size_bytes, sha256
  ) VALUES (
    application_record.organization_id,
    application_record.case_id,
    application_record.case_item_id,
    application_record.application_id,
    'mortgage_draft_credit_agreement',
    '0049-smoke-agreement.pdf',
    'received',
    'crm-case-documents',
    application_record.organization_id::text || '/' || application_record.case_id::text || '/' || gen_random_uuid()::text || '.pdf',
    statement_timestamp(),
    jsonb_build_object('smoke', true),
    actor_id,
    'application/pdf',
    100,
    repeat('c', 64)
  ) RETURNING id INTO agreement_document_id;

  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', gen_random_uuid(),
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'attach_artifact',
      'kind', 'draft_credit_agreement',
      'documentId', agreement_document_id,
      'receivedAt', statement_timestamp(),
      'deliveries', recipients
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  artifact_id_value := (result_value ->> 'artifactId')::uuid;
  IF result_value ->> 'stage' <> 'agreement_review' THEN
    RAISE EXCEPTION 'mortgage_smoke_agreement_failed: %', result_value;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_artifacts artifact
    WHERE artifact.id = artifact_id_value
      AND artifact.ai_validation_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'mortgage_smoke_agreement_ai_validation_was_pinned';
  END IF;

  SELECT client.id, client.display_name
  INTO mutated_client_id, original_display_name
  FROM public.crm_mortgage_application_parties party
  JOIN public.crm_clients client
    ON client.organization_id = party.organization_id
   AND client.id = party.client_id
  WHERE party.application_id = application_record.application_id
  ORDER BY client.id
  LIMIT 1;
  BEGIN
    UPDATE public.crm_clients client
    SET display_name = original_display_name || ' [stale before completion]'
    WHERE client.organization_id = application_record.organization_id
      AND client.id = mutated_client_id;
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'complete_application',
        'completedAt', statement_timestamp()
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_stale_applicant_context_completed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_artifact_ai_validation_context_stale' THEN RAISE; END IF;
  END;

  SELECT bank.id, bank.name INTO mutated_bank_id, original_bank_name
  FROM public.crm_case_bank_applications application
  JOIN public.mortgage_banks bank ON bank.id = application.bank_id
  WHERE application.organization_id = application_record.organization_id
    AND application.case_id = application_record.case_id
    AND application.submission_id = application_record.application_id;
  BEGIN
    UPDATE public.mortgage_banks bank
    SET name = original_bank_name || ' [stale before completion]'
    WHERE bank.id = mutated_bank_id;
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', actor_id,
      'commandId', gen_random_uuid(),
      'expectedRevision', current_revision,
      'command', jsonb_build_object(
        'type', 'complete_application',
        'completedAt', statement_timestamp()
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_stale_bank_context_completed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_artifact_ai_validation_context_stale' THEN RAISE; END IF;
  END;

  command_id_value := gen_random_uuid();
  result_value := public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', command_id_value,
    'expectedRevision', current_revision,
    'command', jsonb_build_object(
      'type', 'complete_application',
      'completedAt', statement_timestamp()
    )
  ));
  current_revision := (result_value ->> 'revision')::bigint;
  IF result_value ->> 'stage' <> 'ready_for_contract' THEN
    RAISE EXCEPTION 'mortgage_smoke_completion_failed: %', result_value;
  END IF;

  BEGIN
    PERFORM public.execute_crm_mortgage_application_command(jsonb_build_object(
      'organizationId', application_record.organization_id,
      'caseId', application_record.case_id,
      'applicationId', application_record.application_id,
      'actorUserId', gen_random_uuid(),
      'commandId', command_id_value,
      'expectedRevision', current_revision - 1,
      'command', jsonb_build_object(
        'type', 'complete_application',
        'completedAt', statement_timestamp()
      )
    ));
    RAISE EXCEPTION 'mortgage_smoke_unauthorized_idempotent_replay_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_command_actor_not_organization_member' THEN RAISE; END IF;
  END;

  IF public.execute_crm_mortgage_application_command(jsonb_build_object(
    'organizationId', application_record.organization_id,
    'caseId', application_record.case_id,
    'applicationId', application_record.application_id,
    'actorUserId', actor_id,
    'commandId', command_id_value,
    'expectedRevision', current_revision - 1,
    'command', jsonb_build_object(
      'type', 'complete_application',
      'completedAt', statement_timestamp()
    )
  )) ->> 'revision' <> current_revision::text THEN
    RAISE EXCEPTION 'mortgage_smoke_idempotent_replay_failed';
  END IF;

  SELECT count(*) INTO actual_count
  FROM public.crm_mortgage_application_events event
  WHERE event.application_id = application_record.application_id;
  IF actual_count <> current_revision + 1 THEN
    RAISE EXCEPTION 'mortgage_smoke_event_ledger_gap';
  END IF;
  BEGIN
    UPDATE public.crm_mortgage_application_events event
    SET payload = event.payload || jsonb_build_object('tampered', true)
    WHERE event.application_id = application_record.application_id
      AND event.aggregate_revision = 1;
    RAISE EXCEPTION 'mortgage_smoke_event_update_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_application_events_are_append_only' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM public.crm_mortgage_application_events event
    WHERE event.application_id = application_record.application_id
      AND event.aggregate_revision = 1;
    RAISE EXCEPTION 'mortgage_smoke_event_delete_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'mortgage_application_events_are_append_only' THEN RAISE; END IF;
  END;

  PERFORM set_config('app.user_id', actor_id::text, true);
  BEGIN
    UPDATE public.crm_clients client
    SET display_name = original_display_name || ' [stale before signing]'
    WHERE client.organization_id = application_record.organization_id
      AND client.id = mutated_client_id;
    PERFORM public.sign_crm_case_contract(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id
    );
    RAISE EXCEPTION 'mortgage_smoke_stale_applicant_context_signed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'mortgage_artifact_ai_validation_context_stale' THEN RAISE; END IF;
  END;

  SELECT membership.user_id INTO unauthorized_actor_id
  FROM public.organization_memberships membership
  JOIN public.crm_cases crm_case
    ON crm_case.organization_id = membership.organization_id
   AND crm_case.id = application_record.case_id
  JOIN public.crm_case_items item
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
    RAISE EXCEPTION 'mortgage_smoke_contract_non_manager_fixture_missing';
  END IF;
  PERFORM set_config('app.user_id', unauthorized_actor_id::text, true);
  BEGIN
    PERFORM public.sign_crm_case_contract(
      application_record.organization_id,
      application_record.case_id,
      application_record.application_id
    );
    RAISE EXCEPTION 'mortgage_smoke_non_manager_contract_sign_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'Mortgage case manager permission is required' THEN RAISE; END IF;
  END;

  PERFORM set_config('app.user_id', actor_id::text, true);
  SELECT * INTO contract_record
  FROM public.sign_crm_case_contract(
    application_record.organization_id,
    application_record.case_id,
    application_record.application_id
  );
  IF contract_record.application_id IS DISTINCT FROM application_record.application_id
    OR contract_record.signed_by_user_id IS DISTINCT FROM actor_id
  THEN
    RAISE EXCEPTION 'mortgage_smoke_contract_signing_failed';
  END IF;

  SELECT count(*) INTO actual_count
  FROM public.crm_mortgage_application_processes process
  WHERE process.application_id = application_record.application_id
    AND process.stage = 'completed'
    AND EXISTS (
      SELECT 1
      FROM public.crm_mortgage_application_events event
      WHERE event.application_id = process.application_id
        AND event.aggregate_revision = process.revision
        AND event.event_type = 'contract_signed'
    );
  IF actual_count <> 1 THEN
    RAISE EXCEPTION 'mortgage_smoke_phase1_contract_projection_failed';
  END IF;

  SELECT count(*) INTO actual_count
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = application_record.organization_id
    AND process.case_id = application_record.case_id
    AND process.application_id <> application_record.application_id
    AND process.stage <> 'closed';
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'mortgage_smoke_phase1_competing_processes_not_closed';
  END IF;

  SELECT count(*) INTO actual_count
  FROM public.crm_case_bank_applications application
  JOIN public.crm_item_submissions submission
    ON submission.organization_id = application.organization_id
   AND submission.id = application.submission_id
  WHERE application.organization_id = application_record.organization_id
    AND application.case_id = application_record.case_id
    AND application.submission_id <> application_record.application_id
    AND submission.status_code IN (
      'draft', 'wyslane', 'w_analizie', 'braki', 'zaakceptowane'
    );
  IF actual_count <> 0 THEN
    RAISE EXCEPTION 'mortgage_smoke_phase1_competing_legacy_status_not_closed';
  END IF;

END;
$mortgage_smoke$;
