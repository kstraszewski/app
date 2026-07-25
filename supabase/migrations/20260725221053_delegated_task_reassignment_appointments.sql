-- A future meeting belongs to the expert selected when it was booked. If the
-- task is reassigned, cancel that meeting in the same transaction rather than
-- leaving a confirmed appointment attached to the previous expert.
create or replace function private.cancel_future_delegated_task_appointments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancellation_actor_user_id uuid;
  cancelled_appointment public.appointments;
  task_cancellation_reason text;
  cancellation_title text;
  is_reassignment boolean;
  is_terminal_transition boolean;
begin
  is_reassignment :=
    new.assignee_user_id is distinct from old.assignee_user_id;
  is_terminal_transition :=
    new.delegation_status is distinct from old.delegation_status
    and new.delegation_status in ('rejected', 'cancelled');

  if not is_reassignment and not is_terminal_transition then
    return new;
  end if;

  if is_reassignment then
    task_cancellation_reason := 'delegated_task_reassigned';
    cancellation_title := 'Anulowano spotkanie po zmianie wykonawcy zadania';
  elsif new.delegation_status = 'rejected' then
    task_cancellation_reason := 'delegated_task_rejected';
    cancellation_title := 'Anulowano spotkanie po odrzuceniu zadania';
  else
    task_cancellation_reason := 'delegated_task_cancelled';
    cancellation_title := 'Anulowano spotkanie powiązane z zadaniem';
  end if;

  cancellation_actor_user_id := coalesce(
    (select auth.uid()),
    case
      when new.delegation_status = 'rejected' and not is_reassignment
        then new.assignee_user_id
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
      cancellation_title,
      new.title,
      jsonb_build_object(
        'task_id', new.id,
        'appointment_id', cancelled_appointment.id,
        'appointment_starts_at', cancelled_appointment.starts_at,
        'appointment_ends_at', cancelled_appointment.ends_at,
        'previous_assignee_user_id', old.assignee_user_id,
        'assignee_user_id', new.assignee_user_id,
        'reason', task_cancellation_reason
      )
    );
  end loop;

  return new;
end;
$$;

revoke all on function private.cancel_future_delegated_task_appointments()
from public, anon, authenticated, service_role;

drop trigger if exists crm_tasks_cancel_future_appointments
  on public.crm_tasks;
create trigger crm_tasks_cancel_future_appointments
  after update of delegation_status, assignee_user_id on public.crm_tasks
  for each row execute function private.cancel_future_delegated_task_appointments();
