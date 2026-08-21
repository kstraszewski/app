-- Rollback-only behavioral coverage for the bank-mail policy and durable
-- thread-link registration introduced by migration 0085.

BEGIN;
SET LOCAL row_security = off;

DO $bank_mail_thread_link_policy_smoke$
DECLARE
  organization_id_value uuid := gen_random_uuid();
  owner_user_id_value uuid := gen_random_uuid();
  connection_id_value uuid := gen_random_uuid();
  openexpert_bank_id_value uuid;
  openexpert_identity_id_value uuid;
  real_bank_id_value uuid;
  trusted_result jsonb;
  rejected_result jsonb;
  legacy_result jsonb;
  provider_hash_value text;
  source_hash_value text;
  sender_hash_value text := encode(
    extensions.digest(convert_to('openexpert.app', 'utf8'), 'sha256'),
    'hex'
  );
  intake_key_value text;
  legacy_intake_id uuid;
BEGIN
  SELECT bank.id, identity.id
  INTO STRICT openexpert_bank_id_value, openexpert_identity_id_value
  FROM public.mortgage_banks AS bank
  JOIN public.mortgage_bank_email_identities AS identity
    ON identity.bank_id = bank.id
  WHERE bank.slug = 'openexpert-bank'
    AND bank.is_mock
    AND identity.sender_domain = 'openexpert.app'
    AND NOT identity.allow_subdomains
    AND identity.authentication_policy = 'openexpert_mock_dkim_aligned';

  SELECT bank.id
  INTO STRICT real_bank_id_value
  FROM public.mortgage_banks AS bank
  WHERE NOT bank.is_mock
  ORDER BY bank.created_at, bank.id
  LIMIT 1;

  INSERT INTO identity.users (id, name, email, email_verified)
  VALUES (
    owner_user_id_value,
    '0085 Smoke Owner',
    '0085-' || replace(owner_user_id_value::text, '-', '') || '@example.test',
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
    '0085 bank mail smoke',
    'bank-mail-0085-' || replace(organization_id_value::text, '-', ''),
    'intermediary',
    'not_required'
  );

  INSERT INTO public.users (id, organization_id, email, role, full_name)
  VALUES (
    owner_user_id_value,
    organization_id_value,
    '0085-' || replace(owner_user_id_value::text, '-', '') || '@example.test',
    'admin',
    '0085 Smoke Owner'
  );

  -- This fixture is not exercising seat accounting. Fresh scratch databases
  -- may have been migrated by the bootstrap superuser rather than the final
  -- table owner, so suppress unrelated membership/billing triggers only for
  -- this rollback-only insert.
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
    '0085-smoke-account',
    '0085-smoke@example.test',
    'active'
  );

  INSERT INTO public.mortgage_bank_email_identities (
    bank_id,
    sender_domain,
    allow_subdomains,
    authentication_policy,
    is_active
  ) VALUES (
    real_bank_id_value,
    'real-bank-0085.example',
    false,
    'dmarc_aligned',
    true
  );

  -- Gmail may report aggregate DMARC failure while separately proving an
  -- aligned DKIM signature. Only the exact OpenExpert mock policy may trust it.
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
      'threadReference', 'thread_oeb_dkim_pass',
      'dkimAligned', true
    )::text,
    true
  );
  trusted_result := public.claim_bank_mail_agent_intake(
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
    openexpert_bank_id_value
  );
  IF trusted_result ->> 'identityVerdict' <> 'trusted_bank'
    OR trusted_result ->> 'authenticationPolicy' <> 'openexpert_mock_dkim_aligned'
    OR trusted_result ->> 'dkimAligned' <> 'true'
    OR NOT EXISTS (
      SELECT 1
      FROM private.mail_bank_agent_thread_link_jobs AS job
      WHERE job.intake_id = (trusted_result ->> 'intakeId')::uuid
        AND job.state = 'pending'
    )
  THEN
    RAISE EXCEPTION 'openexpert_aligned_dkim_was_not_trusted';
  END IF;

  -- The current identity policy is an operational kill switch for exception
  -- jobs that have not linked yet. A rollback migration may disable the
  -- immutable-config trigger explicitly; the pinned intake audit is retained.
  EXECUTE 'ALTER TABLE public.mortgage_bank_email_identities DISABLE TRIGGER USER';
  UPDATE public.mortgage_bank_email_identities AS identity
  SET authentication_policy = 'dmarc_aligned'
  WHERE identity.id = openexpert_identity_id_value;
  EXECUTE 'ALTER TABLE public.mortgage_bank_email_identities ENABLE TRIGGER USER';
  PERFORM private.finalize_bank_mail_agent_thread_link(
    (trusted_result ->> 'intakeId')::uuid
  );
  IF NOT EXISTS (
    SELECT 1
    FROM private.mail_bank_agent_thread_link_jobs AS job
    WHERE job.intake_id = (trusted_result ->> 'intakeId')::uuid
      AND job.state = 'not_linked'
      AND job.resolution_code = 'trusted_envelope_invalid'
  ) THEN
    RAISE EXCEPTION 'openexpert_dkim_policy_kill_switch_did_not_close_job';
  END IF;
  EXECUTE 'ALTER TABLE public.mortgage_bank_email_identities DISABLE TRIGGER USER';
  UPDATE public.mortgage_bank_email_identities AS identity
  SET authentication_policy = 'openexpert_mock_dkim_aligned'
  WHERE identity.id = openexpert_identity_id_value;
  EXECUTE 'ALTER TABLE public.mortgage_bank_email_identities ENABLE TRIGGER USER';

  -- SPF/aggregate pass alone cannot satisfy the exact DKIM policy.
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
      'threadKeySha256', repeat('2', 64),
      'threadReference', 'thread_oeb_spf_only',
      'dkimAligned', false
    )::text,
    true
  );
  rejected_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('c', 64),
    repeat('d', 64),
    'openexpert.app',
    'passed',
    false,
    false,
    openexpert_bank_id_value
  );
  IF rejected_result ->> 'identityVerdict' <> 'dkim_not_aligned'
    OR rejected_result ->> 'state' <> 'security_rejected'
  THEN
    RAISE EXCEPTION 'openexpert_spf_only_was_not_rejected';
  END IF;

  -- Aligned DKIM alone never weakens a real-bank DMARC identity.
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
      'threadKeySha256', repeat('3', 64),
      'threadReference', 'thread_real_bank_dkim_only',
      'dkimAligned', true
    )::text,
    true
  );
  rejected_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('e', 64),
    repeat('f', 64),
    'real-bank-0085.example',
    'passed',
    false,
    false,
    real_bank_id_value
  );
  IF rejected_result ->> 'identityVerdict' <> 'dmarc_not_aligned'
    OR rejected_result ->> 'authenticationPolicy' <> 'dmarc_aligned'
  THEN
    RAISE EXCEPTION 'real_bank_dkim_only_was_not_rejected';
  END IF;

  -- A caller cannot combine the OpenExpert domain with another bank id.
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
      'threadKeySha256', repeat('4', 64),
      'threadReference', 'thread_wrong_bank',
      'dkimAligned', true
    )::text,
    true
  );
  rejected_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('0', 63) || '1',
    repeat('0', 63) || '2',
    'openexpert.app',
    'passed',
    false,
    false,
    real_bank_id_value
  );
  IF rejected_result ->> 'identityVerdict' <> 'bank_id_mismatch' THEN
    RAISE EXCEPTION 'openexpert_wrong_bank_was_not_rejected';
  END IF;

  -- Migration-first rollout remains compatible with the old backend token,
  -- but that grace path is strict DMARC-only and creates no durable job.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object('role', 'openexpert_service')::text,
    true
  );
  rejected_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('0', 63) || '5',
    repeat('0', 63) || '6',
    'openexpert.app',
    'passed',
    false,
    false,
    openexpert_bank_id_value
  );
  IF rejected_result ->> 'identityVerdict' <> 'dmarc_not_aligned'
    OR rejected_result ->> 'authenticationPolicy' <> 'dmarc_aligned'
    OR EXISTS (
      SELECT 1
      FROM private.mail_bank_agent_thread_link_jobs AS job
      WHERE job.intake_id = (rejected_result ->> 'intakeId')::uuid
    )
  THEN
    RAISE EXCEPTION 'legacy_rollout_path_was_not_strict_dmarc_only';
  END IF;

  -- Presence of even one custom ingress claim disables the grace path and
  -- requires the complete signed scope.
  PERFORM set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'role', 'openexpert_service',
      'source', 'crm-bank-mail-ingress-v1'
    )::text,
    true
  );
  BEGIN
    PERFORM public.claim_bank_mail_agent_intake(
      organization_id_value,
      connection_id_value,
      owner_user_id_value,
      'google',
      repeat('0', 63) || '7',
      repeat('0', 63) || '8',
      'openexpert.app',
      'passed',
      false,
      false,
      openexpert_bank_id_value
    );
    RAISE EXCEPTION 'partial_ingress_claim_scope_was_accepted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;

  -- A new-policy replay must not mutate its pinned DKIM verdict.
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
      'threadReference', 'thread_oeb_dkim_pass',
      'dkimAligned', false
    )::text,
    true
  );
  BEGIN
    PERFORM public.claim_bank_mail_agent_intake(
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
      openexpert_bank_id_value
    );
    RAISE EXCEPTION 'new_policy_dkim_replay_mismatch_was_accepted';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  -- Simulate three pre-0085 rejected rows. Their default/pinned DMARC policy
  -- must ignore newly enriched DKIM without throwing, so the following new
  -- message in the same ingestion loop still reaches a trusted claim/job.
  FOR legacy_index IN 1..3 LOOP
    provider_hash_value := lpad(to_hex(legacy_index + 32), 64, '0');
    source_hash_value := lpad(to_hex(legacy_index + 48), 64, '0');
    intake_key_value := encode(
      extensions.digest(
        convert_to(
          'bank-mail-intake-v1' || chr(31)
            || organization_id_value::text || chr(31)
            || owner_user_id_value::text || chr(31)
            || connection_id_value::text || chr(31)
            || 'google' || chr(31)
            || provider_hash_value,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    );

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
      finalized_at
    ) VALUES (
      organization_id_value,
      owner_user_id_value,
      connection_id_value,
      openexpert_identity_id_value,
      'google',
      provider_hash_value,
      source_hash_value,
      sender_hash_value,
      intake_key_value,
      'dmarc_not_aligned',
      'passed',
      false,
      false,
      'dmarc_aligned',
      false,
      'security_rejected',
      ARRAY['dmarc_not_aligned']::text[],
      clock_timestamp()
    ) RETURNING id INTO legacy_intake_id;

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
        'threadKeySha256', repeat('8', 63) || legacy_index::text,
        'threadReference', 'thread_legacy_' || legacy_index::text,
        'dkimAligned', true
      )::text,
      true
    );
    legacy_result := public.claim_bank_mail_agent_intake(
      organization_id_value,
      connection_id_value,
      owner_user_id_value,
      'google',
      provider_hash_value,
      source_hash_value,
      'openexpert.app',
      'passed',
      false,
      false,
      openexpert_bank_id_value
    );
    IF legacy_result ->> 'identityVerdict' <> 'dmarc_not_aligned'
      OR legacy_result ->> 'replayed' <> 'true'
      OR EXISTS (
        SELECT 1
        FROM private.mail_bank_agent_thread_link_jobs AS job
        WHERE job.intake_id = legacy_intake_id
      )
    THEN
      RAISE EXCEPTION 'legacy_rejected_replay_was_not_preserved';
    END IF;
  END LOOP;

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
      'threadReference', 'thread_new_after_legacy',
      'dkimAligned', true
    )::text,
    true
  );
  trusted_result := public.claim_bank_mail_agent_intake(
    organization_id_value,
    connection_id_value,
    owner_user_id_value,
    'google',
    repeat('0', 63) || '3',
    repeat('0', 63) || '4',
    'openexpert.app',
    'failed',
    false,
    false,
    openexpert_bank_id_value
  );
  IF trusted_result ->> 'identityVerdict' <> 'trusted_bank'
    OR NOT EXISTS (
      SELECT 1
      FROM private.mail_bank_agent_thread_link_jobs AS job
      WHERE job.intake_id = (trusted_result ->> 'intakeId')::uuid
        AND job.state = 'pending'
    )
  THEN
    RAISE EXCEPTION 'new_mail_after_legacy_replays_did_not_reach_pending_job';
  END IF;
END
$bank_mail_thread_link_policy_smoke$;

ROLLBACK;
