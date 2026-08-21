-- Expose only the controlled EVE lifecycle state for messages in the
-- authenticated user's own mailbox. Message/provider identities remain
-- SHA-256 values and no mail content crosses this boundary.

CREATE FUNCTION public.get_my_mail_bank_agent_statuses(
  p_organization_id uuid,
  p_connection_id uuid,
  p_provider_message_id_hashes text[]
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
SET row_security TO off
AS $function$
DECLARE
  caller_user_id uuid := (SELECT app.current_user_id());
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

  -- A guessed connection/message hash cannot be used as an oracle across
  -- tenants or mailbox owners. Billing membership is checked independently
  -- from the mailbox relation so a revoked user fails closed.
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
        END
      ) ORDER BY requested.ordinality
    ),
    '[]'::jsonb
  )
  INTO result
  FROM unnest(p_provider_message_id_hashes) WITH ORDINALITY AS requested(hash, ordinality)
  JOIN public.mail_bank_agent_intakes AS intake
    ON intake.organization_id = p_organization_id
   AND intake.owner_user_id = caller_user_id
   AND intake.connection_id = p_connection_id
   AND intake.provider_message_id_sha256 = requested.hash;

  RETURN result;
END;
$function$;

COMMENT ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[]) IS
  'Returns only controlled bank-mail EVE lifecycle states for bounded message hashes in the authenticated user own mailbox.';

ALTER FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  OWNER TO openexpert_owner;
REVOKE ALL ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.get_my_mail_bank_agent_statuses(uuid, uuid, text[])
  TO authenticated, openexpert_owner;
