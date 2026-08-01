-- SMS consent capture is the only write path for new CRM consent decisions.
-- Public tokens and OTPs are stored as keyed SHA-256 HMACs; the raw values
-- must never be copied into evidence or metadata.

DO $extend_consent_event_source$
DECLARE
  source_constraint record;
BEGIN
  FOR source_constraint IN
    SELECT constraint_row.conname
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.crm_client_consent_events'::regclass
      AND constraint_row.contype = 'c'
      AND (
        constraint_row.conname = 'crm_client_consent_events_source_check'
        OR (
          pg_catalog.pg_get_constraintdef(constraint_row.oid) ILIKE '%source = ANY%'
          AND pg_catalog.pg_get_constraintdef(constraint_row.oid) ILIKE '%client_creation%'
          AND pg_catalog.pg_get_constraintdef(constraint_row.oid) ILIKE '%booking_widget%'
        )
      )
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE public.crm_client_consent_events DROP CONSTRAINT %I',
      source_constraint.conname
    );
  END LOOP;
END
$extend_consent_event_source$;

ALTER TABLE public.crm_client_consent_events
  ADD CONSTRAINT crm_client_consent_events_source_check
  CHECK (
    source = ANY (ARRAY[
      'client_creation'::text,
      'client_card'::text,
      'import'::text,
      'api'::text,
      'booking_widget'::text,
      'sms_verification'::text
    ])
  ) NOT VALID;

ALTER TABLE public.crm_client_consent_events
  VALIDATE CONSTRAINT crm_client_consent_events_source_check;

CREATE TABLE public.crm_consent_capture_requests (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  client_id uuid NOT NULL,
  subject_person_id uuid NOT NULL,
  definition_id uuid NOT NULL,
  definition_version_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  intent text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  decision text,
  phone_e164 text NOT NULL,
  public_token_hash text NOT NULL,
  otp_hash text NOT NULL,
  otp_attempts integer DEFAULT 0 NOT NULL,
  max_otp_attempts integer DEFAULT 5 NOT NULL,
  provider text,
  provider_message_id text,
  delivery_status text DEFAULT 'pending'::text NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  opened_at timestamp with time zone,
  verified_at timestamp with time zone,
  decided_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  consent_event_id uuid,
  evidence_reference text,
  evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_consent_capture_requests_pkey PRIMARY KEY (id),
  CONSTRAINT crm_consent_capture_requests_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT crm_consent_capture_requests_public_token_hash_key
    UNIQUE (public_token_hash),
  CONSTRAINT crm_consent_capture_requests_intent_check
    CHECK (intent = ANY (ARRAY['collect'::text, 'withdraw'::text])),
  CONSTRAINT crm_consent_capture_requests_status_check
    CHECK (status = ANY (ARRAY[
      'pending'::text,
      'queued'::text,
      'sent'::text,
      'delivered'::text,
      'opened'::text,
      'verified'::text,
      'accepted'::text,
      'declined'::text,
      'withdrawn'::text,
      'expired'::text,
      'cancelled'::text,
      'failed'::text
    ])),
  CONSTRAINT crm_consent_capture_requests_decision_check
    CHECK (
      decision IS NULL
      OR decision = ANY (ARRAY[
        'granted'::text,
        'declined'::text,
        'withdrawn'::text
      ])
    ),
  CONSTRAINT crm_consent_capture_requests_phone_e164_check
    CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT crm_consent_capture_requests_public_token_hash_check
    CHECK (public_token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT crm_consent_capture_requests_otp_hash_check
    CHECK (otp_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT crm_consent_capture_requests_otp_attempts_check
    CHECK (
      otp_attempts >= 0
      AND max_otp_attempts BETWEEN 1 AND 20
      AND otp_attempts <= max_otp_attempts
    ),
  CONSTRAINT crm_consent_capture_requests_expiry_check
    CHECK (expires_at > requested_at),
  CONSTRAINT crm_consent_capture_requests_timestamp_order_check
    CHECK (
      (sent_at IS NULL OR sent_at >= requested_at)
      AND (delivered_at IS NULL OR delivered_at >= COALESCE(sent_at, requested_at))
      AND (opened_at IS NULL OR opened_at >= requested_at)
      AND (verified_at IS NULL OR verified_at >= requested_at)
      AND (decided_at IS NULL OR decided_at >= requested_at)
      AND (cancelled_at IS NULL OR cancelled_at >= requested_at)
    ),
  CONSTRAINT crm_consent_capture_requests_json_shape_check
    CHECK (
      jsonb_typeof(evidence) = 'object'::text
      AND jsonb_typeof(metadata) = 'object'::text
    ),
  CONSTRAINT crm_consent_capture_requests_evidence_reference_check
    CHECK (
      evidence_reference IS NULL
      OR btrim(evidence_reference) <> ''::text
    ),
  CONSTRAINT crm_consent_capture_requests_provider_check
    CHECK (provider IS NULL OR btrim(provider) <> ''::text),
  CONSTRAINT crm_consent_capture_requests_provider_message_id_check
    CHECK (
      provider_message_id IS NULL
      OR (
        provider IS NOT NULL
        AND btrim(provider_message_id) <> ''::text
      )
    ),
  CONSTRAINT crm_consent_capture_requests_decision_lifecycle_check
    CHECK (
      (
        status = 'accepted'::text
        AND intent = 'collect'::text
        AND decision = 'granted'::text
        AND verified_at IS NOT NULL
        AND decided_at IS NOT NULL
        AND consent_event_id IS NOT NULL
      )
      OR (
        status = 'declined'::text
        AND intent = 'collect'::text
        AND decision = 'declined'::text
        AND verified_at IS NOT NULL
        AND decided_at IS NOT NULL
        AND consent_event_id IS NOT NULL
      )
      OR (
        status = 'withdrawn'::text
        AND intent = 'withdraw'::text
        AND decision = 'withdrawn'::text
        AND verified_at IS NOT NULL
        AND decided_at IS NOT NULL
        AND consent_event_id IS NOT NULL
      )
      OR (
        status = ANY (ARRAY[
          'pending'::text,
          'queued'::text,
          'sent'::text,
          'delivered'::text,
          'opened'::text,
          'verified'::text,
          'expired'::text,
          'cancelled'::text,
          'failed'::text
        ])
        AND decision IS NULL
        AND consent_event_id IS NULL
      )
    ),
  CONSTRAINT crm_consent_capture_requests_verified_status_check
    CHECK (status <> 'verified'::text OR verified_at IS NOT NULL),
  CONSTRAINT crm_consent_capture_requests_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT crm_consent_capture_requests_client_fkey
    FOREIGN KEY (organization_id, client_id)
    REFERENCES public.crm_clients(organization_id, id),
  CONSTRAINT crm_consent_capture_requests_person_fkey
    FOREIGN KEY (organization_id, client_id, subject_person_id)
    REFERENCES public.crm_client_people(organization_id, client_id, id),
  CONSTRAINT crm_consent_capture_requests_definition_fkey
    FOREIGN KEY (organization_id, definition_id)
    REFERENCES public.crm_consent_definitions(organization_id, id),
  CONSTRAINT crm_consent_capture_requests_version_fkey
    FOREIGN KEY (organization_id, definition_id, definition_version_id)
    REFERENCES public.crm_consent_definition_versions(organization_id, definition_id, id),
  CONSTRAINT crm_consent_capture_requests_requester_fkey
    FOREIGN KEY (organization_id, requested_by_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id),
  CONSTRAINT crm_consent_capture_requests_consent_event_fkey
    FOREIGN KEY (consent_event_id)
    REFERENCES public.crm_client_consent_events(id)
);

COMMENT ON TABLE public.crm_consent_capture_requests IS
  'Server-created SMS OTP challenges used to collect or withdraw CRM consent.';
COMMENT ON COLUMN public.crm_consent_capture_requests.public_token_hash IS
  'Keyed SHA-256 HMAC of the high-entropy public token; the raw token is never persisted.';
COMMENT ON COLUMN public.crm_consent_capture_requests.otp_hash IS
  'Request-bound keyed SHA-256 HMAC of the OTP; a plain digest is not sufficient for a six-digit code.';
COMMENT ON COLUMN public.crm_consent_capture_requests.evidence IS
  'Structured verification evidence. It must not contain a raw public token or OTP.';

CREATE UNIQUE INDEX crm_consent_capture_requests_one_active_definition_idx
  ON public.crm_consent_capture_requests (
    organization_id,
    subject_person_id,
    definition_id
  )
  WHERE status = ANY (ARRAY[
    'pending'::text,
    'queued'::text,
    'sent'::text,
    'delivered'::text,
    'opened'::text,
    'verified'::text
  ]);

CREATE UNIQUE INDEX crm_consent_capture_requests_consent_event_idx
  ON public.crm_consent_capture_requests (consent_event_id)
  WHERE consent_event_id IS NOT NULL;

CREATE INDEX crm_consent_capture_requests_client_timeline_idx
  ON public.crm_consent_capture_requests (
    organization_id,
    client_id,
    created_at DESC,
    id
  );

CREATE INDEX crm_consent_capture_requests_person_definition_idx
  ON public.crm_consent_capture_requests (
    organization_id,
    client_id,
    subject_person_id,
    definition_id
  );

CREATE INDEX crm_consent_capture_requests_version_idx
  ON public.crm_consent_capture_requests (
    organization_id,
    definition_id,
    definition_version_id
  );

CREATE INDEX crm_consent_capture_requests_requester_idx
  ON public.crm_consent_capture_requests (
    organization_id,
    requested_by_user_id
  );

CREATE INDEX crm_consent_capture_requests_active_expiry_idx
  ON public.crm_consent_capture_requests (expires_at, id)
  WHERE status = ANY (ARRAY[
    'pending'::text,
    'queued'::text,
    'sent'::text,
    'delivered'::text,
    'opened'::text,
    'verified'::text
  ]);

CREATE TABLE public.crm_consent_capture_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  decision text,
  actor_user_id uuid,
  provider_message_id text,
  evidence_reference text,
  evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_consent_capture_events_pkey PRIMARY KEY (id),
  CONSTRAINT crm_consent_capture_events_type_check
    CHECK (event_type = ANY (ARRAY[
      'requested'::text,
      'sms_queued'::text,
      'sms_sent'::text,
      'sms_failed'::text,
      'sms_delivered'::text,
      'sms_delivery_failed'::text,
      'opened'::text,
      'link_opened'::text,
      'otp_rejected'::text,
      'otp_locked'::text,
      'otp_verified'::text,
      'verified'::text,
      'decision_recorded'::text,
      'expired'::text,
      'cancelled'::text,
      'cancelled_by_replacement'::text,
      'failed'::text
    ])),
  CONSTRAINT crm_consent_capture_events_statuses_check
    CHECK (
      (
        from_status IS NULL
        OR from_status = ANY (ARRAY[
          'pending'::text,
          'queued'::text,
          'sent'::text,
          'delivered'::text,
          'opened'::text,
          'verified'::text,
          'accepted'::text,
          'declined'::text,
          'withdrawn'::text,
          'expired'::text,
          'cancelled'::text,
          'failed'::text
        ])
      )
      AND (
        to_status IS NULL
        OR to_status = ANY (ARRAY[
          'pending'::text,
          'queued'::text,
          'sent'::text,
          'delivered'::text,
          'opened'::text,
          'verified'::text,
          'accepted'::text,
          'declined'::text,
          'withdrawn'::text,
          'expired'::text,
          'cancelled'::text,
          'failed'::text
        ])
      )
    ),
  CONSTRAINT crm_consent_capture_events_decision_check
    CHECK (
      (
        event_type = 'decision_recorded'::text
        AND decision = ANY (ARRAY[
          'granted'::text,
          'declined'::text,
          'withdrawn'::text
        ])
      )
      OR (
        event_type <> 'decision_recorded'::text
        AND decision IS NULL
      )
    ),
  CONSTRAINT crm_consent_capture_events_json_shape_check
    CHECK (
      jsonb_typeof(evidence) = 'object'::text
      AND jsonb_typeof(metadata) = 'object'::text
    ),
  CONSTRAINT crm_consent_capture_events_evidence_reference_check
    CHECK (
      evidence_reference IS NULL
      OR btrim(evidence_reference) <> ''::text
    ),
  CONSTRAINT crm_consent_capture_events_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT crm_consent_capture_events_request_fkey
    FOREIGN KEY (organization_id, request_id)
    REFERENCES public.crm_consent_capture_requests(organization_id, id),
  CONSTRAINT crm_consent_capture_events_actor_fkey
    FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id)
);

COMMENT ON TABLE public.crm_consent_capture_events IS
  'Append-only operational and evidence timeline for an SMS consent capture request.';

CREATE INDEX crm_consent_capture_events_request_timeline_idx
  ON public.crm_consent_capture_events (
    organization_id,
    request_id,
    occurred_at,
    id
  );

CREATE INDEX crm_consent_capture_events_actor_idx
  ON public.crm_consent_capture_events (
    organization_id,
    actor_user_id
  )
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX crm_consent_capture_events_provider_message_idx
  ON public.crm_consent_capture_events (provider_message_id, event_type)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE public.crm_sms_outbox (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  request_id uuid NOT NULL,
  destination text NOT NULL,
  body text NOT NULL,
  provider text NOT NULL,
  provider_message_id text,
  status text DEFAULT 'queued'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  max_attempts integer DEFAULT 5 NOT NULL,
  available_at timestamp with time zone DEFAULT now() NOT NULL,
  locked_at timestamp with time zone,
  locked_by text,
  queued_at timestamp with time zone DEFAULT now() NOT NULL,
  sent_at timestamp with time zone,
  delivered_at timestamp with time zone,
  failed_at timestamp with time zone,
  last_error text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT crm_sms_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT crm_sms_outbox_status_check
    CHECK (status = ANY (ARRAY[
      'queued'::text,
      'processing'::text,
      'sent'::text,
      'delivered'::text,
      'failed'::text,
      'cancelled'::text
    ])),
  CONSTRAINT crm_sms_outbox_destination_check
    CHECK (destination ~ '^\+[1-9][0-9]{7,14}$'),
  CONSTRAINT crm_sms_outbox_body_check
    CHECK (btrim(body) <> ''::text),
  CONSTRAINT crm_sms_outbox_provider_check
    CHECK (btrim(provider) <> ''::text),
  CONSTRAINT crm_sms_outbox_provider_message_id_check
    CHECK (
      provider_message_id IS NULL
      OR btrim(provider_message_id) <> ''::text
    ),
  CONSTRAINT crm_sms_outbox_attempts_check
    CHECK (
      attempts >= 0
      AND max_attempts BETWEEN 1 AND 20
      AND attempts <= max_attempts
    ),
  CONSTRAINT crm_sms_outbox_timestamp_order_check
    CHECK (
      (sent_at IS NULL OR sent_at >= queued_at)
      AND (delivered_at IS NULL OR delivered_at >= COALESCE(sent_at, queued_at))
      AND (failed_at IS NULL OR failed_at >= queued_at)
    ),
  CONSTRAINT crm_sms_outbox_lock_check
    CHECK (
      (locked_at IS NULL AND locked_by IS NULL)
      OR (locked_at IS NOT NULL AND nullif(btrim(locked_by), '') IS NOT NULL)
    ),
  CONSTRAINT crm_sms_outbox_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'::text),
  CONSTRAINT crm_sms_outbox_organization_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  CONSTRAINT crm_sms_outbox_request_fkey
    FOREIGN KEY (organization_id, request_id)
    REFERENCES public.crm_consent_capture_requests(organization_id, id)
);

COMMENT ON TABLE public.crm_sms_outbox IS
  'Server-only SMS delivery queue. OTP-bearing bodies must be redacted immediately after a delivery attempt.';

CREATE UNIQUE INDEX crm_sms_outbox_provider_message_idx
  ON public.crm_sms_outbox (provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX crm_sms_outbox_request_timeline_idx
  ON public.crm_sms_outbox (
    organization_id,
    request_id,
    created_at DESC,
    id
  );

CREATE INDEX crm_sms_outbox_ready_idx
  ON public.crm_sms_outbox (available_at, id)
  WHERE status = ANY (ARRAY['queued'::text, 'failed'::text]);

CREATE FUNCTION private.protect_crm_consent_capture_event() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
BEGIN
  RAISE EXCEPTION 'crm_consent_capture_events_are_append_only'
    USING errcode = '55000';
END;
$$;

CREATE TRIGGER crm_consent_capture_requests_set_updated_at
  BEFORE UPDATE ON public.crm_consent_capture_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER crm_consent_capture_events_protect_append_only
  BEFORE DELETE OR UPDATE ON public.crm_consent_capture_events
  FOR EACH ROW EXECUTE FUNCTION private.protect_crm_consent_capture_event();

CREATE TRIGGER crm_sms_outbox_set_updated_at
  BEFORE UPDATE ON public.crm_sms_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.crm_consent_capture_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_consent_capture_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_sms_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_consent_capture_requests_service_all
  ON public.crm_consent_capture_requests
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY crm_consent_capture_events_service_read
  ON public.crm_consent_capture_events
  FOR SELECT TO openexpert_service
  USING (true);

CREATE POLICY crm_consent_capture_events_service_insert
  ON public.crm_consent_capture_events
  FOR INSERT TO openexpert_service
  WITH CHECK (true);

CREATE POLICY crm_sms_outbox_service_all
  ON public.crm_sms_outbox
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.crm_consent_capture_requests
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_consent_capture_events
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
REVOKE ALL ON TABLE public.crm_sms_outbox
  FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.crm_consent_capture_requests TO openexpert_service;
GRANT SELECT, INSERT
  ON TABLE public.crm_consent_capture_events TO openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.crm_sms_outbox TO openexpert_service;

-- Authenticated CRM users can inspect the immutable decision log, but every
-- new decision is now recorded by the trusted SMS completion path. The
-- service role keeps its existing INSERT/UPDATE/DELETE privileges so the
-- legacy booking-widget RPC remains operational.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.crm_client_consent_events
  FROM PUBLIC, anonymous, authenticated;

CREATE FUNCTION public.complete_crm_consent_capture_request(
  p_request_id uuid,
  p_decision text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  capture_request public.crm_consent_capture_requests%rowtype;
  completion_time timestamp with time zone := statement_timestamp();
  final_status text;
  inserted_consent_event_id uuid;
  inserted_capture_event_id uuid;
BEGIN
  IF p_decision IS NULL
    OR p_decision <> ALL (ARRAY[
      'granted'::text,
      'declined'::text,
      'withdrawn'::text
    ])
  THEN
    RAISE EXCEPTION 'consent_capture_decision_is_invalid'
      USING errcode = '23514';
  END IF;

  SELECT request_row.*
  INTO capture_request
  FROM public.crm_consent_capture_requests AS request_row
  WHERE request_row.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'consent_capture_request_not_found'
      USING errcode = 'P0002';
  END IF;

  IF capture_request.status = ANY (ARRAY[
    'accepted'::text,
    'declined'::text,
    'withdrawn'::text
  ]) THEN
    IF capture_request.decision IS DISTINCT FROM p_decision THEN
      RAISE EXCEPTION 'consent_capture_request_already_decided'
        USING errcode = '23514';
    END IF;

    SELECT capture_event.id
    INTO inserted_capture_event_id
    FROM public.crm_consent_capture_events AS capture_event
    WHERE capture_event.organization_id = capture_request.organization_id
      AND capture_event.request_id = capture_request.id
      AND capture_event.event_type = 'decision_recorded'::text
      AND capture_event.decision = p_decision
    ORDER BY capture_event.occurred_at DESC, capture_event.id DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'requestId', capture_request.id,
      'status', capture_request.status,
      'decision', capture_request.decision,
      'consentEventId', capture_request.consent_event_id,
      'captureEventId', inserted_capture_event_id,
      'decidedAt', capture_request.decided_at,
      'replayed', true
    );
  END IF;

  IF capture_request.status <> 'verified'::text
    OR capture_request.verified_at IS NULL
  THEN
    RAISE EXCEPTION 'consent_capture_request_is_not_verified'
      USING errcode = '23514';
  END IF;

  IF capture_request.expires_at <= completion_time THEN
    RAISE EXCEPTION 'consent_capture_request_has_expired'
      USING errcode = '23514';
  END IF;

  IF capture_request.intent = 'collect'::text
    AND p_decision = ANY (ARRAY['granted'::text, 'declined'::text])
  THEN
    final_status := CASE p_decision
      WHEN 'granted'::text THEN 'accepted'::text
      ELSE 'declined'::text
    END;
  ELSIF capture_request.intent = 'withdraw'::text
    AND p_decision = 'withdrawn'::text
  THEN
    final_status := 'withdrawn'::text;
  ELSE
    RAISE EXCEPTION 'consent_capture_decision_does_not_match_intent'
      USING errcode = '23514';
  END IF;

  INSERT INTO public.crm_client_consent_events (
    organization_id,
    client_id,
    subject_person_id,
    definition_id,
    definition_version_id,
    decision,
    contact_value,
    source,
    occurred_at,
    recorded_by_user_id,
    evidence_reference,
    metadata
  ) VALUES (
    capture_request.organization_id,
    capture_request.client_id,
    capture_request.subject_person_id,
    capture_request.definition_id,
    capture_request.definition_version_id,
    p_decision,
    CASE
      WHEN p_decision = 'granted'::text THEN capture_request.phone_e164
      ELSE NULL
    END,
    'sms_verification'::text,
    completion_time,
    capture_request.requested_by_user_id,
    COALESCE(
      capture_request.evidence_reference,
      'consent-capture:'::text || capture_request.id::text
    ),
    jsonb_build_object(
      'method', 'sms_otp',
      'channel', 'sms',
      'contactValueSource', 'verified_request_phone',
      'captureRequestId', capture_request.id,
      'intent', capture_request.intent,
      'provider', capture_request.provider,
      'providerMessageId', capture_request.provider_message_id,
      'deliveryStatus', capture_request.delivery_status,
      'requestedByUserId', capture_request.requested_by_user_id,
      'requestedAt', capture_request.requested_at,
      'sentAt', capture_request.sent_at,
      'deliveredAt', capture_request.delivered_at,
      'openedAt', capture_request.opened_at,
      'verifiedAt', capture_request.verified_at,
      'decidedAt', completion_time,
      'expiresAt', capture_request.expires_at,
      'otpAttempts', capture_request.otp_attempts,
      'maxOtpAttempts', capture_request.max_otp_attempts,
      'evidence', capture_request.evidence,
      'requestMetadata', capture_request.metadata
    )
  )
  RETURNING id INTO inserted_consent_event_id;

  UPDATE public.crm_consent_capture_requests
  SET
    status = final_status,
    decision = p_decision,
    decided_at = completion_time,
    consent_event_id = inserted_consent_event_id,
    updated_at = completion_time
  WHERE id = capture_request.id;

  INSERT INTO public.crm_consent_capture_events (
    organization_id,
    request_id,
    event_type,
    from_status,
    to_status,
    decision,
    actor_user_id,
    provider_message_id,
    evidence_reference,
    evidence,
    metadata,
    occurred_at
  ) VALUES (
    capture_request.organization_id,
    capture_request.id,
    'decision_recorded'::text,
    'verified'::text,
    final_status,
    p_decision,
    NULL,
    capture_request.provider_message_id,
    COALESCE(
      capture_request.evidence_reference,
      'consent-capture:'::text || capture_request.id::text
    ),
    capture_request.evidence,
    jsonb_build_object(
      'method', 'sms_otp',
      'consentEventId', inserted_consent_event_id,
      'requestedByUserId', capture_request.requested_by_user_id,
      'requestMetadata', capture_request.metadata
    ),
    completion_time
  )
  RETURNING id INTO inserted_capture_event_id;

  RETURN jsonb_build_object(
    'requestId', capture_request.id,
    'status', final_status,
    'decision', p_decision,
    'consentEventId', inserted_consent_event_id,
    'captureEventId', inserted_capture_event_id,
    'decidedAt', completion_time,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.complete_crm_consent_capture_request(uuid, text) IS
  'Atomically records one verified, unexpired SMS OTP consent decision. Execute is restricted to the trusted server role.';

REVOKE ALL ON FUNCTION public.complete_crm_consent_capture_request(uuid, text)
  FROM PUBLIC, anonymous, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_crm_consent_capture_request(uuid, text)
  TO openexpert_service;

-- Client creation no longer accepts direct consent input. Consent capture is
-- intentionally a later, verified SMS workflow. The booking widget keeps its
-- separate legacy service-role RPC and explicit catalogue validation.
CREATE OR REPLACE FUNCTION public.create_crm_client_with_consents(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_display_name text,
  p_status_code text,
  p_lead_source text,
  p_primary_email text,
  p_primary_phone text,
  p_tags text[],
  p_notes text,
  p_metadata jsonb,
  p_primary_person jsonb,
  p_consent_decisions jsonb
) RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $$
DECLARE
  inserted_client public.crm_clients;
  inserted_person public.crm_client_people;
  effective_owner_user_id uuid := COALESCE(
    p_owner_user_id,
    (SELECT app.current_user_id())
  );
BEGIN
  IF jsonb_typeof(COALESCE(p_consent_decisions, '[]'::jsonb)) <> 'array'::text THEN
    RAISE EXCEPTION 'consent_decisions_must_be_an_array'
      USING errcode = '23514';
  END IF;

  IF jsonb_array_length(COALESCE(p_consent_decisions, '[]'::jsonb)) > 0 THEN
    RAISE EXCEPTION 'consent_decisions_must_use_sms'
      USING errcode = '23514';
  END IF;

  IF NOT private.is_organization_member(p_organization_id) THEN
    RAISE EXCEPTION 'organization_membership_required'
      USING errcode = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = effective_owner_user_id
  ) THEN
    RAISE EXCEPTION 'client_owner_not_organization_member'
      USING errcode = '23503';
  END IF;

  IF effective_owner_user_id <> (SELECT app.current_user_id())
    AND NOT private.is_organization_admin(p_organization_id)
  THEN
    RAISE EXCEPTION 'client_owner_assignment_admin_required'
      USING errcode = '42501';
  END IF;

  IF nullif(btrim(p_display_name), '') IS NULL THEN
    RAISE EXCEPTION 'display_name_is_required'
      USING errcode = '23514';
  END IF;

  INSERT INTO public.crm_clients (
    organization_id,
    owner_user_id,
    display_name,
    status_code,
    lead_source,
    primary_email,
    primary_phone,
    tags,
    notes,
    metadata
  ) VALUES (
    p_organization_id,
    effective_owner_user_id,
    btrim(p_display_name),
    COALESCE(nullif(btrim(p_status_code), ''), 'lead'),
    nullif(btrim(p_lead_source), ''),
    nullif(btrim(p_primary_email), ''),
    nullif(btrim(p_primary_phone), ''),
    COALESCE(p_tags, '{}'::text[]),
    nullif(btrim(p_notes), ''),
    COALESCE(p_metadata, '{}'::jsonb)
  )
  RETURNING * INTO inserted_client;

  INSERT INTO public.crm_client_people (
    organization_id,
    client_id,
    role,
    first_name,
    last_name,
    display_name,
    email,
    phone,
    pesel,
    date_of_birth,
    metadata
  ) VALUES (
    p_organization_id,
    inserted_client.id,
    COALESCE(nullif(btrim(p_primary_person ->> 'role'), ''), 'primary'),
    nullif(btrim(p_primary_person ->> 'first_name'), ''),
    nullif(btrim(p_primary_person ->> 'last_name'), ''),
    COALESCE(
      nullif(btrim(p_primary_person ->> 'display_name'), ''),
      inserted_client.display_name
    ),
    COALESCE(
      nullif(btrim(p_primary_person ->> 'email'), ''),
      inserted_client.primary_email
    ),
    COALESCE(
      nullif(btrim(p_primary_person ->> 'phone'), ''),
      inserted_client.primary_phone
    ),
    nullif(btrim(p_primary_person ->> 'pesel'), ''),
    CASE
      WHEN nullif(btrim(p_primary_person ->> 'date_of_birth'), '') IS NULL
        THEN NULL
      ELSE (p_primary_person ->> 'date_of_birth')::date
    END,
    CASE
      WHEN jsonb_typeof(p_primary_person -> 'metadata') = 'object'::text
        THEN p_primary_person -> 'metadata'
      ELSE '{}'::jsonb
    END
  )
  RETURNING * INTO inserted_person;

  INSERT INTO public.crm_activities (
    organization_id,
    actor_user_id,
    client_id,
    activity_type,
    title,
    body,
    payload
  ) VALUES (
    p_organization_id,
    (SELECT app.current_user_id()),
    inserted_client.id,
    'client_created',
    'Dodano klienta',
    inserted_client.display_name,
    jsonb_build_object(
      'owner_user_id', inserted_client.owner_user_id,
      'consent_events_recorded', 0,
      'consents_granted', 0
    )
  );

  RETURN jsonb_build_object(
    'data', to_jsonb(inserted_client),
    'people', jsonb_build_array(to_jsonb(inserted_person)),
    'consents', '[]'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.create_crm_client_with_consents(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text[],
  text,
  jsonb,
  jsonb,
  jsonb
) IS
  'Creates a client and primary person without consent events. p_consent_decisions must be an empty JSON array; new decisions require SMS verification.';

DROP TRIGGER IF EXISTS crm_clients_enforce_creation_consents
  ON public.crm_clients;
