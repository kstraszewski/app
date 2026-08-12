-- A portal booking is created only for a current, verified Better Auth
-- identity. Scheduling, consent validation, CRM resolution and slot locking
-- remain centralized in create_widget_booking; this wrapper adds the verified
-- account boundary and links the resulting CRM person in the same transaction.

CREATE FUNCTION public.create_verified_portal_booking(
  p_widget_token uuid,
  p_auth_user_id uuid,
  p_service_id uuid,
  p_starts_at timestamp with time zone,
  p_customer_name text,
  p_customer_phone text,
  p_idempotency_key text,
  p_expert_user_id uuid,
  p_notes text,
  p_consent_decisions jsonb,
  p_booking_context jsonb,
  p_client_person_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  verified_email text;
  widget_record record;
  eligible_profile_ids uuid[] := ARRAY[]::uuid[];
  eligible_profile_count integer := 0;
  selected_client_id uuid;
  selected_client_person_id uuid;
  selected_phone_normalized text;
  submitted_phone_normalized text := nullif(
    pg_catalog.regexp_replace(
      coalesce(p_customer_phone, ''::text),
      '[^0-9]+'::text,
      ''::text,
      'g'::text
    ),
    ''::text
  );
  normalized_consent_decisions jsonb := coalesce(
    p_consent_decisions,
    '[]'::jsonb
  );
  canonical_consent_decisions jsonb := coalesce(
    p_consent_decisions,
    '[]'::jsonb
  );
  normalized_booking_context jsonb := coalesce(
    p_booking_context,
    '{}'::jsonb
  );
  fingerprint_payload jsonb;
  request_fingerprint text;
  booking_result jsonb;
  booked_appointment public.appointments%ROWTYPE;
  booked_person public.crm_client_people%ROWTYPE;
  conflicting_auth_user_id uuid;
  linked_verified_at timestamp with time zone;
  unique_constraint_name text;
  profile_selection text;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'verified_portal_identity_required'
      USING ERRCODE = '42501';
  END IF;

  -- Do not trust an e-mail supplied by the request body. Lock the Auth row so
  -- its verified address cannot change while the booking and link are made.
  SELECT lower(btrim(auth_user.email))
  INTO verified_email
  FROM identity.users AS auth_user
  JOIN public.profiles AS account_profile
    ON account_profile.id = auth_user.id
  WHERE auth_user.id = p_auth_user_id
    AND auth_user.email_verified = true
    AND auth_user.email_verified_at IS NOT NULL
    AND nullif(btrim(auth_user.email), '') IS NOT NULL
  FOR SHARE OF auth_user, account_profile;

  IF NOT found THEN
    RAISE EXCEPTION 'verified_portal_identity_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT
    booking_widget.id,
    booking_widget.organization_id
  INTO widget_record
  FROM public.booking_widgets AS booking_widget
  WHERE booking_widget.public_token = p_widget_token
    AND booking_widget.is_active = true
  FOR SHARE OF booking_widget;

  IF NOT found THEN
    RAISE EXCEPTION 'booking_widget_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- Serialize against archival through every durable link row for this
  -- identity. Each lifecycle row has an ON DELETE CASCADE source link, so
  -- these locks also stabilize the archived-state check below. Do not take
  -- the lifecycle advisory lock here: link activation takes it in the 0045
  -- AFTER trigger, after owning the inserted/updated tuple. Keeping that
  -- tuple -> advisory order avoids a cycle with invitation activation.
  PERFORM 1
  FROM public.client_account_links AS account_link
  WHERE account_link.auth_user_id = p_auth_user_id
  ORDER BY account_link.organization_id, account_link.client_person_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.client_portal_accounts AS archived_account
    WHERE archived_account.auth_user_id = p_auth_user_id
      AND archived_account.status = 'archived'::text
  ) THEN
    RAISE EXCEPTION 'client_portal_account_is_archived'
      USING ERRCODE = '55000';
  END IF;

  -- Consent order is presentation state, not booking identity. Keep the
  -- original array for the scheduling primitive's existing validation and
  -- evidence writes, but canonicalize valid arrays for the request hash so a
  -- semantic retry may submit the same decisions in a different order.
  IF pg_catalog.jsonb_typeof(normalized_consent_decisions) = 'array'::text THEN
    SELECT coalesce(
      pg_catalog.jsonb_agg(
        consent_decision
        ORDER BY
          consent_decision ->> 'definition_id',
          consent_decision ->> 'version_id'
      ),
      '[]'::jsonb
    )
    INTO canonical_consent_decisions
    FROM pg_catalog.jsonb_array_elements(
      normalized_consent_decisions
    ) AS consent_decisions(consent_decision);
  END IF;

  -- Compute and probe idempotency before resolving today's mutable portal
  -- profiles. An exact retry must keep returning the original appointment if
  -- another profile was linked later or the CRM phone subsequently changed.
  fingerprint_payload := jsonb_build_object(
    'version', 'verified_portal_booking_v1',
    'authUserId', p_auth_user_id,
    'verifiedEmail', verified_email,
    'widgetToken', p_widget_token,
    'serviceId', p_service_id,
    'startsAtUtc', CASE
      WHEN p_starts_at IS NULL THEN NULL
      ELSE pg_catalog.to_char(
        p_starts_at AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
      )
    END,
    'customerName', nullif(btrim(p_customer_name), ''),
    'customerPhone', submitted_phone_normalized,
    'expertUserId', p_expert_user_id,
    'notes', nullif(btrim(p_notes), ''),
    'consentDecisions', canonical_consent_decisions,
    'bookingContext', normalized_booking_context,
    'requestedClientPersonId', p_client_person_id
  );
  request_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(fingerprint_payload::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  booking_result := public.replay_widget_booking(
    p_widget_token,
    p_idempotency_key,
    request_fingerprint
  );

  IF booking_result IS NOT NULL THEN
    SELECT appointment.*
    INTO booked_appointment
    FROM public.appointments AS appointment
    WHERE appointment.id = nullif(
      booking_result #>> '{appointment,id}',
      ''::text
    )::uuid
    FOR SHARE OF appointment;

    IF NOT found
      OR booked_appointment.organization_id <> widget_record.organization_id
      OR booked_appointment.widget_id <> widget_record.id
      OR booked_appointment.client_id IS NULL
      OR booked_appointment.client_person_id IS NULL
      OR lower(btrim(booked_appointment.customer_email))
        IS DISTINCT FROM verified_email
      OR (
        p_client_person_id IS NOT NULL
        AND booked_appointment.client_person_id <> p_client_person_id
      )
    THEN
      RAISE EXCEPTION 'verified_portal_booking_result_invalid'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT client_person.*
    INTO booked_person
    FROM public.crm_client_people AS client_person
    WHERE client_person.organization_id = booked_appointment.organization_id
      AND client_person.client_id = booked_appointment.client_id
      AND client_person.id = booked_appointment.client_person_id
      AND client_person.email_normalized = verified_email
    FOR SHARE OF client_person;

    IF NOT found THEN
      RAISE EXCEPTION 'verified_portal_booking_result_invalid'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT account_link.verified_at
    INTO linked_verified_at
    FROM public.client_account_links AS account_link
    JOIN public.client_portal_accounts AS portal_account
      ON portal_account.auth_user_id = account_link.auth_user_id
     AND portal_account.organization_id = account_link.organization_id
     AND portal_account.client_id = account_link.client_id
     AND portal_account.client_person_id = account_link.client_person_id
     AND portal_account.status = 'active'::text
    WHERE account_link.auth_user_id = p_auth_user_id
      AND account_link.organization_id = booked_appointment.organization_id
      AND account_link.client_id = booked_appointment.client_id
      AND account_link.client_person_id = booked_appointment.client_person_id
      AND account_link.verification_method = 'email'::text
      AND account_link.verified_contact_normalized = verified_email
      AND account_link.verified_at IS NOT NULL
      AND account_link.revoked_at IS NULL
    FOR SHARE OF account_link, portal_account;

    IF NOT found THEN
      RAISE EXCEPTION 'verified_portal_booking_result_invalid'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN (booking_result - 'managementToken') || jsonb_build_object(
      'portalAccount', jsonb_build_object(
        'linked', true,
        'organizationId', booked_appointment.organization_id,
        'clientId', booked_appointment.client_id,
        'clientPersonId', booked_appointment.client_person_id,
        'verificationMethod', 'email',
        'verifiedAt', linked_verified_at,
        'profileSelection', CASE
          WHEN p_client_person_id IS NULL THEN 'automatic'
          ELSE 'explicit'
        END
      )
    );
  END IF;

  SELECT coalesce(
    pg_catalog.array_agg(
      eligible_profile.client_person_id
      ORDER BY eligible_profile.client_person_id
    ),
    ARRAY[]::uuid[]
  )
  INTO eligible_profile_ids
  FROM (
    SELECT account_link.client_person_id
    FROM public.client_account_links AS account_link
    JOIN public.client_portal_accounts AS portal_account
      ON portal_account.auth_user_id = account_link.auth_user_id
     AND portal_account.organization_id = account_link.organization_id
     AND portal_account.client_id = account_link.client_id
     AND portal_account.client_person_id = account_link.client_person_id
     AND portal_account.status = 'active'::text
    JOIN public.crm_client_people AS client_person
      ON client_person.organization_id = account_link.organization_id
     AND client_person.client_id = account_link.client_id
     AND client_person.id = account_link.client_person_id
    WHERE account_link.auth_user_id = p_auth_user_id
      AND account_link.organization_id = widget_record.organization_id
      AND account_link.verification_method = 'email'::text
      AND account_link.verified_contact_normalized = verified_email
      AND account_link.verified_at IS NOT NULL
      AND account_link.revoked_at IS NULL
      AND client_person.email_normalized = verified_email
  ) AS eligible_profile;

  eligible_profile_count := pg_catalog.cardinality(eligible_profile_ids);

  IF p_client_person_id IS NULL THEN
    profile_selection := 'automatic';

    IF eligible_profile_count > 1 THEN
      RAISE EXCEPTION 'verified_portal_profile_selection_required'
        USING ERRCODE = 'P0001';
    ELSIF eligible_profile_count = 1 THEN
      selected_client_person_id := eligible_profile_ids[1];
    END IF;
  ELSE
    IF NOT (p_client_person_id = ANY (eligible_profile_ids)) THEN
      -- The same response covers a foreign, stale and non-existent profile so
      -- the RPC does not disclose another account's organization scope.
      RAISE EXCEPTION 'verified_portal_profile_not_found'
        USING ERRCODE = 'P0002';
    END IF;

    selected_client_person_id := p_client_person_id;
    profile_selection := 'explicit';
  END IF;

  IF selected_client_person_id IS NOT NULL THEN
    SELECT
      account_link.client_id,
      client_person.phone_normalized
    INTO
      selected_client_id,
      selected_phone_normalized
    FROM public.client_account_links AS account_link
    JOIN public.client_portal_accounts AS portal_account
      ON portal_account.auth_user_id = account_link.auth_user_id
     AND portal_account.organization_id = account_link.organization_id
     AND portal_account.client_id = account_link.client_id
     AND portal_account.client_person_id = account_link.client_person_id
     AND portal_account.status = 'active'::text
    JOIN public.crm_client_people AS client_person
      ON client_person.organization_id = account_link.organization_id
     AND client_person.client_id = account_link.client_id
     AND client_person.id = account_link.client_person_id
    WHERE account_link.auth_user_id = p_auth_user_id
      AND account_link.organization_id = widget_record.organization_id
      AND account_link.client_person_id = selected_client_person_id
      AND account_link.verification_method = 'email'::text
      AND account_link.verified_contact_normalized = verified_email
      AND account_link.verified_at IS NOT NULL
      AND account_link.revoked_at IS NULL
      AND client_person.email_normalized = verified_email
    FOR UPDATE OF account_link
    FOR SHARE OF portal_account, client_person;

    IF NOT found THEN
      RAISE EXCEPTION 'verified_portal_profile_not_found'
        USING ERRCODE = 'P0002';
    END IF;

    -- create_widget_booking resolves CRM people by the exact e-mail + phone
    -- pair. Refuse a changed phone here instead of silently creating a second
    -- CRM person for an already selected, verified portal profile.
    IF selected_phone_normalized IS NULL
      AND submitted_phone_normalized IS NOT NULL
    THEN
      UPDATE public.crm_client_people AS client_person
      SET phone = nullif(btrim(p_customer_phone), '')
      WHERE client_person.organization_id = widget_record.organization_id
        AND client_person.client_id = selected_client_id
        AND client_person.id = selected_client_person_id
        AND client_person.phone_normalized IS NULL;
      selected_phone_normalized := submitted_phone_normalized;
    END IF;

    IF selected_phone_normalized IS DISTINCT FROM submitted_phone_normalized THEN
      RAISE EXCEPTION 'verified_portal_profile_phone_mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- First bookings must not silently attach a verified Auth identity to a CRM
  -- person already owned by another portal account. Fail before scheduling so
  -- no consent evidence or appointment is written for the wrong identity.
  IF selected_client_person_id IS NULL THEN
    SELECT account_link.auth_user_id
    INTO conflicting_auth_user_id
    FROM public.crm_client_people AS candidate_person
    JOIN public.client_account_links AS account_link
      ON account_link.organization_id = candidate_person.organization_id
     AND account_link.client_id = candidate_person.client_id
     AND account_link.client_person_id = candidate_person.id
     AND account_link.revoked_at IS NULL
    WHERE candidate_person.organization_id = widget_record.organization_id
      AND candidate_person.email_normalized = verified_email
      AND candidate_person.phone_normalized = submitted_phone_normalized
      AND account_link.auth_user_id <> p_auth_user_id
    LIMIT 1
    FOR UPDATE OF account_link;

    IF found THEN
      RAISE EXCEPTION 'client_person_already_linked'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  booking_result := public.create_widget_booking(
    p_widget_token,
    p_service_id,
    p_starts_at,
    p_customer_name,
    verified_email,
    p_idempotency_key,
    p_customer_phone,
    p_expert_user_id,
    p_notes,
    normalized_consent_decisions,
    normalized_booking_context,
    request_fingerprint
  );

  SELECT appointment.*
  INTO booked_appointment
  FROM public.appointments AS appointment
  WHERE appointment.id = nullif(
    booking_result #>> '{appointment,id}',
    ''::text
  )::uuid
  FOR SHARE OF appointment;

  IF NOT found
    OR booked_appointment.organization_id <> widget_record.organization_id
    OR booked_appointment.widget_id <> widget_record.id
    OR booked_appointment.client_id IS NULL
    OR booked_appointment.client_person_id IS NULL
    OR lower(btrim(booked_appointment.customer_email))
      IS DISTINCT FROM verified_email
  THEN
    RAISE EXCEPTION 'verified_portal_booking_result_invalid'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT client_person.*
  INTO booked_person
  FROM public.crm_client_people AS client_person
  WHERE client_person.organization_id = booked_appointment.organization_id
    AND client_person.client_id = booked_appointment.client_id
    AND client_person.id = booked_appointment.client_person_id
    AND client_person.email_normalized = verified_email
  FOR SHARE OF client_person;

  IF NOT found THEN
    RAISE EXCEPTION 'verified_portal_booking_result_invalid'
      USING ERRCODE = 'P0001';
  END IF;

  IF selected_client_person_id IS NOT NULL
    AND (
      booked_appointment.client_id <> selected_client_id
      OR booked_appointment.client_person_id <> selected_client_person_id
    )
  THEN
    -- This can happen only when legacy CRM data contains an ambiguous exact
    -- contact pair. The exception also rolls back a newly created appointment.
    RAISE EXCEPTION 'verified_portal_booking_profile_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT account_link.auth_user_id
  INTO conflicting_auth_user_id
  FROM public.client_account_links AS account_link
  WHERE account_link.organization_id = booked_appointment.organization_id
    AND account_link.client_person_id = booked_appointment.client_person_id
    AND account_link.auth_user_id <> p_auth_user_id
    AND account_link.revoked_at IS NULL
  FOR UPDATE OF account_link;

  IF found THEN
    RAISE EXCEPTION 'client_person_already_linked'
      USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO public.client_account_links AS existing_link (
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
      booked_appointment.organization_id,
      booked_appointment.client_id,
      booked_appointment.client_person_id,
      booked_appointment.id,
      'email'::text,
      verified_email,
      statement_timestamp(),
      NULL
    )
    ON CONFLICT (auth_user_id, organization_id, client_person_id)
    DO NOTHING
    RETURNING verified_at INTO linked_verified_at;
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS
        unique_constraint_name = CONSTRAINT_NAME;

      IF unique_constraint_name = 'client_account_links_active_person_idx' THEN
        RAISE EXCEPTION 'client_person_already_linked'
          USING ERRCODE = '23505';
      END IF;

      RAISE;
  END;

  IF linked_verified_at IS NULL THEN
    SELECT account_link.verified_at
    INTO linked_verified_at
    FROM public.client_account_links AS account_link
    WHERE account_link.auth_user_id = p_auth_user_id
      AND account_link.organization_id = booked_appointment.organization_id
      AND account_link.client_id = booked_appointment.client_id
      AND account_link.client_person_id = booked_appointment.client_person_id
      AND account_link.verification_method = 'email'::text
      AND account_link.verified_contact_normalized = verified_email
      AND account_link.revoked_at IS NULL
    FOR SHARE OF account_link;

    IF NOT found THEN
      RAISE EXCEPTION 'client_person_already_linked'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- The legacy scheduling primitive records public-widget evidence as
  -- self-declared. This wrapper has independently locked and verified the Auth
  -- address, so upgrade only the exact CRM subject and consent evidence that
  -- participated in this booking.
  UPDATE public.crm_clients AS client
  SET metadata = client.metadata || jsonb_build_object(
    'identityVerification', 'verified_email_account',
    'portalAccountVerified', true
  )
  WHERE client.organization_id = booked_appointment.organization_id
    AND client.id = booked_appointment.client_id
    AND client.metadata IS DISTINCT FROM (
      client.metadata || jsonb_build_object(
        'identityVerification', 'verified_email_account',
        'portalAccountVerified', true
      )
    );

  UPDATE public.crm_client_people AS client_person
  SET metadata = client_person.metadata || jsonb_build_object(
    'identityVerification', 'verified_email_account',
    'portalAccountVerified', true
  )
  WHERE client_person.organization_id = booked_appointment.organization_id
    AND client_person.client_id = booked_appointment.client_id
    AND client_person.id = booked_appointment.client_person_id
    AND client_person.metadata IS DISTINCT FROM (
      client_person.metadata || jsonb_build_object(
        'identityVerification', 'verified_email_account',
        'portalAccountVerified', true
      )
    );

  UPDATE public.crm_client_consent_events AS consent_event
  SET metadata = consent_event.metadata || jsonb_build_object(
    'identityVerification', 'verified_email_account',
    'contactValueSource', 'verified_portal_identity'
  )
  WHERE consent_event.organization_id = booked_appointment.organization_id
    AND consent_event.client_id = booked_appointment.client_id
    AND consent_event.subject_person_id = booked_appointment.client_person_id
    AND consent_event.source = 'booking_widget'::text
    AND consent_event.evidence_reference = (
      'widget:'::text || widget_record.id::text || ':booking:'::text
        || btrim(p_idempotency_key)
    )
    AND consent_event.metadata IS DISTINCT FROM (
      consent_event.metadata || jsonb_build_object(
        'identityVerification', 'verified_email_account',
        'contactValueSource', 'verified_portal_identity'
      )
    );

  RETURN (booking_result - 'managementToken') || jsonb_build_object(
    'portalAccount', jsonb_build_object(
      'linked', true,
      'organizationId', booked_appointment.organization_id,
      'clientId', booked_appointment.client_id,
      'clientPersonId', booked_appointment.client_person_id,
      'verificationMethod', 'email',
      'verifiedAt', linked_verified_at,
      'profileSelection', profile_selection
    )
  );
END
$function$;

COMMENT ON FUNCTION public.create_verified_portal_booking(
  uuid,
  uuid,
  uuid,
  timestamp with time zone,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  jsonb,
  uuid
) IS
  'Server-only atomic booking for a verified Better Auth identity. The caller must take p_auth_user_id from the authenticated portal session; the function independently loads its verified e-mail, delegates scheduling to create_widget_booking, requires profile selection when needed and rolls booking back if the CRM person cannot be linked to that identity.';

REVOKE ALL ON FUNCTION public.create_verified_portal_booking(
  uuid,
  uuid,
  uuid,
  timestamp with time zone,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  jsonb,
  uuid
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

GRANT EXECUTE ON FUNCTION public.create_verified_portal_booking(
  uuid,
  uuid,
  uuid,
  timestamp with time zone,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  jsonb,
  uuid
) TO openexpert_service;
