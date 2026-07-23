create or replace function private.is_team_admin(
  target_organization_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organization_admin(target_organization_id);
$$;

comment on function private.is_team_admin(uuid, uuid) is
  'Compatibility helper. Teams may be managed only by an organization administrator.';

update public.team_memberships
set role = 'member'
where role = 'admin';

alter table public.team_memberships
  drop constraint if exists team_memberships_role_check;
alter table public.team_memberships
  add constraint team_memberships_role_check check (role = 'member');

drop policy "organization or team admins can update teams" on public.teams;
create policy "organization admins can update teams" on public.teams
  for update to authenticated
  using ((select private.is_organization_admin(organization_id)))
  with check ((select private.is_organization_admin(organization_id)));

drop policy "organization or team admins can insert team memberships" on public.team_memberships;
drop policy "organization or team admins can update team memberships" on public.team_memberships;
drop policy "organization or team admins can delete team memberships" on public.team_memberships;

create policy "organization admins can insert team memberships"
  on public.team_memberships for insert to authenticated
  with check ((select private.is_organization_admin(organization_id)));
create policy "organization admins can update team memberships"
  on public.team_memberships for update to authenticated
  using ((select private.is_organization_admin(organization_id)))
  with check ((select private.is_organization_admin(organization_id)));
create policy "organization admins can delete team memberships"
  on public.team_memberships for delete to authenticated
  using ((select private.is_organization_admin(organization_id)));
