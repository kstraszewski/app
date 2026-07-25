-- RLS permits both task participants to update the row so they can handle
-- their respective delegation actions. Keep execution status ownership
-- narrower: only the current assignee (or an organization admin) may change
-- status_code directly. A delegator can still reject/cancel through the
-- delegation lifecycle; the main validation trigger derives status_code for
-- those transitions after this guard runs.
create function private.guard_delegated_task_status_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := (select auth.uid());
  is_terminal_delegation_transition boolean;
begin
  if caller_user_id is null
     or new.status_code is not distinct from old.status_code
     or caller_user_id = old.assignee_user_id
     or private.is_organization_admin(old.organization_id)
  then
    return new;
  end if;

  is_terminal_delegation_transition :=
    new.delegation_status is distinct from old.delegation_status
    and new.delegation_status in ('rejected', 'cancelled');

  if not is_terminal_delegation_transition then
    raise exception 'task_status_update_requires_assignee'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_delegated_task_status_actor()
from public, anon, authenticated, service_role;

-- Trigger names define order for triggers with the same timing. "guard" sorts
-- before "validate", so a response update that only changes
-- delegation_status is allowed and validate_crm_task_delegation may then derive
-- status_code = cancelled.
create trigger crm_tasks_guard_status_actor
  before update of status_code, delegation_status on public.crm_tasks
  for each row execute function private.guard_delegated_task_status_actor();
