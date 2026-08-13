-- Durable organization-scoped outbox and evidence ledger for the OFI and RODO
-- documents delivered when a CRM client is created. The delivery is pinned to
-- an immutable intermediary-settings revision, while the generated PDF hashes
-- and storage paths become immutable once recorded.

CREATE FUNCTION private.organization_intermediary_documents_ready(
  p_settings jsonb
) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $$
  SELECT coalesce(
    jsonb_typeof(p_settings) = 'object'::text
    AND nullif(btrim(p_settings #>> '{intermediary,legalName}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{intermediary,registeredOffice}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{intermediary,addressLine}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{intermediary,postalCode}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{intermediary,city}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{intermediary,mortgageRegisterNumber}'), '') IS NOT NULL
    AND coalesce(
      p_settings #>> '{intermediary,mortgageRegisterUrl}',
      ''::text
    ) ~* '^(https://[^[:space:]]+|/[a-z0-9/_\.-]+)$'::text
    AND (
      coalesce(p_settings #>> '{relationship,isTiedMortgageIntermediary}', 'false') <> 'true'
      OR CASE
        WHEN jsonb_typeof(p_settings #> '{relationship,lenderNames}') = 'array'::text
          THEN jsonb_array_length(p_settings #> '{relationship,lenderNames}') > 0
        ELSE false
      END
    )
    AND nullif(btrim(p_settings #>> '{complaints,internalProcedure}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{complaints,externalProcedure}'), '') IS NOT NULL
    AND (
      coalesce(p_settings #>> '{remuneration,receivesFromLenders}', 'false') <> 'true'
      OR nullif(
        btrim(p_settings #>> '{remuneration,lenderRemunerationDescription}'),
        ''
      ) IS NOT NULL
    )
    AND (
      coalesce(p_settings #>> '{remuneration,receivesFromLenders}', 'false') <> 'true'
      OR coalesce(
        p_settings #>> '{remuneration,lenderRemunerationAmountKnown}',
        'false'
      ) <> 'true'
      OR nullif(
        btrim(p_settings #>> '{remuneration,lenderRemunerationAmountDescription}'),
        ''
      ) IS NOT NULL
    )
    AND (
      coalesce(p_settings #>> '{remuneration,chargesClientFees}', 'false') <> 'true'
      OR nullif(
        btrim(p_settings #>> '{remuneration,clientFeeDescription}'),
        ''
      ) IS NOT NULL
    )
    AND (
      coalesce(p_settings ->> 'providerRole', 'intermediary') <> 'agent'
      OR (
        nullif(btrim(p_settings #>> '{agent,legalName}'), '') IS NOT NULL
        AND nullif(btrim(p_settings #>> '{agent,roleDescription}'), '') IS NOT NULL
      )
    )
    AND nullif(btrim(p_settings #>> '{privacy,controllerName}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{privacy,controllerAddress}'), '') IS NOT NULL
    AND coalesce(
      p_settings #>> '{privacy,controllerEmail}',
      ''::text
    ) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text
    AND (
      coalesce(p_settings #>> '{privacy,dpoAppointed}', 'false') <> 'true'
      OR coalesce(
        p_settings #>> '{privacy,dpoEmail}',
        ''::text
      ) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'::text
      OR nullif(btrim(p_settings #>> '{privacy,dpoPhone}'), '') IS NOT NULL
    )
    AND nullif(btrim(p_settings #>> '{privacy,purposesAndLegalBases}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{privacy,recipientCategories}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{privacy,retentionPolicy}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{privacy,dataSubjectRights}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{privacy,complaintAuthority}'), '') IS NOT NULL
    AND nullif(btrim(p_settings #>> '{privacy,dataProvisionRequirements}'), '') IS NOT NULL
    AND (
      coalesce(p_settings #>> '{privacy,usesLegitimateInterests}', 'false') <> 'true'
      OR nullif(
        btrim(p_settings #>> '{privacy,legitimateInterestsDescription}'),
        ''
      ) IS NOT NULL
    )
    AND (
      coalesce(p_settings #>> '{privacy,transfersOutsideEea}', 'false') <> 'true'
      OR nullif(
        btrim(p_settings #>> '{privacy,transferSafeguardsDescription}'),
        ''
      ) IS NOT NULL
    )
    AND (
      coalesce(p_settings #>> '{privacy,usesAutomatedDecisionMaking}', 'false') <> 'true'
      OR nullif(
        btrim(p_settings #>> '{privacy,automatedDecisionMakingDescription}'),
        ''
      ) IS NOT NULL
    )
    AND (
      coalesce(p_settings #>> '{privacy,obtainsDataIndirectly}', 'false') <> 'true'
      OR (
        nullif(btrim(p_settings #>> '{privacy,indirectDataCategories}'), '') IS NOT NULL
        AND nullif(btrim(p_settings #>> '{privacy,indirectDataSources}'), '') IS NOT NULL
      )
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION private.organization_intermediary_documents_ready(jsonb)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TABLE public.crm_client_legal_document_deliveries (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  intermediary_settings_revision bigint,
  recipient_email text,
  recipient_email_hash text,
  trigger_kind text DEFAULT 'client_created'::text NOT NULL,
  idempotency_key text NOT NULL,
  generator_version integer DEFAULT 2 NOT NULL,
  email_template_version integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 10 NOT NULL,
  available_at timestamp with time zone DEFAULT now() NOT NULL,
  locked_at timestamp with time zone,
  locked_by text,
  last_error text,
  provider text,
  provider_message_id text,
  ofi_sha256 text,
  ofi_size_bytes bigint,
  ofi_storage_path text,
  rodo_sha256 text,
  rodo_size_bytes bigint,
  rodo_storage_path text,
  generated_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_at timestamp with time zone,
  CONSTRAINT crm_client_legal_document_deliveries_pkey PRIMARY KEY (id),
  CONSTRAINT crm_client_legal_document_deliveries_org_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT crm_client_legal_document_deliveries_idempotency_key
    UNIQUE (organization_id, idempotency_key),
  CONSTRAINT crm_client_legal_document_deliveries_client_trigger_key
    UNIQUE (
      organization_id,
      client_id,
      trigger_kind,
      generator_version,
      email_template_version
    ),
  CONSTRAINT crm_client_legal_document_deliveries_trigger_check CHECK (
    trigger_kind = 'client_created'::text
  ),
  CONSTRAINT crm_client_legal_document_deliveries_idempotency_check CHECK (
    nullif(btrim(idempotency_key), '') IS NOT NULL
    AND char_length(idempotency_key) <= 500
  ),
  CONSTRAINT crm_client_legal_document_deliveries_versions_check CHECK (
    generator_version BETWEEN 1 AND 32767
    AND email_template_version BETWEEN 1 AND 32767
  ),
  CONSTRAINT crm_client_legal_document_deliveries_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'processing'::text,
      'sent'::text,
      'failed'::text,
      'blocked_missing_email'::text,
      'blocked_incomplete_settings'::text
    ])
  ),
  CONSTRAINT crm_client_legal_document_deliveries_attempts_check CHECK (
    attempts >= 0
    AND max_attempts BETWEEN 1 AND 100
    AND attempts <= max_attempts
  ),
  CONSTRAINT crm_client_legal_document_deliveries_recipient_check CHECK (
    recipient_email IS NULL
    OR (
      nullif(btrim(recipient_email), '') IS NOT NULL
      AND char_length(recipient_email) <= 254
    )
  ),
  CONSTRAINT crm_client_legal_document_deliveries_recipient_hash_check CHECK (
    recipient_email_hash IS NULL
    OR recipient_email_hash ~ '^[0-9a-f]{64}$'::text
  ),
  CONSTRAINT crm_client_legal_document_deliveries_ready_shape_check CHECK (
    status NOT IN ('pending'::text, 'processing'::text, 'failed'::text, 'sent'::text)
    OR (
      intermediary_settings_revision IS NOT NULL
      AND recipient_email_hash IS NOT NULL
    )
  ),
  CONSTRAINT crm_client_legal_document_deliveries_lock_shape_check CHECK (
    (
      status = 'processing'::text
      AND locked_at IS NOT NULL
      AND nullif(btrim(locked_by), '') IS NOT NULL
      AND attempts >= 1
    )
    OR (
      status <> 'processing'::text
      AND locked_at IS NULL
      AND locked_by IS NULL
    )
  ),
  CONSTRAINT crm_client_legal_document_deliveries_locked_by_check CHECK (
    locked_by IS NULL OR char_length(locked_by) <= 200
  ),
  CONSTRAINT crm_client_legal_document_deliveries_last_error_check CHECK (
    last_error IS NULL OR char_length(last_error) <= 4000
  ),
  CONSTRAINT crm_client_legal_document_deliveries_provider_check CHECK (
    provider IS NULL
    OR (nullif(btrim(provider), '') IS NOT NULL AND char_length(provider) <= 100)
  ),
  CONSTRAINT crm_client_legal_document_deliveries_provider_message_check CHECK (
    provider_message_id IS NULL
    OR (
      provider IS NOT NULL
      AND nullif(btrim(provider_message_id), '') IS NOT NULL
      AND char_length(provider_message_id) <= 500
    )
  ),
  CONSTRAINT crm_client_legal_document_deliveries_pdf_shape_check CHECK (
    (
      ofi_sha256 IS NULL
      AND ofi_size_bytes IS NULL
      AND ofi_storage_path IS NULL
      AND rodo_sha256 IS NULL
      AND rodo_size_bytes IS NULL
      AND rodo_storage_path IS NULL
      AND generated_at IS NULL
    )
    OR (
      ofi_sha256 ~ '^[0-9a-f]{64}$'::text
      AND ofi_size_bytes BETWEEN 1 AND 5242880
      AND nullif(btrim(ofi_storage_path), '') IS NOT NULL
      AND char_length(ofi_storage_path) <= 1000
      AND rodo_sha256 ~ '^[0-9a-f]{64}$'::text
      AND rodo_size_bytes BETWEEN 1 AND 5242880
      AND nullif(btrim(rodo_storage_path), '') IS NOT NULL
      AND char_length(rodo_storage_path) <= 1000
      AND generated_at IS NOT NULL
    )
  ),
  CONSTRAINT crm_client_legal_document_deliveries_sent_shape_check CHECK (
    (status = 'sent'::text AND sent_at IS NOT NULL AND generated_at IS NOT NULL)
    OR (status <> 'sent'::text AND sent_at IS NULL)
  ),
  CONSTRAINT crm_client_legal_document_deliveries_timestamp_check CHECK (
    updated_at >= created_at
    AND (generated_at IS NULL OR generated_at >= created_at)
    AND (sent_at IS NULL OR sent_at >= created_at)
  ),
  CONSTRAINT crm_client_legal_document_deliveries_organization_fk
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations (id) ON DELETE CASCADE,
  CONSTRAINT crm_client_legal_document_deliveries_client_fk
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.crm_clients (organization_id, id) ON DELETE RESTRICT,
  CONSTRAINT crm_client_legal_document_deliveries_settings_revision_fk
    FOREIGN KEY (organization_id, intermediary_settings_revision)
    REFERENCES public.organization_intermediary_setting_revisions (
      organization_id,
      revision
    ) ON DELETE RESTRICT
);

COMMENT ON TABLE public.crm_client_legal_document_deliveries IS
  'Durable OFI/RODO client-created outbox and evidence record. Delivery content is pinned to an immutable intermediary-settings revision.';

CREATE INDEX crm_client_legal_document_deliveries_ready_idx
  ON public.crm_client_legal_document_deliveries (available_at, created_at, id)
  WHERE status = ANY (ARRAY['pending'::text, 'failed'::text])
    AND attempts < max_attempts;

CREATE INDEX crm_client_legal_document_deliveries_stale_lock_idx
  ON public.crm_client_legal_document_deliveries (locked_at, id)
  WHERE status = 'processing'::text;

CREATE INDEX crm_client_legal_document_deliveries_client_idx
  ON public.crm_client_legal_document_deliveries (
    organization_id,
    client_id,
    created_at DESC,
    id DESC
  );

CREATE UNIQUE INDEX crm_client_legal_document_deliveries_provider_id_idx
  ON public.crm_client_legal_document_deliveries (provider, provider_message_id)
  WHERE provider IS NOT NULL AND provider_message_id IS NOT NULL;

CREATE TABLE public.crm_client_legal_document_delivery_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  attempt integer NOT NULL,
  worker_id text,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_client_legal_document_delivery_events_pkey PRIMARY KEY (id),
  CONSTRAINT crm_client_legal_document_delivery_events_type_check CHECK (
    event_type = ANY (ARRAY[
      'queued'::text,
      'claimed'::text,
      'lock_recovered'::text,
      'sent'::text,
      'failed'::text,
      'blocked_missing_email'::text,
      'blocked_incomplete_settings'::text,
      'requeued'::text,
      'recipient_updated'::text,
      'anonymized'::text
    ])
  ),
  CONSTRAINT crm_client_legal_document_delivery_events_status_check CHECK (
    from_status IS NULL
    OR from_status = ANY (ARRAY[
      'pending'::text,
      'processing'::text,
      'sent'::text,
      'failed'::text,
      'blocked_missing_email'::text,
      'blocked_incomplete_settings'::text
    ])
  ),
  CONSTRAINT crm_client_legal_document_delivery_events_to_status_check CHECK (
    to_status = ANY (ARRAY[
      'pending'::text,
      'processing'::text,
      'sent'::text,
      'failed'::text,
      'blocked_missing_email'::text,
      'blocked_incomplete_settings'::text
    ])
  ),
  CONSTRAINT crm_client_legal_document_delivery_events_attempt_check CHECK (
    attempt >= 0
  ),
  CONSTRAINT crm_client_legal_document_delivery_events_worker_check CHECK (
    worker_id IS NULL OR char_length(worker_id) <= 200
  ),
  CONSTRAINT crm_client_legal_document_delivery_events_details_check CHECK (
    jsonb_typeof(details) = 'object'::text
    AND pg_column_size(details) <= 4096
  ),
  CONSTRAINT crm_client_legal_document_delivery_events_delivery_fk
    FOREIGN KEY (organization_id, delivery_id)
    REFERENCES public.crm_client_legal_document_deliveries (
      organization_id,
      id
    ) ON DELETE CASCADE
);

COMMENT ON TABLE public.crm_client_legal_document_delivery_events IS
  'Application-append-only state transition ledger for OFI/RODO delivery jobs.';

CREATE INDEX crm_client_legal_document_delivery_events_delivery_idx
  ON public.crm_client_legal_document_delivery_events (
    organization_id,
    delivery_id,
    created_at,
    id
  );

CREATE FUNCTION private.record_client_legal_document_delivery_event(
  p_organization_id uuid,
  p_delivery_id uuid,
  p_event_type text,
  p_from_status text,
  p_to_status text,
  p_attempt integer,
  p_worker_id text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
BEGIN
  INSERT INTO public.crm_client_legal_document_delivery_events (
    organization_id,
    delivery_id,
    event_type,
    from_status,
    to_status,
    attempt,
    worker_id,
    details
  ) VALUES (
    p_organization_id,
    p_delivery_id,
    p_event_type,
    p_from_status,
    p_to_status,
    p_attempt,
    nullif(btrim(p_worker_id), ''),
    coalesce(p_details, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION private.record_client_legal_document_delivery_event(
  uuid,
  uuid,
  text,
  text,
  text,
  integer,
  text,
  jsonb
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE FUNCTION private.enqueue_client_legal_document_delivery()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  settings_revision bigint;
  settings_payload jsonb;
  target_status text;
  target_email text := NEW.primary_email_normalized;
  delivery_id uuid;
BEGIN
  SELECT settings.revision, settings.settings
  INTO settings_revision, settings_payload
  FROM public.organization_intermediary_settings AS settings
  WHERE settings.organization_id = NEW.organization_id;

  target_status := CASE
    WHEN target_email IS NULL THEN 'blocked_missing_email'::text
    WHEN settings_revision IS NULL
      OR NOT private.organization_intermediary_documents_ready(settings_payload)
      THEN 'blocked_incomplete_settings'::text
    ELSE 'pending'::text
  END;

  INSERT INTO public.crm_client_legal_document_deliveries (
    organization_id,
    client_id,
    intermediary_settings_revision,
    recipient_email,
    recipient_email_hash,
    trigger_kind,
    idempotency_key,
    generator_version,
    email_template_version,
    status
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    settings_revision,
    target_email,
    CASE
      WHEN target_email IS NULL THEN NULL
      ELSE encode(extensions.digest(target_email, 'sha256'::text), 'hex'::text)
    END,
    'client_created'::text,
    'crm-client-created:'::text || NEW.id::text || ':ofi-rodo:v2'::text,
    2,
    1,
    target_status
  )
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING
  RETURNING id INTO delivery_id;

  IF delivery_id IS NOT NULL THEN
    PERFORM private.record_client_legal_document_delivery_event(
      NEW.organization_id,
      delivery_id,
      'queued'::text,
      NULL,
      target_status,
      0,
      NULL,
      jsonb_build_object(
        'triggerKind', 'client_created'::text,
        'settingsRevision', settings_revision
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enqueue_client_legal_document_delivery()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_clients_enqueue_legal_document_delivery
  AFTER INSERT ON public.crm_clients
  FOR EACH ROW
  EXECUTE FUNCTION private.enqueue_client_legal_document_delivery();

-- Keep unsent jobs synchronized with an intentional e-mail correction. A sent
-- record remains immutable evidence of the address used for that delivery.
-- Anonymization always scrubs the clear-text recipient, including sent rows.
CREATE FUNCTION private.refresh_client_legal_document_delivery_recipient()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  latest_revision bigint;
  latest_settings jsonb;
  settings_ready boolean := false;
  changed record;
BEGIN
  IF NEW.status_code = 'anonymized'::text THEN
    FOR changed IN
      WITH candidates AS (
        SELECT delivery.id, delivery.status
        FROM public.crm_client_legal_document_deliveries AS delivery
        WHERE delivery.organization_id = NEW.organization_id
          AND delivery.client_id = NEW.id
          AND (
            delivery.recipient_email IS NOT NULL
            OR delivery.status = ANY (ARRAY[
              'pending'::text,
              'processing'::text,
              'failed'::text
            ])
          )
        FOR UPDATE
      ), updated AS (
        UPDATE public.crm_client_legal_document_deliveries AS delivery
        SET
          recipient_email = NULL,
          status = CASE
            WHEN delivery.status = ANY (ARRAY[
              'pending'::text,
              'processing'::text,
              'failed'::text
            ]) THEN 'blocked_missing_email'::text
            ELSE delivery.status
          END,
          locked_at = NULL,
          locked_by = NULL,
          last_error = CASE
            WHEN delivery.status = 'sent'::text THEN delivery.last_error
            ELSE 'client_anonymized_before_delivery'::text
          END,
          updated_at = statement_timestamp()
        FROM candidates
        WHERE delivery.id = candidates.id
        RETURNING
          delivery.id,
          delivery.organization_id,
          delivery.status,
          delivery.attempts,
          candidates.status AS previous_status
      )
      SELECT * FROM updated
    LOOP
      PERFORM private.record_client_legal_document_delivery_event(
        changed.organization_id,
        changed.id,
        'anonymized'::text,
        changed.previous_status,
        changed.status,
        changed.attempts,
        NULL,
        '{}'::jsonb
      );
    END LOOP;

    RETURN NEW;
  END IF;

  IF NEW.primary_email_normalized IS NOT DISTINCT FROM OLD.primary_email_normalized THEN
    RETURN NEW;
  END IF;

  SELECT settings.revision, settings.settings
  INTO latest_revision, latest_settings
  FROM public.organization_intermediary_settings AS settings
  WHERE settings.organization_id = NEW.organization_id;

  settings_ready := latest_revision IS NOT NULL
    AND private.organization_intermediary_documents_ready(latest_settings);

  FOR changed IN
    WITH candidates AS (
      SELECT delivery.id, delivery.status
      FROM public.crm_client_legal_document_deliveries AS delivery
      WHERE delivery.organization_id = NEW.organization_id
        AND delivery.client_id = NEW.id
        AND delivery.status <> 'sent'::text
        AND (
          delivery.status <> 'processing'::text
          OR NEW.primary_email_normalized IS NULL
        )
      FOR UPDATE
    ), updated AS (
      UPDATE public.crm_client_legal_document_deliveries AS delivery
      SET
        recipient_email = NEW.primary_email_normalized,
        recipient_email_hash = CASE
          WHEN NEW.primary_email_normalized IS NULL THEN NULL
          ELSE encode(
            extensions.digest(NEW.primary_email_normalized, 'sha256'::text),
            'hex'::text
          )
        END,
        intermediary_settings_revision = CASE
          WHEN delivery.status = ANY (ARRAY[
            'blocked_missing_email'::text,
            'blocked_incomplete_settings'::text
          ]) THEN latest_revision
          ELSE delivery.intermediary_settings_revision
        END,
        status = CASE
          WHEN NEW.primary_email_normalized IS NULL
            THEN 'blocked_missing_email'::text
          WHEN delivery.status = ANY (ARRAY[
            'blocked_missing_email'::text,
            'blocked_incomplete_settings'::text
          ]) AND NOT settings_ready
            THEN 'blocked_incomplete_settings'::text
          ELSE 'pending'::text
        END,
        available_at = statement_timestamp(),
        locked_at = NULL,
        locked_by = NULL,
        last_error = CASE
          WHEN NEW.primary_email_normalized IS NULL
            THEN 'client_email_missing'::text
          WHEN delivery.status = ANY (ARRAY[
            'blocked_missing_email'::text,
            'blocked_incomplete_settings'::text
          ]) AND NOT settings_ready
            THEN 'intermediary_settings_incomplete'::text
          ELSE NULL
        END,
        updated_at = statement_timestamp()
      FROM candidates
      WHERE delivery.id = candidates.id
      RETURNING
        delivery.id,
        delivery.organization_id,
        delivery.status,
        delivery.attempts,
        delivery.intermediary_settings_revision,
        candidates.status AS previous_status
    )
    SELECT * FROM updated
  LOOP
    PERFORM private.record_client_legal_document_delivery_event(
      changed.organization_id,
      changed.id,
      CASE
        WHEN changed.status = 'pending'::text THEN 'requeued'::text
        WHEN changed.status = 'blocked_missing_email'::text
          THEN 'blocked_missing_email'::text
        ELSE 'recipient_updated'::text
      END,
      changed.previous_status,
      changed.status,
      changed.attempts,
      NULL,
      jsonb_build_object(
        'settingsRevision', changed.intermediary_settings_revision
      )
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.refresh_client_legal_document_delivery_recipient()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE TRIGGER crm_clients_refresh_legal_document_delivery_recipient
  AFTER UPDATE OF primary_email, status_code ON public.crm_clients
  FOR EACH ROW
  EXECUTE FUNCTION private.refresh_client_legal_document_delivery_recipient();

-- A blocked job follows the newest settings revision until the documents are
-- complete. Once queued/claimed, its pinned revision is never silently moved.
CREATE FUNCTION private.requeue_client_legal_document_deliveries_for_settings()
RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  settings_ready boolean := private.organization_intermediary_documents_ready(
    NEW.settings
  );
  changed record;
BEGIN
  FOR changed IN
    WITH candidates AS (
      SELECT delivery.id, delivery.status
      FROM public.crm_client_legal_document_deliveries AS delivery
      WHERE delivery.organization_id = NEW.organization_id
        AND delivery.status = 'blocked_incomplete_settings'::text
      FOR UPDATE
    ), updated AS (
      UPDATE public.crm_client_legal_document_deliveries AS delivery
      SET
        intermediary_settings_revision = NEW.revision,
        status = CASE
          WHEN delivery.recipient_email IS NULL
            THEN 'blocked_missing_email'::text
          WHEN settings_ready THEN 'pending'::text
          ELSE 'blocked_incomplete_settings'::text
        END,
        available_at = CASE
          WHEN settings_ready AND delivery.recipient_email IS NOT NULL
            THEN statement_timestamp()
          ELSE delivery.available_at
        END,
        last_error = CASE
          WHEN delivery.recipient_email IS NULL THEN 'client_email_missing'::text
          WHEN settings_ready THEN NULL
          ELSE 'intermediary_settings_incomplete'::text
        END,
        updated_at = statement_timestamp()
      FROM candidates
      WHERE delivery.id = candidates.id
      RETURNING
        delivery.id,
        delivery.organization_id,
        delivery.status,
        delivery.attempts,
        candidates.status AS previous_status
    )
    SELECT * FROM updated
  LOOP
    PERFORM private.record_client_legal_document_delivery_event(
      changed.organization_id,
      changed.id,
      CASE
        WHEN changed.status = 'pending'::text THEN 'requeued'::text
        WHEN changed.status = 'blocked_missing_email'::text
          THEN 'blocked_missing_email'::text
        ELSE 'blocked_incomplete_settings'::text
      END,
      changed.previous_status,
      changed.status,
      changed.attempts,
      NULL,
      jsonb_build_object('settingsRevision', NEW.revision)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.requeue_client_legal_document_deliveries_for_settings()
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

-- Trigger names are run alphabetically for the same event; the 0047 `audit`
-- trigger therefore persists NEW.revision before this `requeue` trigger uses it.
CREATE TRIGGER organization_intermediary_settings_requeue_legal_documents
  AFTER INSERT OR UPDATE ON public.organization_intermediary_settings
  FOR EACH ROW
  EXECUTE FUNCTION private.requeue_client_legal_document_deliveries_for_settings();

CREATE FUNCTION public.claim_client_legal_document_deliveries(
  p_worker_id text,
  p_limit integer DEFAULT 10
) RETURNS SETOF public.crm_client_legal_document_deliveries
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  claim_time timestamp with time zone := statement_timestamp();
  lock_timeout constant interval := interval '5 minutes';
BEGIN
  IF normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_limit IS NULL
    OR p_limit NOT BETWEEN 1 AND 50
  THEN
    RAISE EXCEPTION 'invalid_client_legal_document_delivery_claim'
      USING errcode = '22023';
  END IF;

  WITH expired AS (
    UPDATE public.crm_client_legal_document_deliveries AS delivery
    SET
      status = 'failed'::text,
      locked_at = NULL,
      locked_by = NULL,
      last_error = coalesce(
        delivery.last_error,
        'client_legal_document_delivery_lock_expired_after_max_attempts'::text
      ),
      updated_at = claim_time
    WHERE delivery.status = 'processing'::text
      AND delivery.locked_at < claim_time - lock_timeout
      AND delivery.attempts >= delivery.max_attempts
    RETURNING
      delivery.id,
      delivery.organization_id,
      delivery.attempts
  )
  INSERT INTO public.crm_client_legal_document_delivery_events (
    organization_id,
    delivery_id,
    event_type,
    from_status,
    to_status,
    attempt,
    worker_id,
    details
  )
  SELECT
    expired.organization_id,
    expired.id,
    'failed'::text,
    'processing'::text,
    'failed'::text,
    expired.attempts,
    normalized_worker_id,
    jsonb_build_object('reason', 'lock_expired_after_max_attempts'::text)
  FROM expired;

  RETURN QUERY
  WITH candidates AS (
    SELECT delivery.id, delivery.status AS previous_status
    FROM public.crm_client_legal_document_deliveries AS delivery
    WHERE (
      delivery.status = ANY (ARRAY['pending'::text, 'failed'::text])
      AND delivery.available_at <= claim_time
      AND delivery.attempts < delivery.max_attempts
    ) OR (
      delivery.status = 'processing'::text
      AND delivery.locked_at < claim_time - lock_timeout
      AND delivery.attempts < delivery.max_attempts
    )
    ORDER BY delivery.available_at, delivery.created_at, delivery.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ), claimed AS (
    UPDATE public.crm_client_legal_document_deliveries AS delivery
    SET
      status = 'processing'::text,
      attempts = delivery.attempts + 1,
      locked_at = claim_time,
      locked_by = normalized_worker_id,
      last_error = CASE
        WHEN delivery.status = 'processing'::text
          THEN coalesce(
            delivery.last_error,
            'client_legal_document_delivery_lock_expired'::text
          )
        ELSE delivery.last_error
      END,
      updated_at = claim_time
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.*
  ), audit_rows AS (
    INSERT INTO public.crm_client_legal_document_delivery_events (
      organization_id,
      delivery_id,
      event_type,
      from_status,
      to_status,
      attempt,
      worker_id,
      details
    )
    SELECT
      claimed.organization_id,
      claimed.id,
      CASE
        WHEN candidates.previous_status = 'processing'::text
          THEN 'lock_recovered'::text
        ELSE 'claimed'::text
      END,
      candidates.previous_status,
      'processing'::text,
      claimed.attempts,
      normalized_worker_id,
      '{}'::jsonb
    FROM claimed
    JOIN candidates ON candidates.id = claimed.id
    RETURNING id
  )
  SELECT claimed.*
  FROM claimed
  CROSS JOIN (SELECT count(*) FROM audit_rows) AS audit_confirmation
  ORDER BY claimed.available_at, claimed.created_at, claimed.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_client_legal_document_deliveries(
  text,
  integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.claim_client_legal_document_deliveries(
  text,
  integer
) TO openexpert_service;

CREATE FUNCTION public.complete_client_legal_document_delivery(
  p_delivery_id uuid,
  p_worker_id text,
  p_outcome text,
  p_error text DEFAULT NULL,
  p_retry_delay_seconds integer DEFAULT 300,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_ofi_sha256 text DEFAULT NULL,
  p_ofi_size_bytes bigint DEFAULT NULL,
  p_ofi_storage_path text DEFAULT NULL,
  p_rodo_sha256 text DEFAULT NULL,
  p_rodo_size_bytes bigint DEFAULT NULL,
  p_rodo_storage_path text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_worker_id text := nullif(btrim(p_worker_id), '');
  normalized_error text := nullif(btrim(p_error), '');
  normalized_provider text := nullif(btrim(p_provider), '');
  normalized_provider_message_id text := nullif(btrim(p_provider_message_id), '');
  normalized_ofi_storage_path text := nullif(btrim(p_ofi_storage_path), '');
  normalized_rodo_storage_path text := nullif(btrim(p_rodo_storage_path), '');
  completion_time timestamp with time zone := statement_timestamp();
  target public.crm_client_legal_document_deliveries%rowtype;
  final_ofi_sha256 text;
  final_ofi_size_bytes bigint;
  final_ofi_storage_path text;
  final_rodo_sha256 text;
  final_rodo_size_bytes bigint;
  final_rodo_storage_path text;
BEGIN
  IF p_delivery_id IS NULL
    OR normalized_worker_id IS NULL
    OR char_length(normalized_worker_id) > 200
    OR p_outcome IS NULL
    OR p_outcome NOT IN (
      'sent'::text,
      'failed'::text,
      'blocked_missing_email'::text,
      'blocked_incomplete_settings'::text
    )
    OR (normalized_error IS NOT NULL AND char_length(normalized_error) > 4000)
    OR p_retry_delay_seconds IS NULL
    OR p_retry_delay_seconds NOT BETWEEN 0 AND 86400
    OR (normalized_provider IS NOT NULL AND char_length(normalized_provider) > 100)
    OR (
      normalized_provider_message_id IS NOT NULL
      AND (
        normalized_provider IS NULL
        OR char_length(normalized_provider_message_id) > 500
      )
    )
    OR (p_ofi_sha256 IS NOT NULL AND p_ofi_sha256 !~ '^[0-9a-f]{64}$'::text)
    OR (p_rodo_sha256 IS NOT NULL AND p_rodo_sha256 !~ '^[0-9a-f]{64}$'::text)
    OR (p_ofi_size_bytes IS NOT NULL AND p_ofi_size_bytes NOT BETWEEN 1 AND 5242880)
    OR (p_rodo_size_bytes IS NOT NULL AND p_rodo_size_bytes NOT BETWEEN 1 AND 5242880)
    OR (normalized_ofi_storage_path IS NOT NULL AND char_length(normalized_ofi_storage_path) > 1000)
    OR (normalized_rodo_storage_path IS NOT NULL AND char_length(normalized_rodo_storage_path) > 1000)
  THEN
    RAISE EXCEPTION 'invalid_client_legal_document_delivery_completion'
      USING errcode = '22023';
  END IF;

  SELECT delivery.*
  INTO target
  FROM public.crm_client_legal_document_deliveries AS delivery
  WHERE delivery.id = p_delivery_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'client_legal_document_delivery_not_found'
      USING errcode = 'P0002';
  END IF;

  IF (target.ofi_sha256 IS NOT NULL AND p_ofi_sha256 IS NOT NULL
      AND target.ofi_sha256 <> p_ofi_sha256)
    OR (target.ofi_size_bytes IS NOT NULL AND p_ofi_size_bytes IS NOT NULL
      AND target.ofi_size_bytes <> p_ofi_size_bytes)
    OR (target.ofi_storage_path IS NOT NULL AND normalized_ofi_storage_path IS NOT NULL
      AND target.ofi_storage_path <> normalized_ofi_storage_path)
    OR (target.rodo_sha256 IS NOT NULL AND p_rodo_sha256 IS NOT NULL
      AND target.rodo_sha256 <> p_rodo_sha256)
    OR (target.rodo_size_bytes IS NOT NULL AND p_rodo_size_bytes IS NOT NULL
      AND target.rodo_size_bytes <> p_rodo_size_bytes)
    OR (target.rodo_storage_path IS NOT NULL AND normalized_rodo_storage_path IS NOT NULL
      AND target.rodo_storage_path <> normalized_rodo_storage_path)
  THEN
    RAISE EXCEPTION 'client_legal_document_delivery_pdf_metadata_conflict'
      USING errcode = '23505';
  END IF;

  IF target.status = 'sent'::text AND p_outcome = 'sent'::text THEN
    RETURN jsonb_build_object(
      'id', target.id,
      'status', target.status,
      'attempts', target.attempts,
      'maxAttempts', target.max_attempts,
      'generatedAt', target.generated_at,
      'sentAt', target.sent_at,
      'provider', target.provider,
      'providerMessageId', target.provider_message_id
    );
  END IF;

  IF target.status <> 'processing'::text
    OR target.locked_by IS DISTINCT FROM normalized_worker_id
  THEN
    RAISE EXCEPTION 'client_legal_document_delivery_claim_not_found'
      USING errcode = 'P0002';
  END IF;

  final_ofi_sha256 := coalesce(target.ofi_sha256, p_ofi_sha256);
  final_ofi_size_bytes := coalesce(target.ofi_size_bytes, p_ofi_size_bytes);
  final_ofi_storage_path := coalesce(target.ofi_storage_path, normalized_ofi_storage_path);
  final_rodo_sha256 := coalesce(target.rodo_sha256, p_rodo_sha256);
  final_rodo_size_bytes := coalesce(target.rodo_size_bytes, p_rodo_size_bytes);
  final_rodo_storage_path := coalesce(target.rodo_storage_path, normalized_rodo_storage_path);

  IF p_outcome = 'sent'::text AND (
    final_ofi_sha256 IS NULL
    OR final_ofi_size_bytes IS NULL
    OR final_ofi_storage_path IS NULL
    OR final_rodo_sha256 IS NULL
    OR final_rodo_size_bytes IS NULL
    OR final_rodo_storage_path IS NULL
  ) THEN
    RAISE EXCEPTION 'client_legal_document_delivery_pdf_metadata_required'
      USING errcode = '23514';
  END IF;

  UPDATE public.crm_client_legal_document_deliveries AS delivery
  SET
    status = p_outcome,
    available_at = CASE
      WHEN p_outcome = 'failed'::text
        THEN completion_time + make_interval(secs => p_retry_delay_seconds)
      ELSE delivery.available_at
    END,
    locked_at = NULL,
    locked_by = NULL,
    last_error = CASE
      WHEN p_outcome = 'sent'::text THEN NULL
      WHEN p_outcome = 'failed'::text
        THEN coalesce(normalized_error, 'client_legal_document_delivery_failed'::text)
      WHEN p_outcome = 'blocked_missing_email'::text
        THEN coalesce(normalized_error, 'client_email_missing_or_invalid'::text)
      ELSE coalesce(normalized_error, 'intermediary_settings_incomplete'::text)
    END,
    provider = coalesce(normalized_provider, delivery.provider),
    provider_message_id = coalesce(
      normalized_provider_message_id,
      delivery.provider_message_id
    ),
    ofi_sha256 = final_ofi_sha256,
    ofi_size_bytes = final_ofi_size_bytes,
    ofi_storage_path = final_ofi_storage_path,
    rodo_sha256 = final_rodo_sha256,
    rodo_size_bytes = final_rodo_size_bytes,
    rodo_storage_path = final_rodo_storage_path,
    generated_at = CASE
      WHEN final_ofi_sha256 IS NOT NULL
        AND final_ofi_size_bytes IS NOT NULL
        AND final_ofi_storage_path IS NOT NULL
        AND final_rodo_sha256 IS NOT NULL
        AND final_rodo_size_bytes IS NOT NULL
        AND final_rodo_storage_path IS NOT NULL
        THEN coalesce(delivery.generated_at, completion_time)
      ELSE delivery.generated_at
    END,
    updated_at = completion_time,
    sent_at = CASE
      WHEN p_outcome = 'sent'::text THEN completion_time
      ELSE NULL
    END
  WHERE delivery.id = target.id
  RETURNING * INTO target;

  PERFORM private.record_client_legal_document_delivery_event(
    target.organization_id,
    target.id,
    p_outcome,
    'processing'::text,
    p_outcome,
    target.attempts,
    normalized_worker_id,
    jsonb_strip_nulls(jsonb_build_object(
      'error', normalized_error,
      'provider', target.provider,
      'providerMessageId', target.provider_message_id,
      'ofiSha256', target.ofi_sha256,
      'rodoSha256', target.rodo_sha256
    ))
  );

  RETURN jsonb_build_object(
    'id', target.id,
    'status', target.status,
    'attempts', target.attempts,
    'maxAttempts', target.max_attempts,
    'availableAt', target.available_at,
    'generatedAt', target.generated_at,
    'sentAt', target.sent_at,
    'provider', target.provider,
    'providerMessageId', target.provider_message_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_client_legal_document_delivery(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  text,
  text,
  bigint,
  text,
  text,
  bigint,
  text
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.complete_client_legal_document_delivery(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  text,
  text,
  bigint,
  text,
  text,
  bigint,
  text
) TO openexpert_service;

ALTER TABLE public.crm_client_legal_document_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_client_legal_document_delivery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_client_legal_document_deliveries_member_read
  ON public.crm_client_legal_document_deliveries
  FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

CREATE POLICY crm_client_legal_document_delivery_events_member_read
  ON public.crm_client_legal_document_delivery_events
  FOR SELECT TO authenticated
  USING (private.is_organization_member(organization_id));

-- The trusted worker needs the same organization branding as the interactive
-- PDF preview. It still receives no direct write access to design settings.
CREATE POLICY organization_design_settings_service_read
  ON public.organization_design_settings
  FOR SELECT TO openexpert_service
  USING (true);

REVOKE ALL ON TABLE public.crm_client_legal_document_deliveries
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_client_legal_document_delivery_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT ON TABLE public.crm_client_legal_document_deliveries TO authenticated;
GRANT SELECT ON TABLE public.crm_client_legal_document_delivery_events TO authenticated;
GRANT SELECT ON TABLE public.organization_design_settings TO openexpert_service;
