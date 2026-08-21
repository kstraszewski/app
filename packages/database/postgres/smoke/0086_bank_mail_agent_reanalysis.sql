-- Rollback-only end-to-end smoke for advisory-only bank-mail reanalysis,
-- exact service/EVE scopes, stale recovery and mailbox-safe presentation.

BEGIN;
SET LOCAL row_security = off;

CREATE TEMP TABLE bank_mail_0086_state (
  scenario text PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  provider_message_hash text NOT NULL,
  source_hash text NOT NULL
) ON COMMIT DROP;

DO $bank_mail_0086_setup$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  owner_user_id_value uuid := gen_random_uuid();
  connection_id_value uuid := gen_random_uuid();
  client_id_value uuid := gen_random_uuid();
  case_id_value uuid := gen_random_uuid();
  case_item_id_value uuid := gen_random_uuid();
  application_id_value uuid := gen_random_uuid();
  offer_id_value uuid := gen_random_uuid();
  product_type_id_value uuid;
  bank_id_value uuid;
  identity_id_value uuid;
  canonical_intake_id uuid;
  stale_intake_id uuid := gen_random_uuid();
  security_intake_id uuid := gen_random_uuid();
  expired_lease_intake_id uuid := gen_random_uuid();
  claim_result jsonb;
  run_result jsonb;
BEGIN
  SELECT bank.id, identity.id
  INTO STRICT bank_id_value, identity_id_value
  FROM public.mortgage_banks AS bank
  JOIN public.mortgage_bank_email_identities AS identity
    ON identity.bank_id = bank.id
  WHERE bank.slug = 'openexpert-bank'
    AND bank.is_mock
    AND identity.sender_domain = 'openexpert.app'
    AND NOT identity.allow_subdomains
    AND identity.authentication_policy = 'openexpert_mock_dkim_aligned'
    AND identity.is_active;

  SELECT product_type.id
  INTO STRICT product_type_id_value
  FROM public.crm_product_types AS product_type
  WHERE product_type.code = 'credit_mortgage'
    AND product_type.is_active
    AND product_type.organization_id IS NULL
  ORDER BY product_type.id
  LIMIT 1;

  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES (
    owner_user_id_value,
    '0086 Reanalysis Owner',
    '0086-reanalysis-' || replace(owner_user_id_value::text, '-', '') || '@example.test',
    true
  );

  INSERT INTO public.organizations (
    id,
    name,
    slug,
    kind,
    billing_access_state
  ) VALUES (
    organization_id_value,
    '0086 reanalysis smoke',
    'bank-mail-reanalysis-0086-' || replace(organization_id_value::text, '-', ''),
    'intermediary',
    'not_required'
  );

  INSERT INTO public.users (id, organization_id, email, role, full_name)
  VALUES (
    owner_user_id_value,
    organization_id_value,
    '0086-reanalysis-' || replace(owner_user_id_value::text, '-', '') || '@example.test',
    'admin',
    '0086 Reanalysis Owner'
  );

  EXECUTE 'ALTER TABLE public.organization_memberships DISABLE TRIGGER USER';
  INSERT INTO public.organization_memberships (organization_id, user_id, role)
  VALUES (organization_id_value, owner_user_id_value, 'admin');
  EXECUTE 'ALTER TABLE public.organization_memberships ENABLE TRIGGER USER';

  INSERT INTO public.mail_connections (
    id,
    organization_id,
    owner_user_id,
    provider,
    account_id,
    account_email,
    status
  ) VALUES (
    connection_id_value,
    organization_id_value,
    owner_user_id_value,
    'google',
    '0086-reanalysis-account',
    '0086-reanalysis@example.test',
    'active'
  );

  EXECUTE 'ALTER TABLE public.crm_clients DISABLE TRIGGER USER';
  INSERT INTO public.crm_clients (
    id,
    organization_id,
    owner_user_id,
    display_name
  ) VALUES (
    client_id_value,
    organization_id_value,
    owner_user_id_value,
    '0086 Reanalysis Client'
  );
  EXECUTE 'ALTER TABLE public.crm_clients ENABLE TRIGGER USER';

  EXECUTE 'ALTER TABLE public.crm_cases DISABLE TRIGGER USER';
  INSERT INTO public.crm_cases (
    id,
    organization_id,
    client_id,
    owner_user_id,
    title
  ) VALUES (
    case_id_value,
    organization_id_value,
    client_id_value,
    owner_user_id_value,
    '0086 Reanalysis Case'
  );
  EXECUTE 'ALTER TABLE public.crm_cases ENABLE TRIGGER USER';

  INSERT INTO public.crm_case_items (
    id,
    organization_id,
    case_id,
    product_type_id,
    owner_user_id,
    title
  ) VALUES (
    case_item_id_value,
    organization_id_value,
    case_id_value,
    product_type_id_value,
    owner_user_id_value,
    '0086 Mortgage'
  );
  INSERT INTO public.crm_item_submissions (id, organization_id, case_item_id)
  VALUES (application_id_value, organization_id_value, case_item_id_value);

  EXECUTE 'ALTER TABLE public.crm_case_offer_snapshots DISABLE TRIGGER USER';
  INSERT INTO public.crm_case_offer_snapshots (
    id,
    organization_id,
    case_id,
    bank_id,
    saved_by_user_id,
    bank_name,
    product_name,
    calculator_version,
    scenario_snapshot,
    catalog_snapshot,
    calculation_snapshot
  ) VALUES (
    offer_id_value,
    organization_id_value,
    case_id_value,
    bank_id_value,
    owner_user_id_value,
    'OpenExpert Bank',
    '0086 Smoke Product',
    '0086-smoke',
    '{}'::jsonb,
    '{}'::jsonb,
    '{}'::jsonb
  );
  EXECUTE 'ALTER TABLE public.crm_case_offer_snapshots ENABLE TRIGGER USER';

  EXECUTE 'ALTER TABLE public.crm_case_bank_applications DISABLE TRIGGER USER';
  INSERT INTO public.crm_case_bank_applications (
    submission_id,
    organization_id,
    case_id,
    case_item_id,
    offer_id,
    bank_id,
    slot,
    created_by_user_id
  ) VALUES (
    application_id_value,
    organization_id_value,
    case_id_value,
    case_item_id_value,
    offer_id_value,
    bank_id_value,
    1,
    owner_user_id_value
  );
  EXECUTE 'ALTER TABLE public.crm_case_bank_applications ENABLE TRIGGER USER';

  -- Build one real canonical strong proposal so status covers canonical
  -- proposal_created and a live 0085 thread link.
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
      'threadKeySha256', repeat('1', 64),
      'threadReference', 'thread_reanalysis_0086',
      'dkimAligned', true
    )::text,
    true
  );
  claim_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('a', 64),
    repeat('b', 64),
    'openexpert.app',
    'failed',
    false,
    false,
    bank_id_value
  );
  canonical_intake_id := (claim_result ->> 'intakeId')::uuid;
  run_result := public.claim_bank_mail_agent_run(
    canonical_intake_id,
    'deepseek/deepseek-v4-flash-0731'
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'openexpert_service')::text,
    true
  );
  PERFORM public.bind_bank_mail_agent_run_session(
    (run_result ->> 'runId')::uuid,
    run_result ->> 'leaseToken',
    'eve_canonical_reanalysis_0086'
  );
  PERFORM public.propose_bank_mail_case_match(
    canonical_intake_id,
    (run_result ->> 'runId')::uuid,
    case_id_value,
    application_id_value,
    'strong_candidate',
    ARRAY['bank_application_reference']::text[],
    ARRAY[]::text[]
  );

  -- Three additional finalized trusted intakes avoid mutating canonical rows
  -- merely to cover failure, stale and security-rejected advisory outcomes.
  INSERT INTO public.mail_bank_agent_intakes (
    id,
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
  ) VALUES
  (
    stale_intake_id,
    organization_id_value,
    owner_user_id_value,
    connection_id_value,
    identity_id_value,
    'google',
    repeat('c', 64),
    repeat('d', 64),
    encode(extensions.digest(convert_to('openexpert.app', 'utf8'), 'sha256'), 'hex'),
    repeat('e', 64),
    'trusted_bank',
    'failed',
    false,
    true,
    'openexpert_mock_dkim_aligned',
    false,
    'no_match',
    ARRAY['no_candidate']::text[],
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 hour'
  ),
  (
    security_intake_id,
    organization_id_value,
    owner_user_id_value,
    connection_id_value,
    identity_id_value,
    'google',
    repeat('f', 64),
    repeat('0', 64),
    encode(extensions.digest(convert_to('openexpert.app', 'utf8'), 'sha256'), 'hex'),
    repeat('2', 64),
    'trusted_bank',
    'failed',
    false,
    true,
    'openexpert_mock_dkim_aligned',
    false,
    'no_match',
    ARRAY['no_candidate']::text[],
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 hour'
  ),
  (
    expired_lease_intake_id,
    organization_id_value,
    owner_user_id_value,
    connection_id_value,
    identity_id_value,
    'google',
    repeat('8', 64),
    repeat('9', 64),
    encode(extensions.digest(convert_to('openexpert.app', 'utf8'), 'sha256'), 'hex'),
    repeat('3', 64),
    'trusted_bank',
    'failed',
    false,
    true,
    'openexpert_mock_dkim_aligned',
    false,
    'no_match',
    ARRAY['no_candidate']::text[],
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 hour',
    clock_timestamp() - interval '1 hour'
  );

  INSERT INTO bank_mail_0086_state VALUES
    (
      'proposal', organization_id_value, owner_user_id_value,
      connection_id_value, canonical_intake_id, case_id_value,
      application_id_value, repeat('a', 64), repeat('b', 64)
    ),
    (
      'stale_failure', organization_id_value, owner_user_id_value,
      connection_id_value, stale_intake_id, case_id_value,
      application_id_value, repeat('c', 64), repeat('d', 64)
    ),
    (
      'security', organization_id_value, owner_user_id_value,
      connection_id_value, security_intake_id, case_id_value,
      application_id_value, repeat('f', 64), repeat('0', 64)
    ),
    (
      'expired_lease', organization_id_value, owner_user_id_value,
      connection_id_value, expired_lease_intake_id, case_id_value,
      application_id_value, repeat('8', 64), repeat('9', 64)
    );
END
$bank_mail_0086_setup$;

-- Observe the same canonical link state that COMMIT would publish.
SET CONSTRAINTS ALL IMMEDIATE;

DO $bank_mail_0086_reanalysis$
DECLARE
  proposal bank_mail_0086_state%rowtype;
  stale_failure bank_mail_0086_state%rowtype;
  security bank_mail_0086_state%rowtype;
  expired_lease bank_mail_0086_state%rowtype;
  operation jsonb;
  replay_operation jsonb;
  claim_result jsonb;
  bind_result jsonb;
  fail_result jsonb;
  record_result jsonb;
  statuses jsonb;
  proposal_status jsonb;
  stale_status jsonb;
  security_status jsonb;
  request_id uuid;
  stale_request_id uuid := gen_random_uuid();
  stale_security_request_id uuid := gen_random_uuid();
  normalized_hash text := repeat('3', 64);
  lease_token text;
BEGIN
  SELECT * INTO STRICT proposal FROM bank_mail_0086_state WHERE scenario = 'proposal';
  SELECT * INTO STRICT stale_failure FROM bank_mail_0086_state WHERE scenario = 'stale_failure';
  SELECT * INTO STRICT security FROM bank_mail_0086_state WHERE scenario = 'security';
  SELECT * INTO STRICT expired_lease FROM bank_mail_0086_state WHERE scenario = 'expired_lease';

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'authenticated',
      'sub', proposal.owner_user_id
    )::text,
    true
  );
  operation := public.request_my_bank_mail_agent_reanalysis(
    proposal.organization_id,
    proposal.connection_id,
    proposal.provider_message_hash,
    proposal.source_hash
  );
  request_id := (operation ->> 'requestId')::uuid;
  IF operation ->> 'state' <> 'queued'
    OR operation ->> 'accepted' <> 'true'
    OR operation ->> 'shouldDispatch' <> 'true'
    OR operation ->> 'replayed' <> 'false'
  THEN
    RAISE EXCEPTION 'new_reanalysis_request_contract_invalid';
  END IF;

  replay_operation := public.request_my_bank_mail_agent_reanalysis(
    proposal.organization_id,
    proposal.connection_id,
    proposal.provider_message_hash,
    proposal.source_hash
  );
  IF replay_operation ->> 'requestId' <> request_id::text
    OR replay_operation ->> 'accepted' <> 'false'
    OR replay_operation ->> 'shouldDispatch' <> 'true'
    OR replay_operation ->> 'replayed' <> 'true'
  THEN
    RAISE EXCEPTION 'queued_request_crash_recovery_invalid';
  END IF;

  -- Generic service claims cannot claim the request.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'openexpert_service')::text,
    true
  );
  BEGIN
    PERFORM public.claim_bank_mail_agent_reanalysis(
      request_id,
      'deepseek/deepseek-v4-flash-0731',
      'bank-mail-reanalysis.prompt.v1',
      'crm-agent-capabilities.tools.v1',
      'bank-mail-reanalysis-policy.v1',
      normalized_hash
    );
    RAISE EXCEPTION 'unscoped_reanalysis_claim_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'crm-bank-mail-reanalysis-claim-v1',
      'serviceId', 'openexpert-crm-bank-mail-reanalysis',
      'preset', 'bank-mail-reanalysis',
      'organizationId', proposal.organization_id,
      'reanalysisRequestId', request_id,
      'intakeId', proposal.intake_id,
      'connectionId', proposal.connection_id,
      'mailboxOwnerUserId', proposal.owner_user_id,
      'model', 'deepseek/deepseek-v4-flash-0731',
      'promptVersion', 'bank-mail-reanalysis.prompt.v1',
      'toolsetVersion', 'crm-agent-capabilities.tools.v1',
      'policyVersion', 'bank-mail-reanalysis-policy.v1',
      'normalizedInputSha256', normalized_hash
    )::text,
    true
  );
  claim_result := public.claim_bank_mail_agent_reanalysis(
    request_id,
    'deepseek/deepseek-v4-flash-0731',
    'bank-mail-reanalysis.prompt.v1',
    'crm-agent-capabilities.tools.v1',
    'bank-mail-reanalysis-policy.v1',
    normalized_hash
  );
  lease_token := claim_result ->> 'leaseToken';
  IF claim_result ->> 'state' <> 'leased'
    OR claim_result ->> 'shouldDispatch' <> 'true'
    OR claim_result ->> 'replayed' <> 'false'
    OR lease_token !~ '^[0-9a-f]{64}$'
  THEN
    RAISE EXCEPTION 'scoped_reanalysis_claim_invalid';
  END IF;

  replay_operation := public.claim_bank_mail_agent_reanalysis(
    request_id,
    'deepseek/deepseek-v4-flash-0731',
    'bank-mail-reanalysis.prompt.v1',
    'crm-agent-capabilities.tools.v1',
    'bank-mail-reanalysis-policy.v1',
    normalized_hash
  );
  IF replay_operation ->> 'shouldDispatch' <> 'false'
    OR replay_operation ->> 'leaseToken' IS NOT NULL
    OR replay_operation ->> 'replayed' <> 'true'
  THEN
    RAISE EXCEPTION 'active_lease_replay_invalid';
  END IF;

  -- Partial sentinel scope is never a lease bypass.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'bank-mail-reanalysis-eve-session-bind-v1'
    )::text,
    true
  );
  BEGIN
    PERFORM public.bind_bank_mail_agent_reanalysis_session(
      request_id,
      '2387d71e98cf6688b7096ce52b64112265beaa30626e69063a7e86c681ad6322',
      'eve_reanalysis_proposal_0086'
    );
    RAISE EXCEPTION 'partial_reanalysis_self_bind_was_accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'bank-mail-reanalysis-eve-session-bind-v1',
      'serviceId', 'openexpert-bank-mail-reanalysis-eve-agent',
      'preset', 'bank-mail-reanalysis',
      'organizationId', proposal.organization_id,
      'reanalysisRequestId', request_id,
      'intakeId', proposal.intake_id,
      'connectionId', proposal.connection_id,
      'mailboxOwnerUserId', proposal.owner_user_id,
      'eveSessionId', 'eve_reanalysis_proposal_0086'
    )::text,
    true
  );
  bind_result := public.bind_bank_mail_agent_reanalysis_session(
    request_id,
    '2387d71e98cf6688b7096ce52b64112265beaa30626e69063a7e86c681ad6322',
    'eve_reanalysis_proposal_0086'
  );
  IF bind_result ->> 'state' <> 'session_bound'
    OR bind_result ->> 'sessionId' <> 'eve_reanalysis_proposal_0086'
  THEN
    RAISE EXCEPTION 'exact_reanalysis_self_bind_failed';
  END IF;

  -- The ordinary real-lease bind is idempotent after EVE self-bound first.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'openexpert_service')::text,
    true
  );
  bind_result := public.bind_bank_mail_agent_reanalysis_session(
    request_id,
    lease_token,
    'eve_reanalysis_proposal_0086'
  );
  IF bind_result ->> 'replayed' <> 'true' THEN
    RAISE EXCEPTION 'crm_reanalysis_bind_replay_failed';
  END IF;

  -- A CRM catch after the self-bind race cannot kill the bound EVE session.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'crm-bank-mail-reanalysis-failure-v1',
      'serviceId', 'openexpert-crm-bank-mail-reanalysis',
      'preset', 'bank-mail-reanalysis',
      'organizationId', proposal.organization_id,
      'reanalysisRequestId', request_id,
      'intakeId', proposal.intake_id,
      'connectionId', proposal.connection_id,
      'mailboxOwnerUserId', proposal.owner_user_id,
      'failureCode', 'dispatch_failed'
    )::text,
    true
  );
  fail_result := public.fail_bank_mail_agent_reanalysis(
    request_id,
    'dispatch_failed'
  );
  IF fail_result ->> 'state' <> 'session_bound'
    OR fail_result ->> 'failureCode' IS NOT NULL
  THEN
    RAISE EXCEPTION 'crm_failure_killed_eve_bound_reanalysis';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'bank-mail-reanalysis-result-v1',
      'serviceId', 'openexpert-bank-mail-reanalysis-eve-agent',
      'preset', 'bank-mail-reanalysis',
      'organizationId', proposal.organization_id,
      'reanalysisRequestId', request_id,
      'intakeId', proposal.intake_id,
      'connectionId', proposal.connection_id,
      'mailboxOwnerUserId', proposal.owner_user_id,
      'eveSessionId', 'eve_reanalysis_proposal_0086',
      'resultCode', 'review_required',
      'classification', 'strong_candidate',
      'caseId', proposal.case_id,
      'applicationId', proposal.application_id,
      'evidenceCodes', ARRAY['bank_application_reference']::text[],
      'contradictionCodes', ARRAY[]::text[],
      'reasonCodes', ARRAY['human_review_required', 'policy_requires_review']::text[]
    )::text,
    true
  );
  record_result := public.record_bank_mail_agent_reanalysis_result(
    request_id,
    'review_required',
    'strong_candidate',
    proposal.case_id,
    proposal.application_id,
    ARRAY['bank_application_reference']::text[],
    ARRAY[]::text[],
    ARRAY['human_review_required', 'policy_requires_review']::text[]
  );
  IF record_result ->> 'state' <> 'completed'
    OR record_result ->> 'resultCode' <> 'review_required'
    OR record_result ->> 'replayed' <> 'false'
  THEN
    RAISE EXCEPTION 'advisory_proposal_result_not_recorded';
  END IF;

  replay_operation := public.record_bank_mail_agent_reanalysis_result(
    request_id,
    'review_required',
    'strong_candidate',
    proposal.case_id,
    proposal.application_id,
    ARRAY['bank_application_reference']::text[],
    ARRAY[]::text[],
    ARRAY['human_review_required', 'policy_requires_review']::text[]
  );
  IF replay_operation ->> 'replayed' <> 'true' THEN
    RAISE EXCEPTION 'advisory_result_replay_not_idempotent';
  END IF;

  -- A 24h+5m orphan is inferred as failed by status and atomically closed by
  -- the next authenticated request before attempt 2 is inserted.
  INSERT INTO private.mail_bank_agent_reanalysis_requests (
    id, organization_id, owner_user_id, connection_id, intake_id,
    requested_by_user_id, attempt_no, state, model, prompt_version,
    toolset_version, policy_version, normalized_input_sha256,
    lease_token_sha256, lease_expires_at, claim_count, eve_session_id,
    eve_session_id_sha256, requested_at, claimed_at, session_bound_at, updated_at
  ) VALUES (
    stale_request_id, stale_failure.organization_id, stale_failure.owner_user_id,
    stale_failure.connection_id, stale_failure.intake_id,
    stale_failure.owner_user_id, 1, 'session_bound',
    'deepseek/deepseek-v4-flash-0731', 'bank-mail-reanalysis.prompt.v1',
    'crm-agent-capabilities.tools.v1', 'bank-mail-reanalysis-policy.v1',
    repeat('4', 64), repeat('5', 64), clock_timestamp() - interval '24 hours',
    1, 'eve_stale_reanalysis_0086',
    encode(extensions.digest(convert_to('eve_stale_reanalysis_0086', 'utf8'), 'sha256'), 'hex'),
    clock_timestamp() - interval '25 hours',
    clock_timestamp() - interval '25 hours',
    clock_timestamp() - interval '24 hours 6 minutes',
    clock_timestamp() - interval '24 hours 6 minutes'
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', stale_failure.owner_user_id)::text,
    true
  );
  operation := public.request_my_bank_mail_agent_reanalysis(
    stale_failure.organization_id,
    stale_failure.connection_id,
    stale_failure.provider_message_hash,
    stale_failure.source_hash
  );
  IF operation ->> 'accepted' <> 'true'
    OR operation ->> 'state' <> 'queued'
    OR operation ->> 'attemptNo' <> '2'
    OR NOT EXISTS (
      SELECT 1
      FROM private.mail_bank_agent_reanalysis_requests AS request
      WHERE request.id = stale_request_id
        AND request.state = 'failed'
        AND request.failure_code = 'result_missing'
    )
  THEN
    RAISE EXCEPTION 'stale_session_recovery_failed';
  END IF;

  -- Claim attempt 2 and prove CRM failure is terminal and replay-safe while
  -- it is still leased/unbound.
  request_id := (operation ->> 'requestId')::uuid;
  normalized_hash := repeat('6', 64);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service', 'source', 'crm-bank-mail-reanalysis-claim-v1',
      'serviceId', 'openexpert-crm-bank-mail-reanalysis', 'preset', 'bank-mail-reanalysis',
      'organizationId', stale_failure.organization_id,
      'reanalysisRequestId', request_id, 'intakeId', stale_failure.intake_id,
      'connectionId', stale_failure.connection_id,
      'mailboxOwnerUserId', stale_failure.owner_user_id,
      'model', 'deepseek/deepseek-v4-flash-0731',
      'promptVersion', 'bank-mail-reanalysis.prompt.v1',
      'toolsetVersion', 'crm-agent-capabilities.tools.v1',
      'policyVersion', 'bank-mail-reanalysis-policy.v1',
      'normalizedInputSha256', normalized_hash
    )::text, true
  );
  claim_result := public.claim_bank_mail_agent_reanalysis(
    request_id, 'deepseek/deepseek-v4-flash-0731',
    'bank-mail-reanalysis.prompt.v1', 'crm-agent-capabilities.tools.v1',
    'bank-mail-reanalysis-policy.v1', normalized_hash
  );
  IF claim_result ->> 'shouldDispatch' <> 'true' THEN
    RAISE EXCEPTION 'recovered_attempt_was_not_claimed';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service', 'source', 'crm-bank-mail-reanalysis-failure-v1',
      'serviceId', 'openexpert-crm-bank-mail-reanalysis', 'preset', 'bank-mail-reanalysis',
      'organizationId', stale_failure.organization_id,
      'reanalysisRequestId', request_id, 'intakeId', stale_failure.intake_id,
      'connectionId', stale_failure.connection_id,
      'mailboxOwnerUserId', stale_failure.owner_user_id,
      'failureCode', 'dispatch_failed'
    )::text, true
  );
  fail_result := public.fail_bank_mail_agent_reanalysis(request_id, 'dispatch_failed');
  replay_operation := public.fail_bank_mail_agent_reanalysis(request_id, 'dispatch_failed');
  IF fail_result ->> 'state' <> 'failed'
    OR fail_result ->> 'replayed' <> 'false'
    OR replay_operation ->> 'state' <> 'failed'
    OR replay_operation ->> 'replayed' <> 'true'
  THEN
    RAISE EXCEPTION 'dispatch_failure_replay_invalid';
  END IF;

  -- An expired unbound lease is presented as rerunnable and the next request
  -- closes it before creating a new attempt; the partial active index never
  -- permits both attempts to be active at once.
  request_id := gen_random_uuid();
  INSERT INTO private.mail_bank_agent_reanalysis_requests (
    id, organization_id, owner_user_id, connection_id, intake_id,
    requested_by_user_id, attempt_no, state, model, prompt_version,
    toolset_version, policy_version, normalized_input_sha256,
    lease_token_sha256, lease_expires_at, claim_count,
    requested_at, claimed_at, updated_at
  ) VALUES (
    request_id, expired_lease.organization_id, expired_lease.owner_user_id,
    expired_lease.connection_id, expired_lease.intake_id,
    expired_lease.owner_user_id, 1, 'leased',
    'deepseek/deepseek-v4-flash-0731', 'bank-mail-reanalysis.prompt.v1',
    'crm-agent-capabilities.tools.v1', 'bank-mail-reanalysis-policy.v1',
    repeat('a', 63) || '1', repeat('b', 63) || '1',
    clock_timestamp() - interval '1 minute', 1,
    clock_timestamp() - interval '16 minutes',
    clock_timestamp() - interval '16 minutes',
    clock_timestamp() - interval '1 minute'
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', expired_lease.owner_user_id)::text,
    true
  );
  statuses := public.get_my_mail_bank_agent_statuses(
    expired_lease.organization_id,
    expired_lease.connection_id,
    ARRAY[expired_lease.provider_message_hash]::text[]
  );
  IF statuses #>> '{0,reanalysis,state}' <> 'failed'
    OR statuses #>> '{0,reanalysis,canRerun}' <> 'true'
  THEN
    RAISE EXCEPTION 'expired_lease_status_was_not_rerunnable';
  END IF;
  operation := public.request_my_bank_mail_agent_reanalysis(
    expired_lease.organization_id, expired_lease.connection_id,
    expired_lease.provider_message_hash, expired_lease.source_hash
  );
  IF operation ->> 'accepted' <> 'true'
    OR operation ->> 'attemptNo' <> '2'
    OR NOT EXISTS (
      SELECT 1
      FROM private.mail_bank_agent_reanalysis_requests AS request
      WHERE request.id = request_id
        AND request.state = 'failed'
        AND request.failure_code = 'dispatch_failed'
    )
  THEN
    RAISE EXCEPTION 'expired_lease_reanalysis_recovery_failed';
  END IF;

  -- Record the dedicated authentication failure result on a separate attempt.
  -- First leave a queued request older than the bounded 15-minute recovery
  -- window, mirroring a Data API outage before claim/fail cleanup.
  INSERT INTO private.mail_bank_agent_reanalysis_requests (
    id, organization_id, owner_user_id, connection_id, intake_id,
    requested_by_user_id, attempt_no, state, requested_at, updated_at
  ) VALUES (
    stale_security_request_id, security.organization_id, security.owner_user_id,
    security.connection_id, security.intake_id, security.owner_user_id,
    1, 'queued', clock_timestamp() - interval '16 minutes',
    clock_timestamp() - interval '16 minutes'
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', security.owner_user_id)::text,
    true
  );
  operation := public.request_my_bank_mail_agent_reanalysis(
    security.organization_id, security.connection_id,
    security.provider_message_hash, security.source_hash
  );
  IF operation ->> 'accepted' <> 'true'
    OR operation ->> 'attemptNo' <> '2'
    OR NOT EXISTS (
      SELECT 1
      FROM private.mail_bank_agent_reanalysis_requests AS request
      WHERE request.id = stale_security_request_id
        AND request.state = 'failed'
        AND request.failure_code = 'dispatch_failed'
    )
  THEN
    RAISE EXCEPTION 'stale_queued_reanalysis_recovery_failed';
  END IF;
  request_id := (operation ->> 'requestId')::uuid;
  normalized_hash := repeat('7', 64);
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service', 'source', 'crm-bank-mail-reanalysis-claim-v1',
      'serviceId', 'openexpert-crm-bank-mail-reanalysis', 'preset', 'bank-mail-reanalysis',
      'organizationId', security.organization_id,
      'reanalysisRequestId', request_id, 'intakeId', security.intake_id,
      'connectionId', security.connection_id,
      'mailboxOwnerUserId', security.owner_user_id,
      'model', 'deepseek/deepseek-v4-flash-0731',
      'promptVersion', 'bank-mail-reanalysis.prompt.v1',
      'toolsetVersion', 'crm-agent-capabilities.tools.v1',
      'policyVersion', 'bank-mail-reanalysis-policy.v1',
      'normalizedInputSha256', normalized_hash
    )::text, true
  );
  claim_result := public.claim_bank_mail_agent_reanalysis(
    request_id, 'deepseek/deepseek-v4-flash-0731',
    'bank-mail-reanalysis.prompt.v1', 'crm-agent-capabilities.tools.v1',
    'bank-mail-reanalysis-policy.v1', normalized_hash
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'bank-mail-reanalysis-eve-session-bind-v1',
      'serviceId', 'openexpert-bank-mail-reanalysis-eve-agent',
      'preset', 'bank-mail-reanalysis', 'organizationId', security.organization_id,
      'reanalysisRequestId', request_id, 'intakeId', security.intake_id,
      'connectionId', security.connection_id,
      'mailboxOwnerUserId', security.owner_user_id,
      'eveSessionId', 'eve_reanalysis_security_0086'
    )::text, true
  );
  PERFORM public.bind_bank_mail_agent_reanalysis_session(
    request_id,
    '2387d71e98cf6688b7096ce52b64112265beaa30626e69063a7e86c681ad6322',
    'eve_reanalysis_security_0086'
  );
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service', 'source', 'bank-mail-reanalysis-result-v1',
      'serviceId', 'openexpert-bank-mail-reanalysis-eve-agent',
      'preset', 'bank-mail-reanalysis', 'organizationId', security.organization_id,
      'reanalysisRequestId', request_id, 'intakeId', security.intake_id,
      'connectionId', security.connection_id,
      'mailboxOwnerUserId', security.owner_user_id,
      'eveSessionId', 'eve_reanalysis_security_0086',
      'resultCode', 'security_rejected', 'classification', NULL,
      'caseId', NULL, 'applicationId', NULL,
      'evidenceCodes', ARRAY[]::text[], 'contradictionCodes', ARRAY[]::text[],
      'reasonCodes', ARRAY['dkim_not_aligned']::text[]
    )::text, true
  );
  record_result := public.record_bank_mail_agent_reanalysis_result(
    request_id, 'security_rejected', NULL, NULL, NULL,
    ARRAY[]::text[], ARRAY[]::text[], ARRAY['dkim_not_aligned']::text[]
  );
  IF record_result ->> 'state' <> 'completed' THEN
    RAISE EXCEPTION 'security_rejected_advisory_not_recorded';
  END IF;

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'authenticated', 'sub', proposal.owner_user_id)::text,
    true
  );
  statuses := public.get_my_mail_bank_agent_statuses(
    proposal.organization_id,
    proposal.connection_id,
    ARRAY[
      proposal.provider_message_hash,
      stale_failure.provider_message_hash,
      security.provider_message_hash
    ]::text[]
  );
  SELECT item INTO proposal_status
  FROM jsonb_array_elements(statuses) AS row(item)
  WHERE item ->> 'providerMessageIdSha256' = proposal.provider_message_hash;
  SELECT item INTO stale_status
  FROM jsonb_array_elements(statuses) AS row(item)
  WHERE item ->> 'providerMessageIdSha256' = stale_failure.provider_message_hash;
  SELECT item INTO security_status
  FROM jsonb_array_elements(statuses) AS row(item)
  WHERE item ->> 'providerMessageIdSha256' = security.provider_message_hash;

  IF proposal_status #>> '{result,code}' <> 'proposal_created'
    OR proposal_status #>> '{link,state}' <> 'linked'
    OR proposal_status #>> '{link,caseId}' <> proposal.case_id::text
    OR proposal_status #>> '{reanalysis,state}' <> 'completed'
    OR proposal_status #>> '{reanalysis,result,code}' <> 'proposal_created'
    OR proposal_status #>> '{reanalysis,result,caseId}' <> proposal.case_id::text
  THEN
    RAISE EXCEPTION 'canonical_or_advisory_proposal_status_invalid';
  END IF;
  IF stale_status #>> '{reanalysis,state}' <> 'failed'
    OR (stale_status #> '{reanalysis,result}') <> 'null'::jsonb
  THEN
    RAISE EXCEPTION 'failed_reanalysis_status_invalid';
  END IF;
  IF security_status #>> '{reanalysis,state}' <> 'completed'
    OR security_status #>> '{reanalysis,result,code}' <> 'security_rejected'
    OR security_status #> '{reanalysis,result,caseId}' <> 'null'::jsonb
  THEN
    RAISE EXCEPTION 'security_rejected_status_invalid';
  END IF;
  IF statuses::text ~ '"(requestId|intakeId|runId|sessionId|normalizedInputSha256)"'
  THEN
    RAISE EXCEPTION 'mailbox_status_leaked_private_reanalysis_identity';
  END IF;

  IF (SELECT count(*) FROM public.mail_bank_agent_match_proposals
      WHERE intake_id = proposal.intake_id) <> 1
    OR (SELECT count(*) FROM public.mail_context_thread_links
        WHERE organization_id = proposal.organization_id
          AND owner_user_id = proposal.owner_user_id
          AND connection_id = proposal.connection_id
          AND thread_key_hash = repeat('1', 64)) <> 1
  THEN
    RAISE EXCEPTION 'advisory_reanalysis_mutated_canonical_or_link_ledger';
  END IF;

  -- Current identity deactivation is an immediate request/status kill switch.
  UPDATE public.mortgage_bank_email_identities
  SET is_active = false
  WHERE sender_domain = 'openexpert.app';
  IF (public.get_my_mail_bank_agent_statuses(
      proposal.organization_id,
      proposal.connection_id,
      ARRAY[proposal.provider_message_hash]::text[]
    ) #>> '{0,reanalysis,canRerun}') <> 'false'
  THEN
    RAISE EXCEPTION 'reanalysis_identity_kill_switch_not_reflected';
  END IF;
  BEGIN
    PERFORM public.request_my_bank_mail_agent_reanalysis(
      proposal.organization_id, proposal.connection_id,
      proposal.provider_message_hash, proposal.source_hash
    );
    RAISE EXCEPTION 'reanalysis_identity_kill_switch_was_bypassed';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$bank_mail_0086_reanalysis$;

ROLLBACK;
