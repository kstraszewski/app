-- Auditable, compliance-oriented mortgage application lifecycle.
-- Files remain in crm_documents. These tables pin the legal meaning, version,
-- recipients and delivery evidence without mutating an immutable calculation
-- snapshot in crm_case_bank_applications.

CREATE FUNCTION private.polish_easter_sunday(p_year integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO ''
AS $$
DECLARE
  a integer := p_year % 19;
  b integer := p_year / 100;
  c integer := p_year % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4;
  k integer := c % 4;
  l integer := (32 + 2 * e + 2 * i - h - k) % 7;
  m integer := (a + 11 * h + 22 * l) / 451;
  month_number integer := (h + l - 7 * m + 114) / 31;
  day_number integer := ((h + l - 7 * m + 114) % 31) + 1;
BEGIN
  RETURN make_date(p_year, month_number, day_number);
END;
$$;

REVOKE ALL ON FUNCTION private.polish_easter_sunday(integer)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.is_polish_mortgage_non_working_day(p_date date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path TO ''
AS $$
  SELECT extract(isodow FROM p_date) IN (6, 7)
    OR to_char(p_date, 'MM-DD') IN (
      '01-01', '01-06', '05-01', '05-03', '08-15',
      '11-01', '11-11', '12-25', '12-26'
    )
    OR (extract(year FROM p_date)::integer >= 2025 AND to_char(p_date, 'MM-DD') = '12-24')
    OR p_date = private.polish_easter_sunday(extract(year FROM p_date)::integer)
    OR p_date = private.polish_easter_sunday(extract(year FROM p_date)::integer) + 1
    OR p_date = private.polish_easter_sunday(extract(year FROM p_date)::integer) + 60;
$$;

REVOKE ALL ON FUNCTION private.is_polish_mortgage_non_working_day(date)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.crm_mortgage_decision_due_at(p_complete_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path TO ''
AS $$
DECLARE
  due_date date := (p_complete_at AT TIME ZONE 'Europe/Warsaw')::date + 21;
BEGIN
  WHILE private.is_polish_mortgage_non_working_day(due_date) LOOP
    due_date := due_date + 1;
  END LOOP;
  RETURN (due_date + time '23:59:59.999999') AT TIME ZONE 'Europe/Warsaw';
END;
$$;

COMMENT ON FUNCTION private.crm_mortgage_decision_due_at(timestamptz) IS
  'Art. 14 policy pl-art14-v1: local completeness date + 21 days, rolled to the next Polish working day, end of Europe/Warsaw day.';

REVOKE ALL ON FUNCTION private.crm_mortgage_decision_due_at(timestamptz)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TABLE public.crm_mortgage_application_processes (
  application_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  stage text DEFAULT 'pre_application' NOT NULL,
  revision bigint DEFAULT 0 NOT NULL,
  application_submitted_at timestamptz,
  application_acknowledged_at timestamptz,
  completeness_confirmed_at timestamptz,
  decision_due_at timestamptz,
  deadline_policy_version text,
  additional_information_requested_at timestamptz,
  decision_received_at timestamptz,
  decision_outcome text,
  closed_at timestamptz,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_application_processes_scope_key
    UNIQUE (organization_id, case_id, application_id),
  CONSTRAINT crm_mortgage_application_processes_stage_check CHECK (
    stage IN (
      'pre_application', 'submitted', 'awaiting_completeness', 'under_review',
      'additional_information_requested', 'decision_received',
      'decision_delivered', 'agreement_review', 'ready_for_contract',
      'completed', 'closed'
    )
  ),
  CONSTRAINT crm_mortgage_application_processes_revision_check CHECK (revision >= 0),
  CONSTRAINT crm_mortgage_application_processes_outcome_check CHECK (
    decision_outcome IS NULL OR decision_outcome IN ('positive', 'negative')
  ),
  CONSTRAINT crm_mortgage_application_processes_deadline_shape_check CHECK (
    (completeness_confirmed_at IS NULL AND decision_due_at IS NULL AND deadline_policy_version IS NULL)
    OR (completeness_confirmed_at IS NOT NULL AND decision_due_at IS NOT NULL AND deadline_policy_version = 'pl-art14-v1')
  ),
  CONSTRAINT crm_mortgage_application_processes_decision_shape_check CHECK (
    (decision_received_at IS NULL AND decision_outcome IS NULL)
    OR (decision_received_at IS NOT NULL AND decision_outcome IS NOT NULL)
  ),
  CONSTRAINT crm_mortgage_application_processes_closed_shape_check CHECK (
    (stage = 'closed' AND closed_at IS NOT NULL) OR (stage <> 'closed' AND closed_at IS NULL)
  ),
  CONSTRAINT crm_mortgage_application_processes_timestamp_order_check CHECK (
    (application_acknowledged_at IS NULL OR (
      application_submitted_at IS NOT NULL
      AND application_acknowledged_at >= application_submitted_at
    ))
    AND (completeness_confirmed_at IS NULL OR (
      application_submitted_at IS NOT NULL
      AND completeness_confirmed_at >= application_submitted_at
      AND (
        application_acknowledged_at IS NULL
        OR completeness_confirmed_at >= application_acknowledged_at
      )
    ))
    AND (additional_information_requested_at IS NULL OR (
      application_submitted_at IS NOT NULL
      AND additional_information_requested_at >= application_submitted_at
    ))
    AND (decision_received_at IS NULL OR (
      application_submitted_at IS NOT NULL
      AND decision_received_at >= application_submitted_at
      AND (
        completeness_confirmed_at IS NULL
        OR decision_received_at >= completeness_confirmed_at
      )
    ))
    AND (closed_at IS NULL OR closed_at >= created_at)
  ),
  CONSTRAINT crm_mortgage_application_processes_application_fk
    FOREIGN KEY (organization_id, case_id, application_id)
    REFERENCES public.crm_case_bank_applications (organization_id, case_id, submission_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_application_processes_created_by_fk
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE SET NULL (created_by_user_id),
  CONSTRAINT crm_mortgage_application_processes_updated_by_fk
    FOREIGN KEY (organization_id, updated_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE SET NULL (updated_by_user_id)
);

COMMENT ON TABLE public.crm_mortgage_application_processes IS
  'Mutable 1:1 projection of a mortgage application lifecycle. Revision changes only through the command RPC.';

CREATE INDEX crm_mortgage_application_processes_active_deadline_idx
  ON public.crm_mortgage_application_processes (organization_id, decision_due_at, case_id)
  WHERE closed_at IS NULL AND stage NOT IN ('completed', 'closed');

CREATE INDEX crm_mortgage_application_processes_updated_idx
  ON public.crm_mortgage_application_processes (organization_id, updated_at DESC, application_id);

CREATE TRIGGER crm_mortgage_application_processes_set_updated_at
  BEFORE UPDATE ON public.crm_mortgage_application_processes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.crm_mortgage_application_parties (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  client_id uuid NOT NULL,
  role text NOT NULL,
  frozen_at timestamptz NOT NULL,
  frozen_by_user_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_application_parties_pkey
    PRIMARY KEY (application_id, client_id),
  CONSTRAINT crm_mortgage_application_parties_scope_key
    UNIQUE (organization_id, case_id, application_id, client_id),
  CONSTRAINT crm_mortgage_application_parties_role_check CHECK (
    role IN ('primary_applicant', 'co_applicant')
  ),
  CONSTRAINT crm_mortgage_application_parties_application_fk
    FOREIGN KEY (organization_id, case_id, application_id)
    REFERENCES public.crm_case_bank_applications (organization_id, case_id, submission_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_application_parties_client_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.crm_clients (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_application_parties_actor_fk
    FOREIGN KEY (organization_id, frozen_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE SET NULL (frozen_by_user_id)
);

COMMENT ON TABLE public.crm_mortgage_application_parties IS
  'Applicant/recipient set frozen atomically when the application is submitted.';

CREATE INDEX crm_mortgage_application_parties_scope_idx
  ON public.crm_mortgage_application_parties (organization_id, case_id, application_id);

-- AI validation is authoritative only for the exact immutable source bytes
-- and mortgage application scope. The composite key lets the validation FK
-- pin all of those attributes instead of trusting duplicated request fields.
ALTER TABLE public.crm_documents
  ADD CONSTRAINT crm_documents_mortgage_ai_validation_scope_key
  UNIQUE (organization_id, case_id, submission_id, id, sha256);

CREATE FUNCTION private.is_valid_crm_mortgage_ai_reason_codes(p_codes text[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO ''
AS $$
DECLARE
  reason_code text;
  seen_codes text[] := ARRAY[]::text[];
BEGIN
  IF cardinality(p_codes) > 32 THEN
    RETURN false;
  END IF;
  FOREACH reason_code IN ARRAY p_codes LOOP
    IF reason_code IS NULL
      OR reason_code <> ALL(ARRAY[
        'document_empty', 'document_unreadable', 'document_partially_readable',
        'wrong_document_kind', 'document_kind_unconfirmed', 'wrong_bank',
        'bank_unconfirmed', 'no_applicant_match', 'applicant_match_incomplete',
        'applicant_match_unconfirmed', 'decision_outcome_mismatch',
        'decision_outcome_unconfirmed', 'valid_until_mismatch',
        'valid_until_unconfirmed', 'loan_amount_mismatch',
        'loan_amount_unconfirmed', 'currency_mismatch',
        'missing_required_sections', 'document_anomaly',
        'inconsistent_observation', 'low_confidence'
      ]::text[])
      OR reason_code = ANY(seen_codes)
    THEN
      RETURN false;
    END IF;
    seen_codes := array_append(seen_codes, reason_code);
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_crm_mortgage_ai_reason_codes(text[])
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.is_valid_crm_mortgage_ai_observations(p_observations jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO ''
AS $$
DECLARE
  check_key text;
  check_value text;
  expected_count numeric;
  matched_count numeric;
  missing_signal_codes text[];
  anomaly_codes_value text[];
BEGIN
  IF jsonb_typeof(p_observations) <> 'object'
    OR pg_column_size(p_observations) > 16384
    OR p_observations - ARRAY[
      'checks', 'expectedApplicantCount', 'matchedApplicantCount',
      'missingSignalCodes', 'anomalyCodes'
    ]::text[] <> '{}'::jsonb
    OR NOT p_observations ?& ARRAY[
      'checks', 'expectedApplicantCount', 'matchedApplicantCount',
      'missingSignalCodes', 'anomalyCodes'
    ]::text[]
  THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_observations -> 'checks') <> 'object'
    OR (p_observations -> 'checks') - ARRAY[
      'content', 'kind', 'bank', 'applicants', 'decisionOutcome',
      'validUntil', 'loanAmount', 'requiredSections'
    ]::text[] <> '{}'::jsonb
    OR NOT (p_observations -> 'checks') ?& ARRAY[
      'content', 'kind', 'bank', 'applicants', 'decisionOutcome',
      'validUntil', 'loanAmount', 'requiredSections'
    ]::text[]
  THEN
    RETURN false;
  END IF;
  FOREACH check_key IN ARRAY ARRAY[
    'content', 'kind', 'bank', 'applicants', 'decisionOutcome',
    'validUntil', 'loanAmount', 'requiredSections'
  ]::text[] LOOP
    IF jsonb_typeof(p_observations -> 'checks' -> check_key) <> 'string' THEN
      RETURN false;
    END IF;
    check_value := p_observations -> 'checks' ->> check_key;
    IF check_value NOT IN ('match', 'partial', 'mismatch', 'unknown', 'not_applicable') THEN
      RETURN false;
    END IF;
  END LOOP;

  IF jsonb_typeof(p_observations -> 'expectedApplicantCount') <> 'number'
    OR jsonb_typeof(p_observations -> 'matchedApplicantCount') <> 'number'
  THEN
    RETURN false;
  END IF;
  expected_count := (p_observations ->> 'expectedApplicantCount')::numeric;
  matched_count := (p_observations ->> 'matchedApplicantCount')::numeric;
  IF expected_count <> trunc(expected_count) OR expected_count NOT BETWEEN 0 AND 20
    OR matched_count <> trunc(matched_count) OR matched_count NOT BETWEEN 0 AND 20
    OR matched_count > expected_count
  THEN
    RETURN false;
  END IF;

  IF jsonb_typeof(p_observations -> 'missingSignalCodes') <> 'array'
    OR jsonb_array_length(p_observations -> 'missingSignalCodes') > 10
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_observations -> 'missingSignalCodes') AS codes(code)
      WHERE jsonb_typeof(code) <> 'string'
    )
    OR jsonb_typeof(p_observations -> 'anomalyCodes') <> 'array'
    OR jsonb_array_length(p_observations -> 'anomalyCodes') > 8
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_observations -> 'anomalyCodes') AS codes(code)
      WHERE jsonb_typeof(code) <> 'string'
    )
  THEN
    RETURN false;
  END IF;

  SELECT coalesce(array_agg(code #>> '{}'), ARRAY[]::text[])
  INTO missing_signal_codes
  FROM jsonb_array_elements(p_observations -> 'missingSignalCodes') AS codes(code);
  IF cardinality(missing_signal_codes) <> (
      SELECT count(DISTINCT code) FROM unnest(missing_signal_codes) code
    )
    OR NOT missing_signal_codes <@ ARRAY[
      'creditorIdentity', 'applicantIdentity', 'issueDate', 'financialTerms',
      'validityPeriod', 'aprc', 'repaymentTerms', 'explicitDecision',
      'decisionOutcome', 'conditionsOrRefusal'
    ]::text[]
  THEN
    RETURN false;
  END IF;

  SELECT coalesce(array_agg(code #>> '{}'), ARRAY[]::text[])
  INTO anomaly_codes_value
  FROM jsonb_array_elements(p_observations -> 'anomalyCodes') AS codes(code);
  IF cardinality(anomaly_codes_value) <> (
      SELECT count(DISTINCT code) FROM unnest(anomaly_codes_value) code
    )
    OR NOT anomaly_codes_value <@ ARRAY[
      'password_protected', 'mostly_blank', 'truncated', 'mixed_documents',
      'illegible_scan', 'prompt_injection_text', 'inconsistent_pages', 'missing_pages'
    ]::text[]
  THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.is_valid_crm_mortgage_ai_observations(jsonb)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.is_consistent_crm_mortgage_ai_accepted_verdict(
  p_expected_kind text,
  p_verdict text,
  p_reason_codes text[],
  p_confidence numeric,
  p_observations jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path TO ''
AS $$
DECLARE
  expected_count integer;
  matched_count integer;
  check_key text;
  check_value text;
BEGIN
  IF p_verdict <> 'accepted' THEN
    RETURN true;
  END IF;
  IF p_confidence < 0.8500
    OR cardinality(p_reason_codes) <> 0
    OR NOT private.is_valid_crm_mortgage_ai_observations(p_observations)
  THEN
    RETURN false;
  END IF;
  expected_count := (p_observations ->> 'expectedApplicantCount')::integer;
  matched_count := (p_observations ->> 'matchedApplicantCount')::integer;
  IF expected_count < 1
    OR matched_count <> expected_count
    OR jsonb_array_length(p_observations -> 'missingSignalCodes') <> 0
    OR jsonb_array_length(p_observations -> 'anomalyCodes') <> 0
  THEN
    RETURN false;
  END IF;
  FOREACH check_key IN ARRAY ARRAY[
    'content', 'kind', 'bank', 'applicants', 'requiredSections'
  ]::text[] LOOP
    IF p_observations -> 'checks' ->> check_key <> 'match' THEN
      RETURN false;
    END IF;
  END LOOP;
  check_value := p_observations -> 'checks' ->> 'decisionOutcome';
  IF (p_expected_kind = 'credit_decision' AND check_value <> 'match')
    OR (p_expected_kind = 'esis' AND check_value <> 'not_applicable')
  THEN
    RETURN false;
  END IF;
  FOREACH check_key IN ARRAY ARRAY['validUntil', 'loanAmount']::text[] LOOP
    check_value := p_observations -> 'checks' ->> check_key;
    IF check_value NOT IN ('match', 'not_applicable') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.is_consistent_crm_mortgage_ai_accepted_verdict(
  text, text, text[], numeric, jsonb
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.is_effective_crm_mortgage_ai_validation(
  p_verdict text,
  p_expert_override_reason text,
  p_expert_overridden_at timestamptz,
  p_expert_overridden_by_user_id uuid
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO ''
AS $$
  SELECT p_verdict = 'accepted'
    OR (
      p_verdict = 'needs_review'
      AND nullif(btrim(p_expert_override_reason), '') IS NOT NULL
      AND p_expert_overridden_at IS NOT NULL
      AND p_expert_overridden_by_user_id IS NOT NULL
    );
$$;

REVOKE ALL ON FUNCTION private.is_effective_crm_mortgage_ai_validation(
  text, text, timestamptz, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.crm_mortgage_applicant_context(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_use_frozen_parties boolean
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
STRICT
SET search_path TO ''
AS $$
DECLARE
  applicants_value jsonb;
  applicant_versions_value jsonb;
  recipient_count integer;
  resolved_count integer;
  context_sha256 text;
BEGIN
  WITH recipient_ids AS (
    SELECT link.client_id
    FROM public.crm_case_clients link
    WHERE NOT p_use_frozen_parties
      AND link.organization_id = p_organization_id
      AND link.case_id = p_case_id
    UNION ALL
    SELECT party.client_id
    FROM public.crm_mortgage_application_parties party
    WHERE p_use_frozen_parties
      AND party.organization_id = p_organization_id
      AND party.case_id = p_case_id
      AND party.application_id = p_application_id
  ), resolved AS (
    SELECT recipient.client_id, client.display_name, client.updated_at
    FROM recipient_ids recipient
    JOIN public.crm_clients client
      ON client.organization_id = p_organization_id
     AND client.id = recipient.client_id
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'clientId', resolved.client_id::text,
          'displayName', resolved.display_name
        )
        ORDER BY resolved.client_id::text COLLATE "C"
      ),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'clientId', resolved.client_id::text,
          'updatedAt', resolved.updated_at
        )
        ORDER BY resolved.client_id::text COLLATE "C"
      ),
      '[]'::jsonb
    ),
    (SELECT count(*) FROM recipient_ids),
    count(*)
  INTO applicants_value, applicant_versions_value, recipient_count, resolved_count
  FROM resolved;

  IF recipient_count NOT BETWEEN 1 AND 20
    OR resolved_count <> recipient_count
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(applicants_value) applicant
      WHERE nullif(btrim(applicant ->> 'displayName'), '') IS NULL
        OR octet_length(convert_to(applicant ->> 'displayName', 'utf8')) > 2048
    )
  THEN
    RAISE EXCEPTION 'invalid_mortgage_document_applicant_context'
      USING errcode = '23514';
  END IF;

  context_sha256 := encode(
    extensions.digest(
      convert_to(
        'mortgage-applicant-context-v2' || chr(31) || applicant_versions_value::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );
  RETURN jsonb_build_object(
    'applicants', applicants_value,
    'applicantContextSha256', context_sha256
  );
END;
$$;

COMMENT ON FUNCTION private.crm_mortgage_applicant_context(uuid, uuid, uuid, boolean) IS
  'Builds ordered applicant names and an opaque SHA-256 token over canonical clientId+updatedAt versions; the hash preimage excludes displayName PII.';

REVOKE ALL ON FUNCTION private.crm_mortgage_applicant_context(
  uuid, uuid, uuid, boolean
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.get_crm_mortgage_document_applicant_context(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
STRICT
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  process_stage text;
BEGIN
  SELECT process.stage
  INTO process_stage
  FROM public.crm_case_bank_applications application
  JOIN public.crm_mortgage_application_processes process
    ON process.organization_id = application.organization_id
   AND process.case_id = application.case_id
   AND process.application_id = application.submission_id
  WHERE application.organization_id = p_organization_id
    AND application.case_id = p_case_id
    AND application.submission_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_process_not_found'
      USING errcode = 'P0002';
  END IF;
  RETURN private.crm_mortgage_applicant_context(
    p_organization_id,
    p_case_id,
    p_application_id,
    process_stage <> 'pre_application'
  );
END;
$$;

COMMENT ON FUNCTION public.get_crm_mortgage_document_applicant_context(uuid, uuid, uuid) IS
  'Service-only atomic read of the exact ordered applicant names sent to AI and their opaque DB-generated context hash.';

REVOKE ALL ON FUNCTION public.get_crm_mortgage_document_applicant_context(
  uuid, uuid, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.crm_mortgage_document_validation_context(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_use_frozen_parties boolean,
  p_expected_kind text,
  p_decision_outcome text,
  p_valid_until timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO ''
AS $$
DECLARE
  application_row public.crm_case_bank_applications%rowtype;
  offer_row public.crm_case_offer_snapshots%rowtype;
  bank_row public.mortgage_banks%rowtype;
  applicant_context jsonb;
  bank_aliases jsonb;
  bank_context_sha256 text;
  loan_amount_value numeric(14,2);
  currency_value text;
  expectation_value jsonb;
  expectation_sha256 text;
BEGIN
  IF p_expected_kind NOT IN ('esis', 'credit_decision')
    OR (p_expected_kind = 'esis' AND p_decision_outcome IS NOT NULL)
    OR (
      p_expected_kind = 'credit_decision'
      AND p_decision_outcome NOT IN ('positive', 'negative')
    )
    OR (p_valid_until IS NOT NULL AND NOT isfinite(p_valid_until))
  THEN
    RAISE EXCEPTION 'invalid_mortgage_document_validation_expectation'
      USING errcode = '22023';
  END IF;

  SELECT application.* INTO application_row
  FROM public.crm_case_bank_applications application
  WHERE application.organization_id = p_organization_id
    AND application.case_id = p_case_id
    AND application.submission_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_not_found' USING errcode = 'P0002';
  END IF;

  SELECT offer.* INTO offer_row
  FROM public.crm_case_offer_snapshots offer
  WHERE offer.organization_id = application_row.organization_id
    AND offer.case_id = application_row.case_id
    AND offer.id = application_row.offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_offer_not_found' USING errcode = 'P0002';
  END IF;
  SELECT bank.* INTO bank_row
  FROM public.mortgage_banks bank
  WHERE bank.id = application_row.bank_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_bank_not_found' USING errcode = 'P0002';
  END IF;

  applicant_context := private.crm_mortgage_applicant_context(
    p_organization_id, p_case_id, p_application_id, p_use_frozen_parties
  );
  SELECT jsonb_agg(alias_value ORDER BY alias_value COLLATE "C")
  INTO bank_aliases
  FROM (
    SELECT DISTINCT btrim(inputs.value) AS alias_value
    FROM unnest(ARRAY[offer_row.bank_name, bank_row.name, bank_row.slug]) AS inputs(value)
    WHERE nullif(btrim(inputs.value), '') IS NOT NULL
  ) aliases;

  IF p_expected_kind = 'esis' THEN
    loan_amount_value := coalesce(
      application_row.gross_loan_amount,
      application_row.net_loan_amount,
      offer_row.loan_amount
    );
    IF loan_amount_value IS NOT NULL THEN
      currency_value := upper(btrim(coalesce(
        application_row.scenario_snapshot ->> 'currency',
        application_row.scenario_snapshot -> 'property' ->> 'currency',
        application_row.calculation_snapshot ->> 'currency',
        offer_row.currency::text
      )));
      IF currency_value !~ '^[A-Z]{3}$' THEN
        RAISE EXCEPTION 'mortgage_esis_validation_currency_missing_or_invalid'
          USING errcode = '23514';
      END IF;
    END IF;
  END IF;

  bank_context_sha256 := encode(
    extensions.digest(
      convert_to(
        'mortgage-bank-context-v1' || chr(31) || jsonb_build_object(
          'bankId', application_row.bank_id::text,
          'offerId', application_row.offer_id::text,
          'aliases', coalesce(bank_aliases, '[]'::jsonb),
          'bankUpdatedAt', bank_row.updated_at
        )::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  expectation_value := jsonb_build_object(
    'kind', p_expected_kind,
    'bankId', application_row.bank_id::text,
    'offerId', application_row.offer_id::text,
    'bankContextSha256', bank_context_sha256,
    'applicantContextSha256', applicant_context ->> 'applicantContextSha256',
    'decisionOutcome', p_decision_outcome,
    'validUntil', p_valid_until,
    'loanAmount', loan_amount_value,
    'currency', currency_value
  );
  expectation_sha256 := encode(
    extensions.digest(
      convert_to(
        'mortgage-document-expectation-v1' || chr(31) || expectation_value::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'kind', p_expected_kind,
    'bankId', application_row.bank_id::text,
    'offerId', application_row.offer_id::text,
    'bankName', offer_row.bank_name,
    'bankAliases', coalesce(bank_aliases, '[]'::jsonb),
    'bankContextSha256', bank_context_sha256,
    'applicants', applicant_context -> 'applicants',
    'applicantContextSha256', applicant_context ->> 'applicantContextSha256',
    'decisionOutcome', p_decision_outcome,
    'validUntil', p_valid_until,
    'loanAmount', loan_amount_value,
    'currency', currency_value,
    'expectationSha256', expectation_sha256
  ));
END;
$$;

REVOKE ALL ON FUNCTION private.crm_mortgage_document_validation_context(
  uuid, uuid, uuid, boolean, text, text, timestamptz
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.get_crm_mortgage_document_validation_context(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_expected_kind text,
  p_decision_outcome text DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  process_stage text;
BEGIN
  SELECT process.stage INTO process_stage
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = p_organization_id
    AND process.case_id = p_case_id
    AND process.application_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_process_not_found' USING errcode = 'P0002';
  END IF;
  RETURN private.crm_mortgage_document_validation_context(
    p_organization_id,
    p_case_id,
    p_application_id,
    process_stage <> 'pre_application',
    p_expected_kind,
    p_decision_outcome,
    p_valid_until
  );
END;
$$;

COMMENT ON FUNCTION public.get_crm_mortgage_document_validation_context(
  uuid, uuid, uuid, text, text, timestamptz
) IS 'Service-only atomic canonical context for mortgage document AI. The caller sends exactly these values to the model and persists the opaque hashes/facts returned.';

REVOKE ALL ON FUNCTION public.get_crm_mortgage_document_validation_context(
  uuid, uuid, uuid, text, text, timestamptz
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- A provider verdict must survive the HTTP request which produced it. Without
-- this cache a rejected PDF could be submitted repeatedly until a stochastic
-- model happened to return accepted. The key deliberately spans commands: the
-- same bytes under the same authoritative expectation are analysed once.
CREATE TABLE public.crm_mortgage_document_ai_attempts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  expected_kind text NOT NULL,
  source_sha256 text NOT NULL,
  applicant_context_sha256 text NOT NULL,
  bank_context_sha256 text NOT NULL,
  expectation_sha256 text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  status text DEFAULT 'pending' NOT NULL,
  lease_token_sha256 text NOT NULL,
  lease_expires_at timestamptz,
  claim_count integer DEFAULT 1 NOT NULL,
  verdict text,
  confidence numeric(5,4),
  reason_codes text[],
  pii_free_observations jsonb,
  claimed_at timestamptz NOT NULL,
  claimed_by_user_id uuid NOT NULL,
  completed_at timestamptz,
  completed_by_user_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_document_ai_attempts_scope_id_key
    UNIQUE (organization_id, case_id, application_id, id),
  CONSTRAINT crm_mortgage_document_ai_attempts_replay_key UNIQUE (
    organization_id, case_id, application_id, expected_kind, source_sha256,
    applicant_context_sha256, bank_context_sha256, expectation_sha256,
    provider, model, prompt_version
  ),
  CONSTRAINT crm_mortgage_document_ai_attempts_kind_check CHECK (
    expected_kind IN ('esis', 'credit_decision')
  ),
  CONSTRAINT crm_mortgage_document_ai_attempts_hash_check CHECK (
    source_sha256 ~ '^[0-9a-f]{64}$'
    AND applicant_context_sha256 ~ '^[0-9a-f]{64}$'
    AND bank_context_sha256 ~ '^[0-9a-f]{64}$'
    AND expectation_sha256 ~ '^[0-9a-f]{64}$'
    AND lease_token_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT crm_mortgage_document_ai_attempts_model_identity_check CHECK (
    provider = 'vercel-ai-gateway'
    AND model = 'gemini-3.5-flash-lite'
    AND prompt_version = 'mortgage-document-validation-v1'
  ),
  CONSTRAINT crm_mortgage_document_ai_attempts_claim_count_check CHECK (
    claim_count BETWEEN 1 AND 10
  ),
  CONSTRAINT crm_mortgage_document_ai_attempts_state_check CHECK (
    (
      status = 'pending'
      AND lease_expires_at IS NOT NULL
      AND verdict IS NULL
      AND confidence IS NULL
      AND reason_codes IS NULL
      AND pii_free_observations IS NULL
      AND completed_at IS NULL
      AND completed_by_user_id IS NULL
    ) OR (
      status = 'completed'
      AND lease_expires_at IS NULL
      AND verdict IN ('accepted', 'needs_review', 'rejected')
      AND confidence BETWEEN 0 AND 1
      AND reason_codes IS NOT NULL
      AND pii_free_observations IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_by_user_id IS NOT NULL
      AND private.is_valid_crm_mortgage_ai_reason_codes(reason_codes)
      AND private.is_valid_crm_mortgage_ai_observations(pii_free_observations)
      AND private.is_consistent_crm_mortgage_ai_accepted_verdict(
        expected_kind, verdict, reason_codes, confidence, pii_free_observations
      )
    )
  ),
  CONSTRAINT crm_mortgage_document_ai_attempts_time_check CHECK (
    isfinite(claimed_at)
    AND isfinite(created_at)
    AND isfinite(updated_at)
    AND (lease_expires_at IS NULL OR isfinite(lease_expires_at))
    AND (completed_at IS NULL OR isfinite(completed_at))
    AND updated_at >= created_at
    AND claimed_at >= created_at
    AND (completed_at IS NULL OR completed_at >= claimed_at)
  ),
  CONSTRAINT crm_mortgage_document_ai_attempts_application_fk
    FOREIGN KEY (organization_id, case_id, application_id)
    REFERENCES public.crm_case_bank_applications
      (organization_id, case_id, submission_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_document_ai_attempts_claimed_actor_fk
    FOREIGN KEY (organization_id, claimed_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_document_ai_attempts_completed_actor_fk
    FOREIGN KEY (organization_id, completed_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.crm_mortgage_document_ai_attempts IS
  'PII-free exactly-once cache of mortgage PDF AI outcomes. A completed negative or review verdict is replayed and never sent to the provider again.';
COMMENT ON COLUMN public.crm_mortgage_document_ai_attempts.lease_token_sha256 IS
  'SHA-256 of a short-lived capability returned only to the successful claimant; the plaintext token is never persisted.';

CREATE INDEX crm_mortgage_document_ai_attempts_scope_idx
  ON public.crm_mortgage_document_ai_attempts (
    organization_id, case_id, application_id, created_at DESC, id DESC
  );

CREATE FUNCTION public.claim_crm_mortgage_document_ai_attempt(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_actor_user_id uuid,
  p_expected_kind text,
  p_source_sha256 text,
  p_applicant_context_sha256 text,
  p_bank_context_sha256 text,
  p_expectation_sha256 text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_decision_outcome text DEFAULT NULL,
  p_valid_until timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  process_stage text;
  membership_role text;
  case_owner_user_id uuid;
  item_owner_user_id uuid;
  validation_context jsonb;
  attempt_row public.crm_mortgage_document_ai_attempts%rowtype;
  lease_token text;
  new_lease_token_sha256 text;
  lease_now timestamptz := clock_timestamp();
BEGIN
  IF p_expected_kind IS NULL
    OR p_source_sha256 IS NULL
    OR p_applicant_context_sha256 IS NULL
    OR p_bank_context_sha256 IS NULL
    OR p_expectation_sha256 IS NULL
    OR p_provider IS NULL
    OR p_model IS NULL
    OR p_prompt_version IS NULL
    OR p_expected_kind NOT IN ('esis', 'credit_decision')
    OR p_source_sha256 !~ '^[0-9a-f]{64}$'
    OR p_applicant_context_sha256 !~ '^[0-9a-f]{64}$'
    OR p_bank_context_sha256 !~ '^[0-9a-f]{64}$'
    OR p_expectation_sha256 !~ '^[0-9a-f]{64}$'
    OR p_provider <> 'vercel-ai-gateway'
    OR p_model <> 'gemini-3.5-flash-lite'
    OR p_prompt_version <> 'mortgage-document-validation-v1'
  THEN
    RAISE EXCEPTION 'invalid_mortgage_document_ai_attempt_claim'
      USING errcode = '22023';
  END IF;

  -- All attempt operations use application -> case/item/process -> attempt
  -- ordering. This is also the order used by artifact attachment.
  SELECT process.stage, membership.role, crm_case.owner_user_id, item.owner_user_id
  INTO process_stage, membership_role, case_owner_user_id, item_owner_user_id
  FROM public.crm_case_bank_applications application
  JOIN public.crm_cases crm_case
    ON crm_case.organization_id = application.organization_id
   AND crm_case.id = application.case_id
  JOIN public.crm_case_items item
    ON item.organization_id = application.organization_id
   AND item.case_id = application.case_id
   AND item.id = application.case_item_id
  JOIN public.crm_mortgage_application_processes process
    ON process.organization_id = application.organization_id
   AND process.case_id = application.case_id
   AND process.application_id = application.submission_id
  JOIN public.organization_memberships membership
    ON membership.organization_id = application.organization_id
   AND membership.user_id = p_actor_user_id
  WHERE application.organization_id = p_organization_id
    AND application.case_id = p_case_id
    AND application.submission_id = p_application_id
  FOR UPDATE OF application, crm_case, item, process;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_document_ai_attempt_scope_or_membership_not_found'
      USING errcode = '42501';
  END IF;
  IF membership_role <> 'admin'
    AND case_owner_user_id IS DISTINCT FROM p_actor_user_id
    AND item_owner_user_id IS DISTINCT FROM p_actor_user_id
  THEN
    RAISE EXCEPTION 'mortgage_case_manager_permission_required'
      USING errcode = '42501';
  END IF;

  validation_context := private.crm_mortgage_document_validation_context(
    p_organization_id,
    p_case_id,
    p_application_id,
    process_stage <> 'pre_application',
    p_expected_kind,
    p_decision_outcome,
    p_valid_until
  );
  IF p_applicant_context_sha256 IS DISTINCT FROM
      validation_context ->> 'applicantContextSha256'
    OR p_bank_context_sha256 IS DISTINCT FROM
      validation_context ->> 'bankContextSha256'
    OR p_expectation_sha256 IS DISTINCT FROM
      validation_context ->> 'expectationSha256'
  THEN
    RAISE EXCEPTION 'mortgage_document_ai_attempt_context_stale'
      USING errcode = '40001';
  END IF;

  lease_token := encode(extensions.gen_random_bytes(32), 'hex');
  new_lease_token_sha256 := encode(
    extensions.digest(convert_to(lease_token, 'utf8'), 'sha256'), 'hex'
  );
  INSERT INTO public.crm_mortgage_document_ai_attempts (
    organization_id, case_id, application_id, expected_kind, source_sha256,
    applicant_context_sha256, bank_context_sha256, expectation_sha256,
    provider, model, prompt_version, status, lease_token_sha256,
    lease_expires_at, claim_count, claimed_at, claimed_by_user_id,
    created_at, updated_at
  ) VALUES (
    p_organization_id, p_case_id, p_application_id, p_expected_kind,
    p_source_sha256, p_applicant_context_sha256, p_bank_context_sha256,
    p_expectation_sha256, p_provider, p_model, p_prompt_version, 'pending',
    new_lease_token_sha256, lease_now + interval '2 minutes', 1,
    lease_now, p_actor_user_id, lease_now, lease_now
  )
  ON CONFLICT ON CONSTRAINT crm_mortgage_document_ai_attempts_replay_key
    DO NOTHING
  RETURNING * INTO attempt_row;

  IF attempt_row.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'attemptId', attempt_row.id,
      'state', 'claimed',
      'leaseToken', lease_token,
      'leaseExpiresAt', attempt_row.lease_expires_at
    );
  END IF;

  SELECT attempt.* INTO STRICT attempt_row
  FROM public.crm_mortgage_document_ai_attempts attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.case_id = p_case_id
    AND attempt.application_id = p_application_id
    AND attempt.expected_kind = p_expected_kind
    AND attempt.source_sha256 = p_source_sha256
    AND attempt.applicant_context_sha256 = p_applicant_context_sha256
    AND attempt.bank_context_sha256 = p_bank_context_sha256
    AND attempt.expectation_sha256 = p_expectation_sha256
    AND attempt.provider = p_provider
    AND attempt.model = p_model
    AND attempt.prompt_version = p_prompt_version
  FOR UPDATE;

  IF attempt_row.status = 'completed' THEN
    RETURN jsonb_build_object(
      'attemptId', attempt_row.id,
      'state', 'completed',
      'verdict', attempt_row.verdict,
      'confidence', attempt_row.confidence,
      'reasonCodes', attempt_row.reason_codes,
      'piiFreeObservations', attempt_row.pii_free_observations,
      'completedAt', attempt_row.completed_at
    );
  END IF;
  IF attempt_row.lease_expires_at > lease_now THEN
    RETURN jsonb_build_object(
      'attemptId', attempt_row.id,
      'state', 'in_progress',
      'leaseExpiresAt', attempt_row.lease_expires_at
    );
  END IF;
  IF attempt_row.claim_count >= 10 THEN
    RAISE EXCEPTION 'mortgage_document_ai_attempt_retry_limit_reached'
      USING errcode = '55000';
  END IF;

  UPDATE public.crm_mortgage_document_ai_attempts attempt
  SET lease_token_sha256 = new_lease_token_sha256,
      lease_expires_at = lease_now + interval '2 minutes',
      claim_count = attempt.claim_count + 1,
      claimed_at = lease_now,
      claimed_by_user_id = p_actor_user_id,
      updated_at = lease_now
  WHERE attempt.id = attempt_row.id
  RETURNING * INTO attempt_row;
  RETURN jsonb_build_object(
    'attemptId', attempt_row.id,
    'state', 'claimed',
    'leaseToken', lease_token,
    'leaseExpiresAt', attempt_row.lease_expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.claim_crm_mortgage_document_ai_attempt(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text,
  timestamptz
) IS 'Claims the one provider execution allowed for exact mortgage PDF bytes and authoritative expectation; completed outcomes are replayed.';

REVOKE ALL ON FUNCTION public.claim_crm_mortgage_document_ai_attempt(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text,
  timestamptz
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.complete_crm_mortgage_document_ai_attempt(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_actor_user_id uuid,
  p_attempt_id uuid,
  p_lease_token text,
  p_verdict text,
  p_confidence numeric,
  p_reason_codes text[],
  p_pii_free_observations jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  membership_role text;
  case_owner_user_id uuid;
  item_owner_user_id uuid;
  attempt_row public.crm_mortgage_document_ai_attempts%rowtype;
  supplied_lease_token_sha256 text;
  completed_now timestamptz := clock_timestamp();
BEGIN
  IF p_lease_token IS NULL OR p_lease_token !~ '^[0-9a-f]{64}$'
    OR p_verdict NOT IN ('accepted', 'needs_review', 'rejected')
    OR p_confidence IS NULL OR p_confidence NOT BETWEEN 0 AND 1
    OR private.is_valid_crm_mortgage_ai_reason_codes(p_reason_codes)
      IS DISTINCT FROM true
    OR private.is_valid_crm_mortgage_ai_observations(p_pii_free_observations)
      IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'invalid_mortgage_document_ai_attempt_result'
      USING errcode = '22023';
  END IF;

  SELECT membership.role, crm_case.owner_user_id, item.owner_user_id
  INTO membership_role, case_owner_user_id, item_owner_user_id
  FROM public.crm_case_bank_applications application
  JOIN public.crm_cases crm_case
    ON crm_case.organization_id = application.organization_id
   AND crm_case.id = application.case_id
  JOIN public.crm_case_items item
    ON item.organization_id = application.organization_id
   AND item.case_id = application.case_id
   AND item.id = application.case_item_id
  JOIN public.crm_mortgage_application_processes process
    ON process.organization_id = application.organization_id
   AND process.case_id = application.case_id
   AND process.application_id = application.submission_id
  JOIN public.organization_memberships membership
    ON membership.organization_id = application.organization_id
   AND membership.user_id = p_actor_user_id
  WHERE application.organization_id = p_organization_id
    AND application.case_id = p_case_id
    AND application.submission_id = p_application_id
  FOR UPDATE OF application, crm_case, item, process;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_document_ai_attempt_scope_or_membership_not_found'
      USING errcode = '42501';
  END IF;
  IF membership_role <> 'admin'
    AND case_owner_user_id IS DISTINCT FROM p_actor_user_id
    AND item_owner_user_id IS DISTINCT FROM p_actor_user_id
  THEN
    RAISE EXCEPTION 'mortgage_case_manager_permission_required'
      USING errcode = '42501';
  END IF;

  SELECT attempt.* INTO attempt_row
  FROM public.crm_mortgage_document_ai_attempts attempt
  WHERE attempt.organization_id = p_organization_id
    AND attempt.case_id = p_case_id
    AND attempt.application_id = p_application_id
    AND attempt.id = p_attempt_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_document_ai_attempt_not_found'
      USING errcode = 'P0002';
  END IF;

  supplied_lease_token_sha256 := encode(
    extensions.digest(convert_to(p_lease_token, 'utf8'), 'sha256'), 'hex'
  );
  IF attempt_row.lease_token_sha256 IS DISTINCT FROM supplied_lease_token_sha256 THEN
    RAISE EXCEPTION 'mortgage_document_ai_attempt_lease_invalid'
      USING errcode = '42501';
  END IF;
  IF private.is_consistent_crm_mortgage_ai_accepted_verdict(
      attempt_row.expected_kind,
      p_verdict,
      p_reason_codes,
      p_confidence,
      p_pii_free_observations
    ) IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'invalid_mortgage_document_ai_attempt_result'
      USING errcode = '22023';
  END IF;

  IF attempt_row.status = 'completed' THEN
    IF attempt_row.verdict IS DISTINCT FROM p_verdict
      OR attempt_row.confidence IS DISTINCT FROM p_confidence
      OR attempt_row.reason_codes IS DISTINCT FROM p_reason_codes
      OR attempt_row.pii_free_observations IS DISTINCT FROM p_pii_free_observations
    THEN
      RAISE EXCEPTION 'mortgage_document_ai_attempt_already_completed'
        USING errcode = '23505';
    END IF;
    RETURN jsonb_build_object(
      'attemptId', attempt_row.id,
      'state', 'completed',
      'verdict', attempt_row.verdict,
      'confidence', attempt_row.confidence,
      'reasonCodes', attempt_row.reason_codes,
      'piiFreeObservations', attempt_row.pii_free_observations,
      'completedAt', attempt_row.completed_at
    );
  END IF;
  IF attempt_row.lease_expires_at <= completed_now THEN
    RAISE EXCEPTION 'mortgage_document_ai_attempt_lease_expired'
      USING errcode = '55000';
  END IF;

  UPDATE public.crm_mortgage_document_ai_attempts attempt
  SET status = 'completed',
      lease_expires_at = NULL,
      verdict = p_verdict,
      confidence = p_confidence,
      reason_codes = p_reason_codes,
      pii_free_observations = p_pii_free_observations,
      completed_at = completed_now,
      completed_by_user_id = p_actor_user_id,
      updated_at = completed_now
  WHERE attempt.id = attempt_row.id
  RETURNING * INTO attempt_row;

  RETURN jsonb_build_object(
    'attemptId', attempt_row.id,
    'state', 'completed',
    'verdict', attempt_row.verdict,
    'confidence', attempt_row.confidence,
    'reasonCodes', attempt_row.reason_codes,
    'piiFreeObservations', attempt_row.pii_free_observations,
    'completedAt', attempt_row.completed_at
  );
END;
$$;

COMMENT ON FUNCTION public.complete_crm_mortgage_document_ai_attempt(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text[], jsonb
) IS 'Completes an AI attempt exactly once. Repeating the same completion is idempotent; a different result can never replace it.';

REVOKE ALL ON FUNCTION public.complete_crm_mortgage_document_ai_attempt(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text[], jsonb
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TABLE public.crm_mortgage_document_ai_validations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  ai_attempt_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  document_id uuid NOT NULL,
  expected_kind text NOT NULL,
  source_sha256 text NOT NULL,
  applicant_context_sha256 text NOT NULL,
  bank_context_sha256 text NOT NULL,
  expectation_sha256 text NOT NULL,
  validated_bank_id uuid NOT NULL,
  validated_offer_id uuid NOT NULL,
  validated_decision_outcome text,
  validated_valid_until timestamptz,
  validated_loan_amount numeric(14,2),
  validated_currency text,
  verdict text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  confidence numeric(5,4) NOT NULL,
  reason_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  pii_free_observations jsonb DEFAULT '{}'::jsonb NOT NULL,
  validated_at timestamptz NOT NULL,
  validated_by_user_id uuid NOT NULL,
  expert_override_reason text,
  expert_overridden_at timestamptz,
  expert_overridden_by_user_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_document_ai_validations_scope_id_key
    UNIQUE (organization_id, case_id, application_id, id),
  CONSTRAINT crm_mortgage_document_ai_validations_artifact_pin_key
    UNIQUE (
      organization_id, case_id, application_id, document_id,
      expected_kind, source_sha256, id
    ),
  CONSTRAINT crm_mortgage_document_ai_validations_kind_check CHECK (
    expected_kind IN ('esis', 'credit_decision')
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_hash_check CHECK (
    source_sha256 ~ '^[0-9a-f]{64}$'
    AND applicant_context_sha256 ~ '^[0-9a-f]{64}$'
    AND bank_context_sha256 ~ '^[0-9a-f]{64}$'
    AND expectation_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_verdict_check CHECK (
    verdict IN ('accepted', 'needs_review', 'rejected')
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_context_facts_check CHECK (
    (
      expected_kind = 'esis'
      AND validated_decision_outcome IS NULL
      AND pii_free_observations -> 'checks' ->> 'decisionOutcome' = 'not_applicable'
      AND (
        (
          validated_loan_amount IS NULL
          AND validated_currency IS NULL
        ) OR (
          validated_loan_amount > 0
          AND validated_currency ~ '^[A-Z]{3}$'
        )
      )
    )
    OR (
      expected_kind = 'credit_decision'
      AND validated_decision_outcome IN ('positive', 'negative')
      AND validated_loan_amount IS NULL
      AND validated_currency IS NULL
      AND pii_free_observations -> 'checks' ->> 'loanAmount' = 'not_applicable'
    )
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_optional_context_check CHECK (
    (
      (
        validated_valid_until IS NULL
        AND pii_free_observations -> 'checks' ->> 'validUntil' = 'not_applicable'
      ) OR (
        validated_valid_until IS NOT NULL
        AND pii_free_observations -> 'checks' ->> 'validUntil' <> 'not_applicable'
      )
    )
    AND (
      expected_kind <> 'esis'
      OR (
        validated_loan_amount IS NULL
        AND pii_free_observations -> 'checks' ->> 'loanAmount' = 'not_applicable'
      ) OR (
        validated_loan_amount IS NOT NULL
        AND pii_free_observations -> 'checks' ->> 'loanAmount' <> 'not_applicable'
      )
    )
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_model_identity_check CHECK (
    provider = 'vercel-ai-gateway'
    AND model = 'gemini-3.5-flash-lite'
    AND prompt_version = 'mortgage-document-validation-v1'
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_confidence_check CHECK (
    confidence BETWEEN 0 AND 1
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_reason_codes_check CHECK (
    private.is_valid_crm_mortgage_ai_reason_codes(reason_codes)
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_observations_check CHECK (
    private.is_valid_crm_mortgage_ai_observations(pii_free_observations)
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_accepted_consistency_check CHECK (
    private.is_consistent_crm_mortgage_ai_accepted_verdict(
      expected_kind, verdict, reason_codes, confidence, pii_free_observations
    )
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_time_check CHECK (
    isfinite(validated_at)
    AND isfinite(created_at)
    AND (validated_valid_until IS NULL OR isfinite(validated_valid_until))
    AND (expert_overridden_at IS NULL OR isfinite(expert_overridden_at))
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_expert_override_check CHECK (
    (
      verdict = 'needs_review'
      AND (
        (
          expert_override_reason IS NULL
          AND expert_overridden_at IS NULL
          AND expert_overridden_by_user_id IS NULL
        ) OR (
          char_length(btrim(expert_override_reason)) BETWEEN 20 AND 1000
          AND expert_overridden_at IS NOT NULL
          AND expert_overridden_by_user_id IS NOT NULL
          AND expert_overridden_at >= validated_at
        )
      )
    ) OR (
      verdict <> 'needs_review'
      AND expert_override_reason IS NULL
      AND expert_overridden_at IS NULL
      AND expert_overridden_by_user_id IS NULL
    )
  ),
  CONSTRAINT crm_mortgage_document_ai_validations_application_fk
    FOREIGN KEY (organization_id, case_id, application_id)
    REFERENCES public.crm_case_bank_applications
      (organization_id, case_id, submission_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_document_ai_validations_attempt_fk
    FOREIGN KEY (organization_id, case_id, application_id, ai_attempt_id)
    REFERENCES public.crm_mortgage_document_ai_attempts
      (organization_id, case_id, application_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_document_ai_validations_document_fk
    FOREIGN KEY (
      organization_id, case_id, application_id, document_id, source_sha256
    ) REFERENCES public.crm_documents
      (organization_id, case_id, submission_id, id, sha256)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_document_ai_validations_actor_fk
    FOREIGN KEY (organization_id, validated_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_document_ai_validations_bank_fk
    FOREIGN KEY (validated_bank_id)
    REFERENCES public.mortgage_banks (id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_document_ai_validations_offer_fk
    FOREIGN KEY (organization_id, case_id, validated_offer_id)
    REFERENCES public.crm_case_offer_snapshots (organization_id, case_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_document_ai_validations_override_actor_fk
    FOREIGN KEY (organization_id, expert_overridden_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.crm_mortgage_document_ai_validations IS
  'Append-only authoritative AI classification of exact mortgage-document bytes; raw model output and applicant PII are forbidden.';
COMMENT ON COLUMN public.crm_mortgage_document_ai_validations.pii_free_observations IS
  'Bounded structured observations after PII redaction. Never store OCR text, prompts, raw provider responses, names, addresses or identifiers.';
COMMENT ON COLUMN public.crm_mortgage_document_ai_validations.applicant_context_sha256 IS
  'Opaque DB-generated revision hash of the applicant rows whose exact ordered display names were returned by get_crm_mortgage_document_validation_context and sent to AI; no name-derived digest is stored.';

CREATE INDEX crm_mortgage_document_ai_validations_latest_idx
  ON public.crm_mortgage_document_ai_validations (
    organization_id, case_id, application_id, document_id,
    expected_kind, source_sha256, validated_at DESC, created_at DESC, id DESC
  );

CREATE FUNCTION private.guard_crm_mortgage_document_ai_validation_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  source_document_type text;
  process_stage text;
  authoritative_applicant_context jsonb;
  authoritative_validation_context jsonb;
  attempt_row public.crm_mortgage_document_ai_attempts%rowtype;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'mortgage_document_ai_validations_are_append_only'
      USING errcode = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    -- The sole deletion path is FK cascade from cleanup of an unpinned source
    -- document/application. Once an artifact pins the validation, its RESTRICT
    -- FK (and the document RESTRICT FK) preserves the legal ledger.
    IF pg_trigger_depth() > 1
      AND NOT EXISTS (
        SELECT 1
        FROM public.crm_mortgage_application_artifacts artifact
        WHERE artifact.ai_validation_id = OLD.id
      )
    THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'mortgage_document_ai_validations_are_append_only'
      USING errcode = '42501';
  END IF;

  SELECT attempt.* INTO attempt_row
  FROM public.crm_mortgage_document_ai_attempts attempt
  WHERE attempt.organization_id = NEW.organization_id
    AND attempt.case_id = NEW.case_id
    AND attempt.application_id = NEW.application_id
    AND attempt.id = NEW.ai_attempt_id
    AND attempt.status = 'completed';
  IF NOT FOUND
    OR attempt_row.expected_kind IS DISTINCT FROM NEW.expected_kind
    OR attempt_row.source_sha256 IS DISTINCT FROM NEW.source_sha256
    OR attempt_row.applicant_context_sha256 IS DISTINCT FROM
      NEW.applicant_context_sha256
    OR attempt_row.bank_context_sha256 IS DISTINCT FROM NEW.bank_context_sha256
    OR attempt_row.expectation_sha256 IS DISTINCT FROM NEW.expectation_sha256
    OR attempt_row.provider IS DISTINCT FROM NEW.provider
    OR attempt_row.model IS DISTINCT FROM NEW.model
    OR attempt_row.prompt_version IS DISTINCT FROM NEW.prompt_version
    OR attempt_row.verdict IS DISTINCT FROM NEW.verdict
    OR attempt_row.confidence IS DISTINCT FROM NEW.confidence
    OR attempt_row.reason_codes IS DISTINCT FROM NEW.reason_codes
    OR attempt_row.pii_free_observations IS DISTINCT FROM NEW.pii_free_observations
  THEN
    RAISE EXCEPTION 'completed_mortgage_document_ai_attempt_required'
      USING errcode = '23514';
  END IF;

  -- Audit ordering is server-owned. The service role intentionally has no
  -- INSERT privilege on id/created_at, and this assignment also protects
  -- owner-invoked fixtures/jobs from supplying a forged ledger timestamp.
  NEW.created_at := clock_timestamp();
  NEW.validated_at := attempt_row.completed_at;
  NEW.validated_by_user_id := attempt_row.completed_by_user_id;
  IF NEW.expert_override_reason IS NOT NULL
    OR NEW.expert_overridden_by_user_id IS NOT NULL
  THEN
    NEW.expert_overridden_at := clock_timestamp();
  ELSE
    NEW.expert_overridden_at := NULL;
  END IF;

  -- Match the command RPC lock order (application -> advisory key). Taking
  -- advisory first would deadlock with attach, which already owns FOR UPDATE
  -- on this application before checking the authoritative latest validation.
  PERFORM 1
  FROM public.crm_case_bank_applications application
  WHERE application.organization_id = NEW.organization_id
    AND application.case_id = NEW.case_id
    AND application.submission_id = NEW.application_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_document_ai_validation_application_not_found'
      USING errcode = '23514';
  END IF;

  SELECT process.stage
  INTO process_stage
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = NEW.organization_id
    AND process.case_id = NEW.case_id
    AND process.application_id = NEW.application_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_document_ai_validation_process_not_found'
      USING errcode = '23514';
  END IF;

  authoritative_applicant_context := private.crm_mortgage_applicant_context(
    NEW.organization_id,
    NEW.case_id,
    NEW.application_id,
    process_stage <> 'pre_application'
  );
  IF NEW.applicant_context_sha256 IS DISTINCT FROM
      authoritative_applicant_context ->> 'applicantContextSha256'
    OR private.is_valid_crm_mortgage_ai_observations(
      NEW.pii_free_observations
    ) IS DISTINCT FROM true
    OR (NEW.pii_free_observations ->> 'expectedApplicantCount')::integer
      <> jsonb_array_length(authoritative_applicant_context -> 'applicants')
  THEN
    RAISE EXCEPTION 'mortgage_document_ai_validation_applicant_context_mismatch'
      USING errcode = '23514';
  END IF;

  authoritative_validation_context := private.crm_mortgage_document_validation_context(
    NEW.organization_id,
    NEW.case_id,
    NEW.application_id,
    process_stage <> 'pre_application',
    NEW.expected_kind,
    NEW.validated_decision_outcome,
    NEW.validated_valid_until
  );
  IF NEW.expectation_sha256 IS DISTINCT FROM
      authoritative_validation_context ->> 'expectationSha256'
    OR NEW.bank_context_sha256 IS DISTINCT FROM
      authoritative_validation_context ->> 'bankContextSha256'
    OR NEW.validated_bank_id::text IS DISTINCT FROM
      authoritative_validation_context ->> 'bankId'
    OR NEW.validated_offer_id::text IS DISTINCT FROM
      authoritative_validation_context ->> 'offerId'
    OR NEW.validated_loan_amount IS DISTINCT FROM
      nullif(authoritative_validation_context ->> 'loanAmount', '')::numeric
    OR NEW.validated_currency IS DISTINCT FROM
      authoritative_validation_context ->> 'currency'
  THEN
    RAISE EXCEPTION 'mortgage_document_ai_validation_expectation_mismatch'
      USING errcode = '23514';
  END IF;

  IF NEW.expert_overridden_by_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships membership
    JOIN public.crm_cases crm_case
      ON crm_case.organization_id = membership.organization_id
     AND crm_case.id = NEW.case_id
    JOIN public.crm_case_bank_applications application
      ON application.organization_id = crm_case.organization_id
     AND application.case_id = crm_case.id
     AND application.submission_id = NEW.application_id
    JOIN public.crm_case_items item
      ON item.organization_id = application.organization_id
     AND item.case_id = application.case_id
     AND item.id = application.case_item_id
    WHERE membership.organization_id = NEW.organization_id
      AND membership.user_id = NEW.expert_overridden_by_user_id
      AND (
        membership.role = 'admin'
        OR crm_case.owner_user_id = membership.user_id
        OR item.owner_user_id = membership.user_id
      )
  ) THEN
    RAISE EXCEPTION 'mortgage_document_ai_validation_override_permission_required'
      USING errcode = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      NEW.application_id::text || ':' || NEW.document_id::text || ':' || NEW.expected_kind,
      0
    )
  );
  IF EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_artifacts artifact
    WHERE artifact.organization_id = NEW.organization_id
      AND artifact.case_id = NEW.case_id
      AND artifact.application_id = NEW.application_id
      AND artifact.document_id = NEW.document_id
      AND artifact.kind = NEW.expected_kind
  ) THEN
    RAISE EXCEPTION 'mortgage_document_ai_validation_already_pinned'
      USING errcode = '23514';
  END IF;

  -- The provider attempt deliberately completes before storage upload. Exact
  -- byte identity is therefore proved by source_sha256, not by requiring the
  -- result timestamp to follow crm_documents.created_at.
  SELECT document.document_type
  INTO source_document_type
  FROM public.crm_documents document
  WHERE document.organization_id = NEW.organization_id
    AND document.case_id = NEW.case_id
    AND document.submission_id = NEW.application_id
    AND document.id = NEW.document_id
    AND document.sha256 = NEW.source_sha256;
  IF NOT FOUND
    OR source_document_type <> (CASE NEW.expected_kind
      WHEN 'esis' THEN 'mortgage_esis'
      WHEN 'credit_decision' THEN 'mortgage_credit_decision'
    END)
    OR NEW.validated_at > statement_timestamp() + interval '5 minutes'
  THEN
    RAISE EXCEPTION 'invalid_mortgage_document_ai_validation_time_or_source'
      USING errcode = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.crm_mortgage_document_ai_validations existing_validation
    WHERE existing_validation.organization_id = NEW.organization_id
      AND existing_validation.case_id = NEW.case_id
      AND existing_validation.application_id = NEW.application_id
      AND existing_validation.document_id = NEW.document_id
      AND existing_validation.expected_kind = NEW.expected_kind
      AND existing_validation.source_sha256 = NEW.source_sha256
      AND existing_validation.validated_at > NEW.validated_at
  ) THEN
    RAISE EXCEPTION 'mortgage_document_ai_validation_time_must_be_monotonic'
      USING errcode = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_crm_mortgage_document_ai_validation_write()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_mortgage_document_ai_validations_guard_write
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.crm_mortgage_document_ai_validations
  FOR EACH ROW EXECUTE FUNCTION private.guard_crm_mortgage_document_ai_validation_write();

CREATE TABLE public.crm_mortgage_application_artifacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  kind text NOT NULL,
  version integer NOT NULL,
  document_id uuid NOT NULL,
  document_name text NOT NULL,
  document_sha256 text NOT NULL,
  document_mime_type text NOT NULL,
  document_size_bytes bigint NOT NULL,
  document_storage_bucket text NOT NULL,
  document_storage_path text NOT NULL,
  issued_at timestamptz,
  received_at timestamptz NOT NULL,
  valid_from timestamptz,
  valid_until timestamptz,
  decision_outcome text,
  ai_validation_id uuid,
  related_esis_artifact_id uuid,
  related_decision_artifact_id uuid,
  supersedes_artifact_id uuid,
  created_by_user_id uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_application_artifacts_scope_id_key
    UNIQUE (organization_id, case_id, application_id, id),
  CONSTRAINT crm_mortgage_application_artifacts_document_key
    UNIQUE (document_id),
  CONSTRAINT crm_mortgage_application_artifacts_version_key
    UNIQUE (application_id, kind, version),
  CONSTRAINT crm_mortgage_application_artifacts_kind_check CHECK (
    kind IN ('esis', 'credit_decision', 'draft_credit_agreement')
  ),
  CONSTRAINT crm_mortgage_application_artifacts_version_check CHECK (version >= 1),
  CONSTRAINT crm_mortgage_application_artifacts_hash_check CHECK (
    document_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT crm_mortgage_application_artifacts_file_check CHECK (
    document_mime_type = 'application/pdf'
    AND document_size_bytes BETWEEN 1 AND 26214400
    AND nullif(btrim(document_name), '') IS NOT NULL
    AND nullif(btrim(document_storage_bucket), '') IS NOT NULL
    AND nullif(btrim(document_storage_path), '') IS NOT NULL
  ),
  CONSTRAINT crm_mortgage_application_artifacts_validity_check CHECK (
    (valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from)
    AND (issued_at IS NULL OR received_at >= issued_at - interval '1 day')
  ),
  CONSTRAINT crm_mortgage_application_artifacts_decision_check CHECK (
    (kind = 'credit_decision' AND decision_outcome IN ('positive', 'negative'))
    OR (kind <> 'credit_decision' AND decision_outcome IS NULL)
  ),
  CONSTRAINT crm_mortgage_application_artifacts_ai_validation_shape_check CHECK (
    (kind IN ('esis', 'credit_decision') AND ai_validation_id IS NOT NULL)
    OR (kind = 'draft_credit_agreement' AND ai_validation_id IS NULL)
  ),
  CONSTRAINT crm_mortgage_application_artifacts_relation_shape_check CHECK (
    (kind = 'esis'
      AND related_esis_artifact_id IS NULL
      AND related_decision_artifact_id IS NULL)
    OR (kind = 'credit_decision'
      AND related_esis_artifact_id IS NOT NULL
      AND related_decision_artifact_id IS NULL)
    OR (kind = 'draft_credit_agreement'
      AND related_esis_artifact_id IS NULL
      AND related_decision_artifact_id IS NOT NULL)
  ),
  CONSTRAINT crm_mortgage_application_artifacts_positive_validity_check CHECK (
    kind <> 'credit_decision' OR decision_outcome <> 'positive' OR valid_until IS NOT NULL
  ),
  CONSTRAINT crm_mortgage_application_artifacts_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 16384
  ),
  CONSTRAINT crm_mortgage_application_artifacts_application_fk
    FOREIGN KEY (organization_id, case_id, application_id)
    REFERENCES public.crm_case_bank_applications (organization_id, case_id, submission_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_application_artifacts_document_fk
    FOREIGN KEY (document_id) REFERENCES public.crm_documents (id) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_application_artifacts_ai_validation_fk
    FOREIGN KEY (
      organization_id, case_id, application_id, document_id,
      kind, document_sha256, ai_validation_id
    ) REFERENCES public.crm_mortgage_document_ai_validations (
      organization_id, case_id, application_id, document_id,
      expected_kind, source_sha256, id
    ) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_application_artifacts_supersedes_fk
    FOREIGN KEY (supersedes_artifact_id)
    REFERENCES public.crm_mortgage_application_artifacts (id) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_application_artifacts_related_esis_fk
    FOREIGN KEY (organization_id, case_id, application_id, related_esis_artifact_id)
    REFERENCES public.crm_mortgage_application_artifacts
      (organization_id, case_id, application_id, id) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_application_artifacts_related_decision_fk
    FOREIGN KEY (organization_id, case_id, application_id, related_decision_artifact_id)
    REFERENCES public.crm_mortgage_application_artifacts
      (organization_id, case_id, application_id, id) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_application_artifacts_actor_fk
    FOREIGN KEY (organization_id, created_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.crm_mortgage_application_artifacts IS
  'Append-only legal artifact versions pinning the original crm_documents file identity and hash.';

CREATE INDEX crm_mortgage_application_artifacts_latest_idx
  ON public.crm_mortgage_application_artifacts
  (organization_id, application_id, kind, version DESC);

CREATE TABLE public.crm_mortgage_artifact_deliveries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  recipient_client_id uuid NOT NULL,
  delivered_at timestamptz NOT NULL,
  channel text NOT NULL,
  evidence_reference text,
  recorded_by_user_id uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_artifact_deliveries_channel_check CHECK (
    channel IN (
      'client_portal_download', 'email_attachment', 'registered_mail',
      'physical_copy', 'other_durable_medium'
    )
  ),
  CONSTRAINT crm_mortgage_artifact_deliveries_evidence_check CHECK (
    evidence_reference IS NULL OR (
      nullif(btrim(evidence_reference), '') IS NOT NULL
      AND char_length(evidence_reference) <= 500
    )
  ),
  CONSTRAINT crm_mortgage_artifact_deliveries_evidence_required_check CHECK (
    channel = 'client_portal_download' OR evidence_reference IS NOT NULL
  ),
  CONSTRAINT crm_mortgage_artifact_deliveries_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 8192
  ),
  CONSTRAINT crm_mortgage_artifact_deliveries_artifact_fk
    FOREIGN KEY (organization_id, case_id, application_id, artifact_id)
    REFERENCES public.crm_mortgage_application_artifacts
      (organization_id, case_id, application_id, id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_artifact_deliveries_recipient_fk
    FOREIGN KEY (organization_id, recipient_client_id)
    REFERENCES public.crm_clients (organization_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_artifact_deliveries_actor_fk
    FOREIGN KEY (organization_id, recorded_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE RESTRICT
);

COMMENT ON TABLE public.crm_mortgage_artifact_deliveries IS
  'Append-only evidence that one artifact version was delivered to one recipient on a durable medium.';

CREATE INDEX crm_mortgage_artifact_deliveries_artifact_recipient_idx
  ON public.crm_mortgage_artifact_deliveries
  (organization_id, artifact_id, recipient_client_id, delivered_at DESC);

CREATE TABLE public.crm_mortgage_early_decision_consents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  client_id uuid NOT NULL,
  decision text NOT NULL,
  captured_at timestamptz NOT NULL,
  channel text NOT NULL,
  evidence_reference text,
  document_id uuid,
  recorded_by_user_id uuid NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_early_decision_consents_decision_check CHECK (
    decision IN ('granted', 'refused', 'withdrawn')
  ),
  CONSTRAINT crm_mortgage_early_decision_consents_channel_check CHECK (
    channel IN ('signed_document', 'client_portal', 'email_reply', 'recorded_conversation', 'other')
  ),
  CONSTRAINT crm_mortgage_early_decision_consents_evidence_check CHECK (
    evidence_reference IS NULL OR (
      nullif(btrim(evidence_reference), '') IS NOT NULL
      AND char_length(evidence_reference) <= 500
    )
  ),
  CONSTRAINT crm_mortgage_early_decision_consents_evidence_shape_check CHECK (
    evidence_reference IS NOT NULL OR document_id IS NOT NULL
  ),
  CONSTRAINT crm_mortgage_early_decision_consents_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 8192
  ),
  CONSTRAINT crm_mortgage_early_decision_consents_application_fk
    FOREIGN KEY (organization_id, case_id, application_id)
    REFERENCES public.crm_case_bank_applications (organization_id, case_id, submission_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_early_decision_consents_client_fk
    FOREIGN KEY (application_id, client_id)
    REFERENCES public.crm_mortgage_application_parties (application_id, client_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_early_decision_consents_document_fk
    FOREIGN KEY (document_id) REFERENCES public.crm_documents (id) ON DELETE RESTRICT,
  CONSTRAINT crm_mortgage_early_decision_consents_actor_fk
    FOREIGN KEY (organization_id, recorded_by_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE RESTRICT
);

CREATE INDEX crm_mortgage_early_decision_consents_effective_idx
  ON public.crm_mortgage_early_decision_consents
  (organization_id, application_id, client_id, captured_at DESC, created_at DESC);

CREATE TABLE public.crm_mortgage_application_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  aggregate_revision bigint NOT NULL,
  command_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_user_id uuid,
  occurred_at timestamptz NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT crm_mortgage_application_events_revision_key
    UNIQUE (application_id, aggregate_revision),
  CONSTRAINT crm_mortgage_application_events_command_key
    UNIQUE (application_id, command_id),
  CONSTRAINT crm_mortgage_application_events_revision_check CHECK (aggregate_revision >= 0),
  CONSTRAINT crm_mortgage_application_events_type_check CHECK (
    event_type IN (
      'process_initialized', 'artifact_attached', 'artifact_delivered',
      'application_submitted', 'application_acknowledged',
      'completeness_confirmed', 'additional_information_requested',
      'review_resumed', 'early_decision_consent_recorded',
      'application_ready_for_contract', 'application_completed',
      'contract_signed', 'application_closed', 'legacy_status_synchronized'
    )
  ),
  CONSTRAINT crm_mortgage_application_events_payload_check CHECK (
    jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 262144
  ),
  CONSTRAINT crm_mortgage_application_events_application_fk
    FOREIGN KEY (organization_id, case_id, application_id)
    REFERENCES public.crm_case_bank_applications (organization_id, case_id, submission_id)
    ON DELETE CASCADE,
  CONSTRAINT crm_mortgage_application_events_actor_fk
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships (organization_id, user_id)
    ON DELETE SET NULL (actor_user_id)
);

COMMENT ON TABLE public.crm_mortgage_application_events IS
  'Append-only idempotent aggregate ledger; one event and revision per accepted command.';

CREATE INDEX crm_mortgage_application_events_timeline_idx
  ON public.crm_mortgage_application_events
  (organization_id, case_id, occurred_at DESC, id DESC);

CREATE FUNCTION private.guard_crm_mortgage_application_event_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- The only removable ledger row is the synthetic revision-zero initializer
  -- cascaded while an untouched draft aggregate is itself deleted. All direct
  -- mutations, and every business event, remain immutable even to owner jobs.
  IF TG_OP = 'DELETE'
    AND pg_trigger_depth() > 1
    AND OLD.aggregate_revision = 0
    AND OLD.event_type = 'process_initialized'
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'mortgage_application_events_are_append_only'
    USING errcode = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.guard_crm_mortgage_application_event_write()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_mortgage_application_events_guard_append_only
  BEFORE UPDATE OR DELETE ON public.crm_mortgage_application_events
  FOR EACH ROW EXECUTE FUNCTION private.guard_crm_mortgage_application_event_write();

-- Transaction-scoped capability used by DB triggers. Direct Data API writes
-- cannot manufacture a row in this private table, so lifecycle projections
-- may only be changed by the audited command/signing functions below.
CREATE TABLE private.crm_mortgage_application_command_guards (
  application_id uuid NOT NULL,
  transaction_id bigint NOT NULL,
  PRIMARY KEY (application_id, transaction_id)
);

REVOKE ALL ON TABLE private.crm_mortgage_application_command_guards
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.guard_crm_mortgage_submission_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF NEW.status_code IS NOT DISTINCT FROM OLD.status_code
    AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
    AND NEW.decision_at IS NOT DISTINCT FROM OLD.decision_at
  THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM public.crm_case_bank_applications application
  WHERE application.organization_id = OLD.organization_id
    AND application.case_item_id = OLD.case_item_id
    AND application.submission_id = OLD.id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  PERFORM 1
  FROM private.crm_mortgage_application_command_guards guard
  WHERE guard.application_id = OLD.id
    AND guard.transaction_id = txid_current();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_submission_lifecycle_requires_audited_command'
      USING errcode = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_crm_mortgage_submission_lifecycle()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Compatibility phase: the trigger is installed by 0051, after application
-- servers have switched from legacy PATCHes to audited mortgage commands.

CREATE FUNCTION private.sync_crm_mortgage_process_from_legacy_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  target_case_id uuid;
  target_stage text;
  actor_user_id uuid := (SELECT app.current_user_id());
  case_owner_user_id uuid;
  item_owner_user_id uuid;
  membership_role text;
  process_row public.crm_mortgage_application_processes%rowtype;
BEGIN
  -- Audited commands already project the aggregate and legacy row atomically.
  -- Only legacy PATCHes that lack the transaction capability are reconciled.
  IF EXISTS (
    SELECT 1
    FROM private.crm_mortgage_application_command_guards guard
    WHERE guard.application_id = NEW.id
      AND guard.transaction_id = txid_current()
  ) THEN
    RETURN NEW;
  END IF;

  SELECT application.case_id, crm_case.owner_user_id, item.owner_user_id,
         membership.role
  INTO target_case_id, case_owner_user_id, item_owner_user_id, membership_role
  FROM public.crm_case_bank_applications application
  JOIN public.crm_cases crm_case
    ON crm_case.organization_id = application.organization_id
   AND crm_case.id = application.case_id
  JOIN public.crm_case_items item
    ON item.organization_id = application.organization_id
   AND item.case_id = application.case_id
   AND item.id = application.case_item_id
  JOIN public.organization_memberships membership
    ON membership.organization_id = application.organization_id
   AND membership.user_id = actor_user_id
  WHERE application.organization_id = NEW.organization_id
    AND application.case_item_id = NEW.case_item_id
    AND application.submission_id = NEW.id
  FOR UPDATE OF application, crm_case, item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_legacy_patch_requires_organization_member'
      USING errcode = '42501';
  END IF;
  IF membership_role <> 'admin'
    AND case_owner_user_id IS DISTINCT FROM actor_user_id
    AND item_owner_user_id IS DISTINCT FROM actor_user_id
  THEN
    RAISE EXCEPTION 'mortgage_legacy_patch_requires_case_manager'
      USING errcode = '42501';
  END IF;

  SELECT process.* INTO process_row
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = NEW.organization_id
    AND process.case_id = target_case_id
    AND process.application_id = NEW.id
  FOR UPDATE;
  IF NOT FOUND OR process_row.stage IN ('completed', 'closed') THEN
    RETURN NEW;
  END IF;

  target_stage := CASE NEW.status_code
    WHEN 'draft' THEN 'pre_application'
    WHEN 'wyslane' THEN 'submitted'
    WHEN 'w_analizie' THEN CASE
      WHEN process_row.completeness_confirmed_at IS NULL
        THEN 'awaiting_completeness'
      ELSE 'under_review'
    END
    WHEN 'braki' THEN 'additional_information_requested'
    -- A legacy accepted status proves neither current delivery evidence nor a
    -- complete agreement package. Keep it non-signable until audited commands
    -- advance the process to ready_for_contract.
    WHEN 'zaakceptowane' THEN 'decision_received'
    WHEN 'odrzucone' THEN 'decision_received'
    WHEN 'wycofane' THEN 'closed'
    ELSE process_row.stage
  END;

  IF OLD.status_code = 'draft' AND NEW.status_code <> 'draft' THEN
    IF EXISTS (
      SELECT 1
      FROM public.crm_mortgage_application_artifacts artifact
      WHERE artifact.organization_id = NEW.organization_id
        AND artifact.case_id = target_case_id
        AND artifact.application_id = NEW.id
      UNION ALL
      SELECT 1
      FROM public.crm_mortgage_early_decision_consents consent
      WHERE consent.organization_id = NEW.organization_id
        AND consent.case_id = target_case_id
        AND consent.application_id = NEW.id
    ) THEN
      IF EXISTS (
        SELECT party.client_id
        FROM public.crm_mortgage_application_parties party
        WHERE party.organization_id = NEW.organization_id
          AND party.case_id = target_case_id
          AND party.application_id = NEW.id
        EXCEPT
        SELECT link.client_id
        FROM public.crm_case_clients link
        WHERE link.organization_id = NEW.organization_id
          AND link.case_id = target_case_id
      ) OR EXISTS (
        SELECT link.client_id
        FROM public.crm_case_clients link
        WHERE link.organization_id = NEW.organization_id
          AND link.case_id = target_case_id
        EXCEPT
        SELECT party.client_id
        FROM public.crm_mortgage_application_parties party
        WHERE party.organization_id = NEW.organization_id
          AND party.case_id = target_case_id
          AND party.application_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'mortgage_application_applicant_set_changed_after_evidence'
          USING errcode = '23514';
      END IF;
    ELSE
      DELETE FROM public.crm_mortgage_application_parties party
      WHERE party.organization_id = NEW.organization_id
        AND party.case_id = target_case_id
        AND party.application_id = NEW.id;
    END IF;

    INSERT INTO public.crm_mortgage_application_parties (
      organization_id, case_id, application_id, client_id,
      role, frozen_at, frozen_by_user_id
    )
    SELECT
      link.organization_id, link.case_id, NEW.id, link.client_id,
      CASE WHEN link.is_primary THEN 'primary_applicant' ELSE 'co_applicant' END,
      coalesce(NEW.submitted_at, statement_timestamp()), actor_user_id
    FROM public.crm_case_clients link
    WHERE link.organization_id = NEW.organization_id
      AND link.case_id = target_case_id
    ORDER BY link.client_id
    ON CONFLICT (application_id, client_id) DO NOTHING;

    IF (
      SELECT count(*)
      FROM public.crm_mortgage_application_parties party
      WHERE party.organization_id = NEW.organization_id
        AND party.case_id = target_case_id
        AND party.application_id = NEW.id
    ) NOT BETWEEN 1 AND 20 THEN
      RAISE EXCEPTION 'mortgage_application_requires_between_one_and_twenty_applicants'
        USING errcode = '23514';
    END IF;
  END IF;

  UPDATE public.crm_mortgage_application_processes process
  SET stage = target_stage,
      revision = process.revision + 1,
      application_submitted_at = CASE
        WHEN NEW.status_code IN (
          'wyslane', 'w_analizie', 'braki', 'zaakceptowane', 'odrzucone', 'wycofane'
        ) THEN coalesce(process.application_submitted_at, NEW.submitted_at, statement_timestamp())
        ELSE process.application_submitted_at
      END,
      additional_information_requested_at = CASE
        WHEN NEW.status_code = 'braki'
          THEN coalesce(process.additional_information_requested_at, statement_timestamp())
        ELSE process.additional_information_requested_at
      END,
      decision_received_at = CASE
        WHEN NEW.status_code IN ('zaakceptowane', 'odrzucone')
          THEN coalesce(process.decision_received_at, NEW.decision_at, statement_timestamp())
        ELSE process.decision_received_at
      END,
      decision_outcome = CASE
        WHEN NEW.status_code = 'zaakceptowane' THEN 'positive'
        WHEN NEW.status_code = 'odrzucone' THEN 'negative'
        ELSE process.decision_outcome
      END,
      closed_at = CASE
        WHEN target_stage = 'closed'
          THEN coalesce(process.closed_at, statement_timestamp())
        ELSE NULL
      END,
      updated_by_user_id = coalesce(actor_user_id, process.updated_by_user_id)
  WHERE process.application_id = process_row.application_id
  RETURNING process.* INTO process_row;

  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload
  ) VALUES (
    process_row.organization_id, process_row.case_id, process_row.application_id,
    process_row.revision, gen_random_uuid(), 'legacy_status_synchronized',
    actor_user_id, statement_timestamp(),
    jsonb_build_object(
      'legacyStatusFrom', OLD.status_code,
      'legacyStatusTo', NEW.status_code,
      'compatibilityPhase', '0049',
      'result', jsonb_build_object(
        'applicationId', process_row.application_id,
        'stage', process_row.stage,
        'revision', process_row.revision
      )
    )
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_crm_mortgage_process_from_legacy_submission()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_item_submissions_sync_mortgage_legacy_status
  AFTER UPDATE OF status_code, submitted_at, decision_at
  ON public.crm_item_submissions
  FOR EACH ROW
  WHEN (
    OLD.status_code IS DISTINCT FROM NEW.status_code
    OR OLD.submitted_at IS DISTINCT FROM NEW.submitted_at
    OR OLD.decision_at IS DISTINCT FROM NEW.decision_at
  )
  EXECUTE FUNCTION private.sync_crm_mortgage_process_from_legacy_submission();

CREATE FUNCTION private.initialize_crm_mortgage_application_process()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.crm_mortgage_application_processes (
    application_id, organization_id, case_id, stage, revision,
    created_by_user_id, updated_by_user_id
  ) VALUES (
    NEW.submission_id, NEW.organization_id, NEW.case_id, 'pre_application', 0,
    NEW.created_by_user_id, NEW.created_by_user_id
  ) ON CONFLICT (application_id) DO NOTHING;

  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload
  ) VALUES (
    NEW.organization_id, NEW.case_id, NEW.submission_id, 0,
    gen_random_uuid(), 'process_initialized', NEW.created_by_user_id,
    NEW.created_at, jsonb_build_object('backfilled', false)
  ) ON CONFLICT (application_id, aggregate_revision) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.initialize_crm_mortgage_application_process()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_bank_applications_initialize_mortgage_process
  AFTER INSERT ON public.crm_case_bank_applications
  FOR EACH ROW EXECUTE FUNCTION private.initialize_crm_mortgage_application_process();

-- An untouched draft remains deletable through the existing trusted-server
-- endpoint, but once either old or new code has produced auditable evidence it
-- may no longer cascade-delete the process/AI ledger during the rollout.
CREATE OR REPLACE FUNCTION private.guard_crm_bank_application_submission_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $$
DECLARE
  process_row public.crm_mortgage_application_processes%rowtype;
  mortgage_case_id uuid;
BEGIN
  IF current_user NOT IN ('openexpert_service', 'openexpert_owner', 'postgres') THEN
    RAISE EXCEPTION 'mortgage_application_delete_requires_internal_role'
      USING errcode = '42501';
  END IF;

  SELECT application.case_id INTO mortgage_case_id
  FROM public.crm_case_bank_applications application
  WHERE application.organization_id = OLD.organization_id
    AND application.case_item_id = OLD.case_item_id
    AND application.submission_id = OLD.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;
  IF OLD.status_code <> 'draft' THEN
    RAISE EXCEPTION 'only_untouched_draft_mortgage_application_may_be_deleted'
      USING errcode = '23514';
  END IF;

  SELECT process.* INTO process_row
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = OLD.organization_id
    AND process.case_id = mortgage_case_id
    AND process.application_id = OLD.id
  FOR UPDATE;
  IF NOT FOUND
    OR process_row.stage <> 'pre_application'
    OR process_row.revision <> 0
    OR EXISTS (
      SELECT 1
      FROM public.crm_mortgage_application_artifacts artifact
      WHERE artifact.organization_id = OLD.organization_id
        AND artifact.case_id = mortgage_case_id
        AND artifact.application_id = OLD.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.crm_mortgage_document_ai_attempts attempt
      WHERE attempt.organization_id = OLD.organization_id
        AND attempt.case_id = mortgage_case_id
        AND attempt.application_id = OLD.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.crm_mortgage_application_events event
      WHERE event.organization_id = OLD.organization_id
        AND event.case_id = mortgage_case_id
        AND event.application_id = OLD.id
        AND (
          event.event_type <> 'process_initialized'
          OR event.aggregate_revision <> 0
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.crm_case_contract_selections contract
      WHERE contract.organization_id = OLD.organization_id
        AND contract.case_id = mortgage_case_id
        AND contract.application_id = OLD.id
    )
  THEN
    RAISE EXCEPTION 'mortgage_application_has_auditable_history_and_cannot_be_deleted'
      USING errcode = '23514';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_crm_bank_application_submission_delete()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.record_crm_mortgage_artifact_deliveries(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_artifact_id uuid,
  p_process_stage text,
  p_actor_user_id uuid,
  p_deliveries jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  delivery jsonb;
  recipient_id uuid;
  delivered_at_value timestamptz;
  channel_value text;
  evidence_value text;
  metadata_value jsonb;
  artifact_kind_value text;
  artifact_received_at timestamptz;
  artifact_valid_from timestamptz;
  artifact_valid_until timestamptz;
  decision_due_at_value timestamptz;
  effective_consent_value text;
  inserted_count integer := 0;
BEGIN
  IF p_deliveries IS NULL THEN
    RETURN 0;
  END IF;
  IF jsonb_typeof(p_deliveries) <> 'array' THEN
    RAISE EXCEPTION 'mortgage_deliveries_must_be_an_array' USING errcode = '22023';
  END IF;
  IF jsonb_array_length(p_deliveries) > 20 THEN
    RAISE EXCEPTION 'mortgage_deliveries_limit_exceeded' USING errcode = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_deliveries) entry
    GROUP BY entry ->> 'recipientClientId'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_mortgage_delivery_recipient' USING errcode = '22023';
  END IF;

  SELECT artifact.kind, artifact.received_at, artifact.valid_from, artifact.valid_until
  INTO artifact_kind_value, artifact_received_at, artifact_valid_from, artifact_valid_until
  FROM public.crm_mortgage_application_artifacts artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.case_id = p_case_id
    AND artifact.application_id = p_application_id
    AND artifact.id = p_artifact_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_artifact_not_found' USING errcode = 'P0002';
  END IF;
  SELECT process.decision_due_at INTO decision_due_at_value
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = p_organization_id
    AND process.case_id = p_case_id
    AND process.application_id = p_application_id;

  FOR delivery IN SELECT value FROM jsonb_array_elements(p_deliveries) LOOP
    IF jsonb_typeof(delivery) <> 'object'
      OR delivery - ARRAY[
        'recipientClientId', 'deliveredAt', 'channel',
        'evidenceReference', 'metadata'
      ]::text[] <> '{}'::jsonb
    THEN
      RAISE EXCEPTION 'invalid_mortgage_delivery' USING errcode = '22023';
    END IF;
    recipient_id := nullif(delivery ->> 'recipientClientId', '')::uuid;
    delivered_at_value := nullif(delivery ->> 'deliveredAt', '')::timestamptz;
    channel_value := nullif(btrim(delivery ->> 'channel'), '');
    evidence_value := nullif(btrim(delivery ->> 'evidenceReference'), '');
    metadata_value := coalesce(delivery -> 'metadata', '{}'::jsonb);

    IF recipient_id IS NULL OR delivered_at_value IS NULL
      OR NOT isfinite(delivered_at_value)
      OR channel_value IS NULL
      OR channel_value NOT IN (
        'client_portal_download', 'email_attachment', 'registered_mail',
        'physical_copy', 'other_durable_medium'
      )
      OR delivered_at_value > statement_timestamp() + interval '5 minutes'
      OR delivered_at_value < artifact_received_at
      OR (
        artifact_valid_until IS NOT NULL
        AND delivered_at_value >= artifact_valid_until
      )
      OR (
        artifact_kind_value = 'esis'
        AND (
          artifact_valid_until IS NULL
          OR (artifact_valid_from IS NOT NULL AND delivered_at_value < artifact_valid_from)
        )
      )
      OR (channel_value <> 'client_portal_download' AND evidence_value IS NULL)
      OR (evidence_value IS NOT NULL AND char_length(evidence_value) > 500)
      OR jsonb_typeof(metadata_value) <> 'object'
      OR pg_column_size(metadata_value) > 8192
    THEN
      RAISE EXCEPTION 'invalid_mortgage_delivery' USING errcode = '22023';
    END IF;

    IF p_process_stage = 'pre_application' THEN
      PERFORM 1
      FROM public.crm_case_clients link
      WHERE link.organization_id = p_organization_id
        AND link.case_id = p_case_id
        AND link.client_id = recipient_id;
    ELSE
      PERFORM 1
      FROM public.crm_mortgage_application_parties party
      WHERE party.organization_id = p_organization_id
        AND party.case_id = p_case_id
        AND party.application_id = p_application_id
        AND party.client_id = recipient_id;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'mortgage_delivery_recipient_not_in_application'
        USING errcode = '23514';
    END IF;

    IF artifact_kind_value = 'credit_decision'
      AND decision_due_at_value IS NOT NULL
      AND delivered_at_value < decision_due_at_value
    THEN
      SELECT consent.decision INTO effective_consent_value
      FROM public.crm_mortgage_early_decision_consents consent
      WHERE consent.application_id = p_application_id
        AND consent.client_id = recipient_id
        AND consent.captured_at <= delivered_at_value
      ORDER BY consent.captured_at DESC, consent.created_at DESC, consent.id DESC
      LIMIT 1;
      IF effective_consent_value IS DISTINCT FROM 'granted' THEN
        RAISE EXCEPTION 'early_credit_decision_delivery_requires_applicant_consent'
          USING errcode = '23514';
      END IF;
    END IF;

    IF p_process_stage <> 'pre_application'
      AND artifact_kind_value IN ('credit_decision', 'draft_credit_agreement')
      AND EXISTS (
        SELECT 1
        FROM public.crm_mortgage_application_parties party
        WHERE party.application_id = p_application_id
          AND party.client_id = recipient_id
          AND delivered_at_value < party.frozen_at
      )
    THEN
      RAISE EXCEPTION 'mortgage_delivery_predates_frozen_application_party'
        USING errcode = '23514';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.crm_mortgage_artifact_deliveries existing_delivery
      WHERE existing_delivery.application_id = p_application_id
        AND existing_delivery.artifact_id = p_artifact_id
        AND existing_delivery.recipient_client_id = recipient_id
        AND existing_delivery.delivered_at > delivered_at_value
    ) THEN
      RAISE EXCEPTION 'mortgage_delivery_time_must_be_monotonic'
        USING errcode = '23514';
    END IF;

    INSERT INTO public.crm_mortgage_artifact_deliveries (
      organization_id, case_id, application_id, artifact_id,
      recipient_client_id, delivered_at, channel, evidence_reference,
      recorded_by_user_id, metadata
    ) VALUES (
      p_organization_id, p_case_id, p_application_id, p_artifact_id,
      recipient_id, delivered_at_value, channel_value, evidence_value,
      p_actor_user_id, metadata_value
    );
    inserted_count := inserted_count + 1;
  END LOOP;

  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION private.record_crm_mortgage_artifact_deliveries(
  uuid, uuid, uuid, uuid, text, uuid, jsonb
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.assert_crm_mortgage_decision_deliveries_have_current_esis(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_decision_artifact_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  decision_row public.crm_mortgage_application_artifacts%rowtype;
  esis_row public.crm_mortgage_application_artifacts%rowtype;
BEGIN
  SELECT artifact.* INTO decision_row
  FROM public.crm_mortgage_application_artifacts artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.case_id = p_case_id
    AND artifact.application_id = p_application_id
    AND artifact.id = p_decision_artifact_id
    AND artifact.kind = 'credit_decision';
  IF NOT FOUND OR decision_row.related_esis_artifact_id IS NULL THEN
    RAISE EXCEPTION 'credit_decision_related_esis_not_found'
      USING errcode = '23514';
  END IF;

  SELECT artifact.* INTO esis_row
  FROM public.crm_mortgage_application_artifacts artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.case_id = p_case_id
    AND artifact.application_id = p_application_id
    AND artifact.id = decision_row.related_esis_artifact_id
    AND artifact.kind = 'esis';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'credit_decision_related_esis_not_found'
      USING errcode = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_mortgage_application_artifacts newer
    WHERE newer.application_id = p_application_id
      AND newer.kind = 'esis'
      AND newer.version > esis_row.version
  ) THEN
    RAISE EXCEPTION 'credit_decision_requires_latest_esis_version'
      USING errcode = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT
        delivery.recipient_client_id,
        min(delivery.delivered_at) AS decision_delivered_at
      FROM public.crm_mortgage_artifact_deliveries delivery
      JOIN public.crm_mortgage_application_parties party
        ON party.organization_id = delivery.organization_id
       AND party.case_id = delivery.case_id
       AND party.application_id = delivery.application_id
       AND party.client_id = delivery.recipient_client_id
      WHERE delivery.organization_id = p_organization_id
        AND delivery.case_id = p_case_id
        AND delivery.application_id = p_application_id
        AND delivery.artifact_id = p_decision_artifact_id
      GROUP BY delivery.recipient_client_id
    ) decision_delivery
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.crm_mortgage_artifact_deliveries esis_delivery
      WHERE esis_delivery.organization_id = esis_row.organization_id
        AND esis_delivery.case_id = esis_row.case_id
        AND esis_delivery.application_id = esis_row.application_id
        AND esis_delivery.artifact_id = esis_row.id
       AND esis_delivery.recipient_client_id = decision_delivery.recipient_client_id
        AND (esis_row.valid_from IS NULL OR esis_row.valid_from <= decision_delivery.decision_delivered_at)
        AND esis_row.valid_until > decision_delivery.decision_delivered_at
        AND esis_delivery.delivered_at <= decision_delivery.decision_delivered_at
    )
  ) THEN
    RAISE EXCEPTION 'current_esis_must_be_delivered_with_credit_decision'
      USING errcode = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_crm_mortgage_decision_deliveries_have_current_esis(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.assert_crm_mortgage_artifact_ai_validation_current(
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
  process_stage text;
  validation_context jsonb;
  latest_validation_id uuid;
BEGIN
  SELECT artifact.* INTO artifact_row
  FROM public.crm_mortgage_application_artifacts artifact
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
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = p_organization_id
    AND process.case_id = p_case_id
    AND process.application_id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'mortgage_application_process_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT validation.* INTO validation_row
  FROM public.crm_mortgage_document_ai_validations validation
  WHERE validation.organization_id = artifact_row.organization_id
    AND validation.case_id = artifact_row.case_id
    AND validation.application_id = artifact_row.application_id
    AND validation.id = artifact_row.ai_validation_id;

  SELECT validation.id INTO latest_validation_id
  FROM public.crm_mortgage_document_ai_validations validation
  WHERE validation.organization_id = artifact_row.organization_id
    AND validation.case_id = artifact_row.case_id
    AND validation.application_id = artifact_row.application_id
    AND validation.document_id = artifact_row.document_id
    AND validation.expected_kind = artifact_row.kind
    AND validation.source_sha256 = artifact_row.document_sha256
  ORDER BY validation.validated_at DESC, validation.created_at DESC, validation.id DESC
  LIMIT 1;

  validation_context := private.crm_mortgage_document_validation_context(
    p_organization_id,
    p_case_id,
    p_application_id,
    process_stage <> 'pre_application',
    artifact_row.kind,
    artifact_row.decision_outcome,
    artifact_row.valid_until
  );

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
    OR validation_row.validated_decision_outcome IS DISTINCT FROM
      artifact_row.decision_outcome
    OR validation_row.validated_valid_until IS DISTINCT FROM
      artifact_row.valid_until
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

REVOKE ALL ON FUNCTION private.assert_crm_mortgage_artifact_ai_validation_current(
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.execute_crm_mortgage_application_command(p_request jsonb)
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

    SELECT validation.* INTO ai_validation_row
    FROM public.crm_mortgage_document_ai_validations validation
    WHERE validation.organization_id = organization_id_value
      AND validation.case_id = case_id_value
      AND validation.application_id = application_id_value
      AND validation.id = artifact_row.ai_validation_id;
    validation_context_value := private.crm_mortgage_document_validation_context(
      organization_id_value,
      case_id_value,
      application_id_value,
      true,
      'esis',
      NULL,
      artifact_row.valid_until
    );
    IF NOT FOUND
      OR NOT private.is_effective_crm_mortgage_ai_validation(
        ai_validation_row.verdict,
        ai_validation_row.expert_override_reason,
        ai_validation_row.expert_overridden_at,
        ai_validation_row.expert_overridden_by_user_id
      )
      OR ai_validation_row.applicant_context_sha256 IS DISTINCT FROM
        applicant_context_value ->> 'applicantContextSha256'
      OR ai_validation_row.expectation_sha256 IS DISTINCT FROM
        validation_context_value ->> 'expectationSha256'
      OR ai_validation_row.bank_context_sha256 IS DISTINCT FROM
        validation_context_value ->> 'bankContextSha256'
      OR ai_validation_row.validated_bank_id::text IS DISTINCT FROM
        validation_context_value ->> 'bankId'
      OR ai_validation_row.validated_offer_id::text IS DISTINCT FROM
        validation_context_value ->> 'offerId'
      OR ai_validation_row.validated_valid_until IS DISTINCT FROM artifact_row.valid_until
      OR ai_validation_row.validated_loan_amount IS DISTINCT FROM
        nullif(validation_context_value ->> 'loanAmount', '')::numeric
      OR ai_validation_row.validated_currency IS DISTINCT FROM
        validation_context_value ->> 'currency'
    THEN
      RAISE EXCEPTION 'mortgage_esis_ai_validation_applicant_context_stale'
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

CREATE FUNCTION private.assert_crm_mortgage_contract_compliance(
  p_organization_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  process_row public.crm_mortgage_application_processes%rowtype;
  decision_row public.crm_mortgage_application_artifacts%rowtype;
  agreement_row public.crm_mortgage_application_artifacts%rowtype;
  required_count integer;
  delivered_count integer;
BEGIN
  SELECT process.* INTO process_row
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = p_organization_id
    AND process.case_id = p_case_id
    AND process.application_id = p_application_id;
  IF NOT FOUND
    OR process_row.stage <> 'ready_for_contract'
    OR process_row.decision_outcome IS DISTINCT FROM 'positive'
  THEN
    RAISE EXCEPTION 'mortgage_contract_requires_ready_positive_process'
      USING errcode = '23514';
  END IF;

  SELECT count(*) INTO required_count
  FROM public.crm_mortgage_application_parties party
  WHERE party.organization_id = p_organization_id
    AND party.case_id = p_case_id
    AND party.application_id = p_application_id;
  IF required_count = 0 THEN
    RAISE EXCEPTION 'mortgage_contract_requires_frozen_applicants'
      USING errcode = '23514';
  END IF;

  SELECT artifact.* INTO decision_row
  FROM public.crm_mortgage_application_artifacts artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.case_id = p_case_id
    AND artifact.application_id = p_application_id
    AND artifact.kind = 'credit_decision'
  ORDER BY artifact.version DESC
  LIMIT 1;
  IF NOT FOUND
    OR decision_row.decision_outcome IS DISTINCT FROM 'positive'
    OR decision_row.valid_until IS NULL
    OR decision_row.valid_until <= p_at
  THEN
    RAISE EXCEPTION 'mortgage_contract_requires_current_positive_decision'
      USING errcode = '23514';
  END IF;

  PERFORM private.assert_crm_mortgage_artifact_ai_validation_current(
    p_organization_id, p_case_id, p_application_id,
    decision_row.related_esis_artifact_id
  );
  PERFORM private.assert_crm_mortgage_artifact_ai_validation_current(
    p_organization_id, p_case_id, p_application_id, decision_row.id
  );

  SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
  FROM public.crm_mortgage_artifact_deliveries delivery
  JOIN public.crm_mortgage_application_parties party
    ON party.application_id = delivery.application_id
   AND party.client_id = delivery.recipient_client_id
  WHERE delivery.artifact_id = decision_row.id
    AND delivery.delivered_at <= p_at;
  IF delivered_count <> required_count THEN
    RAISE EXCEPTION 'mortgage_contract_requires_decision_delivery'
      USING errcode = '23514';
  END IF;

  -- The decision must remain bound to the absolute newest ESIS. This helper
  -- checks, per frozen applicant, that the linked ESIS was valid and had
  -- already been delivered when that applicant received the decision. ESIS
  -- validity is deliberately evaluated at decision delivery, not signing.
  PERFORM private.assert_crm_mortgage_decision_deliveries_have_current_esis(
    p_organization_id, p_case_id, p_application_id, decision_row.id
  );

  SELECT artifact.* INTO agreement_row
  FROM public.crm_mortgage_application_artifacts artifact
  WHERE artifact.organization_id = p_organization_id
    AND artifact.case_id = p_case_id
    AND artifact.application_id = p_application_id
    AND artifact.kind = 'draft_credit_agreement'
  ORDER BY artifact.version DESC
  LIMIT 1;
  IF NOT FOUND
    OR agreement_row.related_decision_artifact_id IS DISTINCT FROM decision_row.id
    OR agreement_row.received_at < decision_row.received_at
    OR agreement_row.received_at > p_at
  THEN
    RAISE EXCEPTION 'mortgage_contract_requires_current_draft_agreement'
      USING errcode = '23514';
  END IF;

  SELECT count(DISTINCT delivery.recipient_client_id) INTO delivered_count
  FROM public.crm_mortgage_artifact_deliveries delivery
  JOIN public.crm_mortgage_application_parties party
    ON party.application_id = delivery.application_id
   AND party.client_id = delivery.recipient_client_id
  WHERE delivery.artifact_id = agreement_row.id
    AND delivery.delivered_at <= p_at;
  IF delivered_count <> required_count THEN
    RAISE EXCEPTION 'mortgage_contract_requires_draft_agreement_delivery'
      USING errcode = '23514';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION private.assert_crm_mortgage_contract_compliance(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Phase-1 contract guard: preserve the legacy RPC shape while failing closed
-- on the complete mortgage evidence set. The stricter manager authorization
-- and audited lifecycle projection are activated by 0051.
CREATE FUNCTION private.guard_crm_case_contract_insert_compat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  caller_user_id uuid := (SELECT app.current_user_id());
  case_owner_user_id uuid;
  item_owner_user_id uuid;
  membership_role text;
  target_status text;
BEGIN
  IF caller_user_id IS NULL OR caller_user_id IS DISTINCT FROM NEW.signed_by_user_id THEN
    RAISE EXCEPTION 'contract_signing_actor_mismatch' USING errcode = '42501';
  END IF;
  SELECT membership.role INTO membership_role
  FROM public.organization_memberships membership
    WHERE membership.organization_id = NEW.organization_id
      AND membership.user_id = caller_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization membership is required' USING errcode = '42501';
  END IF;

  SELECT crm_case.owner_user_id INTO case_owner_user_id
  FROM public.crm_cases crm_case
  WHERE crm_case.organization_id = NEW.organization_id
    AND crm_case.id = NEW.case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM case not found' USING errcode = 'P0002';
  END IF;

  SELECT submission.status_code, item.owner_user_id
  INTO target_status, item_owner_user_id
  FROM public.crm_case_bank_applications application
  JOIN public.crm_item_submissions submission
    ON submission.organization_id = application.organization_id
   AND submission.id = application.submission_id
  JOIN public.crm_case_items item
    ON item.organization_id = application.organization_id
   AND item.case_id = application.case_id
   AND item.id = application.case_item_id
  WHERE application.organization_id = NEW.organization_id
    AND application.case_id = NEW.case_id
    AND application.submission_id = NEW.application_id
  FOR UPDATE OF application, submission, item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank application not found' USING errcode = 'P0002';
  END IF;
  IF target_status <> 'zaakceptowane' THEN
    RAISE EXCEPTION 'Only an accepted bank application can be signed'
      USING errcode = '23514';
  END IF;
  IF membership_role <> 'admin'
    AND case_owner_user_id IS DISTINCT FROM caller_user_id
    AND item_owner_user_id IS DISTINCT FROM caller_user_id
  THEN
    RAISE EXCEPTION 'Mortgage case manager permission is required'
      USING errcode = '42501';
  END IF;

  -- The legacy RPC uses transaction_timestamp(); normalize to the actual
  -- insert instant so delivery cutoffs stay monotonic in long transactions.
  NEW.signed_at := clock_timestamp();
  PERFORM private.assert_crm_mortgage_contract_compliance(
    NEW.organization_id, NEW.case_id, NEW.application_id, NEW.signed_at
  );

  INSERT INTO private.crm_mortgage_application_command_guards (
    application_id, transaction_id
  )
  SELECT application.submission_id, txid_current()
  FROM public.crm_case_bank_applications application
  WHERE application.organization_id = NEW.organization_id
    AND application.case_id = NEW.case_id
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_crm_case_contract_insert_compat()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

DROP TRIGGER crm_case_contract_selections_guard_insert
  ON public.crm_case_contract_selections;
CREATE TRIGGER crm_case_contract_selections_guard_insert
  BEFORE INSERT ON public.crm_case_contract_selections
  FOR EACH ROW EXECUTE FUNCTION private.guard_crm_case_contract_insert_compat();

CREATE FUNCTION private.project_crm_mortgage_contract_insert_compat()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  selected_process public.crm_mortgage_application_processes%rowtype;
BEGIN
  WITH closed AS (
    UPDATE public.crm_mortgage_application_processes process
    SET stage = 'closed',
        revision = process.revision + 1,
        closed_at = greatest(NEW.signed_at, process.created_at),
        updated_by_user_id = NEW.signed_by_user_id
    WHERE process.organization_id = NEW.organization_id
      AND process.case_id = NEW.case_id
      AND process.application_id <> NEW.application_id
      AND process.stage <> 'closed'
    RETURNING process.*
  )
  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload
  )
  SELECT
    closed.organization_id, closed.case_id, closed.application_id, closed.revision,
    gen_random_uuid(), 'application_closed', NEW.signed_by_user_id,
    greatest(NEW.signed_at, closed.created_at),
    jsonb_build_object(
      'systemReason', 'phase1_contract_signed_elsewhere',
      'selectedApplicationId', NEW.application_id,
      'result', jsonb_build_object(
        'applicationId', closed.application_id,
        'stage', 'closed',
        'revision', closed.revision
      )
    )
  FROM closed;

  UPDATE public.crm_mortgage_application_processes process
  SET stage = 'completed',
      revision = process.revision + 1,
      closed_at = NULL,
      updated_by_user_id = NEW.signed_by_user_id
  WHERE process.organization_id = NEW.organization_id
    AND process.case_id = NEW.case_id
    AND process.application_id = NEW.application_id
    AND process.stage = 'ready_for_contract'
  RETURNING process.* INTO selected_process;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mortgage application is no longer ready for contract'
      USING errcode = '40001';
  END IF;

  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload
  ) VALUES (
    NEW.organization_id, NEW.case_id, NEW.application_id,
    selected_process.revision, gen_random_uuid(), 'contract_signed',
    NEW.signed_by_user_id, NEW.signed_at,
    jsonb_build_object(
      'systemReason', 'phase1_contract_signed',
      'compatibilityProjection', true,
      'result', jsonb_build_object(
        'applicationId', NEW.application_id,
        'stage', 'completed',
        'revision', selected_process.revision,
        'signedAt', NEW.signed_at
      )
    )
  );

  DELETE FROM private.crm_mortgage_application_command_guards guard
  WHERE guard.transaction_id = txid_current();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.project_crm_mortgage_contract_insert_compat()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_case_contract_selections_project_mortgage_process
  AFTER INSERT ON public.crm_case_contract_selections
  FOR EACH ROW EXECUTE FUNCTION private.project_crm_mortgage_contract_insert_compat();

CREATE FUNCTION private.guard_crm_case_contract_insert_strict()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  caller_user_id uuid := (SELECT app.current_user_id());
  case_owner_user_id uuid;
  item_owner_user_id uuid;
  target_status text;
  membership_role text;
BEGIN
  IF caller_user_id IS NULL OR caller_user_id IS DISTINCT FROM NEW.signed_by_user_id THEN
    RAISE EXCEPTION 'contract_signing_actor_mismatch' USING errcode = '42501';
  END IF;

  -- Authenticate and authorize before taking aggregate locks or exposing
  -- whether the case/application exists.
  SELECT membership.role INTO membership_role
  FROM public.organization_memberships membership
  WHERE membership.organization_id = NEW.organization_id
    AND membership.user_id = caller_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization membership is required' USING errcode = '42501';
  END IF;

  SELECT crm_case.owner_user_id INTO case_owner_user_id
  FROM public.crm_cases crm_case
  WHERE crm_case.organization_id = NEW.organization_id
    AND crm_case.id = NEW.case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM case not found' USING errcode = 'P0002';
  END IF;

  SELECT submission.status_code, item.owner_user_id
  INTO target_status, item_owner_user_id
  FROM public.crm_case_bank_applications application
  JOIN public.crm_item_submissions submission
    ON submission.organization_id = application.organization_id
   AND submission.case_item_id = application.case_item_id
   AND submission.id = application.submission_id
  JOIN public.crm_case_items item
    ON item.organization_id = application.organization_id
   AND item.case_id = application.case_id
   AND item.id = application.case_item_id
  WHERE application.organization_id = NEW.organization_id
    AND application.case_id = NEW.case_id
    AND application.submission_id = NEW.application_id
  FOR UPDATE OF application, submission, item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank application not found' USING errcode = 'P0002';
  END IF;
  IF target_status <> 'zaakceptowane' THEN
    RAISE EXCEPTION 'Only an accepted bank application can be signed'
      USING errcode = '23514';
  END IF;

  IF membership_role <> 'admin'
    AND case_owner_user_id IS DISTINCT FROM caller_user_id
    AND item_owner_user_id IS DISTINCT FROM caller_user_id
  THEN
    RAISE EXCEPTION 'Mortgage case manager permission is required'
      USING errcode = '42501';
  END IF;

  PERFORM private.assert_crm_mortgage_contract_compliance(
    NEW.organization_id, NEW.case_id, NEW.application_id, NEW.signed_at
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_crm_case_contract_insert_strict()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.sign_crm_case_contract_strict(
  target_organization_id uuid,
  target_case_id uuid,
  target_application_id uuid
) RETURNS public.crm_case_contract_selections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  actor_user_id uuid := (SELECT app.current_user_id());
  case_owner_user_id uuid;
  item_owner_user_id uuid;
  membership_role text;
  selected_process public.crm_mortgage_application_processes%rowtype;
  signed_at_value timestamptz := statement_timestamp();
  result public.crm_case_contract_selections;
BEGIN
  IF actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required' USING errcode = '42501';
  END IF;

  -- Membership is checked before any existence probe or idempotency/unique
  -- response, so a removed user cannot use signing as a cross-tenant oracle.
  SELECT membership.role INTO membership_role
  FROM public.organization_memberships membership
  WHERE membership.organization_id = target_organization_id
    AND membership.user_id = actor_user_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization membership is required' USING errcode = '42501';
  END IF;

  SELECT crm_case.owner_user_id INTO case_owner_user_id
  FROM public.crm_cases crm_case
  WHERE crm_case.organization_id = target_organization_id
    AND crm_case.id = target_case_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CRM case not found' USING errcode = 'P0002';
  END IF;

  SELECT item.owner_user_id INTO item_owner_user_id
  FROM public.crm_case_bank_applications application
  JOIN public.crm_case_items item
    ON item.organization_id = application.organization_id
   AND item.case_id = application.case_id
   AND item.id = application.case_item_id
  WHERE application.organization_id = target_organization_id
    AND application.case_id = target_case_id
    AND application.submission_id = target_application_id
  FOR UPDATE OF application, item;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank application not found' USING errcode = 'P0002';
  END IF;

  IF membership_role <> 'admin'
    AND case_owner_user_id IS DISTINCT FROM actor_user_id
    AND item_owner_user_id IS DISTINCT FROM actor_user_id
  THEN
    RAISE EXCEPTION 'Mortgage case manager permission is required'
      USING errcode = '42501';
  END IF;

  SELECT process.* INTO selected_process
  FROM public.crm_mortgage_application_processes process
  WHERE process.organization_id = target_organization_id
    AND process.case_id = target_case_id
    AND process.application_id = target_application_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mortgage application process not found' USING errcode = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.crm_case_contract_selections contract
    WHERE contract.organization_id = target_organization_id
      AND contract.case_id = target_case_id
  ) THEN
    RAISE EXCEPTION 'A credit agreement has already been signed for this CRM case'
      USING errcode = '23505';
  END IF;

  PERFORM private.assert_crm_mortgage_contract_compliance(
    target_organization_id, target_case_id, target_application_id, signed_at_value
  );

  INSERT INTO private.crm_mortgage_application_command_guards (
    application_id, transaction_id
  )
  SELECT application.submission_id, txid_current()
  FROM public.crm_case_bank_applications application
  WHERE application.organization_id = target_organization_id
    AND application.case_id = target_case_id
  ON CONFLICT DO NOTHING;

  WITH closed AS (
    UPDATE public.crm_mortgage_application_processes process
    SET stage = 'closed',
        revision = process.revision + 1,
        closed_at = signed_at_value,
        updated_by_user_id = actor_user_id
    FROM public.crm_case_bank_applications application
    WHERE application.organization_id = target_organization_id
      AND application.case_id = target_case_id
      AND application.submission_id <> target_application_id
      AND process.organization_id = application.organization_id
      AND process.case_id = application.case_id
      AND process.application_id = application.submission_id
      AND process.stage <> 'closed'
    RETURNING process.*
  )
  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload
  )
  SELECT
    closed.organization_id, closed.case_id, closed.application_id, closed.revision,
    gen_random_uuid(), 'application_closed', actor_user_id, signed_at_value,
    jsonb_build_object(
      'systemReason', 'contract_signed_elsewhere',
      'selectedApplicationId', target_application_id,
      'result', jsonb_build_object(
        'applicationId', closed.application_id,
        'stage', 'closed',
        'revision', closed.revision
      )
    )
  FROM closed;

  INSERT INTO public.crm_case_contract_selections (
    organization_id, case_id, application_id, signed_by_user_id, signed_at
  ) VALUES (
    target_organization_id, target_case_id, target_application_id,
    actor_user_id, signed_at_value
  )
  RETURNING * INTO result;

  UPDATE public.crm_mortgage_application_processes process
  SET stage = 'completed',
      revision = process.revision + 1,
      updated_by_user_id = actor_user_id
  WHERE process.organization_id = target_organization_id
    AND process.case_id = target_case_id
    AND process.application_id = target_application_id
    AND process.stage = 'ready_for_contract'
  RETURNING process.* INTO selected_process;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mortgage application is no longer ready for contract'
      USING errcode = '40001';
  END IF;

  INSERT INTO public.crm_mortgage_application_events (
    organization_id, case_id, application_id, aggregate_revision,
    command_id, event_type, actor_user_id, occurred_at, payload
  ) VALUES (
    target_organization_id, target_case_id, target_application_id,
    selected_process.revision, gen_random_uuid(), 'contract_signed',
    actor_user_id, signed_at_value,
    jsonb_build_object(
      'systemReason', 'contract_signed',
      'result', jsonb_build_object(
        'applicationId', target_application_id,
        'stage', 'completed',
        'revision', selected_process.revision,
        'signedAt', signed_at_value
      )
    )
  );

  DELETE FROM private.crm_mortgage_application_command_guards guard
  WHERE guard.transaction_id = txid_current();

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.sign_crm_case_contract_strict(uuid, uuid, uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Compatibility phase: 0051 points the contract trigger/RPC at the strict
-- implementations and revokes direct contract-table DML after the new server
-- code is deployed.

-- Conservative historical projection. Legacy timestamps never prove
-- completeness or document delivery; those states remain actionable until
-- real artifacts/evidence are attached. Signed legacy contracts are terminal.
INSERT INTO public.crm_mortgage_application_processes (
  application_id, organization_id, case_id, stage, revision,
  application_submitted_at, decision_received_at, decision_outcome, closed_at,
  created_by_user_id, updated_by_user_id, created_at, updated_at
)
SELECT
  application.submission_id,
  application.organization_id,
  application.case_id,
  CASE
    WHEN contract.application_id IS NOT NULL THEN 'completed'
    WHEN submission.status_code = 'draft' THEN 'pre_application'
    WHEN submission.status_code = 'wyslane' AND submission.submitted_at IS NOT NULL THEN 'submitted'
    WHEN submission.status_code = 'w_analizie' AND submission.submitted_at IS NOT NULL THEN 'awaiting_completeness'
    WHEN submission.status_code = 'braki' AND submission.submitted_at IS NOT NULL THEN 'additional_information_requested'
    WHEN submission.status_code IN ('zaakceptowane', 'odrzucone') THEN 'decision_received'
    WHEN submission.status_code = 'wycofane' THEN 'closed'
    ELSE 'pre_application'
  END,
  0,
  CASE
    WHEN contract.application_id IS NOT NULL
      OR submission.status_code IN ('zaakceptowane', 'odrzucone', 'wycofane')
      THEN coalesce(submission.submitted_at, application.created_at)
    ELSE submission.submitted_at
  END,
  CASE WHEN submission.status_code IN ('zaakceptowane', 'odrzucone')
    OR contract.application_id IS NOT NULL
    THEN greatest(
      coalesce(submission.decision_at, submission.updated_at),
      coalesce(submission.submitted_at, application.created_at)
    )
    ELSE NULL
  END,
  CASE
    WHEN submission.status_code = 'odrzucone' THEN 'negative'
    WHEN submission.status_code = 'zaakceptowane' OR contract.application_id IS NOT NULL THEN 'positive'
    ELSE NULL
  END,
  CASE WHEN submission.status_code = 'wycofane'
    THEN greatest(submission.updated_at, application.created_at)
    ELSE NULL
  END,
  membership.user_id,
  membership.user_id,
  application.created_at,
  greatest(application.created_at, submission.updated_at)
FROM public.crm_case_bank_applications application
JOIN public.crm_item_submissions submission
  ON submission.organization_id = application.organization_id
 AND submission.case_item_id = application.case_item_id
 AND submission.id = application.submission_id
LEFT JOIN public.crm_case_contract_selections contract
  ON contract.organization_id = application.organization_id
 AND contract.case_id = application.case_id
 AND contract.application_id = application.submission_id
LEFT JOIN public.organization_memberships membership
  ON membership.organization_id = application.organization_id
 AND membership.user_id = application.created_by_user_id
ON CONFLICT (application_id) DO NOTHING;

INSERT INTO public.crm_mortgage_application_parties (
  organization_id, case_id, application_id, client_id, role,
  frozen_at, frozen_by_user_id, created_at
)
SELECT
  application.organization_id,
  application.case_id,
  application.submission_id,
  link.client_id,
  CASE WHEN link.is_primary THEN 'primary_applicant' ELSE 'co_applicant' END,
  coalesce(submission.submitted_at, application.created_at),
  membership.user_id,
  greatest(link.created_at, application.created_at)
FROM public.crm_case_bank_applications application
JOIN public.crm_item_submissions submission
  ON submission.organization_id = application.organization_id
 AND submission.case_item_id = application.case_item_id
 AND submission.id = application.submission_id
JOIN public.crm_case_clients link
  ON link.organization_id = application.organization_id
 AND link.case_id = application.case_id
LEFT JOIN public.organization_memberships membership
  ON membership.organization_id = application.organization_id
 AND membership.user_id = application.created_by_user_id
WHERE submission.status_code <> 'draft'
  AND (
    submission.submitted_at IS NOT NULL
    OR submission.status_code IN ('zaakceptowane', 'odrzucone', 'wycofane')
  )
ON CONFLICT (application_id, client_id) DO NOTHING;

INSERT INTO public.crm_mortgage_application_events (
  organization_id, case_id, application_id, aggregate_revision,
  command_id, event_type, actor_user_id, occurred_at, payload
)
SELECT
  process.organization_id,
  process.case_id,
  process.application_id,
  0,
  gen_random_uuid(),
  'process_initialized',
  process.created_by_user_id,
  process.created_at,
  jsonb_build_object(
    'backfilled', true,
    'legacyStage', process.stage,
    'result', jsonb_build_object(
      'applicationId', process.application_id,
      'stage', process.stage,
      'revision', 0
    )
  )
FROM public.crm_mortgage_application_processes process
ON CONFLICT (application_id, aggregate_revision) DO NOTHING;

ALTER TABLE public.crm_mortgage_application_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mortgage_application_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mortgage_document_ai_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mortgage_document_ai_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mortgage_application_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mortgage_artifact_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mortgage_early_decision_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_mortgage_application_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_mortgage_application_processes_member_read
  ON public.crm_mortgage_application_processes FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));
CREATE POLICY crm_mortgage_application_parties_member_read
  ON public.crm_mortgage_application_parties FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));
CREATE POLICY crm_mortgage_document_ai_validations_member_read
  ON public.crm_mortgage_document_ai_validations FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));
CREATE POLICY crm_mortgage_application_artifacts_member_read
  ON public.crm_mortgage_application_artifacts FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));
CREATE POLICY crm_mortgage_artifact_deliveries_member_read
  ON public.crm_mortgage_artifact_deliveries FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));
CREATE POLICY crm_mortgage_early_decision_consents_member_read
  ON public.crm_mortgage_early_decision_consents FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));
CREATE POLICY crm_mortgage_application_events_member_read
  ON public.crm_mortgage_application_events FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

CREATE POLICY crm_mortgage_application_processes_service_read
  ON public.crm_mortgage_application_processes FOR SELECT TO openexpert_service USING (true);
CREATE POLICY crm_mortgage_application_parties_service_read
  ON public.crm_mortgage_application_parties FOR SELECT TO openexpert_service USING (true);
CREATE POLICY crm_mortgage_document_ai_validations_service_read
  ON public.crm_mortgage_document_ai_validations FOR SELECT TO openexpert_service USING (true);
CREATE POLICY crm_mortgage_document_ai_validations_service_insert
  ON public.crm_mortgage_document_ai_validations FOR INSERT TO openexpert_service
  WITH CHECK (true);
CREATE POLICY crm_mortgage_application_artifacts_service_read
  ON public.crm_mortgage_application_artifacts FOR SELECT TO openexpert_service USING (true);
CREATE POLICY crm_mortgage_artifact_deliveries_service_read
  ON public.crm_mortgage_artifact_deliveries FOR SELECT TO openexpert_service USING (true);
CREATE POLICY crm_mortgage_early_decision_consents_service_read
  ON public.crm_mortgage_early_decision_consents FOR SELECT TO openexpert_service USING (true);
CREATE POLICY crm_mortgage_application_events_service_read
  ON public.crm_mortgage_application_events FOR SELECT TO openexpert_service USING (true);

REVOKE ALL ON TABLE public.crm_mortgage_application_processes
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_mortgage_application_parties
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_mortgage_document_ai_attempts
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_mortgage_document_ai_validations
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_mortgage_application_artifacts
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_mortgage_artifact_deliveries
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_mortgage_early_decision_consents
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_mortgage_application_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT ON TABLE public.crm_mortgage_application_processes TO authenticated, openexpert_service;
GRANT SELECT ON TABLE public.crm_mortgage_application_parties TO authenticated, openexpert_service;
GRANT SELECT ON TABLE public.crm_mortgage_document_ai_validations TO authenticated, openexpert_service;
GRANT INSERT (
  ai_attempt_id, organization_id, case_id, application_id, document_id, expected_kind,
  source_sha256, applicant_context_sha256, bank_context_sha256, expectation_sha256,
  validated_bank_id, validated_offer_id, validated_decision_outcome,
  validated_valid_until, validated_loan_amount, validated_currency,
  verdict, provider, model, prompt_version, confidence,
  reason_codes, pii_free_observations,
  expert_override_reason, expert_overridden_by_user_id
) ON TABLE public.crm_mortgage_document_ai_validations TO openexpert_service;
GRANT SELECT ON TABLE public.crm_mortgage_application_artifacts TO authenticated, openexpert_service;
GRANT SELECT ON TABLE public.crm_mortgage_artifact_deliveries TO authenticated, openexpert_service;
GRANT SELECT ON TABLE public.crm_mortgage_early_decision_consents TO authenticated, openexpert_service;
GRANT SELECT ON TABLE public.crm_mortgage_application_events TO authenticated, openexpert_service;

-- Explicit internal ACLs keep SECURITY DEFINER/trigger execution stable when
-- production migrations run with role switching or a hardened default ACL.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.crm_mortgage_application_processes,
  public.crm_mortgage_application_parties,
  public.crm_mortgage_document_ai_attempts,
  public.crm_mortgage_document_ai_validations,
  public.crm_mortgage_application_artifacts,
  public.crm_mortgage_artifact_deliveries,
  public.crm_mortgage_early_decision_consents,
  public.crm_mortgage_application_events,
  private.crm_mortgage_application_command_guards
TO openexpert_owner;

GRANT EXECUTE ON FUNCTION private.polish_easter_sunday(integer) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_polish_mortgage_non_working_day(date) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.crm_mortgage_decision_due_at(timestamptz) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.guard_crm_mortgage_application_event_write()
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.guard_crm_mortgage_submission_lifecycle() TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.sync_crm_mortgage_process_from_legacy_submission()
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.initialize_crm_mortgage_application_process() TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.guard_crm_bank_application_submission_delete() TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_valid_crm_mortgage_ai_reason_codes(text[])
  TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_valid_crm_mortgage_ai_observations(jsonb)
  TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_consistent_crm_mortgage_ai_accepted_verdict(
  text, text, text[], numeric, jsonb
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_effective_crm_mortgage_ai_validation(
  text, text, timestamptz, uuid
) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.crm_mortgage_applicant_context(
  uuid, uuid, uuid, boolean
) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION public.get_crm_mortgage_document_applicant_context(
  uuid, uuid, uuid
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION private.crm_mortgage_document_validation_context(
  uuid, uuid, uuid, boolean, text, text, timestamptz
) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION public.get_crm_mortgage_document_validation_context(
  uuid, uuid, uuid, text, text, timestamptz
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION public.claim_crm_mortgage_document_ai_attempt(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text,
  timestamptz
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION public.complete_crm_mortgage_document_ai_attempt(
  uuid, uuid, uuid, uuid, uuid, text, text, numeric, text[], jsonb
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION private.guard_crm_mortgage_document_ai_validation_write()
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.record_crm_mortgage_artifact_deliveries(
  uuid, uuid, uuid, uuid, text, uuid, jsonb
) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.assert_crm_mortgage_decision_deliveries_have_current_esis(
  uuid, uuid, uuid, uuid
) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.assert_crm_mortgage_artifact_ai_validation_current(
  uuid, uuid, uuid, uuid
) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.assert_crm_mortgage_contract_compliance(
  uuid, uuid, uuid, timestamptz
) TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.guard_crm_case_contract_insert_compat()
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.project_crm_mortgage_contract_insert_compat()
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.guard_crm_case_contract_insert_strict() TO openexpert_owner;
GRANT EXECUTE ON FUNCTION public.execute_crm_mortgage_application_command(jsonb)
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION public.sign_crm_case_contract_strict(uuid, uuid, uuid)
  TO openexpert_owner;
