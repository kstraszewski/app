-- Keep the established Data API function signature while exposing the single
-- deterministic strong proposal needed by the trusted CRM ingestion adapter.
-- Returning it inside the existing JSON result avoids a new schema-cache entry.

CREATE OR REPLACE FUNCTION public.get_bank_mail_agent_intake(p_intake_id uuid)
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
    'dmarcAligned', intake_row.dmarc_aligned,
    'replyToMismatch', intake_row.reply_to_mismatch,
    'sourceSha256', intake_row.source_sha256,
    'reasonCodes', to_jsonb(intake_row.reason_codes),
    'claimedAt', intake_row.claimed_at,
    'finalizedAt', intake_row.finalized_at,
    'strongProposalCaseId', strong_proposal_case_id_value,
    'attachments', attachments_value
  );
END;
$$;

COMMENT ON FUNCTION public.get_bank_mail_agent_intake(uuid) IS
  'Returns trusted-envelope, hash, attachment-processing metadata and at most one contradiction-free strong proposal case; never message or identity PII.';
