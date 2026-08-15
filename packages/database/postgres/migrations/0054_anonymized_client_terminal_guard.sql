-- An anonymized CRM client is a terminal privacy state. Enforce this below
-- the Nuxt API as authenticated users also receive short-lived Data API JWTs.

-- Older executions of the approved workflow did not clear lead_source. Refuse
-- to seal malformed legacy rows, then remove this last free-text field without
-- changing their business updated_at timestamp. The existing lead_source
-- projection trigger rebuilds the client's searchable fields in the same update.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.crm_clients client
    WHERE client.status_code = 'anonymized'::text
      AND (
        client.display_name IS DISTINCT FROM 'Klient zanonimizowany'::text
        OR client.primary_email IS NOT NULL
        OR client.primary_phone IS NOT NULL
        OR coalesce(client.tags, array[]::text[]) <> array[]::text[]
        OR client.notes IS NOT NULL
        OR coalesce(client.metadata, '{}'::jsonb) <> '{}'::jsonb
      )
  ) THEN
    RAISE EXCEPTION 'existing_anonymized_client_payload_not_sanitized'
      USING errcode = '55000';
  END IF;
END;
$$;

ALTER TABLE public.crm_clients DISABLE TRIGGER set_crm_clients_updated_at;

UPDATE public.crm_clients
SET lead_source = NULL
WHERE status_code = 'anonymized'::text
  AND lead_source IS NOT NULL;

ALTER TABLE public.crm_clients ENABLE TRIGGER set_crm_clients_updated_at;

CREATE FUNCTION private.reject_anonymized_client_reidentification()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO ''
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status_code = 'anonymized'::text
      AND current_user IN ('authenticated', 'openexpert_service')
    THEN
      RAISE EXCEPTION 'anonymized_client_transition_requires_workflow'
        USING errcode = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status_code = 'anonymized'::text THEN
    RAISE EXCEPTION 'anonymized_client_is_terminal'
      USING errcode = '55000';
  END IF;

  IF NEW.status_code = 'anonymized'::text
    AND OLD.status_code IS DISTINCT FROM 'anonymized'::text
  THEN
    -- The approved anonymization RPC is SECURITY DEFINER, so this invoker
    -- trigger sees its owner here. Direct Data API and server-service updates
    -- retain their authenticated/openexpert_service roles and are rejected.
    IF current_user IN ('authenticated', 'openexpert_service') THEN
      RAISE EXCEPTION 'anonymized_client_transition_requires_workflow'
        USING errcode = '55000';
    END IF;

    -- The original workflow predates this invariant and did not clear the
    -- free-text lead source. Scrub it in the same transaction before the
    -- search projection trigger rebuilds searchable fields.
    NEW.lead_source := NULL;

    IF (
      NEW.display_name IS DISTINCT FROM 'Klient zanonimizowany'::text
      OR NEW.lead_source IS NOT NULL
      OR NEW.primary_email IS NOT NULL
      OR NEW.primary_phone IS NOT NULL
      OR coalesce(NEW.tags, array[]::text[]) <> array[]::text[]
      OR NEW.notes IS NOT NULL
      OR coalesce(NEW.metadata, '{}'::jsonb) <> '{}'::jsonb
    ) THEN
      RAISE EXCEPTION 'anonymized_client_payload_not_sanitized'
        USING errcode = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_anonymized_client_reidentification()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_clients_reject_anonymized_reidentification
  BEFORE INSERT OR UPDATE ON public.crm_clients
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_anonymized_client_reidentification();
