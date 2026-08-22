-- Keep the exact 0087 security policy, but evaluate it in bounded stages.
-- On production's constrained Postgres tier the original monolithic SQL
-- function could exhaust the function-startup memory budget before evaluating
-- a single row.  Callers deliberately fail closed on any error, which made a
-- valid job look like canonical_link_invalid.  PL/pgSQL prevents SQL-function
-- inlining and the smaller statements bound planner memory without weakening
-- any predicate.

CREATE OR REPLACE FUNCTION private.bank_mail_agent_pdf_job_scope_is_valid(
  p_attachment_job_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  process_stage text;
  current_context jsonb;
  current_generation_context jsonb;
BEGIN
  IF p_attachment_job_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.id = p_attachment_job_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mail_bank_agent_intakes AS intake
    JOIN public.mortgage_bank_email_identities AS identity
      ON identity.id = job_row.bank_email_identity_id
     AND identity.is_active
     AND identity.auto_attach_pdf_enabled
     AND identity.sender_domain = 'openexpert.app'
     AND NOT identity.allow_subdomains
     AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
    JOIN public.mortgage_banks AS bank
      ON bank.id = identity.bank_id
     AND bank.slug = 'openexpert-bank'
     AND bank.is_mock
    JOIN public.mail_connections AS connection
      ON connection.organization_id = job_row.organization_id
     AND connection.owner_user_id = job_row.owner_user_id
     AND connection.id = job_row.connection_id
     AND connection.provider = 'google'
     AND connection.status = 'active'
    WHERE intake.id = job_row.intake_id
      AND intake.organization_id = job_row.organization_id
      AND intake.owner_user_id = job_row.owner_user_id
      AND intake.connection_id = job_row.connection_id
      AND intake.source_sha256 = job_row.intake_source_sha256
      AND intake.provider_message_id_sha256 = job_row.provider_message_id_sha256
      AND intake.identity_verdict = 'trusted_bank'
      AND intake.status = 'review_required'
      AND intake.finalized_at IS NOT NULL
      AND NOT intake.reply_to_mismatch
      AND intake.authentication_policy_applied = 'openexpert_mock_dkim_aligned'
      AND intake.dkim_aligned
      AND intake.bank_email_identity_id = job_row.bank_email_identity_id
  ) THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_thread_link_jobs AS link_job
    JOIN public.mail_context_thread_links AS link
      ON link.id = link_job.link_id
     AND link.organization_id = job_row.organization_id
     AND link.owner_user_id = job_row.owner_user_id
     AND link.connection_id = job_row.connection_id
     AND link.thread_key_hash = link_job.thread_key_hash
     AND link.case_id = job_row.case_id
     AND link.client_id IS NULL
    JOIN public.mail_bank_agent_match_proposals AS proposal
      ON proposal.id = job_row.proposal_id
     AND proposal.organization_id = job_row.organization_id
     AND proposal.owner_user_id = job_row.owner_user_id
     AND proposal.intake_id = job_row.intake_id
     AND proposal.analysis_run_id = job_row.analysis_run_id
     AND proposal.case_id = job_row.case_id
     AND proposal.application_id = job_row.application_id
     AND proposal.classification = 'strong_candidate'
     AND proposal.review_status = 'review_required'
     AND cardinality(proposal.contradiction_codes) = 0
    JOIN public.mail_bank_agent_analysis_runs AS run
      ON run.id = job_row.analysis_run_id
     AND run.organization_id = job_row.organization_id
     AND run.owner_user_id = job_row.owner_user_id
     AND run.intake_id = job_row.intake_id
     AND run.source_sha256 = job_row.intake_source_sha256
    JOIN public.mail_bank_agent_run_sessions AS binding
      ON binding.analysis_run_id = run.id
     AND binding.organization_id = job_row.organization_id
     AND binding.owner_user_id = job_row.owner_user_id
     AND binding.intake_id = job_row.intake_id
    WHERE link_job.id = job_row.thread_link_job_id
      AND link_job.intake_id = job_row.intake_id
      AND link_job.state = 'linked'
      AND link_job.proposal_id = job_row.proposal_id
      AND link_job.resolved_case_id = job_row.case_id
  ) THEN RETURN false; END IF;

  SELECT process.stage INTO process_stage
  FROM public.crm_case_bank_applications AS application
  JOIN public.mortgage_bank_email_identities AS identity
    ON identity.id = job_row.bank_email_identity_id
   AND application.bank_id = identity.bank_id
  JOIN public.crm_mortgage_application_processes AS process
    ON process.organization_id = job_row.organization_id
   AND process.case_id = job_row.case_id
   AND process.application_id = job_row.application_id
  JOIN public.crm_cases AS crm_case
    ON crm_case.organization_id = job_row.organization_id
   AND crm_case.id = job_row.case_id
   AND crm_case.owner_user_id = job_row.owner_user_id
  JOIN public.crm_item_submissions AS submission
    ON submission.organization_id = job_row.organization_id
   AND submission.id = job_row.application_id
   AND submission.external_reference = job_row.application_number
  WHERE application.organization_id = job_row.organization_id
    AND application.case_id = job_row.case_id
    AND application.submission_id = job_row.application_id;
  IF NOT FOUND THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_mock_bank_dispatches AS dispatch
    WHERE dispatch.id = job_row.dispatch_id
      AND dispatch.organization_id = job_row.organization_id
      AND dispatch.case_id = job_row.case_id
      AND dispatch.application_id = job_row.application_id
      AND dispatch.kind = 'esis'
      AND dispatch.status = 'sent'
      AND dispatch.generation = job_row.dispatch_generation
      AND dispatch.payload_id = job_row.dispatch_payload_id
      AND dispatch.generation_started_at = job_row.dispatch_generation_started_at
      AND dispatch.recipient_connection_id = job_row.connection_id
      AND dispatch.requested_by_user_id = job_row.owner_user_id
      AND dispatch.payload_ready_at IS NOT NULL
      AND dispatch.provider_message_id IS NOT NULL
      AND dispatch.generation_context_sha256 = job_row.generation_context_sha256
      AND dispatch.generation_applicant_context_sha256 = job_row.applicant_context_sha256
      AND dispatch.generation_bank_context_sha256 = job_row.bank_context_sha256
      AND dispatch.generation_expectation_sha256 = job_row.expectation_sha256
      AND dispatch.generation_valid_until = job_row.valid_until
      AND dispatch.manifest_storage_bucket = job_row.manifest_storage_bucket
      AND dispatch.manifest_storage_path = job_row.manifest_storage_path
      AND dispatch.manifest_sha256 = job_row.manifest_sha256
      AND dispatch.manifest_size_bytes = job_row.manifest_size_bytes
      AND dispatch.payload_sha256 = job_row.dispatch_payload_sha256
      AND dispatch.archive_sha256 = job_row.expected_archive_sha256
      AND dispatch.archive_size_bytes = job_row.expected_archive_size_bytes
  ) THEN RETURN false; END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.crm_client_people AS person
    WHERE person.organization_id = job_row.organization_id
      AND person.client_id = job_row.primary_client_id
      AND person.id = job_row.primary_person_id
      AND person.role = 'primary'
      AND person.updated_at = job_row.primary_person_updated_at
      AND person.pesel ~ '^[0-9]{11}$'
  ) THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM public.mail_bank_agent_match_proposals AS other_proposal
    WHERE other_proposal.intake_id = job_row.intake_id
      AND other_proposal.id <> job_row.proposal_id
  ) OR EXISTS (
    SELECT 1 FROM public.mail_bank_agent_analysis_runs AS other_run
    WHERE other_run.intake_id = job_row.intake_id
      AND other_run.id <> job_row.analysis_run_id
  ) THEN RETURN false; END IF;

  current_generation_context :=
    private.crm_mock_bank_generation_context(job_row.dispatch_id);
  IF current_generation_context ->> 'generationContextSha256'
    IS DISTINCT FROM job_row.generation_context_sha256
  THEN RETURN false; END IF;

  current_context := private.crm_mortgage_document_validation_context(
    job_row.organization_id,
    job_row.case_id,
    job_row.application_id,
    process_stage <> 'pre_application',
    'esis',
    NULL,
    job_row.valid_until
  );
  IF current_context ->> 'applicantContextSha256'
      IS DISTINCT FROM job_row.applicant_context_sha256
    OR current_context ->> 'bankContextSha256'
      IS DISTINCT FROM job_row.bank_context_sha256
    OR current_context ->> 'expectationSha256'
      IS DISTINCT FROM job_row.expectation_sha256
    OR (current_context ->> 'bankId')::uuid
      IS DISTINCT FROM job_row.validation_bank_id
    OR (current_context ->> 'offerId')::uuid
      IS DISTINCT FROM job_row.validation_offer_id
    OR nullif(current_context ->> 'loanAmount', '')::numeric
      IS DISTINCT FROM job_row.validation_loan_amount
    OR current_context ->> 'currency'
      IS DISTINCT FROM job_row.validation_currency
  THEN RETURN false; END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.bank_mail_agent_pdf_job_scope_is_valid(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.bank_mail_agent_pdf_job_scope_is_valid(uuid)
  TO openexpert_owner;

COMMENT ON FUNCTION private.bank_mail_agent_pdf_job_scope_is_valid(uuid) IS
  'Fail-closed exact 0087 PDF job scope validation evaluated in bounded stages to avoid SQL-function planner/inlining memory exhaustion.';
