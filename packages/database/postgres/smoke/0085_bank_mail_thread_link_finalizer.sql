-- Rollback-only end-to-end coverage for migration 0085's durable finalizer,
-- EVE session-start self-bind, legacy rollout fallback and conflict ceiling.

BEGIN;
SET LOCAL row_security = off;

CREATE TEMP TABLE bank_mail_0085_finalizer_state (
  scenario text PRIMARY KEY,
  intake_id uuid NOT NULL,
  run_id uuid NOT NULL,
  case_id uuid NOT NULL,
  thread_key_hash text NOT NULL
) ON COMMIT DROP;

DO $bank_mail_0085_finalizer_setup$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  owner_user_id_value uuid := gen_random_uuid();
  connection_id_value uuid := gen_random_uuid();
  client_id_value uuid := gen_random_uuid();
  case_id_value uuid := gen_random_uuid();
  case_item_id_value uuid := gen_random_uuid();
  submission_id_value uuid := gen_random_uuid();
  offer_id_value uuid := gen_random_uuid();
  product_type_id_value uuid;
  bank_id_value uuid;
  claim_result jsonb;
  run_result jsonb;
  bind_result jsonb;
  proposal_result jsonb;
  signed_intake_id uuid;
  legacy_intake_id uuid;
  conflict_intake_id uuid;
BEGIN
  SELECT bank.id
  INTO STRICT bank_id_value
  FROM public.mortgage_banks AS bank
  JOIN public.mortgage_bank_email_identities AS identity
    ON identity.bank_id = bank.id
  WHERE bank.slug = 'openexpert-bank'
    AND bank.is_mock
    AND identity.sender_domain = 'openexpert.app'
    AND NOT identity.allow_subdomains
    AND identity.authentication_policy = 'openexpert_mock_dkim_aligned';

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
    '0085 Finalizer Owner',
    '0085-finalizer-' || replace(owner_user_id_value::text, '-', '') || '@example.test',
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
    '0085 finalizer smoke',
    'bank-mail-finalizer-0085-' || replace(organization_id_value::text, '-', ''),
    'intermediary',
    'not_required'
  );

  INSERT INTO public.users (id, organization_id, email, role, full_name)
  VALUES (
    owner_user_id_value,
    organization_id_value,
    '0085-finalizer-' || replace(owner_user_id_value::text, '-', '') || '@example.test',
    'admin',
    '0085 Finalizer Owner'
  );

  -- These rollback-only rows are structural fixtures, not a seat-accounting,
  -- legal-document or mortgage-calculator test. Disable unrelated USER
  -- triggers around each direct fixture insert and restore them immediately.
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
    '0085-finalizer-account',
    '0085-finalizer@example.test',
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
    '0085 Finalizer Client'
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
    '0085 Finalizer Case'
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
    '0085 Mortgage'
  );

  INSERT INTO public.crm_item_submissions (
    id,
    organization_id,
    case_item_id
  ) VALUES (
    submission_id_value,
    organization_id_value,
    case_item_id_value
  );

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
    '0085 Smoke Product',
    '0085-smoke',
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
    submission_id_value,
    organization_id_value,
    case_id_value,
    case_item_id_value,
    offer_id_value,
    bank_id_value,
    1,
    owner_user_id_value
  );
  EXECUTE 'ALTER TABLE public.crm_case_bank_applications ENABLE TRIGGER USER';

  -- New signed ingress: propose first, then let the EVE session.started hook
  -- self-bind with its exact JWT after the CRM caller has effectively crashed.
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
      'threadKeySha256', repeat('5', 64),
      'threadReference', 'thread_signed_self_bind',
      'dkimAligned', true
    )::text,
    true
  );
  claim_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('a', 63) || '1',
    repeat('b', 63) || '1',
    'openexpert.app',
    'failed',
    false,
    false,
    bank_id_value
  );
  signed_intake_id := (claim_result ->> 'intakeId')::uuid;
  run_result := public.claim_bank_mail_agent_run(
    signed_intake_id,
    'deepseek/deepseek-v4-flash-0731'
  );
  proposal_result := public.propose_bank_mail_case_match(
    signed_intake_id,
    (run_result ->> 'runId')::uuid,
    case_id_value,
    submission_id_value,
    'strong_candidate',
    ARRAY['bank_application_reference']::text[],
    ARRAY[]::text[]
  );

  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'bank-mail-eve-session-bind-v1',
      'serviceId', 'openexpert-bank-mail-eve-agent',
      'preset', 'bank-mail-session-bind',
      'organizationId', organization_id_value,
      'intakeId', signed_intake_id,
      'analysisRunId', run_result ->> 'runId',
      'connectionId', connection_id_value,
      'mailboxOwnerUserId', owner_user_id_value,
      'eveSessionId', 'eve_signed_self_bind_0085'
    )::text,
    true
  );
  bind_result := public.bind_bank_mail_agent_run_session(
    (run_result ->> 'runId')::uuid,
    'fe40bb62a8cd06ddce32f56c9e2434b44da8506f67b6eca5fc61ea205db0dc35',
    'eve_signed_self_bind_0085'
  );
  IF bind_result ->> 'sessionId' <> 'eve_signed_self_bind_0085'
    OR public.get_strong_bank_mail_agent_proposal_case(signed_intake_id)
      IS DISTINCT FROM case_id_value
  THEN
    RAISE EXCEPTION 'eve_self_bind_did_not_finalize_signed_job';
  END IF;

  -- A later CRM replay with the real lease token remains idempotent even
  -- though the proposal has already completed the lease.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'openexpert_service')::text,
    true
  );
  bind_result := public.bind_bank_mail_agent_run_session(
    (run_result ->> 'runId')::uuid,
    run_result ->> 'leaseToken',
    'eve_signed_self_bind_0085'
  );
  IF bind_result ->> 'replayed' <> 'true' THEN
    RAISE EXCEPTION 'crm_bind_replay_after_eve_hook_was_not_idempotent';
  END IF;

  -- Ordinary/generic JWTs never inherit the hook bypass: an invalid real
  -- lease token must fail even when the requested session is already bound.
  BEGIN
    PERFORM public.bind_bank_mail_agent_run_session(
      (run_result ->> 'runId')::uuid,
      repeat('0', 64),
      'eve_signed_self_bind_0085'
    );
    RAISE EXCEPTION 'generic_jwt_wrong_lease_token_was_accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', '{}'::jsonb::text, true);
  BEGIN
    PERFORM public.bind_bank_mail_agent_run_session(
      (run_result ->> 'runId')::uuid,
      repeat('0', 64),
      'eve_signed_self_bind_0085'
    );
    RAISE EXCEPTION 'empty_jwt_wrong_lease_token_was_accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  -- Sentinel use with a partial hook scope must fail before an existing
  -- binding can make the request appear idempotent.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'bank-mail-eve-session-bind-v1'
    )::text,
    true
  );
  BEGIN
    PERFORM public.bind_bank_mail_agent_run_session(
      (run_result ->> 'runId')::uuid,
      'fe40bb62a8cd06ddce32f56c9e2434b44da8506f67b6eca5fc61ea205db0dc35',
      'eve_signed_self_bind_0085'
    );
    RAISE EXCEPTION 'partial_eve_self_bind_claims_were_accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO bank_mail_0085_finalizer_state
  VALUES (
    'signed_self_bind',
    signed_intake_id,
    (run_result ->> 'runId')::uuid,
    case_id_value,
    repeat('5', 64)
  );

  -- Old app + new DB: no custom claims means strict DMARC and no job. The
  -- unchanged getter must still expose the single fully-proven strong result.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'openexpert_service')::text,
    true
  );
  claim_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('a', 63) || '2',
    repeat('b', 63) || '2',
    'openexpert.app',
    'passed',
    true,
    false,
    bank_id_value
  );
  legacy_intake_id := (claim_result ->> 'intakeId')::uuid;
  IF claim_result ->> 'authenticationPolicy' <> 'dmarc_aligned'
    OR claim_result ->> 'identityVerdict' <> 'trusted_bank'
    OR EXISTS (
      SELECT 1
      FROM private.mail_bank_agent_thread_link_jobs AS job
      WHERE job.intake_id = legacy_intake_id
    )
  THEN
    RAISE EXCEPTION 'legacy_claim_did_not_remain_strict_dmarc_no_job';
  END IF;

  run_result := public.claim_bank_mail_agent_run(
    legacy_intake_id,
    'deepseek/deepseek-v4-flash-0731'
  );
  PERFORM public.bind_bank_mail_agent_run_session(
    (run_result ->> 'runId')::uuid,
    run_result ->> 'leaseToken',
    'eve_legacy_rollout_0085'
  );
  PERFORM public.propose_bank_mail_case_match(
    legacy_intake_id,
    (run_result ->> 'runId')::uuid,
    case_id_value,
    submission_id_value,
    'strong_candidate',
    ARRAY['bank_application_reference']::text[],
    ARRAY[]::text[]
  );
  IF public.get_strong_bank_mail_agent_proposal_case(legacy_intake_id)
    IS DISTINCT FROM case_id_value
  THEN
    RAISE EXCEPTION 'legacy_strict_dmarc_getter_fallback_failed';
  END IF;

  -- This mirrors the pre-0085 worker's existing post-poll upsert.
  INSERT INTO public.mail_context_thread_links (
    organization_id,
    owner_user_id,
    connection_id,
    thread_key_hash,
    thread_reference,
    case_id,
    link_source
  ) VALUES (
    organization_id_value,
    owner_user_id_value,
    connection_id_value,
    repeat('7', 64),
    'thread_legacy_external',
    case_id_value,
    'bank_mail_agent'
  );

  INSERT INTO bank_mail_0085_finalizer_state
  VALUES (
    'legacy_rollout',
    legacy_intake_id,
    (run_result ->> 'runId')::uuid,
    case_id_value,
    repeat('7', 64)
  );

  -- A pre-existing client-only context for the same signed thread is a hard
  -- conflict even when Eve emits an otherwise valid strong case proposal.
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
      'threadKeySha256', repeat('6', 64),
      'threadReference', 'thread_client_conflict',
      'dkimAligned', true
    )::text,
    true
  );
  claim_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('a', 63) || '3',
    repeat('b', 63) || '3',
    'openexpert.app',
    'failed',
    false,
    false,
    bank_id_value
  );
  conflict_intake_id := (claim_result ->> 'intakeId')::uuid;

  INSERT INTO public.mail_context_thread_links (
    organization_id,
    owner_user_id,
    connection_id,
    thread_key_hash,
    thread_reference,
    client_id,
    link_source
  ) VALUES (
    organization_id_value,
    owner_user_id_value,
    connection_id_value,
    repeat('6', 64),
    'thread_client_conflict',
    client_id_value,
    'manual'
  );

  run_result := public.claim_bank_mail_agent_run(
    conflict_intake_id,
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
    'eve_client_conflict_0085'
  );
  PERFORM public.propose_bank_mail_case_match(
    conflict_intake_id,
    (run_result ->> 'runId')::uuid,
    case_id_value,
    submission_id_value,
    'strong_candidate',
    ARRAY['bank_application_reference']::text[],
    ARRAY[]::text[]
  );

  INSERT INTO bank_mail_0085_finalizer_state
  VALUES (
    'client_conflict',
    conflict_intake_id,
    (run_result ->> 'runId')::uuid,
    case_id_value,
    repeat('6', 64)
  );
END
$bank_mail_0085_finalizer_setup$;

-- Fire the proposal/intake finalizers and bilateral link validators now so
-- assertions observe the same state that COMMIT would expose.
SET CONSTRAINTS ALL IMMEDIATE;

DO $bank_mail_0085_finalizer_assertions$
DECLARE
  state_row bank_mail_0085_finalizer_state%rowtype;
  metadata_value jsonb;
BEGIN
  SELECT * INTO STRICT state_row
  FROM bank_mail_0085_finalizer_state
  WHERE scenario = 'signed_self_bind';
  IF NOT EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_thread_link_jobs AS job
    JOIN public.mail_context_thread_links AS link
      ON link.id = job.link_id
     AND link.organization_id = job.organization_id
     AND link.owner_user_id = job.owner_user_id
     AND link.connection_id = job.connection_id
     AND link.thread_key_hash = job.thread_key_hash
     AND link.case_id = job.resolved_case_id
     AND link.client_id IS NULL
    WHERE job.intake_id = state_row.intake_id
      AND job.state = 'linked'
      AND job.resolution_code = 'strong_proposal_linked'
      AND link.link_source = 'bank_mail_agent'
  ) THEN
    RAISE EXCEPTION 'signed_self_bind_job_or_live_link_missing';
  END IF;

  metadata_value := public.get_bank_mail_agent_intake(state_row.intake_id);
  IF metadata_value ->> 'authenticationPolicy'
      <> 'openexpert_mock_dkim_aligned'
    OR metadata_value ->> 'dkimAligned' <> 'true'
    OR metadata_value ? 'threadReference'
    OR metadata_value::text LIKE '%thread_signed_self_bind%'
  THEN
    RAISE EXCEPTION 'eve_metadata_policy_or_thread_redaction_invalid';
  END IF;

  SELECT * INTO STRICT state_row
  FROM bank_mail_0085_finalizer_state
  WHERE scenario = 'legacy_rollout';
  IF EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_thread_link_jobs AS job
    WHERE job.intake_id = state_row.intake_id
  )
    OR public.get_strong_bank_mail_agent_proposal_case(state_row.intake_id)
      IS DISTINCT FROM state_row.case_id
    OR NOT EXISTS (
      SELECT 1
      FROM public.mail_context_thread_links AS link
      WHERE link.thread_key_hash = state_row.thread_key_hash
        AND link.case_id = state_row.case_id
        AND link.link_source = 'bank_mail_agent'
    )
  THEN
    RAISE EXCEPTION 'old_app_new_db_rollout_flow_failed';
  END IF;

  SELECT * INTO STRICT state_row
  FROM bank_mail_0085_finalizer_state
  WHERE scenario = 'client_conflict';
  IF NOT EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_thread_link_jobs AS job
    WHERE job.intake_id = state_row.intake_id
      AND job.state = 'conflict'
      AND job.resolution_code = 'thread_linked_to_other_context'
      AND job.conflict_client_id IS NOT NULL
  )
    OR EXISTS (
      SELECT 1
      FROM public.mail_context_thread_links AS link
      WHERE link.thread_key_hash = state_row.thread_key_hash
        AND link.link_source = 'bank_mail_agent'
    )
    OR public.get_strong_bank_mail_agent_proposal_case(state_row.intake_id)
      IS NOT NULL
  THEN
    RAISE EXCEPTION 'client_context_conflict_was_not_fail_closed';
  END IF;
END
$bank_mail_0085_finalizer_assertions$;

ROLLBACK;
