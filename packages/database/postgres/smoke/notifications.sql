\set ON_ERROR_STOP on

-- Run after 0019_notifications.sql in the same transaction. The smoke test
-- intentionally leaves transaction ownership (BEGIN/ROLLBACK) to the caller,
-- so a migration can be validated without changing the local database.

WITH eligible_organization AS (
  SELECT
    membership.organization_id,
    array_agg(membership.user_id ORDER BY membership.user_id) AS user_ids
  FROM public.organization_memberships AS membership
  GROUP BY membership.organization_id
  HAVING count(*) >= 2
  ORDER BY membership.organization_id
  LIMIT 1
)
SELECT
  organization_id::text AS smoke_organization_id,
  user_ids[1]::text AS smoke_recipient_user_id,
  user_ids[2]::text AS smoke_other_user_id,
  gen_random_uuid()::text AS smoke_run_id
FROM eligible_organization
\gset

SELECT
  set_config('app.smoke.organization_id', :'smoke_organization_id', true),
  set_config('app.smoke.recipient_user_id', :'smoke_recipient_user_id', true),
  set_config('app.smoke.other_user_id', :'smoke_other_user_id', true),
  set_config('app.smoke.run_id', :'smoke_run_id', true);

RESET ROLE;
SET LOCAL ROLE openexpert_service;

SELECT (
  public.create_staff_notification_event(jsonb_build_object(
    'organizationId', :'smoke_organization_id',
    'recipientUserId', :'smoke_recipient_user_id',
    'eventType', 'smoke.notification.created',
    'dedupeKey', 'smoke:' || :'smoke_run_id',
    'payload', jsonb_build_object(
      'label', 'bounded smoke payload',
      'caseId', :'smoke_run_id'
    ),
    'priority', 'high',
    'actorUserId', :'smoke_other_user_id',
    'subjectType', 'smoke_subject',
    'subjectId', :'smoke_run_id'
  )) ->> 'notificationId'
) AS smoke_notification_id
\gset

-- An exact replay must return the existing inbox entry, not create a second
-- event, notification or delivery job.
SELECT (
  public.create_staff_notification_event(jsonb_build_object(
    'organizationId', :'smoke_organization_id',
    'recipientUserId', :'smoke_recipient_user_id',
    'eventType', 'smoke.notification.created',
    'dedupeKey', 'smoke:' || :'smoke_run_id',
    'payload', jsonb_build_object(
      'label', 'bounded smoke payload',
      'caseId', :'smoke_run_id'
    ),
    'priority', 'high',
    'actorUserId', :'smoke_other_user_id',
    'subjectType', 'smoke_subject',
    'subjectId', :'smoke_run_id'
  )) ->> 'notificationId'
) AS smoke_replayed_notification_id
\gset

SELECT
  set_config('app.smoke.notification_id', :'smoke_notification_id', true),
  set_config(
    'app.smoke.replayed_notification_id',
    :'smoke_replayed_notification_id',
    true
  );

DO $smoke$
DECLARE
  event_count integer;
  inbox_count integer;
  delivery_count integer;
BEGIN
  IF current_setting('app.smoke.notification_id') IS DISTINCT FROM
    current_setting('app.smoke.replayed_notification_id')
  THEN
    RAISE EXCEPTION 'notification replay returned another inbox entry';
  END IF;

  SELECT count(*) INTO event_count
  FROM public.notification_events AS event
  WHERE event.organization_id = current_setting('app.smoke.organization_id')::uuid;

  SELECT count(*) INTO inbox_count
  FROM public.user_notifications AS notification
  WHERE notification.organization_id = current_setting('app.smoke.organization_id')::uuid;

  SELECT count(*) INTO delivery_count
  FROM public.notification_delivery_jobs AS job
  WHERE job.organization_id = current_setting('app.smoke.organization_id')::uuid;

  IF event_count <> 1 OR inbox_count <> 1 OR delivery_count <> 1 THEN
    RAISE EXCEPTION
      'notification replay was not idempotent: events=%, inbox=%, jobs=%',
      event_count,
      inbox_count,
      delivery_count;
  END IF;

  BEGIN
    PERFORM public.create_staff_notification_event(jsonb_build_object(
      'organizationId', current_setting('app.smoke.organization_id'),
      'recipientUserId', current_setting('app.smoke.recipient_user_id'),
      'eventType', 'smoke.notification.created',
      'dedupeKey', 'smoke:' || current_setting('app.smoke.run_id'),
      'payload', jsonb_build_object('label', 'conflicting payload'),
      'priority', 'high',
      'actorUserId', current_setting('app.smoke.other_user_id'),
      'subjectType', 'smoke_subject',
      'subjectId', current_setting('app.smoke.run_id')
    ));
    RAISE EXCEPTION 'conflicting notification replay was accepted';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
END
$smoke$;

SELECT app.set_request_context(:'smoke_recipient_user_id'::uuid);
SET LOCAL ROLE authenticated;

DO $smoke$
DECLARE
  feed jsonb;
  read_result jsonb;
  repeated_read_result jsonb;
  visible_count integer;
BEGIN
  feed := public.get_my_notification_feed(
    current_setting('app.smoke.organization_id')::uuid,
    30,
    NULL,
    NULL,
    false
  );

  IF jsonb_array_length(feed -> 'items') <> 1
    OR (feed ->> 'unreadCount')::integer <> 1
    OR (feed ->> 'revision')::bigint <> 1
  THEN
    RAISE EXCEPTION 'recipient feed has an invalid initial state: %', feed;
  END IF;

  SELECT count(*) INTO visible_count
  FROM public.user_notifications;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'recipient RLS returned % inbox rows', visible_count;
  END IF;

  BEGIN
    EXECUTE 'SELECT count(*) FROM public.notification_events';
    RAISE EXCEPTION 'authenticated role can read raw notification events';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    EXECUTE format(
      'UPDATE public.user_notifications SET read_at = NULL WHERE id = %L',
      current_setting('app.smoke.notification_id')
    );
    RAISE EXCEPTION 'authenticated role can mutate notification tables directly';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  read_result := public.mark_notification_read(
    current_setting('app.smoke.organization_id')::uuid,
    current_setting('app.smoke.notification_id')::uuid
  );
  repeated_read_result := public.mark_notification_read(
    current_setting('app.smoke.organization_id')::uuid,
    current_setting('app.smoke.notification_id')::uuid
  );

  IF (read_result ->> 'changed')::boolean IS NOT TRUE
    OR (repeated_read_result ->> 'changed')::boolean IS NOT FALSE
    OR read_result ->> 'readAt' IS DISTINCT FROM repeated_read_result ->> 'readAt'
  THEN
    RAISE EXCEPTION
      'notification read is not monotonic: first=%, replay=%',
      read_result,
      repeated_read_result;
  END IF;
END
$smoke$;

RESET ROLE;
SET LOCAL ROLE openexpert_service;
SELECT app.set_request_context(:'smoke_other_user_id'::uuid);
SET LOCAL ROLE authenticated;

DO $smoke$
DECLARE
  other_feed jsonb;
  visible_count integer;
BEGIN
  other_feed := public.get_my_notification_feed(
    current_setting('app.smoke.organization_id')::uuid,
    30,
    NULL,
    NULL,
    false
  );
  SELECT count(*) INTO visible_count
  FROM public.user_notifications;

  IF jsonb_array_length(other_feed -> 'items') <> 0
    OR visible_count <> 0
  THEN
    RAISE EXCEPTION
      'notification inbox leaked between organization members: feed=%, rows=%',
      other_feed,
      visible_count;
  END IF;
END
$smoke$;

RESET ROLE;
SET LOCAL ROLE openexpert_service;

SELECT (
  public.create_staff_notification_event(jsonb_build_object(
    'organizationId', :'smoke_organization_id',
    'recipientUserId', :'smoke_recipient_user_id',
    'eventType', 'smoke.notification.future',
    'dedupeKey', 'smoke-future:' || :'smoke_run_id',
    'payload', jsonb_build_object('label', 'future watermark guard'),
    'priority', 'normal',
    'subjectType', 'smoke_subject',
    'subjectId', :'smoke_run_id',
    'occurredAt', statement_timestamp() + interval '1 hour'
  )) ->> 'notificationId'
) AS smoke_future_notification_id
\gset

SELECT set_config(
  'app.smoke.future_notification_id',
  :'smoke_future_notification_id',
  true
);

SELECT app.set_request_context(:'smoke_recipient_user_id'::uuid);
SET LOCAL ROLE authenticated;

DO $smoke$
DECLARE
  result jsonb;
  future_is_unread boolean;
BEGIN
  result := public.mark_notifications_read_through(
    current_setting('app.smoke.organization_id')::uuid,
    statement_timestamp() + interval '2 hours'
  );

  SELECT notification.read_at IS NULL
  INTO future_is_unread
  FROM public.user_notifications AS notification
  WHERE notification.id = current_setting('app.smoke.future_notification_id')::uuid;

  IF (result ->> 'throughAt')::timestamp with time zone > transaction_timestamp()
    OR (result ->> 'updatedCount')::integer <> 0
    OR future_is_unread IS NOT TRUE
  THEN
    RAISE EXCEPTION
      'read-through watermark covered a future notification: result=%, unread=%',
      result,
      future_is_unread;
  END IF;
END
$smoke$;

RESET ROLE;
SET LOCAL ROLE openexpert_service;

DO $smoke$
DECLARE
  claimed_job public.notification_delivery_jobs%rowtype;
  claimed_count integer := 0;
  claimed_summary text := '';
  completion jsonb;
BEGIN
  FOR claimed_job IN
    SELECT *
    FROM public.claim_notification_delivery_jobs(
      'notification-smoke-worker',
      10,
      interval '30 seconds'
    )
  LOOP
    claimed_count := claimed_count + 1;
    claimed_summary := claimed_summary || format(
      '%s:%s:%s;',
      claimed_job.event_type,
      claimed_job.available_at,
      claimed_job.id
    );
    IF claimed_job.status <> 'processing'
      OR claimed_job.attempts <> 1
      OR claimed_job.locked_by <> 'notification-smoke-worker'
      OR (claimed_job.payload ->> 'revision')::bigint < 1
    THEN
      RAISE EXCEPTION 'claimed notification job has invalid lease: %', row_to_json(claimed_job);
    END IF;

    completion := public.complete_notification_delivery_job(
      claimed_job.id,
      'notification-smoke-worker',
      true,
      NULL,
      interval '0 seconds',
      'smoke',
      claimed_job.id::text
    );
    IF completion ->> 'status' <> 'completed' THEN
      RAISE EXCEPTION 'notification delivery did not complete: %', completion;
    END IF;
  END LOOP;

  -- Delivery is scheduled at commit time even when the logical occurredAt is
  -- in the future; occurredAt controls inbox ordering, not outbox readiness.
  IF claimed_count <> 3 THEN
    RAISE EXCEPTION
      'worker claimed % ready jobs instead of 3: %',
      claimed_count,
      claimed_summary;
  END IF;
END
$smoke$;

SELECT 'ok durable tenant-safe notifications' AS smoke_result;
