-- Durable mailbox-thread linking for trusted bank-mail analysis.
--
-- Registration deliberately reuses the already-cached
-- claim_bank_mail_agent_intake RPC. The CRM signs the opaque provider thread
-- reference and its stable hash into a short-lived backend JWT; this migration
-- validates those claims and writes the job in the same transaction as the
-- intake claim. No new public registration RPC is required by the Data API.

-- Fail closed if an earlier application build somehow wrote an automatic link
-- alongside another CRM context for the same mailbox thread. Production has
-- no such rows today, but installing serialization on inconsistent history
-- would otherwise legitimize an ambiguous demo state.
DO $mail_context_thread_link_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.mail_context_thread_links AS left_link
    JOIN public.mail_context_thread_links AS right_link
      ON right_link.organization_id = left_link.organization_id
     AND right_link.owner_user_id = left_link.owner_user_id
     AND right_link.connection_id = left_link.connection_id
     AND right_link.thread_key_hash = left_link.thread_key_hash
     AND right_link.id > left_link.id
    WHERE (
      left_link.case_id IS DISTINCT FROM right_link.case_id
      OR left_link.client_id IS DISTINCT FROM right_link.client_id
    )
      AND 'bank_mail_agent' IN (
        left_link.link_source,
        right_link.link_source
      )
  ) THEN
    RAISE EXCEPTION 'bank_mail_agent_thread_link_existing_context_conflict'
      USING errcode = '23514';
  END IF;
END
$mail_context_thread_link_preflight$;

ALTER TABLE public.mortgage_bank_email_identities
  DROP CONSTRAINT mortgage_bank_email_identities_auth_policy_check;

ALTER TABLE public.mortgage_bank_email_identities
  ADD CONSTRAINT mortgage_bank_email_identities_auth_policy_check CHECK (
    authentication_policy IN (
      'dmarc_aligned',
      'openexpert_mock_dkim_aligned'
    )
  );

-- Identity policy is normally immutable. This one controlled migration changes
-- only the exact synthetic OpenExpert Bank identity and restores the guard
-- before the transaction can commit.
ALTER TABLE public.mortgage_bank_email_identities
  DISABLE TRIGGER mortgage_bank_email_identities_protect_identity;

UPDATE public.mortgage_bank_email_identities AS identity
SET authentication_policy = CASE
      WHEN identity.sender_domain = 'openexpert.app'
        AND NOT identity.allow_subdomains
        AND bank.slug = 'openexpert-bank'
        AND bank.is_mock
      THEN 'openexpert_mock_dkim_aligned'::text
      ELSE 'dmarc_aligned'::text
    END,
    updated_at = statement_timestamp()
FROM public.mortgage_banks AS bank
WHERE bank.id = identity.bank_id
  AND (
    identity.authentication_policy <> 'dmarc_aligned'::text
    OR (
      identity.sender_domain = 'openexpert.app'
      AND NOT identity.allow_subdomains
      AND bank.slug = 'openexpert-bank'
      AND bank.is_mock
    )
  );

ALTER TABLE public.mortgage_bank_email_identities
  ENABLE TRIGGER mortgage_bank_email_identities_protect_identity;

DO $openexpert_mock_dkim_policy$
BEGIN
  IF (
    SELECT count(*)
    FROM public.mortgage_bank_email_identities AS identity
    JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
    WHERE identity.authentication_policy = 'openexpert_mock_dkim_aligned'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.mortgage_bank_email_identities AS identity
    JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
    WHERE identity.authentication_policy = 'openexpert_mock_dkim_aligned'
      AND identity.sender_domain = 'openexpert.app'
      AND NOT identity.allow_subdomains
      AND identity.is_active
      AND bank.slug = 'openexpert-bank'
      AND bank.is_mock
  ) THEN
    RAISE EXCEPTION 'openexpert_mock_dkim_policy_scope_invalid'
      USING errcode = '23514';
  END IF;
END
$openexpert_mock_dkim_policy$;

COMMENT ON COLUMN public.mortgage_bank_email_identities.authentication_policy IS
  'Pinned envelope policy. Real banks require DMARC; only the exact synthetic OpenExpert Bank identity may use aligned DKIM.';

ALTER TABLE public.mail_bank_agent_intakes
  ADD COLUMN dkim_aligned boolean DEFAULT false NOT NULL,
  ADD COLUMN authentication_policy_applied text DEFAULT 'dmarc_aligned'::text NOT NULL;

ALTER TABLE public.mail_bank_agent_intakes
  ADD CONSTRAINT mail_bank_agent_intakes_auth_policy_check CHECK (
    authentication_policy_applied IN (
      'dmarc_aligned',
      'openexpert_mock_dkim_aligned'
    )
  ),
  ADD CONSTRAINT mail_bank_agent_intakes_trusted_envelope_check CHECK (
    identity_verdict <> 'trusted_bank'
    OR (
      NOT reply_to_mismatch
      AND (
        (
          authentication_policy_applied = 'dmarc_aligned'
          AND authentication_status = 'passed'
          AND dmarc_aligned
        )
        OR (
          authentication_policy_applied = 'openexpert_mock_dkim_aligned'
          AND dkim_aligned
        )
      )
    )
  );

ALTER TABLE public.mail_bank_agent_intakes
  DROP CONSTRAINT mail_bank_agent_intakes_identity_verdict_check;

ALTER TABLE public.mail_bank_agent_intakes
  ADD CONSTRAINT mail_bank_agent_intakes_identity_verdict_check CHECK (
    identity_verdict IN (
      'trusted_bank',
      'unknown_domain',
      'bank_id_mismatch',
      'authentication_failed',
      'authentication_indeterminate',
      'authentication_policy_invalid',
      'dmarc_not_aligned',
      'dkim_not_aligned',
      'reply_to_mismatch'
    )
  );

COMMENT ON COLUMN public.mail_bank_agent_intakes.dkim_aligned IS
  'Pinned provider verdict: a passing DKIM signature aligned to the visible From domain; never inferred from aggregate authentication.';
COMMENT ON COLUMN public.mail_bank_agent_intakes.authentication_policy_applied IS
  'Immutable policy selected from the exact bank sender identity when the intake was first claimed.';

CREATE OR REPLACE FUNCTION private.is_valid_bank_mail_agent_reason_codes(p_codes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT p_codes IS NOT NULL
    AND cardinality(p_codes) BETWEEN 0 AND 24
    AND array_position(p_codes, NULL::text) IS NULL
    AND cardinality(p_codes) = (
      SELECT count(DISTINCT code)::integer
      FROM unnest(p_codes) AS reason(code)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_codes) AS reason(code)
      WHERE reason.code NOT IN (
        'trusted_bank_identity',
        'unknown_bank_identity',
        'bank_identity_mismatch',
        'authentication_failed',
        'authentication_indeterminate',
        'authentication_policy_invalid',
        'dmarc_not_aligned',
        'dkim_not_aligned',
        'reply_to_mismatch',
        'bank_application_reference',
        'applicant_identity',
        'expert_identity',
        'bank_identity',
        'case_context',
        'application_status',
        'attachment_metadata',
        'multiple_candidates',
        'bank_mismatch',
        'reference_mismatch',
        'owner_mismatch',
        'stale_application',
        'weak_evidence',
        'attachment_unavailable',
        'prompt_injection_suspected',
        'no_candidate',
        'no_matching_signal',
        'not_bank_message',
        'unsafe_attachment',
        'processing_error',
        'human_review_required',
        'policy_requires_review'
      )
    );
$$;

CREATE TABLE private.mail_bank_agent_thread_link_jobs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  thread_key_hash text NOT NULL,
  thread_reference text NOT NULL,
  state text DEFAULT 'pending'::text NOT NULL,
  proposal_id uuid,
  resolved_case_id uuid,
  conflict_case_id uuid,
  conflict_client_id uuid,
  link_id uuid,
  resolution_code text,
  created_at timestamptz DEFAULT now() NOT NULL,
  resolved_at timestamptz,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_thread_link_jobs_intake_key UNIQUE (intake_id),
  CONSTRAINT mail_bank_agent_thread_link_jobs_hash_check CHECK (
    thread_key_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_thread_link_jobs_reference_check CHECK (
    thread_reference = btrim(thread_reference)
    AND btrim(thread_reference) <> ''
    AND char_length(thread_reference) <= 4096
    AND thread_reference !~ '[[:cntrl:]]'
  ),
  CONSTRAINT mail_bank_agent_thread_link_jobs_state_check CHECK (
    state IN ('pending', 'linked', 'not_linked', 'conflict')
  ),
  CONSTRAINT mail_bank_agent_thread_link_jobs_resolution_check CHECK (
    resolution_code IS NULL
    OR resolution_code IN (
      'strong_proposal_linked',
      'existing_same_case_link',
      'thread_linked_to_other_context',
      'no_strong_proposal',
      'proposal_not_strong',
      'proposal_not_unique',
      'analysis_run_not_unique',
      'proposal_state_invalid',
      'trusted_envelope_invalid'
    )
  ),
  CONSTRAINT mail_bank_agent_thread_link_jobs_shape_check CHECK (
    (
      state = 'pending'
      AND proposal_id IS NULL
      AND resolved_case_id IS NULL
      AND conflict_case_id IS NULL
      AND conflict_client_id IS NULL
      AND link_id IS NULL
      AND resolution_code IS NULL
      AND resolved_at IS NULL
    ) OR (
      state = 'linked'
      AND proposal_id IS NOT NULL
      AND resolved_case_id IS NOT NULL
      AND conflict_case_id IS NULL
      AND conflict_client_id IS NULL
      AND resolution_code IN ('strong_proposal_linked', 'existing_same_case_link')
      AND resolved_at IS NOT NULL
    ) OR (
      state = 'not_linked'
      AND conflict_case_id IS NULL
      AND conflict_client_id IS NULL
      AND link_id IS NULL
      AND resolution_code IN (
        'no_strong_proposal',
        'proposal_not_strong',
        'proposal_not_unique',
        'analysis_run_not_unique',
        'proposal_state_invalid',
        'trusted_envelope_invalid'
      )
      AND resolved_at IS NOT NULL
    ) OR (
      state = 'conflict'
      AND proposal_id IS NOT NULL
      AND resolved_case_id IS NOT NULL
      AND num_nonnulls(conflict_case_id, conflict_client_id) = 1
      AND link_id IS NULL
      AND resolution_code = 'thread_linked_to_other_context'
      AND resolved_at IS NOT NULL
    )
  ),
  CONSTRAINT mail_bank_agent_thread_link_jobs_connection_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    connection_id
  ) REFERENCES public.mail_connections (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_thread_link_jobs_intake_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id
  ) REFERENCES public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_thread_link_jobs_proposal_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id,
    proposal_id
  ) REFERENCES public.mail_bank_agent_match_proposals (
    organization_id,
    owner_user_id,
    intake_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_thread_link_jobs_link_fkey FOREIGN KEY (link_id)
    REFERENCES public.mail_context_thread_links (id) ON DELETE SET NULL
);

CREATE INDEX mail_bank_agent_thread_link_jobs_thread_idx
  ON private.mail_bank_agent_thread_link_jobs (
    organization_id,
    owner_user_id,
    connection_id,
    thread_key_hash,
    state
  );

CREATE INDEX mail_bank_agent_thread_link_jobs_linked_link_idx
  ON private.mail_bank_agent_thread_link_jobs (link_id)
  WHERE state = 'linked' AND link_id IS NOT NULL;

CREATE TRIGGER mail_bank_agent_thread_link_jobs_set_updated_at
  BEFORE UPDATE ON private.mail_bank_agent_thread_link_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE private.mail_bank_agent_thread_link_jobs IS
  'Durable, server-only intent and provenance ledger for automatic mailbox-thread context links. It stores only opaque provider references and controlled decisions.';

REVOKE ALL ON TABLE private.mail_bank_agent_thread_link_jobs
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.mail_bank_agent_thread_link_jobs
  TO openexpert_owner;

CREATE FUNCTION private.require_bank_mail_agent_ingress_claims(
  p_organization_id uuid,
  p_connection_id uuid,
  p_mailbox_owner_user_id uuid,
  p_provider text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  claims_value jsonb;
  thread_key_hash_value text;
  thread_reference_value text;
  has_custom_ingress_claim boolean;
BEGIN
  IF claims_text IS NULL THEN
    RETURN jsonb_build_object(
      'legacy', true,
      'dkimAligned', false
    );
  END IF;

  BEGIN
    claims_value := claims_text::jsonb;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'bank_mail_agent_ingress_claims_invalid'
        USING errcode = '42501';
  END;

  thread_key_hash_value := claims_value ->> 'threadKeySha256';
  thread_reference_value := claims_value ->> 'threadReference';
  has_custom_ingress_claim := claims_value ?| ARRAY[
    'source',
    'serviceId',
    'preset',
    'organizationId',
    'connectionId',
    'mailboxOwnerUserId',
    'provider',
    'threadKeySha256',
    'threadReference',
    'dkimAligned'
  ]::text[];

  -- Rollout/rollback compatibility for the pre-0085 CRM backend token. An
  -- entirely unscoped legacy token may only use the old strict-DMARC path and
  -- never registers a job or activates the OpenExpert DKIM exception. Once
  -- any custom ingress claim is present, the complete signed scope is required.
  IF NOT has_custom_ingress_claim THEN
    IF claims_value ->> 'role' IS DISTINCT FROM 'openexpert_service' THEN
      RAISE EXCEPTION 'bank_mail_agent_ingress_claims_invalid'
        USING errcode = '42501';
    END IF;
    RETURN jsonb_build_object(
      'legacy', true,
      'dkimAligned', false
    );
  END IF;

  IF jsonb_typeof(claims_value) IS DISTINCT FROM 'object'
    OR claims_value ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR claims_value ->> 'source' IS DISTINCT FROM 'crm-bank-mail-ingress-v1'
    OR claims_value ->> 'serviceId' IS DISTINCT FROM 'openexpert-crm-bank-mail-ingestion'
    OR claims_value ->> 'preset' IS DISTINCT FROM 'bank-mail-intake'
    OR claims_value ->> 'organizationId' IS DISTINCT FROM p_organization_id::text
    OR claims_value ->> 'connectionId' IS DISTINCT FROM p_connection_id::text
    OR claims_value ->> 'mailboxOwnerUserId' IS DISTINCT FROM p_mailbox_owner_user_id::text
    OR claims_value ->> 'provider' IS DISTINCT FROM p_provider
    OR thread_key_hash_value IS NULL
    OR thread_key_hash_value !~ '^[0-9a-f]{64}$'
    OR thread_reference_value IS NULL
    OR thread_reference_value <> btrim(thread_reference_value)
    OR char_length(thread_reference_value) NOT BETWEEN 1 AND 4096
    OR thread_reference_value ~ '[[:cntrl:]]'
    OR jsonb_typeof(claims_value -> 'dkimAligned') IS DISTINCT FROM 'boolean'
  THEN
    RAISE EXCEPTION 'bank_mail_agent_ingress_claims_invalid'
      USING errcode = '42501';
  END IF;

  RETURN jsonb_build_object(
    'legacy', false,
    'threadKeySha256', thread_key_hash_value,
    'threadReference', thread_reference_value,
    'dkimAligned', (claims_value ->> 'dkimAligned')::boolean
  );
END;
$$;

REVOKE ALL ON FUNCTION private.require_bank_mail_agent_ingress_claims(
  uuid, uuid, uuid, text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.require_bank_mail_agent_ingress_claims(
  uuid, uuid, uuid, text
) TO openexpert_owner;

-- Preserve the cached bind RPC while allowing the EVE session-start hook to
-- durably bind the server-created session before the model can propose. The
-- hook path is authorized by a separate short-lived, exact-scope backend JWT.
CREATE OR REPLACE FUNCTION public.bind_bank_mail_agent_run_session(
  p_run_id uuid,
  p_lease_token text,
  p_eve_session_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  run_row public.mail_bank_agent_analysis_runs%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  lease_row private.mail_bank_agent_analysis_leases%rowtype;
  session_row public.mail_bank_agent_run_sessions%rowtype;
  jwt_claims jsonb := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
  supplied_lease_token_sha256 text;
  eve_session_id_sha256_value text;
  bound_now timestamptz := clock_timestamp();
  replayed boolean := false;
  eve_self_bind boolean := false;
BEGIN
  IF p_run_id IS NULL
    OR p_lease_token IS NULL
    OR p_lease_token !~ '^[0-9a-f]{64}$'
    OR p_eve_session_id IS NULL
    OR char_length(p_eve_session_id) NOT BETWEEN 8 AND 256
    OR p_eve_session_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_session_binding'
      USING errcode = '22023';
  END IF;

  SELECT run.*
  INTO run_row
  FROM public.mail_bank_agent_analysis_runs AS run
  WHERE run.id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_run_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = run_row.intake_id
    AND intake.organization_id = run_row.organization_id
    AND intake.owner_user_id = run_row.owner_user_id;

  eve_self_bind := p_lease_token =
      'fe40bb62a8cd06ddce32f56c9e2434b44da8506f67b6eca5fc61ea205db0dc35'
    OR coalesce(
      jwt_claims ->> 'source' = 'bank-mail-eve-session-bind-v1',
      false
    )
    OR jwt_claims ?| ARRAY[
      'intakeId',
      'analysisRunId',
      'eveSessionId'
    ]::text[];

  -- Any attempt to use the sentinel or the unique self-bind claims enters the
  -- strict hook branch. Partial/mixed scope cannot fall back to lease auth.
  IF eve_self_bind IS TRUE AND (
    p_lease_token IS DISTINCT FROM
      'fe40bb62a8cd06ddce32f56c9e2434b44da8506f67b6eca5fc61ea205db0dc35'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'bank-mail-eve-session-bind-v1'
    OR jwt_claims ->> 'serviceId' IS DISTINCT FROM 'openexpert-bank-mail-eve-agent'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-session-bind'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM run_row.organization_id::text
    OR jwt_claims ->> 'intakeId' IS DISTINCT FROM run_row.intake_id::text
    OR jwt_claims ->> 'analysisRunId' IS DISTINCT FROM run_row.id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM intake_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM run_row.owner_user_id::text
    OR jwt_claims ->> 'eveSessionId' IS DISTINCT FROM p_eve_session_id
    OR intake_row.connection_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.mail_connections AS connection
      WHERE connection.organization_id = run_row.organization_id
        AND connection.owner_user_id = run_row.owner_user_id
        AND connection.id = intake_row.connection_id
        AND connection.provider = intake_row.provider
        AND connection.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'bank_mail_agent_eve_session_bind_claims_invalid'
      USING errcode = '42501';
  END IF;

  SELECT lease.*
  INTO lease_row
  FROM private.mail_bank_agent_analysis_leases AS lease
  WHERE lease.analysis_run_id = run_row.id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_run_lease_not_found'
      USING errcode = 'P0002';
  END IF;

  supplied_lease_token_sha256 := encode(
    extensions.digest(convert_to(p_lease_token, 'utf8'), 'sha256'),
    'hex'
  );
  eve_session_id_sha256_value := encode(
    extensions.digest(convert_to(p_eve_session_id, 'utf8'), 'sha256'),
    'hex'
  );

  SELECT binding.*
  INTO session_row
  FROM public.mail_bank_agent_run_sessions AS binding
  WHERE binding.analysis_run_id = p_run_id;

  IF eve_self_bind IS NOT TRUE
    AND lease_row.lease_token_sha256 IS DISTINCT FROM supplied_lease_token_sha256
  THEN
    RAISE EXCEPTION 'bank_mail_agent_run_lease_invalid'
      USING errcode = '42501';
  END IF;

  IF session_row.analysis_run_id IS NOT NULL THEN
    IF session_row.eve_session_id IS DISTINCT FROM p_eve_session_id THEN
      RAISE EXCEPTION 'bank_mail_agent_run_session_already_bound'
        USING errcode = '23505';
    END IF;
    replayed := true;
  ELSE
    IF eve_self_bind IS NOT TRUE AND lease_row.lease_expires_at <= bound_now THEN
      RAISE EXCEPTION 'bank_mail_agent_run_lease_expired'
        USING errcode = '55000';
    END IF;

    INSERT INTO public.mail_bank_agent_run_sessions (
      analysis_run_id,
      organization_id,
      owner_user_id,
      intake_id,
      eve_session_id,
      eve_session_id_sha256,
      bound_at
    ) VALUES (
      run_row.id,
      run_row.organization_id,
      run_row.owner_user_id,
      run_row.intake_id,
      p_eve_session_id,
      eve_session_id_sha256_value,
      bound_now
    )
    RETURNING * INTO session_row;

    UPDATE private.mail_bank_agent_analysis_leases AS lease
    SET state = CASE
          WHEN lease.state IN ('completed', 'failed') THEN lease.state
          ELSE 'session_bound'
        END,
        updated_at = bound_now
    WHERE lease.analysis_run_id = run_row.id;

    INSERT INTO public.mail_bank_agent_events (
      organization_id,
      owner_user_id,
      intake_id,
      analysis_run_id,
      event_key_sha256,
      event_type,
      reason_codes,
      occurred_at
    ) VALUES (
      run_row.organization_id,
      run_row.owner_user_id,
      run_row.intake_id,
      run_row.id,
      encode(
        extensions.digest(
          convert_to(
            run_row.run_key_sha256 || chr(31)
              || 'analysis_session_bound' || chr(31)
              || eve_session_id_sha256_value,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      ),
      'analysis_session_bound',
      ARRAY[]::text[],
      bound_now
    );
  END IF;

  RETURN jsonb_build_object(
    'runId', run_row.id,
    'state', CASE
      WHEN lease_row.state IN ('completed', 'failed') THEN lease_row.state
      ELSE 'session_bound'
    END,
    'sessionId', session_row.eve_session_id,
    'boundAt', session_row.bound_at,
    'replayed', replayed
  );
END;
$$;

COMMENT ON FUNCTION public.bind_bank_mail_agent_run_session(uuid, text, text) IS
  'Binds one immutable EVE session either with the winning CRM lease or with the exact signed session-start hook scope and fixed non-secret sentinel.';


CREATE FUNCTION private.finalize_bank_mail_agent_thread_link(p_intake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_thread_link_jobs%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  identity_row public.mortgage_bank_email_identities%rowtype;
  proposal_row public.mail_bank_agent_match_proposals%rowtype;
  run_row public.mail_bank_agent_analysis_runs%rowtype;
  existing_link_row public.mail_context_thread_links%rowtype;
  conflicting_link_row public.mail_context_thread_links%rowtype;
  bank_slug_value text;
  bank_is_mock_value boolean;
  proposal_count integer;
  run_count integer;
  session_bound boolean;
  trusted_envelope boolean;
  resolved_now timestamptz := clock_timestamp();
BEGIN
  IF p_intake_id IS NULL THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_thread_link_intake'
      USING errcode = '22023';
  END IF;

  -- The bilateral deferred guard below deliberately re-checks committed
  -- thread context after a concurrent writer releases the advisory lock.
  -- PostgreSQL's production/Data API default gives each trigger query a fresh
  -- READ COMMITTED snapshot; fail closed if a caller selects an isolation
  -- level whose transaction-wide snapshot could hide that committed writer.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'bank_mail_thread_link_requires_read_committed'
      USING errcode = '25001';
  END IF;

  SELECT job.*
  INTO job_row
  FROM private.mail_bank_agent_thread_link_jobs AS job
  WHERE job.intake_id = p_intake_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'no_intent');
  END IF;
  IF job_row.state <> 'pending' THEN
    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'caseId', job_row.resolved_case_id,
      'conflictCaseId', job_row.conflict_case_id,
      'conflictClientId', job_row.conflict_client_id,
      'linkId', job_row.link_id
    );
  END IF;

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = job_row.intake_id;

  SELECT identity.*
  INTO identity_row
  FROM public.mortgage_bank_email_identities AS identity
  WHERE identity.id = intake_row.bank_email_identity_id
  FOR SHARE;

  IF identity_row.id IS NOT NULL THEN
    SELECT bank.slug, bank.is_mock
    INTO bank_slug_value, bank_is_mock_value
    FROM public.mortgage_banks AS bank
    WHERE bank.id = identity_row.bank_id;
  END IF;

  trusted_envelope := intake_row.identity_verdict = 'trusted_bank'
    AND NOT intake_row.reply_to_mismatch
    AND identity_row.id IS NOT NULL
    AND (
      (
        intake_row.authentication_policy_applied = 'dmarc_aligned'
        AND intake_row.authentication_status = 'passed'
        AND intake_row.dmarc_aligned
      )
      OR (
        intake_row.authentication_policy_applied = 'openexpert_mock_dkim_aligned'
        AND intake_row.dkim_aligned
        -- Current policy is a revocable kill switch for pending/replayed
        -- exception jobs. The intake's pinned policy remains unchanged audit
        -- history, while disabling the identity prevents any future link.
        AND identity_row.authentication_policy = 'openexpert_mock_dkim_aligned'
        AND identity_row.sender_domain = 'openexpert.app'
        AND NOT identity_row.allow_subdomains
        AND identity_row.is_active
        AND bank_slug_value = 'openexpert-bank'
        AND bank_is_mock_value
      )
    );

  IF NOT trusted_envelope THEN
    UPDATE private.mail_bank_agent_thread_link_jobs AS job
    SET state = 'not_linked',
        resolution_code = 'trusted_envelope_invalid',
        resolved_at = resolved_now
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;

    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code
    );
  END IF;

  SELECT count(*)::integer
  INTO proposal_count
  FROM public.mail_bank_agent_match_proposals AS proposal
  WHERE proposal.organization_id = job_row.organization_id
    AND proposal.owner_user_id = job_row.owner_user_id
    AND proposal.intake_id = job_row.intake_id;

  IF proposal_count = 0 THEN
    IF intake_row.status IN (
      'review_required',
      'no_match',
      'not_bank_mail',
      'security_rejected',
      'failed'
    ) THEN
      UPDATE private.mail_bank_agent_thread_link_jobs AS job
      SET state = 'not_linked',
          resolution_code = 'no_strong_proposal',
          resolved_at = resolved_now
      WHERE job.id = job_row.id
      RETURNING * INTO job_row;
    END IF;

    RETURN jsonb_build_object('state', 'pending');
  END IF;

  IF proposal_count <> 1 THEN
    UPDATE private.mail_bank_agent_thread_link_jobs AS job
    SET state = 'not_linked',
        resolution_code = 'proposal_not_unique',
        resolved_at = resolved_now
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;

    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code
    );
  END IF;

  SELECT proposal.*
  INTO STRICT proposal_row
  FROM public.mail_bank_agent_match_proposals AS proposal
  WHERE proposal.organization_id = job_row.organization_id
    AND proposal.owner_user_id = job_row.owner_user_id
    AND proposal.intake_id = job_row.intake_id;

  IF proposal_row.classification <> 'strong_candidate'
    OR proposal_row.review_status <> 'review_required'
    OR cardinality(proposal_row.contradiction_codes) <> 0
  THEN
    UPDATE private.mail_bank_agent_thread_link_jobs AS job
    SET state = 'not_linked',
        proposal_id = proposal_row.id,
        resolved_case_id = proposal_row.case_id,
        resolution_code = 'proposal_not_strong',
        resolved_at = resolved_now
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;

    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'caseId', job_row.resolved_case_id
    );
  END IF;

  IF intake_row.status <> 'review_required'
    OR intake_row.finalized_at IS NULL
  THEN
    IF intake_row.status IN ('claimed', 'analyzing') THEN
      RETURN jsonb_build_object('state', 'pending');
    END IF;

    UPDATE private.mail_bank_agent_thread_link_jobs AS job
    SET state = 'not_linked',
        proposal_id = proposal_row.id,
        resolved_case_id = proposal_row.case_id,
        resolution_code = 'proposal_state_invalid',
        resolved_at = resolved_now
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;

    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'caseId', job_row.resolved_case_id
    );
  END IF;

  SELECT count(*)::integer
  INTO run_count
  FROM public.mail_bank_agent_analysis_runs AS run
  WHERE run.organization_id = job_row.organization_id
    AND run.owner_user_id = job_row.owner_user_id
    AND run.intake_id = job_row.intake_id;

  SELECT run.*
  INTO run_row
  FROM public.mail_bank_agent_analysis_runs AS run
  WHERE run.id = proposal_row.analysis_run_id
    AND run.organization_id = job_row.organization_id
    AND run.owner_user_id = job_row.owner_user_id
    AND run.intake_id = job_row.intake_id;

  IF run_count <> 1
    OR run_row.id IS NULL
    OR run_row.source_sha256 IS DISTINCT FROM intake_row.source_sha256
  THEN
    UPDATE private.mail_bank_agent_thread_link_jobs AS job
    SET state = 'not_linked',
        proposal_id = proposal_row.id,
        resolved_case_id = proposal_row.case_id,
        resolution_code = 'analysis_run_not_unique',
        resolved_at = resolved_now
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;

    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'caseId', job_row.resolved_case_id
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.mail_bank_agent_run_sessions AS binding
    WHERE binding.analysis_run_id = run_row.id
      AND binding.organization_id = job_row.organization_id
      AND binding.owner_user_id = job_row.owner_user_id
      AND binding.intake_id = job_row.intake_id
  )
  INTO session_bound;

  -- A proposal emitted before its EVE session binding remains pending. The
  -- binding trigger below retries this same idempotent finalizer.
  IF NOT session_bound THEN
    RETURN jsonb_build_object('state', 'pending');
  END IF;

  -- Manual/contextual writers take the same advisory lock through the guard
  -- trigger below. This makes the absence check and automatic insert atomic
  -- even when the first link for a thread is being created concurrently.
  -- Lock the exact FK parents first, matching the BEFORE-link trigger order.
  -- The automatic INSERT's trigger is too late to establish this ordering
  -- because this finalizer already owns the job row before it reaches here.
  PERFORM 1
  FROM public.mail_connections AS connection
  WHERE connection.organization_id = job_row.organization_id
    AND connection.owner_user_id = job_row.owner_user_id
    AND connection.id = job_row.connection_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_thread_link_connection_missing'
      USING errcode = '23503';
  END IF;

  PERFORM 1
  FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = job_row.organization_id
    AND crm_case.id = proposal_row.case_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_thread_link_case_missing'
      USING errcode = '23503';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert/bank-mail-thread-link/v1' || chr(31)
        || job_row.organization_id::text || chr(31)
        || job_row.owner_user_id::text || chr(31)
        || job_row.connection_id::text || chr(31)
        || job_row.thread_key_hash,
      0
    )
  );

  SELECT link.*
  INTO conflicting_link_row
  FROM public.mail_context_thread_links AS link
  WHERE link.organization_id = job_row.organization_id
    AND link.owner_user_id = job_row.owner_user_id
    AND link.connection_id = job_row.connection_id
    AND link.thread_key_hash = job_row.thread_key_hash
    AND (
      link.client_id IS NOT NULL
      OR (link.case_id IS NOT NULL AND link.case_id <> proposal_row.case_id)
    )
  ORDER BY link.created_at, link.id
  LIMIT 1;

  IF conflicting_link_row.id IS NOT NULL THEN
    UPDATE private.mail_bank_agent_thread_link_jobs AS job
    SET state = 'conflict',
        proposal_id = proposal_row.id,
        resolved_case_id = proposal_row.case_id,
        conflict_case_id = conflicting_link_row.case_id,
        conflict_client_id = conflicting_link_row.client_id,
        resolution_code = 'thread_linked_to_other_context',
        resolved_at = resolved_now
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;

    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'caseId', job_row.resolved_case_id,
      'conflictCaseId', job_row.conflict_case_id,
      'conflictClientId', job_row.conflict_client_id
    );
  END IF;

  SELECT link.*
  INTO existing_link_row
  FROM public.mail_context_thread_links AS link
  WHERE link.organization_id = job_row.organization_id
    AND link.owner_user_id = job_row.owner_user_id
    AND link.connection_id = job_row.connection_id
    AND link.thread_key_hash = job_row.thread_key_hash
    AND link.case_id = proposal_row.case_id
    AND link.client_id IS NULL
  ORDER BY
    CASE link.link_source
      WHEN 'manual' THEN 0
      WHEN 'sent_from_context' THEN 1
      ELSE 2
    END,
    link.created_at,
    link.id
  LIMIT 1;

  IF existing_link_row.id IS NOT NULL THEN
    UPDATE private.mail_bank_agent_thread_link_jobs AS job
    SET state = 'linked',
        proposal_id = proposal_row.id,
        resolved_case_id = proposal_row.case_id,
        link_id = existing_link_row.id,
        resolution_code = 'existing_same_case_link',
        resolved_at = resolved_now
    WHERE job.id = job_row.id
    RETURNING * INTO job_row;

    RETURN jsonb_build_object(
      'state', job_row.state,
      'resolutionCode', job_row.resolution_code,
      'caseId', job_row.resolved_case_id,
      'linkId', job_row.link_id
    );
  END IF;

  INSERT INTO public.mail_context_thread_links (
    organization_id,
    owner_user_id,
    connection_id,
    thread_key_hash,
    thread_reference,
    client_id,
    case_id,
    link_source
  ) VALUES (
    job_row.organization_id,
    job_row.owner_user_id,
    job_row.connection_id,
    job_row.thread_key_hash,
    job_row.thread_reference,
    NULL,
    proposal_row.case_id,
    'bank_mail_agent'
  )
  ON CONFLICT ON CONSTRAINT mail_context_thread_links_scope_unique DO NOTHING
  RETURNING * INTO existing_link_row;

  IF existing_link_row.id IS NULL THEN
    SELECT link.*
    INTO STRICT existing_link_row
    FROM public.mail_context_thread_links AS link
    WHERE link.organization_id = job_row.organization_id
      AND link.owner_user_id = job_row.owner_user_id
      AND link.connection_id = job_row.connection_id
      AND link.thread_key_hash = job_row.thread_key_hash
      AND link.case_id = proposal_row.case_id
      AND link.client_id IS NULL
    ORDER BY link.created_at, link.id
    LIMIT 1;
  END IF;

  UPDATE private.mail_bank_agent_thread_link_jobs AS job
  SET state = 'linked',
      proposal_id = proposal_row.id,
      resolved_case_id = proposal_row.case_id,
      link_id = existing_link_row.id,
      resolution_code = 'strong_proposal_linked',
      resolved_at = resolved_now
  WHERE job.id = job_row.id
  RETURNING * INTO job_row;

  RETURN jsonb_build_object(
    'state', job_row.state,
    'resolutionCode', job_row.resolution_code,
    'caseId', job_row.resolved_case_id,
    'linkId', job_row.link_id
  );
END;
$$;

REVOKE ALL ON FUNCTION private.finalize_bank_mail_agent_thread_link(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.finalize_bank_mail_agent_thread_link(uuid)
  TO openexpert_owner;

CREATE FUNCTION private.register_bank_mail_agent_thread_link_job(
  p_intake_id uuid,
  p_thread_key_hash text,
  p_thread_reference text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_row public.mail_bank_agent_intakes%rowtype;
  job_row private.mail_bank_agent_thread_link_jobs%rowtype;
  replayed boolean := false;
BEGIN
  IF p_intake_id IS NULL
    OR p_thread_key_hash IS NULL
    OR p_thread_key_hash !~ '^[0-9a-f]{64}$'
    OR p_thread_reference IS NULL
    OR p_thread_reference <> btrim(p_thread_reference)
    OR char_length(p_thread_reference) NOT BETWEEN 1 AND 4096
    OR p_thread_reference ~ '[[:cntrl:]]'
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_thread_link_job'
      USING errcode = '22023';
  END IF;

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = p_intake_id
  FOR UPDATE;

  -- Rejected envelopes never create durable link intent. The signed claims
  -- were still validated by the public claim RPC before reaching this helper.
  IF intake_row.identity_verdict <> 'trusted_bank' THEN
    RETURN jsonb_build_object('state', 'not_registered');
  END IF;
  IF intake_row.connection_id IS NULL THEN
    RAISE EXCEPTION 'bank_mail_agent_thread_link_connection_missing'
      USING errcode = '55000';
  END IF;

  INSERT INTO private.mail_bank_agent_thread_link_jobs (
    organization_id,
    owner_user_id,
    connection_id,
    intake_id,
    thread_key_hash,
    thread_reference
  ) VALUES (
    intake_row.organization_id,
    intake_row.owner_user_id,
    intake_row.connection_id,
    intake_row.id,
    p_thread_key_hash,
    p_thread_reference
  )
  ON CONFLICT ON CONSTRAINT mail_bank_agent_thread_link_jobs_intake_key DO NOTHING
  RETURNING * INTO job_row;

  IF job_row.id IS NULL THEN
    replayed := true;
    SELECT job.*
    INTO STRICT job_row
    FROM private.mail_bank_agent_thread_link_jobs AS job
    WHERE job.intake_id = intake_row.id
    FOR UPDATE;

    IF job_row.organization_id IS DISTINCT FROM intake_row.organization_id
      OR job_row.owner_user_id IS DISTINCT FROM intake_row.owner_user_id
      OR job_row.connection_id IS DISTINCT FROM intake_row.connection_id
      OR job_row.thread_key_hash IS DISTINCT FROM p_thread_key_hash
      OR job_row.thread_reference IS DISTINCT FROM p_thread_reference
    THEN
      RAISE EXCEPTION 'bank_mail_agent_thread_link_job_replay_conflict'
        USING errcode = '23505';
    END IF;
  END IF;

  RETURN private.finalize_bank_mail_agent_thread_link(intake_row.id)
    || jsonb_build_object('jobId', job_row.id, 'replayed', replayed);
END;
$$;

REVOKE ALL ON FUNCTION private.register_bank_mail_agent_thread_link_job(
  uuid, text, text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.register_bank_mail_agent_thread_link_job(
  uuid, text, text
) TO openexpert_owner;

-- Every context link participates in the same serialization key. The trigger
-- is bilateral: after waiting for a concurrent transaction it checks both a
-- new automatic link and any already-committed automatic link. At READ
-- COMMITTED this makes either commit order fail closed without taking tuple
-- locks. UPDATE is handled separately and may only refresh thread_reference,
-- so it never waits on the advisory key after locking an existing tuple.
CREATE FUNCTION private.keep_bank_mail_agent_thread_link_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Upserts that selected a stale manual source must not downgrade a link an
  -- automatic transaction committed first. Preserve the canonical stored
  -- audit origin transparently, then reject every identity/context retarget.
  NEW.link_source := OLD.link_source;

  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.connection_id IS DISTINCT FROM OLD.connection_id
    OR NEW.thread_key_hash IS DISTINCT FROM OLD.thread_key_hash
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.case_id IS DISTINCT FROM OLD.case_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'bank_mail_agent_thread_link_identity_immutable'
      USING errcode = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.keep_bank_mail_agent_thread_link_identity()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.keep_bank_mail_agent_thread_link_identity()
  TO openexpert_owner;

CREATE FUNCTION private.guard_bank_mail_agent_thread_case_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  new_lock_key bigint;
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'bank_mail_thread_link_requires_read_committed'
      USING errcode = '25001';
  END IF;

  -- Match the existing proposal path's parent-row lock order before taking
  -- the thread advisory lock. The later FK checks request compatible KEY
  -- SHARE locks, while a concurrent proposal's FOR UPDATE simply completes
  -- before this writer can own the advisory key.
  PERFORM 1
  FROM public.mail_connections AS connection
  WHERE connection.organization_id = NEW.organization_id
    AND connection.owner_user_id = NEW.owner_user_id
    AND connection.id = NEW.connection_id
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_thread_link_connection_missing'
      USING errcode = '23503';
  END IF;

  IF NEW.case_id IS NOT NULL THEN
    PERFORM 1
    FROM public.crm_cases AS crm_case
    WHERE crm_case.organization_id = NEW.organization_id
      AND crm_case.id = NEW.case_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_mail_agent_thread_link_case_missing'
        USING errcode = '23503';
    END IF;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    PERFORM 1
    FROM public.crm_clients AS client
    WHERE client.organization_id = NEW.organization_id
      AND client.id = NEW.client_id
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_mail_agent_thread_link_client_missing'
        USING errcode = '23503';
    END IF;
  END IF;

  new_lock_key := pg_catalog.hashtextextended(
    'openexpert/bank-mail-thread-link/v1' || chr(31)
      || NEW.organization_id::text || chr(31)
      || NEW.owner_user_id::text || chr(31)
      || NEW.connection_id::text || chr(31)
      || NEW.thread_key_hash,
    0
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(new_lock_key);

  IF EXISTS (
    SELECT 1
    FROM public.mail_context_thread_links AS existing
    WHERE existing.organization_id = NEW.organization_id
      AND existing.owner_user_id = NEW.owner_user_id
      AND existing.connection_id = NEW.connection_id
      AND existing.thread_key_hash = NEW.thread_key_hash
      AND existing.id IS DISTINCT FROM NEW.id
      AND (
        existing.case_id IS DISTINCT FROM NEW.case_id
        OR existing.client_id IS DISTINCT FROM NEW.client_id
      )
      AND (
        NEW.link_source = 'bank_mail_agent'
        OR existing.link_source = 'bank_mail_agent'
        OR EXISTS (
          SELECT 1
          FROM private.mail_bank_agent_thread_link_jobs AS linked_job
          WHERE linked_job.state = 'linked'
            AND linked_job.link_id IN (NEW.id, existing.id)
        )
      )
  ) THEN
    RAISE EXCEPTION 'bank_mail_agent_thread_link_context_conflict'
      USING errcode = '23505';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bank_mail_agent_thread_case_link()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.guard_bank_mail_agent_thread_case_link()
  TO openexpert_owner;

-- The BEFORE trigger is the serialization/linearization point. In particular,
-- it prevents an invisible same-case tuple from making the finalizer wait on
-- a unique check while its transaction owns the advisory lock.
CREATE TRIGGER mail_context_thread_links_lock_bank_agent_case
  BEFORE INSERT ON public.mail_context_thread_links
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_agent_thread_case_link();

-- An UPDATE locks its tuple before row triggers run, so it must never wait for
-- the thread advisory key. Identity/source are immutable; reference refresh is
-- conflict-neutral and can proceed concurrently with a same-scope upsert.
CREATE TRIGGER mail_context_thread_links_keep_bank_agent_identity
  BEFORE UPDATE ON public.mail_context_thread_links
  FOR EACH ROW EXECUTE FUNCTION private.keep_bank_mail_agent_thread_link_identity();

-- The deferred pass is the bilateral validation backstop after any INSERT
-- wait and sees the commit winner through a fresh READ COMMITTED snapshot.
CREATE CONSTRAINT TRIGGER mail_context_thread_links_guard_bank_agent_case
  AFTER INSERT ON public.mail_context_thread_links
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_agent_thread_case_link();

CREATE FUNCTION private.finalize_bank_mail_agent_thread_link_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_id_value uuid;
BEGIN
  IF TG_TABLE_NAME = 'mail_bank_agent_intakes' THEN
    intake_id_value := NEW.id;
  ELSE
    intake_id_value := NEW.intake_id;
  END IF;

  PERFORM private.finalize_bank_mail_agent_thread_link(intake_id_value);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.finalize_bank_mail_agent_thread_link_trigger()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.finalize_bank_mail_agent_thread_link_trigger()
  TO openexpert_owner;

CREATE CONSTRAINT TRIGGER mail_bank_agent_proposals_finalize_thread_link
  AFTER INSERT ON public.mail_bank_agent_match_proposals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.finalize_bank_mail_agent_thread_link_trigger();

CREATE TRIGGER mail_bank_agent_sessions_finalize_thread_link
  AFTER INSERT ON public.mail_bank_agent_run_sessions
  FOR EACH ROW EXECUTE FUNCTION private.finalize_bank_mail_agent_thread_link_trigger();

CREATE CONSTRAINT TRIGGER mail_bank_agent_intakes_finalize_thread_link
  AFTER UPDATE ON public.mail_bank_agent_intakes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION private.finalize_bank_mail_agent_thread_link_trigger();

-- Preserve the established public signature/OID so the cached Data API route
-- remains callable. Thread intent and DKIM arrive only through verified JWT
-- claims and are never accepted as client-controlled RPC parameters.
CREATE OR REPLACE FUNCTION public.claim_bank_mail_agent_intake(
  p_organization_id uuid,
  p_connection_id uuid,
  p_mailbox_owner_user_id uuid,
  p_provider text,
  p_provider_message_id_hash text,
  p_source_sha256 text,
  p_sender_domain text,
  p_authentication_status text,
  p_dmarc_aligned boolean,
  p_reply_to_mismatch boolean,
  p_bank_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  identity_row public.mortgage_bank_email_identities%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  ingress_claims jsonb;
  normalized_sender_domain text := lower(btrim(coalesce(p_sender_domain, '')));
  sender_domain_sha256_value text;
  intake_key_sha256_value text;
  identity_verdict_value text;
  authentication_policy_value text := 'dmarc_aligned'::text;
  status_value text;
  reason_codes_value text[] := ARRAY[]::text[];
  identity_bank_slug text;
  identity_bank_is_mock boolean;
  legacy_ingress boolean;
  dkim_aligned_value boolean;
  required_alignment_passed boolean;
  mock_dkim_policy_scope_valid boolean;
  claimed_now timestamptz := clock_timestamp();
  replayed boolean := false;
BEGIN
  IF p_organization_id IS NULL
    OR p_connection_id IS NULL
    OR p_mailbox_owner_user_id IS NULL
    OR p_provider NOT IN ('google', 'microsoft', 'imap')
    OR p_provider_message_id_hash IS NULL
    OR p_provider_message_id_hash !~ '^[0-9a-f]{64}$'
    OR p_source_sha256 IS NULL
    OR p_source_sha256 !~ '^[0-9a-f]{64}$'
    OR p_authentication_status NOT IN ('passed', 'failed', 'indeterminate')
    OR p_dmarc_aligned IS NULL
    OR p_reply_to_mismatch IS NULL
    OR char_length(normalized_sender_domain) NOT BETWEEN 3 AND 253
    OR normalized_sender_domain !~ E'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_intake_claim'
      USING errcode = '22023';
  END IF;

  ingress_claims := private.require_bank_mail_agent_ingress_claims(
    p_organization_id,
    p_connection_id,
    p_mailbox_owner_user_id,
    p_provider
  );
  legacy_ingress := coalesce((ingress_claims ->> 'legacy')::boolean, false);
  dkim_aligned_value := (ingress_claims ->> 'dkimAligned')::boolean;

  -- The mailbox relation is authoritative. A caller cannot claim an intake
  -- for another tenant/owner or lie about the connection provider.
  PERFORM 1
  FROM public.mail_connections AS connection
  WHERE connection.organization_id = p_organization_id
    AND connection.owner_user_id = p_mailbox_owner_user_id
    AND connection.id = p_connection_id
    AND connection.provider = p_provider
    AND connection.status = 'active'::text
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_mailbox_scope_not_found'
      USING errcode = '42501';
  END IF;

  sender_domain_sha256_value := encode(
    extensions.digest(convert_to(normalized_sender_domain, 'utf8'), 'sha256'),
    'hex'
  );
  intake_key_sha256_value := encode(
    extensions.digest(
      convert_to(
        'bank-mail-intake-v1' || chr(31)
          || p_organization_id::text || chr(31)
          || p_mailbox_owner_user_id::text || chr(31)
          || p_connection_id::text || chr(31)
          || p_provider || chr(31)
          || p_provider_message_id_hash,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Replay the originally pinned classification even if policy configuration
  -- is later revised. DKIM is independently compared because it is not an RPC
  -- argument and must not be mutable under the same provider message identity.
  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.organization_id = p_organization_id
    AND intake.owner_user_id = p_mailbox_owner_user_id
    AND intake.connection_id = p_connection_id
    AND intake.provider_message_id_sha256 = p_provider_message_id_hash
  FOR UPDATE;
  IF FOUND THEN
    SELECT identity.*
    INTO identity_row
    FROM public.mortgage_bank_email_identities AS identity
    WHERE identity.id = intake_row.bank_email_identity_id;

    IF identity_row.id IS NOT NULL THEN
      SELECT bank.slug, bank.is_mock
      INTO identity_bank_slug, identity_bank_is_mock
      FROM public.mortgage_banks AS bank
      WHERE bank.id = identity_row.bank_id;
    END IF;

    mock_dkim_policy_scope_valid := CASE
      WHEN intake_row.authentication_policy_applied = 'openexpert_mock_dkim_aligned' THEN (
        identity_row.sender_domain = 'openexpert.app'
        AND NOT identity_row.allow_subdomains
        AND identity_bank_slug = 'openexpert-bank'
        AND identity_bank_is_mock
      )
      ELSE true
    END;

    IF intake_row.provider IS DISTINCT FROM p_provider
      OR intake_row.source_sha256 IS DISTINCT FROM p_source_sha256
      OR intake_row.sender_domain_sha256 IS DISTINCT FROM sender_domain_sha256_value
      OR intake_row.intake_key_sha256 IS DISTINCT FROM intake_key_sha256_value
      OR intake_row.authentication_status IS DISTINCT FROM p_authentication_status
      OR intake_row.dmarc_aligned IS DISTINCT FROM p_dmarc_aligned
      OR (
        intake_row.authentication_policy_applied = 'openexpert_mock_dkim_aligned'
        AND NOT legacy_ingress
        AND intake_row.dkim_aligned IS DISTINCT FROM dkim_aligned_value
      )
      OR intake_row.reply_to_mismatch IS DISTINCT FROM p_reply_to_mismatch
      OR mock_dkim_policy_scope_valid IS DISTINCT FROM true
      OR (p_bank_id IS NOT NULL AND p_bank_id IS DISTINCT FROM identity_row.bank_id)
    THEN
      RAISE EXCEPTION 'bank_mail_agent_provider_message_hash_reused'
        USING errcode = '23505';
    END IF;

    IF NOT legacy_ingress THEN
      PERFORM private.register_bank_mail_agent_thread_link_job(
        intake_row.id,
        ingress_claims ->> 'threadKeySha256',
        ingress_claims ->> 'threadReference'
      );
    END IF;

    RETURN jsonb_build_object(
      'intakeId', intake_row.id,
      'state', intake_row.status,
      'replayed', true,
      'bankId', identity_row.bank_id,
      'identityVerdict', intake_row.identity_verdict,
      'authenticationPolicy', intake_row.authentication_policy_applied,
      'dmarcAligned', intake_row.dmarc_aligned,
      'dkimAligned', intake_row.dkim_aligned,
      'sourceSha256', intake_row.source_sha256,
      'reasonCodes', to_jsonb(intake_row.reason_codes)
    );
  END IF;

  -- The longest configured suffix wins, so an explicitly configured
  -- subdomain safely overrides a broader allow_subdomains entry.
  SELECT identity.*
  INTO identity_row
  FROM public.mortgage_bank_email_identities AS identity
  WHERE identity.is_active
    AND (
      identity.sender_domain = normalized_sender_domain
      OR (
        identity.allow_subdomains
        AND normalized_sender_domain LIKE '%.' || identity.sender_domain
      )
    )
  ORDER BY char_length(identity.sender_domain) DESC, identity.id
  LIMIT 1;

  IF identity_row.id IS NOT NULL THEN
    authentication_policy_value := CASE
      WHEN legacy_ingress THEN 'dmarc_aligned'::text
      ELSE identity_row.authentication_policy
    END;
    SELECT bank.slug, bank.is_mock
    INTO identity_bank_slug, identity_bank_is_mock
    FROM public.mortgage_banks AS bank
    WHERE bank.id = identity_row.bank_id;
  END IF;

  mock_dkim_policy_scope_valid :=
    authentication_policy_value <> 'openexpert_mock_dkim_aligned'
    OR (
      identity_row.id IS NOT NULL
      AND identity_row.sender_domain = 'openexpert.app'
      AND NOT identity_row.allow_subdomains
      AND identity_bank_slug = 'openexpert-bank'
      AND identity_bank_is_mock
    );
  required_alignment_passed := CASE authentication_policy_value
    WHEN 'dmarc_aligned' THEN p_dmarc_aligned
    WHEN 'openexpert_mock_dkim_aligned' THEN
      dkim_aligned_value AND mock_dkim_policy_scope_valid
    ELSE false
  END;

  IF identity_row.id IS NULL THEN
    identity_verdict_value := 'unknown_domain';
    reason_codes_value := ARRAY['unknown_bank_identity']::text[];
  ELSIF p_bank_id IS NOT NULL AND p_bank_id IS DISTINCT FROM identity_row.bank_id THEN
    identity_verdict_value := 'bank_id_mismatch';
    reason_codes_value := ARRAY['bank_identity_mismatch']::text[];
  ELSIF mock_dkim_policy_scope_valid IS DISTINCT FROM true THEN
    identity_verdict_value := 'authentication_policy_invalid';
    reason_codes_value := ARRAY['authentication_policy_invalid']::text[];
  ELSE
    IF p_authentication_status = 'failed' THEN
      reason_codes_value := reason_codes_value || 'authentication_failed'::text;
    ELSIF p_authentication_status = 'indeterminate' THEN
      reason_codes_value := reason_codes_value || 'authentication_indeterminate'::text;
    END IF;
    IF authentication_policy_value = 'dmarc_aligned' AND NOT p_dmarc_aligned THEN
      reason_codes_value := reason_codes_value || 'dmarc_not_aligned'::text;
    ELSIF authentication_policy_value = 'openexpert_mock_dkim_aligned'
      AND NOT dkim_aligned_value
    THEN
      reason_codes_value := reason_codes_value || 'dkim_not_aligned'::text;
    END IF;
    IF p_reply_to_mismatch THEN
      reason_codes_value := reason_codes_value || 'reply_to_mismatch'::text;
    END IF;

    IF NOT p_reply_to_mismatch
      AND (
        (
          authentication_policy_value = 'dmarc_aligned'
          AND p_authentication_status = 'passed'
          AND required_alignment_passed
        )
        OR (
          authentication_policy_value = 'openexpert_mock_dkim_aligned'
          AND required_alignment_passed
        )
      )
    THEN
      identity_verdict_value := 'trusted_bank';
      reason_codes_value := ARRAY['trusted_bank_identity']::text[];
    ELSIF p_authentication_status = 'failed' THEN
      identity_verdict_value := 'authentication_failed';
    ELSIF p_authentication_status = 'indeterminate' THEN
      identity_verdict_value := 'authentication_indeterminate';
    ELSIF authentication_policy_value = 'dmarc_aligned' AND NOT p_dmarc_aligned THEN
      identity_verdict_value := 'dmarc_not_aligned';
    ELSIF authentication_policy_value = 'openexpert_mock_dkim_aligned'
      AND NOT dkim_aligned_value
    THEN
      identity_verdict_value := 'dkim_not_aligned';
    ELSE
      identity_verdict_value := 'reply_to_mismatch';
    END IF;
  END IF;

  status_value := CASE
    WHEN identity_verdict_value = 'trusted_bank' THEN 'claimed'::text
    ELSE 'security_rejected'::text
  END;

  INSERT INTO public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    connection_id,
    bank_email_identity_id,
    provider,
    provider_message_id_sha256,
    source_sha256,
    sender_domain_sha256,
    intake_key_sha256,
    identity_verdict,
    authentication_status,
    dmarc_aligned,
    dkim_aligned,
    authentication_policy_applied,
    reply_to_mismatch,
    status,
    reason_codes,
    claimed_at,
    finalized_at,
    updated_at
  ) VALUES (
    p_organization_id,
    p_mailbox_owner_user_id,
    p_connection_id,
    identity_row.id,
    p_provider,
    p_provider_message_id_hash,
    p_source_sha256,
    sender_domain_sha256_value,
    intake_key_sha256_value,
    identity_verdict_value,
    p_authentication_status,
    p_dmarc_aligned,
    dkim_aligned_value,
    authentication_policy_value,
    p_reply_to_mismatch,
    status_value,
    reason_codes_value,
    claimed_now,
    CASE WHEN status_value = 'security_rejected' THEN claimed_now ELSE NULL END,
    claimed_now
  )
  ON CONFLICT ON CONSTRAINT mail_bank_agent_intakes_ingress_key DO NOTHING
  RETURNING * INTO intake_row;

  IF intake_row.id IS NULL THEN
    replayed := true;
    SELECT intake.*
    INTO STRICT intake_row
    FROM public.mail_bank_agent_intakes AS intake
    WHERE intake.organization_id = p_organization_id
      AND intake.owner_user_id = p_mailbox_owner_user_id
      AND intake.connection_id = p_connection_id
      AND intake.provider_message_id_sha256 = p_provider_message_id_hash
    FOR UPDATE;

    IF intake_row.provider IS DISTINCT FROM p_provider
      OR intake_row.source_sha256 IS DISTINCT FROM p_source_sha256
      OR intake_row.sender_domain_sha256 IS DISTINCT FROM sender_domain_sha256_value
      OR intake_row.intake_key_sha256 IS DISTINCT FROM intake_key_sha256_value
      OR intake_row.bank_email_identity_id IS DISTINCT FROM identity_row.id
      OR intake_row.identity_verdict IS DISTINCT FROM identity_verdict_value
      OR intake_row.authentication_status IS DISTINCT FROM p_authentication_status
      OR intake_row.dmarc_aligned IS DISTINCT FROM p_dmarc_aligned
      OR intake_row.dkim_aligned IS DISTINCT FROM dkim_aligned_value
      OR intake_row.authentication_policy_applied IS DISTINCT FROM authentication_policy_value
      OR intake_row.reply_to_mismatch IS DISTINCT FROM p_reply_to_mismatch
    THEN
      RAISE EXCEPTION 'bank_mail_agent_provider_message_hash_reused'
        USING errcode = '23505';
    END IF;
  ELSE
    INSERT INTO public.mail_bank_agent_events (
      organization_id,
      owner_user_id,
      intake_id,
      event_key_sha256,
      event_type,
      reason_codes,
      occurred_at
    ) VALUES (
      intake_row.organization_id,
      intake_row.owner_user_id,
      intake_row.id,
      encode(
        extensions.digest(
          convert_to(
            intake_row.intake_key_sha256 || chr(31)
              || CASE
                WHEN status_value = 'claimed' THEN 'intake_claimed'
                ELSE 'intake_rejected'
              END,
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      ),
      CASE
        WHEN status_value = 'claimed' THEN 'intake_claimed'
        ELSE 'intake_rejected'
      END,
      reason_codes_value,
      claimed_now
    );
  END IF;

  IF NOT legacy_ingress THEN
    PERFORM private.register_bank_mail_agent_thread_link_job(
      intake_row.id,
      ingress_claims ->> 'threadKeySha256',
      ingress_claims ->> 'threadReference'
    );
  END IF;

  RETURN jsonb_build_object(
    'intakeId', intake_row.id,
    'state', intake_row.status,
    'replayed', replayed,
    'bankId', identity_row.bank_id,
    'identityVerdict', intake_row.identity_verdict,
    'authenticationPolicy', intake_row.authentication_policy_applied,
    'dmarcAligned', intake_row.dmarc_aligned,
    'dkimAligned', intake_row.dkim_aligned,
    'sourceSha256', intake_row.source_sha256,
    'reasonCodes', to_jsonb(intake_row.reason_codes)
  );
END;
$$;

COMMENT ON FUNCTION public.claim_bank_mail_agent_intake(
  uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid
) IS
  'Service-only idempotent ingress claim. Validates signed thread/DKIM claims, pins the exact identity policy, and atomically registers durable thread-link intent without changing the cached RPC signature.';

REVOKE ALL ON FUNCTION public.claim_bank_mail_agent_intake(
  uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_bank_mail_agent_intake(
  uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid
) TO openexpert_service, openexpert_owner;

CREATE OR REPLACE FUNCTION public.get_strong_bank_mail_agent_proposal_case(
  p_intake_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT coalesce(
    (
      SELECT job.resolved_case_id
      FROM private.mail_bank_agent_thread_link_jobs AS job
      JOIN public.mail_context_thread_links AS link
        ON link.id = job.link_id
       AND link.organization_id = job.organization_id
       AND link.owner_user_id = job.owner_user_id
       AND link.connection_id = job.connection_id
       AND link.thread_key_hash = job.thread_key_hash
       AND link.case_id = job.resolved_case_id
       AND link.client_id IS NULL
      WHERE job.intake_id = p_intake_id
        AND job.state = 'linked'
        AND job.resolution_code IN (
          'strong_proposal_linked',
          'existing_same_case_link'
        )
    ),
    (
      -- Migration-first/rollback grace for the pre-0085 CRM worker. Only an
      -- intake created without a durable job can reach this branch, and it
      -- must satisfy the original strict-DMARC contract end to end. Signed
      -- 0085 ingress always has a job, including the mock-DKIM exception.
      SELECT proposal.case_id
      FROM public.mail_bank_agent_intakes AS intake
      JOIN public.mail_bank_agent_match_proposals AS proposal
        ON proposal.organization_id = intake.organization_id
       AND proposal.owner_user_id = intake.owner_user_id
       AND proposal.intake_id = intake.id
      JOIN public.mail_bank_agent_analysis_runs AS run
        ON run.id = proposal.analysis_run_id
       AND run.organization_id = intake.organization_id
       AND run.owner_user_id = intake.owner_user_id
       AND run.intake_id = intake.id
      WHERE intake.id = p_intake_id
        AND NOT EXISTS (
          SELECT 1
          FROM private.mail_bank_agent_thread_link_jobs AS job
          WHERE job.intake_id = intake.id
        )
        AND intake.authentication_policy_applied = 'dmarc_aligned'
        AND intake.identity_verdict = 'trusted_bank'
        AND intake.authentication_status = 'passed'
        AND intake.dmarc_aligned
        AND NOT intake.reply_to_mismatch
        AND intake.status = 'review_required'
        AND intake.finalized_at IS NOT NULL
        AND proposal.classification = 'strong_candidate'
        AND proposal.review_status = 'review_required'
        AND cardinality(proposal.contradiction_codes) = 0
        AND run.source_sha256 = intake.source_sha256
        AND (
          SELECT count(*)
          FROM public.mail_bank_agent_match_proposals AS counted_proposal
          WHERE counted_proposal.organization_id = intake.organization_id
            AND counted_proposal.owner_user_id = intake.owner_user_id
            AND counted_proposal.intake_id = intake.id
        ) = 1
        AND (
          SELECT count(*)
          FROM public.mail_bank_agent_analysis_runs AS counted_run
          WHERE counted_run.organization_id = intake.organization_id
            AND counted_run.owner_user_id = intake.owner_user_id
            AND counted_run.intake_id = intake.id
        ) = 1
        AND EXISTS (
          SELECT 1
          FROM public.mail_bank_agent_run_sessions AS binding
          WHERE binding.analysis_run_id = run.id
            AND binding.organization_id = intake.organization_id
            AND binding.owner_user_id = intake.owner_user_id
            AND binding.intake_id = intake.id
        )
    )
  );
$$;

COMMENT ON FUNCTION public.get_strong_bank_mail_agent_proposal_case(uuid) IS
  'Returns a case after the durable finalizer links it, with a strict-DMARC/no-job compatibility fallback for the pre-0085 worker during migration-first rollout.';

REVOKE ALL ON FUNCTION public.get_strong_bank_mail_agent_proposal_case(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_strong_bank_mail_agent_proposal_case(uuid)
  TO openexpert_service, openexpert_owner;

CREATE OR REPLACE FUNCTION public.get_bank_mail_agent_intake(p_intake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_row public.mail_bank_agent_intakes%rowtype;
  job_row private.mail_bank_agent_thread_link_jobs%rowtype;
  bank_id_value uuid;
  attachments_value jsonb;
  strong_proposal_case_id_value uuid;
BEGIN
  IF p_intake_id IS NULL THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_intake_id'
      USING errcode = '22023';
  END IF;

  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = p_intake_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_intake_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT identity.bank_id
  INTO bank_id_value
  FROM public.mortgage_bank_email_identities AS identity
  WHERE identity.id = intake_row.bank_email_identity_id;

  SELECT job.*
  INTO job_row
  FROM private.mail_bank_agent_thread_link_jobs AS job
  WHERE job.intake_id = intake_row.id;

  SELECT public.get_strong_bank_mail_agent_proposal_case(p_intake_id)
  INTO strong_proposal_case_id_value;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'attachmentId', attachment.id,
        'ordinal', attachment.attachment_ordinal,
        'sourceSha256', attachment.source_sha256,
        'sizeBytes', attachment.size_bytes,
        'mimeCategory', attachment.mime_category,
        'encryptionStatus', attachment.encryption_status,
        'scanStatus', attachment.scan_status,
        'extractionStatus', attachment.extraction_status,
        'credentialKindUsed', attachment.credential_kind_used,
        'derivedSha256', attachment.derived_sha256,
        'updatedAt', attachment.updated_at
      ) ORDER BY attachment.attachment_ordinal
    ),
    '[]'::jsonb
  )
  INTO attachments_value
  FROM public.mail_bank_agent_attachments AS attachment
  WHERE attachment.organization_id = intake_row.organization_id
    AND attachment.owner_user_id = intake_row.owner_user_id
    AND attachment.intake_id = intake_row.id;

  RETURN jsonb_build_object(
    'intakeId', intake_row.id,
    'status', intake_row.status,
    'provider', intake_row.provider,
    'bankId', bank_id_value,
    'bankEmailIdentityId', intake_row.bank_email_identity_id,
    'identityVerdict', intake_row.identity_verdict,
    'authenticationStatus', intake_row.authentication_status,
    'authenticationPolicy', intake_row.authentication_policy_applied,
    'dmarcAligned', intake_row.dmarc_aligned,
    'dkimAligned', intake_row.dkim_aligned,
    'replyToMismatch', intake_row.reply_to_mismatch,
    'sourceSha256', intake_row.source_sha256,
    'reasonCodes', to_jsonb(intake_row.reason_codes),
    'claimedAt', intake_row.claimed_at,
    'finalizedAt', intake_row.finalized_at,
    'strongProposalCaseId', strong_proposal_case_id_value,
    'threadLinkState', job_row.state,
    'threadLinkResolutionCode', job_row.resolution_code,
    'threadLinkId', job_row.link_id,
    'threadLinkCaseId', job_row.resolved_case_id,
    'threadLinkConflictCaseId', job_row.conflict_case_id,
    'threadLinkConflictClientId', job_row.conflict_client_id,
    'attachments', attachments_value
  );
END;
$$;

COMMENT ON FUNCTION public.get_bank_mail_agent_intake(uuid) IS
  'Returns pinned envelope evidence, controlled attachment metadata, and durable thread-link state/provenance; never message content or identity PII.';

REVOKE ALL ON FUNCTION public.get_bank_mail_agent_intake(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_bank_mail_agent_intake(uuid)
  TO openexpert_service, openexpert_owner;
