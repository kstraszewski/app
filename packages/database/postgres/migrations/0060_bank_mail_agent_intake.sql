-- Privacy-minimal, service-only decision ledger for the inbound bank-mail agent.
--
-- No table below stores a message body, subject, snippet, participant name,
-- mailbox address, attachment filename, storage key or raw provider message ID.
-- Provider/message identities, sender domains and source bytes are represented
-- only by SHA-256 values. Agent decisions are restricted to controlled codes.

CREATE FUNCTION private.is_valid_bank_mail_agent_evidence_codes(p_codes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT p_codes IS NOT NULL
    AND cardinality(p_codes) BETWEEN 0 AND 12
    AND array_position(p_codes, NULL::text) IS NULL
    AND cardinality(p_codes) = (
      SELECT count(DISTINCT code)::integer
      FROM unnest(p_codes) AS evidence(code)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_codes) AS evidence(code)
      WHERE evidence.code NOT IN (
        'bank_application_reference',
        'applicant_identity',
        'expert_identity',
        'bank_identity',
        'case_context',
        'application_status',
        'attachment_metadata'
      )
    );
$$;

CREATE FUNCTION private.is_valid_bank_mail_agent_contradiction_codes(p_codes text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $$
  SELECT p_codes IS NOT NULL
    AND cardinality(p_codes) BETWEEN 0 AND 12
    AND array_position(p_codes, NULL::text) IS NULL
    AND cardinality(p_codes) = (
      SELECT count(DISTINCT code)::integer
      FROM unnest(p_codes) AS contradiction(code)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(p_codes) AS contradiction(code)
      WHERE contradiction.code NOT IN (
        'multiple_candidates',
        'bank_mismatch',
        'reference_mismatch',
        'owner_mismatch',
        'stale_application',
        'weak_evidence',
        'attachment_unavailable',
        'prompt_injection_suspected'
      )
    );
$$;

CREATE FUNCTION private.is_valid_bank_mail_agent_reason_codes(p_codes text[])
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
        'dmarc_not_aligned',
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

REVOKE ALL ON FUNCTION private.is_valid_bank_mail_agent_evidence_codes(text[])
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION private.is_valid_bank_mail_agent_contradiction_codes(text[])
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON FUNCTION private.is_valid_bank_mail_agent_reason_codes(text[])
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TABLE public.mortgage_bank_email_identities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bank_id uuid NOT NULL,
  sender_domain text NOT NULL,
  allow_subdomains boolean DEFAULT false NOT NULL,
  authentication_policy text DEFAULT 'dmarc_aligned'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mortgage_bank_email_identities_domain_key UNIQUE (sender_domain),
  CONSTRAINT mortgage_bank_email_identities_domain_check CHECK (
    sender_domain = lower(btrim(sender_domain))
    AND char_length(sender_domain) BETWEEN 3 AND 253
    AND sender_domain ~ E'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT mortgage_bank_email_identities_auth_policy_check CHECK (
    authentication_policy = 'dmarc_aligned'::text
  ),
  CONSTRAINT mortgage_bank_email_identities_bank_fkey FOREIGN KEY (bank_id)
    REFERENCES public.mortgage_banks (id) ON DELETE RESTRICT
);

CREATE INDEX mortgage_bank_email_identities_bank_idx
  ON public.mortgage_bank_email_identities (bank_id, is_active, sender_domain);

CREATE TRIGGER mortgage_bank_email_identities_set_updated_at
  BEFORE UPDATE ON public.mortgage_bank_email_identities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE FUNCTION private.protect_mortgage_bank_email_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.bank_id IS DISTINCT FROM OLD.bank_id
    OR NEW.sender_domain IS DISTINCT FROM OLD.sender_domain
    OR NEW.allow_subdomains IS DISTINCT FROM OLD.allow_subdomains
    OR NEW.authentication_policy IS DISTINCT FROM OLD.authentication_policy
  THEN
    RAISE EXCEPTION 'mortgage_bank_email_identity_is_immutable'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_mortgage_bank_email_identity()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER mortgage_bank_email_identities_protect_identity
  BEFORE UPDATE ON public.mortgage_bank_email_identities
  FOR EACH ROW EXECUTE FUNCTION private.protect_mortgage_bank_email_identity();

COMMENT ON TABLE public.mortgage_bank_email_identities IS
  'Service-only allowlist of bank-owned sender domains. It never contains mailbox local parts or individual addresses.';
COMMENT ON COLUMN public.mortgage_bank_email_identities.authentication_policy IS
  'Minimum trusted-envelope policy. MVP accepts only provider-authenticated, DMARC-aligned mail without a Reply-To mismatch.';

CREATE TABLE public.mail_bank_agent_intakes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  connection_id uuid,
  bank_email_identity_id uuid,
  provider text NOT NULL,
  provider_message_id_sha256 text NOT NULL,
  source_sha256 text NOT NULL,
  sender_domain_sha256 text NOT NULL,
  intake_key_sha256 text NOT NULL,
  identity_verdict text NOT NULL,
  authentication_status text NOT NULL,
  dmarc_aligned boolean NOT NULL,
  reply_to_mismatch boolean NOT NULL,
  status text NOT NULL,
  reason_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  claimed_at timestamptz DEFAULT now() NOT NULL,
  finalized_at timestamptz,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_intakes_scope_id_key
    UNIQUE (organization_id, owner_user_id, id),
  CONSTRAINT mail_bank_agent_intakes_ingress_key UNIQUE (
    organization_id,
    owner_user_id,
    connection_id,
    provider_message_id_sha256
  ),
  CONSTRAINT mail_bank_agent_intakes_business_key UNIQUE (intake_key_sha256),
  CONSTRAINT mail_bank_agent_intakes_provider_check CHECK (
    provider IN ('google', 'microsoft', 'imap')
  ),
  CONSTRAINT mail_bank_agent_intakes_hashes_check CHECK (
    provider_message_id_sha256 ~ '^[0-9a-f]{64}$'
    AND source_sha256 ~ '^[0-9a-f]{64}$'
    AND sender_domain_sha256 ~ '^[0-9a-f]{64}$'
    AND intake_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_intakes_identity_verdict_check CHECK (
    identity_verdict IN (
      'trusted_bank',
      'unknown_domain',
      'bank_id_mismatch',
      'authentication_failed',
      'authentication_indeterminate',
      'dmarc_not_aligned',
      'reply_to_mismatch'
    )
  ),
  CONSTRAINT mail_bank_agent_intakes_authentication_status_check CHECK (
    authentication_status IN ('passed', 'failed', 'indeterminate')
  ),
  CONSTRAINT mail_bank_agent_intakes_status_check CHECK (
    status IN (
      'claimed',
      'analyzing',
      'review_required',
      'no_match',
      'not_bank_mail',
      'security_rejected',
      'failed'
    )
  ),
  CONSTRAINT mail_bank_agent_intakes_reason_codes_check CHECK (
    private.is_valid_bank_mail_agent_reason_codes(reason_codes)
  ),
  CONSTRAINT mail_bank_agent_intakes_identity_state_check CHECK (
    (identity_verdict = 'trusted_bank' AND bank_email_identity_id IS NOT NULL)
    OR (identity_verdict <> 'trusted_bank' AND status = 'security_rejected')
  ),
  CONSTRAINT mail_bank_agent_intakes_finalized_check CHECK (
    (status IN ('claimed', 'analyzing') AND finalized_at IS NULL)
    OR (status NOT IN ('claimed', 'analyzing') AND finalized_at IS NOT NULL)
  ),
  CONSTRAINT mail_bank_agent_intakes_organization_fkey FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_intakes_connection_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    connection_id
  ) REFERENCES public.mail_connections (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE SET NULL (connection_id),
  CONSTRAINT mail_bank_agent_intakes_identity_fkey FOREIGN KEY (bank_email_identity_id)
    REFERENCES public.mortgage_bank_email_identities (id) ON DELETE RESTRICT
);

CREATE INDEX mail_bank_agent_intakes_owner_status_idx
  ON public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    status,
    claimed_at DESC
  );

COMMENT ON TABLE public.mail_bank_agent_intakes IS
  'PII-free ingress and lifecycle ledger. Raw provider IDs, sender domains and message bytes are retained only as SHA-256 values.';
COMMENT ON COLUMN public.mail_bank_agent_intakes.provider_message_id_sha256 IS
  'SHA-256 of the provider-scoped stable message identity; never the raw provider ID.';
COMMENT ON COLUMN public.mail_bank_agent_intakes.source_sha256 IS
  'SHA-256 of the exact canonical source bytes inspected by the intake worker; no source bytes are stored here.';

CREATE TABLE public.mail_bank_agent_attachments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  attachment_ordinal smallint NOT NULL,
  attachment_token_sha256 text NOT NULL,
  source_sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  mime_category text NOT NULL,
  encryption_status text DEFAULT 'unknown'::text NOT NULL,
  scan_status text DEFAULT 'pending'::text NOT NULL,
  extraction_status text DEFAULT 'pending'::text NOT NULL,
  credential_kind_used text,
  derived_sha256 text,
  scanned_at timestamptz,
  extracted_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_attachments_scope_id_key
    UNIQUE (organization_id, owner_user_id, intake_id, id),
  CONSTRAINT mail_bank_agent_attachments_ordinal_key
    UNIQUE (intake_id, attachment_ordinal),
  CONSTRAINT mail_bank_agent_attachments_source_key
    UNIQUE (intake_id, source_sha256),
  CONSTRAINT mail_bank_agent_attachments_token_key
    UNIQUE (intake_id, attachment_token_sha256),
  CONSTRAINT mail_bank_agent_attachments_ordinal_check CHECK (
    attachment_ordinal BETWEEN 0 AND 19
  ),
  CONSTRAINT mail_bank_agent_attachments_hashes_check CHECK (
    attachment_token_sha256 ~ '^[0-9a-f]{64}$'
    AND source_sha256 ~ '^[0-9a-f]{64}$'
    AND (derived_sha256 IS NULL OR derived_sha256 ~ '^[0-9a-f]{64}$')
  ),
  CONSTRAINT mail_bank_agent_attachments_size_check CHECK (
    size_bytes BETWEEN 0 AND 52428800
  ),
  CONSTRAINT mail_bank_agent_attachments_mime_category_check CHECK (
    mime_category IN ('pdf', 'archive', 'office', 'image', 'text', 'other')
  ),
  CONSTRAINT mail_bank_agent_attachments_encryption_status_check CHECK (
    encryption_status IN ('unknown', 'not_encrypted', 'encrypted', 'unlocked', 'failed')
  ),
  CONSTRAINT mail_bank_agent_attachments_scan_status_check CHECK (
    scan_status IN ('pending', 'clean', 'blocked', 'failed')
  ),
  CONSTRAINT mail_bank_agent_attachments_extraction_status_check CHECK (
    extraction_status IN ('pending', 'not_applicable', 'extracted', 'blocked', 'failed')
  ),
  CONSTRAINT mail_bank_agent_attachments_credential_kind_check CHECK (
    credential_kind_used IS NULL
    OR credential_kind_used IN ('primary_pesel', 'applicant_pesel', 'company_nip')
  ),
  CONSTRAINT mail_bank_agent_attachments_unlock_evidence_check CHECK (
    (credential_kind_used IS NULL OR encryption_status = 'unlocked')
    AND (
      (extraction_status = 'extracted' AND derived_sha256 IS NOT NULL)
      OR (extraction_status <> 'extracted' AND derived_sha256 IS NULL)
    )
    AND (
      extraction_status <> 'extracted'
      OR (
        scan_status = 'clean'
        AND encryption_status IN ('not_encrypted', 'unlocked')
      )
    )
    AND (scan_status <> 'blocked' OR extraction_status <> 'extracted')
  ),
  CONSTRAINT mail_bank_agent_attachments_scan_time_check CHECK (
    (scan_status = 'pending' AND scanned_at IS NULL)
    OR (scan_status <> 'pending' AND scanned_at IS NOT NULL)
  ),
  CONSTRAINT mail_bank_agent_attachments_extraction_time_check CHECK (
    (extraction_status = 'pending' AND extracted_at IS NULL)
    OR (extraction_status <> 'pending' AND extracted_at IS NOT NULL)
  ),
  CONSTRAINT mail_bank_agent_attachments_intake_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id
  ) REFERENCES public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE
);

CREATE INDEX mail_bank_agent_attachments_status_idx
  ON public.mail_bank_agent_attachments (
    intake_id,
    scan_status,
    extraction_status,
    attachment_ordinal
  );

CREATE TRIGGER mail_bank_agent_attachments_set_updated_at
  BEFORE UPDATE ON public.mail_bank_agent_attachments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.mail_bank_agent_attachments IS
  'PII-free quarantine/decryption metadata. It stores no filename, storage location, secret value or raw provider attachment token.';
COMMENT ON COLUMN public.mail_bank_agent_attachments.credential_kind_used IS
  'Only the credential strategy category used by the bounded decrypt worker; never a PESEL, NIP or password value.';

CREATE TABLE public.mail_bank_agent_analysis_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  run_key_sha256 text NOT NULL,
  source_sha256 text NOT NULL,
  normalized_input_sha256 text NOT NULL,
  provider text DEFAULT 'vercel-ai-gateway'::text NOT NULL,
  model text NOT NULL,
  prompt_version text NOT NULL,
  toolset_version text NOT NULL,
  policy_version text NOT NULL,
  actor_kind text DEFAULT 'bank_mail_agent'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_analysis_runs_scope_id_key
    UNIQUE (organization_id, owner_user_id, intake_id, id),
  CONSTRAINT mail_bank_agent_analysis_runs_business_key UNIQUE (run_key_sha256),
  CONSTRAINT mail_bank_agent_analysis_runs_hashes_check CHECK (
    run_key_sha256 ~ '^[0-9a-f]{64}$'
    AND source_sha256 ~ '^[0-9a-f]{64}$'
    AND normalized_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_analysis_runs_provider_check CHECK (
    provider = 'vercel-ai-gateway'::text
  ),
  CONSTRAINT mail_bank_agent_analysis_runs_model_check CHECK (
    model = 'deepseek/deepseek-v4-flash-0731'::text
  ),
  CONSTRAINT mail_bank_agent_analysis_runs_versions_check CHECK (
    prompt_version = 'bank-mail-agent.prompt.v1'::text
    AND toolset_version = 'crm-agent-capabilities.tools.v1'::text
    AND policy_version = 'bank-mail-match-policy.v1'::text
  ),
  CONSTRAINT mail_bank_agent_analysis_runs_actor_check CHECK (
    actor_kind = 'bank_mail_agent'::text
  ),
  CONSTRAINT mail_bank_agent_analysis_runs_intake_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id
  ) REFERENCES public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE
);

CREATE INDEX mail_bank_agent_analysis_runs_intake_idx
  ON public.mail_bank_agent_analysis_runs (intake_id, created_at DESC);

COMMENT ON TABLE public.mail_bank_agent_analysis_runs IS
  'Immutable identity of one normalized-input/model/prompt/toolset/policy analysis. Prompt and message content are never stored.';

-- Mutable coordination state is deliberately separated from the immutable run
-- identity. No Data API role can access this lease table directly.
CREATE TABLE private.mail_bank_agent_analysis_leases (
  analysis_run_id uuid PRIMARY KEY,
  lease_token_sha256 text,
  lease_expires_at timestamptz,
  claim_count integer DEFAULT 1 NOT NULL,
  state text DEFAULT 'claimed'::text NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_analysis_leases_token_check CHECK (
    lease_token_sha256 IS NULL OR lease_token_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_analysis_leases_claim_count_check CHECK (
    claim_count BETWEEN 1 AND 10
  ),
  CONSTRAINT mail_bank_agent_analysis_leases_state_check CHECK (
    state IN ('claimed', 'session_bound', 'completed', 'failed')
  ),
  CONSTRAINT mail_bank_agent_analysis_leases_active_check CHECK (
    (state IN ('claimed', 'session_bound')
      AND lease_token_sha256 IS NOT NULL
      AND lease_expires_at IS NOT NULL)
    OR (state IN ('completed', 'failed'))
  ),
  CONSTRAINT mail_bank_agent_analysis_leases_run_fkey FOREIGN KEY (analysis_run_id)
    REFERENCES public.mail_bank_agent_analysis_runs (id) ON DELETE CASCADE
);

REVOKE ALL ON TABLE private.mail_bank_agent_analysis_leases
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TABLE public.mail_bank_agent_run_sessions (
  analysis_run_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  eve_session_id text NOT NULL,
  eve_session_id_sha256 text NOT NULL,
  actor_kind text DEFAULT 'bank_mail_agent'::text NOT NULL,
  bound_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_run_sessions_eve_session_key UNIQUE (eve_session_id),
  CONSTRAINT mail_bank_agent_run_sessions_eve_session_hash_key
    UNIQUE (eve_session_id_sha256),
  CONSTRAINT mail_bank_agent_run_sessions_eve_session_check CHECK (
    char_length(eve_session_id) BETWEEN 8 AND 256
    AND eve_session_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    AND eve_session_id_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_run_sessions_actor_check CHECK (
    actor_kind = 'bank_mail_agent'::text
  ),
  CONSTRAINT mail_bank_agent_run_sessions_run_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id,
    analysis_run_id
  ) REFERENCES public.mail_bank_agent_analysis_runs (
    organization_id,
    owner_user_id,
    intake_id,
    id
  ) ON DELETE CASCADE
);

COMMENT ON TABLE public.mail_bank_agent_run_sessions IS
  'Immutable binding between an analysis run and a strictly formatted internal EVE session token for trace correlation and recovery.';

CREATE TABLE public.mail_bank_agent_match_proposals (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  analysis_run_id uuid NOT NULL,
  case_id uuid NOT NULL,
  application_id uuid NOT NULL,
  proposal_key_sha256 text NOT NULL,
  classification text NOT NULL,
  evidence_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  contradiction_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  actor_kind text DEFAULT 'bank_mail_agent'::text NOT NULL,
  review_status text DEFAULT 'review_required'::text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_match_proposals_scope_id_key
    UNIQUE (organization_id, owner_user_id, intake_id, id),
  CONSTRAINT mail_bank_agent_match_proposals_business_key
    UNIQUE (proposal_key_sha256),
  CONSTRAINT mail_bank_agent_match_proposals_run_key
    UNIQUE (analysis_run_id),
  CONSTRAINT mail_bank_agent_match_proposals_candidate_key
    UNIQUE (analysis_run_id, case_id, application_id),
  CONSTRAINT mail_bank_agent_match_proposals_hash_check CHECK (
    proposal_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_match_proposals_classification_check CHECK (
    classification IN ('strong_candidate', 'ambiguous_candidate')
  ),
  CONSTRAINT mail_bank_agent_match_proposals_evidence_check CHECK (
    cardinality(evidence_codes) > 0
    AND private.is_valid_bank_mail_agent_evidence_codes(evidence_codes)
  ),
  CONSTRAINT mail_bank_agent_match_proposals_contradiction_check CHECK (
    private.is_valid_bank_mail_agent_contradiction_codes(contradiction_codes)
  ),
  CONSTRAINT mail_bank_agent_match_proposals_consistency_check CHECK (
    classification <> 'strong_candidate' OR cardinality(contradiction_codes) = 0
  ),
  CONSTRAINT mail_bank_agent_match_proposals_actor_check CHECK (
    actor_kind = 'bank_mail_agent'::text
  ),
  CONSTRAINT mail_bank_agent_match_proposals_review_check CHECK (
    review_status = 'review_required'::text
  ),
  CONSTRAINT mail_bank_agent_match_proposals_intake_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id
  ) REFERENCES public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_match_proposals_run_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id,
    analysis_run_id
  ) REFERENCES public.mail_bank_agent_analysis_runs (
    organization_id,
    owner_user_id,
    intake_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_match_proposals_application_fkey FOREIGN KEY (
    organization_id,
    case_id,
    application_id
  ) REFERENCES public.crm_case_bank_applications (
    organization_id,
    case_id,
    submission_id
  ) ON DELETE RESTRICT
);

CREATE INDEX mail_bank_agent_match_proposals_review_idx
  ON public.mail_bank_agent_match_proposals (
    organization_id,
    owner_user_id,
    review_status,
    created_at DESC
  );

COMMENT ON TABLE public.mail_bank_agent_match_proposals IS
  'Immutable, AI-authored candidate links. Every row requires human review and never records a human actor.';

CREATE TABLE public.mail_bank_agent_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  intake_id uuid NOT NULL,
  analysis_run_id uuid,
  proposal_id uuid,
  event_key_sha256 text NOT NULL,
  event_type text NOT NULL,
  outcome_code text,
  reason_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  actor_kind text DEFAULT 'bank_mail_agent'::text NOT NULL,
  occurred_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT mail_bank_agent_events_business_key UNIQUE (event_key_sha256),
  CONSTRAINT mail_bank_agent_events_hash_check CHECK (
    event_key_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT mail_bank_agent_events_type_check CHECK (
    event_type IN (
      'intake_claimed',
      'intake_rejected',
      'analysis_claimed',
      'analysis_reclaimed',
      'analysis_session_bound',
      'match_proposed',
      'analysis_finalized'
    )
  ),
  CONSTRAINT mail_bank_agent_events_outcome_check CHECK (
    outcome_code IS NULL
    OR outcome_code IN (
      'review_required',
      'no_match',
      'not_bank_mail',
      'security_rejected',
      'needs_human_selection',
      'processing_failed'
    )
  ),
  CONSTRAINT mail_bank_agent_events_shape_check CHECK (
    (event_type = 'match_proposed'
      AND proposal_id IS NOT NULL
      AND analysis_run_id IS NOT NULL
      AND outcome_code = 'review_required')
    OR (event_type = 'analysis_finalized'
      AND proposal_id IS NULL
      AND analysis_run_id IS NOT NULL
      AND outcome_code IS NOT NULL)
    OR (event_type IN ('analysis_claimed', 'analysis_reclaimed', 'analysis_session_bound')
      AND proposal_id IS NULL
      AND analysis_run_id IS NOT NULL
      AND outcome_code IS NULL)
    OR (event_type IN ('intake_claimed', 'intake_rejected')
      AND proposal_id IS NULL
      AND analysis_run_id IS NULL
      AND outcome_code IS NULL)
  ),
  CONSTRAINT mail_bank_agent_events_reason_codes_check CHECK (
    private.is_valid_bank_mail_agent_reason_codes(reason_codes)
  ),
  CONSTRAINT mail_bank_agent_events_actor_check CHECK (
    actor_kind = 'bank_mail_agent'::text
  ),
  CONSTRAINT mail_bank_agent_events_intake_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id
  ) REFERENCES public.mail_bank_agent_intakes (
    organization_id,
    owner_user_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_events_run_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id,
    analysis_run_id
  ) REFERENCES public.mail_bank_agent_analysis_runs (
    organization_id,
    owner_user_id,
    intake_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT mail_bank_agent_events_proposal_fkey FOREIGN KEY (
    organization_id,
    owner_user_id,
    intake_id,
    proposal_id
  ) REFERENCES public.mail_bank_agent_match_proposals (
    organization_id,
    owner_user_id,
    intake_id,
    id
  ) ON DELETE CASCADE
);

CREATE INDEX mail_bank_agent_events_timeline_idx
  ON public.mail_bank_agent_events (intake_id, occurred_at, id);

COMMENT ON TABLE public.mail_bank_agent_events IS
  'Append-only PII-free decision trail. Event payloads are intentionally replaced by bounded reason and outcome codes.';

CREATE FUNCTION private.guard_bank_mail_agent_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  -- Tenant deletion may cascade through the complete ledger. No direct row
  -- update or deletion is permitted, including to the service role.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'bank_mail_agent_ledger_is_append_only'
    USING errcode = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.guard_bank_mail_agent_append_only()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER mail_bank_agent_analysis_runs_guard_append_only
  BEFORE UPDATE OR DELETE ON public.mail_bank_agent_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_agent_append_only();
CREATE TRIGGER mail_bank_agent_run_sessions_guard_append_only
  BEFORE UPDATE OR DELETE ON public.mail_bank_agent_run_sessions
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_agent_append_only();
CREATE TRIGGER mail_bank_agent_match_proposals_guard_append_only
  BEFORE UPDATE OR DELETE ON public.mail_bank_agent_match_proposals
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_agent_append_only();
CREATE TRIGGER mail_bank_agent_events_guard_append_only
  BEFORE UPDATE OR DELETE ON public.mail_bank_agent_events
  FOR EACH ROW EXECUTE FUNCTION private.guard_bank_mail_agent_append_only();

CREATE FUNCTION private.protect_bank_mail_agent_attachment_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.intake_id IS DISTINCT FROM OLD.intake_id
    OR NEW.attachment_ordinal IS DISTINCT FROM OLD.attachment_ordinal
    OR NEW.attachment_token_sha256 IS DISTINCT FROM OLD.attachment_token_sha256
    OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
    OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
    OR NEW.mime_category IS DISTINCT FROM OLD.mime_category
  THEN
    RAISE EXCEPTION 'bank_mail_agent_attachment_identity_is_immutable'
      USING errcode = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_bank_mail_agent_attachment_identity()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER mail_bank_agent_attachments_protect_identity
  BEFORE UPDATE ON public.mail_bank_agent_attachments
  FOR EACH ROW EXECUTE FUNCTION private.protect_bank_mail_agent_attachment_identity();

CREATE FUNCTION public.claim_bank_mail_agent_intake(
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
  normalized_sender_domain text := lower(btrim(coalesce(p_sender_domain, '')));
  sender_domain_sha256_value text;
  intake_key_sha256_value text;
  identity_verdict_value text;
  status_value text;
  reason_codes_value text[] := ARRAY[]::text[];
  stored_bank_id uuid;
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

  -- Replay the originally pinned classification even if the domain allowlist
  -- is later revised. The same provider identity may never be reused for
  -- different bytes, envelope authentication or sender domain.
  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.organization_id = p_organization_id
    AND intake.owner_user_id = p_mailbox_owner_user_id
    AND intake.connection_id = p_connection_id
    AND intake.provider_message_id_sha256 = p_provider_message_id_hash
  FOR UPDATE;
  IF FOUND THEN
    SELECT identity.bank_id
    INTO stored_bank_id
    FROM public.mortgage_bank_email_identities AS identity
    WHERE identity.id = intake_row.bank_email_identity_id;

    IF intake_row.provider IS DISTINCT FROM p_provider
      OR intake_row.source_sha256 IS DISTINCT FROM p_source_sha256
      OR intake_row.sender_domain_sha256 IS DISTINCT FROM sender_domain_sha256_value
      OR intake_row.intake_key_sha256 IS DISTINCT FROM intake_key_sha256_value
      OR intake_row.authentication_status IS DISTINCT FROM p_authentication_status
      OR intake_row.dmarc_aligned IS DISTINCT FROM p_dmarc_aligned
      OR intake_row.reply_to_mismatch IS DISTINCT FROM p_reply_to_mismatch
      OR (p_bank_id IS NOT NULL AND p_bank_id IS DISTINCT FROM stored_bank_id)
    THEN
      RAISE EXCEPTION 'bank_mail_agent_provider_message_hash_reused'
        USING errcode = '23505';
    END IF;

    RETURN jsonb_build_object(
      'intakeId', intake_row.id,
      'state', intake_row.status,
      'replayed', true,
      'bankId', stored_bank_id,
      'identityVerdict', intake_row.identity_verdict,
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

  IF identity_row.id IS NULL THEN
    identity_verdict_value := 'unknown_domain';
    reason_codes_value := ARRAY['unknown_bank_identity']::text[];
  ELSIF p_bank_id IS NOT NULL AND p_bank_id IS DISTINCT FROM identity_row.bank_id THEN
    identity_verdict_value := 'bank_id_mismatch';
    reason_codes_value := ARRAY['bank_identity_mismatch']::text[];
  ELSE
    IF p_authentication_status = 'failed' THEN
      reason_codes_value := reason_codes_value || 'authentication_failed'::text;
    ELSIF p_authentication_status = 'indeterminate' THEN
      reason_codes_value := reason_codes_value || 'authentication_indeterminate'::text;
    END IF;
    IF NOT p_dmarc_aligned THEN
      reason_codes_value := reason_codes_value || 'dmarc_not_aligned'::text;
    END IF;
    IF p_reply_to_mismatch THEN
      reason_codes_value := reason_codes_value || 'reply_to_mismatch'::text;
    END IF;

    IF p_authentication_status = 'passed'
      AND p_dmarc_aligned
      AND NOT p_reply_to_mismatch
    THEN
      identity_verdict_value := 'trusted_bank';
      reason_codes_value := ARRAY['trusted_bank_identity']::text[];
    ELSIF p_authentication_status = 'failed' THEN
      identity_verdict_value := 'authentication_failed';
    ELSIF p_authentication_status = 'indeterminate' THEN
      identity_verdict_value := 'authentication_indeterminate';
    ELSIF NOT p_dmarc_aligned THEN
      identity_verdict_value := 'dmarc_not_aligned';
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

  RETURN jsonb_build_object(
    'intakeId', intake_row.id,
    'state', intake_row.status,
    'replayed', replayed,
    'bankId', identity_row.bank_id,
    'identityVerdict', intake_row.identity_verdict,
    'sourceSha256', intake_row.source_sha256,
    'reasonCodes', to_jsonb(intake_row.reason_codes)
  );
END;
$$;

COMMENT ON FUNCTION public.claim_bank_mail_agent_intake(
  uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid
) IS
  'Service-only, idempotent ingress claim. Revalidates mailbox ownership, provider, bank-domain allowlist and envelope authentication without persisting mail content or raw provider IDs.';

REVOKE ALL ON FUNCTION public.claim_bank_mail_agent_intake(
  uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.claim_bank_mail_agent_run(
  p_intake_id uuid,
  p_model text,
  p_prompt_version text DEFAULT 'bank-mail-agent.prompt.v1',
  p_toolset_version text DEFAULT 'crm-agent-capabilities.tools.v1',
  p_policy_version text DEFAULT 'bank-mail-match-policy.v1',
  p_normalized_input_sha256 text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_row public.mail_bank_agent_intakes%rowtype;
  run_row public.mail_bank_agent_analysis_runs%rowtype;
  lease_row private.mail_bank_agent_analysis_leases%rowtype;
  session_row public.mail_bank_agent_run_sessions%rowtype;
  normalized_input_sha256_value text;
  run_key_sha256_value text;
  lease_token text;
  lease_token_sha256_value text;
  lease_now timestamptz := clock_timestamp();
  next_claim_count integer;
  is_new_run boolean := false;
BEGIN
  IF p_intake_id IS NULL
    OR p_model IS DISTINCT FROM 'deepseek/deepseek-v4-flash-0731'::text
    OR p_prompt_version IS DISTINCT FROM 'bank-mail-agent.prompt.v1'::text
    OR p_toolset_version IS DISTINCT FROM 'crm-agent-capabilities.tools.v1'::text
    OR p_policy_version IS DISTINCT FROM 'bank-mail-match-policy.v1'::text
    OR (
      p_normalized_input_sha256 IS NOT NULL
      AND p_normalized_input_sha256 !~ '^[0-9a-f]{64}$'
    )
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_run_claim'
      USING errcode = '22023';
  END IF;

  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = p_intake_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_intake_not_found'
      USING errcode = 'P0002';
  END IF;

  normalized_input_sha256_value := coalesce(
    p_normalized_input_sha256,
    intake_row.source_sha256
  );
  run_key_sha256_value := encode(
    extensions.digest(
      convert_to(
        'bank-mail-analysis-run-v1' || chr(31)
          || intake_row.id::text || chr(31)
          || intake_row.source_sha256 || chr(31)
          || normalized_input_sha256_value || chr(31)
          || 'vercel-ai-gateway' || chr(31)
          || p_model || chr(31)
          || p_prompt_version || chr(31)
          || p_toolset_version || chr(31)
          || p_policy_version,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT run.*
  INTO run_row
  FROM public.mail_bank_agent_analysis_runs AS run
  WHERE run.run_key_sha256 = run_key_sha256_value;

  IF run_row.id IS NULL
    AND intake_row.status NOT IN ('claimed', 'analyzing')
  THEN
    RETURN jsonb_build_object(
      'runId', NULL,
      'state', intake_row.status,
      'shouldDispatch', false,
      'sessionId', NULL
    );
  END IF;

  IF run_row.id IS NULL THEN
    INSERT INTO public.mail_bank_agent_analysis_runs (
      organization_id,
      owner_user_id,
      intake_id,
      run_key_sha256,
      source_sha256,
      normalized_input_sha256,
      model,
      prompt_version,
      toolset_version,
      policy_version,
      created_at
    ) VALUES (
      intake_row.organization_id,
      intake_row.owner_user_id,
      intake_row.id,
      run_key_sha256_value,
      intake_row.source_sha256,
      normalized_input_sha256_value,
      p_model,
      p_prompt_version,
      p_toolset_version,
      p_policy_version,
      lease_now
    )
    ON CONFLICT ON CONSTRAINT mail_bank_agent_analysis_runs_business_key
      DO NOTHING
    RETURNING * INTO run_row;
    is_new_run := run_row.id IS NOT NULL;

    IF run_row.id IS NULL THEN
      SELECT run.*
      INTO STRICT run_row
      FROM public.mail_bank_agent_analysis_runs AS run
      WHERE run.run_key_sha256 = run_key_sha256_value;
    END IF;
  END IF;

  SELECT binding.*
  INTO session_row
  FROM public.mail_bank_agent_run_sessions AS binding
  WHERE binding.analysis_run_id = run_row.id;

  SELECT lease.*
  INTO lease_row
  FROM private.mail_bank_agent_analysis_leases AS lease
  WHERE lease.analysis_run_id = run_row.id
  FOR UPDATE;

  IF lease_row.analysis_run_id IS NOT NULL
    AND lease_row.state IN ('completed', 'failed')
  THEN
    RETURN jsonb_build_object(
      'runId', run_row.id,
      'state', lease_row.state,
      'shouldDispatch', false,
      'sessionId', session_row.eve_session_id
    );
  END IF;

  IF session_row.analysis_run_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'runId', run_row.id,
      'state', 'session_bound',
      'shouldDispatch', false,
      'leaseExpiresAt', lease_row.lease_expires_at,
      'sessionId', session_row.eve_session_id
    );
  END IF;

  IF lease_row.analysis_run_id IS NOT NULL
    AND lease_row.lease_expires_at > lease_now
  THEN
    RETURN jsonb_build_object(
      'runId', run_row.id,
      'state', 'in_progress',
      'shouldDispatch', false,
      'leaseExpiresAt', lease_row.lease_expires_at,
      'sessionId', NULL
    );
  END IF;

  IF lease_row.analysis_run_id IS NOT NULL AND lease_row.claim_count >= 10 THEN
    RAISE EXCEPTION 'bank_mail_agent_run_retry_limit_reached'
      USING errcode = '55000';
  END IF;

  lease_token := encode(extensions.gen_random_bytes(32), 'hex');
  lease_token_sha256_value := encode(
    extensions.digest(convert_to(lease_token, 'utf8'), 'sha256'),
    'hex'
  );

  IF lease_row.analysis_run_id IS NULL THEN
    next_claim_count := 1;
    INSERT INTO private.mail_bank_agent_analysis_leases (
      analysis_run_id,
      lease_token_sha256,
      lease_expires_at,
      claim_count,
      state,
      updated_at
    ) VALUES (
      run_row.id,
      lease_token_sha256_value,
      lease_now + interval '15 minutes',
      next_claim_count,
      'claimed',
      lease_now
    );
  ELSE
    next_claim_count := lease_row.claim_count + 1;
    UPDATE private.mail_bank_agent_analysis_leases AS lease
    SET lease_token_sha256 = lease_token_sha256_value,
        lease_expires_at = lease_now + interval '15 minutes',
        claim_count = next_claim_count,
        state = 'claimed',
        updated_at = lease_now
    WHERE lease.analysis_run_id = run_row.id;
  END IF;

  UPDATE public.mail_bank_agent_intakes AS intake
  SET status = 'analyzing',
      updated_at = lease_now
  WHERE intake.id = intake_row.id
    AND intake.status = 'claimed';

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
            || CASE WHEN next_claim_count = 1
              THEN 'analysis_claimed'
              ELSE 'analysis_reclaimed'
            END || chr(31) || next_claim_count::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    ),
    CASE WHEN next_claim_count = 1
      THEN 'analysis_claimed'
      ELSE 'analysis_reclaimed'
    END,
    ARRAY[]::text[],
    lease_now
  ) ON CONFLICT (event_key_sha256) DO NOTHING;

  RETURN jsonb_build_object(
    'runId', run_row.id,
    'state', CASE WHEN is_new_run THEN 'claimed' ELSE 'reclaimed' END,
    'shouldDispatch', true,
    'leaseToken', lease_token,
    'leaseExpiresAt', lease_now + interval '15 minutes',
    'sessionId', NULL
  );
END;
$$;

COMMENT ON FUNCTION public.claim_bank_mail_agent_run(
  uuid, text, text, text, text, text
) IS
  'Atomically elects one dispatcher for an immutable source/model/prompt/toolset/policy analysis. Active or completed replays never dispatch a second model run.';

REVOKE ALL ON FUNCTION public.claim_bank_mail_agent_run(
  uuid, text, text, text, text, text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.bind_bank_mail_agent_run_session(
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
  lease_row private.mail_bank_agent_analysis_leases%rowtype;
  session_row public.mail_bank_agent_run_sessions%rowtype;
  supplied_lease_token_sha256 text;
  eve_session_id_sha256_value text;
  bound_now timestamptz := clock_timestamp();
  replayed boolean := false;
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

  IF lease_row.lease_token_sha256 IS DISTINCT FROM supplied_lease_token_sha256 THEN
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
    IF lease_row.lease_expires_at <= bound_now THEN
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
  'Binds one strict internal EVE session token to the winning dispatch lease. The binding is immutable and idempotently replayable.';

REVOKE ALL ON FUNCTION public.bind_bank_mail_agent_run_session(uuid, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.propose_bank_mail_case_match(
  p_intake_id uuid,
  p_analysis_run_id uuid,
  p_case_id uuid,
  p_application_id uuid,
  p_classification text,
  p_evidence_codes text[],
  p_contradiction_codes text[] DEFAULT ARRAY[]::text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_row public.mail_bank_agent_intakes%rowtype;
  run_row public.mail_bank_agent_analysis_runs%rowtype;
  proposal_row public.mail_bank_agent_match_proposals%rowtype;
  identity_bank_id uuid;
  application_bank_id uuid;
  evidence_codes_value text[];
  contradiction_codes_value text[];
  event_reason_codes_value text[];
  proposal_key_sha256_value text;
  proposed_now timestamptz := clock_timestamp();
  replayed boolean := false;
BEGIN
  IF p_intake_id IS NULL
    OR p_analysis_run_id IS NULL
    OR p_case_id IS NULL
    OR p_application_id IS NULL
    OR p_classification NOT IN ('strong_candidate', 'ambiguous_candidate')
    OR p_evidence_codes IS NULL
    OR p_contradiction_codes IS NULL
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_case_match_proposal'
      USING errcode = '22023';
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT evidence.code ORDER BY evidence.code),
    ARRAY[]::text[]
  )
  INTO evidence_codes_value
  FROM unnest(p_evidence_codes) AS evidence(code);

  SELECT coalesce(
    array_agg(DISTINCT contradiction.code ORDER BY contradiction.code),
    ARRAY[]::text[]
  )
  INTO contradiction_codes_value
  FROM unnest(p_contradiction_codes) AS contradiction(code);

  IF cardinality(evidence_codes_value) = 0
    OR private.is_valid_bank_mail_agent_evidence_codes(evidence_codes_value)
      IS DISTINCT FROM true
    OR private.is_valid_bank_mail_agent_contradiction_codes(
      contradiction_codes_value
    ) IS DISTINCT FROM true
    OR (
      p_classification = 'strong_candidate'
      AND cardinality(contradiction_codes_value) <> 0
    )
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_case_match_codes'
      USING errcode = '22023';
  END IF;

  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = p_intake_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_intake_not_found'
      USING errcode = 'P0002';
  END IF;
  IF intake_row.identity_verdict <> 'trusted_bank'
    OR intake_row.status NOT IN ('claimed', 'analyzing', 'review_required')
  THEN
    RAISE EXCEPTION 'bank_mail_agent_intake_not_proposable'
      USING errcode = '55000';
  END IF;

  SELECT run.*
  INTO run_row
  FROM public.mail_bank_agent_analysis_runs AS run
  WHERE run.id = p_analysis_run_id
    AND run.organization_id = intake_row.organization_id
    AND run.owner_user_id = intake_row.owner_user_id
    AND run.intake_id = intake_row.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_analysis_run_scope_mismatch'
      USING errcode = '42501';
  END IF;

  SELECT identity.bank_id
  INTO identity_bank_id
  FROM public.mortgage_bank_email_identities AS identity
  WHERE identity.id = intake_row.bank_email_identity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_bank_identity_not_found'
      USING errcode = '55000';
  END IF;

  -- Organization and owner are derived exclusively from the trusted intake.
  -- The requested application must be a mortgage application for that exact
  -- owner and the same bank identity.
  SELECT application.bank_id
  INTO application_bank_id
  FROM public.crm_case_bank_applications AS application
  JOIN public.crm_cases AS crm_case
    ON crm_case.organization_id = application.organization_id
   AND crm_case.id = application.case_id
  WHERE application.organization_id = intake_row.organization_id
    AND application.case_id = p_case_id
    AND application.submission_id = p_application_id
    AND crm_case.owner_user_id = intake_row.owner_user_id
  FOR UPDATE OF application, crm_case;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_case_application_scope_mismatch'
      USING errcode = '42501';
  END IF;
  IF application_bank_id IS DISTINCT FROM identity_bank_id THEN
    RAISE EXCEPTION 'bank_mail_agent_application_bank_mismatch'
      USING errcode = '42501';
  END IF;

  proposal_key_sha256_value := encode(
    extensions.digest(
      convert_to(
        'bank-mail-match-proposal-v1' || chr(31)
          || intake_row.id::text || chr(31)
          || run_row.id::text || chr(31)
          || p_case_id::text || chr(31)
          || p_application_id::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.mail_bank_agent_match_proposals (
    organization_id,
    owner_user_id,
    intake_id,
    analysis_run_id,
    case_id,
    application_id,
    proposal_key_sha256,
    classification,
    evidence_codes,
    contradiction_codes,
    created_at
  ) VALUES (
    intake_row.organization_id,
    intake_row.owner_user_id,
    intake_row.id,
    run_row.id,
    p_case_id,
    p_application_id,
    proposal_key_sha256_value,
    p_classification,
    evidence_codes_value,
    contradiction_codes_value,
    proposed_now
  )
  ON CONFLICT ON CONSTRAINT mail_bank_agent_match_proposals_business_key
    DO NOTHING
  RETURNING * INTO proposal_row;

  IF proposal_row.id IS NULL THEN
    replayed := true;
    SELECT proposal.*
    INTO STRICT proposal_row
    FROM public.mail_bank_agent_match_proposals AS proposal
    WHERE proposal.proposal_key_sha256 = proposal_key_sha256_value
    FOR UPDATE;

    IF proposal_row.classification IS DISTINCT FROM p_classification
      OR proposal_row.evidence_codes IS DISTINCT FROM evidence_codes_value
      OR proposal_row.contradiction_codes IS DISTINCT FROM contradiction_codes_value
      OR proposal_row.review_status IS DISTINCT FROM 'review_required'::text
      OR proposal_row.actor_kind IS DISTINCT FROM 'bank_mail_agent'::text
    THEN
      RAISE EXCEPTION 'bank_mail_agent_match_proposal_replay_conflict'
        USING errcode = '23505';
    END IF;
  ELSE
    event_reason_codes_value := evidence_codes_value
      || contradiction_codes_value
      || ARRAY['human_review_required', 'policy_requires_review']::text[];
    SELECT array_agg(DISTINCT reason.code ORDER BY reason.code)
    INTO event_reason_codes_value
    FROM unnest(event_reason_codes_value) AS reason(code);

    INSERT INTO public.mail_bank_agent_events (
      organization_id,
      owner_user_id,
      intake_id,
      analysis_run_id,
      proposal_id,
      event_key_sha256,
      event_type,
      outcome_code,
      reason_codes,
      occurred_at
    ) VALUES (
      proposal_row.organization_id,
      proposal_row.owner_user_id,
      proposal_row.intake_id,
      proposal_row.analysis_run_id,
      proposal_row.id,
      encode(
        extensions.digest(
          convert_to(
            proposal_row.proposal_key_sha256 || chr(31) || 'match_proposed',
            'utf8'
          ),
          'sha256'
        ),
        'hex'
      ),
      'match_proposed',
      'review_required',
      event_reason_codes_value,
      proposed_now
    );
  END IF;

  UPDATE public.mail_bank_agent_intakes AS intake
  SET status = 'review_required',
      finalized_at = coalesce(intake.finalized_at, proposed_now),
      updated_at = proposed_now
  WHERE intake.id = intake_row.id;

  UPDATE private.mail_bank_agent_analysis_leases AS lease
  SET state = 'completed',
      updated_at = proposed_now
  WHERE lease.analysis_run_id = run_row.id;

  RETURN jsonb_build_object(
    'proposalId', proposal_row.id,
    'analysisRunId', proposal_row.analysis_run_id,
    'state', proposal_row.review_status,
    'classification', proposal_row.classification,
    'evidenceCodes', to_jsonb(proposal_row.evidence_codes),
    'contradictionCodes', to_jsonb(proposal_row.contradiction_codes),
    'caseId', proposal_row.case_id,
    'applicationId', proposal_row.application_id,
    'proposalKeySha256', proposal_row.proposal_key_sha256,
    'createdAt', proposal_row.created_at,
    'replayed', replayed
  );
END;
$$;

COMMENT ON FUNCTION public.propose_bank_mail_case_match(
  uuid, uuid, uuid, uuid, text, text[], text[]
) IS
  'Creates an idempotent AI-authored candidate link after deriving tenant/owner/bank scope from the intake. It can only request human review and never attaches mail or impersonates a user.';

REVOKE ALL ON FUNCTION public.propose_bank_mail_case_match(
  uuid, uuid, uuid, uuid, text, text[], text[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.finalize_bank_mail_agent_intake(
  p_intake_id uuid,
  p_analysis_run_id uuid,
  p_outcome text,
  p_reason_codes text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_row public.mail_bank_agent_intakes%rowtype;
  run_row public.mail_bank_agent_analysis_runs%rowtype;
  event_row public.mail_bank_agent_events%rowtype;
  reason_codes_value text[];
  target_status text;
  event_key_sha256_value text;
  finalized_now timestamptz := clock_timestamp();
  replayed boolean := false;
BEGIN
  IF p_intake_id IS NULL
    OR p_analysis_run_id IS NULL
    OR p_outcome NOT IN (
      'no_match',
      'not_bank_mail',
      'security_rejected',
      'needs_human_selection',
      'processing_failed'
    )
    OR p_reason_codes IS NULL
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_finalization'
      USING errcode = '22023';
  END IF;

  SELECT coalesce(
    array_agg(DISTINCT reason.code ORDER BY reason.code),
    ARRAY[]::text[]
  )
  INTO reason_codes_value
  FROM unnest(p_reason_codes) AS reason(code);

  IF cardinality(reason_codes_value) = 0
    OR private.is_valid_bank_mail_agent_reason_codes(reason_codes_value)
      IS DISTINCT FROM true
    OR (
      p_outcome = 'no_match'
      AND NOT (
        reason_codes_value
          && ARRAY[
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
    OR (p_outcome = 'not_bank_mail' AND NOT ('not_bank_message' = ANY (reason_codes_value)))
    OR (
      p_outcome = 'needs_human_selection'
      AND NOT ('human_review_required' = ANY (reason_codes_value))
    )
    OR (
      p_outcome = 'processing_failed'
      AND NOT ('processing_error' = ANY (reason_codes_value))
    )
  THEN
    RAISE EXCEPTION 'invalid_bank_mail_agent_finalization_codes'
      USING errcode = '22023';
  END IF;

  target_status := CASE p_outcome
    WHEN 'no_match' THEN 'no_match'
    WHEN 'not_bank_mail' THEN 'not_bank_mail'
    WHEN 'security_rejected' THEN 'security_rejected'
    WHEN 'needs_human_selection' THEN 'review_required'
    ELSE 'failed'
  END;

  SELECT intake.*
  INTO intake_row
  FROM public.mail_bank_agent_intakes AS intake
  WHERE intake.id = p_intake_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_intake_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT run.*
  INTO run_row
  FROM public.mail_bank_agent_analysis_runs AS run
  WHERE run.id = p_analysis_run_id
    AND run.organization_id = intake_row.organization_id
    AND run.owner_user_id = intake_row.owner_user_id
    AND run.intake_id = intake_row.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_mail_agent_analysis_run_scope_mismatch'
      USING errcode = '42501';
  END IF;

  event_key_sha256_value := encode(
    extensions.digest(
      convert_to(
        run_row.run_key_sha256 || chr(31)
          || 'analysis_finalized' || chr(31) || p_outcome,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT event.*
  INTO event_row
  FROM public.mail_bank_agent_events AS event
  WHERE event.event_key_sha256 = event_key_sha256_value;

  IF event_row.id IS NOT NULL THEN
    IF event_row.outcome_code IS DISTINCT FROM p_outcome
      OR event_row.reason_codes IS DISTINCT FROM reason_codes_value
      OR intake_row.status IS DISTINCT FROM target_status
    THEN
      RAISE EXCEPTION 'bank_mail_agent_finalization_replay_conflict'
        USING errcode = '23505';
    END IF;
    replayed := true;
  ELSE
    IF intake_row.status NOT IN ('claimed', 'analyzing', 'review_required') THEN
      RAISE EXCEPTION 'bank_mail_agent_intake_already_finalized'
        USING errcode = '23505';
    END IF;

    INSERT INTO public.mail_bank_agent_events (
      organization_id,
      owner_user_id,
      intake_id,
      analysis_run_id,
      event_key_sha256,
      event_type,
      outcome_code,
      reason_codes,
      occurred_at
    ) VALUES (
      run_row.organization_id,
      run_row.owner_user_id,
      run_row.intake_id,
      run_row.id,
      event_key_sha256_value,
      'analysis_finalized',
      p_outcome,
      reason_codes_value,
      finalized_now
    )
    RETURNING * INTO event_row;

    UPDATE public.mail_bank_agent_intakes AS intake
    SET status = target_status,
        finalized_at = finalized_now,
        updated_at = finalized_now
    WHERE intake.id = intake_row.id;

    UPDATE private.mail_bank_agent_analysis_leases AS lease
    SET state = CASE
          WHEN p_outcome = 'processing_failed' THEN 'failed'
          ELSE 'completed'
        END,
        updated_at = finalized_now
    WHERE lease.analysis_run_id = run_row.id;
  END IF;

  RETURN jsonb_build_object(
    'intakeId', intake_row.id,
    'analysisRunId', run_row.id,
    'state', target_status,
    'outcome', p_outcome,
    'reasonCodes', to_jsonb(reason_codes_value),
    'finalizedAt', coalesce(event_row.occurred_at, intake_row.finalized_at),
    'replayed', replayed
  );
END;
$$;

COMMENT ON FUNCTION public.finalize_bank_mail_agent_intake(
  uuid, uuid, text, text[]
) IS
  'Idempotently finalizes a run with a controlled non-match, rejection, review or failure outcome and no free-text payload.';

REVOKE ALL ON FUNCTION public.finalize_bank_mail_agent_intake(
  uuid, uuid, text, text[]
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION public.get_bank_mail_agent_intake(p_intake_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  intake_row public.mail_bank_agent_intakes%rowtype;
  bank_id_value uuid;
  attachments_value jsonb;
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
    'dmarcAligned', intake_row.dmarc_aligned,
    'replyToMismatch', intake_row.reply_to_mismatch,
    'sourceSha256', intake_row.source_sha256,
    'reasonCodes', to_jsonb(intake_row.reason_codes),
    'claimedAt', intake_row.claimed_at,
    'finalizedAt', intake_row.finalized_at,
    'attachments', attachments_value
  );
END;
$$;

COMMENT ON FUNCTION public.get_bank_mail_agent_intake(uuid) IS
  'Returns only trusted-envelope, hash and controlled attachment-processing metadata required by the agent; never message or identity PII.';

REVOKE ALL ON FUNCTION public.get_bank_mail_agent_intake(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

ALTER TABLE public.mortgage_bank_email_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_bank_agent_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_bank_agent_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_bank_agent_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_bank_agent_run_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_bank_agent_match_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_bank_agent_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mortgage_bank_email_identities
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.mail_bank_agent_intakes
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.mail_bank_agent_attachments
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.mail_bank_agent_analysis_runs
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.mail_bank_agent_run_sessions
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.mail_bank_agent_match_proposals
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.mail_bank_agent_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.mortgage_bank_email_identities,
  public.mail_bank_agent_intakes,
  public.mail_bank_agent_attachments,
  public.mail_bank_agent_analysis_runs,
  public.mail_bank_agent_run_sessions,
  public.mail_bank_agent_match_proposals,
  public.mail_bank_agent_events,
  private.mail_bank_agent_analysis_leases
TO openexpert_owner;

GRANT EXECUTE ON FUNCTION private.is_valid_bank_mail_agent_evidence_codes(text[])
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_valid_bank_mail_agent_contradiction_codes(text[])
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.is_valid_bank_mail_agent_reason_codes(text[])
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.guard_bank_mail_agent_append_only()
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.protect_bank_mail_agent_attachment_identity()
  TO openexpert_owner;
GRANT EXECUTE ON FUNCTION private.protect_mortgage_bank_email_identity()
  TO openexpert_owner;

GRANT EXECUTE ON FUNCTION public.claim_bank_mail_agent_intake(
  uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION public.claim_bank_mail_agent_run(
  uuid, text, text, text, text, text
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION public.bind_bank_mail_agent_run_session(uuid, text, text)
  TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION public.propose_bank_mail_case_match(
  uuid, uuid, uuid, uuid, text, text[], text[]
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION public.finalize_bank_mail_agent_intake(
  uuid, uuid, text, text[]
) TO openexpert_service, openexpert_owner;
GRANT EXECUTE ON FUNCTION public.get_bank_mail_agent_intake(uuid)
  TO openexpert_service, openexpert_owner;
