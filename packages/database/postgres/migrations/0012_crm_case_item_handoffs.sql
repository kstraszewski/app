-- A process handoff is an explicit, auditable transfer of one CRM case item.
-- Creating a request never changes ownership; acceptance performs the guarded
-- owner update in the same transaction as resolving the request.

CREATE TABLE public.crm_case_item_handoffs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  organization_id uuid NOT NULL,
  case_id uuid NOT NULL,
  case_item_id uuid NOT NULL,
  previous_owner_user_id uuid,
  proposed_owner_user_id uuid NOT NULL,
  requested_by_user_id uuid NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  request_note text,
  response_note text,
  idempotency_key uuid NOT NULL,
  idempotency_fingerprint text NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  resolved_at timestamp with time zone,
  resolved_by_user_id uuid,
  revision bigint DEFAULT 1 NOT NULL,
  CONSTRAINT crm_case_item_handoffs_pkey PRIMARY KEY (id),
  CONSTRAINT crm_case_item_handoffs_organization_id_id_key
    UNIQUE (organization_id, id),
  CONSTRAINT crm_case_item_handoffs_status_check CHECK (
    status = ANY (ARRAY[
      'pending'::text,
      'accepted'::text,
      'rejected'::text,
      'cancelled'::text
    ])
  ),
  CONSTRAINT crm_case_item_handoffs_owner_change_check CHECK (
    proposed_owner_user_id IS DISTINCT FROM previous_owner_user_id
  ),
  CONSTRAINT crm_case_item_handoffs_request_note_check CHECK (
    request_note IS NULL
    OR (btrim(request_note) <> ''::text AND char_length(request_note) <= 2000)
  ),
  CONSTRAINT crm_case_item_handoffs_response_note_check CHECK (
    response_note IS NULL
    OR (btrim(response_note) <> ''::text AND char_length(response_note) <= 2000)
  ),
  CONSTRAINT crm_case_item_handoffs_fingerprint_check CHECK (
    idempotency_fingerprint ~ '^[0-9a-f]{64}$'::text
  ),
  CONSTRAINT crm_case_item_handoffs_revision_check CHECK (revision >= 1),
  CONSTRAINT crm_case_item_handoffs_lifecycle_check CHECK (
    (
      status = 'pending'::text
      AND resolved_at IS NULL
      AND resolved_by_user_id IS NULL
      AND response_note IS NULL
    )
    OR (
      status <> 'pending'::text
      AND resolved_at IS NOT NULL
      AND resolved_by_user_id IS NOT NULL
      AND resolved_at >= requested_at
    )
  ),
  CONSTRAINT crm_case_item_handoffs_case_item_fkey FOREIGN KEY (
    organization_id,
    case_id,
    case_item_id
  ) REFERENCES public.crm_case_items (
    organization_id,
    case_id,
    id
  ) ON DELETE CASCADE,
  CONSTRAINT crm_case_item_handoffs_previous_owner_fkey FOREIGN KEY (
    organization_id,
    previous_owner_user_id
  ) REFERENCES public.organization_memberships (organization_id, user_id),
  CONSTRAINT crm_case_item_handoffs_proposed_owner_fkey FOREIGN KEY (
    organization_id,
    proposed_owner_user_id
  ) REFERENCES public.organization_memberships (organization_id, user_id),
  CONSTRAINT crm_case_item_handoffs_requester_fkey FOREIGN KEY (
    organization_id,
    requested_by_user_id
  ) REFERENCES public.organization_memberships (organization_id, user_id),
  CONSTRAINT crm_case_item_handoffs_resolver_fkey FOREIGN KEY (
    organization_id,
    resolved_by_user_id
  ) REFERENCES public.organization_memberships (organization_id, user_id)
);

COMMENT ON TABLE public.crm_case_item_handoffs IS
  'Auditable requests to transfer ownership of one CRM case item (process).';

CREATE UNIQUE INDEX crm_case_item_handoffs_one_pending_item_idx
  ON public.crm_case_item_handoffs (organization_id, case_item_id)
  WHERE status = 'pending'::text;

CREATE UNIQUE INDEX crm_case_item_handoffs_idempotency_idx
  ON public.crm_case_item_handoffs (
    organization_id,
    requested_by_user_id,
    idempotency_key
  );

CREATE INDEX crm_case_item_handoffs_inbox_idx
  ON public.crm_case_item_handoffs (
    organization_id,
    proposed_owner_user_id,
    requested_at DESC,
    id
  )
  WHERE status = 'pending'::text;

CREATE INDEX crm_case_item_handoffs_item_history_idx
  ON public.crm_case_item_handoffs (
    organization_id,
    case_item_id,
    requested_at DESC,
    id
  );

CREATE INDEX crm_case_item_handoffs_case_item_fk_idx
  ON public.crm_case_item_handoffs (organization_id, case_id, case_item_id);

CREATE INDEX crm_case_item_handoffs_previous_owner_idx
  ON public.crm_case_item_handoffs (organization_id, previous_owner_user_id)
  WHERE previous_owner_user_id IS NOT NULL;

CREATE INDEX crm_case_item_handoffs_proposed_owner_idx
  ON public.crm_case_item_handoffs (organization_id, proposed_owner_user_id);

CREATE INDEX crm_case_item_handoffs_resolver_idx
  ON public.crm_case_item_handoffs (organization_id, resolved_by_user_id)
  WHERE resolved_by_user_id IS NOT NULL;

ALTER TABLE public.crm_case_item_handoffs ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all
  ON public.crm_case_item_handoffs
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

CREATE POLICY crm_case_item_handoffs_participants_read
  ON public.crm_case_item_handoffs
  FOR SELECT TO authenticated
  USING (
    private.is_organization_member(organization_id)
    AND (
      requested_by_user_id = (SELECT app.current_user_id())
      OR proposed_owner_user_id = (SELECT app.current_user_id())
      OR previous_owner_user_id = (SELECT app.current_user_id())
      OR private.is_organization_admin(organization_id)
      OR EXISTS (
        SELECT 1
        FROM public.crm_case_items AS item
        WHERE item.organization_id = crm_case_item_handoffs.organization_id
          AND item.id = crm_case_item_handoffs.case_item_id
          AND item.owner_user_id = (SELECT app.current_user_id())
      )
      OR EXISTS (
        SELECT 1
        FROM public.crm_cases AS crm_case
        WHERE crm_case.organization_id = crm_case_item_handoffs.organization_id
          AND crm_case.id = crm_case_item_handoffs.case_id
          AND crm_case.owner_user_id = (SELECT app.current_user_id())
      )
    )
  );

REVOKE ALL ON TABLE public.crm_case_item_handoffs
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.crm_case_item_handoffs TO openexpert_service;
GRANT SELECT
  ON TABLE public.crm_case_item_handoffs TO authenticated;

CREATE FUNCTION public.request_crm_case_item_handoff(p_request jsonb)
RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO ''
  AS $$
DECLARE
  request_organization_id uuid;
  request_case_id uuid;
  request_case_item_id uuid;
  request_requested_by_user_id uuid;
  request_proposed_owner_user_id uuid;
  request_idempotency_key uuid;
  request_idempotency_fingerprint text;
  normalized_request_note text;
  requester_role text;
  target_item public.crm_case_items%rowtype;
  target_case public.crm_cases%rowtype;
  target_handoff public.crm_case_item_handoffs%rowtype;
BEGIN
  IF current_user <> 'openexpert_service' THEN
    RAISE EXCEPTION 'crm_case_item_handoff_service_role_required'
      USING errcode = '42501';
  END IF;

  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object'::text THEN
    RAISE EXCEPTION 'invalid_crm_case_item_handoff_request'
      USING errcode = '22023';
  END IF;

  BEGIN
    request_organization_id :=
      nullif(btrim(p_request ->> 'organization_id'), '')::uuid;
    request_case_id := nullif(btrim(p_request ->> 'case_id'), '')::uuid;
    request_case_item_id :=
      nullif(btrim(p_request ->> 'case_item_id'), '')::uuid;
    request_requested_by_user_id :=
      nullif(btrim(p_request ->> 'requested_by_user_id'), '')::uuid;
    request_proposed_owner_user_id :=
      nullif(btrim(p_request ->> 'proposed_owner_user_id'), '')::uuid;
    request_idempotency_key :=
      nullif(btrim(p_request ->> 'idempotency_key'), '')::uuid;
    request_idempotency_fingerprint :=
      lower(nullif(btrim(p_request ->> 'idempotency_fingerprint'), ''));
    normalized_request_note :=
      nullif(btrim(p_request ->> 'request_note'), '');
  EXCEPTION
    WHEN invalid_text_representation OR data_exception THEN
      RAISE EXCEPTION 'invalid_crm_case_item_handoff_request'
        USING errcode = '22023';
  END;

  IF request_organization_id IS NULL
    OR request_case_id IS NULL
    OR request_case_item_id IS NULL
    OR request_requested_by_user_id IS NULL
    OR request_proposed_owner_user_id IS NULL
    OR request_idempotency_key IS NULL
    OR request_idempotency_fingerprint IS NULL
    OR request_idempotency_fingerprint !~ '^[0-9a-f]{64}$'
    OR (
      normalized_request_note IS NOT NULL
      AND char_length(normalized_request_note) > 2000
    )
  THEN
    RAISE EXCEPTION 'invalid_crm_case_item_handoff_request'
      USING errcode = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'openexpert-case-item-handoff:'
      || request_organization_id::text || ':'
      || request_requested_by_user_id::text || ':'
      || request_idempotency_key::text,
    0
  ));

  SELECT item.*
  INTO target_item
  FROM public.crm_case_items AS item
  WHERE item.organization_id = request_organization_id
    AND item.case_id = request_case_id
    AND item.id = request_case_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_case_item_handoff_case_item_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT crm_case.*
  INTO target_case
  FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = request_organization_id
    AND crm_case.id = request_case_id;

  SELECT handoff.*
  INTO target_handoff
  FROM public.crm_case_item_handoffs AS handoff
  WHERE handoff.organization_id = request_organization_id
    AND handoff.requested_by_user_id = request_requested_by_user_id
    AND handoff.idempotency_key = request_idempotency_key;

  IF FOUND THEN
    IF target_handoff.idempotency_fingerprint
      IS DISTINCT FROM request_idempotency_fingerprint
    THEN
      RAISE EXCEPTION 'crm_case_item_handoff_idempotency_key_reused'
        USING errcode = '23505';
    END IF;

    RETURN jsonb_build_object(
      'handoffId', target_handoff.id,
      'organizationId', target_handoff.organization_id,
      'caseId', target_handoff.case_id,
      'caseItemId', target_handoff.case_item_id,
      'previousOwnerUserId', target_handoff.previous_owner_user_id,
      'proposedOwnerUserId', target_handoff.proposed_owner_user_id,
      'requestedByUserId', target_handoff.requested_by_user_id,
      'status', target_handoff.status,
      'requestNote', target_handoff.request_note,
      'responseNote', target_handoff.response_note,
      'requestedAt', target_handoff.requested_at,
      'resolvedAt', target_handoff.resolved_at,
      'resolvedByUserId', target_handoff.resolved_by_user_id,
      'revision', target_handoff.revision,
      'created', false,
      'replayed', true
    );
  END IF;

  SELECT membership.role
  INTO requester_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = request_organization_id
    AND membership.user_id = request_requested_by_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_case_item_handoff_requester_membership_required'
      USING errcode = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    WHERE membership.organization_id = request_organization_id
      AND membership.user_id = request_proposed_owner_user_id
  ) THEN
    RAISE EXCEPTION 'crm_case_item_handoff_proposed_owner_membership_required'
      USING errcode = '23503';
  END IF;

  IF request_proposed_owner_user_id IS NOT DISTINCT FROM target_item.owner_user_id THEN
    RAISE EXCEPTION 'crm_case_item_handoff_same_owner'
      USING errcode = '23514';
  END IF;

  IF request_requested_by_user_id IS DISTINCT FROM target_item.owner_user_id
    AND request_requested_by_user_id IS DISTINCT FROM target_case.owner_user_id
    AND requester_role <> 'admin'::text
  THEN
    RAISE EXCEPTION 'crm_case_item_handoff_request_not_authorized'
      USING errcode = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.crm_case_item_handoffs AS handoff
    WHERE handoff.organization_id = request_organization_id
      AND handoff.case_item_id = request_case_item_id
      AND handoff.status = 'pending'::text
  ) THEN
    RAISE EXCEPTION 'crm_case_item_handoff_pending_exists'
      USING errcode = '23514';
  END IF;

  INSERT INTO public.crm_case_item_handoffs (
    organization_id,
    case_id,
    case_item_id,
    previous_owner_user_id,
    proposed_owner_user_id,
    requested_by_user_id,
    request_note,
    idempotency_key,
    idempotency_fingerprint
  ) VALUES (
    request_organization_id,
    request_case_id,
    request_case_item_id,
    target_item.owner_user_id,
    request_proposed_owner_user_id,
    request_requested_by_user_id,
    normalized_request_note,
    request_idempotency_key,
    request_idempotency_fingerprint
  )
  RETURNING * INTO target_handoff;

  INSERT INTO public.crm_activities (
    organization_id,
    actor_user_id,
    client_id,
    case_id,
    case_item_id,
    activity_type,
    title,
    body,
    payload,
    created_at
  ) VALUES (
    target_handoff.organization_id,
    target_handoff.requested_by_user_id,
    target_case.client_id,
    target_handoff.case_id,
    target_handoff.case_item_id,
    'case_item_handoff_requested'::text,
    'Zaproponowano przekazanie procesu'::text,
    target_handoff.request_note,
    jsonb_build_object(
      'handoff_id', target_handoff.id,
      'previous_owner_user_id', target_handoff.previous_owner_user_id,
      'proposed_owner_user_id', target_handoff.proposed_owner_user_id,
      'requested_by_user_id', target_handoff.requested_by_user_id,
      'status', target_handoff.status,
      'request_note', target_handoff.request_note,
      'revision', target_handoff.revision
    ),
    target_handoff.requested_at
  );

  RETURN jsonb_build_object(
    'handoffId', target_handoff.id,
    'organizationId', target_handoff.organization_id,
    'caseId', target_handoff.case_id,
    'caseItemId', target_handoff.case_item_id,
    'previousOwnerUserId', target_handoff.previous_owner_user_id,
    'proposedOwnerUserId', target_handoff.proposed_owner_user_id,
    'requestedByUserId', target_handoff.requested_by_user_id,
    'status', target_handoff.status,
    'requestNote', target_handoff.request_note,
    'responseNote', target_handoff.response_note,
    'requestedAt', target_handoff.requested_at,
    'resolvedAt', target_handoff.resolved_at,
    'resolvedByUserId', target_handoff.resolved_by_user_id,
    'revision', target_handoff.revision,
    'created', true,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.request_crm_case_item_handoff(jsonb) IS
  'Creates an idempotent process handoff request without changing the current owner.';

REVOKE ALL ON FUNCTION public.request_crm_case_item_handoff(jsonb)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.request_crm_case_item_handoff(jsonb)
  TO openexpert_service;

CREATE FUNCTION public.respond_crm_case_item_handoff(
  p_handoff_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_response_note text DEFAULT NULL
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_action text := lower(nullif(btrim(p_action), ''));
  normalized_response_note text := nullif(btrim(p_response_note), '');
  decision_status text;
  decision_time timestamp with time zone := statement_timestamp();
  actor_role text;
  target_handoff public.crm_case_item_handoffs%rowtype;
  target_item public.crm_case_items%rowtype;
  target_case public.crm_cases%rowtype;
BEGIN
  IF current_user <> 'openexpert_service' THEN
    RAISE EXCEPTION 'crm_case_item_handoff_service_role_required'
      USING errcode = '42501';
  END IF;

  IF p_handoff_id IS NULL
    OR p_actor_user_id IS NULL
    OR normalized_action IS NULL
    OR normalized_action <> ALL (ARRAY['accept'::text, 'reject'::text, 'cancel'::text])
    OR (
      normalized_response_note IS NOT NULL
      AND char_length(normalized_response_note) > 2000
    )
  THEN
    RAISE EXCEPTION 'invalid_crm_case_item_handoff_response'
      USING errcode = '22023';
  END IF;

  SELECT handoff.*
  INTO target_handoff
  FROM public.crm_case_item_handoffs AS handoff
  WHERE handoff.id = p_handoff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_case_item_handoff_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT item.*
  INTO target_item
  FROM public.crm_case_items AS item
  WHERE item.organization_id = target_handoff.organization_id
    AND item.case_id = target_handoff.case_id
    AND item.id = target_handoff.case_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_case_item_handoff_case_item_not_found'
      USING errcode = 'P0002';
  END IF;

  SELECT crm_case.*
  INTO target_case
  FROM public.crm_cases AS crm_case
  WHERE crm_case.organization_id = target_handoff.organization_id
    AND crm_case.id = target_handoff.case_id;

  SELECT membership.role
  INTO actor_role
  FROM public.organization_memberships AS membership
  WHERE membership.organization_id = target_handoff.organization_id
    AND membership.user_id = p_actor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_case_item_handoff_actor_membership_required'
      USING errcode = '23503';
  END IF;

  IF normalized_action = ANY (ARRAY['accept'::text, 'reject'::text]) THEN
    IF p_actor_user_id IS DISTINCT FROM target_handoff.proposed_owner_user_id THEN
      RAISE EXCEPTION 'crm_case_item_handoff_response_requires_proposed_owner'
        USING errcode = '42501';
    END IF;
  ELSIF p_actor_user_id IS DISTINCT FROM target_handoff.requested_by_user_id
    AND p_actor_user_id IS DISTINCT FROM target_item.owner_user_id
    AND p_actor_user_id IS DISTINCT FROM target_case.owner_user_id
    AND actor_role <> 'admin'::text
  THEN
    RAISE EXCEPTION 'crm_case_item_handoff_cancel_not_authorized'
      USING errcode = '42501';
  END IF;

  decision_status := CASE normalized_action
    WHEN 'accept'::text THEN 'accepted'::text
    WHEN 'reject'::text THEN 'rejected'::text
    ELSE 'cancelled'::text
  END;

  IF target_handoff.status <> 'pending'::text THEN
    IF target_handoff.status IS DISTINCT FROM decision_status THEN
      RAISE EXCEPTION 'crm_case_item_handoff_already_resolved'
        USING errcode = '23514';
    END IF;
    IF target_handoff.response_note IS DISTINCT FROM normalized_response_note THEN
      RAISE EXCEPTION 'crm_case_item_handoff_response_conflict'
        USING errcode = '23514';
    END IF;

    RETURN jsonb_build_object(
      'handoffId', target_handoff.id,
      'caseItemId', target_handoff.case_item_id,
      'status', target_handoff.status,
      'previousOwnerUserId', target_handoff.previous_owner_user_id,
      'proposedOwnerUserId', target_handoff.proposed_owner_user_id,
      'ownerUserId', target_item.owner_user_id,
      'responseNote', target_handoff.response_note,
      'resolvedAt', target_handoff.resolved_at,
      'resolvedByUserId', target_handoff.resolved_by_user_id,
      'revision', target_handoff.revision,
      'replayed', true
    );
  END IF;

  IF decision_status = 'accepted'::text THEN
    UPDATE public.crm_case_items AS item
    SET owner_user_id = target_handoff.proposed_owner_user_id
    WHERE item.organization_id = target_handoff.organization_id
      AND item.case_id = target_handoff.case_id
      AND item.id = target_handoff.case_item_id
      AND item.owner_user_id IS NOT DISTINCT FROM target_handoff.previous_owner_user_id
    RETURNING item.* INTO target_item;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'crm_case_item_handoff_owner_changed'
        USING errcode = '23514';
    END IF;
  END IF;

  UPDATE public.crm_case_item_handoffs AS handoff
  SET
    status = decision_status,
    response_note = normalized_response_note,
    resolved_at = decision_time,
    resolved_by_user_id = p_actor_user_id,
    revision = handoff.revision + 1
  WHERE handoff.id = target_handoff.id
    AND handoff.status = 'pending'::text
  RETURNING handoff.* INTO target_handoff;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'crm_case_item_handoff_concurrent_resolution'
      USING errcode = '23514';
  END IF;

  INSERT INTO public.crm_activities (
    organization_id,
    actor_user_id,
    client_id,
    case_id,
    case_item_id,
    activity_type,
    title,
    body,
    payload,
    created_at
  ) VALUES (
    target_handoff.organization_id,
    p_actor_user_id,
    target_case.client_id,
    target_handoff.case_id,
    target_handoff.case_item_id,
    CASE target_handoff.status
      WHEN 'accepted'::text THEN 'case_item_handoff_accepted'::text
      WHEN 'rejected'::text THEN 'case_item_handoff_rejected'::text
      ELSE 'case_item_handoff_cancelled'::text
    END,
    CASE target_handoff.status
      WHEN 'accepted'::text THEN 'Przyjęto przekazanie procesu'::text
      WHEN 'rejected'::text THEN 'Odrzucono przekazanie procesu'::text
      ELSE 'Anulowano przekazanie procesu'::text
    END,
    target_handoff.response_note,
    jsonb_build_object(
      'handoff_id', target_handoff.id,
      'previous_owner_user_id', target_handoff.previous_owner_user_id,
      'proposed_owner_user_id', target_handoff.proposed_owner_user_id,
      'requested_by_user_id', target_handoff.requested_by_user_id,
      'resolved_by_user_id', target_handoff.resolved_by_user_id,
      'owner_user_id', target_item.owner_user_id,
      'status', target_handoff.status,
      'response_note', target_handoff.response_note,
      'revision', target_handoff.revision
    ),
    target_handoff.resolved_at
  );

  RETURN jsonb_build_object(
    'handoffId', target_handoff.id,
    'caseItemId', target_handoff.case_item_id,
    'status', target_handoff.status,
    'previousOwnerUserId', target_handoff.previous_owner_user_id,
    'proposedOwnerUserId', target_handoff.proposed_owner_user_id,
    'ownerUserId', target_item.owner_user_id,
    'responseNote', target_handoff.response_note,
    'resolvedAt', target_handoff.resolved_at,
    'resolvedByUserId', target_handoff.resolved_by_user_id,
    'revision', target_handoff.revision,
    'replayed', false
  );
END;
$$;

COMMENT ON FUNCTION public.respond_crm_case_item_handoff(uuid, uuid, text, text) IS
  'Accepts, rejects, or cancels a process handoff and atomically transfers ownership on acceptance.';

REVOKE ALL ON FUNCTION public.respond_crm_case_item_handoff(uuid, uuid, text, text)
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.respond_crm_case_item_handoff(uuid, uuid, text, text)
  TO openexpert_service;
