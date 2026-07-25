begin;

-- Supabase's default table grants are broader than the product API needs.
-- Keep identity data readable only through its RLS policies and reserve all
-- administrative operations for the service role.
revoke all privileges on table public.profiles
from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name, locale)
on table public.profiles to authenticated;
grant all privileges on table public.profiles to service_role;

revoke all privileges on table public.client_account_links
from public, anon, authenticated;

grant select on table public.client_account_links to authenticated;
grant all privileges on table public.client_account_links to service_role;

-- Task audit events are valid activity context on their own. The previous
-- constraint predated crm_activities.task_id and rejected standalone task
-- audit rows.
alter table public.crm_activities
  drop constraint if exists crm_activities_check;

alter table public.crm_activities
  add constraint crm_activities_has_context_check
  check (
    num_nonnulls(
      client_id,
      case_id,
      case_item_id,
      submission_id,
      task_id
    ) >= 1
  ) not valid;

alter table public.crm_activities
  validate constraint crm_activities_has_context_check;

-- Preserve the legacy status rules for ordinary CRM tasks. Actor enforcement
-- applies only after a task enters the delegation lifecycle.
create or replace function private.guard_delegated_task_status_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid := (select auth.uid());
  is_terminal_delegation_transition boolean;
begin
  if old.delegation_status = 'not_delegated'
    and new.delegation_status = 'not_delegated'
  then
    return new;
  end if;

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

commit;
