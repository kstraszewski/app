-- Persist privacy-minimal CRM context on the durable send ledger. The
-- database can then create the audit event in the same transaction that marks
-- provider delivery as sent, so a transient application failure cannot lose
-- `email_sent` after the API has returned success.

ALTER TABLE public.mail_send_requests
  ADD COLUMN crm_client_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
  ADD COLUMN crm_case_id uuid,
  ADD COLUMN crm_context_resolved boolean DEFAULT false NOT NULL;

ALTER TABLE public.mail_send_requests
  ADD CONSTRAINT mail_send_requests_crm_client_ids_check CHECK (
    cardinality(crm_client_ids) <= 10
    AND array_position(crm_client_ids, NULL::uuid) IS NULL
  ),
  ADD CONSTRAINT mail_send_requests_crm_context_resolution_check CHECK (
    crm_context_resolved
    OR (cardinality(crm_client_ids) = 0 AND crm_case_id IS NULL)
  );

COMMENT ON COLUMN public.mail_send_requests.crm_client_ids IS
  'Canonical CRM client identifiers for the audit/link side effects; never recipient addresses or message content.';

COMMENT ON COLUMN public.mail_send_requests.crm_case_id IS
  'Optional canonical CRM case identifier for the audit/link side effects.';

COMMENT ON COLUMN public.mail_send_requests.crm_context_resolved IS
  'True once recipient-to-CRM matching has been decided, including a deliberate no-match result; false identifies legacy rows eligible for one backfill.';

COMMENT ON TABLE public.mail_send_requests IS
  'Server-only provider-neutral send idempotency, delivery-state and CRM context metadata; never stores recipients, subjects, bodies or attachment filenames.';

CREATE FUNCTION private.protect_mail_send_request_crm_context()
RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
BEGIN
  IF OLD.crm_context_resolved
    AND (
      NEW.crm_client_ids IS DISTINCT FROM OLD.crm_client_ids
      OR NEW.crm_case_id IS DISTINCT FROM OLD.crm_case_id
      OR NEW.crm_context_resolved IS DISTINCT FROM true
    )
  THEN
    RAISE EXCEPTION 'mail_send_request_crm_context_immutable'
      USING errcode = '55000';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.protect_mail_send_request_crm_context()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER mail_send_requests_protect_crm_context
  BEFORE UPDATE OF crm_client_ids, crm_case_id, crm_context_resolved
  ON public.mail_send_requests
  FOR EACH ROW
  EXECUTE FUNCTION private.protect_mail_send_request_crm_context();

ALTER TABLE public.crm_activities
  ADD COLUMN mail_send_request_id uuid;

ALTER TABLE public.crm_activities
  ADD CONSTRAINT crm_activities_mail_send_request_type_check CHECK (
    mail_send_request_id IS NULL OR activity_type = 'email_sent'::text
  );

CREATE UNIQUE INDEX crm_activities_email_sent_request_context_key
  ON public.crm_activities (
    organization_id,
    mail_send_request_id,
    client_id,
    case_id
  ) NULLS NOT DISTINCT
  WHERE mail_send_request_id IS NOT NULL;

COMMENT ON COLUMN public.crm_activities.mail_send_request_id IS
  'Opaque durable idempotency source for an email_sent audit event; retained when private mailbox metadata is deleted.';

-- `email_sent` is a database-generated audit event. Organization members can
-- still manage ordinary manual activities, but cannot forge, edit or delete a
-- delivery event through the authenticated Data API.
DROP POLICY "organization members can create crm activities"
  ON public.crm_activities;
CREATE POLICY "organization members can create crm activities"
  ON public.crm_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    private.is_organization_member(organization_id)
    AND task_id IS NULL
    AND mail_send_request_id IS NULL
    AND activity_type <> 'email_sent'::text
  );

DROP POLICY "organization members can update non audit activities"
  ON public.crm_activities;
CREATE POLICY "organization members can update non audit activities"
  ON public.crm_activities
  FOR UPDATE TO authenticated
  USING (
    private.is_organization_member(organization_id)
    AND task_id IS NULL
    AND mail_send_request_id IS NULL
  )
  WITH CHECK (
    private.is_organization_member(organization_id)
    AND task_id IS NULL
    AND mail_send_request_id IS NULL
    AND activity_type <> 'email_sent'::text
  );

DROP POLICY "organization members can delete non audit activities"
  ON public.crm_activities;
CREATE POLICY "organization members can delete non audit activities"
  ON public.crm_activities
  FOR DELETE TO authenticated
  USING (
    private.is_organization_member(organization_id)
    AND task_id IS NULL
    AND mail_send_request_id IS NULL
  );

CREATE FUNCTION private.record_mail_sent_crm_activities()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  activity_created_at timestamptz;
  sole_client_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'sent'::text
    OR (NEW.crm_case_id IS NULL AND cardinality(NEW.crm_client_ids) = 0)
  THEN
    RETURN NEW;
  END IF;

  -- When a legacy sent row receives its context later, retain its previous
  -- sent timestamp. For a fresh sent transition, the standard updated_at
  -- trigger has already assigned the delivery confirmation time.
  activity_created_at := CASE
    WHEN OLD.status = 'sent'::text THEN OLD.updated_at
    ELSE NEW.updated_at
  END;

  IF NEW.crm_case_id IS NOT NULL THEN
    -- A case send is one logical timeline event. Attach the sole client to the
    -- same row so it appears once in both histories; multiple-client case
    -- sends stay case-only to avoid cross-client duplicates.
    sole_client_id := NULL;
    IF cardinality(NEW.crm_client_ids) = 1 THEN
      SELECT client.id
      INTO sole_client_id
      FROM public.crm_clients AS client
      WHERE client.organization_id = NEW.organization_id
        AND client.id = NEW.crm_client_ids[1]
        AND client.status_code IS DISTINCT FROM 'anonymized'::text;
    END IF;

    INSERT INTO public.crm_activities (
      organization_id,
      actor_user_id,
      client_id,
      case_id,
      mail_send_request_id,
      activity_type,
      title,
      body,
      payload,
      created_at
    )
    SELECT
      NEW.organization_id,
      NEW.owner_user_id,
      sole_client_id,
      crm_case.id,
      NEW.id,
      'email_sent'::text,
      'Wysłano wiadomość e-mail'::text,
      'Wiadomość została wysłana z klienta pocztowego.'::text,
      '{}'::jsonb,
      activity_created_at
    FROM public.crm_cases AS crm_case
    WHERE crm_case.organization_id = NEW.organization_id
      AND crm_case.id = NEW.crm_case_id
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.crm_activities (
      organization_id,
      actor_user_id,
      client_id,
      case_id,
      mail_send_request_id,
      activity_type,
      title,
      body,
      payload,
      created_at
    )
    SELECT
      NEW.organization_id,
      NEW.owner_user_id,
      client.id,
      NULL::uuid,
      NEW.id,
      'email_sent'::text,
      'Wysłano wiadomość e-mail'::text,
      'Wiadomość została wysłana z klienta pocztowego.'::text,
      '{}'::jsonb,
      activity_created_at
    FROM unnest(NEW.crm_client_ids) AS context_client(id)
    JOIN public.crm_clients AS client
      ON client.organization_id = NEW.organization_id
      AND client.id = context_client.id
      AND client.status_code IS DISTINCT FROM 'anonymized'::text
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.record_mail_sent_crm_activities()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER mail_send_requests_record_email_sent_activity
  AFTER UPDATE OF status, crm_client_ids, crm_case_id, crm_context_resolved
  ON public.mail_send_requests
  FOR EACH ROW
  WHEN (NEW.status = 'sent'::text)
  EXECUTE FUNCTION private.record_mail_sent_crm_activities();
