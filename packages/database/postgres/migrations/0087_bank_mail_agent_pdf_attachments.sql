-- Durable, fail-closed import of the exact synthetic OpenExpert Bank ESIS
-- archive received by Gmail after a canonical strong bank-mail proposal has
-- been linked. Provider bytes, Gmail attachment tokens and PESEL values never
-- enter this ledger. The only secret crosses one narrowly-scoped RPC response
-- inside the trusted CRM worker and is re-resolved just in time.

ALTER TABLE public.mortgage_bank_email_identities
  ADD COLUMN auto_attach_pdf_enabled boolean DEFAULT false NOT NULL;

COMMENT ON COLUMN public.mortgage_bank_email_identities.auto_attach_pdf_enabled IS
  'Revocable kill switch for automatic bank-mail PDF import. 0087 enables it only for the exact synthetic OpenExpert Bank sender identity.';

UPDATE public.mortgage_bank_email_identities AS identity
SET auto_attach_pdf_enabled = true
FROM public.mortgage_banks AS bank
WHERE bank.id = identity.bank_id
  AND bank.slug = 'openexpert-bank'
  AND bank.is_mock
  AND identity.sender_domain = 'openexpert.app'
  AND NOT identity.allow_subdomains
  AND identity.authentication_policy = 'openexpert_mock_dkim_aligned';

DO $openexpert_pdf_identity_scope$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mortgage_bank_email_identities AS identity
    JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
    WHERE identity.auto_attach_pdf_enabled
      AND NOT (
        bank.slug = 'openexpert-bank'
        AND bank.is_mock
        AND identity.sender_domain = 'openexpert.app'
        AND NOT identity.allow_subdomains
        AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
      )
  ) THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_identity_scope_invalid'
      USING errcode = '23514';
  END IF;
END
$openexpert_pdf_identity_scope$;

-- A sent archive may only become a trusted generated artifact when the exact
-- application context used to render that generation was pinned in the same
-- transaction as the manifest/archive digests.  Legacy v1 generations keep
-- these columns NULL: they remain deliverable during rollout, but are never
-- eligible for automatic attachment.
ALTER TABLE public.crm_mock_bank_dispatches
  ADD COLUMN generation_context_sha256 text,
  ADD COLUMN generation_applicant_context_sha256 text,
  ADD COLUMN generation_bank_context_sha256 text,
  ADD COLUMN generation_expectation_sha256 text,
  ADD COLUMN generation_valid_until timestamptz,
  ADD COLUMN generation_context_pinned_at timestamptz;

ALTER TABLE public.crm_mock_bank_dispatches
  ADD CONSTRAINT crm_mock_bank_dispatches_generation_context_check CHECK (
    (
      generation_context_sha256 IS NULL
      AND generation_applicant_context_sha256 IS NULL
      AND generation_bank_context_sha256 IS NULL
      AND generation_expectation_sha256 IS NULL
      AND generation_valid_until IS NULL
      AND generation_context_pinned_at IS NULL
    ) OR (
      kind = 'esis'
      AND generation_context_sha256 ~ '^[0-9a-f]{64}$'
      AND generation_applicant_context_sha256 ~ '^[0-9a-f]{64}$'
      AND generation_bank_context_sha256 ~ '^[0-9a-f]{64}$'
      AND generation_expectation_sha256 ~ '^[0-9a-f]{64}$'
      AND generation_valid_until IS NOT NULL
      AND generation_context_pinned_at IS NOT NULL
      AND isfinite(generation_valid_until)
      AND isfinite(generation_context_pinned_at)
      AND payload_ready_at IS NOT NULL
    )
  );

COMMENT ON COLUMN public.crm_mock_bank_dispatches.generation_context_sha256 IS
  'SHA-256 of the versioned length-prefixed UTF-8 identity+document render context for one manifest v2 generation; NULL marks a rollout-compatible legacy generation that is not auto-attach eligible.';

CREATE FUNCTION private.crm_mock_bank_generation_context_part(
  p_key text,
  p_value text
) RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO ''
AS $$
  SELECT p_key || ':' ||
    pg_catalog.octet_length(pg_catalog.convert_to(p_value, 'UTF8'))::text ||
    ':' || p_value || pg_catalog.chr(10);
$$;

REVOKE ALL ON FUNCTION private.crm_mock_bank_generation_context_part(text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.crm_mock_bank_canonical_numeric(p_value numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO ''
AS $$
  SELECT pg_catalog.trim_scale(p_value)::text;
$$;

REVOKE ALL ON FUNCTION private.crm_mock_bank_canonical_numeric(numeric)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.crm_mock_bank_generation_context(
  p_dispatch_id uuid,
  p_payload_id uuid,
  p_generation integer,
  p_generation_started_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  dispatch_row public.crm_mock_bank_dispatches%rowtype;
  application_row public.crm_case_bank_applications%rowtype;
  offer_row public.crm_case_offer_snapshots%rowtype;
  submission_row public.crm_item_submissions%rowtype;
  process_row public.crm_mortgage_application_processes%rowtype;
  applicant_context jsonb;
  validation_context jsonb;
  applicant_value jsonb;
  applicant_ordinal bigint;
  issue_date_value date;
  valid_until_value timestamptz;
  loan_amount_value numeric;
  currency_value text;
  annual_interest_rate_value numeric;
  aprc_value numeric;
  monthly_installment_value numeric;
  term_months_value numeric;
  preimage text := '';
  context_sha256 text;
BEGIN
  IF p_dispatch_id IS NULL
    OR p_payload_id IS NULL
    OR p_generation IS NULL OR p_generation < 1
    OR p_generation_started_at IS NULL
    OR NOT isfinite(p_generation_started_at)
  THEN RETURN NULL; END IF;

  SELECT dispatch.* INTO dispatch_row
  FROM public.crm_mock_bank_dispatches AS dispatch
  WHERE dispatch.id = p_dispatch_id;
  IF NOT FOUND OR dispatch_row.kind <> 'esis' THEN RETURN NULL; END IF;

  SELECT application.* INTO application_row
  FROM public.crm_case_bank_applications AS application
  WHERE application.organization_id = dispatch_row.organization_id
    AND application.case_id = dispatch_row.case_id
    AND application.submission_id = dispatch_row.application_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT offer.* INTO offer_row
  FROM public.crm_case_offer_snapshots AS offer
  WHERE offer.organization_id = application_row.organization_id
    AND offer.case_id = application_row.case_id
    AND offer.id = application_row.offer_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT submission.* INTO submission_row
  FROM public.crm_item_submissions AS submission
  WHERE submission.organization_id = application_row.organization_id
    AND submission.id = application_row.submission_id;
  IF NOT FOUND
    OR submission_row.external_reference !~ '^OEB-[0-9]{8}-[0-9]{6}$'
  THEN RETURN NULL; END IF;

  SELECT process.* INTO process_row
  FROM public.crm_mortgage_application_processes AS process
  WHERE process.organization_id = application_row.organization_id
    AND process.case_id = application_row.case_id
    AND process.application_id = application_row.submission_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  issue_date_value :=
    (p_generation_started_at AT TIME ZONE 'Europe/Warsaw')::date;
  valid_until_value :=
    ((issue_date_value + 30)::text || 'T00:00:00Z')::timestamptz;
  applicant_context := private.crm_mortgage_applicant_context(
    dispatch_row.organization_id,
    dispatch_row.case_id,
    dispatch_row.application_id,
    process_row.stage <> 'pre_application'
  );
  validation_context := private.crm_mortgage_document_validation_context(
    dispatch_row.organization_id,
    dispatch_row.case_id,
    dispatch_row.application_id,
    process_row.stage <> 'pre_application',
    'esis',
    NULL,
    valid_until_value
  );

  loan_amount_value := coalesce(
    application_row.gross_loan_amount,
    application_row.net_loan_amount,
    offer_row.loan_amount
  );
  currency_value := upper(btrim(coalesce(
    application_row.scenario_snapshot ->> 'currency',
    application_row.scenario_snapshot -> 'property' ->> 'currency',
    application_row.calculation_snapshot ->> 'currency',
    offer_row.currency::text
  )));
  annual_interest_rate_value := nullif(
    offer_row.catalog_snapshot -> 'version' ->> 'fixed_rate_pct', ''
  )::numeric;
  aprc_value := coalesce(
    offer_row.representative_apr_pct,
    nullif(
      offer_row.catalog_snapshot -> 'version' ->> 'representative_apr_pct', ''
    )::numeric
  );
  monthly_installment_value := coalesce(
    application_row.first_installment,
    offer_row.first_installment
  );
  term_months_value :=
    nullif(offer_row.scenario_snapshot ->> 'years', '')::numeric * 12;

  IF jsonb_typeof(applicant_context -> 'applicants') <> 'array'
    OR jsonb_array_length(applicant_context -> 'applicants') NOT BETWEEN 1 AND 20
    OR loan_amount_value IS NULL OR loan_amount_value <= 0
    OR currency_value !~ '^[A-Z]{3}$'
    OR annual_interest_rate_value IS NULL OR annual_interest_rate_value <= 0
    OR aprc_value IS NULL OR aprc_value <= 0
    OR monthly_installment_value IS NULL OR monthly_installment_value <= 0
    OR term_months_value IS NULL OR term_months_value <= 0
    OR term_months_value <> trunc(term_months_value)
  THEN RETURN NULL; END IF;

  -- Canonical preimage contract for manifest v2.  Each UTF-8 value is encoded
  -- as "key:byteLength:value\n".  Numeric values use PostgreSQL trim_scale;
  -- timestamps are Warsaw-derived date-only values or UTC milliseconds.
  preimage := private.crm_mock_bank_generation_context_part(
      'domain', 'openexpert-mock-bank-generation-context-v1'
    ) || private.crm_mock_bank_generation_context_part(
      'identity.dispatchId', dispatch_row.id::text
    ) || private.crm_mock_bank_generation_context_part(
      'identity.payloadId', p_payload_id::text
    ) || private.crm_mock_bank_generation_context_part(
      'identity.applicationId', dispatch_row.application_id::text
    ) || private.crm_mock_bank_generation_context_part(
      'identity.applicationNumber', submission_row.external_reference
    ) || private.crm_mock_bank_generation_context_part(
      'identity.kind', dispatch_row.kind
    ) || private.crm_mock_bank_generation_context_part(
      'identity.generation', p_generation::text
    ) || private.crm_mock_bank_generation_context_part(
      'identity.generationStartedAt',
      to_char(
        date_trunc('milliseconds', p_generation_started_at)
          AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    ) || private.crm_mock_bank_generation_context_part(
      'document.pdfFileName',
      submission_row.external_reference || '-formularz-ESIS.pdf'
    ) || private.crm_mock_bank_generation_context_part(
      'document.issueDate', issue_date_value::text
    ) || private.crm_mock_bank_generation_context_part(
      'document.validUntil', (valid_until_value AT TIME ZONE 'UTC')::date::text
    ) || private.crm_mock_bank_generation_context_part(
      'document.decisionOutcome', 'null'
    ) || private.crm_mock_bank_generation_context_part(
      'document.applicantCount',
      jsonb_array_length(applicant_context -> 'applicants')::text
    );

  FOR applicant_value, applicant_ordinal IN
    SELECT applicant.value, applicant.ordinality
    FROM jsonb_array_elements(applicant_context -> 'applicants')
      WITH ORDINALITY AS applicant(value, ordinality)
    ORDER BY applicant.ordinality
  LOOP
    IF nullif(applicant_value ->> 'displayName', '') IS NULL THEN RETURN NULL; END IF;
    preimage := preimage || private.crm_mock_bank_generation_context_part(
      'document.applicantNames.' || (applicant_ordinal - 1)::text,
      applicant_value ->> 'displayName'
    );
  END LOOP;

  preimage := preimage || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.loanAmount',
      private.crm_mock_bank_canonical_numeric(loan_amount_value)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.currency', currency_value
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.annualInterestRate',
      private.crm_mock_bank_canonical_numeric(annual_interest_rate_value)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.aprc',
      private.crm_mock_bank_canonical_numeric(aprc_value)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.monthlyInstallment',
      private.crm_mock_bank_canonical_numeric(monthly_installment_value)
    ) || private.crm_mock_bank_generation_context_part(
      'document.financialTerms.termMonths',
      private.crm_mock_bank_canonical_numeric(term_months_value)
    );

  context_sha256 := encode(
    extensions.digest(convert_to(preimage, 'UTF8'), 'sha256'), 'hex'
  );
  RETURN jsonb_build_object(
    'generationContextSha256', context_sha256,
    'applicantContextSha256',
      validation_context ->> 'applicantContextSha256',
    'bankContextSha256', validation_context ->> 'bankContextSha256',
    'expectationSha256', validation_context ->> 'expectationSha256',
    'validUntil', valid_until_value
  );
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION private.crm_mock_bank_generation_context(
  uuid, uuid, integer, timestamptz
) IS
  'Recomputes the exact manifest-v2 identity+document render hash and canonical mortgage validation hashes from current rows; returns no applicant values or PESEL.';

REVOKE ALL ON FUNCTION private.crm_mock_bank_generation_context(
  uuid, uuid, integer, timestamptz
)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.crm_mock_bank_generation_context(p_dispatch_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT private.crm_mock_bank_generation_context(
    dispatch.id,
    dispatch.payload_id,
    dispatch.generation,
    dispatch.generation_started_at
  )
  FROM public.crm_mock_bank_dispatches AS dispatch
  WHERE dispatch.id = p_dispatch_id;
$$;

REVOKE ALL ON FUNCTION private.crm_mock_bank_generation_context(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- A renderer can persist its private objects and then lose a serialization
-- race to a business-context edit before payload commit.  The existing
-- cached reserve RPC retries failed dispatches in-place, which is unsafe for
-- this one error: different bytes must never reuse the old object paths.
-- Rotate only an uncommitted, explicitly-finalized context mismatch.  The
-- normal reserve function has already authenticated the member, checked the
-- request/recipient scope, locked the dispatch, and installed the fresh
-- five-minute lease in NEW.
CREATE FUNCTION private.rotate_crm_mock_bank_generation_context_retry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  next_generation integer;
  next_payload_id uuid;
BEGIN
  IF OLD.status = 'failed'
    AND OLD.error_code IN (
      'generation_context_changed',
      'uncommitted_payload_invalid'
    )
    AND OLD.payload_ready_at IS NULL
    AND NEW.status = 'pending'
    AND NEW.request_id IS DISTINCT FROM OLD.request_id
  THEN
    -- The old paths may already contain the losing worker's bytes, while the
    -- database intentionally has no trusted digest for them.  A NULL digest
    -- is an explicit supported cleanup shape; paths are scoped and are never
    -- assigned to the new generation.
    INSERT INTO public.crm_mock_bank_payload_cleanup_jobs (
      organization_id, dispatch_id, payload_id, generation,
      storage_bucket, storage_path, object_kind, object_sha256, available_at
    ) VALUES
      (
        OLD.organization_id, OLD.id, OLD.payload_id, OLD.generation,
        OLD.manifest_storage_bucket, OLD.manifest_storage_path, 'manifest',
        NULL, clock_timestamp()
      ),
      (
        OLD.organization_id, OLD.id, OLD.payload_id, OLD.generation,
        OLD.archive_storage_bucket, OLD.archive_storage_path, 'archive',
        NULL, clock_timestamp()
      )
    ON CONFLICT (storage_bucket, storage_path) DO NOTHING;

    next_generation := OLD.generation + 1;
    next_payload_id := gen_random_uuid();
    NEW.generation := next_generation;
    NEW.generation_started_at := NEW.last_attempt_at;
    NEW.attempts := 1;
    NEW.payload_id := next_payload_id;
    NEW.manifest_storage_path := NEW.organization_id::text || '/' ||
      NEW.application_id::text || '/' || NEW.id::text || '/' || NEW.kind ||
      '/generation-' || next_generation::text || '-' ||
      next_payload_id::text || '.json';
    NEW.archive_storage_path := NEW.organization_id::text || '/' ||
      NEW.application_id::text || '/' || NEW.id::text || '/' || NEW.kind ||
      '/generation-' || next_generation::text || '-' ||
      next_payload_id::text || '.zip';
    NEW.manifest_sha256 := NULL;
    NEW.manifest_size_bytes := NULL;
    NEW.archive_sha256 := NULL;
    NEW.archive_size_bytes := NULL;
    NEW.payload_sha256 := NULL;
    NEW.payload_ready_at := NULL;
    NEW.provider_message_id := NULL;
    NEW.error_code := NULL;
    NEW.sent_at := NULL;
    NEW.failed_at := NULL;
    NEW.generation_context_sha256 := NULL;
    NEW.generation_applicant_context_sha256 := NULL;
    NEW.generation_bank_context_sha256 := NULL;
    NEW.generation_expectation_sha256 := NULL;
    NEW.generation_valid_until := NULL;
    NEW.generation_context_pinned_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER crm_mock_bank_dispatches_00_rotate_generation_context_retry
  BEFORE UPDATE ON public.crm_mock_bank_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION private.rotate_crm_mock_bank_generation_context_retry();

REVOKE ALL ON FUNCTION private.rotate_crm_mock_bank_generation_context_retry()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.pin_crm_mock_bank_generation_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb := '{}'::jsonb;
  generation_context jsonb;
  has_generation_claim boolean := false;
  generation_reset boolean := false;
  pin_now timestamptz := clock_timestamp();
BEGIN
  -- Every new business generation starts unpinned.  An ordinary retry keeps
  -- the exact prior payload identity and therefore keeps the existing pin.
  IF NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.payload_id IS DISTINCT FROM OLD.payload_id
    OR (OLD.payload_ready_at IS NOT NULL AND NEW.payload_ready_at IS NULL)
  THEN
    generation_reset := true;
    NEW.generation_context_sha256 := NULL;
    NEW.generation_applicant_context_sha256 := NULL;
    NEW.generation_bank_context_sha256 := NULL;
    NEW.generation_expectation_sha256 := NULL;
    NEW.generation_valid_until := NULL;
    NEW.generation_context_pinned_at := NULL;
  END IF;

  IF OLD.payload_ready_at IS NULL
    AND NEW.payload_ready_at IS NOT NULL
    AND NEW.kind = 'esis'
  THEN
    BEGIN
      jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'crm_mock_bank_generation_context_claims_invalid'
        USING errcode = '42501';
    END;
    has_generation_claim :=
      jwt_claims ->> 'source' = 'openexpert-mock-bank-generation-context-v1'
      OR jwt_claims ?| ARRAY[
        'generationContextSha256', 'applicantContextSha256',
        'bankContextSha256', 'expectationSha256', 'validUntil',
        'manifestSha256', 'manifestSizeBytes', 'archiveSha256',
        'archiveSizeBytes', 'payloadSha256'
      ];

    -- Migration-first/rollback bridge: a legacy writer with no generation
    -- claims may still send mail, but its NULL-pinned generation is never
    -- eligible for automatic import.  Any partial/custom attempt fails closed.
    IF has_generation_claim THEN
      -- Use the tuple being committed, not a one-argument lookup of the
      -- still-old row.  This keeps a reserve/commit in one transaction and a
      -- rotated retry generation deterministic under the row lock.
      generation_context := private.crm_mock_bank_generation_context(
        NEW.id,
        NEW.payload_id,
        NEW.generation,
        NEW.generation_started_at
      );
      IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
        OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
        OR jwt_claims ->> 'source'
          IS DISTINCT FROM 'openexpert-mock-bank-generation-context-v1'
        OR jwt_claims ->> 'serviceId'
          IS DISTINCT FROM 'openexpert-crm-mock-bank'
        OR jwt_claims ->> 'preset'
          IS DISTINCT FROM 'mock-bank-payload-commit'
        OR jwt_claims ->> 'organizationId'
          IS DISTINCT FROM NEW.organization_id::text
        OR jwt_claims ->> 'caseId' IS DISTINCT FROM NEW.case_id::text
        OR jwt_claims ->> 'applicationId'
          IS DISTINCT FROM NEW.application_id::text
        OR jwt_claims ->> 'kind' IS DISTINCT FROM NEW.kind
        OR jwt_claims ->> 'requestId' IS DISTINCT FROM NEW.request_id::text
        OR jwt_claims ->> 'recipientConnectionId'
          IS DISTINCT FROM NEW.recipient_connection_id::text
        OR jwt_claims ->> 'dispatchId' IS DISTINCT FROM NEW.id::text
        OR jwt_claims ->> 'generation' IS DISTINCT FROM NEW.generation::text
        OR jwt_claims ->> 'manifestSha256'
          IS DISTINCT FROM NEW.manifest_sha256
        OR jwt_claims ->> 'manifestSizeBytes'
          IS DISTINCT FROM NEW.manifest_size_bytes::text
        OR jwt_claims ->> 'archiveSha256'
          IS DISTINCT FROM NEW.archive_sha256
        OR jwt_claims ->> 'archiveSizeBytes'
          IS DISTINCT FROM NEW.archive_size_bytes::text
        OR jwt_claims ->> 'payloadSha256'
          IS DISTINCT FROM NEW.payload_sha256
        OR jwt_claims ->> 'generationContextSha256'
          !~ '^[0-9a-f]{64}$'
        OR jwt_claims ->> 'applicantContextSha256'
          !~ '^[0-9a-f]{64}$'
        OR jwt_claims ->> 'bankContextSha256'
          !~ '^[0-9a-f]{64}$'
        OR jwt_claims ->> 'expectationSha256'
          !~ '^[0-9a-f]{64}$'
        OR jwt_claims ->> 'validUntil' !~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T00:00:00[.]000Z$'
      THEN
        RAISE EXCEPTION 'crm_mock_bank_generation_context_claims_invalid'
          USING errcode = '42501';
      END IF;

      -- A fully scoped, signed writer may still have rendered snapshot A
      -- while a business row changed to B before this commit acquired its
      -- locks.  This is a retryable serialization conflict, not an auth
      -- failure.  The caller finalizes this uncommitted generation with the
      -- controlled error and the next ordinary reserve rotates paths.
      IF generation_context IS NULL
        OR jwt_claims ->> 'generationContextSha256'
          IS DISTINCT FROM generation_context ->> 'generationContextSha256'
        OR jwt_claims ->> 'applicantContextSha256'
          IS DISTINCT FROM generation_context ->> 'applicantContextSha256'
        OR jwt_claims ->> 'bankContextSha256'
          IS DISTINCT FROM generation_context ->> 'bankContextSha256'
        OR jwt_claims ->> 'expectationSha256'
          IS DISTINCT FROM generation_context ->> 'expectationSha256'
        OR jwt_claims ->> 'validUntil' IS DISTINCT FROM to_char(
          (generation_context ->> 'validUntil')::timestamptz
            AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
      THEN
        RAISE EXCEPTION 'crm_mock_bank_generation_context_changed'
          USING errcode = '40001';
      END IF;

      NEW.generation_context_sha256 :=
        generation_context ->> 'generationContextSha256';
      NEW.generation_applicant_context_sha256 :=
        generation_context ->> 'applicantContextSha256';
      NEW.generation_bank_context_sha256 :=
        generation_context ->> 'bankContextSha256';
      NEW.generation_expectation_sha256 :=
        generation_context ->> 'expectationSha256';
      NEW.generation_valid_until :=
        (generation_context ->> 'validUntil')::timestamptz;
      NEW.generation_context_pinned_at := pin_now;
    END IF;
  ELSIF NOT generation_reset AND (
    NEW.generation_context_sha256
      IS DISTINCT FROM OLD.generation_context_sha256
    OR NEW.generation_applicant_context_sha256
      IS DISTINCT FROM OLD.generation_applicant_context_sha256
    OR NEW.generation_bank_context_sha256
      IS DISTINCT FROM OLD.generation_bank_context_sha256
    OR NEW.generation_expectation_sha256
      IS DISTINCT FROM OLD.generation_expectation_sha256
    OR NEW.generation_valid_until IS DISTINCT FROM OLD.generation_valid_until
    OR NEW.generation_context_pinned_at
      IS DISTINCT FROM OLD.generation_context_pinned_at
  )
  THEN
    RAISE EXCEPTION 'crm_mock_bank_generation_context_is_immutable'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'crm_mock_bank_generation_context_claims_invalid'
      USING errcode = '42501';
END;
$$;

CREATE TRIGGER crm_mock_bank_dispatches_pin_generation_context
  BEFORE UPDATE ON public.crm_mock_bank_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION private.pin_crm_mock_bank_generation_context();

REVOKE ALL ON FUNCTION private.pin_crm_mock_bank_generation_context()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Keep the small, bounded v2 manifest long enough for the inbound worker to
-- authenticate the Gmail ZIP against the exact full-payload digest.  The ZIP
-- object itself is still deleted immediately after delivery; Gmail is its
-- authoritative inbound carrier.  Legacy/v1 manifests retain old semantics.
CREATE OR REPLACE FUNCTION private.enqueue_crm_mock_bank_payload_cleanup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  cleanup_now timestamptz := clock_timestamp();
  manifest_available_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NOT (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent')
  THEN
    RETURN NEW;
  END IF;

  manifest_available_at := CASE
    WHEN TG_OP = 'UPDATE'
      AND OLD.kind = 'esis'
      AND OLD.generation_context_sha256 ~ '^[0-9a-f]{64}$'
    THEN cleanup_now + interval '7 days'
    ELSE cleanup_now
  END;

  INSERT INTO public.crm_mock_bank_payload_cleanup_jobs (
    organization_id, dispatch_id, payload_id, generation,
    storage_bucket, storage_path, object_kind, object_sha256, available_at
  ) VALUES
    (
      OLD.organization_id, OLD.id, OLD.payload_id, OLD.generation,
      OLD.manifest_storage_bucket, OLD.manifest_storage_path, 'manifest',
      OLD.manifest_sha256, manifest_available_at
    ),
    (
      OLD.organization_id, OLD.id, OLD.payload_id, OLD.generation,
      OLD.archive_storage_bucket, OLD.archive_storage_path, 'archive',
      OLD.archive_sha256, cleanup_now
    )
  ON CONFLICT (storage_bucket, storage_path) DO NOTHING;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_crm_mock_bank_payload_cleanup()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

ALTER TABLE public.mail_bank_agent_attachments
  ADD COLUMN inspection_policy text,
  ADD COLUMN inspection_method text;

ALTER TABLE public.mail_bank_agent_attachments
  ADD CONSTRAINT mail_bank_agent_attachments_inspection_check CHECK (
    (inspection_policy IS NULL AND inspection_method IS NULL)
    OR (
      inspection_policy = 'openexpert_sent_artifact_sha256_v1'
      AND inspection_method = 'exact_dispatch_sha256_and_bounded_pdf_v1'
    )
  );

COMMENT ON COLUMN public.mail_bank_agent_attachments.inspection_policy IS
  'Pinned meaning of scan_status for the OpenExpert mock path; clean means exact sent-artifact digest plus bounded ZIP/PDF structural checks, not a generic malware verdict.';

CREATE TABLE private.mail_bank_agent_pdf_attachment_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  thread_link_job_id uuid NOT NULL,
  thread_reference text NOT NULL,
  proposal_id uuid NOT NULL,
  analysis_run_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  bank_email_identity_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  dispatch_generation integer NOT NULL,
  dispatch_payload_id uuid NOT NULL,
  dispatch_generation_started_at timestamptz NOT NULL,
  generation_context_sha256 text NOT NULL,
  manifest_storage_bucket text NOT NULL,
  manifest_storage_path text NOT NULL,
  manifest_sha256 text NOT NULL,
  manifest_size_bytes integer NOT NULL,
  dispatch_payload_sha256 text NOT NULL,
  intake_source_sha256 text NOT NULL,
  provider_message_id_sha256 text NOT NULL,
  expected_archive_sha256 text NOT NULL,
  expected_archive_size_bytes integer NOT NULL,
  application_number text NOT NULL,
  attachment_file_name text NOT NULL,
  pdf_file_name text NOT NULL,
  issue_date date NOT NULL,
  valid_until timestamptz NOT NULL,
  primary_client_id uuid NOT NULL,
  primary_person_id uuid NOT NULL,
  primary_person_updated_at timestamptz NOT NULL,
  state text DEFAULT 'queued' NOT NULL,
  resolution_code text,
  attempt_count integer DEFAULT 0 NOT NULL,
  available_at timestamptz DEFAULT now() NOT NULL,
  locked_by text,
  lease_token_sha256 text,
  lease_expires_at timestamptz,
  attachment_id uuid,
  attachment_ordinal smallint,
  attachment_token_sha256 text,
  observed_archive_sha256 text,
  observed_archive_size_bytes bigint,
  pdf_sha256 text,
  pdf_size_bytes bigint,
  applicant_context_sha256 text NOT NULL,
  bank_context_sha256 text NOT NULL,
  expectation_sha256 text NOT NULL,
  validation_bank_id uuid NOT NULL,
  validation_offer_id uuid NOT NULL,
  validation_loan_amount numeric(14,2),
  validation_currency text,
  cleanup_job_id uuid,
  storage_bucket text,
  storage_path text,
  document_id uuid,
  trusted_validation_id uuid,
  artifact_id uuid,
  command_event_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_intake_key UNIQUE (intake_id),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_scope_id_key UNIQUE (
    organization_id, owner_user_id, connection_id, intake_id, id
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_application_id_key UNIQUE (
    organization_id, case_id, application_id, id
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_state_check CHECK (
    state IN (
      'queued', 'downloading', 'verifying_source', 'unlocking', 'validating',
      'importing', 'attached', 'review_required', 'retrying', 'failed', 'conflict'
    )
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_resolution_check CHECK (
    resolution_code IS NULL OR resolution_code IN (
      'openexpert_mock_esis_attached',
      'provider_unavailable', 'storage_unavailable', 'processing_timeout',
      'existing_esis_requires_review',
      'source_archive_mismatch', 'dispatch_generation_changed',
      'storage_object_conflict', 'attachment_scope_conflict',
      'policy_disabled', 'canonical_link_invalid',
      'attachment_not_found', 'attachment_ambiguous',
      'archive_invalid', 'archive_unlock_failed', 'pdf_invalid',
      'inspection_failed',
      'retry_limit_reached', 'processing_failed'
    )
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_hash_check CHECK (
    intake_source_sha256 ~ '^[0-9a-f]{64}$'
    AND provider_message_id_sha256 ~ '^[0-9a-f]{64}$'
    AND expected_archive_sha256 ~ '^[0-9a-f]{64}$'
    AND generation_context_sha256 ~ '^[0-9a-f]{64}$'
    AND manifest_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch_payload_sha256 ~ '^[0-9a-f]{64}$'
    AND (lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[0-9a-f]{64}$')
    AND (attachment_token_sha256 IS NULL OR attachment_token_sha256 ~ '^[0-9a-f]{64}$')
    AND (observed_archive_sha256 IS NULL OR observed_archive_sha256 ~ '^[0-9a-f]{64}$')
    AND (pdf_sha256 IS NULL OR pdf_sha256 ~ '^[0-9a-f]{64}$')
    AND applicant_context_sha256 ~ '^[0-9a-f]{64}$'
    AND bank_context_sha256 ~ '^[0-9a-f]{64}$'
    AND expectation_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_source_check CHECK (
    expected_archive_size_bytes BETWEEN 1 AND 5242880
    AND manifest_storage_bucket = 'crm-mock-bank-outbox'
    AND manifest_storage_path LIKE organization_id::text || '/%'
    AND char_length(manifest_storage_path) <= 1024
    AND manifest_storage_path !~ '[[:cntrl:]]'
    AND manifest_size_bytes BETWEEN 1 AND 5242880
    AND dispatch_generation >= 1
    AND application_number ~ '^OEB-[0-9]{8}-[0-9]{6}$'
    AND attachment_file_name = application_number || '-formularz-ESIS.zip'
    AND pdf_file_name = application_number || '-formularz-ESIS.pdf'
    AND valid_until = ((issue_date + 30)::text || 'T00:00:00Z')::timestamptz
    AND thread_reference = btrim(thread_reference)
    AND char_length(thread_reference) BETWEEN 1 AND 4096
    AND thread_reference !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_attempt_check CHECK (
    attempt_count BETWEEN 0 AND 5
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_worker_check CHECK (
    locked_by IS NULL OR (
      locked_by = btrim(locked_by)
      AND char_length(locked_by) BETWEEN 1 AND 200
      AND locked_by ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    )
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_lease_check CHECK (
    (
      state IN ('downloading', 'verifying_source', 'unlocking', 'validating', 'importing')
      AND nullif(btrim(locked_by), '') IS NOT NULL
      AND lease_token_sha256 IS NOT NULL
      AND lease_expires_at IS NOT NULL
    ) OR (
      state NOT IN ('downloading', 'verifying_source', 'unlocking', 'validating', 'importing')
      AND locked_by IS NULL
      AND lease_token_sha256 IS NULL
      AND lease_expires_at IS NULL
    )
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_result_shape_check CHECK (
    (
      state IN ('queued', 'downloading', 'verifying_source', 'unlocking', 'validating', 'importing')
      AND resolution_code IS NULL
      AND completed_at IS NULL
    ) OR (
      state = 'retrying'
      AND resolution_code IN (
        'provider_unavailable', 'storage_unavailable', 'processing_timeout'
      )
      AND completed_at IS NULL
    ) OR (
      state = 'attached'
      AND resolution_code = 'openexpert_mock_esis_attached'
      AND document_id IS NOT NULL
      AND trusted_validation_id IS NOT NULL
      AND artifact_id IS NOT NULL
      AND command_event_id IS NOT NULL
      AND completed_at IS NOT NULL
    ) OR (
      state = 'review_required'
      AND resolution_code IN (
        'existing_esis_requires_review'
      )
      AND completed_at IS NOT NULL
    ) OR (
      state = 'conflict'
      AND resolution_code IN (
        'source_archive_mismatch', 'dispatch_generation_changed',
        'storage_object_conflict', 'attachment_scope_conflict'
      )
      AND completed_at IS NOT NULL
    ) OR (
      state = 'failed'
      AND resolution_code IN (
        'policy_disabled', 'canonical_link_invalid',
        'attachment_not_found', 'attachment_ambiguous',
        'archive_invalid', 'archive_unlock_failed', 'pdf_invalid',
        'inspection_failed',
        'retry_limit_reached', 'processing_failed'
      )
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_attachment_shape_check CHECK (
    (attachment_id IS NULL AND attachment_ordinal IS NULL
      AND attachment_token_sha256 IS NULL
      AND observed_archive_sha256 IS NULL
      AND observed_archive_size_bytes IS NULL)
    OR (attachment_id IS NOT NULL AND attachment_ordinal BETWEEN 0 AND 19
      AND attachment_token_sha256 IS NOT NULL
      AND observed_archive_sha256 IS NOT NULL
      AND observed_archive_size_bytes BETWEEN 1 AND 5242880)
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_pdf_shape_check CHECK (
    (pdf_sha256 IS NULL AND pdf_size_bytes IS NULL)
    OR (pdf_sha256 IS NOT NULL AND pdf_size_bytes BETWEEN 1 AND 4194304)
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_time_check CHECK (
    isfinite(dispatch_generation_started_at)
    AND isfinite(primary_person_updated_at)
    AND isfinite(valid_until)
    AND isfinite(available_at)
    AND isfinite(created_at)
    AND isfinite(updated_at)
    AND (lease_expires_at IS NULL OR isfinite(lease_expires_at))
    AND (started_at IS NULL OR isfinite(started_at))
    AND (completed_at IS NULL OR isfinite(completed_at))
    AND updated_at >= created_at
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_storage_shape_check CHECK (
    (cleanup_job_id IS NULL AND storage_bucket IS NULL AND storage_path IS NULL)
    OR (cleanup_job_id IS NOT NULL AND storage_bucket = 'crm-case-documents'
      AND storage_path LIKE organization_id::text || '/' || case_id::text || '/%')
  ),
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_connection_fk FOREIGN KEY (
    organization_id, owner_user_id, connection_id
  ) REFERENCES public.mail_connections (organization_id, owner_user_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_intake_fk FOREIGN KEY (
    organization_id, owner_user_id, intake_id
  ) REFERENCES public.mail_bank_agent_intakes (organization_id, owner_user_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_thread_job_fk
    FOREIGN KEY (thread_link_job_id)
    REFERENCES private.mail_bank_agent_thread_link_jobs (id) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_proposal_fk FOREIGN KEY (
    organization_id, owner_user_id, intake_id, proposal_id
  ) REFERENCES public.mail_bank_agent_match_proposals (
    organization_id, owner_user_id, intake_id, id
  ) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_run_fk FOREIGN KEY (
    organization_id, owner_user_id, intake_id, analysis_run_id
  ) REFERENCES public.mail_bank_agent_analysis_runs (
    organization_id, owner_user_id, intake_id, id
  ) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_application_fk FOREIGN KEY (
    organization_id, case_id, application_id
  ) REFERENCES public.crm_case_bank_applications (
    organization_id, case_id, submission_id
  ) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_identity_fk
    FOREIGN KEY (bank_email_identity_id)
    REFERENCES public.mortgage_bank_email_identities (id) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_dispatch_fk
    FOREIGN KEY (dispatch_id)
    REFERENCES public.crm_mock_bank_dispatches (id) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_person_fk FOREIGN KEY (
    organization_id, primary_client_id, primary_person_id
  ) REFERENCES public.crm_client_people (organization_id, client_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_attachment_fk FOREIGN KEY (
    organization_id, owner_user_id, intake_id, attachment_id
  ) REFERENCES public.mail_bank_agent_attachments (
    organization_id, owner_user_id, intake_id, id
  ) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_attachment_jobs_cleanup_fk
    FOREIGN KEY (cleanup_job_id)
    REFERENCES public.crm_document_storage_cleanup_jobs (id) ON DELETE RESTRICT
);

CREATE INDEX mail_bank_agent_pdf_attachment_jobs_claim_idx
  ON private.mail_bank_agent_pdf_attachment_jobs (available_at, created_at, id)
  WHERE state IN (
    'queued', 'retrying', 'downloading', 'verifying_source',
    'unlocking', 'validating', 'importing'
  );

CREATE INDEX mail_bank_agent_pdf_attachment_jobs_application_idx
  ON private.mail_bank_agent_pdf_attachment_jobs (
    organization_id, case_id, application_id, state
  );

CREATE TRIGGER mail_bank_agent_pdf_attachment_jobs_set_updated_at
  BEFORE UPDATE ON private.mail_bank_agent_pdf_attachment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE private.mail_bank_agent_pdf_attachment_jobs IS
  'Private immutable-scope lifecycle and provenance root for one exact synthetic OpenExpert Bank ESIS import. It stores no provider token, message bytes, PESEL or PESEL-derived digest.';

REVOKE ALL ON TABLE private.mail_bank_agent_pdf_attachment_jobs
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE ON TABLE private.mail_bank_agent_pdf_attachment_jobs
  TO openexpert_owner;

CREATE FUNCTION private.release_bank_mail_agent_manifest_retention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.state IN ('attached', 'review_required')
    AND (
      TG_OP = 'INSERT'
      OR OLD.state NOT IN ('attached', 'review_required')
    )
  THEN
    UPDATE public.crm_mock_bank_payload_cleanup_jobs AS cleanup
    SET available_at = least(cleanup.available_at, clock_timestamp())
    WHERE cleanup.organization_id = NEW.organization_id
      AND cleanup.dispatch_id = NEW.dispatch_id
      AND cleanup.payload_id = NEW.dispatch_payload_id
      AND cleanup.generation = NEW.dispatch_generation
      AND cleanup.storage_bucket = NEW.manifest_storage_bucket
      AND cleanup.storage_path = NEW.manifest_storage_path
      AND cleanup.object_kind = 'manifest'
      AND cleanup.object_sha256 = NEW.manifest_sha256
      AND cleanup.status = 'pending'
      AND cleanup.claim_token IS NULL
      AND cleanup.locked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mail_bank_agent_pdf_attachment_release_manifest
  AFTER INSERT OR UPDATE OF state
  ON private.mail_bank_agent_pdf_attachment_jobs
  FOR EACH ROW
  EXECUTE FUNCTION private.release_bank_mail_agent_manifest_retention();

REVOKE ALL ON FUNCTION private.release_bank_mail_agent_manifest_retention()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Explicit automated provenance. The existing command RPC still receives the
-- mailbox owner as its authorization initiator, but persisted document,
-- validation, formal artifact and event rows are marked as bank-mail-agent
-- writes and never masquerade as a manual owner upload.
ALTER TABLE public.crm_documents
  ADD COLUMN bank_mail_attachment_job_id uuid,
  ADD COLUMN actor_kind text DEFAULT 'user' NOT NULL;

ALTER TABLE public.crm_documents
  DROP CONSTRAINT crm_documents_case_file_integrity_check,
  DROP CONSTRAINT crm_documents_actor_exclusive_check;

ALTER TABLE public.crm_documents
  ADD CONSTRAINT crm_documents_actor_exclusive_check CHECK (
    num_nonnulls(
      uploaded_by_user_id,
      uploaded_by_client_person_id,
      bank_mail_attachment_job_id
    ) <= 1
  ),
  ADD CONSTRAINT crm_documents_actor_kind_check CHECK (
    (actor_kind = 'user' AND bank_mail_attachment_job_id IS NULL)
    OR (
      actor_kind = 'bank_mail_agent'
      AND bank_mail_attachment_job_id IS NOT NULL
      AND uploaded_by_user_id IS NULL
      AND uploaded_by_client_person_id IS NULL
      AND uploaded_by_auth_user_id IS NULL
    )
  ),
  ADD CONSTRAINT crm_documents_case_file_integrity_check CHECK (
    storage_bucket <> 'crm-case-documents'
    OR (
      case_id IS NOT NULL
      AND (
        uploaded_by_user_id IS NOT NULL
        OR (
          uploaded_by_client_person_id IS NOT NULL
          AND uploaded_by_auth_user_id IS NOT NULL
        )
        OR (
          actor_kind = 'bank_mail_agent'
          AND bank_mail_attachment_job_id IS NOT NULL
        )
      )
      AND mime_type IS NOT NULL
      AND size_bytes IS NOT NULL
      AND sha256 IS NOT NULL
      AND storage_path LIKE organization_id::text || '/' || case_id::text || '/%'
    )
  ),
  ADD CONSTRAINT crm_documents_bank_mail_attachment_job_fk
    FOREIGN KEY (
      organization_id, case_id, submission_id, bank_mail_attachment_job_id
    ) REFERENCES private.mail_bank_agent_pdf_attachment_jobs (
      organization_id, case_id, application_id, id
    )
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX crm_documents_bank_mail_attachment_job_key
  ON public.crm_documents (bank_mail_attachment_job_id)
  WHERE bank_mail_attachment_job_id IS NOT NULL;

CREATE TABLE public.crm_mortgage_trusted_document_validations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_mail_attachment_job_id uuid NOT NULL UNIQUE,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  document_id uuid NOT NULL UNIQUE,
  kind text DEFAULT 'esis' NOT NULL,
  source_sha256 text NOT NULL,
  bank_email_identity_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  dispatch_generation integer NOT NULL,
  generation_context_sha256 text NOT NULL,
  manifest_sha256 text NOT NULL,
  manifest_size_bytes integer NOT NULL,
  dispatch_payload_sha256 text NOT NULL,
  expected_archive_sha256 text NOT NULL,
  expected_archive_size_bytes integer NOT NULL,
  observed_archive_sha256 text NOT NULL,
  observed_archive_size_bytes integer NOT NULL,
  applicant_context_sha256 text NOT NULL,
  bank_context_sha256 text NOT NULL,
  expectation_sha256 text NOT NULL,
  validated_bank_id uuid NOT NULL,
  validated_offer_id uuid NOT NULL,
  validated_loan_amount numeric(14,2),
  validated_currency text,
  validated_valid_until timestamptz NOT NULL,
  inspection_policy text DEFAULT 'openexpert_sent_artifact_sha256_v1' NOT NULL,
  inspection_method text DEFAULT 'exact_dispatch_sha256_and_bounded_pdf_v1' NOT NULL,
  actor_kind text DEFAULT 'bank_mail_agent' NOT NULL,
  validated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_trusted_validation_kind_check CHECK (kind = 'esis'),
  CONSTRAINT crm_mortgage_trusted_validation_hash_check CHECK (
    source_sha256 ~ '^[0-9a-f]{64}$'
    AND generation_context_sha256 ~ '^[0-9a-f]{64}$'
    AND manifest_sha256 ~ '^[0-9a-f]{64}$'
    AND manifest_size_bytes BETWEEN 1 AND 5242880
    AND dispatch_payload_sha256 ~ '^[0-9a-f]{64}$'
    AND expected_archive_sha256 ~ '^[0-9a-f]{64}$'
    AND observed_archive_sha256 = expected_archive_sha256
    AND observed_archive_size_bytes = expected_archive_size_bytes
    AND observed_archive_size_bytes BETWEEN 1 AND 5242880
    AND applicant_context_sha256 ~ '^[0-9a-f]{64}$'
    AND bank_context_sha256 ~ '^[0-9a-f]{64}$'
    AND expectation_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT crm_mortgage_trusted_validation_policy_check CHECK (
    inspection_policy = 'openexpert_sent_artifact_sha256_v1'
    AND inspection_method = 'exact_dispatch_sha256_and_bounded_pdf_v1'
    AND actor_kind = 'bank_mail_agent'
  ),
  CONSTRAINT crm_mortgage_trusted_validation_job_fk
    FOREIGN KEY (
      organization_id, case_id, application_id, bank_mail_attachment_job_id
    ) REFERENCES private.mail_bank_agent_pdf_attachment_jobs (
      organization_id, case_id, application_id, id
    )
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_trusted_validation_document_fk FOREIGN KEY (
    organization_id, case_id, application_id, document_id, source_sha256
  ) REFERENCES public.crm_documents (
    organization_id, case_id, submission_id, id, sha256
  ) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_trusted_validation_identity_fk
    FOREIGN KEY (bank_email_identity_id)
    REFERENCES public.mortgage_bank_email_identities (id) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_trusted_validation_bank_fk
    FOREIGN KEY (validated_bank_id)
    REFERENCES public.mortgage_banks (id) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_trusted_validation_offer_fk FOREIGN KEY (
    organization_id, case_id, validated_offer_id
  ) REFERENCES public.crm_case_offer_snapshots (
    organization_id, case_id, id
  ) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_trusted_validation_dispatch_fk
    FOREIGN KEY (dispatch_id)
    REFERENCES public.crm_mock_bank_dispatches (id) ON DELETE RESTRICT
);

ALTER TABLE public.crm_mortgage_trusted_document_validations
  ADD CONSTRAINT crm_mortgage_trusted_validation_artifact_pin_key UNIQUE (
    organization_id, case_id, application_id, document_id,
    kind, source_sha256, bank_mail_attachment_job_id, id
  );

COMMENT ON TABLE public.crm_mortgage_trusted_document_validations IS
  'Append-only deterministic proof for exact mock-bank generated ESIS bytes. It is not an AI verdict and is accepted only by the dedicated 0087 command path.';

REVOKE ALL ON TABLE public.crm_mortgage_trusted_document_validations
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT ON TABLE public.crm_mortgage_trusted_document_validations
  TO openexpert_owner;

ALTER TABLE public.crm_mortgage_application_artifacts
  ADD COLUMN bank_mail_attachment_job_id uuid,
  ADD COLUMN trusted_document_validation_id uuid,
  ADD COLUMN actor_kind text DEFAULT 'user' NOT NULL,
  ALTER COLUMN created_by_user_id DROP NOT NULL,
  DROP CONSTRAINT crm_mortgage_application_artifacts_ai_validation_shape_check,
  ADD CONSTRAINT crm_mortgage_application_artifacts_validation_shape_check CHECK (
    (
      kind = 'esis'
      AND (
        (
          actor_kind = 'user'
          AND bank_mail_attachment_job_id IS NULL
          AND ai_validation_id IS NOT NULL
          AND trusted_document_validation_id IS NULL
        ) OR (
          actor_kind = 'bank_mail_agent'
          AND bank_mail_attachment_job_id IS NOT NULL
          AND ai_validation_id IS NULL
          AND trusted_document_validation_id IS NOT NULL
        )
      )
    ) OR (
      kind = 'credit_decision'
      AND actor_kind = 'user'
      AND bank_mail_attachment_job_id IS NULL
      AND ai_validation_id IS NOT NULL
      AND trusted_document_validation_id IS NULL
    ) OR (
      kind = 'draft_credit_agreement'
      AND actor_kind = 'user'
      AND bank_mail_attachment_job_id IS NULL
      AND ai_validation_id IS NULL
      AND trusted_document_validation_id IS NULL
    )
  ),
  ADD CONSTRAINT crm_mortgage_artifacts_actor_kind_check CHECK (
    (
      actor_kind = 'user'
      AND created_by_user_id IS NOT NULL
      AND bank_mail_attachment_job_id IS NULL
    ) OR (
      actor_kind = 'bank_mail_agent'
      AND created_by_user_id IS NULL
      AND bank_mail_attachment_job_id IS NOT NULL
    )
  ),
  ADD CONSTRAINT crm_mortgage_artifacts_bank_mail_job_fk
    FOREIGN KEY (
      organization_id, case_id, application_id, bank_mail_attachment_job_id
    ) REFERENCES private.mail_bank_agent_pdf_attachment_jobs (
      organization_id, case_id, application_id, id
    )
    ON DELETE RESTRICT,
  ADD CONSTRAINT crm_mortgage_artifacts_trusted_validation_fk FOREIGN KEY (
    organization_id, case_id, application_id, document_id,
    kind, document_sha256, bank_mail_attachment_job_id,
    trusted_document_validation_id
  ) REFERENCES public.crm_mortgage_trusted_document_validations (
    organization_id, case_id, application_id, document_id,
    kind, source_sha256, bank_mail_attachment_job_id, id
  )
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX crm_mortgage_artifacts_bank_mail_job_key
  ON public.crm_mortgage_application_artifacts (bank_mail_attachment_job_id)
  WHERE bank_mail_attachment_job_id IS NOT NULL;

ALTER TABLE public.crm_mortgage_application_events
  ADD COLUMN bank_mail_attachment_job_id uuid,
  ADD COLUMN actor_kind text;

UPDATE public.crm_mortgage_application_events
SET actor_kind = CASE WHEN actor_user_id IS NULL THEN 'system' ELSE 'user' END;

ALTER TABLE public.crm_mortgage_application_events
  ALTER COLUMN actor_kind SET DEFAULT 'user',
  ALTER COLUMN actor_kind SET NOT NULL,
  ADD CONSTRAINT crm_mortgage_events_actor_kind_check CHECK (
    (actor_kind = 'system' AND actor_user_id IS NULL
      AND bank_mail_attachment_job_id IS NULL)
    OR (actor_kind = 'user' AND actor_user_id IS NOT NULL
      AND bank_mail_attachment_job_id IS NULL)
    OR (actor_kind = 'bank_mail_agent' AND actor_user_id IS NULL
      AND bank_mail_attachment_job_id IS NOT NULL)
  ),
  ADD CONSTRAINT crm_mortgage_events_bank_mail_job_fk
    FOREIGN KEY (
      organization_id, case_id, application_id, bank_mail_attachment_job_id
    ) REFERENCES private.mail_bank_agent_pdf_attachment_jobs (
      organization_id, case_id, application_id, id
    )
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX crm_mortgage_events_bank_mail_job_key
  ON public.crm_mortgage_application_events (bank_mail_attachment_job_id)
  WHERE bank_mail_attachment_job_id IS NOT NULL;

ALTER TABLE public.crm_document_storage_cleanup_jobs
  ADD COLUMN bank_mail_attachment_job_id uuid,
  DROP CONSTRAINT crm_document_storage_cleanup_jobs_purpose_check,
  ADD CONSTRAINT crm_document_storage_cleanup_jobs_purpose_check CHECK (
    purpose IN (
      'mortgage_artifact_upload',
      'bank_mail_attachment_upload',
      'document_delete'
    )
  ),
  ADD CONSTRAINT crm_document_storage_cleanup_jobs_bank_mail_shape_check CHECK (
    (purpose = 'bank_mail_attachment_upload')
      = (bank_mail_attachment_job_id IS NOT NULL)
  ),
  ADD CONSTRAINT crm_document_storage_cleanup_jobs_bank_mail_job_fk
    FOREIGN KEY (
      organization_id, case_id, submission_id, bank_mail_attachment_job_id
    ) REFERENCES private.mail_bank_agent_pdf_attachment_jobs (
      organization_id, case_id, application_id, id
    )
    ON DELETE RESTRICT;

CREATE UNIQUE INDEX crm_document_storage_cleanup_jobs_bank_mail_job_key
  ON public.crm_document_storage_cleanup_jobs (bank_mail_attachment_job_id)
  WHERE bank_mail_attachment_job_id IS NOT NULL;

ALTER TABLE private.mail_bank_agent_pdf_attachment_jobs
  ADD CONSTRAINT mail_bank_agent_pdf_attachment_jobs_document_fk FOREIGN KEY (
    organization_id, case_id, application_id, document_id, pdf_sha256
  ) REFERENCES public.crm_documents (
    organization_id, case_id, submission_id, id, sha256
  )
    ON DELETE RESTRICT,
  ADD CONSTRAINT mail_bank_agent_pdf_attachment_jobs_validation_fk
    FOREIGN KEY (trusted_validation_id)
    REFERENCES public.crm_mortgage_trusted_document_validations (id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT mail_bank_agent_pdf_attachment_jobs_artifact_fk FOREIGN KEY (
    organization_id, case_id, application_id, artifact_id
  ) REFERENCES public.crm_mortgage_application_artifacts (
    organization_id, case_id, application_id, id
  )
    ON DELETE RESTRICT,
  ADD CONSTRAINT mail_bank_agent_pdf_attachment_jobs_event_fk
    FOREIGN KEY (command_event_id)
    REFERENCES public.crm_mortgage_application_events (id)
    ON DELETE RESTRICT;

CREATE TABLE private.mail_bank_agent_pdf_publish_guards (
  attachment_job_id uuid NOT NULL,
  application_id uuid NOT NULL,
  transaction_id bigint NOT NULL,
  PRIMARY KEY (attachment_job_id, transaction_id),
  CONSTRAINT mail_bank_agent_pdf_publish_guards_job_fk
    FOREIGN KEY (attachment_job_id)
    REFERENCES private.mail_bank_agent_pdf_attachment_jobs (id)
    ON DELETE CASCADE
);

REVOKE ALL ON TABLE private.mail_bank_agent_pdf_publish_guards
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, DELETE ON TABLE private.mail_bank_agent_pdf_publish_guards
  TO openexpert_owner;

CREATE TABLE private.mail_bank_agent_pdf_attachment_provenance (
  attachment_job_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  dispatch_generation integer NOT NULL,
  generation_context_sha256 text NOT NULL,
  dispatch_payload_sha256 text NOT NULL,
  document_id uuid NOT NULL,
  trusted_validation_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  command_event_id uuid NOT NULL,
  actor_kind text DEFAULT 'bank_mail_agent' NOT NULL,
  inspection_policy text DEFAULT 'openexpert_sent_artifact_sha256_v1' NOT NULL,
  attached_at timestamptz NOT NULL,
  CONSTRAINT mail_bank_agent_pdf_provenance_actor_check CHECK (
    actor_kind = 'bank_mail_agent'
    AND inspection_policy = 'openexpert_sent_artifact_sha256_v1'
    AND generation_context_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_pdf_provenance_dispatch_key UNIQUE (
    dispatch_id, dispatch_generation
  ),
  CONSTRAINT mail_bank_agent_pdf_provenance_document_key UNIQUE (document_id),
  CONSTRAINT mail_bank_agent_pdf_provenance_validation_key UNIQUE (trusted_validation_id),
  CONSTRAINT mail_bank_agent_pdf_provenance_artifact_key UNIQUE (artifact_id),
  CONSTRAINT mail_bank_agent_pdf_provenance_event_key UNIQUE (command_event_id),
  CONSTRAINT mail_bank_agent_pdf_provenance_job_fk
    FOREIGN KEY (attachment_job_id)
    REFERENCES private.mail_bank_agent_pdf_attachment_jobs (id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_provenance_intake_fk
    FOREIGN KEY (intake_id) REFERENCES public.mail_bank_agent_intakes (id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_provenance_dispatch_fk
    FOREIGN KEY (dispatch_id) REFERENCES public.crm_mock_bank_dispatches (id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_provenance_document_fk
    FOREIGN KEY (document_id) REFERENCES public.crm_documents (id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_provenance_validation_fk
    FOREIGN KEY (trusted_validation_id)
    REFERENCES public.crm_mortgage_trusted_document_validations (id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_provenance_artifact_fk
    FOREIGN KEY (artifact_id)
    REFERENCES public.crm_mortgage_application_artifacts (id)
    ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_pdf_provenance_event_fk
    FOREIGN KEY (command_event_id)
    REFERENCES public.crm_mortgage_application_events (id)
    ON DELETE RESTRICT
);

REVOKE ALL ON TABLE private.mail_bank_agent_pdf_attachment_provenance
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT ON TABLE private.mail_bank_agent_pdf_attachment_provenance
  TO openexpert_owner;

CREATE FUNCTION private.protect_bank_mail_agent_pdf_provenance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  RAISE EXCEPTION 'bank_mail_agent_pdf_attachment_provenance_is_immutable'
    USING errcode = '42501';
END;
$$;

CREATE TRIGGER mail_bank_agent_pdf_attachment_provenance_immutable
  BEFORE UPDATE OR DELETE ON private.mail_bank_agent_pdf_attachment_provenance
  FOR EACH ROW EXECUTE FUNCTION private.protect_bank_mail_agent_pdf_provenance();

CREATE FUNCTION private.protect_bank_mail_agent_pdf_attachment_job()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.connection_id IS DISTINCT FROM OLD.connection_id
    OR NEW.intake_id IS DISTINCT FROM OLD.intake_id
    OR NEW.thread_link_job_id IS DISTINCT FROM OLD.thread_link_job_id
    OR NEW.thread_reference IS DISTINCT FROM OLD.thread_reference
    OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id
    OR NEW.analysis_run_id IS DISTINCT FROM OLD.analysis_run_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.application_id IS DISTINCT FROM OLD.application_id
    OR NEW.bank_email_identity_id IS DISTINCT FROM OLD.bank_email_identity_id
    OR NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id
    OR NEW.dispatch_generation IS DISTINCT FROM OLD.dispatch_generation
    OR NEW.dispatch_payload_id IS DISTINCT FROM OLD.dispatch_payload_id
    OR NEW.dispatch_generation_started_at IS DISTINCT FROM OLD.dispatch_generation_started_at
    OR NEW.generation_context_sha256 IS DISTINCT FROM OLD.generation_context_sha256
    OR NEW.manifest_storage_bucket IS DISTINCT FROM OLD.manifest_storage_bucket
    OR NEW.manifest_storage_path IS DISTINCT FROM OLD.manifest_storage_path
    OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
    OR NEW.manifest_size_bytes IS DISTINCT FROM OLD.manifest_size_bytes
    OR NEW.dispatch_payload_sha256 IS DISTINCT FROM OLD.dispatch_payload_sha256
    OR NEW.intake_source_sha256 IS DISTINCT FROM OLD.intake_source_sha256
    OR NEW.provider_message_id_sha256 IS DISTINCT FROM OLD.provider_message_id_sha256
    OR NEW.expected_archive_sha256 IS DISTINCT FROM OLD.expected_archive_sha256
    OR NEW.expected_archive_size_bytes IS DISTINCT FROM OLD.expected_archive_size_bytes
    OR NEW.application_number IS DISTINCT FROM OLD.application_number
    OR NEW.attachment_file_name IS DISTINCT FROM OLD.attachment_file_name
    OR NEW.pdf_file_name IS DISTINCT FROM OLD.pdf_file_name
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.primary_client_id IS DISTINCT FROM OLD.primary_client_id
    OR NEW.primary_person_id IS DISTINCT FROM OLD.primary_person_id
    OR NEW.primary_person_updated_at IS DISTINCT FROM OLD.primary_person_updated_at
    OR NEW.applicant_context_sha256 IS DISTINCT FROM OLD.applicant_context_sha256
    OR NEW.bank_context_sha256 IS DISTINCT FROM OLD.bank_context_sha256
    OR NEW.expectation_sha256 IS DISTINCT FROM OLD.expectation_sha256
    OR NEW.validation_bank_id IS DISTINCT FROM OLD.validation_bank_id
    OR NEW.validation_offer_id IS DISTINCT FROM OLD.validation_offer_id
    OR NEW.validation_loan_amount IS DISTINCT FROM OLD.validation_loan_amount
    OR NEW.validation_currency IS DISTINCT FROM OLD.validation_currency
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'bank_mail_agent_pdf_attachment_job_scope_is_immutable'
      USING errcode = '42501';
  END IF;

  IF OLD.state IN ('attached', 'review_required', 'failed', 'conflict')
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'bank_mail_agent_pdf_attachment_job_is_terminal'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mail_bank_agent_pdf_attachment_jobs_protect_scope
  BEFORE UPDATE ON private.mail_bank_agent_pdf_attachment_jobs
  FOR EACH ROW EXECUTE FUNCTION private.protect_bank_mail_agent_pdf_attachment_job();

ALTER TABLE private.mail_bank_agent_pdf_attachment_jobs
  ADD CONSTRAINT mail_bank_agent_pdf_attachment_jobs_attached_evidence_check CHECK (
    state <> 'attached' OR (
      attachment_id IS NOT NULL
      AND observed_archive_sha256 = expected_archive_sha256
      AND observed_archive_size_bytes = expected_archive_size_bytes
      AND pdf_sha256 IS NOT NULL
      AND pdf_size_bytes BETWEEN 1 AND 4194304
      AND cleanup_job_id IS NOT NULL
      AND storage_bucket = 'crm-case-documents'
      AND storage_path IS NOT NULL
    )
  );

CREATE TRIGGER crm_mortgage_trusted_document_validations_immutable
  BEFORE UPDATE OR DELETE ON public.crm_mortgage_trusted_document_validations
  FOR EACH ROW EXECUTE FUNCTION private.protect_bank_mail_agent_pdf_provenance();

CREATE FUNCTION private.bank_mail_agent_pdf_application_lock(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  PERFORM 1
  FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = p_organization_id
    AND crm_case.id = p_case_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_case_not_found'
      USING errcode = 'P0002';
  END IF;

  PERFORM 1
  FROM public.crm_case_bank_applications AS application
  WHERE application.organization_id = p_organization_id
    AND application.case_id = p_case_id
    AND application.submission_id = p_application_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_application_not_found'
      USING errcode = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert/bank-mail-pdf-application/v1' || chr(31)
        || p_organization_id::text || chr(31)
        || p_case_id::text || chr(31)
        || p_application_id::text,
      0
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.bank_mail_agent_pdf_application_lock(uuid, uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.bank_mail_agent_pdf_application_lock(uuid, uuid, uuid)
  TO openexpert_owner;

CREATE FUNCTION private.guard_bank_mail_agent_pdf_document_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  guard_job private.mail_bank_agent_pdf_attachment_jobs%rowtype;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (
      OLD.document_type = 'mortgage_esis'
      OR NEW.document_type = 'mortgage_esis'
      OR OLD.bank_mail_attachment_job_id IS NOT NULL
      OR NEW.bank_mail_attachment_job_id IS NOT NULL
    ) AND (
      NEW.id IS DISTINCT FROM OLD.id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.case_id IS DISTINCT FROM OLD.case_id
      OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
      OR NEW.document_type IS DISTINCT FROM OLD.document_type
      OR NEW.name IS DISTINCT FROM OLD.name
      OR NEW.storage_bucket IS DISTINCT FROM OLD.storage_bucket
      OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
      OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
      OR NEW.sha256 IS DISTINCT FROM OLD.sha256
      OR NEW.bank_mail_attachment_job_id
        IS DISTINCT FROM OLD.bank_mail_attachment_job_id
      OR NEW.actor_kind IS DISTINCT FROM OLD.actor_kind
      OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
      OR NEW.uploaded_by_client_person_id
        IS DISTINCT FROM OLD.uploaded_by_client_person_id
      OR NEW.uploaded_by_auth_user_id
        IS DISTINCT FROM OLD.uploaded_by_auth_user_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
    )
    THEN
      RAISE EXCEPTION 'mortgage_esis_document_identity_is_immutable'
        USING errcode = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.document_type <> 'mortgage_esis'
    AND NEW.bank_mail_attachment_job_id IS NULL
  THEN
    RETURN NEW;
  END IF;

  IF NEW.case_id IS NULL OR NEW.submission_id IS NULL THEN
    RAISE EXCEPTION 'bank_mail_pdf_document_application_scope_required'
      USING errcode = '23514';
  END IF;

  PERFORM private.bank_mail_agent_pdf_application_lock(
    NEW.organization_id, NEW.case_id, NEW.submission_id
  );

  IF NEW.bank_mail_attachment_job_id IS NOT NULL THEN
    SELECT job.* INTO guard_job
    FROM private.mail_bank_agent_pdf_attachment_jobs AS job
    JOIN private.mail_bank_agent_pdf_publish_guards AS guard
      ON guard.attachment_job_id = job.id
     AND guard.application_id = job.application_id
     AND guard.transaction_id = txid_current()
    WHERE job.id = NEW.bank_mail_attachment_job_id
      AND job.organization_id = NEW.organization_id
      AND job.case_id = NEW.case_id
      AND job.application_id = NEW.submission_id
      AND job.state = 'importing';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_mail_pdf_document_publish_guard_required'
        USING errcode = '42501';
    END IF;

    NEW.actor_kind := 'bank_mail_agent';
    NEW.uploaded_by_user_id := NULL;
    NEW.uploaded_by_client_person_id := NULL;
    NEW.uploaded_by_auth_user_id := NULL;
  ELSIF EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_pdf_attachment_jobs AS job
    WHERE job.organization_id = NEW.organization_id
      AND job.case_id = NEW.case_id
      AND job.application_id = NEW.submission_id
      AND job.state IN (
        'queued', 'downloading', 'verifying_source', 'unlocking',
        'validating', 'importing', 'retrying'
      )
  ) THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_application_in_progress'
      USING errcode = '23505';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_mail_agent_pdf_document_guard
  BEFORE INSERT OR UPDATE OF
    id, organization_id, case_id, submission_id, document_type,
    name, storage_bucket, storage_path, mime_type, size_bytes, sha256,
    bank_mail_attachment_job_id, actor_kind, uploaded_by_user_id,
    uploaded_by_client_person_id, uploaded_by_auth_user_id, created_at
  ON public.crm_documents
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_agent_pdf_document_write();

CREATE FUNCTION private.mark_bank_mail_agent_pdf_artifact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  guarded_job_id uuid;
BEGIN
  SELECT guard.attachment_job_id
  INTO guarded_job_id
  FROM private.mail_bank_agent_pdf_publish_guards AS guard
  WHERE guard.application_id = NEW.application_id
    AND guard.transaction_id = txid_current();

  IF guarded_job_id IS NULL THEN
    IF NEW.bank_mail_attachment_job_id IS NOT NULL
      OR NEW.trusted_document_validation_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'bank_mail_pdf_artifact_publish_guard_required'
        USING errcode = '42501';
    END IF;
    NEW.actor_kind := 'user';
    RETURN NEW;
  END IF;
  IF NEW.kind <> 'esis'
    OR NEW.bank_mail_attachment_job_id IS DISTINCT FROM guarded_job_id
    OR NEW.trusted_document_validation_id IS NULL
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_artifact_scope_invalid'
      USING errcode = '23514';
  END IF;
  NEW.actor_kind := 'bank_mail_agent';
  NEW.created_by_user_id := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_mail_agent_pdf_artifact_provenance
  BEFORE INSERT ON public.crm_mortgage_application_artifacts
  FOR EACH ROW EXECUTE FUNCTION private.mark_bank_mail_agent_pdf_artifact();

CREATE FUNCTION private.mark_bank_mail_agent_pdf_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  guarded_job_id uuid;
BEGIN
  SELECT guard.attachment_job_id
  INTO guarded_job_id
  FROM private.mail_bank_agent_pdf_publish_guards AS guard
  WHERE guard.application_id = NEW.application_id
    AND guard.transaction_id = txid_current();

  IF guarded_job_id IS NULL THEN
    IF NEW.bank_mail_attachment_job_id IS NOT NULL THEN
      RAISE EXCEPTION 'bank_mail_pdf_event_publish_guard_required'
        USING errcode = '42501';
    END IF;
    NEW.actor_kind := CASE
      WHEN NEW.actor_user_id IS NULL THEN 'system'
      ELSE 'user'
    END;
    RETURN NEW;
  END IF;
  IF NEW.event_type <> 'artifact_attached'
    OR NEW.command_id IS DISTINCT FROM guarded_job_id
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_command_event_scope_invalid'
      USING errcode = '23514';
  END IF;
  NEW.bank_mail_attachment_job_id := guarded_job_id;
  NEW.actor_kind := 'bank_mail_agent';
  NEW.actor_user_id := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_mail_agent_pdf_event_provenance
  BEFORE INSERT ON public.crm_mortgage_application_events
  FOR EACH ROW EXECUTE FUNCTION private.mark_bank_mail_agent_pdf_event();

-- Extend the existing storage reservation binding without changing its OID.
CREATE OR REPLACE FUNCTION private.bind_crm_document_storage_cleanup_intent()
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
      OLD.storage_bucket = 'crm-case-documents'
      OR NEW.storage_bucket = 'crm-case-documents'
    )
  THEN
    RAISE EXCEPTION 'crm_document_storage_identity_is_immutable'
      USING errcode = '23514';
  END IF;

  IF NEW.storage_bucket IS DISTINCT FROM 'crm-case-documents'
    OR NEW.storage_path IS NULL
  THEN
    RETURN NEW;
  END IF;

  SELECT cleanup.* INTO target_job
  FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.storage_bucket = NEW.storage_bucket
    AND cleanup.storage_path = NEW.storage_path
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF target_job.organization_id IS DISTINCT FROM NEW.organization_id
    OR target_job.case_id IS DISTINCT FROM NEW.case_id
    OR target_job.status <> 'reserved'
    OR target_job.purpose NOT IN (
      'mortgage_artifact_upload', 'bank_mail_attachment_upload'
    )
    OR (target_job.submission_id IS NOT NULL
      AND target_job.submission_id IS DISTINCT FROM NEW.submission_id)
    OR (target_job.document_id IS NOT NULL
      AND target_job.document_id IS DISTINCT FROM NEW.id)
    OR (
      target_job.purpose = 'bank_mail_attachment_upload'
      AND target_job.bank_mail_attachment_job_id
        IS DISTINCT FROM NEW.bank_mail_attachment_job_id
    )
    OR (
      target_job.purpose = 'mortgage_artifact_upload'
      AND NEW.bank_mail_attachment_job_id IS NOT NULL
    )
  THEN
    RAISE EXCEPTION 'crm_document_storage_path_is_retired'
      USING errcode = '23505';
  END IF;

  UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
  SET document_id = NEW.id,
      submission_id = coalesce(cleanup.submission_id, NEW.submission_id)
  WHERE cleanup.id = target_job.id;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.guard_bank_mail_pdf_identity_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.auto_attach_pdf_enabled AND NOT (
    NEW.sender_domain = 'openexpert.app'
    AND NOT NEW.allow_subdomains
    AND NEW.authentication_policy = 'openexpert_mock_dkim_aligned'
    AND EXISTS (
      SELECT 1
      FROM public.mortgage_banks AS bank
      WHERE bank.id = NEW.bank_id
        AND bank.slug = 'openexpert-bank'
        AND bank.is_mock
    )
  ) THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_identity_scope_invalid'
      USING errcode = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mortgage_bank_email_identities_guard_pdf_scope
  BEFORE INSERT OR UPDATE OF
    auto_attach_pdf_enabled,
    bank_id,
    sender_domain,
    allow_subdomains,
    authentication_policy
  ON public.mortgage_bank_email_identities
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_pdf_identity_scope();

CREATE FUNCTION private.guard_bank_mail_pdf_bank_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mortgage_bank_email_identities AS identity
    WHERE identity.bank_id = OLD.id
      AND identity.auto_attach_pdf_enabled
  ) AND NOT (
    NEW.id = OLD.id
    AND NEW.slug = 'openexpert-bank'
    AND NEW.is_mock
  ) THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_bank_scope_invalid'
      USING errcode = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER mortgage_banks_guard_pdf_scope
  BEFORE UPDATE OF id, slug, is_mock
  ON public.mortgage_banks
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_pdf_bank_scope();

REVOKE ALL ON FUNCTION private.guard_bank_mail_pdf_identity_scope()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION private.guard_bank_mail_pdf_bank_scope()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.bank_mail_agent_pdf_job_scope_is_valid(
  p_attachment_job_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_pdf_attachment_jobs AS job
    JOIN public.mail_bank_agent_intakes AS intake
      ON intake.id = job.intake_id
     AND intake.organization_id = job.organization_id
     AND intake.owner_user_id = job.owner_user_id
     AND intake.connection_id = job.connection_id
     AND intake.source_sha256 = job.intake_source_sha256
     AND intake.provider_message_id_sha256 = job.provider_message_id_sha256
     AND intake.identity_verdict = 'trusted_bank'
     AND intake.status = 'review_required'
     AND intake.finalized_at IS NOT NULL
     AND NOT intake.reply_to_mismatch
     AND intake.authentication_policy_applied = 'openexpert_mock_dkim_aligned'
     AND intake.dkim_aligned
     AND intake.bank_email_identity_id = job.bank_email_identity_id
    JOIN public.mortgage_bank_email_identities AS identity
      ON identity.id = job.bank_email_identity_id
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
      ON connection.organization_id = job.organization_id
     AND connection.owner_user_id = job.owner_user_id
     AND connection.id = job.connection_id
     AND connection.provider = 'google'
     AND connection.status = 'active'
    JOIN private.mail_bank_agent_thread_link_jobs AS link_job
      ON link_job.id = job.thread_link_job_id
     AND link_job.intake_id = job.intake_id
     AND link_job.state = 'linked'
     AND link_job.proposal_id = job.proposal_id
     AND link_job.resolved_case_id = job.case_id
    JOIN public.mail_context_thread_links AS link
      ON link.id = link_job.link_id
     AND link.organization_id = job.organization_id
     AND link.owner_user_id = job.owner_user_id
     AND link.connection_id = job.connection_id
     AND link.thread_key_hash = link_job.thread_key_hash
     AND link.case_id = job.case_id
     AND link.client_id IS NULL
    JOIN public.mail_bank_agent_match_proposals AS proposal
      ON proposal.id = job.proposal_id
     AND proposal.organization_id = job.organization_id
     AND proposal.owner_user_id = job.owner_user_id
     AND proposal.intake_id = job.intake_id
     AND proposal.analysis_run_id = job.analysis_run_id
     AND proposal.case_id = job.case_id
     AND proposal.application_id = job.application_id
     AND proposal.classification = 'strong_candidate'
     AND proposal.review_status = 'review_required'
     AND cardinality(proposal.contradiction_codes) = 0
    JOIN public.mail_bank_agent_analysis_runs AS run
      ON run.id = job.analysis_run_id
     AND run.organization_id = job.organization_id
     AND run.owner_user_id = job.owner_user_id
     AND run.intake_id = job.intake_id
     AND run.source_sha256 = job.intake_source_sha256
    JOIN public.mail_bank_agent_run_sessions AS binding
      ON binding.analysis_run_id = run.id
     AND binding.organization_id = job.organization_id
     AND binding.owner_user_id = job.owner_user_id
     AND binding.intake_id = job.intake_id
    JOIN public.crm_case_bank_applications AS application
      ON application.organization_id = job.organization_id
     AND application.case_id = job.case_id
     AND application.submission_id = job.application_id
     AND application.bank_id = identity.bank_id
    JOIN public.crm_mortgage_application_processes AS process
      ON process.organization_id = job.organization_id
     AND process.case_id = job.case_id
     AND process.application_id = job.application_id
    JOIN public.crm_cases AS crm_case
      ON crm_case.organization_id = job.organization_id
     AND crm_case.id = job.case_id
     AND crm_case.owner_user_id = job.owner_user_id
    JOIN public.crm_item_submissions AS submission
      ON submission.organization_id = job.organization_id
     AND submission.id = job.application_id
     AND submission.external_reference = job.application_number
    JOIN public.crm_mock_bank_dispatches AS dispatch
      ON dispatch.id = job.dispatch_id
     AND dispatch.organization_id = job.organization_id
     AND dispatch.case_id = job.case_id
     AND dispatch.application_id = job.application_id
     AND dispatch.kind = 'esis'
     AND dispatch.status = 'sent'
     AND dispatch.generation = job.dispatch_generation
     AND dispatch.payload_id = job.dispatch_payload_id
     AND dispatch.generation_started_at = job.dispatch_generation_started_at
     AND dispatch.recipient_connection_id = job.connection_id
     AND dispatch.requested_by_user_id = job.owner_user_id
     AND dispatch.payload_ready_at IS NOT NULL
     AND dispatch.provider_message_id IS NOT NULL
     AND dispatch.generation_context_sha256 = job.generation_context_sha256
     AND dispatch.generation_applicant_context_sha256
       = job.applicant_context_sha256
     AND dispatch.generation_bank_context_sha256 = job.bank_context_sha256
     AND dispatch.generation_expectation_sha256 = job.expectation_sha256
     AND dispatch.generation_valid_until = job.valid_until
     AND dispatch.manifest_storage_bucket = job.manifest_storage_bucket
     AND dispatch.manifest_storage_path = job.manifest_storage_path
     AND dispatch.manifest_sha256 = job.manifest_sha256
     AND dispatch.manifest_size_bytes = job.manifest_size_bytes
     AND dispatch.payload_sha256 = job.dispatch_payload_sha256
     AND dispatch.archive_sha256 = job.expected_archive_sha256
     AND dispatch.archive_size_bytes = job.expected_archive_size_bytes
    JOIN public.crm_client_people AS person
      ON person.organization_id = job.organization_id
     AND person.client_id = job.primary_client_id
     AND person.id = job.primary_person_id
     AND person.role = 'primary'
     AND person.updated_at = job.primary_person_updated_at
     AND person.pesel ~ '^[0-9]{11}$'
    CROSS JOIN LATERAL (
      SELECT private.crm_mortgage_document_validation_context(
        job.organization_id,
        job.case_id,
        job.application_id,
        process.stage <> 'pre_application',
        'esis',
        NULL,
        job.valid_until
      ) AS value
    ) AS current_context
    CROSS JOIN LATERAL (
      SELECT private.crm_mock_bank_generation_context(job.dispatch_id) AS value
    ) AS current_generation_context
    WHERE job.id = p_attachment_job_id
      AND current_generation_context.value ->> 'generationContextSha256'
        = job.generation_context_sha256
      AND current_context.value ->> 'applicantContextSha256'
        = job.applicant_context_sha256
      AND current_context.value ->> 'bankContextSha256'
        = job.bank_context_sha256
      AND current_context.value ->> 'expectationSha256'
        = job.expectation_sha256
      AND (current_context.value ->> 'bankId')::uuid = job.validation_bank_id
      AND (current_context.value ->> 'offerId')::uuid = job.validation_offer_id
      AND nullif(current_context.value ->> 'loanAmount', '')::numeric
        IS NOT DISTINCT FROM job.validation_loan_amount
      AND current_context.value ->> 'currency'
        IS NOT DISTINCT FROM job.validation_currency
      AND NOT EXISTS (
        SELECT 1
        FROM public.mail_bank_agent_match_proposals AS other_proposal
        WHERE other_proposal.intake_id = job.intake_id
          AND other_proposal.id <> job.proposal_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.mail_bank_agent_analysis_runs AS other_run
        WHERE other_run.intake_id = job.intake_id
          AND other_run.id <> job.analysis_run_id
      )
  );
$$;

REVOKE ALL ON FUNCTION private.bank_mail_agent_pdf_job_scope_is_valid(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.bank_mail_agent_pdf_job_scope_is_valid(uuid)
  TO openexpert_owner;

-- Candidate reconciliation must remain available even when one historical
-- application has malformed/incomplete context.  These wrappers expose no
-- values publicly; they only turn a per-row recomputation error into a NULL
-- candidate that the exact prefilter skips.
CREATE FUNCTION private.safe_crm_mock_bank_generation_context(
  p_dispatch_id uuid,
  p_payload_id uuid,
  p_generation integer,
  p_generation_started_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN private.crm_mock_bank_generation_context(
    p_dispatch_id, p_payload_id, p_generation, p_generation_started_at
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE FUNCTION private.safe_crm_mortgage_esis_validation_context(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_use_frozen_applicants boolean,
  p_valid_until timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN private.crm_mortgage_document_validation_context(
    p_organization_id,
    p_case_id,
    p_application_id,
    p_use_frozen_applicants,
    'esis',
    NULL,
    p_valid_until
  );
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.safe_crm_mock_bank_generation_context(
  uuid, uuid, integer, timestamptz
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION private.safe_crm_mortgage_esis_validation_context(
  uuid, uuid, uuid, boolean, timestamptz
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.enqueue_bank_mail_agent_pdf_attachment(
  p_intake_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  link_job private.mail_bank_agent_thread_link_jobs%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  proposal_row public.mail_bank_agent_match_proposals%rowtype;
  run_row public.mail_bank_agent_analysis_runs%rowtype;
  identity_row public.mortgage_bank_email_identities%rowtype;
  dispatch_row public.crm_mock_bank_dispatches%rowtype;
  manifest_cleanup_row public.crm_mock_bank_payload_cleanup_jobs%rowtype;
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  application_number_value text;
  primary_client_value uuid;
  primary_person_value uuid;
  primary_person_updated_value timestamptz;
  primary_count integer;
  person_count integer;
  issue_date_value date;
  process_stage_value text;
  validation_context_value jsonb;
  generation_context_value jsonb;
  initial_state text := 'queued';
  initial_resolution text;
  completed_value timestamptz;
BEGIN
  IF p_intake_id IS NULL THEN
    RAISE EXCEPTION 'invalid_bank_mail_pdf_attachment_intake'
      USING errcode = '22023';
  END IF;

  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.intake_id = p_intake_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'replayed', true
    );
  END IF;

  SELECT linked.* INTO link_job
  FROM private.mail_bank_agent_thread_link_jobs AS linked
  WHERE linked.intake_id = p_intake_id
  FOR UPDATE;
  IF NOT FOUND OR link_job.state <> 'linked' OR link_job.link_id IS NULL THEN
    RETURN jsonb_build_object('state', 'not_eligible', 'replayed', false);
  END IF;

  SELECT intake.* INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = link_job.intake_id;

  SELECT identity.* INTO identity_row
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank
    ON bank.id = identity.bank_id
   AND bank.slug = 'openexpert-bank'
   AND bank.is_mock
  WHERE identity.id = intake_row.bank_email_identity_id
    AND identity.sender_domain = 'openexpert.app'
    AND NOT identity.allow_subdomains
    AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
    AND identity.is_active
    AND identity.auto_attach_pdf_enabled
  FOR SHARE OF identity;
  IF NOT FOUND
    OR intake_row.identity_verdict <> 'trusted_bank'
    OR intake_row.status <> 'review_required'
    OR intake_row.finalized_at IS NULL
    OR intake_row.reply_to_mismatch
    OR intake_row.authentication_policy_applied <> 'openexpert_mock_dkim_aligned'
    OR NOT intake_row.dkim_aligned
  THEN
    RETURN jsonb_build_object('state', 'not_eligible', 'replayed', false);
  END IF;

  SELECT proposal.* INTO proposal_row
  FROM public.mail_bank_agent_match_proposals AS proposal
  WHERE proposal.id = link_job.proposal_id
    AND proposal.intake_id = intake_row.id
    AND proposal.classification = 'strong_candidate'
    AND proposal.review_status = 'review_required'
    AND cardinality(proposal.contradiction_codes) = 0;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.mail_bank_agent_match_proposals AS other
    WHERE other.intake_id = intake_row.id AND other.id <> proposal_row.id
  ) THEN
    RETURN jsonb_build_object('state', 'not_eligible', 'replayed', false);
  END IF;

  SELECT run.* INTO run_row
  FROM public.mail_bank_agent_analysis_runs AS run
  WHERE run.id = proposal_row.analysis_run_id
    AND run.intake_id = intake_row.id
    AND run.source_sha256 = intake_row.source_sha256;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.mail_bank_agent_analysis_runs AS other
    WHERE other.intake_id = intake_row.id AND other.id <> run_row.id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.mail_bank_agent_run_sessions AS binding
    WHERE binding.analysis_run_id = run_row.id
      AND binding.intake_id = intake_row.id
  ) THEN
    RETURN jsonb_build_object('state', 'not_eligible', 'replayed', false);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.mail_context_thread_links AS link
    WHERE link.id = link_job.link_id
      AND link.organization_id = link_job.organization_id
      AND link.owner_user_id = link_job.owner_user_id
      AND link.connection_id = link_job.connection_id
      AND link.thread_key_hash = link_job.thread_key_hash
      AND link.case_id = proposal_row.case_id
      AND link.client_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.mail_connections AS connection
    WHERE connection.organization_id = intake_row.organization_id
      AND connection.owner_user_id = intake_row.owner_user_id
      AND connection.id = intake_row.connection_id
      AND connection.provider = 'google'
      AND connection.status = 'active'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.crm_case_bank_applications AS application
    JOIN public.crm_cases AS crm_case
      ON crm_case.organization_id = application.organization_id
     AND crm_case.id = application.case_id
    WHERE application.organization_id = intake_row.organization_id
      AND application.case_id = proposal_row.case_id
      AND application.submission_id = proposal_row.application_id
      AND application.bank_id = identity_row.bank_id
      AND crm_case.owner_user_id = intake_row.owner_user_id
  ) THEN
    RETURN jsonb_build_object('state', 'not_eligible', 'replayed', false);
  END IF;

  SELECT submission.external_reference
  INTO application_number_value
  FROM public.crm_item_submissions AS submission
  WHERE submission.organization_id = intake_row.organization_id
    AND submission.id = proposal_row.application_id
    AND submission.external_reference ~ '^OEB-[0-9]{8}-[0-9]{6}$';
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_eligible'); END IF;

  SELECT dispatch.* INTO dispatch_row
  FROM public.crm_mock_bank_dispatches AS dispatch
  WHERE dispatch.organization_id = intake_row.organization_id
    AND dispatch.case_id = proposal_row.case_id
    AND dispatch.application_id = proposal_row.application_id
    AND dispatch.kind = 'esis'
    AND dispatch.status = 'sent'
    AND dispatch.recipient_connection_id = intake_row.connection_id
    AND dispatch.requested_by_user_id = intake_row.owner_user_id
    AND dispatch.payload_ready_at IS NOT NULL
    AND dispatch.provider_message_id IS NOT NULL
    AND dispatch.generation_context_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch.generation_applicant_context_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch.generation_bank_context_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch.generation_expectation_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch.generation_valid_until IS NOT NULL
    AND dispatch.manifest_storage_bucket = 'crm-mock-bank-outbox'
    AND dispatch.manifest_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch.manifest_size_bytes BETWEEN 1 AND 5242880
    AND dispatch.payload_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch.archive_sha256 ~ '^[0-9a-f]{64}$'
    AND dispatch.archive_size_bytes BETWEEN 1 AND 5242880
  FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_eligible'); END IF;

  SELECT count(*), min(link.client_id::text)::uuid
  INTO primary_count, primary_client_value
  FROM public.crm_case_clients AS link
  WHERE link.organization_id = intake_row.organization_id
    AND link.case_id = proposal_row.case_id
    AND link.is_primary;
  IF primary_count <> 1 THEN RETURN jsonb_build_object('state', 'not_eligible'); END IF;

  SELECT count(*), min(person.id::text)::uuid, min(person.updated_at)
  INTO person_count, primary_person_value, primary_person_updated_value
  FROM public.crm_client_people AS person
  WHERE person.organization_id = intake_row.organization_id
    AND person.client_id = primary_client_value
    AND person.role = 'primary'
    AND person.pesel ~ '^[0-9]{11}$';
  IF person_count <> 1 THEN RETURN jsonb_build_object('state', 'not_eligible'); END IF;

  issue_date_value := (dispatch_row.generation_started_at AT TIME ZONE 'Europe/Warsaw')::date;
  SELECT process.stage INTO process_stage_value
  FROM public.crm_mortgage_application_processes AS process
  WHERE process.organization_id = intake_row.organization_id
    AND process.case_id = proposal_row.case_id
    AND process.application_id = proposal_row.application_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_eligible'); END IF;
  validation_context_value := private.crm_mortgage_document_validation_context(
    intake_row.organization_id,
    proposal_row.case_id,
    proposal_row.application_id,
    process_stage_value <> 'pre_application',
    'esis',
    NULL,
    dispatch_row.generation_valid_until
  );
  generation_context_value :=
    private.crm_mock_bank_generation_context(dispatch_row.id);
  IF generation_context_value IS NULL
    OR generation_context_value ->> 'generationContextSha256'
      IS DISTINCT FROM dispatch_row.generation_context_sha256
    OR validation_context_value ->> 'applicantContextSha256'
      IS DISTINCT FROM dispatch_row.generation_applicant_context_sha256
    OR validation_context_value ->> 'bankContextSha256'
      IS DISTINCT FROM dispatch_row.generation_bank_context_sha256
    OR validation_context_value ->> 'expectationSha256'
      IS DISTINCT FROM dispatch_row.generation_expectation_sha256
    OR (generation_context_value ->> 'validUntil')::timestamptz
      IS DISTINCT FROM dispatch_row.generation_valid_until
  THEN
    RETURN jsonb_build_object('state', 'not_eligible');
  END IF;

  -- Serialize with the delayed manifest cleanup claim and extend retention
  -- while the attachment job is active.  A claimed/completed manifest cannot
  -- safely be resurrected because deletion may already be in flight.
  SELECT cleanup.* INTO manifest_cleanup_row
  FROM public.crm_mock_bank_payload_cleanup_jobs AS cleanup
  WHERE cleanup.organization_id = dispatch_row.organization_id
    AND cleanup.dispatch_id = dispatch_row.id
    AND cleanup.payload_id = dispatch_row.payload_id
    AND cleanup.generation = dispatch_row.generation
    AND cleanup.storage_bucket = dispatch_row.manifest_storage_bucket
    AND cleanup.storage_path = dispatch_row.manifest_storage_path
    AND cleanup.object_kind = 'manifest'
    AND cleanup.object_sha256 = dispatch_row.manifest_sha256
  FOR UPDATE;
  IF NOT FOUND
    OR manifest_cleanup_row.status <> 'pending'
    OR manifest_cleanup_row.claim_token IS NOT NULL
    OR manifest_cleanup_row.locked_at IS NOT NULL
  THEN
    RETURN jsonb_build_object('state', 'not_eligible');
  END IF;
  UPDATE public.crm_mock_bank_payload_cleanup_jobs AS cleanup
  SET available_at = greatest(
    cleanup.available_at, clock_timestamp() + interval '7 days'
  )
  WHERE cleanup.id = manifest_cleanup_row.id;
  PERFORM private.bank_mail_agent_pdf_application_lock(
    intake_row.organization_id, proposal_row.case_id, proposal_row.application_id
  );
  IF EXISTS (
    SELECT 1 FROM public.crm_documents AS document
    WHERE document.organization_id = intake_row.organization_id
      AND document.case_id = proposal_row.case_id
      AND document.submission_id = proposal_row.application_id
      AND document.document_type = 'mortgage_esis'
  ) OR EXISTS (
    SELECT 1 FROM public.crm_mortgage_application_artifacts AS artifact
    WHERE artifact.organization_id = intake_row.organization_id
      AND artifact.case_id = proposal_row.case_id
      AND artifact.application_id = proposal_row.application_id
      AND artifact.kind = 'esis'
  ) THEN
    initial_state := 'review_required';
    initial_resolution := 'existing_esis_requires_review';
    completed_value := clock_timestamp();
  END IF;

  INSERT INTO private.mail_bank_agent_pdf_attachment_jobs (
    organization_id, owner_user_id, connection_id, intake_id,
    thread_link_job_id, thread_reference, proposal_id, analysis_run_id,
    case_id, application_id, bank_email_identity_id,
    dispatch_id, dispatch_generation, dispatch_payload_id,
    dispatch_generation_started_at, generation_context_sha256,
    manifest_storage_bucket, manifest_storage_path, manifest_sha256,
    manifest_size_bytes, dispatch_payload_sha256, intake_source_sha256,
    provider_message_id_sha256,
    expected_archive_sha256, expected_archive_size_bytes,
    application_number, attachment_file_name, pdf_file_name,
    issue_date, valid_until, primary_client_id, primary_person_id,
    primary_person_updated_at, applicant_context_sha256,
    bank_context_sha256, expectation_sha256, validation_bank_id,
    validation_offer_id, validation_loan_amount, validation_currency,
    state, resolution_code, completed_at
  ) VALUES (
    intake_row.organization_id, intake_row.owner_user_id, intake_row.connection_id,
    intake_row.id, link_job.id, link_job.thread_reference, proposal_row.id,
    run_row.id, proposal_row.case_id, proposal_row.application_id,
    identity_row.id, dispatch_row.id, dispatch_row.generation,
    dispatch_row.payload_id, dispatch_row.generation_started_at,
    dispatch_row.generation_context_sha256,
    dispatch_row.manifest_storage_bucket, dispatch_row.manifest_storage_path,
    dispatch_row.manifest_sha256, dispatch_row.manifest_size_bytes,
    dispatch_row.payload_sha256,
    intake_row.source_sha256, intake_row.provider_message_id_sha256,
    dispatch_row.archive_sha256,
    dispatch_row.archive_size_bytes, application_number_value,
    application_number_value || '-formularz-ESIS.zip',
    application_number_value || '-formularz-ESIS.pdf', issue_date_value,
    dispatch_row.generation_valid_until,
    primary_client_value, primary_person_value, primary_person_updated_value,
    dispatch_row.generation_applicant_context_sha256,
    dispatch_row.generation_bank_context_sha256,
    dispatch_row.generation_expectation_sha256,
    (validation_context_value ->> 'bankId')::uuid,
    (validation_context_value ->> 'offerId')::uuid,
    nullif(validation_context_value ->> 'loanAmount', '')::numeric,
    validation_context_value ->> 'currency',
    initial_state, initial_resolution, completed_value
  )
  ON CONFLICT (intake_id) DO NOTHING
  RETURNING * INTO job_row;

  IF job_row.id IS NULL THEN
    SELECT job.* INTO STRICT job_row
    FROM private.mail_bank_agent_pdf_attachment_jobs AS job
    WHERE job.intake_id = intake_row.id;
  END IF;
  RETURN jsonb_build_object(
    'state', job_row.state,
    'resolutionCode', job_row.resolution_code,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_bank_mail_agent_pdf_attachment(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.enqueue_bank_mail_agent_pdf_attachment(uuid)
  TO openexpert_owner;

-- Do not put attachment work on either canonical write path.  A provider sent
-- transition has an external side effect and an 0085 link is canonical CRM
-- state; neither may block or roll back because PDF import is unavailable.
-- The authenticated service claim below is the sole bounded reconciler and
-- handles sent-before-link, link-before-sent and concurrent commits alike.

CREATE FUNCTION public.claim_bank_mail_agent_pdf_attachment_jobs(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_lock_timeout_seconds integer DEFAULT 1800
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  candidate private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  claimed private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  lease_token text;
  claim_now timestamptz := clock_timestamp();
  result jsonb := '[]'::jsonb;
  scope_valid boolean;
  reconcile_candidate record;
BEGIN
  IF p_worker_id IS NULL
    OR p_worker_id <> btrim(p_worker_id)
    OR char_length(p_worker_id) NOT BETWEEN 1 AND 200
    OR p_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    OR p_limit NOT BETWEEN 1 AND 20
    OR p_lock_timeout_seconds NOT BETWEEN 60 AND 3600
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_pdf_attachment_claim'
      USING errcode = '22023';
  END IF;

  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_claims_invalid'
      USING errcode = '42501';
  END;
  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'crm-bank-mail-pdf-claim-v1'
    OR jwt_claims ->> 'serviceId'
      IS DISTINCT FROM 'openexpert-crm-bank-mail-pdf-worker'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-pdf-attachment'
    OR jwt_claims ->> 'workerId' IS DISTINCT FROM p_worker_id
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_claims_invalid'
      USING errcode = '42501';
  END IF;

  -- Durable bounded backstop for the two-transaction link/sent race.  Either
  -- latency trigger can observe the other row before it commits; after both
  -- commits, every service claim reconciles a small oldest-first batch.  The
  -- helper is idempotent and re-runs every canonical/live-scope check.
  FOR reconcile_candidate IN
    SELECT link_job.intake_id
    FROM private.mail_bank_agent_thread_link_jobs AS link_job
    JOIN public.mail_bank_agent_intakes AS intake
      ON intake.id = link_job.intake_id
     AND intake.identity_verdict = 'trusted_bank'
     AND intake.status = 'review_required'
     AND intake.finalized_at IS NOT NULL
     AND NOT intake.reply_to_mismatch
     AND intake.authentication_policy_applied = 'openexpert_mock_dkim_aligned'
     AND intake.dkim_aligned
    JOIN public.mortgage_bank_email_identities AS identity
      ON identity.id = intake.bank_email_identity_id
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
      ON connection.organization_id = intake.organization_id
     AND connection.owner_user_id = intake.owner_user_id
     AND connection.id = intake.connection_id
     AND connection.provider = 'google'
     AND connection.status = 'active'
    JOIN public.mail_bank_agent_match_proposals AS proposal
      ON proposal.id = link_job.proposal_id
     AND proposal.intake_id = intake.id
     AND proposal.classification = 'strong_candidate'
     AND proposal.review_status = 'review_required'
     AND cardinality(proposal.contradiction_codes) = 0
    JOIN public.mail_bank_agent_analysis_runs AS analysis_run
      ON analysis_run.id = proposal.analysis_run_id
     AND analysis_run.intake_id = intake.id
     AND analysis_run.source_sha256 = intake.source_sha256
    JOIN public.crm_case_bank_applications AS application
      ON application.organization_id = intake.organization_id
     AND application.case_id = proposal.case_id
     AND application.submission_id = proposal.application_id
     AND application.bank_id = identity.bank_id
    JOIN public.crm_cases AS crm_case
      ON crm_case.organization_id = application.organization_id
     AND crm_case.id = application.case_id
     AND crm_case.owner_user_id = intake.owner_user_id
    JOIN public.crm_item_submissions AS submission
      ON submission.organization_id = application.organization_id
     AND submission.id = application.submission_id
     AND submission.external_reference ~ '^OEB-[0-9]{8}-[0-9]{6}$'
    JOIN public.crm_mortgage_application_processes AS process
      ON process.organization_id = application.organization_id
     AND process.case_id = application.case_id
     AND process.application_id = application.submission_id
    JOIN public.crm_mock_bank_dispatches AS dispatch
      ON dispatch.organization_id = intake.organization_id
     AND dispatch.case_id = proposal.case_id
     AND dispatch.application_id = proposal.application_id
     AND dispatch.kind = 'esis'
     AND dispatch.status = 'sent'
     AND dispatch.recipient_connection_id = intake.connection_id
     AND dispatch.requested_by_user_id = intake.owner_user_id
     AND intake.claimed_at >= dispatch.generation_started_at - interval '10 minutes'
     AND dispatch.payload_ready_at IS NOT NULL
     AND dispatch.provider_message_id IS NOT NULL
     AND dispatch.generation_context_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_applicant_context_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_bank_context_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_expectation_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_valid_until IS NOT NULL
     AND dispatch.manifest_storage_bucket = 'crm-mock-bank-outbox'
     AND dispatch.manifest_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.manifest_size_bytes BETWEEN 1 AND 5242880
     AND dispatch.payload_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.archive_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.archive_size_bytes BETWEEN 1 AND 5242880
    JOIN public.crm_mock_bank_payload_cleanup_jobs AS manifest_cleanup
      ON manifest_cleanup.organization_id = dispatch.organization_id
     AND manifest_cleanup.dispatch_id = dispatch.id
     AND manifest_cleanup.payload_id = dispatch.payload_id
     AND manifest_cleanup.generation = dispatch.generation
     AND manifest_cleanup.storage_bucket = dispatch.manifest_storage_bucket
     AND manifest_cleanup.storage_path = dispatch.manifest_storage_path
     AND manifest_cleanup.object_kind = 'manifest'
     AND manifest_cleanup.object_sha256 = dispatch.manifest_sha256
     AND manifest_cleanup.status = 'pending'
     AND manifest_cleanup.claim_token IS NULL
     AND manifest_cleanup.locked_at IS NULL
    CROSS JOIN LATERAL (
      SELECT private.safe_crm_mock_bank_generation_context(
        dispatch.id,
        dispatch.payload_id,
        dispatch.generation,
        dispatch.generation_started_at
      ) AS value
    ) AS current_generation_context
    CROSS JOIN LATERAL (
      SELECT private.safe_crm_mortgage_esis_validation_context(
        intake.organization_id,
        proposal.case_id,
        proposal.application_id,
        process.stage <> 'pre_application',
        dispatch.generation_valid_until
      ) AS value
    ) AS current_validation_context
    LEFT JOIN private.mail_bank_agent_pdf_attachment_jobs AS attachment_job
      ON attachment_job.intake_id = intake.id
    WHERE link_job.state = 'linked'
      AND link_job.link_id IS NOT NULL
      AND attachment_job.id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.mail_context_thread_links AS link
        WHERE link.id = link_job.link_id
          AND link.organization_id = link_job.organization_id
          AND link.owner_user_id = link_job.owner_user_id
          AND link.connection_id = link_job.connection_id
          AND link.thread_key_hash = link_job.thread_key_hash
          AND link.case_id = proposal.case_id
          AND link.client_id IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM public.mail_bank_agent_run_sessions AS binding
        WHERE binding.analysis_run_id = analysis_run.id
          AND binding.intake_id = intake.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.mail_bank_agent_match_proposals AS other_proposal
        WHERE other_proposal.intake_id = intake.id
          AND other_proposal.id <> proposal.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.mail_bank_agent_analysis_runs AS other_run
        WHERE other_run.intake_id = intake.id
          AND other_run.id <> analysis_run.id
      )
      AND 1 = (
        SELECT count(*)
        FROM public.crm_case_clients AS case_client
        WHERE case_client.organization_id = intake.organization_id
          AND case_client.case_id = proposal.case_id
          AND case_client.is_primary
      )
      AND 1 = (
        SELECT count(*)
        FROM public.crm_case_clients AS case_client
        JOIN public.crm_client_people AS person
          ON person.organization_id = case_client.organization_id
         AND person.client_id = case_client.client_id
         AND person.role = 'primary'
         AND person.pesel ~ '^[0-9]{11}$'
        WHERE case_client.organization_id = intake.organization_id
          AND case_client.case_id = proposal.case_id
          AND case_client.is_primary
      )
      AND current_generation_context.value ->> 'generationContextSha256'
        = dispatch.generation_context_sha256
      AND current_validation_context.value ->> 'applicantContextSha256'
        = dispatch.generation_applicant_context_sha256
      AND current_validation_context.value ->> 'bankContextSha256'
        = dispatch.generation_bank_context_sha256
      AND current_validation_context.value ->> 'expectationSha256'
        = dispatch.generation_expectation_sha256
    ORDER BY intake.claimed_at, intake.id
    FOR UPDATE OF link_job SKIP LOCKED
    LIMIT 20
  LOOP
    BEGIN
      PERFORM private.enqueue_bank_mail_agent_pdf_attachment(
        reconcile_candidate.intake_id
      );
    EXCEPTION WHEN OTHERS THEN
      -- One malformed/racing candidate must not prevent unrelated ready work
      -- from being claimed.  It stays jobless and is retried on the next drain.
      NULL;
    END;
  END LOOP;

  FOR candidate IN
    SELECT job.*
    FROM private.mail_bank_agent_pdf_attachment_jobs AS job
    WHERE job.available_at <= claim_now
      AND (
        job.state IN ('queued', 'retrying')
        OR (
          job.state IN (
            'downloading', 'verifying_source', 'unlocking',
            'validating', 'importing'
          )
          AND job.lease_expires_at <= claim_now
        )
      )
    ORDER BY job.available_at, job.created_at, job.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  LOOP
    BEGIN
      scope_valid := private.bank_mail_agent_pdf_job_scope_is_valid(candidate.id);
    EXCEPTION WHEN OTHERS THEN
      scope_valid := false;
    END;

    IF scope_valid IS DISTINCT FROM true THEN
      UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
      SET state = 'failed', resolution_code = 'canonical_link_invalid',
          locked_by = NULL, lease_token_sha256 = NULL,
          lease_expires_at = NULL, completed_at = claim_now
      WHERE job.id = candidate.id;
      CONTINUE;
    END IF;

    IF candidate.attempt_count >= 5 THEN
      UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
      SET state = 'failed', resolution_code = 'retry_limit_reached',
          locked_by = NULL, lease_token_sha256 = NULL,
          lease_expires_at = NULL, completed_at = claim_now
      WHERE job.id = candidate.id;
      CONTINUE;
    END IF;

    lease_token := encode(extensions.gen_random_bytes(32), 'hex');
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'downloading', resolution_code = NULL,
        attempt_count = job.attempt_count + 1,
        locked_by = p_worker_id,
        lease_token_sha256 = encode(
          extensions.digest(convert_to(lease_token, 'utf8'), 'sha256'), 'hex'
        ),
        lease_expires_at = claim_now
          + make_interval(secs => p_lock_timeout_seconds),
        started_at = coalesce(job.started_at, claim_now)
    WHERE job.id = candidate.id
    RETURNING * INTO claimed;

    result := result || jsonb_build_array(jsonb_build_object(
      'attachmentJobId', claimed.id,
      'state', claimed.state,
      'leaseToken', lease_token,
      'attemptNo', claimed.attempt_count,
      'leaseExpiresAt', claimed.lease_expires_at,
      'organizationId', claimed.organization_id,
      'connectionId', claimed.connection_id,
      'mailboxOwnerUserId', claimed.owner_user_id,
      'provider', 'google',
      'threadReference', claimed.thread_reference,
      'caseId', claimed.case_id,
      'applicationId', claimed.application_id,
      'dispatchId', claimed.dispatch_id,
      'dispatchGeneration', claimed.dispatch_generation,
      'dispatchPayloadId', claimed.dispatch_payload_id,
      'dispatchGenerationStartedAt',
        date_trunc('milliseconds', claimed.dispatch_generation_started_at),
      'intakeSourceSha256', claimed.intake_source_sha256,
      'providerMessageIdSha256', claimed.provider_message_id_sha256,
      'attachmentFileName', claimed.attachment_file_name,
      'pdfFileName', claimed.pdf_file_name,
      'generationContextSha256', claimed.generation_context_sha256,
      'manifestStorageBucket', claimed.manifest_storage_bucket,
      'manifestStoragePath', claimed.manifest_storage_path,
      'manifestSha256', claimed.manifest_sha256,
      'manifestSizeBytes', claimed.manifest_size_bytes,
      'payloadSha256', claimed.dispatch_payload_sha256,
      'archiveSha256', claimed.expected_archive_sha256,
      'archiveSizeBytes', claimed.expected_archive_size_bytes,
      'applicationNumber', claimed.application_number,
      'issueDate', claimed.issue_date,
      'validUntil', claimed.valid_until,
      'replayed', claimed.attempt_count > 1
    ));
  END LOOP;
  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.claim_bank_mail_agent_pdf_attachment_jobs(text, integer, integer) IS
  'Claims bounded automatic ESIS jobs with fenced leases. The response contains only exact mailbox/source locators and non-secret document expectations; no PESEL is returned here.';

REVOKE ALL ON FUNCTION public.claim_bank_mail_agent_pdf_attachment_jobs(text, integer, integer)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_bank_mail_agent_pdf_attachment_jobs(text, integer, integer)
  TO openexpert_service, openexpert_owner;

CREATE FUNCTION public.prove_bank_mail_agent_pdf_attachment_source(
  p_attachment_job_id uuid,
  p_lease_token text,
  p_intake_source_sha256 text,
  p_attachment_ordinal integer,
  p_attachment_token_sha256 text,
  p_archive_sha256 text,
  p_archive_size_bytes bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  attachment_row public.mail_bank_agent_attachments%rowtype;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  credential_value text;
  proof_now timestamptz := clock_timestamp();
  was_replay boolean;
BEGIN
  IF p_attachment_job_id IS NULL
    OR p_lease_token !~ '^[0-9a-f]{64}$'
    OR p_intake_source_sha256 !~ '^[0-9a-f]{64}$'
    OR p_attachment_ordinal NOT BETWEEN 0 AND 19
    OR p_attachment_token_sha256 !~ '^[0-9a-f]{64}$'
    OR p_archive_sha256 !~ '^[0-9a-f]{64}$'
    OR p_archive_size_bytes NOT BETWEEN 1 AND 5242880
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_pdf_source_proof'
      USING errcode = '22023';
  END IF;
  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_pdf_source_proof_claims_invalid'
      USING errcode = '42501';
  END;

  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.id = p_attachment_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_job_not_found'
      USING errcode = 'P0002';
  END IF;
  was_replay := job_row.state = 'unlocking';

  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'crm-bank-mail-pdf-proof-v1'
    OR jwt_claims ->> 'serviceId'
      IS DISTINCT FROM 'openexpert-crm-bank-mail-pdf-worker'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-pdf-attachment'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM job_row.organization_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM job_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM job_row.owner_user_id::text
    OR jwt_claims ->> 'attachmentJobId' IS DISTINCT FROM job_row.id::text
    OR jwt_claims ->> 'workerId' IS DISTINCT FROM job_row.locked_by
    OR jwt_claims ->> 'intakeSourceSha256' IS DISTINCT FROM p_intake_source_sha256
    OR jwt_claims ->> 'attachmentOrdinal'
      IS DISTINCT FROM p_attachment_ordinal::text
    OR jwt_claims ->> 'attachmentTokenSha256'
      IS DISTINCT FROM p_attachment_token_sha256
    OR jwt_claims ->> 'archiveSha256' IS DISTINCT FROM p_archive_sha256
    OR jwt_claims ->> 'archiveSizeBytes'
      IS DISTINCT FROM p_archive_size_bytes::text
    OR jwt_claims ->> 'generationContextSha256'
      IS DISTINCT FROM job_row.generation_context_sha256
    OR jwt_claims ->> 'manifestSha256'
      IS DISTINCT FROM job_row.manifest_sha256
    OR jwt_claims ->> 'manifestSizeBytes'
      IS DISTINCT FROM job_row.manifest_size_bytes::text
    OR jwt_claims ->> 'payloadSha256'
      IS DISTINCT FROM job_row.dispatch_payload_sha256
    OR job_row.lease_token_sha256 IS DISTINCT FROM encode(
      extensions.digest(convert_to(p_lease_token, 'utf8'), 'sha256'), 'hex'
    )
    OR job_row.lease_expires_at <= proof_now
    OR job_row.state NOT IN ('downloading', 'unlocking')
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_source_proof_claims_invalid'
      USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
  WHERE identity.id = job_row.bank_email_identity_id
  FOR SHARE OF identity, bank;
  IF NOT FOUND
    OR private.bank_mail_agent_pdf_job_scope_is_valid(job_row.id)
      IS DISTINCT FROM true
  THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'failed', resolution_code = 'canonical_link_invalid',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = proof_now
    WHERE job.id = job_row.id;
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id,
      'state', 'failed',
      'resolutionCode', 'canonical_link_invalid',
      'replayed', false
    );
  END IF;

  IF p_intake_source_sha256 IS DISTINCT FROM job_row.intake_source_sha256
    OR p_archive_sha256 IS DISTINCT FROM job_row.expected_archive_sha256
    OR p_archive_size_bytes IS DISTINCT FROM job_row.expected_archive_size_bytes
  THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'conflict', resolution_code = 'source_archive_mismatch',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = proof_now
    WHERE job.id = job_row.id;
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id,
      'state', 'conflict',
      'resolutionCode', 'source_archive_mismatch',
      'replayed', false
    );
  END IF;

  IF job_row.state = 'unlocking' THEN
    IF job_row.attachment_ordinal IS DISTINCT FROM p_attachment_ordinal
      OR job_row.attachment_token_sha256 IS DISTINCT FROM p_attachment_token_sha256
      OR job_row.observed_archive_sha256 IS DISTINCT FROM p_archive_sha256
      OR job_row.observed_archive_size_bytes IS DISTINCT FROM p_archive_size_bytes
    THEN
      RAISE EXCEPTION 'bank_mail_pdf_source_proof_replay_conflict'
        USING errcode = '23505';
    END IF;
  ELSE
    INSERT INTO public.mail_bank_agent_attachments (
      organization_id, owner_user_id, intake_id, attachment_ordinal,
      attachment_token_sha256, source_sha256, size_bytes, mime_category,
      encryption_status, scan_status, extraction_status
    ) VALUES (
      job_row.organization_id, job_row.owner_user_id, job_row.intake_id,
      p_attachment_ordinal, p_attachment_token_sha256, p_archive_sha256,
      p_archive_size_bytes, 'archive', 'encrypted', 'pending', 'pending'
    )
    ON CONFLICT (intake_id, attachment_ordinal) DO NOTHING
    RETURNING * INTO attachment_row;

    IF attachment_row.id IS NULL THEN
      SELECT attachment.* INTO STRICT attachment_row
      FROM public.mail_bank_agent_attachments AS attachment
      WHERE attachment.intake_id = job_row.intake_id
        AND attachment.attachment_ordinal = p_attachment_ordinal;
      IF attachment_row.attachment_token_sha256 IS DISTINCT FROM p_attachment_token_sha256
        OR attachment_row.source_sha256 IS DISTINCT FROM p_archive_sha256
        OR attachment_row.size_bytes IS DISTINCT FROM p_archive_size_bytes
        OR attachment_row.mime_category <> 'archive'
      THEN
        RAISE EXCEPTION 'bank_mail_pdf_attachment_quarantine_replay_conflict'
          USING errcode = '23505';
      END IF;
    END IF;

    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'unlocking', attachment_id = attachment_row.id,
        attachment_ordinal = p_attachment_ordinal,
        attachment_token_sha256 = p_attachment_token_sha256,
        observed_archive_sha256 = p_archive_sha256,
        observed_archive_size_bytes = p_archive_size_bytes
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;
  END IF;

  SELECT person.pesel INTO credential_value
  FROM public.crm_client_people AS person
  WHERE person.organization_id = job_row.organization_id
    AND person.client_id = job_row.primary_client_id
    AND person.id = job_row.primary_person_id
    AND person.role = 'primary'
    AND person.updated_at = job_row.primary_person_updated_at
    AND person.pesel ~ '^[0-9]{11}$'
  FOR SHARE;
  IF NOT FOUND THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'failed', resolution_code = 'canonical_link_invalid',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = proof_now
    WHERE job.id = job_row.id;
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id,
      'state', 'failed',
      'resolutionCode', 'canonical_link_invalid',
      'replayed', false
    );
  END IF;

  RETURN jsonb_build_object(
    'attachmentJobId', job_row.id,
    'state', 'unlocking',
    'credentialKind', 'primary_pesel',
    'credential', credential_value,
    'replayed', was_replay
  );
END;
$$;

COMMENT ON FUNCTION public.prove_bank_mail_agent_pdf_attachment_source(
  uuid, text, text, integer, text, text, bigint
) IS 'Proves exact canonical Gmail source and exact sent archive digest before resolving the current primary PESEL just in time. The secret is never persisted and this RPC is restricted to a signed, job-scoped CRM worker token.';

REVOKE ALL ON FUNCTION public.prove_bank_mail_agent_pdf_attachment_source(
  uuid, text, text, integer, text, text, bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.prove_bank_mail_agent_pdf_attachment_source(
  uuid, text, text, integer, text, text, bigint
) TO openexpert_service, openexpert_owner;

CREATE FUNCTION public.begin_bank_mail_agent_pdf_attachment_import(
  p_attachment_job_id uuid,
  p_lease_token text,
  p_pdf_sha256 text,
  p_pdf_size_bytes bigint,
  p_valid_until timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  cleanup_row public.crm_document_storage_cleanup_jobs%rowtype;
  attachment_row public.mail_bank_agent_attachments%rowtype;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  import_now timestamptz := clock_timestamp();
  storage_path_value text;
  was_importing boolean;
BEGIN
  IF p_attachment_job_id IS NULL
    OR p_lease_token !~ '^[0-9a-f]{64}$'
    OR p_pdf_sha256 !~ '^[0-9a-f]{64}$'
    OR p_pdf_size_bytes NOT BETWEEN 1 AND 4194304
    OR p_valid_until IS NULL
    OR NOT isfinite(p_valid_until)
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_pdf_import'
      USING errcode = '22023';
  END IF;
  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_pdf_import_claims_invalid'
      USING errcode = '42501';
  END;

  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.id = p_attachment_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_job_not_found'
      USING errcode = 'P0002';
  END IF;
  was_importing := job_row.state = 'importing';

  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'crm-bank-mail-pdf-import-v1'
    OR jwt_claims ->> 'serviceId'
      IS DISTINCT FROM 'openexpert-crm-bank-mail-pdf-worker'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-pdf-attachment'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM job_row.organization_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM job_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM job_row.owner_user_id::text
    OR jwt_claims ->> 'attachmentJobId' IS DISTINCT FROM job_row.id::text
    OR jwt_claims ->> 'workerId' IS DISTINCT FROM job_row.locked_by
    OR jwt_claims ->> 'pdfSha256' IS DISTINCT FROM p_pdf_sha256
    OR jwt_claims ->> 'pdfSizeBytes' IS DISTINCT FROM p_pdf_size_bytes::text
    OR (jwt_claims ->> 'validUntil')::timestamptz IS DISTINCT FROM p_valid_until
    OR job_row.lease_token_sha256 IS DISTINCT FROM encode(
      extensions.digest(convert_to(p_lease_token, 'utf8'), 'sha256'), 'hex'
    )
    OR job_row.lease_expires_at <= import_now
    OR job_row.state NOT IN ('unlocking', 'importing')
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_import_claims_invalid'
      USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
  WHERE identity.id = job_row.bank_email_identity_id
  FOR SHARE OF identity, bank;
  IF NOT FOUND
    OR private.bank_mail_agent_pdf_job_scope_is_valid(job_row.id)
      IS DISTINCT FROM true
    OR p_valid_until IS DISTINCT FROM job_row.valid_until
  THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'failed', resolution_code = 'canonical_link_invalid',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = import_now
    WHERE job.id = job_row.id;
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', 'failed',
      'resolutionCode', 'canonical_link_invalid', 'replayed', false
    );
  END IF;

  IF was_importing THEN
    IF job_row.pdf_sha256 IS DISTINCT FROM p_pdf_sha256
      OR job_row.pdf_size_bytes IS DISTINCT FROM p_pdf_size_bytes
    THEN
      RAISE EXCEPTION 'bank_mail_pdf_import_replay_conflict'
        USING errcode = '23505';
    END IF;

    -- A stale import lease may be reclaimed after the original 45-minute
    -- storage reservation became eligible for cleanup.  Fence the cleanup
    -- worker before returning the deterministic upload path: a completed or
    -- already-claimed cleanup job can never be re-armed safely because the
    -- deleter may have removed (or may currently be removing) the object.
    SELECT cleanup.* INTO cleanup_row
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE cleanup.id = job_row.cleanup_job_id
      AND cleanup.storage_bucket = job_row.storage_bucket
      AND cleanup.storage_path = job_row.storage_path
    FOR UPDATE;
    IF NOT FOUND
      OR cleanup_row.organization_id IS DISTINCT FROM job_row.organization_id
      OR cleanup_row.case_id IS DISTINCT FROM job_row.case_id
      OR cleanup_row.submission_id IS DISTINCT FROM job_row.application_id
      OR cleanup_row.purpose <> 'bank_mail_attachment_upload'
      OR cleanup_row.bank_mail_attachment_job_id IS DISTINCT FROM job_row.id
      OR cleanup_row.status <> 'reserved'
      OR cleanup_row.locked_at IS NOT NULL
    THEN
      UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
      SET state = 'conflict', resolution_code = 'storage_object_conflict',
          locked_by = NULL, lease_token_sha256 = NULL,
          lease_expires_at = NULL, completed_at = import_now
      WHERE job.id = job_row.id;
      RETURN jsonb_build_object(
        'attachmentJobId', job_row.id, 'state', 'conflict',
        'resolutionCode', 'storage_object_conflict', 'replayed', false
      );
    END IF;

    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET available_at = import_now + interval '45 minutes'
    WHERE cleanup.id = cleanup_row.id;
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id,
      'state', 'importing',
      'storageBucket', job_row.storage_bucket,
      'storagePath', job_row.storage_path,
      'fileName', job_row.pdf_file_name,
      'replayed', true
    );
  END IF;

  SELECT attachment.* INTO attachment_row
  FROM public.mail_bank_agent_attachments AS attachment
  WHERE attachment.id = job_row.attachment_id
    AND attachment.organization_id = job_row.organization_id
    AND attachment.owner_user_id = job_row.owner_user_id
    AND attachment.intake_id = job_row.intake_id
    AND attachment.source_sha256 = job_row.expected_archive_sha256
    AND attachment.size_bytes = job_row.expected_archive_size_bytes
    AND attachment.mime_category = 'archive'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_quarantine_state_invalid'
      USING errcode = '23514';
  END IF;

  IF attachment_row.encryption_status = 'unlocked'
    AND attachment_row.scan_status = 'clean'
    AND attachment_row.extraction_status = 'extracted'
    AND attachment_row.credential_kind_used = 'primary_pesel'
    AND attachment_row.derived_sha256 = p_pdf_sha256
    AND attachment_row.inspection_policy = 'openexpert_sent_artifact_sha256_v1'
    AND attachment_row.inspection_method
      = 'exact_dispatch_sha256_and_bounded_pdf_v1'
  THEN
    NULL;
  ELSIF attachment_row.encryption_status = 'encrypted'
    AND attachment_row.scan_status = 'pending'
    AND attachment_row.extraction_status = 'pending'
    AND attachment_row.credential_kind_used IS NULL
    AND attachment_row.derived_sha256 IS NULL
  THEN
    UPDATE public.mail_bank_agent_attachments AS attachment
    SET encryption_status = 'unlocked',
        scan_status = 'clean',
        extraction_status = 'extracted',
        credential_kind_used = 'primary_pesel',
        derived_sha256 = p_pdf_sha256,
        scanned_at = import_now,
        extracted_at = import_now,
        inspection_policy = 'openexpert_sent_artifact_sha256_v1',
        inspection_method = 'exact_dispatch_sha256_and_bounded_pdf_v1'
    WHERE attachment.id = attachment_row.id;
  ELSE
    RAISE EXCEPTION 'bank_mail_pdf_quarantine_replay_conflict'
      USING errcode = '23505';
  END IF;

  storage_path_value := job_row.organization_id::text || '/'
    || job_row.case_id::text || '/bank-mail-agent/' || job_row.id::text
    || '/' || job_row.pdf_file_name;

  INSERT INTO public.crm_document_storage_cleanup_jobs (
    organization_id, case_id, submission_id, purpose,
    storage_bucket, storage_path, status, available_at,
    bank_mail_attachment_job_id
  ) VALUES (
    job_row.organization_id, job_row.case_id, job_row.application_id,
    'bank_mail_attachment_upload', 'crm-case-documents', storage_path_value,
    'reserved', import_now + interval '45 minutes', job_row.id
  )
  ON CONFLICT (storage_bucket, storage_path) DO NOTHING
  RETURNING * INTO cleanup_row;

  IF cleanup_row.id IS NULL THEN
    SELECT cleanup.* INTO cleanup_row
    FROM public.crm_document_storage_cleanup_jobs AS cleanup
    WHERE cleanup.storage_bucket = 'crm-case-documents'
      AND cleanup.storage_path = storage_path_value
    FOR UPDATE;
    IF NOT FOUND
      OR cleanup_row.organization_id IS DISTINCT FROM job_row.organization_id
      OR cleanup_row.case_id IS DISTINCT FROM job_row.case_id
      OR cleanup_row.submission_id IS DISTINCT FROM job_row.application_id
      OR cleanup_row.purpose <> 'bank_mail_attachment_upload'
      OR cleanup_row.bank_mail_attachment_job_id IS DISTINCT FROM job_row.id
      OR cleanup_row.status <> 'reserved'
      OR cleanup_row.locked_at IS NOT NULL
    THEN
      UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
      SET state = 'conflict', resolution_code = 'storage_object_conflict',
          locked_by = NULL, lease_token_sha256 = NULL,
          lease_expires_at = NULL, completed_at = import_now
      WHERE job.id = job_row.id;
      RETURN jsonb_build_object(
        'attachmentJobId', job_row.id, 'state', 'conflict',
        'resolutionCode', 'storage_object_conflict', 'replayed', false
      );
    END IF;

    -- The row lock linearizes against cleanup claiming.  Move the deadline
    -- forward for the full upload/publish window before the path is disclosed.
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET available_at = import_now + interval '45 minutes'
    WHERE cleanup.id = cleanup_row.id;
  END IF;

  UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
  SET state = 'importing', pdf_sha256 = p_pdf_sha256,
      pdf_size_bytes = p_pdf_size_bytes, cleanup_job_id = cleanup_row.id,
      storage_bucket = 'crm-case-documents', storage_path = storage_path_value
  WHERE job.id = job_row.id
  RETURNING * INTO job_row;

  RETURN jsonb_build_object(
    'attachmentJobId', job_row.id,
    'state', job_row.state,
    'storageBucket', job_row.storage_bucket,
    'storagePath', job_row.storage_path,
    'fileName', job_row.pdf_file_name,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.begin_bank_mail_agent_pdf_attachment_import(
  uuid, text, text, bigint, timestamptz
) IS 'Pins the bounded extracted PDF and deterministic trusted-generated-artifact inspection, then reserves one private CRM document path. No PDF bytes or applicant secret enter PostgreSQL.';

REVOKE ALL ON FUNCTION public.begin_bank_mail_agent_pdf_attachment_import(
  uuid, text, text, bigint, timestamptz
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.begin_bank_mail_agent_pdf_attachment_import(
  uuid, text, text, bigint, timestamptz
) TO openexpert_service, openexpert_owner;

-- Preserve the existing downstream lifecycle assertion signature/OID. Manual
-- and real-bank artifacts still require the latest effective AI validation.
-- Only an exact typed 0087 OpenExpert mock ESIS may use the deterministic
-- trusted-generated proof branch.
CREATE OR REPLACE FUNCTION private.assert_crm_mortgage_artifact_ai_validation_current(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_artifact_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  artifact_row public.crm_mortgage_application_artifacts%rowtype;
  validation_row public.crm_mortgage_document_ai_validations%rowtype;
  trusted_row public.crm_mortgage_trusted_document_validations%rowtype;
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  process_stage text;
  validation_context jsonb;
  current_generation_context jsonb;
  latest_validation_id uuid;
  use_frozen_applicants boolean;
BEGIN
  SELECT artifact.* INTO artifact_row
  FROM public.crm_mortgage_application_artifacts AS artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.case_id = p_case_id
    AND artifact.application_id = p_application_id
    AND artifact.id = p_artifact_id
    AND artifact.kind IN ('esis', 'credit_decision');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_ai_validated_artifact_not_found'
      USING errcode = '23514';
  END IF;

  SELECT process.stage INTO process_stage
  FROM public.crm_mortgage_application_processes AS process
  WHERE process.organization_id = p_organization_id
    AND process.case_id = p_case_id
    AND process.application_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_process_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT process_stage <> 'pre_application' OR EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_parties AS party
    WHERE party.organization_id = p_organization_id
      AND party.case_id = p_case_id
      AND party.application_id = p_application_id
  ) INTO use_frozen_applicants;

  validation_context := private.crm_mortgage_document_validation_context(
    p_organization_id,
    p_case_id,
    p_application_id,
    use_frozen_applicants,
    artifact_row.kind,
    artifact_row.decision_outcome,
    artifact_row.valid_until
  );

  IF artifact_row.actor_kind = 'bank_mail_agent' THEN
    SELECT trusted.* INTO trusted_row
    FROM public.crm_mortgage_trusted_document_validations AS trusted
    WHERE trusted.id = artifact_row.trusted_document_validation_id
      AND trusted.bank_mail_attachment_job_id = artifact_row.bank_mail_attachment_job_id
      AND trusted.organization_id = artifact_row.organization_id
      AND trusted.case_id = artifact_row.case_id
      AND trusted.application_id = artifact_row.application_id
      AND trusted.document_id = artifact_row.document_id
      AND trusted.kind = artifact_row.kind
      AND trusted.source_sha256 = artifact_row.document_sha256;
    SELECT job.* INTO job_row
    FROM private.mail_bank_agent_pdf_attachment_jobs AS job
    WHERE job.id = artifact_row.bank_mail_attachment_job_id
      AND job.state = 'attached'
      AND job.document_id = artifact_row.document_id
      AND job.trusted_validation_id = trusted_row.id
      AND job.artifact_id = artifact_row.id;
    current_generation_context := private.crm_mock_bank_generation_context(
      job_row.dispatch_id,
      job_row.dispatch_payload_id,
      job_row.dispatch_generation,
      job_row.dispatch_generation_started_at
    );

    IF trusted_row.id IS NULL
      OR job_row.id IS NULL
      OR artifact_row.kind <> 'esis'
      OR artifact_row.ai_validation_id IS NOT NULL
      OR trusted_row.inspection_policy <> 'openexpert_sent_artifact_sha256_v1'
      OR trusted_row.inspection_method
        <> 'exact_dispatch_sha256_and_bounded_pdf_v1'
      OR trusted_row.generation_context_sha256
        IS DISTINCT FROM job_row.generation_context_sha256
      OR trusted_row.manifest_sha256 IS DISTINCT FROM job_row.manifest_sha256
      OR trusted_row.manifest_size_bytes
        IS DISTINCT FROM job_row.manifest_size_bytes
      OR trusted_row.dispatch_payload_sha256
        IS DISTINCT FROM job_row.dispatch_payload_sha256
      OR current_generation_context ->> 'generationContextSha256'
        IS DISTINCT FROM trusted_row.generation_context_sha256
      OR trusted_row.expected_archive_sha256
        IS DISTINCT FROM job_row.expected_archive_sha256
      OR trusted_row.observed_archive_sha256
        IS DISTINCT FROM job_row.expected_archive_sha256
      OR trusted_row.expected_archive_size_bytes
        IS DISTINCT FROM job_row.expected_archive_size_bytes
      OR trusted_row.observed_archive_size_bytes
        IS DISTINCT FROM job_row.expected_archive_size_bytes
      OR trusted_row.applicant_context_sha256
        IS DISTINCT FROM validation_context ->> 'applicantContextSha256'
      OR trusted_row.bank_context_sha256
        IS DISTINCT FROM validation_context ->> 'bankContextSha256'
      OR trusted_row.expectation_sha256
        IS DISTINCT FROM validation_context ->> 'expectationSha256'
      OR trusted_row.validated_bank_id::text
        IS DISTINCT FROM validation_context ->> 'bankId'
      OR trusted_row.validated_offer_id::text
        IS DISTINCT FROM validation_context ->> 'offerId'
      OR trusted_row.validated_loan_amount IS DISTINCT FROM
        nullif(validation_context ->> 'loanAmount', '')::numeric
      OR trusted_row.validated_currency
        IS DISTINCT FROM validation_context ->> 'currency'
      OR trusted_row.validated_valid_until IS DISTINCT FROM artifact_row.valid_until
      OR NOT EXISTS (
        SELECT 1
        FROM private.mail_bank_agent_pdf_attachment_provenance AS provenance
        WHERE provenance.attachment_job_id = job_row.id
          AND provenance.organization_id = artifact_row.organization_id
          AND provenance.intake_id = job_row.intake_id
          AND provenance.dispatch_id = job_row.dispatch_id
          AND provenance.dispatch_generation = job_row.dispatch_generation
          AND provenance.generation_context_sha256
            = job_row.generation_context_sha256
          AND provenance.dispatch_payload_sha256
            = job_row.dispatch_payload_sha256
          AND provenance.document_id = artifact_row.document_id
          AND provenance.trusted_validation_id = trusted_row.id
          AND provenance.artifact_id = artifact_row.id
          AND provenance.command_event_id = job_row.command_event_id
      )
    THEN
      RAISE EXCEPTION 'mortgage_artifact_trusted_validation_context_stale'
        USING errcode = '23514';
    END IF;
    RETURN;
  END IF;

  -- Original AI-only assertion for every non-0087 artifact.
  IF artifact_row.actor_kind <> 'user'
    OR artifact_row.bank_mail_attachment_job_id IS NOT NULL
    OR artifact_row.trusted_document_validation_id IS NOT NULL
  THEN
    RAISE EXCEPTION 'mortgage_artifact_ai_validation_context_stale'
      USING errcode = '23514';
  END IF;

  SELECT validation.* INTO validation_row
  FROM public.crm_mortgage_document_ai_validations AS validation
  WHERE validation.organization_id = artifact_row.organization_id
    AND validation.case_id = artifact_row.case_id
    AND validation.application_id = artifact_row.application_id
    AND validation.id = artifact_row.ai_validation_id;

  SELECT validation.id INTO latest_validation_id
  FROM public.crm_mortgage_document_ai_validations AS validation
  WHERE validation.organization_id = artifact_row.organization_id
    AND validation.case_id = artifact_row.case_id
    AND validation.application_id = artifact_row.application_id
    AND validation.document_id = artifact_row.document_id
    AND validation.expected_kind = artifact_row.kind
    AND validation.source_sha256 = artifact_row.document_sha256
  ORDER BY validation.validated_at DESC, validation.created_at DESC, validation.id DESC
  LIMIT 1;

  IF validation_row.id IS NULL
    OR latest_validation_id IS DISTINCT FROM validation_row.id
    OR NOT private.is_effective_crm_mortgage_ai_validation(
      validation_row.verdict,
      validation_row.expert_override_reason,
      validation_row.expert_overridden_at,
      validation_row.expert_overridden_by_user_id
    )
    OR validation_row.document_id IS DISTINCT FROM artifact_row.document_id
    OR validation_row.expected_kind IS DISTINCT FROM artifact_row.kind
    OR validation_row.source_sha256 IS DISTINCT FROM artifact_row.document_sha256
    OR validation_row.applicant_context_sha256 IS DISTINCT FROM
      validation_context ->> 'applicantContextSha256'
    OR validation_row.bank_context_sha256 IS DISTINCT FROM
      validation_context ->> 'bankContextSha256'
    OR validation_row.expectation_sha256 IS DISTINCT FROM
      validation_context ->> 'expectationSha256'
    OR validation_row.validated_bank_id::text IS DISTINCT FROM
      validation_context ->> 'bankId'
    OR validation_row.validated_offer_id::text IS DISTINCT FROM
      validation_context ->> 'offerId'
    OR validation_row.validated_decision_outcome IS DISTINCT FROM artifact_row.decision_outcome
    OR validation_row.validated_valid_until IS DISTINCT FROM artifact_row.valid_until
    OR validation_row.validated_loan_amount IS DISTINCT FROM
      nullif(validation_context ->> 'loanAmount', '')::numeric
    OR validation_row.validated_currency IS DISTINCT FROM
      validation_context ->> 'currency'
  THEN
    RAISE EXCEPTION 'mortgage_artifact_ai_validation_context_stale'
      USING errcode = '23514';
  END IF;
END;
$$;

CREATE FUNCTION private.execute_bank_mail_agent_trusted_esis_command(
  p_attachment_job_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  document_row public.crm_documents%rowtype;
  process_row public.crm_mortgage_application_processes%rowtype;
  trusted_row public.crm_mortgage_trusted_document_validations%rowtype;
  artifact_row public.crm_mortgage_application_artifacts%rowtype;
  event_row public.crm_mortgage_application_events%rowtype;
  current_context jsonb;
  command_now timestamptz := clock_timestamp();
  new_revision bigint;
BEGIN
  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.id = p_attachment_job_id
  FOR UPDATE;
  IF NOT FOUND OR job_row.state <> 'importing' THEN
    RAISE EXCEPTION 'bank_mail_pdf_import_command_state_invalid'
      USING errcode = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_pdf_publish_guards AS guard
    WHERE guard.attachment_job_id = job_row.id
      AND guard.application_id = job_row.application_id
      AND guard.transaction_id = txid_current()
  ) THEN
    RAISE EXCEPTION 'bank_mail_pdf_import_command_guard_required'
      USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = job_row.organization_id
    AND crm_case.id = job_row.case_id
    AND crm_case.owner_user_id = job_row.owner_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_case_scope_invalid'
      USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.crm_case_bank_applications AS application
  WHERE application.organization_id = job_row.organization_id
    AND application.case_id = job_row.case_id
    AND application.submission_id = job_row.application_id
    AND application.bank_id = job_row.validation_bank_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_application_scope_invalid'
      USING errcode = '42501';
  END IF;

  SELECT process.* INTO process_row
  FROM public.crm_mortgage_application_processes AS process
  WHERE process.organization_id = job_row.organization_id
    AND process.case_id = job_row.case_id
    AND process.application_id = job_row.application_id
  FOR UPDATE;
  IF NOT FOUND OR process_row.stage IN ('completed', 'closed') THEN
    RAISE EXCEPTION 'bank_mail_pdf_application_process_invalid'
      USING errcode = '23514';
  END IF;

  PERFORM private.bank_mail_agent_pdf_application_lock(
    job_row.organization_id, job_row.case_id, job_row.application_id
  );

  SELECT event.* INTO event_row
  FROM public.crm_mortgage_application_events AS event
  WHERE event.organization_id = job_row.organization_id
    AND event.case_id = job_row.case_id
    AND event.application_id = job_row.application_id
    AND event.command_id = job_row.id;
  IF FOUND THEN
    SELECT artifact.* INTO STRICT artifact_row
    FROM public.crm_mortgage_application_artifacts AS artifact
    WHERE artifact.bank_mail_attachment_job_id = job_row.id;
    RETURN jsonb_build_object(
      'applicationId', job_row.application_id,
      'artifactId', artifact_row.id,
      'trustedValidationId', artifact_row.trusted_document_validation_id,
      'eventId', event_row.id,
      'revision', event_row.aggregate_revision,
      'replayed', true
    );
  END IF;

  SELECT document.* INTO STRICT document_row
  FROM public.crm_documents AS document
  WHERE document.id = job_row.document_id
    AND document.organization_id = job_row.organization_id
    AND document.case_id = job_row.case_id
    AND document.submission_id = job_row.application_id
    AND document.bank_mail_attachment_job_id = job_row.id
    AND document.actor_kind = 'bank_mail_agent'
    AND document.document_type = 'mortgage_esis'
    AND document.mime_type = 'application/pdf'
    AND document.sha256 = job_row.pdf_sha256
    AND document.size_bytes = job_row.pdf_size_bytes
    AND document.storage_bucket = job_row.storage_bucket
    AND document.storage_path = job_row.storage_path;

  IF EXISTS (
    SELECT 1 FROM public.crm_documents AS other_document
    WHERE other_document.organization_id = job_row.organization_id
      AND other_document.case_id = job_row.case_id
      AND other_document.submission_id = job_row.application_id
      AND other_document.document_type = 'mortgage_esis'
      AND other_document.id <> document_row.id
  ) OR EXISTS (
    SELECT 1 FROM public.crm_mortgage_application_artifacts AS other_artifact
    WHERE other_artifact.organization_id = job_row.organization_id
      AND other_artifact.case_id = job_row.case_id
      AND other_artifact.application_id = job_row.application_id
      AND other_artifact.kind = 'esis'
  ) THEN
    RAISE EXCEPTION 'bank_mail_pdf_existing_esis_conflict'
      USING errcode = '23505';
  END IF;

  current_context := private.crm_mortgage_document_validation_context(
    job_row.organization_id,
    job_row.case_id,
    job_row.application_id,
    process_row.stage <> 'pre_application',
    'esis', NULL, job_row.valid_until
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
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_validation_context_stale'
      USING errcode = '23514';
  END IF;

  INSERT INTO public.crm_mortgage_trusted_document_validations (
    bank_mail_attachment_job_id, organization_id, case_id, application_id,
    document_id, kind, source_sha256, bank_email_identity_id,
    dispatch_id, dispatch_generation, generation_context_sha256,
    manifest_sha256, manifest_size_bytes, dispatch_payload_sha256,
    expected_archive_sha256,
    expected_archive_size_bytes, observed_archive_sha256,
    observed_archive_size_bytes, applicant_context_sha256,
    bank_context_sha256, expectation_sha256, validated_bank_id,
    validated_offer_id, validated_loan_amount, validated_currency,
    validated_valid_until, validated_at
  ) VALUES (
    job_row.id, job_row.organization_id, job_row.case_id, job_row.application_id,
    document_row.id, 'esis', document_row.sha256,
    job_row.bank_email_identity_id, job_row.dispatch_id,
    job_row.dispatch_generation, job_row.generation_context_sha256,
    job_row.manifest_sha256, job_row.manifest_size_bytes,
    job_row.dispatch_payload_sha256,
    job_row.expected_archive_sha256,
    job_row.expected_archive_size_bytes, job_row.observed_archive_sha256,
    job_row.observed_archive_size_bytes, job_row.applicant_context_sha256,
    job_row.bank_context_sha256, job_row.expectation_sha256,
    job_row.validation_bank_id, job_row.validation_offer_id,
    job_row.validation_loan_amount, job_row.validation_currency,
    job_row.valid_until, command_now
  ) RETURNING * INTO trusted_row;

  INSERT INTO public.crm_mortgage_application_artifacts (
    organization_id, case_id, application_id, kind, version,
    document_id, document_name, document_sha256, document_mime_type,
    document_size_bytes, document_storage_bucket, document_storage_path,
    issued_at, received_at, valid_from, valid_until, decision_outcome,
    ai_validation_id, trusted_document_validation_id,
    related_esis_artifact_id, related_decision_artifact_id,
    supersedes_artifact_id, created_by_user_id,
    bank_mail_attachment_job_id, actor_kind, metadata
  ) VALUES (
    job_row.organization_id, job_row.case_id, job_row.application_id,
    'esis', 1, document_row.id, document_row.name, document_row.sha256,
    document_row.mime_type, document_row.size_bytes,
    document_row.storage_bucket, document_row.storage_path,
    (job_row.issue_date::text || 'T00:00:00Z')::timestamptz,
    command_now, NULL, job_row.valid_until, NULL,
    NULL, trusted_row.id, NULL, NULL, NULL, NULL,
    job_row.id, 'bank_mail_agent',
    jsonb_build_object(
      'source', 'openexpert_bank_mail_agent',
      'inspectionPolicy', 'openexpert_sent_artifact_sha256_v1'
    )
  ) RETURNING * INTO artifact_row;

  INSERT INTO private.crm_mortgage_application_command_guards (
    application_id, transaction_id
  ) VALUES (job_row.application_id, txid_current())
  ON CONFLICT DO NOTHING;

  new_revision := process_row.revision + 1;
  UPDATE public.crm_mortgage_application_processes AS process
  SET revision = new_revision,
      stage = CASE
        WHEN process.stage IN (
          'decision_received', 'decision_delivered',
          'agreement_review', 'ready_for_contract'
        ) THEN 'under_review'
        ELSE process.stage
      END,
      decision_received_at = CASE
        WHEN process.stage IN (
          'decision_received', 'decision_delivered',
          'agreement_review', 'ready_for_contract'
        ) THEN NULL ELSE process.decision_received_at END,
      decision_outcome = CASE
        WHEN process.stage IN (
          'decision_received', 'decision_delivered',
          'agreement_review', 'ready_for_contract'
        ) THEN NULL ELSE process.decision_outcome END,
      updated_by_user_id = NULL
  WHERE process.application_id = job_row.application_id;

  IF process_row.stage IN (
    'decision_received', 'decision_delivered',
    'agreement_review', 'ready_for_contract'
  ) THEN
    UPDATE public.crm_item_submissions AS submission
    SET status_code = 'w_analizie', decision_at = NULL
    WHERE submission.organization_id = job_row.organization_id
      AND submission.id = job_row.application_id;
  END IF;

  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload,
    bank_mail_attachment_job_id, actor_kind
  ) VALUES (
    job_row.organization_id, job_row.case_id, job_row.application_id,
    new_revision, job_row.id, 'artifact_attached', NULL, command_now,
    jsonb_build_object(
      'command', jsonb_build_object(
        'type', 'attach_trusted_openexpert_mock_esis',
        'documentId', document_row.id
      ),
      'result', jsonb_build_object(
        'applicationId', job_row.application_id,
        'artifactId', artifact_row.id,
        'revision', new_revision
      )
    ),
    job_row.id, 'bank_mail_agent'
  ) RETURNING * INTO event_row;

  DELETE FROM private.crm_mortgage_application_command_guards AS guard
  WHERE guard.application_id = job_row.application_id
    AND guard.transaction_id = txid_current();

  RETURN jsonb_build_object(
    'applicationId', job_row.application_id,
    'artifactId', artifact_row.id,
    'trustedValidationId', trusted_row.id,
    'eventId', event_row.id,
    'revision', new_revision,
    'replayed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.execute_bank_mail_agent_trusted_esis_command(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.execute_bank_mail_agent_trusted_esis_command(uuid)
  TO openexpert_owner;

CREATE OR REPLACE FUNCTION public.execute_crm_mortgage_application_command(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  organization_id_value uuid;
  case_id_value uuid;
  application_id_value uuid;
  actor_user_id_value uuid;
  command_id_value uuid;
  expected_revision_value bigint;
  command_value jsonb;
  command_type text;
  process_row public.crm_mortgage_application_processes%rowtype;
  application_row public.crm_case_bank_applications%rowtype;
  existing_event public.crm_mortgage_application_events%rowtype;
  event_type_value text;
  event_at_value timestamptz := statement_timestamp();
  result_value jsonb;
  new_revision bigint;
  artifact_kind text;
  document_id_value uuid;
  document_row public.crm_documents%rowtype;
  ai_validation_row public.crm_mortgage_document_ai_validations%rowtype;
  artifact_row public.crm_mortgage_application_artifacts%rowtype;
  previous_artifact public.crm_mortgage_application_artifacts%rowtype;
  supersedes_id_value uuid;
  artifact_version integer;
  issued_at_value timestamptz;
  received_at_value timestamptz;
  valid_from_value timestamptz;
  valid_until_value timestamptz;
  outcome_value text;
  metadata_value jsonb;
  deliveries_value jsonb;
  occurred_value timestamptz;
  client_id_value uuid;
  decision_value text;
  channel_value text;
  evidence_value text;
  consent_document_id uuid;
  required_count integer;
  delivered_count integer;
  latest_delivery_at timestamptz;
  actor_membership_role text;
  case_owner_user_id uuid;
  item_owner_user_id uuid;
  expected_document_type text;
  related_esis_id uuid;
  related_decision_id uuid;
  linked_artifact public.crm_mortgage_application_artifacts%rowtype;
  allowed_command_fields text[];
  applicant_context_value jsonb;
  validation_context_value jsonb;
BEGIN
  IF jsonb_typeof(p_request) <> 'object'
    OR pg_column_size(p_request) > 524288
    OR p_request - ARRAY[
      'organizationId', 'caseId', 'applicationId', 'actorUserId',
      'commandId', 'expectedRevision', 'command'
    ]::text[] <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'invalid_mortgage_command_envelope' USING errcode = '22023';
  END IF;

  organization_id_value := nullif(p_request ->> 'organizationId', '')::uuid;
  case_id_value := nullif(p_request ->> 'caseId', '')::uuid;
  application_id_value := nullif(p_request ->> 'applicationId', '')::uuid;
  actor_user_id_value := nullif(p_request ->> 'actorUserId', '')::uuid;
  command_id_value := nullif(p_request ->> 'commandId', '')::uuid;
  expected_revision_value := nullif(p_request ->> 'expectedRevision', '')::bigint;
  command_value := p_request -> 'command';
  command_type := nullif(command_value ->> 'type', '');

  IF organization_id_value IS NULL OR case_id_value IS NULL
    OR application_id_value IS NULL OR actor_user_id_value IS NULL
    OR command_id_value IS NULL OR expected_revision_value IS NULL
    OR expected_revision_value < 0 OR jsonb_typeof(command_value) <> 'object'
    OR command_type IS NULL
  THEN
    RAISE EXCEPTION 'invalid_mortgage_command_envelope' USING errcode = '22023';
  END IF;

  allowed_command_fields := CASE command_type
    WHEN 'attach_artifact' THEN ARRAY[
      'type', 'kind', 'documentId', 'issuedAt', 'receivedAt', 'validFrom',
      'validUntil', 'decisionOutcome', 'supersedesArtifactId', 'metadata',
      'deliveries'
    ]
    WHEN 'deliver_artifact' THEN ARRAY['type', 'artifactId', 'recipients']
    WHEN 'submit_application' THEN ARRAY['type', 'submittedAt']
    WHEN 'acknowledge_application' THEN ARRAY['type', 'acknowledgedAt']
    WHEN 'confirm_completeness' THEN ARRAY['type', 'confirmedAt']
    WHEN 'request_additional_information' THEN ARRAY['type', 'requestedAt']
    WHEN 'resume_review' THEN ARRAY['type', 'resumedAt']
    WHEN 'record_early_decision_consent' THEN ARRAY[
      'type', 'clientId', 'decision', 'capturedAt', 'channel',
      'evidenceReference', 'documentId', 'metadata'
    ]
    WHEN 'complete_application' THEN ARRAY['type', 'completedAt']
    WHEN 'close_application' THEN ARRAY['type', 'closedAt']
    ELSE NULL
  END;
  IF allowed_command_fields IS NULL
    OR command_value - allowed_command_fields <> '{}'::jsonb
  THEN
    RAISE EXCEPTION 'unsupported_mortgage_application_command_fields'
      USING errcode = '22023';
  END IF;

  -- Authorization and aggregate-scope locks intentionally precede idempotent
  -- replay. A leaked command UUID must never become a read capability after
  -- the actor loses membership or case ownership.
  SELECT membership.role INTO actor_membership_role
  FROM public.organization_memberships membership
  WHERE membership.organization_id = organization_id_value
    AND membership.user_id = actor_user_id_value
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_command_actor_not_organization_member'
      USING errcode = '42501';
  END IF;

  SELECT crm_case.owner_user_id INTO case_owner_user_id
  FROM public.crm_cases crm_case
  WHERE crm_case.organization_id = organization_id_value
    AND crm_case.id = case_id_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_case_not_found' USING errcode = 'P0002';
  END IF;

  SELECT application.*
  INTO application_row
  FROM public.crm_case_bank_applications application
  WHERE application.organization_id = organization_id_value
    AND application.case_id = case_id_value
    AND application.submission_id = application_id_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_not_found' USING errcode = 'P0002';
  END IF;
  SELECT item.owner_user_id INTO item_owner_user_id
  FROM public.crm_case_items item
  WHERE item.organization_id = application_row.organization_id
    AND item.case_id = application_row.case_id
    AND item.id = application_row.case_item_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_item_not_found' USING errcode = 'P0002';
  END IF;

  IF actor_membership_role <> 'admin'
    AND case_owner_user_id IS DISTINCT FROM actor_user_id_value
    AND item_owner_user_id IS DISTINCT FROM actor_user_id_value
  THEN
    RAISE EXCEPTION 'mortgage_case_manager_permission_required'
      USING errcode = '42501';
  END IF;

  SELECT process.* INTO process_row
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = organization_id_value
    AND process.case_id = case_id_value
    AND process.application_id = application_id_value
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_process_not_found' USING errcode = 'P0002';
  END IF;

  SELECT event.* INTO existing_event
  FROM public.crm_mortgage_application_events event
  WHERE event.organization_id = organization_id_value
    AND event.case_id = case_id_value
    AND event.application_id = application_id_value
    AND event.command_id = command_id_value;
  IF FOUND THEN
    IF existing_event.payload -> 'command' IS DISTINCT FROM command_value THEN
      RAISE EXCEPTION 'mortgage_command_idempotency_conflict' USING errcode = '23505';
    END IF;
    RETURN existing_event.payload -> 'result';
  END IF;

  IF process_row.revision <> expected_revision_value THEN
    RAISE EXCEPTION 'mortgage_application_revision_conflict'
      USING errcode = '40001';
  END IF;

  IF process_row.stage IN ('completed', 'closed')
    AND command_type NOT IN ('close_application')
  THEN
    RAISE EXCEPTION 'mortgage_application_is_terminal' USING errcode = '23514';
  END IF;

  INSERT INTO private.crm_mortgage_application_command_guards (
    application_id, transaction_id
  ) VALUES (
    application_id_value, txid_current()
  ) ON CONFLICT DO NOTHING;

  new_revision := process_row.revision + 1;

  IF command_type = 'attach_artifact' THEN
    artifact_kind := nullif(command_value ->> 'kind', '');
    document_id_value := nullif(command_value ->> 'documentId', '')::uuid;
    IF artifact_kind NOT IN ('esis', 'credit_decision', 'draft_credit_agreement')
      OR document_id_value IS NULL
    THEN
      RAISE EXCEPTION 'invalid_mortgage_artifact' USING errcode = '22023';
    END IF;

    expected_document_type := CASE artifact_kind
      WHEN 'esis' THEN 'mortgage_esis'
      WHEN 'credit_decision' THEN 'mortgage_credit_decision'
      WHEN 'draft_credit_agreement' THEN 'mortgage_draft_credit_agreement'
    END;

    SELECT document.* INTO document_row
    FROM public.crm_documents document
    WHERE document.id = document_id_value
      AND document.organization_id = organization_id_value
      AND document.case_id = case_id_value
      AND document.submission_id = application_id_value
      AND document.document_type = expected_document_type
      AND document.mime_type = 'application/pdf'
      AND document.size_bytes BETWEEN 1 AND 26214400
      AND document.sha256 ~ '^[0-9a-f]{64}$'
      AND document.storage_bucket IS NOT NULL
      AND document.storage_path IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mortgage_artifact_document_invalid_or_out_of_scope'
        USING errcode = '23514';
    END IF;

    IF artifact_kind IN ('esis', 'credit_decision') THEN
      PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(
          application_id_value::text || ':' || document_row.id::text || ':' || artifact_kind,
          0
        )
      );
      -- Select the absolute latest exact-scope validation first. An earlier
      -- accepted verdict cannot override a later needs_review/rejected result.
      SELECT validation.* INTO ai_validation_row
      FROM public.crm_mortgage_document_ai_validations validation
      WHERE validation.organization_id = organization_id_value
        AND validation.case_id = case_id_value
        AND validation.application_id = application_id_value
        AND validation.document_id = document_row.id
        AND validation.expected_kind = artifact_kind
        AND validation.source_sha256 = document_row.sha256
      ORDER BY validation.validated_at DESC, validation.created_at DESC, validation.id DESC
      LIMIT 1;
      IF NOT FOUND OR NOT private.is_effective_crm_mortgage_ai_validation(
        ai_validation_row.verdict,
        ai_validation_row.expert_override_reason,
        ai_validation_row.expert_overridden_at,
        ai_validation_row.expert_overridden_by_user_id
      ) THEN
        RAISE EXCEPTION 'accepted_mortgage_document_ai_validation_required'
          USING errcode = '23514';
      END IF;
      applicant_context_value := private.crm_mortgage_applicant_context(
        organization_id_value,
        case_id_value,
        application_id_value,
        process_row.stage <> 'pre_application'
      );
      IF ai_validation_row.applicant_context_sha256 IS DISTINCT FROM
          applicant_context_value ->> 'applicantContextSha256'
      THEN
        RAISE EXCEPTION 'mortgage_document_ai_validation_applicant_context_stale'
          USING errcode = '23514';
      END IF;
    ELSE
      ai_validation_row.id := NULL;
    END IF;

    issued_at_value := nullif(command_value ->> 'issuedAt', '')::timestamptz;
    received_at_value := coalesce(
      nullif(command_value ->> 'receivedAt', '')::timestamptz,
      document_row.received_at,
      statement_timestamp()
    );
    valid_from_value := nullif(command_value ->> 'validFrom', '')::timestamptz;
    valid_until_value := nullif(command_value ->> 'validUntil', '')::timestamptz;
    outcome_value := nullif(command_value ->> 'decisionOutcome', '');
    metadata_value := coalesce(command_value -> 'metadata', '{}'::jsonb);
    deliveries_value := coalesce(command_value -> 'deliveries', '[]'::jsonb);
    supersedes_id_value := nullif(command_value ->> 'supersedesArtifactId', '')::uuid;

    IF NOT isfinite(received_at_value)
      OR (issued_at_value IS NOT NULL AND NOT isfinite(issued_at_value))
      OR (valid_from_value IS NOT NULL AND NOT isfinite(valid_from_value))
      OR (valid_until_value IS NOT NULL AND NOT isfinite(valid_until_value))
      OR received_at_value > statement_timestamp() + interval '5 minutes'
      OR (issued_at_value IS NOT NULL AND received_at_value < issued_at_value - interval '1 day')
      OR (valid_from_value IS NOT NULL AND valid_until_value IS NOT NULL AND valid_until_value <= valid_from_value)
      OR jsonb_typeof(metadata_value) <> 'object'
    THEN
      RAISE EXCEPTION 'invalid_mortgage_artifact_dates_or_metadata' USING errcode = '22023';
    END IF;

    IF artifact_kind = 'credit_decision' THEN
      IF process_row.stage NOT IN (
        'under_review', 'decision_received', 'decision_delivered',
        'agreement_review', 'ready_for_contract'
      ) THEN
        RAISE EXCEPTION 'credit_decision_requires_confirmed_completeness'
          USING errcode = '23514';
      END IF;
      IF outcome_value NOT IN ('positive', 'negative') THEN
        RAISE EXCEPTION 'credit_decision_outcome_required' USING errcode = '22023';
      END IF;
      IF outcome_value = 'positive' AND valid_until_value IS NULL THEN
        RAISE EXCEPTION 'positive_decision_binding_period_required' USING errcode = '23514';
      END IF;
      IF process_row.completeness_confirmed_at IS NOT NULL
        AND received_at_value < process_row.completeness_confirmed_at
      THEN
        RAISE EXCEPTION 'credit_decision_cannot_predate_confirmed_completeness'
          USING errcode = '23514';
      END IF;

      SELECT artifact.* INTO linked_artifact
      FROM public.crm_mortgage_application_artifacts artifact
      WHERE artifact.organization_id = organization_id_value
        AND artifact.case_id = case_id_value
        AND artifact.application_id = application_id_value
        AND artifact.kind = 'esis'
      ORDER BY artifact.version DESC
      LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'current_esis_required_for_credit_decision'
          USING errcode = '23514';
      END IF;
      IF linked_artifact.received_at > received_at_value THEN
        RAISE EXCEPTION 'credit_decision_cannot_predate_related_esis'
          USING errcode = '23514';
      END IF;
      related_esis_id := linked_artifact.id;

      IF outcome_value = 'positive'
        AND valid_until_value < greatest(
          received_at_value,
          coalesce(process_row.decision_due_at, received_at_value)
        ) + interval '14 days'
      THEN
        RAISE EXCEPTION 'positive_decision_binding_period_too_short'
          USING errcode = '23514';
      END IF;
    ELSE
      IF outcome_value IS NOT NULL THEN
        RAISE EXCEPTION 'decision_outcome_only_allowed_for_credit_decision'
          USING errcode = '22023';
      END IF;
      IF artifact_kind = 'esis' AND valid_until_value IS NULL THEN
        RAISE EXCEPTION 'esis_validity_period_required' USING errcode = '23514';
      END IF;
      IF artifact_kind = 'draft_credit_agreement'
        AND (
          process_row.decision_outcome IS DISTINCT FROM 'positive'
          OR process_row.stage NOT IN (
            'decision_delivered', 'agreement_review', 'ready_for_contract'
          )
        )
      THEN
        RAISE EXCEPTION 'draft_agreement_requires_delivered_positive_decision'
          USING errcode = '23514';
      END IF;
      IF artifact_kind = 'draft_credit_agreement'
        AND received_at_value < process_row.decision_received_at
      THEN
        RAISE EXCEPTION 'draft_agreement_cannot_predate_credit_decision'
          USING errcode = '23514';
      END IF;
      IF artifact_kind = 'draft_credit_agreement' THEN
        SELECT artifact.* INTO linked_artifact
        FROM public.crm_mortgage_application_artifacts artifact
        WHERE artifact.organization_id = organization_id_value
          AND artifact.case_id = case_id_value
          AND artifact.application_id = application_id_value
          AND artifact.kind = 'credit_decision'
        ORDER BY artifact.version DESC
        LIMIT 1;
        IF NOT FOUND OR linked_artifact.decision_outcome IS DISTINCT FROM 'positive' THEN
          RAISE EXCEPTION 'current_positive_decision_required_for_draft_agreement'
            USING errcode = '23514';
        END IF;
        related_decision_id := linked_artifact.id;
      END IF;
    END IF;

    IF artifact_kind IN ('esis', 'credit_decision') THEN
      validation_context_value := private.crm_mortgage_document_validation_context(
        organization_id_value,
        case_id_value,
        application_id_value,
        process_row.stage <> 'pre_application',
        artifact_kind,
        outcome_value,
        valid_until_value
      );
      IF ai_validation_row.expectation_sha256 IS DISTINCT FROM
          validation_context_value ->> 'expectationSha256'
        OR ai_validation_row.bank_context_sha256 IS DISTINCT FROM
          validation_context_value ->> 'bankContextSha256'
        OR ai_validation_row.validated_bank_id::text IS DISTINCT FROM
          validation_context_value ->> 'bankId'
        OR ai_validation_row.validated_offer_id::text IS DISTINCT FROM
          validation_context_value ->> 'offerId'
        OR ai_validation_row.validated_decision_outcome IS DISTINCT FROM outcome_value
        OR ai_validation_row.validated_valid_until IS DISTINCT FROM valid_until_value
        OR ai_validation_row.validated_loan_amount IS DISTINCT FROM
          nullif(validation_context_value ->> 'loanAmount', '')::numeric
        OR ai_validation_row.validated_currency IS DISTINCT FROM
          validation_context_value ->> 'currency'
      THEN
        RAISE EXCEPTION 'mortgage_document_ai_validation_artifact_payload_mismatch'
          USING errcode = '23514';
      END IF;
    END IF;

    SELECT artifact.* INTO previous_artifact
    FROM public.crm_mortgage_application_artifacts artifact
    WHERE artifact.application_id = application_id_value
      AND artifact.kind = artifact_kind
    ORDER BY artifact.version DESC
    LIMIT 1;

    IF supersedes_id_value IS NOT NULL
      AND (previous_artifact.id IS NULL OR previous_artifact.id <> supersedes_id_value)
    THEN
      RAISE EXCEPTION 'superseded_mortgage_artifact_is_not_current'
        USING errcode = '23514';
    END IF;
    IF previous_artifact.id IS NOT NULL THEN
      IF received_at_value < previous_artifact.received_at THEN
        RAISE EXCEPTION 'mortgage_artifact_received_time_must_be_monotonic'
          USING errcode = '23514';
      END IF;
      supersedes_id_value := previous_artifact.id;
      artifact_version := previous_artifact.version + 1;
    ELSE
      IF supersedes_id_value IS NOT NULL THEN
        RAISE EXCEPTION 'superseded_mortgage_artifact_not_found' USING errcode = 'P0002';
      END IF;
      artifact_version := 1;
    END IF;

    INSERT INTO public.crm_mortgage_application_artifacts (
      organization_id, case_id, application_id, kind, version,
      document_id, document_name, document_sha256, document_mime_type,
      document_size_bytes, document_storage_bucket, document_storage_path,
      issued_at, received_at, valid_from, valid_until, decision_outcome,
      ai_validation_id,
      related_esis_artifact_id, related_decision_artifact_id,
      supersedes_artifact_id, created_by_user_id, metadata
    ) VALUES (
      organization_id_value, case_id_value, application_id_value, artifact_kind, artifact_version,
      document_row.id, document_row.name, document_row.sha256, document_row.mime_type,
      document_row.size_bytes, document_row.storage_bucket, document_row.storage_path,
      issued_at_value, received_at_value, valid_from_value, valid_until_value, outcome_value,
      ai_validation_row.id,
      related_esis_id, related_decision_id,
      supersedes_id_value, actor_user_id_value, metadata_value
    ) RETURNING * INTO artifact_row;

    PERFORM private.record_crm_mortgage_artifact_deliveries(
      organization_id_value, case_id_value, application_id_value,
      artifact_row.id, process_row.stage, actor_user_id_value, deliveries_value
    );

    IF artifact_kind = 'credit_decision' THEN
      PERFORM private.assert_crm_mortgage_decision_deliveries_have_current_esis(
        organization_id_value, case_id_value, application_id_value, artifact_row.id
      );
      SELECT max(delivery.delivered_at) INTO latest_delivery_at
      FROM public.crm_mortgage_artifact_deliveries delivery
      WHERE delivery.artifact_id = artifact_row.id;
      IF outcome_value = 'positive'
        AND latest_delivery_at IS NOT NULL
        AND valid_until_value < greatest(
          latest_delivery_at,
          coalesce(process_row.decision_due_at, latest_delivery_at)
        ) + interval '14 days'
      THEN
        RAISE EXCEPTION 'positive_decision_binding_period_too_short_for_delivery'
          USING errcode = '23514';
      END IF;

      SELECT count(*) INTO required_count
      FROM public.crm_mortgage_application_parties party
      WHERE party.application_id = application_id_value;
      SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
      FROM public.crm_mortgage_artifact_deliveries delivery
      JOIN public.crm_mortgage_application_parties party
        ON party.application_id = delivery.application_id
       AND party.client_id = delivery.recipient_client_id
      WHERE delivery.artifact_id = artifact_row.id;

      UPDATE public.crm_mortgage_application_processes
      SET
        stage = CASE
          WHEN required_count > 0 AND delivered_count = required_count
            THEN 'decision_delivered'
          ELSE 'decision_received'
        END,
        decision_received_at = received_at_value,
        decision_outcome = outcome_value,
        updated_by_user_id = actor_user_id_value
      WHERE application_id = application_id_value;
      IF process_row.stage = 'ready_for_contract' THEN
        UPDATE public.crm_item_submissions
        SET status_code = 'w_analizie', decision_at = NULL
        WHERE organization_id = organization_id_value
          AND case_item_id = application_row.case_item_id
          AND id = application_id_value;
      END IF;
    ELSIF artifact_kind = 'draft_credit_agreement' THEN
      SELECT count(*) INTO required_count
      FROM public.crm_mortgage_application_parties party
      WHERE party.application_id = application_id_value;
      SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
      FROM public.crm_mortgage_artifact_deliveries delivery
      JOIN public.crm_mortgage_application_parties party
        ON party.application_id = delivery.application_id
       AND party.client_id = delivery.recipient_client_id
      WHERE delivery.artifact_id = artifact_row.id;
      UPDATE public.crm_mortgage_application_processes
      SET
        stage = CASE
          WHEN required_count > 0 AND delivered_count = required_count
            THEN 'agreement_review'
          ELSE 'decision_delivered'
        END,
        updated_by_user_id = actor_user_id_value
      WHERE application_id = application_id_value;
    ELSIF artifact_kind = 'esis'
      AND process_row.stage IN (
        'decision_received', 'decision_delivered', 'agreement_review',
        'ready_for_contract'
      )
    THEN
      -- A newer ESIS makes the former decision/agreement package stale. Keep
      -- the immutable evidence, but require a renewed decision bound to this
      -- newest ESIS before the application can become contract-ready again.
      UPDATE public.crm_mortgage_application_processes
      SET stage = 'under_review',
          decision_received_at = NULL,
          decision_outcome = NULL,
          updated_by_user_id = actor_user_id_value
      WHERE application_id = application_id_value;
      UPDATE public.crm_item_submissions
      SET status_code = 'w_analizie', decision_at = NULL
      WHERE organization_id = organization_id_value
        AND case_item_id = application_row.case_item_id
        AND id = application_id_value;
    END IF;

    event_type_value := 'artifact_attached';
    event_at_value := received_at_value;
    result_value := jsonb_build_object(
      'applicationId', application_id_value,
      'artifactId', artifact_row.id
    );

  ELSIF command_type = 'deliver_artifact' THEN
    artifact_row.id := nullif(command_value ->> 'artifactId', '')::uuid;
    deliveries_value := coalesce(command_value -> 'recipients', command_value -> 'deliveries');
    IF artifact_row.id IS NULL OR deliveries_value IS NULL
      OR jsonb_typeof(deliveries_value) <> 'array'
      OR jsonb_array_length(deliveries_value) = 0
    THEN
      RAISE EXCEPTION 'artifact_and_recipients_required' USING errcode = '22023';
    END IF;

    SELECT artifact.* INTO artifact_row
    FROM public.crm_mortgage_application_artifacts artifact
    WHERE artifact.organization_id = organization_id_value
      AND artifact.case_id = case_id_value
      AND artifact.application_id = application_id_value
      AND artifact.id = artifact_row.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mortgage_artifact_not_found' USING errcode = 'P0002';
    END IF;
    IF (artifact_row.kind = 'credit_decision'
          AND process_row.stage NOT IN ('decision_received', 'decision_delivered'))
      OR (artifact_row.kind = 'draft_credit_agreement'
          AND process_row.stage NOT IN (
            'decision_delivered', 'agreement_review', 'ready_for_contract'
          ))
    THEN
      RAISE EXCEPTION 'mortgage_artifact_delivery_invalid_for_process_stage'
        USING errcode = '23514';
    END IF;
    PERFORM 1
    FROM public.crm_mortgage_application_artifacts newer
    WHERE newer.application_id = application_id_value
      AND newer.kind = artifact_row.kind
      AND newer.version > artifact_row.version;
    IF FOUND THEN
      RAISE EXCEPTION 'only_current_mortgage_artifact_may_be_delivered'
        USING errcode = '23514';
    END IF;

    PERFORM private.record_crm_mortgage_artifact_deliveries(
      organization_id_value, case_id_value, application_id_value,
      artifact_row.id, process_row.stage, actor_user_id_value, deliveries_value
    );

    IF artifact_row.kind = 'credit_decision' THEN
      PERFORM private.assert_crm_mortgage_decision_deliveries_have_current_esis(
        organization_id_value, case_id_value, application_id_value, artifact_row.id
      );
    END IF;

    IF artifact_row.kind = 'credit_decision' AND artifact_row.decision_outcome = 'positive' THEN
      SELECT max(delivery.delivered_at) INTO latest_delivery_at
      FROM public.crm_mortgage_artifact_deliveries delivery
      WHERE delivery.artifact_id = artifact_row.id;
      IF artifact_row.valid_until < greatest(
        latest_delivery_at,
        coalesce(process_row.decision_due_at, latest_delivery_at)
      ) + interval '14 days'
      THEN
        RAISE EXCEPTION 'positive_decision_binding_period_too_short_for_delivery'
          USING errcode = '23514';
      END IF;
    END IF;

    IF process_row.stage = 'pre_application' THEN
      SELECT count(DISTINCT link.client_id) INTO required_count
      FROM public.crm_case_clients link
      WHERE link.organization_id = organization_id_value
        AND link.case_id = case_id_value;
      SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
      FROM public.crm_mortgage_artifact_deliveries delivery
      JOIN public.crm_case_clients link
        ON link.organization_id = delivery.organization_id
       AND link.case_id = delivery.case_id
       AND link.client_id = delivery.recipient_client_id
      WHERE delivery.artifact_id = artifact_row.id;
    ELSE
      SELECT count(*) INTO required_count
      FROM public.crm_mortgage_application_parties party
      WHERE party.application_id = application_id_value;
      SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
      FROM public.crm_mortgage_artifact_deliveries delivery
      JOIN public.crm_mortgage_application_parties party
        ON party.application_id = delivery.application_id
       AND party.client_id = delivery.recipient_client_id
      WHERE delivery.artifact_id = artifact_row.id;
    END IF;

    IF required_count > 0 AND delivered_count = required_count THEN
      IF artifact_row.kind = 'credit_decision' THEN
        UPDATE public.crm_mortgage_application_processes
        SET stage = CASE
              WHEN process_row.stage = 'ready_for_contract' THEN 'ready_for_contract'
              ELSE 'decision_delivered'
            END,
            updated_by_user_id = actor_user_id_value
        WHERE application_id = application_id_value;
      ELSIF artifact_row.kind = 'draft_credit_agreement' THEN
        UPDATE public.crm_mortgage_application_processes
        SET stage = CASE
              WHEN process_row.stage = 'ready_for_contract' THEN 'ready_for_contract'
              ELSE 'agreement_review'
            END,
            updated_by_user_id = actor_user_id_value
        WHERE application_id = application_id_value;
      END IF;
    END IF;

    SELECT max((value ->> 'deliveredAt')::timestamptz) INTO event_at_value
    FROM jsonb_array_elements(deliveries_value);
    event_type_value := 'artifact_delivered';
    result_value := jsonb_build_object(
      'applicationId', application_id_value,
      'artifactId', artifact_row.id
    );

  ELSIF command_type = 'submit_application' THEN
    IF process_row.stage <> 'pre_application' THEN
      RAISE EXCEPTION 'application_may_only_be_submitted_once' USING errcode = '23514';
    END IF;
    occurred_value := coalesce(
      nullif(command_value ->> 'submittedAt', '')::timestamptz,
      statement_timestamp()
    );
    IF NOT isfinite(occurred_value)
      OR occurred_value < process_row.created_at
      OR occurred_value > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'application_submission_cannot_be_in_the_future' USING errcode = '22023';
    END IF;

    PERFORM 1
    FROM public.crm_cases crm_case
    WHERE crm_case.organization_id = organization_id_value
      AND crm_case.id = case_id_value
    FOR UPDATE;

    DELETE FROM public.crm_mortgage_application_parties party
    WHERE party.application_id = application_id_value;

    INSERT INTO public.crm_mortgage_application_parties (
      organization_id, case_id, application_id, client_id, role,
      frozen_at, frozen_by_user_id
    )
    SELECT
      link.organization_id, link.case_id, application_id_value, link.client_id,
      CASE WHEN link.is_primary THEN 'primary_applicant' ELSE 'co_applicant' END,
      occurred_value, actor_user_id_value
    FROM public.crm_case_clients link
    WHERE link.organization_id = organization_id_value
      AND link.case_id = case_id_value
    ON CONFLICT (application_id, client_id) DO NOTHING;

    SELECT count(*) INTO required_count
    FROM public.crm_mortgage_application_parties party
    WHERE party.application_id = application_id_value;
    IF required_count = 0 THEN
      RAISE EXCEPTION 'application_requires_at_least_one_applicant' USING errcode = '23514';
    END IF;
    applicant_context_value := private.crm_mortgage_applicant_context(
      organization_id_value, case_id_value, application_id_value, true
    );

    SELECT artifact.* INTO artifact_row
    FROM public.crm_mortgage_application_artifacts artifact
    WHERE artifact.application_id = application_id_value
      AND artifact.kind = 'esis'
    ORDER BY artifact.version DESC
    LIMIT 1;
    IF NOT FOUND
      OR artifact_row.received_at > occurred_value
      OR (artifact_row.valid_from IS NOT NULL AND artifact_row.valid_from > occurred_value)
      OR artifact_row.valid_until IS NULL
      OR artifact_row.valid_until <= occurred_value
    THEN
      RAISE EXCEPTION 'valid_esis_required_before_submission' USING errcode = '23514';
    END IF;

    -- 0087 keeps the original AI-only path for manual/real-bank artifacts,
    -- while the assertion itself recognizes only an exact typed OpenExpert
    -- mock trusted-generated proof for an automatic ESIS.
    PERFORM private.assert_crm_mortgage_artifact_ai_validation_current(
      organization_id_value,
      case_id_value,
      application_id_value,
      artifact_row.id
    );

    SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
    FROM public.crm_mortgage_artifact_deliveries delivery
    JOIN public.crm_mortgage_application_parties party
      ON party.application_id = delivery.application_id
     AND party.client_id = delivery.recipient_client_id
    WHERE delivery.artifact_id = artifact_row.id
      AND delivery.delivered_at <= occurred_value;
    IF delivered_count <> required_count THEN
      RAISE EXCEPTION 'esis_delivery_to_every_applicant_required'
        USING errcode = '23514';
    END IF;

    UPDATE public.crm_mortgage_application_processes
    SET stage = 'submitted', application_submitted_at = occurred_value,
        updated_by_user_id = actor_user_id_value
    WHERE application_id = application_id_value;
    UPDATE public.crm_item_submissions
    SET status_code = 'wyslane', submitted_at = occurred_value
    WHERE organization_id = organization_id_value
      AND case_item_id = application_row.case_item_id
      AND id = application_id_value;
    event_type_value := 'application_submitted';
    event_at_value := occurred_value;
    result_value := jsonb_build_object('applicationId', application_id_value);

  ELSIF command_type = 'acknowledge_application' THEN
    IF process_row.stage <> 'submitted' THEN
      RAISE EXCEPTION 'only_submitted_application_may_be_acknowledged'
        USING errcode = '23514';
    END IF;
    occurred_value := coalesce(
      nullif(command_value ->> 'acknowledgedAt', '')::timestamptz,
      statement_timestamp()
    );
    IF NOT isfinite(occurred_value)
      OR occurred_value < process_row.application_submitted_at
      OR (
        process_row.application_acknowledged_at IS NOT NULL
        AND occurred_value < process_row.application_acknowledged_at
      )
      OR occurred_value > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'invalid_application_acknowledgement_time' USING errcode = '22023';
    END IF;
    UPDATE public.crm_mortgage_application_processes
    SET stage = 'awaiting_completeness', application_acknowledged_at = occurred_value,
        updated_by_user_id = actor_user_id_value
    WHERE application_id = application_id_value;
    UPDATE public.crm_item_submissions SET status_code = 'w_analizie'
    WHERE organization_id = organization_id_value AND id = application_id_value;
    event_type_value := 'application_acknowledged';
    event_at_value := occurred_value;
    result_value := jsonb_build_object('applicationId', application_id_value);

  ELSIF command_type = 'confirm_completeness' THEN
    IF process_row.stage NOT IN ('submitted', 'awaiting_completeness') THEN
      RAISE EXCEPTION 'completeness_requires_submitted_application'
        USING errcode = '23514';
    END IF;
    occurred_value := coalesce(
      nullif(command_value ->> 'confirmedAt', '')::timestamptz,
      statement_timestamp()
    );
    IF NOT isfinite(occurred_value)
      OR occurred_value < process_row.application_submitted_at
      OR (
        process_row.application_acknowledged_at IS NOT NULL
        AND occurred_value < process_row.application_acknowledged_at
      )
      OR occurred_value > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'invalid_completeness_confirmation_time' USING errcode = '22023';
    END IF;
    UPDATE public.crm_mortgage_application_processes
    SET
      stage = 'under_review',
      completeness_confirmed_at = occurred_value,
      decision_due_at = private.crm_mortgage_decision_due_at(occurred_value),
      deadline_policy_version = 'pl-art14-v1',
      updated_by_user_id = actor_user_id_value
    WHERE application_id = application_id_value;
    UPDATE public.crm_item_submissions SET status_code = 'w_analizie'
    WHERE organization_id = organization_id_value AND id = application_id_value;
    event_type_value := 'completeness_confirmed';
    event_at_value := occurred_value;
    result_value := jsonb_build_object(
      'applicationId', application_id_value,
      'decisionDueAt', private.crm_mortgage_decision_due_at(occurred_value)
    );

  ELSIF command_type = 'request_additional_information' THEN
    IF process_row.stage NOT IN ('submitted', 'awaiting_completeness', 'under_review') THEN
      RAISE EXCEPTION 'additional_information_request_invalid_transition'
        USING errcode = '23514';
    END IF;
    occurred_value := coalesce(
      nullif(command_value ->> 'requestedAt', '')::timestamptz,
      statement_timestamp()
    );
    IF NOT isfinite(occurred_value)
      OR occurred_value < process_row.application_submitted_at
      OR (
        process_row.application_acknowledged_at IS NOT NULL
        AND occurred_value < process_row.application_acknowledged_at
      )
      OR (
        process_row.completeness_confirmed_at IS NOT NULL
        AND occurred_value < process_row.completeness_confirmed_at
      )
      OR occurred_value > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'invalid_additional_information_request_time' USING errcode = '22023';
    END IF;
    UPDATE public.crm_mortgage_application_processes
    SET stage = 'additional_information_requested',
        additional_information_requested_at = occurred_value,
        updated_by_user_id = actor_user_id_value
    WHERE application_id = application_id_value;
    UPDATE public.crm_item_submissions SET status_code = 'braki'
    WHERE organization_id = organization_id_value AND id = application_id_value;
    event_type_value := 'additional_information_requested';
    event_at_value := occurred_value;
    result_value := jsonb_build_object('applicationId', application_id_value);

  ELSIF command_type = 'resume_review' THEN
    IF process_row.stage <> 'additional_information_requested' THEN
      RAISE EXCEPTION 'review_may_only_resume_after_information_request'
        USING errcode = '23514';
    END IF;
    occurred_value := coalesce(
      nullif(command_value ->> 'resumedAt', '')::timestamptz,
      statement_timestamp()
    );
    IF NOT isfinite(occurred_value)
      OR occurred_value < process_row.additional_information_requested_at
      OR occurred_value > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'invalid_review_resume_time' USING errcode = '22023';
    END IF;
    UPDATE public.crm_mortgage_application_processes
    SET stage = CASE
          WHEN completeness_confirmed_at IS NULL THEN 'awaiting_completeness'
          ELSE 'under_review'
        END,
        updated_by_user_id = actor_user_id_value
    WHERE application_id = application_id_value;
    UPDATE public.crm_item_submissions SET status_code = 'w_analizie'
    WHERE organization_id = organization_id_value AND id = application_id_value;
    event_type_value := 'review_resumed';
    event_at_value := occurred_value;
    result_value := jsonb_build_object('applicationId', application_id_value);

  ELSIF command_type = 'record_early_decision_consent' THEN
    IF process_row.stage IN (
      'decision_delivered', 'agreement_review', 'ready_for_contract',
      'completed', 'closed'
    ) THEN
      RAISE EXCEPTION 'early_decision_consent_cannot_change_after_delivery'
        USING errcode = '23514';
    END IF;
    client_id_value := nullif(command_value ->> 'clientId', '')::uuid;
    decision_value := nullif(command_value ->> 'decision', '');
    occurred_value := coalesce(
      nullif(command_value ->> 'capturedAt', '')::timestamptz,
      statement_timestamp()
    );
    channel_value := nullif(command_value ->> 'channel', '');
    evidence_value := nullif(btrim(command_value ->> 'evidenceReference'), '');
    consent_document_id := nullif(command_value ->> 'documentId', '')::uuid;
    metadata_value := coalesce(command_value -> 'metadata', '{}'::jsonb);
    IF client_id_value IS NULL OR decision_value NOT IN ('granted', 'refused', 'withdrawn')
      OR NOT isfinite(occurred_value)
      OR channel_value NOT IN ('signed_document', 'client_portal', 'email_reply', 'recorded_conversation', 'other')
      OR (evidence_value IS NULL AND consent_document_id IS NULL)
      OR (evidence_value IS NOT NULL AND char_length(evidence_value) > 500)
      OR occurred_value > statement_timestamp() + interval '5 minutes'
      OR jsonb_typeof(metadata_value) <> 'object'
    THEN
      RAISE EXCEPTION 'invalid_early_decision_consent' USING errcode = '22023';
    END IF;
    PERFORM 1 FROM public.crm_mortgage_application_parties party
    WHERE party.application_id = application_id_value
      AND party.client_id = client_id_value
      AND occurred_value >= party.frozen_at;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'early_decision_consent_client_not_in_application'
        USING errcode = '23514';
    END IF;
    IF consent_document_id IS NOT NULL THEN
      PERFORM 1 FROM public.crm_documents document
      WHERE document.id = consent_document_id
        AND document.organization_id = organization_id_value
        AND document.case_id = case_id_value;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'early_decision_consent_document_out_of_scope'
          USING errcode = '23514';
      END IF;
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.crm_mortgage_early_decision_consents existing_consent
      WHERE existing_consent.application_id = application_id_value
        AND existing_consent.client_id = client_id_value
        AND existing_consent.captured_at > occurred_value
    ) THEN
      RAISE EXCEPTION 'early_decision_consent_time_must_be_monotonic'
        USING errcode = '23514';
    END IF;
    INSERT INTO public.crm_mortgage_early_decision_consents (
      organization_id, case_id, application_id, client_id, decision,
      captured_at, channel, evidence_reference, document_id,
      recorded_by_user_id, metadata
    ) VALUES (
      organization_id_value, case_id_value, application_id_value, client_id_value, decision_value,
      occurred_value, channel_value, evidence_value, consent_document_id,
      actor_user_id_value, metadata_value
    );
    event_type_value := 'early_decision_consent_recorded';
    event_at_value := occurred_value;
    result_value := jsonb_build_object('applicationId', application_id_value);

  ELSIF command_type = 'complete_application' THEN
    IF process_row.stage NOT IN ('decision_delivered', 'agreement_review') THEN
      RAISE EXCEPTION 'application_completion_requires_delivered_decision'
        USING errcode = '23514';
    END IF;
    occurred_value := coalesce(
      nullif(command_value ->> 'completedAt', '')::timestamptz,
      statement_timestamp()
    );
    IF NOT isfinite(occurred_value)
      OR occurred_value < process_row.decision_received_at
      OR occurred_value > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'application_completion_cannot_be_in_the_future' USING errcode = '22023';
    END IF;

    SELECT artifact.* INTO artifact_row
    FROM public.crm_mortgage_application_artifacts artifact
    WHERE artifact.application_id = application_id_value
      AND artifact.kind = 'credit_decision'
    ORDER BY artifact.version DESC LIMIT 1;
    IF NOT FOUND OR artifact_row.decision_outcome IS DISTINCT FROM process_row.decision_outcome THEN
      RAISE EXCEPTION 'current_credit_decision_required_for_completion'
        USING errcode = '23514';
    END IF;
    related_decision_id := artifact_row.id;
    PERFORM private.assert_crm_mortgage_artifact_ai_validation_current(
      organization_id_value, case_id_value, application_id_value,
      artifact_row.related_esis_artifact_id
    );
    PERFORM private.assert_crm_mortgage_artifact_ai_validation_current(
      organization_id_value, case_id_value, application_id_value, artifact_row.id
    );
    PERFORM private.assert_crm_mortgage_decision_deliveries_have_current_esis(
      organization_id_value, case_id_value, application_id_value, related_decision_id
    );
    SELECT count(*) INTO required_count FROM public.crm_mortgage_application_parties
    WHERE application_id = application_id_value;
    SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
    FROM public.crm_mortgage_artifact_deliveries delivery
    JOIN public.crm_mortgage_application_parties party
      ON party.application_id = delivery.application_id
     AND party.client_id = delivery.recipient_client_id
    WHERE delivery.artifact_id = artifact_row.id
      AND delivery.delivered_at <= occurred_value;
    IF required_count = 0 OR delivered_count <> required_count THEN
      RAISE EXCEPTION 'credit_decision_delivery_required_for_completion'
        USING errcode = '23514';
    END IF;

    IF artifact_row.decision_outcome = 'positive' THEN
      IF artifact_row.valid_until <= occurred_value THEN
        RAISE EXCEPTION 'positive_credit_decision_offer_expired' USING errcode = '23514';
      END IF;
      received_at_value := artifact_row.received_at;
      SELECT artifact.* INTO artifact_row
      FROM public.crm_mortgage_application_artifacts artifact
      WHERE artifact.application_id = application_id_value
        AND artifact.kind = 'draft_credit_agreement'
      ORDER BY artifact.version DESC LIMIT 1;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'draft_credit_agreement_required_for_completion'
          USING errcode = '23514';
      END IF;
      IF artifact_row.related_decision_artifact_id IS DISTINCT FROM related_decision_id THEN
        RAISE EXCEPTION 'draft_credit_agreement_must_match_current_decision'
          USING errcode = '23514';
      END IF;
      IF artifact_row.received_at < received_at_value THEN
        RAISE EXCEPTION 'draft_credit_agreement_predates_current_decision'
          USING errcode = '23514';
      END IF;
      SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
      FROM public.crm_mortgage_artifact_deliveries delivery
      JOIN public.crm_mortgage_application_parties party
        ON party.application_id = delivery.application_id
       AND party.client_id = delivery.recipient_client_id
      WHERE delivery.artifact_id = artifact_row.id
        AND delivery.delivered_at <= occurred_value;
      IF delivered_count <> required_count THEN
        RAISE EXCEPTION 'draft_credit_agreement_delivery_required_for_completion'
          USING errcode = '23514';
      END IF;
    END IF;

    UPDATE public.crm_mortgage_application_processes
    SET stage = CASE
          WHEN process_row.decision_outcome = 'positive' THEN 'ready_for_contract'
          ELSE 'completed'
        END,
        updated_by_user_id = actor_user_id_value
    WHERE application_id = application_id_value;
    UPDATE public.crm_item_submissions
    SET
      status_code = CASE WHEN process_row.decision_outcome = 'positive'
        THEN 'zaakceptowane' ELSE 'odrzucone' END,
      decision_at = process_row.decision_received_at
    WHERE organization_id = organization_id_value AND id = application_id_value;
    event_type_value := CASE
      WHEN process_row.decision_outcome = 'positive'
        THEN 'application_ready_for_contract'
      ELSE 'application_completed'
    END;
    event_at_value := occurred_value;
    result_value := jsonb_build_object('applicationId', application_id_value);

  ELSIF command_type = 'close_application' THEN
    IF process_row.stage IN ('completed', 'closed') THEN
      RAISE EXCEPTION 'terminal_application_cannot_be_closed_again'
        USING errcode = '23514';
    END IF;
    occurred_value := coalesce(
      nullif(command_value ->> 'closedAt', '')::timestamptz,
      statement_timestamp()
    );
    IF NOT isfinite(occurred_value)
      OR occurred_value < coalesce(
          process_row.decision_received_at,
          process_row.additional_information_requested_at,
          process_row.completeness_confirmed_at,
          process_row.application_acknowledged_at,
          process_row.application_submitted_at,
          process_row.created_at
        )
      OR occurred_value > statement_timestamp() + interval '5 minutes'
    THEN
      RAISE EXCEPTION 'application_close_cannot_be_in_the_future' USING errcode = '22023';
    END IF;
    UPDATE public.crm_mortgage_application_processes
    SET stage = 'closed', closed_at = occurred_value,
        updated_by_user_id = actor_user_id_value
    WHERE application_id = application_id_value;
    UPDATE public.crm_item_submissions SET status_code = 'wycofane'
    WHERE organization_id = organization_id_value AND id = application_id_value;
    event_type_value := 'application_closed';
    event_at_value := occurred_value;
    result_value := jsonb_build_object('applicationId', application_id_value);

  ELSE
    RAISE EXCEPTION 'unsupported_mortgage_application_command'
      USING errcode = '22023';
  END IF;

  UPDATE public.crm_mortgage_application_processes
  SET revision = new_revision, updated_by_user_id = actor_user_id_value
  WHERE application_id = application_id_value
  RETURNING stage, decision_due_at INTO process_row.stage, process_row.decision_due_at;

  result_value := coalesce(result_value, '{}'::jsonb) || jsonb_build_object(
    'applicationId', application_id_value,
    'stage', process_row.stage,
    'revision', new_revision,
    'decisionDueAt', process_row.decision_due_at
  );

  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload
  ) VALUES (
    organization_id_value, case_id_value, application_id_value, new_revision,
    command_id_value, event_type_value, actor_user_id_value,
    statement_timestamp(),
    jsonb_build_object('command', command_value, 'result', result_value)
  );

  DELETE FROM private.crm_mortgage_application_command_guards guard
  WHERE guard.application_id = application_id_value
    AND guard.transaction_id = txid_current();

  RETURN result_value;
END;
$$;

REVOKE ALL ON FUNCTION public.execute_crm_mortgage_application_command(jsonb)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.execute_crm_mortgage_application_command(jsonb)
  TO openexpert_service;

CREATE FUNCTION public.publish_bank_mail_agent_pdf_attachment(
  p_attachment_job_id uuid,
  p_lease_token text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  document_row public.crm_documents%rowtype;
  command_result jsonb;
  provenance_row private.mail_bank_agent_pdf_attachment_provenance%rowtype;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  publish_now timestamptz := clock_timestamp();
  current_dispatch_generation integer;
  current_policy_enabled boolean;
BEGIN
  IF p_attachment_job_id IS NULL OR p_lease_token !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_bank_mail_pdf_publish' USING errcode = '22023';
  END IF;
  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_pdf_publish_claims_invalid' USING errcode = '42501';
  END;

  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.id = p_attachment_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_job_not_found' USING errcode = 'P0002';
  END IF;

  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'crm-bank-mail-pdf-publish-v1'
    OR jwt_claims ->> 'serviceId'
      IS DISTINCT FROM 'openexpert-crm-bank-mail-pdf-worker'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-pdf-attachment'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM job_row.organization_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM job_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM job_row.owner_user_id::text
    OR jwt_claims ->> 'attachmentJobId' IS DISTINCT FROM job_row.id::text
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_publish_claims_invalid' USING errcode = '42501';
  END IF;

  IF job_row.state = 'attached' THEN
    SELECT provenance.* INTO provenance_row
    FROM private.mail_bank_agent_pdf_attachment_provenance AS provenance
    JOIN public.crm_documents AS document
      ON document.id = provenance.document_id
     AND document.bank_mail_attachment_job_id = provenance.attachment_job_id
    JOIN public.crm_mortgage_application_artifacts AS artifact
      ON artifact.id = provenance.artifact_id
     AND artifact.document_id = document.id
     AND artifact.bank_mail_attachment_job_id = provenance.attachment_job_id
    WHERE provenance.attachment_job_id = job_row.id
      AND provenance.document_id = job_row.document_id
      AND provenance.trusted_validation_id = job_row.trusted_validation_id
      AND provenance.artifact_id = job_row.artifact_id
      AND provenance.command_event_id = job_row.command_event_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_mail_pdf_attached_provenance_missing'
        USING errcode = '23514';
    END IF;
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', 'attached',
      'resolutionCode', job_row.resolution_code,
      'documentId', job_row.document_id, 'fileName', job_row.pdf_file_name,
      'completedAt', job_row.completed_at, 'replayed', true
    );
  END IF;

  IF job_row.state IN ('review_required', 'failed', 'conflict') THEN
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', job_row.state,
      'resolutionCode', job_row.resolution_code, 'documentId', NULL,
      'fileName', NULL, 'completedAt', job_row.completed_at, 'replayed', true
    );
  END IF;

  IF job_row.state <> 'importing'
    OR jwt_claims ->> 'workerId' IS DISTINCT FROM job_row.locked_by
    OR job_row.lease_token_sha256 IS DISTINCT FROM encode(
      extensions.digest(convert_to(p_lease_token, 'utf8'), 'sha256'), 'hex'
    )
    OR job_row.lease_expires_at <= publish_now
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_publish_lease_invalid' USING errcode = '42501';
  END IF;

  SELECT identity.auto_attach_pdf_enabled
    AND identity.is_active
    AND identity.sender_domain = 'openexpert.app'
    AND NOT identity.allow_subdomains
    AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
    AND bank.slug = 'openexpert-bank'
    AND bank.is_mock
  INTO current_policy_enabled
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
  WHERE identity.id = job_row.bank_email_identity_id
  FOR SHARE OF identity, bank;
  IF current_policy_enabled IS DISTINCT FROM true THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'failed', resolution_code = 'policy_disabled',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = publish_now
    WHERE job.id = job_row.id;
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET status = 'pending', available_at = publish_now
    WHERE cleanup.id = job_row.cleanup_job_id AND cleanup.status = 'reserved';
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', 'failed',
      'resolutionCode', 'policy_disabled', 'documentId', NULL,
      'fileName', NULL, 'completedAt', publish_now, 'replayed', false
    );
  END IF;

  SELECT dispatch.generation INTO current_dispatch_generation
  FROM public.crm_mock_bank_dispatches AS dispatch
  WHERE dispatch.id = job_row.dispatch_id
  FOR SHARE;
  IF current_dispatch_generation IS DISTINCT FROM job_row.dispatch_generation THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'conflict', resolution_code = 'dispatch_generation_changed',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = publish_now
    WHERE job.id = job_row.id;
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET status = 'pending', available_at = publish_now
    WHERE cleanup.id = job_row.cleanup_job_id AND cleanup.status = 'reserved';
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', 'conflict',
      'resolutionCode', 'dispatch_generation_changed', 'documentId', NULL,
      'fileName', NULL, 'completedAt', publish_now, 'replayed', false
    );
  END IF;

  IF private.bank_mail_agent_pdf_job_scope_is_valid(job_row.id)
    IS DISTINCT FROM true
  THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'failed', resolution_code = 'canonical_link_invalid',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = publish_now
    WHERE job.id = job_row.id;
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET status = 'pending', available_at = publish_now
    WHERE cleanup.id = job_row.cleanup_job_id AND cleanup.status = 'reserved';
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', 'failed',
      'resolutionCode', 'canonical_link_invalid', 'documentId', NULL,
      'fileName', NULL, 'completedAt', publish_now, 'replayed', false
    );
  END IF;

  PERFORM 1 FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = job_row.organization_id
    AND crm_case.id = job_row.case_id FOR UPDATE;
  PERFORM 1 FROM public.crm_case_bank_applications AS application
  WHERE application.organization_id = job_row.organization_id
    AND application.case_id = job_row.case_id
    AND application.submission_id = job_row.application_id FOR UPDATE;
  PERFORM private.bank_mail_agent_pdf_application_lock(
    job_row.organization_id, job_row.case_id, job_row.application_id
  );

  IF EXISTS (
    SELECT 1 FROM public.crm_documents AS document
    WHERE document.organization_id = job_row.organization_id
      AND document.case_id = job_row.case_id
      AND document.submission_id = job_row.application_id
      AND document.document_type = 'mortgage_esis'
  ) OR EXISTS (
    SELECT 1 FROM public.crm_mortgage_application_artifacts AS artifact
    WHERE artifact.organization_id = job_row.organization_id
      AND artifact.case_id = job_row.case_id
      AND artifact.application_id = job_row.application_id
      AND artifact.kind = 'esis'
  ) THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'review_required', resolution_code = 'existing_esis_requires_review',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = publish_now
    WHERE job.id = job_row.id;
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET status = 'pending', available_at = publish_now
    WHERE cleanup.id = job_row.cleanup_job_id AND cleanup.status = 'reserved';
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', 'review_required',
      'resolutionCode', 'existing_esis_requires_review', 'documentId', NULL,
      'fileName', NULL, 'completedAt', publish_now, 'replayed', false
    );
  END IF;

  PERFORM 1 FROM public.crm_document_storage_cleanup_jobs AS cleanup
  WHERE cleanup.id = job_row.cleanup_job_id
    AND cleanup.organization_id = job_row.organization_id
    AND cleanup.case_id = job_row.case_id
    AND cleanup.submission_id = job_row.application_id
    AND cleanup.bank_mail_attachment_job_id = job_row.id
    AND cleanup.purpose = 'bank_mail_attachment_upload'
    AND cleanup.storage_bucket = job_row.storage_bucket
    AND cleanup.storage_path = job_row.storage_path
    AND cleanup.status = 'reserved' FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
    SET state = 'conflict', resolution_code = 'storage_object_conflict',
        locked_by = NULL, lease_token_sha256 = NULL,
        lease_expires_at = NULL, completed_at = publish_now
    WHERE job.id = job_row.id;
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id, 'state', 'conflict',
      'resolutionCode', 'storage_object_conflict', 'documentId', NULL,
      'fileName', NULL, 'completedAt', publish_now, 'replayed', false
    );
  END IF;

  INSERT INTO private.mail_bank_agent_pdf_publish_guards (
    attachment_job_id, application_id, transaction_id
  ) VALUES (job_row.id, job_row.application_id, txid_current());

  INSERT INTO public.crm_documents (
    organization_id, case_id, case_item_id, submission_id, document_type,
    name, status_code, storage_bucket, storage_path, received_at, metadata,
    uploaded_by_user_id, uploaded_by_client_person_id,
    uploaded_by_auth_user_id, mime_type, size_bytes, sha256,
    bank_mail_attachment_job_id, actor_kind
  )
  SELECT job_row.organization_id, job_row.case_id, application.case_item_id,
    job_row.application_id, 'mortgage_esis', job_row.pdf_file_name, 'received',
    job_row.storage_bucket, job_row.storage_path, publish_now,
    jsonb_build_object(
      'source', 'openexpert_bank_mail_agent',
      'inspectionPolicy', 'openexpert_sent_artifact_sha256_v1'
    ), NULL, NULL, NULL, 'application/pdf', job_row.pdf_size_bytes,
    job_row.pdf_sha256, job_row.id, 'bank_mail_agent'
  FROM public.crm_case_bank_applications AS application
  WHERE application.organization_id = job_row.organization_id
    AND application.case_id = job_row.case_id
    AND application.submission_id = job_row.application_id
  RETURNING * INTO document_row;

  UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
  SET document_id = document_row.id WHERE job.id = job_row.id;

  command_result := private.execute_bank_mail_agent_trusted_esis_command(job_row.id);

  INSERT INTO private.mail_bank_agent_pdf_attachment_provenance (
    attachment_job_id, organization_id, intake_id, dispatch_id,
    dispatch_generation, generation_context_sha256,
    dispatch_payload_sha256, document_id, trusted_validation_id,
    artifact_id, command_event_id, attached_at
  ) VALUES (
    job_row.id, job_row.organization_id, job_row.intake_id, job_row.dispatch_id,
    job_row.dispatch_generation, job_row.generation_context_sha256,
    job_row.dispatch_payload_sha256, document_row.id,
    (command_result ->> 'trustedValidationId')::uuid,
    (command_result ->> 'artifactId')::uuid,
    (command_result ->> 'eventId')::uuid, publish_now
  ) RETURNING * INTO provenance_row;

  PERFORM public.retain_crm_document_storage_cleanup(
    job_row.cleanup_job_id, document_row.id
  );

  UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
  SET state = 'attached', resolution_code = 'openexpert_mock_esis_attached',
      trusted_validation_id = provenance_row.trusted_validation_id,
      artifact_id = provenance_row.artifact_id,
      command_event_id = provenance_row.command_event_id,
      locked_by = NULL, lease_token_sha256 = NULL, lease_expires_at = NULL,
      completed_at = publish_now
  WHERE job.id = job_row.id RETURNING * INTO job_row;

  DELETE FROM private.mail_bank_agent_pdf_publish_guards AS guard
  WHERE guard.attachment_job_id = job_row.id
    AND guard.transaction_id = txid_current();

  RETURN jsonb_build_object(
    'attachmentJobId', job_row.id, 'state', job_row.state,
    'resolutionCode', job_row.resolution_code,
    'documentId', job_row.document_id, 'fileName', job_row.pdf_file_name,
    'completedAt', job_row.completed_at, 'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.publish_bank_mail_agent_pdf_attachment(uuid, text) IS
  'Atomically publishes one exact trusted OpenExpert mock ESIS as a formal mortgage artifact with typed automatic provenance. It never supersedes an existing ESIS.';
REVOKE ALL ON FUNCTION public.publish_bank_mail_agent_pdf_attachment(uuid, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.publish_bank_mail_agent_pdf_attachment(uuid, text)
  TO openexpert_service, openexpert_owner;

CREATE FUNCTION public.fail_bank_mail_agent_pdf_attachment(
  p_attachment_job_id uuid,
  p_lease_token text,
  p_failure_code text,
  p_retryable boolean,
  p_retry_after_seconds integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  fail_now timestamptz := clock_timestamp();
  target_state text;
  target_resolution text;
  terminal boolean;
  effective_retry_after integer;
BEGIN
  IF p_attachment_job_id IS NULL
    OR p_lease_token !~ '^[0-9a-f]{64}$'
    OR p_failure_code NOT IN (
      'source_message_missing', 'source_message_ambiguous',
      'source_content_changed', 'attachment_missing',
      'attachment_ambiguous', 'attachment_locator_invalid',
      'archive_hash_mismatch', 'archive_invalid',
      'archive_unlock_failed', 'pdf_invalid', 'inspection_failed',
      'storage_object_conflict', 'mail_connection_unavailable',
      'gmail_unavailable', 'storage_unavailable',
      'publish_unavailable', 'processing_failed'
    )
    OR p_retryable IS NULL
    OR p_retry_after_seconds NOT BETWEEN 0 AND 3600
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_pdf_failure'
      USING errcode = '22023';
  END IF;

  IF p_failure_code IN (
    'mail_connection_unavailable', 'gmail_unavailable',
    'storage_unavailable', 'publish_unavailable', 'processing_failed'
  ) THEN
    IF NOT p_retryable OR p_retry_after_seconds NOT BETWEEN 1 AND 3600 THEN
      RAISE EXCEPTION 'invalid_bank_mail_pdf_failure_retry_policy'
        USING errcode = '22023';
    END IF;
  ELSIF p_retryable OR p_retry_after_seconds <> 0 THEN
    RAISE EXCEPTION 'invalid_bank_mail_pdf_failure_retry_policy'
      USING errcode = '22023';
  END IF;

  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_pdf_failure_claims_invalid'
      USING errcode = '42501';
  END;

  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.id = p_attachment_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_pdf_attachment_job_not_found'
      USING errcode = 'P0002';
  END IF;

  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'crm-bank-mail-pdf-failure-v1'
    OR jwt_claims ->> 'serviceId'
      IS DISTINCT FROM 'openexpert-crm-bank-mail-pdf-worker'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-pdf-attachment'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM job_row.organization_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM job_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM job_row.owner_user_id::text
    OR jwt_claims ->> 'attachmentJobId' IS DISTINCT FROM job_row.id::text
    OR jwt_claims ->> 'failureCode' IS DISTINCT FROM p_failure_code
    OR jwt_claims -> 'retryable' IS DISTINCT FROM to_jsonb(p_retryable)
    OR jwt_claims ->> 'retryAfterSeconds'
      IS DISTINCT FROM p_retry_after_seconds::text
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_failure_claims_invalid'
      USING errcode = '42501';
  END IF;

  IF job_row.state IN ('attached', 'review_required', 'failed', 'conflict') THEN
    RETURN jsonb_build_object(
      'attachmentJobId', job_row.id,
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'retryAfterSeconds', 0,
      'completedAt', job_row.completed_at,
      'replayed', true
    );
  END IF;

  IF job_row.state NOT IN (
      'downloading', 'verifying_source', 'unlocking', 'validating', 'importing'
    )
    OR jwt_claims ->> 'workerId' IS DISTINCT FROM job_row.locked_by
    OR job_row.lease_token_sha256 IS DISTINCT FROM encode(
      extensions.digest(convert_to(p_lease_token, 'utf8'), 'sha256'), 'hex'
    )
    OR job_row.lease_expires_at <= fail_now
  THEN
    RAISE EXCEPTION 'bank_mail_pdf_failure_lease_invalid'
      USING errcode = '42501';
  END IF;

  IF p_retryable AND job_row.attempt_count < 5 THEN
    target_state := 'retrying';
    target_resolution := CASE p_failure_code
      WHEN 'mail_connection_unavailable' THEN 'provider_unavailable'
      WHEN 'gmail_unavailable' THEN 'provider_unavailable'
      WHEN 'storage_unavailable' THEN 'storage_unavailable'
      WHEN 'publish_unavailable' THEN 'storage_unavailable'
      ELSE 'processing_timeout'
    END;
    terminal := false;
    effective_retry_after := p_retry_after_seconds;
  ELSIF p_retryable THEN
    target_state := 'failed';
    target_resolution := 'retry_limit_reached';
    terminal := true;
    effective_retry_after := 0;
  ELSE
    target_state := CASE
      WHEN p_failure_code IN (
        'source_content_changed', 'archive_hash_mismatch',
        'attachment_locator_invalid', 'storage_object_conflict'
      ) THEN 'conflict'
      ELSE 'failed'
    END;
    target_resolution := CASE
      WHEN p_failure_code IN ('source_message_missing', 'attachment_missing')
        THEN 'attachment_not_found'
      WHEN p_failure_code IN ('source_message_ambiguous', 'attachment_ambiguous')
        THEN 'attachment_ambiguous'
      WHEN p_failure_code IN ('source_content_changed', 'archive_hash_mismatch')
        THEN 'source_archive_mismatch'
      WHEN p_failure_code = 'attachment_locator_invalid'
        THEN 'attachment_scope_conflict'
      WHEN p_failure_code = 'storage_object_conflict'
        THEN 'storage_object_conflict'
      ELSE p_failure_code
    END;
    terminal := true;
    effective_retry_after := 0;
  END IF;

  UPDATE private.mail_bank_agent_pdf_attachment_jobs AS job
  SET state = target_state,
      resolution_code = target_resolution,
      available_at = CASE
        WHEN terminal THEN job.available_at
        ELSE fail_now + make_interval(secs => effective_retry_after)
      END,
      locked_by = NULL,
      lease_token_sha256 = NULL,
      lease_expires_at = NULL,
      completed_at = CASE WHEN terminal THEN fail_now ELSE NULL END
  WHERE job.id = job_row.id
  RETURNING * INTO job_row;

  IF terminal AND job_row.cleanup_job_id IS NOT NULL THEN
    UPDATE public.crm_document_storage_cleanup_jobs AS cleanup
    SET status = 'pending', available_at = fail_now
    WHERE cleanup.id = job_row.cleanup_job_id
      AND cleanup.status = 'reserved';
  END IF;

  RETURN jsonb_build_object(
    'attachmentJobId', job_row.id,
    'state', job_row.state,
    'resolutionCode', job_row.resolution_code,
    'retryAfterSeconds', effective_retry_after,
    'completedAt', job_row.completed_at,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.fail_bank_mail_agent_pdf_attachment(
  uuid, text, text, boolean, integer
) IS 'Maps exact signed worker failure codes to a bounded retry or immutable controlled terminal result. Terminal first-writer wins and replay never overwrites attachment provenance.';
REVOKE ALL ON FUNCTION public.fail_bank_mail_agent_pdf_attachment(
  uuid, text, text, boolean, integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.fail_bank_mail_agent_pdf_attachment(
  uuid, text, text, boolean, integer
) TO openexpert_service, openexpert_owner;

CREATE FUNCTION private.get_bank_mail_agent_pdf_attachment_status(
  p_intake_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_pdf_attachment_jobs%rowtype;
  live_document_id uuid;
  live_file_name text;
  current_generation_context jsonb;
  current_validation_context jsonb;
  drift_candidate record;
BEGIN
  SELECT job.* INTO job_row
  FROM private.mail_bank_agent_pdf_attachment_jobs AS job
  WHERE job.intake_id = p_intake_id;
  IF NOT FOUND THEN
    -- Payload commit is the immutable point-in-time authorization for the
    -- exact bytes sent.  A later business edit must not rewrite/re-send those
    -- bytes, but it also must not leave the mailbox UI silently showing no
    -- attachment outcome when the now-stale generation cannot be enqueued.
    SELECT
      dispatch.id AS dispatch_id,
      dispatch.payload_id,
      dispatch.generation,
      dispatch.generation_started_at,
      dispatch.generation_context_sha256,
      dispatch.generation_applicant_context_sha256,
      dispatch.generation_bank_context_sha256,
      dispatch.generation_expectation_sha256,
      dispatch.generation_valid_until,
      dispatch.sent_at,
      process.stage AS process_stage,
      intake.organization_id,
      proposal.case_id,
      proposal.application_id
    INTO drift_candidate
    FROM public.mail_bank_agent_intakes AS intake
    JOIN private.mail_bank_agent_thread_link_jobs AS link_job
      ON link_job.intake_id = intake.id
     AND link_job.state = 'linked'
     AND link_job.link_id IS NOT NULL
    JOIN public.mail_context_thread_links AS link
      ON link.id = link_job.link_id
     AND link.organization_id = intake.organization_id
     AND link.owner_user_id = intake.owner_user_id
     AND link.connection_id = intake.connection_id
     AND link.thread_key_hash = link_job.thread_key_hash
     AND link.client_id IS NULL
    JOIN public.mail_bank_agent_match_proposals AS proposal
      ON proposal.id = link_job.proposal_id
     AND proposal.intake_id = intake.id
     AND proposal.case_id = link.case_id
     AND proposal.classification = 'strong_candidate'
     AND proposal.review_status = 'review_required'
     AND cardinality(proposal.contradiction_codes) = 0
    JOIN public.mail_bank_agent_analysis_runs AS analysis_run
      ON analysis_run.id = proposal.analysis_run_id
     AND analysis_run.intake_id = intake.id
     AND analysis_run.source_sha256 = intake.source_sha256
    JOIN public.mortgage_bank_email_identities AS identity
      ON identity.id = intake.bank_email_identity_id
     AND identity.is_active
     AND identity.auto_attach_pdf_enabled
     AND identity.sender_domain = 'openexpert.app'
     AND NOT identity.allow_subdomains
     AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
    JOIN public.mortgage_banks AS bank
      ON bank.id = identity.bank_id
     AND bank.slug = 'openexpert-bank'
     AND bank.is_mock
    JOIN public.crm_case_bank_applications AS application
      ON application.organization_id = intake.organization_id
     AND application.case_id = proposal.case_id
     AND application.submission_id = proposal.application_id
     AND application.bank_id = identity.bank_id
    JOIN public.crm_mortgage_application_processes AS process
      ON process.organization_id = application.organization_id
     AND process.case_id = application.case_id
     AND process.application_id = application.submission_id
    JOIN public.crm_mock_bank_dispatches AS dispatch
      ON dispatch.organization_id = intake.organization_id
     AND dispatch.case_id = proposal.case_id
     AND dispatch.application_id = proposal.application_id
     AND dispatch.kind = 'esis'
     AND dispatch.status = 'sent'
     AND dispatch.recipient_connection_id = intake.connection_id
     AND dispatch.requested_by_user_id = intake.owner_user_id
     AND dispatch.payload_ready_at IS NOT NULL
     AND dispatch.provider_message_id IS NOT NULL
     AND dispatch.generation_context_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_applicant_context_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_bank_context_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_expectation_sha256 ~ '^[0-9a-f]{64}$'
     AND dispatch.generation_valid_until IS NOT NULL
    WHERE intake.id = p_intake_id
      AND intake.claimed_at >= dispatch.generation_started_at - interval '10 minutes'
      AND intake.identity_verdict = 'trusted_bank'
      AND intake.status = 'review_required'
      AND intake.finalized_at IS NOT NULL
      AND NOT intake.reply_to_mismatch
      AND intake.authentication_policy_applied = 'openexpert_mock_dkim_aligned'
      AND intake.dkim_aligned
      AND EXISTS (
        SELECT 1
        FROM public.mail_bank_agent_run_sessions AS binding
        WHERE binding.analysis_run_id = analysis_run.id
          AND binding.intake_id = intake.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.mail_bank_agent_match_proposals AS other_proposal
        WHERE other_proposal.intake_id = intake.id
          AND other_proposal.id <> proposal.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.mail_bank_agent_analysis_runs AS other_run
        WHERE other_run.intake_id = intake.id
          AND other_run.id <> analysis_run.id
      )
    LIMIT 1;

    IF FOUND THEN
      BEGIN
        current_generation_context := private.crm_mock_bank_generation_context(
          drift_candidate.dispatch_id,
          drift_candidate.payload_id,
          drift_candidate.generation,
          drift_candidate.generation_started_at
        );
        current_validation_context :=
          private.crm_mortgage_document_validation_context(
            drift_candidate.organization_id,
            drift_candidate.case_id,
            drift_candidate.application_id,
            drift_candidate.process_stage <> 'pre_application',
            'esis',
            NULL,
            drift_candidate.generation_valid_until
          );
      EXCEPTION WHEN OTHERS THEN
        current_generation_context := NULL;
        current_validation_context := NULL;
      END;
      IF current_generation_context IS NULL
        OR current_generation_context ->> 'generationContextSha256'
          IS DISTINCT FROM drift_candidate.generation_context_sha256
        OR current_validation_context ->> 'applicantContextSha256'
          IS DISTINCT FROM drift_candidate.generation_applicant_context_sha256
        OR current_validation_context ->> 'bankContextSha256'
          IS DISTINCT FROM drift_candidate.generation_bank_context_sha256
        OR current_validation_context ->> 'expectationSha256'
          IS DISTINCT FROM drift_candidate.generation_expectation_sha256
        OR (current_generation_context ->> 'validUntil')::timestamptz
          IS DISTINCT FROM drift_candidate.generation_valid_until
      THEN
        RETURN jsonb_build_object(
          'state', 'conflict',
          'resolutionCode', 'attachment_scope_conflict',
          'documentId', NULL,
          'fileName', NULL,
          'completedAt', drift_candidate.sent_at
        );
      END IF;
    END IF;
    RETURN NULL;
  END IF;

  IF job_row.state = 'attached' THEN
    BEGIN
      current_generation_context := private.crm_mock_bank_generation_context(
        job_row.dispatch_id,
        job_row.dispatch_payload_id,
        job_row.dispatch_generation,
        job_row.dispatch_generation_started_at
      );
    EXCEPTION WHEN OTHERS THEN
      current_generation_context := NULL;
    END;
    IF current_generation_context IS NULL
      OR current_generation_context ->> 'generationContextSha256'
        IS DISTINCT FROM job_row.generation_context_sha256
      OR current_generation_context ->> 'applicantContextSha256'
        IS DISTINCT FROM job_row.applicant_context_sha256
      OR current_generation_context ->> 'bankContextSha256'
        IS DISTINCT FROM job_row.bank_context_sha256
      OR current_generation_context ->> 'expectationSha256'
        IS DISTINCT FROM job_row.expectation_sha256
      OR (current_generation_context ->> 'validUntil')::timestamptz
        IS DISTINCT FROM job_row.valid_until
    THEN
      RETURN jsonb_build_object(
        'state', 'conflict',
        'resolutionCode', 'attachment_scope_conflict',
        'documentId', NULL,
        'fileName', NULL,
        'completedAt', job_row.completed_at
      );
    END IF;

    SELECT document.id, document.name
    INTO live_document_id, live_file_name
    FROM public.crm_documents AS document
    JOIN public.crm_mortgage_trusted_document_validations AS trusted
      ON trusted.id = job_row.trusted_validation_id
     AND trusted.bank_mail_attachment_job_id = job_row.id
     AND trusted.organization_id = job_row.organization_id
     AND trusted.case_id = job_row.case_id
     AND trusted.application_id = job_row.application_id
     AND trusted.document_id = document.id
     AND trusted.source_sha256 = document.sha256
     AND trusted.generation_context_sha256 = job_row.generation_context_sha256
     AND trusted.applicant_context_sha256 = job_row.applicant_context_sha256
     AND trusted.bank_context_sha256 = job_row.bank_context_sha256
     AND trusted.expectation_sha256 = job_row.expectation_sha256
     AND trusted.validated_valid_until = job_row.valid_until
    JOIN public.crm_mortgage_application_artifacts AS artifact
      ON artifact.id = job_row.artifact_id
     AND artifact.organization_id = job_row.organization_id
     AND artifact.case_id = job_row.case_id
     AND artifact.application_id = job_row.application_id
     AND artifact.document_id = document.id
     AND artifact.kind = 'esis'
     AND artifact.actor_kind = 'bank_mail_agent'
     AND artifact.bank_mail_attachment_job_id = job_row.id
     AND artifact.trusted_document_validation_id = trusted.id
    JOIN public.crm_mortgage_application_events AS event
      ON event.id = job_row.command_event_id
     AND event.organization_id = job_row.organization_id
     AND event.case_id = job_row.case_id
     AND event.application_id = job_row.application_id
     AND event.command_id = job_row.id
     AND event.event_type = 'artifact_attached'
     AND event.actor_kind = 'bank_mail_agent'
     AND event.bank_mail_attachment_job_id = job_row.id
    JOIN private.mail_bank_agent_pdf_attachment_provenance AS provenance
      ON provenance.attachment_job_id = job_row.id
     AND provenance.organization_id = job_row.organization_id
     AND provenance.intake_id = job_row.intake_id
     AND provenance.dispatch_id = job_row.dispatch_id
     AND provenance.dispatch_generation = job_row.dispatch_generation
     AND provenance.generation_context_sha256 = job_row.generation_context_sha256
     AND provenance.dispatch_payload_sha256 = job_row.dispatch_payload_sha256
     AND provenance.document_id = document.id
     AND provenance.trusted_validation_id = trusted.id
     AND provenance.artifact_id = artifact.id
     AND provenance.command_event_id = event.id
    JOIN public.crm_document_storage_cleanup_jobs AS cleanup
      ON cleanup.id = job_row.cleanup_job_id
     AND cleanup.document_id = document.id
     AND cleanup.bank_mail_attachment_job_id = job_row.id
     AND cleanup.status = 'retained'
    WHERE document.id = job_row.document_id
      AND document.organization_id = job_row.organization_id
      AND document.case_id = job_row.case_id
      AND document.submission_id = job_row.application_id
      AND document.document_type = 'mortgage_esis'
      AND document.actor_kind = 'bank_mail_agent'
      AND document.bank_mail_attachment_job_id = job_row.id
      AND document.mime_type = 'application/pdf'
      AND document.sha256 = job_row.pdf_sha256
      AND document.size_bytes = job_row.pdf_size_bytes
      AND document.name = job_row.pdf_file_name
      AND document.storage_bucket = job_row.storage_bucket
      AND document.storage_path = job_row.storage_path;

    IF live_document_id IS NULL THEN
      RETURN jsonb_build_object(
        'state', 'conflict',
        'resolutionCode', 'attachment_scope_conflict',
        'documentId', NULL,
        'fileName', NULL,
        'completedAt', job_row.completed_at
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'state', job_row.state,
    'resolutionCode', job_row.resolution_code,
    'documentId', CASE WHEN job_row.state = 'attached' THEN live_document_id ELSE NULL END,
    'fileName', CASE WHEN job_row.state = 'attached' THEN live_file_name ELSE NULL END,
    'completedAt', CASE
      WHEN job_row.state IN ('attached', 'review_required', 'failed', 'conflict')
      THEN job_row.completed_at
      ELSE NULL
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION private.get_bank_mail_agent_pdf_attachment_status(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.get_bank_mail_agent_pdf_attachment_status(uuid)
  TO openexpert_owner;

CREATE OR REPLACE FUNCTION public.get_my_mail_bank_agent_statuses(
  p_organization_id uuid,
  p_connection_id uuid,
  p_provider_message_id_hashes text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET row_security TO off
AS $$
DECLARE
  caller_user_id uuid := (SELECT app.current_user_id());
  status_now timestamptz := statement_timestamp();
  result jsonb;
BEGIN
  IF caller_user_id IS NULL
    OR p_organization_id IS NULL
    OR p_connection_id IS NULL
    OR p_provider_message_id_hashes IS NULL
    OR coalesce(array_ndims(p_provider_message_id_hashes), 0) <> 1
    OR cardinality(p_provider_message_id_hashes) NOT BETWEEN 1 AND 50
    OR EXISTS (
      SELECT 1
      FROM unnest(p_provider_message_id_hashes) AS requested(hash)
      WHERE requested.hash IS NULL
        OR requested.hash !~ '^[0-9a-f]{64}$'
    )
    OR (
      SELECT count(*) <> count(DISTINCT requested.hash)
      FROM unnest(p_provider_message_id_hashes) AS requested(hash)
    )
  THEN
    RAISE EXCEPTION 'invalid_mail_bank_agent_status_request'
      USING errcode = '22023';
  END IF;

  PERFORM 1
  FROM public.mail_connections AS connection
  WHERE connection.organization_id = p_organization_id
    AND connection.owner_user_id = caller_user_id
    AND connection.id = p_connection_id
    AND private.is_organization_member(p_organization_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mail_bank_agent_status_scope_not_found'
      USING errcode = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'providerMessageIdSha256', intake.provider_message_id_sha256,
        'state', CASE
          WHEN intake.status IN ('claimed', 'analyzing') THEN 'processing'
          WHEN intake.status = 'review_required' THEN 'review_required'
          WHEN intake.status = 'failed' THEN 'failed'
          ELSE 'completed'
        END,
        'result', private.get_bank_mail_agent_canonical_result(intake.id),
        'link', private.get_bank_mail_agent_thread_link_status(intake.id),
        'attachment', private.get_bank_mail_agent_pdf_attachment_status(intake.id),
        'reanalysis', jsonb_build_object(
          'state', CASE
            WHEN latest_request.id IS NULL THEN NULL
            WHEN latest_request.state = 'queued'
              AND latest_request.requested_at
                <= status_now - interval '15 minutes'
            THEN 'failed'
            WHEN latest_request.state = 'leased'
              AND latest_request.lease_expires_at <= status_now
            THEN 'failed'
            WHEN latest_request.state = 'session_bound'
              AND latest_request.session_bound_at
                <= status_now - interval '24 hours 5 minutes'
            THEN 'failed'
            WHEN latest_request.state IN ('queued', 'leased', 'session_bound')
            THEN 'processing'
            ELSE latest_request.state
          END,
          'attemptNo', coalesce(latest_request.attempt_no, 0),
          'requestedAt', latest_request.requested_at,
          'completedAt', CASE
            WHEN latest_request.state = 'queued'
              AND latest_request.requested_at
                <= status_now - interval '15 minutes'
            THEN latest_request.requested_at + interval '15 minutes'
            WHEN latest_request.state = 'leased'
              AND latest_request.lease_expires_at <= status_now
            THEN latest_request.lease_expires_at
            WHEN latest_request.state = 'session_bound'
              AND latest_request.session_bound_at
                <= status_now - interval '24 hours 5 minutes'
            THEN latest_request.session_bound_at + interval '24 hours 5 minutes'
            ELSE latest_request.completed_at
          END,
          'canRerun', private.bank_mail_agent_reanalysis_intake_is_eligible(intake.id)
            AND coalesce((availability.value ->> 'canRequest')::boolean, false),
          'retryAfterSeconds', coalesce(
            (availability.value ->> 'retryAfterSeconds')::integer,
            0
          ),
          'result', CASE
            WHEN latest_request.state = 'completed' THEN jsonb_build_object(
              'code', CASE latest_request.result_code
                WHEN 'review_required' THEN 'proposal_created'
                ELSE latest_request.result_code
              END,
              'classification', latest_request.classification,
              'evidenceCodes', to_jsonb(latest_request.evidence_codes),
              'contradictionCodes', to_jsonb(latest_request.contradiction_codes),
              'reasonCodes', to_jsonb(latest_request.reason_codes),
              'completedAt', latest_request.completed_at,
              'caseId', latest_request.result_case_id,
              'applicationId', latest_request.result_application_id
            )
            ELSE NULL
          END
        )
      ) ORDER BY requested.ordinality
    ),
    '[]'::jsonb
  )
  INTO result
  FROM unnest(p_provider_message_id_hashes)
    WITH ORDINALITY AS requested(hash, ordinality)
  JOIN public.mail_bank_agent_intakes AS intake
    ON intake.organization_id = p_organization_id
   AND intake.owner_user_id = caller_user_id
   AND intake.connection_id = p_connection_id
   AND intake.provider_message_id_sha256 = requested.hash
  LEFT JOIN LATERAL (
    SELECT request.*
    FROM private.mail_bank_agent_reanalysis_requests AS request
    WHERE request.intake_id = intake.id
    ORDER BY request.requested_at DESC, request.id DESC
    LIMIT 1
  ) AS latest_request ON true
  CROSS JOIN LATERAL (
    SELECT private.bank_mail_agent_reanalysis_availability(
      intake.id,
      status_now
    ) AS value
  ) AS availability;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[]) IS
  'Returns controlled canonical result, live thread-link state, automatic PDF attachment lifecycle and latest advisory-rerun lifecycle for bounded message hashes in the authenticated user own mailbox. It exposes no intake, request, run, session or normalized-input identifiers.';

ALTER FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  TO authenticated, openexpert_owner;

-- Rollout note: the five new public PDF-worker RPC signatures require a Neon
-- Data API/PostgREST schema-cache refresh after this migration and before the
-- Trigger worker is enabled.  Safe order is DB -> CRM writer -> cache refresh
-- -> Trigger drainer; legacy mock-bank payload commits remain delivery-safe
-- but NULL-pinned generations are intentionally not auto-attach eligible.
