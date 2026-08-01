-- Invitation callbacks can be repeated by the browser (including after an
-- OAuth redirect). Replaying a successfully claimed invitation is safe only
-- for the same verified Better Auth identity and the same active CRM link.
CREATE OR REPLACE FUNCTION public.claim_client_portal_invitation(
  p_invitation_id uuid,
  p_auth_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  invitation public.client_portal_invitations%ROWTYPE;
  auth_email text;
  person_email text;
  conflicting_auth_user_id uuid;
BEGIN
  SELECT lower(btrim(auth_user.email))
  INTO auth_email
  FROM identity.users AS auth_user
  WHERE auth_user.id = p_auth_user_id
    AND auth_user.email_verified;

  IF auth_email IS NULL THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Lock by identifier before examining state so a duplicate callback waits
  -- for the first claim and observes its committed result.
  SELECT candidate.*
  INTO invitation
  FROM public.client_portal_invitations AS candidate
  WHERE candidate.id = p_invitation_id
  FOR UPDATE;

  IF NOT found THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT person.email_normalized
  INTO person_email
  FROM public.crm_client_people AS person
  WHERE person.organization_id = invitation.organization_id
    AND person.client_id = invitation.client_id
    AND person.id = invitation.client_person_id;

  -- The current verified Auth email, invitation email and current CRM email
  -- must still describe the same person, for both a first claim and a replay.
  IF person_email IS NULL
     OR auth_email <> invitation.email_normalized
     OR auth_email <> person_email THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF invitation.status = 'accepted' THEN
    PERFORM 1
    FROM public.client_account_links AS account_link
    WHERE account_link.auth_user_id = p_auth_user_id
      AND account_link.organization_id = invitation.organization_id
      AND account_link.client_id = invitation.client_id
      AND account_link.client_person_id = invitation.client_person_id
      AND account_link.verification_method = 'email'
      AND account_link.verified_contact_normalized = auth_email
      AND account_link.verified_at IS NOT NULL
      AND account_link.revoked_at IS NULL
    FOR SHARE;

    IF NOT found THEN
      RAISE EXCEPTION 'client_portal_invitation_not_found'
        USING ERRCODE = 'P0002';
    END IF;

    RETURN jsonb_build_object(
      'accepted', true,
      'replayed', true,
      'invitationId', invitation.id,
      'organizationId', invitation.organization_id,
      'clientId', invitation.client_id,
      'clientPersonId', invitation.client_person_id
    );
  END IF;

  IF invitation.status <> 'pending'
     OR invitation.revoked_at IS NOT NULL
     OR invitation.expires_at <= now() THEN
    RAISE EXCEPTION 'client_portal_invitation_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- A staff-confirmed CRM email change invalidates the previous email proof.
  -- After the three current emails match above, atomically retire an active
  -- email link carrying the old address so the newly verified owner can claim.
  UPDATE public.client_account_links AS account_link
  SET revoked_at = now()
  WHERE account_link.organization_id = invitation.organization_id
    AND account_link.client_person_id = invitation.client_person_id
    AND account_link.verification_method = 'email'
    AND account_link.verified_contact_normalized <> auth_email
    AND account_link.revoked_at IS NULL;

  SELECT account_link.auth_user_id
  INTO conflicting_auth_user_id
  FROM public.client_account_links AS account_link
  WHERE account_link.organization_id = invitation.organization_id
    AND account_link.client_person_id = invitation.client_person_id
    AND account_link.revoked_at IS NULL
    AND account_link.auth_user_id <> p_auth_user_id
  FOR UPDATE;

  IF conflicting_auth_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'client_person_already_linked'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.client_account_links (
    auth_user_id,
    organization_id,
    client_id,
    client_person_id,
    source_appointment_id,
    verification_method,
    verified_contact_normalized,
    verified_at,
    revoked_at
  ) VALUES (
    p_auth_user_id,
    invitation.organization_id,
    invitation.client_id,
    invitation.client_person_id,
    NULL,
    'email',
    auth_email,
    now(),
    NULL
  )
  ON CONFLICT (auth_user_id, organization_id, client_person_id)
  DO UPDATE SET
    client_id = excluded.client_id,
    source_appointment_id = NULL,
    verification_method = excluded.verification_method,
    verified_contact_normalized = excluded.verified_contact_normalized,
    verified_at = excluded.verified_at,
    revoked_at = NULL;

  UPDATE public.client_portal_invitations
  SET status = 'accepted',
      accepted_at = now(),
      revision = revision + 1,
      last_delivery_error = NULL
  WHERE id = invitation.id;

  RETURN jsonb_build_object(
    'accepted', true,
    'replayed', false,
    'invitationId', invitation.id,
    'organizationId', invitation.organization_id,
    'clientId', invitation.client_id,
    'clientPersonId', invitation.client_person_id
  );
END
$function$;

REVOKE ALL ON FUNCTION public.claim_client_portal_invitation(uuid, uuid)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_client_portal_invitation(uuid, uuid)
  TO openexpert_service;
