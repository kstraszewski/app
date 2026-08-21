-- User-requested, advisory-only reanalysis of a finalized bank-mail intake.
--
-- The canonical intake, analysis, proposal and durable thread-link ledgers are
-- deliberately read-only here. A reanalysis has its own private mutable
-- lifecycle row and can only publish controlled advisory codes. It can never
-- create, update or restore a CRM mail-context link.

CREATE TABLE private.mail_bank_agent_reanalysis_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  attempt_no integer NOT NULL,
  state text DEFAULT 'queued'::text NOT NULL,
  model text,
  prompt_version text,
  toolset_version text,
  policy_version text,
  normalized_input_sha256 text,
  lease_token_sha256 text,
  lease_expires_at timestamptz,
  claim_count integer DEFAULT 0 NOT NULL,
  eve_session_id text,
  eve_session_id_sha256 text,
  result_code text,
  classification text,
  result_case_id uuid,
  result_application_id uuid,
  evidence_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  contradiction_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  reason_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  failure_code text,
  requested_at timestamptz DEFAULT now() NOT NULL,
  claimed_at timestamptz,
  session_bound_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_reanalysis_scope_id_key UNIQUE (
    organization_id,
    owner_user_id,
    connection_id,
    intake_id,
    id
  ),
  CONSTRAINT mail_bank_agent_reanalysis_attempt_key UNIQUE (
    intake_id,
    attempt_no
  ),
  CONSTRAINT mail_bank_agent_reanalysis_session_key UNIQUE (eve_session_id),
  CONSTRAINT mail_bank_agent_reanalysis_session_hash_key
    UNIQUE (eve_session_id_sha256),
  CONSTRAINT mail_bank_agent_reanalysis_attempt_check CHECK (
    attempt_no BETWEEN 1 AND 1000
  ),
  CONSTRAINT mail_bank_agent_reanalysis_state_check CHECK (
    state IN ('queued', 'leased', 'session_bound', 'completed', 'failed')
  ),
  CONSTRAINT mail_bank_agent_reanalysis_claim_count_check CHECK (
    claim_count BETWEEN 0 AND 10
  ),
  CONSTRAINT mail_bank_agent_reanalysis_model_check CHECK (
    (
      model IS NULL
      AND prompt_version IS NULL
      AND toolset_version IS NULL
      AND policy_version IS NULL
      AND normalized_input_sha256 IS NULL
      AND claimed_at IS NULL
      AND claim_count = 0
    )
    OR (
      model = 'deepseek/deepseek-v4-flash-0731'
      AND prompt_version = 'bank-mail-reanalysis.prompt.v1'
      AND toolset_version = 'crm-agent-capabilities.tools.v1'
      AND policy_version = 'bank-mail-reanalysis-policy.v1'
      AND normalized_input_sha256 ~ '^[0-9a-f]{64}$'
      AND claimed_at IS NOT NULL
      AND claim_count BETWEEN 1 AND 10
    )
  ),
  CONSTRAINT mail_bank_agent_reanalysis_lease_check CHECK (
    (lease_token_sha256 IS NULL AND lease_expires_at IS NULL)
    OR (
      lease_token_sha256 ~ '^[0-9a-f]{64}$'
      AND lease_expires_at IS NOT NULL
    )
  ),
  CONSTRAINT mail_bank_agent_reanalysis_session_check CHECK (
    (
      eve_session_id IS NULL
      AND eve_session_id_sha256 IS NULL
      AND session_bound_at IS NULL
    )
    OR (
      char_length(eve_session_id) BETWEEN 8 AND 256
      AND eve_session_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      AND eve_session_id_sha256 ~ '^[0-9a-f]{64}$'
      AND session_bound_at IS NOT NULL
    )
  ),
  CONSTRAINT mail_bank_agent_reanalysis_failure_code_check CHECK (
    failure_code IS NULL
    OR failure_code IN (
      'dispatch_failed',
      'turn_failed',
      'session_failed',
      'result_missing'
    )
  ),
  CONSTRAINT mail_bank_agent_reanalysis_result_code_check CHECK (
    result_code IS NULL
    OR result_code IN (
      'review_required',
      'no_match',
      'not_bank_mail',
      'needs_human_selection',
      'security_rejected'
    )
  ),
  CONSTRAINT mail_bank_agent_reanalysis_classification_check CHECK (
    classification IS NULL
    OR classification IN ('strong_candidate', 'ambiguous_candidate')
  ),
  CONSTRAINT mail_bank_agent_reanalysis_controlled_codes_check CHECK (
    private.is_valid_bank_mail_agent_evidence_codes(evidence_codes)
    AND private.is_valid_bank_mail_agent_contradiction_codes(contradiction_codes)
    AND private.is_valid_bank_mail_agent_reason_codes(reason_codes)
  ),
  CONSTRAINT mail_bank_agent_reanalysis_lifecycle_check CHECK (
    (
      state = 'queued'
      AND model IS NULL
      AND lease_token_sha256 IS NULL
      AND eve_session_id IS NULL
      AND result_code IS NULL
      AND failure_code IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'leased'
      AND model IS NOT NULL
      AND lease_token_sha256 IS NOT NULL
      AND eve_session_id IS NULL
      AND result_code IS NULL
      AND failure_code IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'session_bound'
      AND model IS NOT NULL
      AND lease_token_sha256 IS NOT NULL
      AND eve_session_id IS NOT NULL
      AND result_code IS NULL
      AND failure_code IS NULL
      AND completed_at IS NULL
    )
    OR (
      state = 'completed'
      AND model IS NOT NULL
      AND eve_session_id IS NOT NULL
      AND result_code IS NOT NULL
      AND failure_code IS NULL
      AND completed_at IS NOT NULL
    )
    OR (
      state = 'failed'
      AND result_code IS NULL
      AND failure_code IS NOT NULL
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT mail_bank_agent_reanalysis_result_shape_check CHECK (
    (
      state <> 'completed'
      AND result_code IS NULL
      AND classification IS NULL
      AND result_case_id IS NULL
      AND result_application_id IS NULL
      AND cardinality(evidence_codes) = 0
      AND cardinality(contradiction_codes) = 0
      AND cardinality(reason_codes) = 0
    )
    OR (
      state = 'completed'
      AND cardinality(reason_codes) > 0
      AND (
        (
          result_code = 'review_required'
          AND classification IS NOT NULL
          AND result_case_id IS NOT NULL
          AND result_application_id IS NOT NULL
          AND cardinality(evidence_codes) > 0
          AND (
            classification <> 'strong_candidate'
            OR cardinality(contradiction_codes) = 0
          )
        )
        OR (
          result_code <> 'review_required'
          AND classification IS NULL
          AND result_case_id IS NULL
          AND result_application_id IS NULL
        )
      )
    )
  ),
  CONSTRAINT mail_bank_agent_reanalysis_connection_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    connection_id
  ) REFERENCES public.mail_connections (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_reanalysis_intake_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id
  ) REFERENCES public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_reanalysis_requester_fkey
    FOREIGN KEY (requested_by_user_id)
    REFERENCES public.users (id) ON DELETE RESTRICT,
  CONSTRAINT mail_bank_agent_reanalysis_application_fkey FOREIGN KEY (
    organization_id,
    result_case_id,
    result_application_id
  ) REFERENCES public.crm_case_bank_applications (
    organization_id,
    case_id,
    submission_id
  ) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX mail_bank_agent_reanalysis_one_active_idx
  ON private.mail_bank_agent_reanalysis_requests (intake_id)
  WHERE state IN ('queued', 'leased', 'session_bound');

CREATE INDEX mail_bank_agent_reanalysis_timeline_idx
  ON private.mail_bank_agent_reanalysis_requests (
    intake_id,
    requested_at DESC,
    id DESC
  );

CREATE INDEX mail_bank_agent_reanalysis_requester_idx
  ON private.mail_bank_agent_reanalysis_requests (
    organization_id,
    requested_by_user_id,
    requested_at DESC
  );

CREATE TRIGGER mail_bank_agent_reanalysis_set_updated_at
  BEFORE UPDATE ON private.mail_bank_agent_reanalysis_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE private.mail_bank_agent_reanalysis_requests IS
  'Private mutable lifecycle for user-requested advisory reruns. Request IDs are EVE run IDs; no row can mutate canonical bank-mail analysis or thread links.';
COMMENT ON COLUMN private.mail_bank_agent_reanalysis_requests.normalized_input_sha256 IS
  'Hash of the bounded normalized input passed to EVE; the normalized input itself is never stored.';

REVOKE ALL ON TABLE private.mail_bank_agent_reanalysis_requests
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE private.mail_bank_agent_reanalysis_requests TO openexpert_owner;

CREATE FUNCTION private.protect_bank_mail_agent_reanalysis_request()
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
    OR NEW.requested_by_user_id IS DISTINCT FROM OLD.requested_by_user_id
    OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR (OLD.model IS NOT NULL AND NEW.model IS DISTINCT FROM OLD.model)
    OR (OLD.prompt_version IS NOT NULL AND NEW.prompt_version IS DISTINCT FROM OLD.prompt_version)
    OR (OLD.toolset_version IS NOT NULL AND NEW.toolset_version IS DISTINCT FROM OLD.toolset_version)
    OR (OLD.policy_version IS NOT NULL AND NEW.policy_version IS DISTINCT FROM OLD.policy_version)
    OR (
      OLD.normalized_input_sha256 IS NOT NULL
      AND NEW.normalized_input_sha256 IS DISTINCT FROM OLD.normalized_input_sha256
    )
    OR (OLD.eve_session_id IS NOT NULL AND NEW.eve_session_id IS DISTINCT FROM OLD.eve_session_id)
    OR (
      OLD.eve_session_id_sha256 IS NOT NULL
      AND NEW.eve_session_id_sha256 IS DISTINCT FROM OLD.eve_session_id_sha256
    )
    OR (OLD.session_bound_at IS NOT NULL AND NEW.session_bound_at IS DISTINCT FROM OLD.session_bound_at)
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_identity_is_immutable'
      USING errcode = '42501';
  END IF;

  IF OLD.state IN ('completed', 'failed')
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_terminal_is_immutable'
      USING errcode = '42501';
  END IF;

  IF NOT (
    (OLD.state = 'queued' AND NEW.state IN ('queued', 'leased', 'failed'))
    OR (OLD.state = 'leased' AND NEW.state IN ('leased', 'session_bound', 'failed'))
    OR (OLD.state = 'session_bound' AND NEW.state IN ('session_bound', 'completed', 'failed'))
    OR (OLD.state IN ('completed', 'failed') AND NEW.state = OLD.state)
  ) THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_transition_invalid'
      USING errcode = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_bank_mail_agent_reanalysis_request()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.protect_bank_mail_agent_reanalysis_request()
  TO openexpert_owner;

CREATE TRIGGER mail_bank_agent_reanalysis_protect_request
  BEFORE UPDATE ON private.mail_bank_agent_reanalysis_requests
  FOR EACH ROW EXECUTE FUNCTION private.protect_bank_mail_agent_reanalysis_request();

-- Reanalysis remains subject to the current sender-identity kill switch. A
-- historically pinned DKIM exception is eligible only while the exact mock
-- identity still has that current policy; a strict-DMARC intake keeps its
-- original stronger envelope proof but still requires an active identity.
CREATE FUNCTION private.bank_mail_agent_reanalysis_intake_is_eligible(
  p_intake_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mail_bank_agent_intakes AS intake
    JOIN public.mail_connections AS connection
      ON connection.organization_id = intake.organization_id
     AND connection.owner_user_id = intake.owner_user_id
     AND connection.id = intake.connection_id
     AND connection.provider = intake.provider
     AND connection.status = 'active'
    JOIN public.mortgage_bank_email_identities AS identity
      ON identity.id = intake.bank_email_identity_id
     AND identity.is_active
    JOIN public.mortgage_banks AS bank
      ON bank.id = identity.bank_id
    WHERE intake.id = p_intake_id
      AND intake.identity_verdict = 'trusted_bank'
      AND intake.finalized_at IS NOT NULL
      AND intake.status IN (
        'review_required',
        'no_match',
        'not_bank_mail',
        'failed'
      )
      AND NOT intake.reply_to_mismatch
      AND (
        (
          intake.authentication_policy_applied = 'dmarc_aligned'
          AND intake.authentication_status = 'passed'
          AND intake.dmarc_aligned
        )
        OR (
          intake.authentication_policy_applied = 'openexpert_mock_dkim_aligned'
          AND intake.dkim_aligned
          AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
          AND identity.sender_domain = 'openexpert.app'
          AND NOT identity.allow_subdomains
          AND bank.slug = 'openexpert-bank'
          AND bank.is_mock
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION private.bank_mail_agent_reanalysis_intake_is_eligible(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.bank_mail_agent_reanalysis_intake_is_eligible(uuid)
  TO openexpert_owner;

-- Availability is computed from the same active/cooldown/quota rules used by
-- the mutating request RPC. The result contains no lifecycle identifiers.
CREATE FUNCTION private.bank_mail_agent_reanalysis_availability(
  p_intake_id uuid,
  p_now timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  WITH timeline AS (
    SELECT request.state,
           request.requested_at,
           request.lease_expires_at,
           request.session_bound_at
    FROM private.mail_bank_agent_reanalysis_requests AS request
    WHERE request.intake_id = p_intake_id
  ), stats AS (
    SELECT
      bool_or(
        (
          state = 'queued'
          AND requested_at > p_now - interval '15 minutes'
        )
        OR (
          state = 'leased'
          AND lease_expires_at > p_now
        )
        OR (
          state = 'session_bound'
          AND session_bound_at > p_now - interval '24 hours 5 minutes'
        )
      ) AS has_active,
      max(requested_at) AS latest_requested_at,
      count(*) FILTER (WHERE requested_at > p_now - interval '24 hours') AS requests_24h,
      min(requested_at) FILTER (
        WHERE requested_at > p_now - interval '24 hours'
      ) AS oldest_request_24h,
      max(
        CASE
          WHEN state = 'leased' AND lease_expires_at > p_now
          THEN lease_expires_at
          WHEN state = 'queued'
            AND requested_at > p_now - interval '15 minutes'
          THEN p_now + interval '1 minute'
          WHEN state = 'session_bound'
            AND session_bound_at > p_now - interval '24 hours 5 minutes'
          THEN p_now + interval '1 minute'
          ELSE NULL
        END
      ) AS active_retry_at
    FROM timeline
  ), limits AS (
    SELECT
      coalesce(has_active, false) AS has_active,
      latest_requested_at,
      requests_24h,
      CASE
        WHEN latest_requested_at > p_now - interval '60 seconds'
        THEN latest_requested_at + interval '60 seconds'
        ELSE NULL
      END AS cooldown_retry_at,
      CASE
        WHEN requests_24h >= 5
        THEN oldest_request_24h + interval '24 hours'
        ELSE NULL
      END AS quota_retry_at,
      active_retry_at
    FROM stats
  )
  SELECT jsonb_build_object(
    'canRequest', NOT has_active
      AND cooldown_retry_at IS NULL
      AND quota_retry_at IS NULL,
    'retryAfterSeconds', least(
      86400,
      greatest(
        0,
        coalesce(
          ceil(extract(epoch FROM (
            greatest(active_retry_at, cooldown_retry_at, quota_retry_at) - p_now
          )))::integer,
          0
        )
      )
    ),
    'requests24h', requests_24h
  )
  FROM limits;
$$;

REVOKE ALL ON FUNCTION private.bank_mail_agent_reanalysis_availability(uuid, timestamptz)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.bank_mail_agent_reanalysis_availability(uuid, timestamptz)
  TO openexpert_owner;

CREATE FUNCTION public.request_my_bank_mail_agent_reanalysis(
  p_organization_id uuid,
  p_connection_id uuid,
  p_provider_message_id_hash text,
  p_source_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
SET row_security TO off
AS $$
DECLARE
  caller_user_id uuid := (SELECT app.current_user_id());
  intake_row public.mail_bank_agent_intakes%rowtype;
  active_request private.mail_bank_agent_reanalysis_requests%rowtype;
  latest_request private.mail_bank_agent_reanalysis_requests%rowtype;
  inserted_request private.mail_bank_agent_reanalysis_requests%rowtype;
  availability jsonb;
  request_now timestamptz := clock_timestamp();
  next_attempt integer;
  should_dispatch boolean;
BEGIN
  IF caller_user_id IS NULL
    OR p_organization_id IS NULL
    OR p_connection_id IS NULL
    OR p_provider_message_id_hash IS NULL
    OR p_provider_message_id_hash !~ '^[0-9a-f]{64}$'
    OR p_source_sha256 IS NULL
    OR p_source_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_reanalysis_request'
      USING errcode = '22023';
  END IF;

  PERFORM 1
  FROM public.mail_connections AS connection
  WHERE connection.organization_id = p_organization_id
    AND connection.owner_user_id = caller_user_id
    AND connection.id = p_connection_id
    AND connection.status = 'active'
    AND private.is_organization_member(p_organization_id)
  FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_scope_not_found'
      USING errcode = '42501';
  END IF;

  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.organization_id = p_organization_id
    AND intake.owner_user_id = caller_user_id
    AND intake.connection_id = p_connection_id
    AND intake.provider_message_id_sha256 = p_provider_message_id_hash
    AND intake.source_sha256 = p_source_sha256;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_scope_not_found'
      USING errcode = '42501';
  END IF;

  -- This lock is the linearization point for the active/cooldown/quota check.
  -- It never locks or mutates the canonical intake tuple.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'bank-mail-agent-reanalysis:' || intake_row.id::text,
      0
    )
  );

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = intake_row.id
    AND intake.organization_id = p_organization_id
    AND intake.owner_user_id = caller_user_id
    AND intake.connection_id = p_connection_id
    AND intake.provider_message_id_sha256 = p_provider_message_id_hash
    AND intake.source_sha256 = p_source_sha256;

  PERFORM 1
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
  WHERE identity.id = intake_row.bank_email_identity_id
  FOR SHARE OF identity, bank;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_bank_identity_not_found'
      USING errcode = '55000';
  END IF;

  IF private.bank_mail_agent_reanalysis_intake_is_eligible(intake_row.id)
    IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_not_allowed'
      USING errcode = '55000';
  END IF;

  SELECT request.*
  INTO active_request
  FROM private.mail_bank_agent_reanalysis_requests AS request
  WHERE request.intake_id = intake_row.id
    AND request.state IN ('queued', 'leased', 'session_bound')
  ORDER BY request.requested_at DESC, request.id DESC
  LIMIT 1
  FOR UPDATE;

  -- A queued Data API outage, an expired dispatch lease, or a lost terminal
  -- EVE hook must never block the mailbox forever. The next authenticated
  -- request closes the orphan and creates a fresh attempt under the same
  -- advisory lock. Until then the partial unique index remains strict.
  IF (
      active_request.state = 'queued'
      AND active_request.requested_at
        <= request_now - interval '15 minutes'
    ) OR (
      active_request.state = 'leased'
      AND active_request.lease_expires_at <= request_now
    ) OR (
      active_request.state = 'session_bound'
      AND active_request.session_bound_at
        <= request_now - interval '24 hours 5 minutes'
    )
  THEN
    UPDATE private.mail_bank_agent_reanalysis_requests AS request
    SET state = 'failed',
        failure_code = CASE active_request.state
          WHEN 'session_bound' THEN 'result_missing'
          ELSE 'dispatch_failed'
        END,
        completed_at = request_now,
        updated_at = request_now
    WHERE request.id = active_request.id;
    active_request := NULL;
  END IF;

  IF active_request.id IS NOT NULL THEN
    should_dispatch := active_request.state = 'queued'
      OR (
        active_request.state = 'leased'
        AND active_request.eve_session_id IS NULL
        AND active_request.lease_expires_at <= request_now
      );
    RETURN jsonb_build_object(
      'requestId', active_request.id,
      'intakeId', active_request.intake_id,
      'state', active_request.state,
      'attemptNo', active_request.attempt_no,
      'accepted', false,
      'shouldDispatch', should_dispatch,
      'canRequest', false,
      'retryAfterSeconds', 60,
      'replayed', true
    );
  END IF;

  availability := private.bank_mail_agent_reanalysis_availability(
    intake_row.id,
    request_now
  );

  SELECT request.*
  INTO latest_request
  FROM private.mail_bank_agent_reanalysis_requests AS request
  WHERE request.intake_id = intake_row.id
  ORDER BY request.requested_at DESC, request.id DESC
  LIMIT 1;

  IF coalesce((availability ->> 'canRequest')::boolean, false) IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'requestId', latest_request.id,
      'intakeId', intake_row.id,
      'state', latest_request.state,
      'attemptNo', latest_request.attempt_no,
      'accepted', false,
      'shouldDispatch', false,
      'canRequest', false,
      'retryAfterSeconds', coalesce(
        (availability ->> 'retryAfterSeconds')::integer,
        60
      ),
      'replayed', true
    );
  END IF;

  SELECT coalesce(max(request.attempt_no), 0) + 1
  INTO next_attempt
  FROM private.mail_bank_agent_reanalysis_requests AS request
  WHERE request.intake_id = intake_row.id;

  IF next_attempt > 1000 THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_attempt_limit_reached'
      USING errcode = '55000';
  END IF;

  INSERT INTO private.mail_bank_agent_reanalysis_requests (
    organization_id,
    owner_user_id,
    connection_id,
    intake_id,
    requested_by_user_id,
    attempt_no,
    state,
    requested_at,
    updated_at
  ) VALUES (
    intake_row.organization_id,
    intake_row.owner_user_id,
    intake_row.connection_id,
    intake_row.id,
    caller_user_id,
    next_attempt,
    'queued',
    request_now,
    request_now
  )
  RETURNING * INTO inserted_request;

  RETURN jsonb_build_object(
    'requestId', inserted_request.id,
    'intakeId', inserted_request.intake_id,
    'state', inserted_request.state,
    'attemptNo', inserted_request.attempt_no,
    'accepted', true,
    'shouldDispatch', true,
    'canRequest', false,
    'retryAfterSeconds', 60,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.request_my_bank_mail_agent_reanalysis(uuid, uuid, text, text) IS
  'Requests one advisory rerun for an exact finalized intake in the authenticated user own mailbox. It enforces one active request, a 60-second cooldown and at most five requests per rolling 24 hours.';

REVOKE ALL ON FUNCTION public.request_my_bank_mail_agent_reanalysis(uuid, uuid, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.request_my_bank_mail_agent_reanalysis(uuid, uuid, text, text)
  TO authenticated, openexpert_owner;

CREATE FUNCTION public.claim_bank_mail_agent_reanalysis(
  p_reanalysis_request_id uuid,
  p_model text,
  p_prompt_version text,
  p_toolset_version text,
  p_policy_version text,
  p_normalized_input_sha256 text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  request_row private.mail_bank_agent_reanalysis_requests%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  lease_token text;
  lease_token_sha256_value text;
  claimed_now timestamptz := clock_timestamp();
  next_claim_count integer;
  replayed boolean;
BEGIN
  IF p_reanalysis_request_id IS NULL
    OR p_model IS DISTINCT FROM 'deepseek/deepseek-v4-flash-0731'
    OR p_prompt_version IS DISTINCT FROM 'bank-mail-reanalysis.prompt.v1'
    OR p_toolset_version IS DISTINCT FROM 'crm-agent-capabilities.tools.v1'
    OR p_policy_version IS DISTINCT FROM 'bank-mail-reanalysis-policy.v1'
    OR p_normalized_input_sha256 IS NULL
    OR p_normalized_input_sha256 !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_reanalysis_claim'
      USING errcode = '22023';
  END IF;

  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_claims_invalid'
      USING errcode = '42501';
  END;

  SELECT request.*
  INTO request_row
  FROM private.mail_bank_agent_reanalysis_requests AS request
  WHERE request.id = p_reanalysis_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_request_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = request_row.intake_id
    AND intake.organization_id = request_row.organization_id
    AND intake.owner_user_id = request_row.owner_user_id
    AND intake.connection_id = request_row.connection_id;

  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'crm-bank-mail-reanalysis-claim-v1'
    OR jwt_claims ->> 'serviceId' IS DISTINCT FROM 'openexpert-crm-bank-mail-reanalysis'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-reanalysis'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM request_row.organization_id::text
    OR jwt_claims ->> 'reanalysisRequestId' IS DISTINCT FROM request_row.id::text
    OR jwt_claims ->> 'intakeId' IS DISTINCT FROM request_row.intake_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM request_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM request_row.owner_user_id::text
    OR jwt_claims ->> 'model' IS DISTINCT FROM p_model
    OR jwt_claims ->> 'promptVersion' IS DISTINCT FROM p_prompt_version
    OR jwt_claims ->> 'toolsetVersion' IS DISTINCT FROM p_toolset_version
    OR jwt_claims ->> 'policyVersion' IS DISTINCT FROM p_policy_version
    OR jwt_claims ->> 'normalizedInputSha256' IS DISTINCT FROM p_normalized_input_sha256
    OR NOT EXISTS (
      SELECT 1
      FROM public.mail_connections AS connection
      WHERE connection.organization_id = request_row.organization_id
        AND connection.owner_user_id = request_row.owner_user_id
        AND connection.id = request_row.connection_id
        AND connection.provider = intake_row.provider
        AND connection.status = 'active'
    )
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_claims_invalid'
      USING errcode = '42501';
  END IF;

  PERFORM 1
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
  WHERE identity.id = intake_row.bank_email_identity_id
  FOR SHARE OF identity, bank;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_bank_identity_not_found'
      USING errcode = '55000';
  END IF;

  IF private.bank_mail_agent_reanalysis_intake_is_eligible(request_row.intake_id)
    IS DISTINCT FROM true
  THEN
    IF request_row.state IN ('queued', 'leased') THEN
      UPDATE private.mail_bank_agent_reanalysis_requests AS request
      SET state = 'failed',
          failure_code = 'dispatch_failed',
          completed_at = claimed_now,
          updated_at = claimed_now
      WHERE request.id = request_row.id
      RETURNING * INTO request_row;
    END IF;
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'shouldDispatch', false,
      'leaseToken', NULL,
      'sessionId', request_row.eve_session_id,
      'replayed', true
    );
  END IF;

  IF request_row.model IS NOT NULL AND (
    request_row.model IS DISTINCT FROM p_model
    OR request_row.prompt_version IS DISTINCT FROM p_prompt_version
    OR request_row.toolset_version IS DISTINCT FROM p_toolset_version
    OR request_row.policy_version IS DISTINCT FROM p_policy_version
    OR request_row.normalized_input_sha256 IS DISTINCT FROM p_normalized_input_sha256
  ) THEN
    -- A stale unbound lease from an older normalized-input/version contract
    -- must not remain active forever after a deploy. Close it without running
    -- the new payload under the old immutable attempt; the user can then make
    -- a fresh, separately audited request.
    IF request_row.state = 'leased'
      AND request_row.eve_session_id IS NULL
      AND request_row.lease_expires_at <= claimed_now
    THEN
      UPDATE private.mail_bank_agent_reanalysis_requests AS request
      SET state = 'failed',
          failure_code = 'dispatch_failed',
          completed_at = claimed_now,
          updated_at = claimed_now
      WHERE request.id = request_row.id
      RETURNING * INTO request_row;

      RETURN jsonb_build_object(
        'reanalysisRequestId', request_row.id,
        'state', request_row.state,
        'shouldDispatch', false,
        'leaseToken', NULL,
        'sessionId', NULL,
        'replayed', true
      );
    END IF;
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_claim_replay_conflict'
      USING errcode = '23505';
  END IF;

  IF request_row.state IN ('completed', 'failed') THEN
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'shouldDispatch', false,
      'leaseToken', NULL,
      'sessionId', request_row.eve_session_id,
      'replayed', true
    );
  END IF;

  IF request_row.state = 'session_bound' THEN
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'shouldDispatch', false,
      'leaseToken', NULL,
      'sessionId', request_row.eve_session_id,
      'replayed', true
    );
  END IF;

  IF request_row.state = 'leased'
    AND request_row.lease_expires_at > claimed_now
  THEN
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'shouldDispatch', false,
      'leaseToken', NULL,
      'sessionId', NULL,
      'replayed', true
    );
  END IF;

  IF request_row.claim_count >= 10 THEN
    UPDATE private.mail_bank_agent_reanalysis_requests AS request
    SET state = 'failed',
        failure_code = 'dispatch_failed',
        completed_at = claimed_now,
        updated_at = claimed_now
    WHERE request.id = request_row.id
    RETURNING * INTO request_row;

    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'shouldDispatch', false,
      'leaseToken', NULL,
      'sessionId', request_row.eve_session_id,
      'replayed', true
    );
  END IF;

  lease_token := encode(extensions.gen_random_bytes(32), 'hex');
  lease_token_sha256_value := encode(
    extensions.digest(convert_to(lease_token, 'utf8'), 'sha256'),
    'hex'
  );
  next_claim_count := request_row.claim_count + 1;
  replayed := request_row.claim_count > 0;

  UPDATE private.mail_bank_agent_reanalysis_requests AS request
  SET state = 'leased',
      model = p_model,
      prompt_version = p_prompt_version,
      toolset_version = p_toolset_version,
      policy_version = p_policy_version,
      normalized_input_sha256 = p_normalized_input_sha256,
      lease_token_sha256 = lease_token_sha256_value,
      lease_expires_at = claimed_now + interval '15 minutes',
      claim_count = next_claim_count,
      claimed_at = coalesce(request.claimed_at, claimed_now),
      updated_at = claimed_now
  WHERE request.id = request_row.id
  RETURNING * INTO request_row;

  RETURN jsonb_build_object(
    'reanalysisRequestId', request_row.id,
    'state', request_row.state,
    'shouldDispatch', true,
    'leaseToken', lease_token,
    'sessionId', NULL,
    'replayed', replayed
  );
END;
$$;

COMMENT ON FUNCTION public.claim_bank_mail_agent_reanalysis(uuid, text, text, text, text, text) IS
  'Elects one dispatcher for a user-requested advisory rerun under an exact CRM backend JWT scope. The request ID is also the immutable EVE run ID.';

REVOKE ALL ON FUNCTION public.claim_bank_mail_agent_reanalysis(uuid, text, text, text, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_bank_mail_agent_reanalysis(uuid, text, text, text, text, text)
  TO openexpert_service, openexpert_owner;

CREATE FUNCTION public.bind_bank_mail_agent_reanalysis_session(
  p_reanalysis_request_id uuid,
  p_lease_token text,
  p_eve_session_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  request_row private.mail_bank_agent_reanalysis_requests%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  supplied_lease_token_sha256 text;
  eve_session_id_sha256_value text;
  bound_now timestamptz := clock_timestamp();
  eve_self_bind boolean := false;
  replayed boolean := false;
BEGIN
  IF p_reanalysis_request_id IS NULL
    OR p_lease_token IS NULL
    OR p_lease_token !~ '^[0-9a-f]{64}$'
    OR p_eve_session_id IS NULL
    OR char_length(p_eve_session_id) NOT BETWEEN 8 AND 256
    OR p_eve_session_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_reanalysis_session_binding'
      USING errcode = '22023';
  END IF;

  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_session_claims_invalid'
      USING errcode = '42501';
  END;

  SELECT request.*
  INTO request_row
  FROM private.mail_bank_agent_reanalysis_requests AS request
  WHERE request.id = p_reanalysis_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_request_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = request_row.intake_id
    AND intake.organization_id = request_row.organization_id
    AND intake.owner_user_id = request_row.owner_user_id
    AND intake.connection_id = request_row.connection_id;

  eve_self_bind := p_lease_token =
      '2387d71e98cf6688b7096ce52b64112265beaa30626e69063a7e86c681ad6322'
    OR coalesce(
      jwt_claims ->> 'source' = 'bank-mail-reanalysis-eve-session-bind-v1',
      false
    )
    OR coalesce(
      jwt_claims ->> 'serviceId' = 'openexpert-bank-mail-reanalysis-eve-agent',
      false
    )
    OR jwt_claims ? 'eveSessionId';

  -- The fixed sentinel is not a secret. It works only together with every
  -- exact signed self-bind claim. Any partial self-shaped request is kept out
  -- of the ordinary random-lease branch.
  IF eve_self_bind IS TRUE AND (
    p_lease_token IS DISTINCT FROM
      '2387d71e98cf6688b7096ce52b64112265beaa30626e69063a7e86c681ad6322'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'bank-mail-reanalysis-eve-session-bind-v1'
    OR jwt_claims ->> 'serviceId' IS DISTINCT FROM 'openexpert-bank-mail-reanalysis-eve-agent'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-reanalysis'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM request_row.organization_id::text
    OR jwt_claims ->> 'reanalysisRequestId' IS DISTINCT FROM request_row.id::text
    OR jwt_claims ->> 'intakeId' IS DISTINCT FROM request_row.intake_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM request_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM request_row.owner_user_id::text
    OR jwt_claims ->> 'eveSessionId' IS DISTINCT FROM p_eve_session_id
    OR NOT EXISTS (
      SELECT 1
      FROM public.mail_connections AS connection
      WHERE connection.organization_id = request_row.organization_id
        AND connection.owner_user_id = request_row.owner_user_id
        AND connection.id = request_row.connection_id
        AND connection.provider = intake_row.provider
        AND connection.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_session_claims_invalid'
      USING errcode = '42501';
  END IF;

  supplied_lease_token_sha256 := encode(
    extensions.digest(convert_to(p_lease_token, 'utf8'), 'sha256'),
    'hex'
  );
  eve_session_id_sha256_value := encode(
    extensions.digest(convert_to(p_eve_session_id, 'utf8'), 'sha256'),
    'hex'
  );

  IF eve_self_bind IS NOT TRUE
    AND request_row.lease_token_sha256
      IS DISTINCT FROM supplied_lease_token_sha256
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_lease_invalid'
      USING errcode = '42501';
  END IF;

  IF request_row.eve_session_id IS NOT NULL THEN
    IF request_row.eve_session_id IS DISTINCT FROM p_eve_session_id
      OR request_row.eve_session_id_sha256
        IS DISTINCT FROM eve_session_id_sha256_value
    THEN
      RAISE EXCEPTION 'bank_mail_agent_reanalysis_session_already_bound'
        USING errcode = '23505';
    END IF;
    replayed := true;
  ELSIF request_row.state IN ('completed', 'failed') THEN
    -- Terminal first-writer wins. A late at-least-once session hook cannot
    -- reopen a request or attach a session after a bounded failure decision.
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'sessionId', NULL,
      'replayed', true
    );
  ELSE
    IF request_row.state <> 'leased'
      OR (
        eve_self_bind IS NOT TRUE
        AND request_row.lease_expires_at <= bound_now
      )
    THEN
      RAISE EXCEPTION 'bank_mail_agent_reanalysis_lease_expired'
        USING errcode = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.mail_bank_agent_run_sessions AS binding
      WHERE binding.eve_session_id = p_eve_session_id
        OR binding.eve_session_id_sha256 = eve_session_id_sha256_value
    ) THEN
      RAISE EXCEPTION 'bank_mail_agent_reanalysis_session_reused'
        USING errcode = '23505';
    END IF;

    UPDATE private.mail_bank_agent_reanalysis_requests AS request
    SET state = 'session_bound',
        eve_session_id = p_eve_session_id,
        eve_session_id_sha256 = eve_session_id_sha256_value,
        session_bound_at = bound_now,
        updated_at = bound_now
    WHERE request.id = request_row.id
    RETURNING * INTO request_row;
  END IF;

  RETURN jsonb_build_object(
    'reanalysisRequestId', request_row.id,
    'state', request_row.state,
    'sessionId', request_row.eve_session_id,
    'replayed', replayed
  );
END;
$$;

COMMENT ON FUNCTION public.bind_bank_mail_agent_reanalysis_session(uuid, text, text) IS
  'Binds one EVE session to the advisory request using either the winning CRM lease or the exact signed EVE session-start scope. It never binds a canonical analysis run.';

REVOKE ALL ON FUNCTION public.bind_bank_mail_agent_reanalysis_session(uuid, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.bind_bank_mail_agent_reanalysis_session(uuid, text, text)
  TO openexpert_service, openexpert_owner;

CREATE FUNCTION public.record_bank_mail_agent_reanalysis_result(
  p_reanalysis_request_id uuid,
  p_result_code text,
  p_classification text,
  p_case_id uuid,
  p_application_id uuid,
  p_evidence_codes text[],
  p_contradiction_codes text[],
  p_reason_codes text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  request_row private.mail_bank_agent_reanalysis_requests%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  identity_bank_id uuid;
  application_bank_id uuid;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  evidence_codes_value text[];
  contradiction_codes_value text[];
  reason_codes_value text[];
  recorded_now timestamptz := clock_timestamp();
BEGIN
  IF p_reanalysis_request_id IS NULL
    OR p_result_code NOT IN (
      'review_required',
      'no_match',
      'not_bank_mail',
      'needs_human_selection',
      'security_rejected'
    )
    OR p_evidence_codes IS NULL
    OR p_contradiction_codes IS NULL
    OR p_reason_codes IS NULL
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_reanalysis_result'
      USING errcode = '22023';
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT code ORDER BY code),
    ARRAY[]::text[]
  ) INTO evidence_codes_value
  FROM unnest(p_evidence_codes) AS evidence(code);
  SELECT coalesce(
    array_agg(DISTINCT code ORDER BY code),
    ARRAY[]::text[]
  ) INTO contradiction_codes_value
  FROM unnest(p_contradiction_codes) AS contradiction(code);
  SELECT coalesce(
    array_agg(DISTINCT code ORDER BY code),
    ARRAY[]::text[]
  ) INTO reason_codes_value
  FROM unnest(p_reason_codes) AS reason(code);

  -- Requiring already-canonical arrays makes the signed JSON arrays and the
  -- stored arrays one exact replay payload instead of order-insensitive input.
  IF p_evidence_codes IS DISTINCT FROM evidence_codes_value
    OR p_contradiction_codes IS DISTINCT FROM contradiction_codes_value
    OR p_reason_codes IS DISTINCT FROM reason_codes_value
    OR private.is_valid_bank_mail_agent_evidence_codes(evidence_codes_value)
      IS DISTINCT FROM true
    OR private.is_valid_bank_mail_agent_contradiction_codes(contradiction_codes_value)
      IS DISTINCT FROM true
    OR private.is_valid_bank_mail_agent_reason_codes(reason_codes_value)
      IS DISTINCT FROM true
    OR cardinality(reason_codes_value) = 0
    OR (
      p_result_code = 'review_required'
      AND (
        p_classification NOT IN ('strong_candidate', 'ambiguous_candidate')
        OR p_case_id IS NULL
        OR p_application_id IS NULL
        OR cardinality(evidence_codes_value) = 0
        OR NOT (
          reason_codes_value
            && ARRAY['human_review_required', 'policy_requires_review']::text[]
        )
        OR (
          p_classification = 'strong_candidate'
          AND cardinality(contradiction_codes_value) <> 0
        )
      )
    )
    OR (
      p_result_code <> 'review_required'
      AND (
        p_classification IS NOT NULL
        OR p_case_id IS NOT NULL
        OR p_application_id IS NOT NULL
      )
    )
    OR (
      p_result_code = 'no_match'
      AND NOT (
        reason_codes_value && ARRAY[
          'no_candidate',
          'no_matching_signal',
          'bank_mismatch',
          'reference_mismatch',
          'owner_mismatch',
          'stale_application',
          'authentication_failed'
        ]::text[]
      )
    )
    OR (
      p_result_code = 'not_bank_mail'
      AND NOT ('not_bank_message' = ANY (reason_codes_value))
    )
    OR (
      p_result_code = 'needs_human_selection'
      AND NOT ('human_review_required' = ANY (reason_codes_value))
    )
    OR (
      p_result_code = 'security_rejected'
      AND NOT (
        reason_codes_value && ARRAY[
          'authentication_failed',
          'authentication_indeterminate',
          'authentication_policy_invalid',
          'dmarc_not_aligned',
          'dkim_not_aligned',
          'reply_to_mismatch'
        ]::text[]
      )
    )
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_reanalysis_result_codes'
      USING errcode = '22023';
  END IF;

  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_result_claims_invalid'
      USING errcode = '42501';
  END;

  SELECT request.*
  INTO request_row
  FROM private.mail_bank_agent_reanalysis_requests AS request
  WHERE request.id = p_reanalysis_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_request_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = request_row.intake_id
    AND intake.organization_id = request_row.organization_id
    AND intake.owner_user_id = request_row.owner_user_id
    AND intake.connection_id = request_row.connection_id;

  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'source' IS DISTINCT FROM 'bank-mail-reanalysis-result-v1'
    OR jwt_claims ->> 'serviceId' IS DISTINCT FROM 'openexpert-bank-mail-reanalysis-eve-agent'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-reanalysis'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM request_row.organization_id::text
    OR jwt_claims ->> 'reanalysisRequestId' IS DISTINCT FROM request_row.id::text
    OR jwt_claims ->> 'intakeId' IS DISTINCT FROM request_row.intake_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM request_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM request_row.owner_user_id::text
    OR jwt_claims ->> 'eveSessionId' IS DISTINCT FROM request_row.eve_session_id
    OR jwt_claims ->> 'resultCode' IS DISTINCT FROM p_result_code
    OR jwt_claims -> 'classification' IS DISTINCT FROM coalesce(
      to_jsonb(p_classification),
      'null'::jsonb
    )
    OR jwt_claims -> 'caseId' IS DISTINCT FROM coalesce(
      to_jsonb(p_case_id),
      'null'::jsonb
    )
    OR jwt_claims -> 'applicationId' IS DISTINCT FROM coalesce(
      to_jsonb(p_application_id),
      'null'::jsonb
    )
    OR jwt_claims -> 'evidenceCodes' IS DISTINCT FROM to_jsonb(evidence_codes_value)
    OR jwt_claims -> 'contradictionCodes' IS DISTINCT FROM to_jsonb(contradiction_codes_value)
    OR jwt_claims -> 'reasonCodes' IS DISTINCT FROM to_jsonb(reason_codes_value)
    OR request_row.eve_session_id IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.mail_connections AS connection
      WHERE connection.organization_id = request_row.organization_id
        AND connection.owner_user_id = request_row.owner_user_id
        AND connection.id = request_row.connection_id
        AND connection.provider = intake_row.provider
        AND connection.status = 'active'
    )
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_result_claims_invalid'
      USING errcode = '42501';
  END IF;

  SELECT identity.bank_id
  INTO identity_bank_id
  FROM public.mortgage_bank_email_identities AS identity
  JOIN public.mortgage_banks AS bank ON bank.id = identity.bank_id
  WHERE identity.id = intake_row.bank_email_identity_id
  FOR SHARE OF identity, bank;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_bank_identity_not_found'
      USING errcode = '55000';
  END IF;

  IF private.bank_mail_agent_reanalysis_intake_is_eligible(request_row.intake_id)
    IS DISTINCT FROM true
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_kill_switch_active'
      USING errcode = '55000';
  END IF;

  IF request_row.state = 'completed' THEN
    IF request_row.result_code IS DISTINCT FROM p_result_code
      OR request_row.classification IS DISTINCT FROM p_classification
      OR request_row.result_case_id IS DISTINCT FROM p_case_id
      OR request_row.result_application_id IS DISTINCT FROM p_application_id
      OR request_row.evidence_codes IS DISTINCT FROM evidence_codes_value
      OR request_row.contradiction_codes IS DISTINCT FROM contradiction_codes_value
      OR request_row.reason_codes IS DISTINCT FROM reason_codes_value
    THEN
      RAISE EXCEPTION 'bank_mail_agent_reanalysis_result_replay_conflict'
        USING errcode = '23505';
    END IF;

    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'resultCode', request_row.result_code,
      'completedAt', request_row.completed_at,
      'replayed', true
    );
  END IF;

  IF request_row.state = 'failed' THEN
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'resultCode', NULL,
      'completedAt', request_row.completed_at,
      'replayed', true
    );
  END IF;

  IF request_row.state <> 'session_bound' THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_session_not_bound'
      USING errcode = '55000';
  END IF;

  IF p_result_code = 'review_required' THEN
    SELECT application.bank_id
    INTO application_bank_id
    FROM public.crm_case_bank_applications AS application
    JOIN public.crm_cases AS crm_case
      ON crm_case.organization_id = application.organization_id
     AND crm_case.id = application.case_id
    WHERE application.organization_id = request_row.organization_id
      AND application.case_id = p_case_id
      AND application.submission_id = p_application_id
      AND crm_case.owner_user_id = request_row.owner_user_id
    FOR SHARE OF application, crm_case;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_mail_agent_reanalysis_case_application_scope_mismatch'
        USING errcode = '42501';
    END IF;
    IF application_bank_id IS DISTINCT FROM identity_bank_id THEN
      RAISE EXCEPTION 'bank_mail_agent_reanalysis_application_bank_mismatch'
        USING errcode = '42501';
    END IF;
  END IF;

  UPDATE private.mail_bank_agent_reanalysis_requests AS request
  SET state = 'completed',
      result_code = p_result_code,
      classification = p_classification,
      result_case_id = p_case_id,
      result_application_id = p_application_id,
      evidence_codes = evidence_codes_value,
      contradiction_codes = contradiction_codes_value,
      reason_codes = reason_codes_value,
      completed_at = recorded_now,
      updated_at = recorded_now
  WHERE request.id = request_row.id
  RETURNING * INTO request_row;

  RETURN jsonb_build_object(
    'reanalysisRequestId', request_row.id,
    'state', request_row.state,
    'resultCode', request_row.result_code,
    'completedAt', request_row.completed_at,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.record_bank_mail_agent_reanalysis_result(
  uuid, text, text, uuid, uuid, text[], text[], text[]
) IS
  'Records one exact signed, controlled advisory result. Candidate scope is revalidated against the mailbox owner and bank; no canonical proposal, intake, case, application or thread link is mutated.';

REVOKE ALL ON FUNCTION public.record_bank_mail_agent_reanalysis_result(
  uuid, text, text, uuid, uuid, text[], text[], text[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.record_bank_mail_agent_reanalysis_result(
  uuid, text, text, uuid, uuid, text[], text[], text[]
) TO openexpert_service, openexpert_owner;

CREATE FUNCTION public.fail_bank_mail_agent_reanalysis(
  p_reanalysis_request_id uuid,
  p_failure_code text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  request_row private.mail_bank_agent_reanalysis_requests%rowtype;
  intake_row public.mail_bank_agent_intakes%rowtype;
  claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  jwt_claims jsonb;
  failure_source text;
  failed_now timestamptz := clock_timestamp();
BEGIN
  IF p_reanalysis_request_id IS NULL
    OR p_failure_code NOT IN (
      'dispatch_failed',
      'turn_failed',
      'session_failed',
      'result_missing'
    )
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_reanalysis_failure'
      USING errcode = '22023';
  END IF;

  BEGIN
    jwt_claims := coalesce(claims_text::jsonb, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_failure_claims_invalid'
      USING errcode = '42501';
  END;

  SELECT request.*
  INTO request_row
  FROM private.mail_bank_agent_reanalysis_requests AS request
  WHERE request.id = p_reanalysis_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_request_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT intake.*
  INTO STRICT intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = request_row.intake_id
    AND intake.organization_id = request_row.organization_id
    AND intake.owner_user_id = request_row.owner_user_id
    AND intake.connection_id = request_row.connection_id;

  failure_source := jwt_claims ->> 'source';
  IF jsonb_typeof(jwt_claims) IS DISTINCT FROM 'object'
    OR jwt_claims ->> 'role' IS DISTINCT FROM 'openexpert_service'
    OR jwt_claims ->> 'preset' IS DISTINCT FROM 'bank-mail-reanalysis'
    OR jwt_claims ->> 'organizationId' IS DISTINCT FROM request_row.organization_id::text
    OR jwt_claims ->> 'reanalysisRequestId' IS DISTINCT FROM request_row.id::text
    OR jwt_claims ->> 'intakeId' IS DISTINCT FROM request_row.intake_id::text
    OR jwt_claims ->> 'connectionId' IS DISTINCT FROM request_row.connection_id::text
    OR jwt_claims ->> 'mailboxOwnerUserId' IS DISTINCT FROM request_row.owner_user_id::text
    OR jwt_claims ->> 'failureCode' IS DISTINCT FROM p_failure_code
    OR NOT EXISTS (
      SELECT 1
      FROM public.mail_connections AS connection
      WHERE connection.organization_id = request_row.organization_id
        AND connection.owner_user_id = request_row.owner_user_id
        AND connection.id = request_row.connection_id
        AND connection.provider = intake_row.provider
    )
    OR (
      failure_source = 'crm-bank-mail-reanalysis-failure-v1'
      AND (
        jwt_claims ->> 'serviceId'
          IS DISTINCT FROM 'openexpert-crm-bank-mail-reanalysis'
        OR p_failure_code <> 'dispatch_failed'
        OR jwt_claims ? 'eveSessionId'
      )
    )
    OR (
      failure_source = 'bank-mail-reanalysis-failure-v1'
      AND (
        jwt_claims ->> 'serviceId'
          IS DISTINCT FROM 'openexpert-bank-mail-reanalysis-eve-agent'
        OR p_failure_code = 'dispatch_failed'
        OR request_row.eve_session_id IS NULL
        OR jwt_claims ->> 'eveSessionId'
          IS DISTINCT FROM request_row.eve_session_id
      )
    )
    OR failure_source NOT IN (
      'crm-bank-mail-reanalysis-failure-v1',
      'bank-mail-reanalysis-failure-v1'
    )
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_failure_claims_invalid'
      USING errcode = '42501';
  END IF;

  -- Terminal first-writer wins. At-least-once hooks are acknowledged without
  -- replacing a controlled result or the first persisted failure reason.
  IF request_row.state IN ('completed', 'failed') THEN
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'failureCode', request_row.failure_code,
      'completedAt', request_row.completed_at,
      'replayed', true
    );
  END IF;

  IF failure_source = 'crm-bank-mail-reanalysis-failure-v1'
    AND (
      request_row.state = 'session_bound'
      OR request_row.eve_session_id IS NOT NULL
    )
  THEN
    -- createSession() runs the EVE session-start hook before the CRM bind
    -- replay returns. A later CRM network/bind error must not kill the already
    -- bound run; only that exact EVE session may now complete or fail it.
    RETURN jsonb_build_object(
      'reanalysisRequestId', request_row.id,
      'state', request_row.state,
      'failureCode', NULL,
      'completedAt', NULL,
      'replayed', true
    );
  END IF;

  IF failure_source = 'bank-mail-reanalysis-failure-v1'
    AND request_row.state <> 'session_bound'
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_failure_session_mismatch'
      USING errcode = '42501';
  END IF;

  IF failure_source = 'crm-bank-mail-reanalysis-failure-v1'
    AND request_row.state NOT IN ('queued', 'leased')
  THEN
    RAISE EXCEPTION 'bank_mail_agent_reanalysis_failure_state_invalid'
      USING errcode = '55000';
  END IF;

  UPDATE private.mail_bank_agent_reanalysis_requests AS request
  SET state = 'failed',
      failure_code = p_failure_code,
      completed_at = failed_now,
      updated_at = failed_now
  WHERE request.id = request_row.id
  RETURNING * INTO request_row;

  RETURN jsonb_build_object(
    'reanalysisRequestId', request_row.id,
    'state', request_row.state,
    'failureCode', request_row.failure_code,
    'completedAt', request_row.completed_at,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.fail_bank_mail_agent_reanalysis(uuid, text) IS
  'Idempotently closes an advisory request under either exact CRM dispatch-failure scope or its exact bound EVE session failure scope. A late CRM error cannot fail an already self-bound session.';

REVOKE ALL ON FUNCTION public.fail_bank_mail_agent_reanalysis(uuid, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.fail_bank_mail_agent_reanalysis(uuid, text)
  TO openexpert_service, openexpert_owner;

CREATE FUNCTION private.get_bank_mail_agent_canonical_result(
  p_intake_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_row public.mail_bank_agent_intakes%rowtype;
  event_row public.mail_bank_agent_events%rowtype;
  proposal_row public.mail_bank_agent_match_proposals%rowtype;
  presentation_code text;
BEGIN
  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = p_intake_id;
  IF NOT FOUND OR intake_row.finalized_at IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT event.*
  INTO event_row
  FROM public.mail_bank_agent_events AS event
  WHERE event.intake_id = intake_row.id
    AND event.outcome_code IS NOT NULL
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;

  IF event_row.id IS NOT NULL THEN
    IF event_row.outcome_code = 'review_required' THEN
      SELECT proposal.*
      INTO proposal_row
      FROM public.mail_bank_agent_match_proposals AS proposal
      WHERE proposal.id = event_row.proposal_id
        AND proposal.intake_id = intake_row.id;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
      presentation_code := 'proposal_created';
    ELSE
      presentation_code := event_row.outcome_code;
    END IF;

    RETURN jsonb_build_object(
      'code', presentation_code,
      'classification', proposal_row.classification,
      'evidenceCodes', coalesce(to_jsonb(proposal_row.evidence_codes), '[]'::jsonb),
      'contradictionCodes', coalesce(
        to_jsonb(proposal_row.contradiction_codes),
        '[]'::jsonb
      ),
      'reasonCodes', to_jsonb(event_row.reason_codes),
      'completedAt', event_row.occurred_at,
      'caseId', proposal_row.case_id,
      'applicationId', proposal_row.application_id
    );
  END IF;

  IF intake_row.status = 'review_required' THEN
    SELECT proposal.*
    INTO proposal_row
    FROM public.mail_bank_agent_match_proposals AS proposal
    WHERE proposal.intake_id = intake_row.id
    ORDER BY proposal.created_at DESC, proposal.id DESC
    LIMIT 1;
    IF proposal_row.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'code', 'proposal_created',
        'classification', proposal_row.classification,
        'evidenceCodes', to_jsonb(proposal_row.evidence_codes),
        'contradictionCodes', to_jsonb(proposal_row.contradiction_codes),
        'reasonCodes', to_jsonb(
          ARRAY['human_review_required', 'policy_requires_review']::text[]
        ),
        'completedAt', coalesce(intake_row.finalized_at, proposal_row.created_at),
        'caseId', proposal_row.case_id,
        'applicationId', proposal_row.application_id
      );
    END IF;
  END IF;

  presentation_code := CASE intake_row.status
    WHEN 'security_rejected' THEN 'security_rejected'
    WHEN 'no_match' THEN 'no_match'
    WHEN 'not_bank_mail' THEN 'not_bank_mail'
    WHEN 'failed' THEN 'processing_failed'
    ELSE NULL
  END;
  IF presentation_code IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'code', presentation_code,
    'classification', NULL,
    'evidenceCodes', '[]'::jsonb,
    'contradictionCodes', '[]'::jsonb,
    'reasonCodes', to_jsonb(intake_row.reason_codes),
    'completedAt', intake_row.finalized_at,
    'caseId', NULL,
    'applicationId', NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION private.get_bank_mail_agent_canonical_result(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.get_bank_mail_agent_canonical_result(uuid)
  TO openexpert_owner;

CREATE FUNCTION private.get_bank_mail_agent_thread_link_status(
  p_intake_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  job_row private.mail_bank_agent_thread_link_jobs%rowtype;
  live_case_id uuid;
BEGIN
  SELECT job.*
  INTO job_row
  FROM private.mail_bank_agent_thread_link_jobs AS job
  WHERE job.intake_id = p_intake_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF job_row.state = 'linked' THEN
    SELECT link.case_id
    INTO live_case_id
    FROM public.mail_context_thread_links AS link
    WHERE link.id = job_row.link_id
      AND link.organization_id = job_row.organization_id
      AND link.owner_user_id = job_row.owner_user_id
      AND link.connection_id = job_row.connection_id
      AND link.thread_key_hash = job_row.thread_key_hash
      AND link.client_id IS NULL
      AND link.case_id = job_row.resolved_case_id;

    IF live_case_id IS NULL THEN
      RETURN jsonb_build_object(
        'state', 'not_linked',
        'resolutionCode', NULL,
        'caseId', NULL
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'state', job_row.state,
    'resolutionCode', job_row.resolution_code,
    'caseId', CASE WHEN job_row.state = 'linked' THEN live_case_id ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION private.get_bank_mail_agent_thread_link_status(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION private.get_bank_mail_agent_thread_link_status(uuid)
  TO openexpert_owner;

-- Preserve the existing Data API signature/OID while extending each
-- mailbox-scoped row with controlled canonical, live-link and advisory-rerun
-- presentation data. No private request/run/session identifier is returned.
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
  'Returns controlled canonical result, live thread-link state and latest advisory-rerun lifecycle for bounded message hashes in the authenticated user own mailbox. It exposes no intake, request, run, session or normalized-input identifiers.';

ALTER FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  TO authenticated, openexpert_owner;

-- New public RPC signatures require a PostgREST/Data API schema-cache reload
-- after this migration. The status function keeps its existing signature and
-- is rollout-compatible with the old status caller throughout that reload.
