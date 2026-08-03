-- Autosaved, click-only preparation for a client's first CRM meeting.
-- The appointment authorizes the client flow, while the durable artifact is
-- tenant- and case-scoped so the assigned expert can use it before the call.

-- This otherwise redundant unique key lets the preparation row prove that its
-- client and CRM person are exactly the subjects of the referenced appointment.
CREATE UNIQUE INDEX appointments_meeting_preparation_scope_key
  ON public.appointments (
    organization_id,
    id,
    client_id,
    client_person_id
  );

CREATE TABLE public.crm_case_meeting_preparations (
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  client_id uuid NOT NULL,
  client_person_id uuid NOT NULL,
  answers jsonb NOT NULL,
  revision bigint DEFAULT 1 NOT NULL,
  completed_at timestamp with time zone,
  updated_by_client_person_id uuid,
  updated_by_auth_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_case_meeting_preparations_pkey PRIMARY KEY (
    organization_id,
    case_id,
    appointment_id
  ),
  CONSTRAINT crm_case_meeting_preparations_appointment_key UNIQUE (
    organization_id,
    appointment_id
  ),
  CONSTRAINT crm_case_meeting_preparations_revision_check CHECK (
    revision >= 1
  ),
  CONSTRAINT crm_case_meeting_preparations_answers_check CHECK (
    jsonb_typeof(answers) = 'object'::text
    AND answers -> 'version' = '2'::jsonb
    AND pg_column_size(answers) <= 32768
  ),
  CONSTRAINT crm_case_meeting_preparations_actor_pair_check CHECK (
    (updated_by_client_person_id IS NULL)
      = (updated_by_auth_user_id IS NULL)
  ),
  CONSTRAINT crm_case_meeting_preparations_actor_subject_check CHECK (
    updated_by_client_person_id IS NULL
    OR updated_by_client_person_id = client_person_id
  ),
  CONSTRAINT crm_case_meeting_preparations_case_fkey FOREIGN KEY (
    organization_id,
    case_id
  ) REFERENCES public.crm_cases (
    organization_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_meeting_preparations_case_client_fkey FOREIGN KEY (
    case_id,
    client_id
  ) REFERENCES public.crm_case_clients (
    case_id,
    client_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_meeting_preparations_appointment_scope_fkey FOREIGN KEY (
    organization_id,
    appointment_id,
    client_id,
    client_person_id
  ) REFERENCES public.appointments (
    organization_id,
    id,
    client_id,
    client_person_id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_meeting_preparations_actor_person_fkey FOREIGN KEY (
    organization_id,
    updated_by_client_person_id
  ) REFERENCES public.crm_client_people (
    organization_id,
    id
  ) ON DELETE SET NULL (updated_by_client_person_id),
  CONSTRAINT crm_case_meeting_preparations_actor_auth_user_fkey FOREIGN KEY (
    updated_by_auth_user_id
  ) REFERENCES public.profiles (id)
    ON DELETE SET NULL
);

COMMENT ON TABLE public.crm_case_meeting_preparations IS
  'Current autosaved client preparation for one CRM case and first-meeting appointment. Server-normalized answers contain only bounded choice identifiers.';
COMMENT ON COLUMN public.crm_case_meeting_preparations.answers IS
  'Versioned, bounded click-only preparation payload. Completion and audit timestamps remain server-owned columns.';
COMMENT ON COLUMN public.crm_case_meeting_preparations.revision IS
  'Monotonic optimistic-concurrency revision returned to the client after every committed autosave.';

CREATE INDEX crm_case_meeting_preparations_case_updated_idx
  ON public.crm_case_meeting_preparations (
    organization_id,
    case_id,
    updated_at DESC,
    appointment_id
  );

CREATE INDEX crm_case_meeting_preparations_client_person_idx
  ON public.crm_case_meeting_preparations (
    organization_id,
    client_person_id,
    updated_at DESC
  );

CREATE FUNCTION private.normalize_crm_case_meeting_preparation_actor()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  -- ON DELETE SET NULL foreign-key actions update one actor column at a time.
  -- Clear the pair together so a half-identity can never survive anonymization.
  IF (new.updated_by_client_person_id IS NULL)
     <> (new.updated_by_auth_user_id IS NULL) THEN
    new.updated_by_client_person_id := NULL;
    new.updated_by_auth_user_id := NULL;
  END IF;

  RETURN new;
END
$function$;

REVOKE ALL ON FUNCTION private.normalize_crm_case_meeting_preparation_actor()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER normalize_crm_case_meeting_preparation_actor
  BEFORE INSERT OR UPDATE ON public.crm_case_meeting_preparations
  FOR EACH ROW
  EXECUTE FUNCTION private.normalize_crm_case_meeting_preparation_actor();

CREATE TRIGGER set_crm_case_meeting_preparations_updated_at
  BEFORE UPDATE ON public.crm_case_meeting_preparations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.crm_case_meeting_preparations ENABLE ROW LEVEL SECURITY;

-- Client portal endpoints use a server-signed service token after validating
-- the Better Auth identity, account link, appointment and case/client scope.
CREATE POLICY openexpert_service_all
  ON public.crm_case_meeting_preparations
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.crm_case_meeting_preparations
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.crm_case_meeting_preparations
  TO openexpert_service;
