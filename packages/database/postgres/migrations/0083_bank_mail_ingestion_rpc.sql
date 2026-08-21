-- Server-side Gmail ingestion must not receive direct table privileges. Expose
-- only the small, non-PII projections required before and after the EVE run.

CREATE FUNCTION public.list_active_bank_email_identities()
RETURNS TABLE (
  bank_id uuid,
  sender_domain text,
  allow_subdomains boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT
    identity.bank_id,
    identity.sender_domain,
    identity.allow_subdomains
  FROM public.mortgage_bank_email_identities AS identity
  WHERE identity.is_active
  ORDER BY identity.sender_domain;
$$;

COMMENT ON FUNCTION public.list_active_bank_email_identities() IS
  'Returns the active, non-PII sender-domain allowlist used by trusted server-side bank-mail ingestion.';

REVOKE ALL ON FUNCTION public.list_active_bank_email_identities()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.list_active_bank_email_identities()
  TO openexpert_service, openexpert_owner;

CREATE FUNCTION public.get_strong_bank_mail_agent_proposal_case(p_intake_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT CASE
    WHEN count(DISTINCT proposal.case_id) = 1
      AND count(DISTINCT proposal.application_id) = 1
    THEN min(proposal.case_id::text)::uuid
    ELSE NULL
  END
  FROM public.mail_bank_agent_match_proposals AS proposal
  JOIN public.mail_bank_agent_intakes AS intake
    ON intake.organization_id = proposal.organization_id
   AND intake.owner_user_id = proposal.owner_user_id
   AND intake.id = proposal.intake_id
  WHERE proposal.intake_id = p_intake_id
    AND proposal.classification = 'strong_candidate'
    AND proposal.review_status = 'review_required'
    AND cardinality(proposal.contradiction_codes) = 0;
$$;

COMMENT ON FUNCTION public.get_strong_bank_mail_agent_proposal_case(uuid) IS
  'Returns a case only when all trusted strong proposals for an intake resolve uniquely and contain no contradictions.';

REVOKE ALL ON FUNCTION public.get_strong_bank_mail_agent_proposal_case(uuid)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_strong_bank_mail_agent_proposal_case(uuid)
  TO openexpert_service, openexpert_owner;
