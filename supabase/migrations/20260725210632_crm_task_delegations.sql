-- Delegated tasks are first-class CRM tasks. The task remains linked to its
-- parent case (and optionally one case item), while delegation has a separate
-- acceptance lifecycle and an immutable activity trail.

alter table public.crm_tasks
  add column delegator_user_id uuid,
  add column delegation_status text not null default 'not_delegated',
  add column data_access_scope text[] not null default array['case_summary']::text[],
  add column delegated_at timestamptz,
  add column responded_at timestamptz,
  add column accepted_at timestamptz,
  add column rejected_at timestamptz,
  add column rejection_reason text,
  add column cancelled_at timestamptz,
  add column idempotency_key uuid,
  add column idempotency_fingerprint text;

alter table public.crm_tasks
  add constraint crm_tasks_organization_delegator_membership_fkey
    foreign key (organization_id, delegator_user_id)
    references public.organization_memberships(organization_id, user_id),
  add constraint crm_tasks_organization_id_id_key
    unique (organization_id, id),
  add constraint crm_tasks_delegation_status_check
    check (delegation_status in (
      'not_delegated',
      'pending',
      'accepted',
      'rejected',
      'cancelled'
    )),
  add constraint crm_tasks_data_access_scope_check
    check (
      cardinality(data_access_scope) between 1 and 7
      and data_access_scope <@ array[
        'case_summary',
        'client_contact',
        'client_identity',
        'documents',
        'offers',
        'financial_data',
        'activities'
      ]::text[]
    ),
  add constraint crm_tasks_delegation_shape_check
    check (
      (
        delegation_status = 'not_delegated'
        and delegator_user_id is null
        and delegated_at is null
        and responded_at is null
        and accepted_at is null
        and rejected_at is null
        and cancelled_at is null
        and rejection_reason is null
        and idempotency_key is null
        and idempotency_fingerprint is null
      )
      or
      (
        delegation_status <> 'not_delegated'
        and delegator_user_id is not null
        and assignee_user_id is not null
        and assignee_user_id <> delegator_user_id
        and case_id is not null
        and due_at is not null
        and delegated_at is not null
        and idempotency_key is not null
        and idempotency_fingerprint is not null
        and idempotency_fingerprint ~ '^[0-9a-f]{64}$'
      )
    ),
  add constraint crm_tasks_delegation_response_check
    check (
      (delegation_status in ('not_delegated', 'pending')
        and responded_at is null
        and accepted_at is null
        and rejected_at is null
        and cancelled_at is null
        and rejection_reason is null)
      or
      (delegation_status = 'accepted'
        and responded_at is not null
        and accepted_at is not null
        and rejected_at is null
        and cancelled_at is null
        and rejection_reason is null)
      or
      (delegation_status = 'rejected'
        and responded_at is not null
        and accepted_at is null
        and rejected_at is not null
        and cancelled_at is null
        and nullif(btrim(rejection_reason), '') is not null)
      or
      (delegation_status = 'cancelled'
        and rejected_at is null
        and cancelled_at is not null
        and rejection_reason is null
        and (
          (accepted_at is null and responded_at is null)
          or (accepted_at is not null and responded_at = accepted_at)
        ))
    ),
  add constraint crm_tasks_delegated_status_code_check
    check (
      delegation_status = 'not_delegated'
      or (delegation_status = 'pending' and status_code = 'open')
      or (
        delegation_status = 'accepted'
        and status_code in ('open', 'in_progress', 'done')
      )
      or (
        delegation_status in ('rejected', 'cancelled')
        and status_code = 'cancelled'
      )
    ),
  add constraint crm_tasks_delegated_completion_check
    check (
      delegation_status = 'not_delegated'
      or (status_code = 'done' and completed_at is not null)
      or (status_code <> 'done' and completed_at is null)
    );

create unique index crm_tasks_delegation_idempotency_key
  on public.crm_tasks(organization_id, delegator_user_id, idempotency_key)
  where idempotency_key is not null;

create index crm_tasks_org_delegator_recent_idx
  on public.crm_tasks(organization_id, delegator_user_id, delegated_at desc)
  where delegation_status <> 'not_delegated';

create index crm_tasks_org_assignee_delegation_due_idx
  on public.crm_tasks(
    organization_id,
    assignee_user_id,
    delegation_status,
    due_at
  )
  where delegation_status <> 'not_delegated';

alter table public.crm_case_items
  add constraint crm_case_items_organization_case_id_key
  unique (organization_id, case_id, id);

alter table public.crm_tasks
  add constraint crm_tasks_organization_case_item_fkey
  foreign key (organization_id, case_id, case_item_id)
  references public.crm_case_items(organization_id, case_id, id)
  on delete cascade;

alter table public.crm_activities
  add column task_id uuid,
  add constraint crm_activities_organization_task_fkey
    foreign key (organization_id, task_id)
    references public.crm_tasks(organization_id, id)
    on delete set null;

create index crm_activities_org_task_created_idx
  on public.crm_activities(organization_id, task_id, created_at desc)
  where task_id is not null;

alter table public.appointments
  add column crm_task_id uuid,
  add constraint appointments_organization_crm_task_fkey
    foreign key (organization_id, crm_task_id)
    references public.crm_tasks(organization_id, id)
    on delete set null;

create index appointments_org_crm_task_start_idx
  on public.appointments(organization_id, crm_task_id, starts_at desc)
  where crm_task_id is not null;

-- Appointment RLS already limits rows to the caller's scoped facilities.
-- The table also needs a SELECT grant for those policies to be reachable
-- through the authenticated Data API used by the task history endpoint.
grant select on table public.appointments to authenticated;

create or replace function private.validate_crm_task_delegation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := (select auth.uid());
begin
  if new.delegation_status = 'not_delegated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if caller_user_id is not null
      and new.delegation_status <> 'pending'
    then
      raise exception 'delegated_task_must_start_pending'
        using errcode = '23514',
              constraint = 'crm_tasks_delegation_initial_status';
    end if;
    new.delegated_at := case
      when caller_user_id is null then coalesce(new.delegated_at, now())
      else now()
    end;
  else
    if old.delegation_status <> 'not_delegated' and (
      new.organization_id is distinct from old.organization_id
      or new.client_id is distinct from old.client_id
      or new.case_id is distinct from old.case_id
      or new.delegator_user_id is distinct from old.delegator_user_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.idempotency_fingerprint is distinct from old.idempotency_fingerprint
    ) then
      raise exception 'delegated_task_identity_is_immutable'
        using errcode = '23514',
              constraint = 'crm_tasks_delegated_identity_immutable';
    end if;

    if new.assignee_user_id is distinct from old.assignee_user_id
      and caller_user_id is not null
      and caller_user_id <> old.delegator_user_id
      and not private.is_organization_admin(old.organization_id)
    then
      raise exception 'task_reassignment_requires_delegator'
        using errcode = '42501';
    end if;

    if new.assignee_user_id is distinct from old.assignee_user_id then
      if old.delegation_status in ('rejected', 'cancelled') then
        raise exception 'resolved_task_cannot_be_reassigned'
          using errcode = '23514',
                constraint = 'crm_tasks_resolved_reassignment';
      end if;
      if old.delegation_status = 'accepted' then
        new.delegation_status := 'pending';
      end if;
      new.delegated_at := case
        when caller_user_id is null then coalesce(new.delegated_at, now())
        else now()
      end;
    end if;

    if caller_user_id is not null
      and caller_user_id = old.assignee_user_id
      and caller_user_id <> old.delegator_user_id
      and not private.is_organization_admin(old.organization_id)
      and (
        new.assignee_user_id is distinct from old.assignee_user_id
        or new.case_item_id is distinct from old.case_item_id
        or new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.priority is distinct from old.priority
        or new.due_at is distinct from old.due_at
        or new.data_access_scope is distinct from old.data_access_scope
        or new.metadata is distinct from old.metadata
        or new.delegated_at is distinct from old.delegated_at
        or new.responded_at is distinct from old.responded_at
        or new.accepted_at is distinct from old.accepted_at
        or new.rejected_at is distinct from old.rejected_at
        or new.cancelled_at is distinct from old.cancelled_at
        or new.completed_at is distinct from old.completed_at
        or (
          old.delegation_status = 'rejected'
          and new.rejection_reason is distinct from old.rejection_reason
        )
      )
    then
      raise exception 'assignee_cannot_change_task_definition'
        using errcode = '42501';
    end if;

    if new.delegation_status is distinct from old.delegation_status then
      if not (
        (old.delegation_status = 'not_delegated' and new.delegation_status = 'pending')
        or (old.delegation_status = 'pending' and new.delegation_status in ('accepted', 'rejected', 'cancelled'))
        or (old.delegation_status = 'accepted' and new.delegation_status = 'cancelled')
        or (
          old.delegation_status = 'accepted'
          and new.delegation_status = 'pending'
          and new.assignee_user_id is distinct from old.assignee_user_id
        )
      ) then
        raise exception 'invalid_task_delegation_transition'
          using errcode = '23514',
                constraint = 'crm_tasks_delegation_transition';
      end if;

      if new.delegation_status in ('accepted', 'rejected')
        and caller_user_id is not null
        and caller_user_id <> old.assignee_user_id
        and not private.is_organization_admin(old.organization_id)
      then
        raise exception 'task_response_requires_assignee'
          using errcode = '42501';
      end if;

      if new.delegation_status = 'cancelled'
        and caller_user_id is not null
        and caller_user_id <> old.delegator_user_id
        and not private.is_organization_admin(old.organization_id)
      then
        raise exception 'task_cancellation_requires_delegator'
          using errcode = '42501';
      end if;
    end if;
  end if;

  case new.delegation_status
    when 'pending' then
      new.responded_at := null;
      new.accepted_at := null;
      new.rejected_at := null;
      new.cancelled_at := null;
      new.rejection_reason := null;
      new.status_code := 'open';
    when 'accepted' then
      if tg_op = 'INSERT'
        or old.delegation_status is distinct from new.delegation_status
      then
        new.accepted_at := case
          when caller_user_id is null
            then coalesce(new.accepted_at, new.responded_at, now())
          else now()
        end;
      end if;
      new.responded_at := new.accepted_at;
      new.rejected_at := null;
      new.cancelled_at := null;
      new.rejection_reason := null;
    when 'rejected' then
      if nullif(btrim(new.rejection_reason), '') is null then
        raise exception 'task_rejection_reason_required'
          using errcode = '23514',
                constraint = 'crm_tasks_rejection_reason_required';
      end if;
      if tg_op = 'INSERT'
        or old.delegation_status is distinct from new.delegation_status
      then
        new.rejected_at := case
          when caller_user_id is null
            then coalesce(new.rejected_at, new.responded_at, now())
          else now()
        end;
      end if;
      new.responded_at := new.rejected_at;
      new.accepted_at := null;
      new.cancelled_at := null;
      new.status_code := 'cancelled';
      new.completed_at := null;
    when 'cancelled' then
      if tg_op = 'INSERT'
        or old.delegation_status is distinct from new.delegation_status
      then
        new.cancelled_at := case
          when caller_user_id is null then coalesce(new.cancelled_at, now())
          else now()
        end;
      end if;
      new.responded_at := case
        when new.accepted_at is not null then new.accepted_at
        else null
      end;
      new.rejected_at := null;
      new.rejection_reason := null;
      new.status_code := 'cancelled';
      new.completed_at := null;
    else
      null;
  end case;

  if new.status_code = 'done' then
    if new.delegation_status <> 'accepted' then
      raise exception 'only_accepted_task_can_be_completed'
        using errcode = '23514',
              constraint = 'crm_tasks_completion_requires_acceptance';
    end if;
    new.completed_at := coalesce(new.completed_at, now());
  elsif tg_op = 'UPDATE' and old.status_code = 'done' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_crm_task_delegation()
from public, anon, authenticated;

drop trigger if exists crm_tasks_validate_delegation
  on public.crm_tasks;
create trigger crm_tasks_validate_delegation
  before insert or update on public.crm_tasks
  for each row execute function private.validate_crm_task_delegation();

create or replace function private.record_crm_task_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_actor_user_id uuid;
  audit_payload jsonb;
begin
  audit_actor_user_id := coalesce(
    (select auth.uid()),
    new.delegator_user_id,
    new.assignee_user_id
  );
  audit_payload := jsonb_build_object(
    'task_id', new.id,
    'delegator_user_id', new.delegator_user_id,
    'assignee_user_id', new.assignee_user_id,
    'delegation_status', new.delegation_status,
    'status_code', new.status_code,
    'due_at', new.due_at,
    'data_access_scope', to_jsonb(new.data_access_scope)
  );

  if tg_op = 'INSERT' and new.delegation_status <> 'not_delegated' then
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
      payload,
      created_at
    )
    values (
      new.organization_id,
      audit_actor_user_id,
      new.client_id,
      new.case_id,
      new.case_item_id,
      new.id,
      'task_delegated',
      'Delegowano zadanie',
      new.title,
      audit_payload,
      new.delegated_at
    );

    if new.delegation_status = 'accepted' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, new.assignee_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_delegation_accepted',
        'Przyjęto delegowane zadanie', new.title, audit_payload, new.accepted_at
      );
    elsif new.delegation_status = 'rejected' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, new.assignee_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_delegation_rejected',
        'Odrzucono delegowane zadanie', new.rejection_reason,
        audit_payload || jsonb_build_object('reason', new.rejection_reason),
        new.rejected_at
      );
    elsif new.delegation_status = 'cancelled' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, audit_actor_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_delegation_cancelled',
        'Anulowano delegowane zadanie', new.title, audit_payload, new.cancelled_at
      );
    end if;

    if new.status_code = 'done' then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload, created_at
      )
      values (
        new.organization_id, new.assignee_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_completed',
        'Zakończono delegowane zadanie', new.title, audit_payload, new.completed_at
      );
    end if;

    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.assignee_user_id is distinct from old.assignee_user_id then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload
      )
      values (
        new.organization_id, audit_actor_user_id, new.client_id, new.case_id,
        new.case_item_id, new.id, 'task_reassigned',
        'Przekazano zadanie innej osobie', new.title,
        audit_payload || jsonb_build_object(
          'previous_assignee_user_id', old.assignee_user_id
        )
      );
    end if;

    if new.delegation_status is distinct from old.delegation_status then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload
      )
      values (
        new.organization_id,
        audit_actor_user_id,
        new.client_id,
        new.case_id,
        new.case_item_id,
        new.id,
        case new.delegation_status
          when 'accepted' then 'task_delegation_accepted'
          when 'rejected' then 'task_delegation_rejected'
          when 'cancelled' then 'task_delegation_cancelled'
          else 'task_delegation_changed'
        end,
        case new.delegation_status
          when 'accepted' then 'Przyjęto delegowane zadanie'
          when 'rejected' then 'Odrzucono delegowane zadanie'
          when 'cancelled' then 'Anulowano delegowane zadanie'
          else 'Zmieniono delegację zadania'
        end,
        case
          when new.delegation_status = 'rejected' then new.rejection_reason
          else new.title
        end,
        audit_payload || jsonb_build_object(
          'previous_delegation_status', old.delegation_status,
          'reason', new.rejection_reason
        )
      );
    end if;

    if new.status_code is distinct from old.status_code then
      insert into public.crm_activities (
        organization_id, actor_user_id, client_id, case_id, case_item_id,
        task_id, activity_type, title, body, payload
      )
      values (
        new.organization_id,
        audit_actor_user_id,
        new.client_id,
        new.case_id,
        new.case_item_id,
        new.id,
        case when new.status_code = 'done'
          then 'task_completed'
          else 'task_status_changed'
        end,
        case when new.status_code = 'done'
          then 'Zakończono delegowane zadanie'
          else 'Zmieniono status delegowanego zadania'
        end,
        new.title,
        audit_payload || jsonb_build_object(
          'previous_status_code', old.status_code
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.record_crm_task_audit()
from public, anon, authenticated;

drop trigger if exists crm_tasks_record_audit
  on public.crm_tasks;
create trigger crm_tasks_record_audit
  after insert or update on public.crm_tasks
  for each row execute function private.record_crm_task_audit();

-- Replace permissive "all" policies so only the delegator, assignee or an
-- organization admin can mutate a delegated task. Every organization member
-- may still see the task in the shared case timeline.
drop policy if exists crm_tasks_organization_members
  on public.crm_tasks;
drop policy if exists "crm tasks are scoped to org"
  on public.crm_tasks;
drop policy if exists "crm tasks can be inserted in org"
  on public.crm_tasks;
drop policy if exists "crm tasks can be updated in org"
  on public.crm_tasks;
drop policy if exists "crm tasks can be deleted in org"
  on public.crm_tasks;

create policy "organization members can view crm tasks"
  on public.crm_tasks
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy "organization members can create crm tasks"
  on public.crm_tasks
  for insert to authenticated
  with check (
    private.is_organization_member(organization_id)
    and (
      delegation_status = 'not_delegated'
      or delegator_user_id = (select auth.uid())
    )
  );

create policy "task participants can update crm tasks"
  on public.crm_tasks
  for update to authenticated
  using (
    private.is_organization_member(organization_id)
    and (
      delegation_status = 'not_delegated'
      or delegator_user_id = (select auth.uid())
      or assignee_user_id = (select auth.uid())
      or private.is_organization_admin(organization_id)
    )
  )
  with check (
    private.is_organization_member(organization_id)
    and (
      delegation_status = 'not_delegated'
      or delegator_user_id = (select auth.uid())
      or assignee_user_id = (select auth.uid())
      or private.is_organization_admin(organization_id)
    )
  );

create policy "organization members can delete non delegated crm tasks"
  on public.crm_tasks
  for delete to authenticated
  using (
    private.is_organization_member(organization_id)
    and delegation_status = 'not_delegated'
  );

-- Task audit rows are append-only for authenticated Data API clients. Service
-- role remains able to maintain fixtures and execute administrative recovery.
drop policy if exists crm_activities_organization_members
  on public.crm_activities;
drop policy if exists "crm activities are scoped to org"
  on public.crm_activities;
drop policy if exists "crm activities can be inserted in org"
  on public.crm_activities;
drop policy if exists "crm activities can be updated in org"
  on public.crm_activities;
drop policy if exists "crm activities can be deleted in org"
  on public.crm_activities;

create policy "organization members can view crm activities"
  on public.crm_activities
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy "organization members can create crm activities"
  on public.crm_activities
  for insert to authenticated
  with check (
    private.is_organization_member(organization_id)
    and task_id is null
  );

create policy "organization members can update non audit activities"
  on public.crm_activities
  for update to authenticated
  using (
    private.is_organization_member(organization_id)
    and task_id is null
  )
  with check (
    private.is_organization_member(organization_id)
    and task_id is null
  );

create policy "organization members can delete non audit activities"
  on public.crm_activities
  for delete to authenticated
  using (
    private.is_organization_member(organization_id)
    and task_id is null
  );

comment on column public.crm_tasks.delegation_status is
  'Acceptance lifecycle independent from task execution status_code.';
comment on column public.crm_tasks.data_access_scope is
  'Explicit categories of case data shared for this delegated task.';
comment on column public.crm_tasks.idempotency_key is
  'Client-generated UUID used to safely retry task creation.';
comment on column public.crm_activities.task_id is
  'Direct link to a delegated task for the complete case/task audit timeline.';
comment on column public.appointments.crm_task_id is
  'Optional delegated task context for meetings shown in the task history.';
