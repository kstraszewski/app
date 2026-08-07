-- Keep the durable notification inbox consistent with case-message receipts.
-- A conversation can be opened without activating its notification entry, so
-- advancing the staff read cursor must also consume every covered message
-- notification for that conversation.

CREATE OR REPLACE FUNCTION private.mark_case_message_notifications_read(
  p_organization_id uuid,
  p_recipient_user_id uuid,
  p_conversation_id uuid,
  p_read_through_sequence bigint
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  action_time timestamp with time zone := statement_timestamp();
  updated_count bigint := 0;
  state_event jsonb;
  current_revision bigint;
  current_event jsonb;
BEGIN
  IF p_organization_id IS NULL
    OR p_recipient_user_id IS NULL
    OR p_conversation_id IS NULL
    OR p_read_through_sequence IS NULL
    OR p_read_through_sequence < 0
  THEN
    RAISE EXCEPTION 'invalid_case_message_notification_receipt'
      USING errcode = '22023';
  END IF;

  UPDATE public.user_notifications AS notification
  SET read_at = greatest(action_time, notification.created_at)
  FROM public.notification_events AS notification_event
  WHERE notification.organization_id = p_organization_id
    AND notification.recipient_user_id = p_recipient_user_id
    AND notification.read_at IS NULL
    AND notification_event.organization_id = notification.organization_id
    AND notification_event.id = notification.event_id
    AND notification_event.event_type = 'crm.case_message.received'::text
    AND lower(coalesce(
      notification_event.payload ->> 'conversationId',
      notification_event.payload ->> 'conversation_id',
      ''::text
    )) = p_conversation_id::text
    AND coalesce(
      notification_event.payload ->> 'sequence',
      ''::text
    ) ~ '^[0-9]+$'::text
    AND (notification_event.payload ->> 'sequence')::numeric
      <= p_read_through_sequence::numeric;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  IF updated_count > 0 THEN
    state_event := private.enqueue_notification_realtime_change(
      p_organization_id,
      p_recipient_user_id,
      'notifications.read_through'::text,
      NULL,
      jsonb_build_object(
        'conversationId', p_conversation_id,
        'readThroughSequence', p_read_through_sequence,
        'updatedCount', updated_count
      ),
      action_time
    );
    current_revision := (state_event ->> 'revision')::bigint;
    current_event := state_event;
  ELSE
    SELECT state.revision, state.last_event
    INTO current_revision, current_event
    FROM public.notification_inbox_states AS state
    WHERE state.organization_id = p_organization_id
      AND state.user_id = p_recipient_user_id;
  END IF;

  RETURN jsonb_build_object(
    'updatedCount', updated_count,
    'conversationId', p_conversation_id,
    'readThroughSequence', p_read_through_sequence,
    'revision', coalesce(current_revision, 0),
    'lastEvent', current_event
  );
END;
$$;

REVOKE ALL ON FUNCTION private.mark_case_message_notifications_read(
  uuid,
  uuid,
  uuid,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;

CREATE OR REPLACE FUNCTION public.mark_staff_case_message_notifications_read(
  p_organization_id uuid,
  p_case_id uuid,
  p_conversation_id uuid,
  p_actor_user_id uuid,
  p_read_through_sequence bigint
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  target_owner_user_id uuid;
  actor_role text;
BEGIN
  IF p_organization_id IS NULL
    OR p_case_id IS NULL
    OR p_conversation_id IS NULL
    OR p_actor_user_id IS NULL
    OR p_read_through_sequence IS NULL
    OR p_read_through_sequence < 0
  THEN
    RAISE EXCEPTION 'invalid_case_message_notification_receipt'
      USING errcode = '22023';
  END IF;

  SELECT crm_case.owner_user_id, membership.role
  INTO target_owner_user_id, actor_role
  FROM public.crm_cases AS crm_case
  JOIN public.crm_case_conversations AS conversation
    ON conversation.organization_id = crm_case.organization_id
   AND conversation.case_id = crm_case.id
   AND conversation.id = p_conversation_id
  JOIN public.organization_memberships AS membership
    ON membership.organization_id = crm_case.organization_id
   AND membership.user_id = p_actor_user_id
  WHERE crm_case.organization_id = p_organization_id
    AND crm_case.id = p_case_id;

  IF NOT FOUND
    OR (
      p_actor_user_id IS DISTINCT FROM target_owner_user_id
      AND actor_role <> 'admin'::text
    )
  THEN
    RAISE EXCEPTION 'staff_case_message_access_denied'
      USING errcode = '42501';
  END IF;

  RETURN private.mark_case_message_notifications_read(
    p_organization_id,
    p_actor_user_id,
    p_conversation_id,
    p_read_through_sequence
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mark_staff_case_message_notifications_read(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.mark_staff_case_message_notifications_read(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint
) TO openexpert_service;

COMMENT ON FUNCTION public.mark_staff_case_message_notifications_read(
  uuid,
  uuid,
  uuid,
  uuid,
  bigint
) IS
  'Marks unread case-message notifications covered by an authorized staff conversation receipt.';
