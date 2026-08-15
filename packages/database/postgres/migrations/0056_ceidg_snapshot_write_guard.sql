-- CEIDG provenance is trusted only when written by the Nuxt server. Browser
-- sessions also receive direct authenticated Data API tokens, so enforce this
-- boundary below both the REST handler and the client-creation RPC.

-- Rebuild registry-name projections created before 0055 without changing the
-- business timestamp used for sorting and optimistic concurrency.
ALTER TABLE public.crm_clients DISABLE TRIGGER set_crm_clients_updated_at;

UPDATE public.crm_clients
SET metadata = metadata
WHERE nullif(btrim(metadata ->> 'registry_name'), '') IS NOT NULL;

ALTER TABLE public.crm_clients ENABLE TRIGGER set_crm_clients_updated_at;

-- Backend tokens intentionally cannot contain `sub`. A dedicated actor claim
-- lets a narrowly constructed server writer retain user-level membership and
-- audit checks without weakening that token contract for ordinary services.
CREATE OR REPLACE FUNCTION app.request_jwt_subject()
RETURNS uuid
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $$
DECLARE
  candidate text;
  jwt_claims text;
BEGIN
  candidate := nullif(current_setting('request.jwt.claim.sub', true), '');
  jwt_claims := nullif(current_setting('request.jwt.claims', true), '');

  IF candidate IS NULL AND jwt_claims IS NOT NULL THEN
    candidate := nullif(jwt_claims::jsonb ->> 'sub', '');
  END IF;

  -- This claim is emitted only by the private-key-backed trusted writer. It
  -- must remain visible inside SECURITY DEFINER membership helpers, where
  -- `current_user` becomes the function owner.
  IF candidate IS NULL THEN
    candidate := nullif(
      current_setting('request.jwt.claim.actor_user_id', true),
      ''
    );
    IF candidate IS NULL AND jwt_claims IS NOT NULL THEN
      candidate := nullif(jwt_claims::jsonb ->> 'actor_user_id', '');
    END IF;
  END IF;

  candidate := coalesce(
    candidate,
    nullif(current_setting('app.user_id', true), '')
  );

  RETURN candidate::uuid;
END;
$$;

CREATE FUNCTION private.crm_client_ceidg_snapshot(source_metadata jsonb)
RETURNS jsonb
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $$
  SELECT coalesce(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb)
  FROM jsonb_each(coalesce(source_metadata, '{}'::jsonb)) entry
  WHERE entry.key = ANY (ARRAY[
    'entity_type',
    'nip',
    'regon',
    'registry_name',
    'registry_number',
    'registry_source',
    'registry_status',
    'registry_api_version',
    'registry_retrieved_at',
    'legal_form',
    'business_address',
    'correspondence_address',
    'business_start_date',
    'business_suspension_date',
    'business_resume_date',
    'business_termination_date',
    'business_removal_date',
    'main_pkd_code',
    'main_pkd_name',
    'pkd_codes',
    'company_email',
    'company_phone',
    'company_website',
    'tax_id',
    'krs'
  ]::text[]);
$$;

REVOKE ALL ON FUNCTION private.crm_client_ceidg_snapshot(jsonb)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- The invoker trigger calls this pure extractor while retaining the caller's
-- role for the trust decision below.
GRANT EXECUTE ON FUNCTION private.crm_client_ceidg_snapshot(jsonb)
  TO authenticated, openexpert_service;

CREATE FUNCTION private.protect_crm_client_ceidg_snapshot()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO ''
  AS $$
DECLARE
  old_is_ceidg boolean := false;
  new_is_ceidg boolean := upper(btrim(coalesce(NEW.metadata ->> 'registry_source', ''))) = 'CEIDG';
  snapshot_changed boolean;
  trusted_actor_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_is_ceidg := upper(btrim(coalesce(OLD.metadata ->> 'registry_source', ''))) = 'CEIDG';
  END IF;

  IF NOT (old_is_ceidg OR new_is_ceidg) THEN
    RETURN NEW;
  END IF;

  snapshot_changed := TG_OP = 'INSERT'
    OR private.crm_client_ceidg_snapshot(NEW.metadata)
      IS DISTINCT FROM private.crm_client_ceidg_snapshot(OLD.metadata);

  IF NOT snapshot_changed THEN
    RETURN NEW;
  END IF;

  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'ceidg_snapshot_write_requires_trusted_server'
      USING errcode = '42501';
  END IF;

  IF current_user = 'openexpert_service' THEN
    trusted_actor_id := app.current_user_id();
    IF trusted_actor_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships membership
      WHERE membership.organization_id = NEW.organization_id
        AND membership.user_id = trusted_actor_id
    ) THEN
      RAISE EXCEPTION 'ceidg_snapshot_actor_membership_required'
        USING errcode = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_crm_client_ceidg_snapshot()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_clients_protect_ceidg_snapshot
  BEFORE INSERT OR UPDATE OF metadata ON public.crm_clients
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_crm_client_ceidg_snapshot();

-- The trusted writer resolves its signed actor claim through
-- app.current_user_id(), so the existing RPC still performs its
-- organization/owner checks and records the correct actor.
GRANT EXECUTE ON FUNCTION public.create_crm_client_with_consents(
  uuid, uuid, text, text, text, text, text, text[], text, jsonb, jsonb, jsonb
) TO openexpert_service;

GRANT EXECUTE ON FUNCTION private.is_organization_admin(uuid)
  TO openexpert_service;

-- Client updates and their audit insert are separate Data API transactions.
-- Serialize activity writes with anonymization so no payload can be appended
-- after the workflow has scrubbed all existing client activities.
CREATE FUNCTION private.reject_anonymized_client_activity_write()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_client_status text;
BEGIN
  IF NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT client.status_code
  INTO target_client_status
  FROM public.crm_clients client
  WHERE client.organization_id = NEW.organization_id
    AND client.id = NEW.client_id
  FOR UPDATE;

  IF target_client_status = 'anonymized'::text THEN
    RAISE EXCEPTION 'anonymized_client_activity_forbidden'
      USING errcode = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.reject_anonymized_client_activity_write()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_activities_reject_anonymized_client_write
  BEFORE INSERT OR UPDATE ON public.crm_activities
  FOR EACH ROW
  EXECUTE FUNCTION private.reject_anonymized_client_activity_write();
