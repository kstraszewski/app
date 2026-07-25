-- Creating a delegated task together with an optional appointment is one
-- database transaction. The public function is deliberately service-role
-- only: the authenticated endpoint performs user-facing authorization first,
-- while this function owns concurrency, idempotency and rollback semantics.
create function public.create_delegated_crm_task(p_request jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  request_organization_id uuid;
  request_case_id uuid;
  request_case_item_id uuid;
  request_delegator_user_id uuid;
  request_assignee_user_id uuid;
  request_title text;
  request_description text;
  request_due_at timestamptz;
  request_priority text;
  request_data_access_scope text[];
  request_idempotency_key uuid;
  request_fingerprint text;
  request_appointment jsonb;
  request_has_appointment boolean;
  request_facility_id uuid;
  request_service_id uuid;
  request_client_person_id uuid;
  request_starts_at timestamptz;
  request_meeting_mode text;
  request_meeting_url text;
  request_appointment_notes text;
  target_client_id uuid;
  target_task public.crm_tasks;
  target_appointment_id uuid;
  booking_result jsonb;
  appointment_idempotency_key text;
begin
  if p_request is null or jsonb_typeof(p_request) <> 'object' then
    raise exception 'invalid_delegated_task_request' using errcode = '22023';
  end if;

  begin
    request_organization_id := nullif(p_request ->> 'organization_id', '')::uuid;
    request_case_id := nullif(p_request ->> 'case_id', '')::uuid;
    request_case_item_id := nullif(p_request ->> 'case_item_id', '')::uuid;
    request_delegator_user_id := nullif(p_request ->> 'delegator_user_id', '')::uuid;
    request_assignee_user_id := nullif(p_request ->> 'assignee_user_id', '')::uuid;
    request_title := nullif(btrim(p_request ->> 'title'), '');
    request_description := nullif(btrim(p_request ->> 'description'), '');
    request_due_at := nullif(p_request ->> 'due_at', '')::timestamptz;
    request_priority := coalesce(nullif(p_request ->> 'priority', ''), 'normal');
    request_idempotency_key := nullif(p_request ->> 'idempotency_key', '')::uuid;
    request_fingerprint := lower(nullif(p_request ->> 'idempotency_fingerprint', ''));

    if jsonb_typeof(p_request -> 'data_access_scope') <> 'array' then
      raise exception 'invalid_delegated_task_request' using errcode = '22023';
    end if;
    select coalesce(array_agg(scope.value order by scope.value), array[]::text[])
    into request_data_access_scope
    from jsonb_array_elements_text(p_request -> 'data_access_scope') scope(value);
  exception
    when invalid_text_representation
      or datetime_field_overflow
      or invalid_datetime_format
      or data_exception
    then
      raise exception 'invalid_delegated_task_request' using errcode = '22023';
  end;

  if request_organization_id is null
     or request_case_id is null
     or request_delegator_user_id is null
     or request_assignee_user_id is null
     or request_assignee_user_id = request_delegator_user_id
     or request_title is null
     or length(request_title) > 180
     or (request_description is not null and length(request_description) > 4000)
     or request_due_at is null
     or request_priority not in ('low', 'normal', 'high', 'urgent')
     or cardinality(request_data_access_scope) not between 1 and 7
     or not (
       request_data_access_scope <@ array[
         'case_summary',
         'client_contact',
         'client_identity',
         'documents',
         'offers',
         'financial_data',
         'activities'
       ]::text[]
     )
     or cardinality(request_data_access_scope)
       <> cardinality(array(select distinct unnest(request_data_access_scope)))
     or request_idempotency_key is null
     or request_fingerprint is null
     or request_fingerprint !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_delegated_task_request' using errcode = '22023';
  end if;

  select crm_case.client_id
  into target_client_id
  from public.crm_cases crm_case
  where crm_case.organization_id = request_organization_id
    and crm_case.id = request_case_id;

  if not found then
    raise exception 'crm_case_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = request_organization_id
      and membership.user_id = request_delegator_user_id
  ) or not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = request_organization_id
      and membership.user_id = request_assignee_user_id
  ) then
    raise exception 'delegated_task_organization_membership_required'
      using errcode = '23503';
  end if;

  if request_case_item_id is not null and not exists (
    select 1
    from public.crm_case_items case_item
    where case_item.organization_id = request_organization_id
      and case_item.case_id = request_case_id
      and case_item.id = request_case_item_id
  ) then
    raise exception 'delegated_task_case_item_not_found' using errcode = '23503';
  end if;

  request_appointment := p_request -> 'appointment';
  request_has_appointment := request_appointment is not null
    and request_appointment <> 'null'::jsonb;

  if request_has_appointment then
    if jsonb_typeof(request_appointment) <> 'object' then
      raise exception 'invalid_delegated_task_appointment' using errcode = '22023';
    end if;

    begin
      request_facility_id :=
        nullif(request_appointment ->> 'facility_id', '')::uuid;
      request_service_id :=
        nullif(request_appointment ->> 'service_id', '')::uuid;
      request_client_person_id :=
        nullif(request_appointment ->> 'client_person_id', '')::uuid;
      request_starts_at :=
        nullif(request_appointment ->> 'starts_at', '')::timestamptz;
      request_meeting_mode := coalesce(
        nullif(request_appointment ->> 'meeting_mode', ''),
        'office'
      );
      request_meeting_url :=
        nullif(btrim(request_appointment ->> 'meeting_url'), '');
      request_appointment_notes :=
        nullif(btrim(request_appointment ->> 'notes'), '');
    exception
      when invalid_text_representation
        or datetime_field_overflow
        or invalid_datetime_format
        or data_exception
      then
        raise exception 'invalid_delegated_task_appointment' using errcode = '22023';
    end;

    if request_facility_id is null
       or request_service_id is null
       or request_starts_at is null
       or request_meeting_mode not in ('office', 'online')
    then
      raise exception 'invalid_delegated_task_appointment' using errcode = '22023';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'openexpert-delegated-task:' || request_organization_id::text || ':'
      || request_delegator_user_id::text || ':'
      || request_idempotency_key::text,
    0
  ));

  select task.*
  into target_task
  from public.crm_tasks task
  where task.organization_id = request_organization_id
    and task.delegator_user_id = request_delegator_user_id
    and task.idempotency_key = request_idempotency_key;

  if found then
    if target_task.idempotency_fingerprint is distinct from request_fingerprint then
      raise exception 'delegated_task_idempotency_key_reused'
        using errcode = '23505';
    end if;

    if request_has_appointment then
      appointment_idempotency_key :=
        'delegated-task:' || request_idempotency_key::text;
      select appointment.id
      into target_appointment_id
      from public.appointments appointment
      where appointment.organization_id = request_organization_id
        and appointment.crm_task_id = target_task.id
        and appointment.created_by_user_id = request_delegator_user_id
        and appointment.idempotency_key = appointment_idempotency_key;

      if not found then
        raise exception 'invalid_delegated_task_replay_request'
          using errcode = '23514';
      end if;
    end if;

    return jsonb_build_object(
      'taskId', target_task.id,
      'appointmentId', target_appointment_id,
      'created', false
    );
  end if;

  insert into public.crm_tasks (
    organization_id,
    delegator_user_id,
    assignee_user_id,
    client_id,
    case_id,
    case_item_id,
    title,
    description,
    status_code,
    delegation_status,
    priority,
    due_at,
    data_access_scope,
    idempotency_key,
    idempotency_fingerprint,
    metadata
  ) values (
    request_organization_id,
    request_delegator_user_id,
    request_assignee_user_id,
    target_client_id,
    request_case_id,
    request_case_item_id,
    request_title,
    request_description,
    'open',
    'pending',
    request_priority,
    request_due_at,
    request_data_access_scope,
    request_idempotency_key,
    request_fingerprint,
    jsonb_build_object(
      'source', 'manual_delegation',
      'appointment_created_with_task', request_has_appointment
    )
  )
  returning * into target_task;

  if request_has_appointment then
    appointment_idempotency_key :=
      'delegated-task:' || request_idempotency_key::text;
    booking_result := public.create_staff_appointment(
      request_organization_id,
      request_facility_id,
      request_service_id,
      request_assignee_user_id,
      target_client_id,
      request_client_person_id,
      request_starts_at,
      request_appointment_notes,
      request_delegator_user_id,
      appointment_idempotency_key,
      request_meeting_mode,
      request_meeting_url
    );
    target_appointment_id :=
      nullif(booking_result #>> '{appointment,id}', '')::uuid;

    if target_appointment_id is null then
      raise exception 'delegated_task_appointment_was_not_created'
        using errcode = 'P0001';
    end if;

    update public.appointments appointment
    set crm_task_id = target_task.id
    where appointment.organization_id = request_organization_id
      and appointment.id = target_appointment_id
      and appointment.expert_user_id = request_assignee_user_id
      and appointment.client_id = target_client_id;

    if not found then
      raise exception 'delegated_task_appointment_link_failed'
        using errcode = 'P0001';
    end if;
  end if;

  return jsonb_build_object(
    'taskId', target_task.id,
    'appointmentId', target_appointment_id,
    'created', true
  );
end;
$$;

revoke all on function public.create_delegated_crm_task(jsonb)
from public, anon, authenticated;
grant execute on function public.create_delegated_crm_task(jsonb)
to service_role;

-- Rejecting or cancelling a delegation also cancels every future appointment
-- linked to it. Appointment triggers release the expert reservation and enqueue
-- the cancellation event inside the same transaction. The additional activity
-- gives the case history an explicit explanation of the released meeting.
create function private.cancel_future_delegated_task_appointments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancellation_actor_user_id uuid;
  cancelled_appointment public.appointments;
  task_cancellation_reason text;
begin
  if new.delegation_status is not distinct from old.delegation_status
     or new.delegation_status not in ('rejected', 'cancelled')
  then
    return new;
  end if;

  task_cancellation_reason := case new.delegation_status
    when 'rejected' then 'delegated_task_rejected'
    else 'delegated_task_cancelled'
  end;
  cancellation_actor_user_id := coalesce(
    (select auth.uid()),
    case
      when new.delegation_status = 'rejected' then new.assignee_user_id
      else new.delegator_user_id
    end,
    new.delegator_user_id,
    new.assignee_user_id
  );

  for cancelled_appointment in
    update public.appointments appointment
    set
      status = 'cancelled',
      hold_expires_at = null,
      cancelled_at = now(),
      cancellation_reason = task_cancellation_reason,
      updated_at = now()
    where appointment.organization_id = new.organization_id
      and appointment.crm_task_id = new.id
      and appointment.status in ('hold', 'confirmed')
      and appointment.starts_at > now()
    returning appointment.*
  loop
    insert into public.crm_activities (
      organization_id,
      actor_user_id,
      client_id,
      case_id,
      case_item_id,
      task_id,
      activity_type,
      title,
      body,
      payload
    ) values (
      new.organization_id,
      cancellation_actor_user_id,
      new.client_id,
      new.case_id,
      new.case_item_id,
      new.id,
      'task_appointment_cancelled',
      'Anulowano spotkanie powiązane z zadaniem',
      new.title,
      jsonb_build_object(
        'task_id', new.id,
        'appointment_id', cancelled_appointment.id,
        'appointment_starts_at', cancelled_appointment.starts_at,
        'appointment_ends_at', cancelled_appointment.ends_at,
        'reason', task_cancellation_reason
      )
    );
  end loop;

  return new;
end;
$$;

revoke all on function private.cancel_future_delegated_task_appointments()
from public, anon, authenticated, service_role;

create trigger crm_tasks_cancel_future_appointments
  after update of delegation_status on public.crm_tasks
  for each row execute function private.cancel_future_delegated_task_appointments();

comment on function public.create_delegated_crm_task(jsonb) is
  'Atomically creates an idempotent delegated CRM task and optional staff appointment.';
