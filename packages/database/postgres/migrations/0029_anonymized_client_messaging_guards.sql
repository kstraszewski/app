-- Serialize every future message/attachment write with client anonymization.
-- The lock is acquired before the status check so a transaction that waited
-- for anonymization observes the committed anonymized state and is rejected.

CREATE OR REPLACE FUNCTION private.reject_anonymized_client_message_write()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_client_status text;
BEGIN
  SELECT client.status_code
  INTO target_client_status
  FROM public.crm_case_conversations AS conversation
  JOIN public.crm_clients AS client
    ON client.organization_id = conversation.organization_id
   AND client.id = conversation.client_id
  WHERE conversation.organization_id = NEW.organization_id
    AND conversation.id = NEW.conversation_id
  FOR KEY SHARE OF conversation, client;

  IF target_client_status = 'anonymized'::text THEN
    RAISE EXCEPTION 'case_message_client_anonymized'
      USING errcode = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_anonymized_client_message_write()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.revoke_anonymized_client_portal_grants()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  IF NEW.status_code = 'anonymized'::text
    AND OLD.status_code IS DISTINCT FROM 'anonymized'::text
  THEN
    UPDATE public.client_portal_case_grants AS portal_grant
    SET
      portal_enabled = false,
      multiform_enabled = false,
      revoked_at = coalesce(portal_grant.revoked_at, statement_timestamp()),
      revision = portal_grant.revision + 1
    WHERE portal_grant.organization_id = NEW.organization_id
      AND portal_grant.client_id = NEW.id
      AND (
        portal_grant.portal_enabled
        OR portal_grant.multiform_enabled
        OR portal_grant.revoked_at IS NULL
      );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.revoke_anonymized_client_portal_grants()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_clients_revoke_anonymized_portal_grants
  AFTER UPDATE OF status_code ON public.crm_clients
  FOR EACH ROW
  EXECUTE FUNCTION private.revoke_anonymized_client_portal_grants();

CREATE FUNCTION private.reject_anonymized_client_portal_grant()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_client_status text;
BEGIN
  IF NEW.portal_enabled OR NEW.multiform_enabled THEN
    SELECT client.status_code
    INTO target_client_status
    FROM public.crm_clients AS client
    WHERE client.organization_id = NEW.organization_id
      AND client.id = NEW.client_id
    FOR KEY SHARE;

    IF target_client_status = 'anonymized'::text THEN
      RAISE EXCEPTION 'anonymized_client_portal_grant_forbidden'
        USING errcode = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_anonymized_client_portal_grant()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER client_portal_case_grants_reject_anonymized_client
  BEFORE INSERT OR UPDATE OF portal_enabled, multiform_enabled
  ON public.client_portal_case_grants
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_anonymized_client_portal_grant();
