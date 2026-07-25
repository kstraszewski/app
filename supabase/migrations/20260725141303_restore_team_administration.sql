-- Restore delegated team administration while keeping organization-wide
-- structure changes under organization administrators.

alter table public.team_memberships
  drop constraint if exists team_memberships_role_check;
alter table public.team_memberships
  add constraint team_memberships_role_check
  check (role in ('admin', 'member'));

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
  select exists (
    select 1
    from public.team_memberships membership
    where membership.organization_id = target_organization_id
      and membership.team_id = target_team_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  );
$$;

comment on function private.is_team_admin(uuid, uuid) is
  'True only for a direct admin membership in the requested team.';

create or replace function private.can_view_team(
  target_organization_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organization_admin(target_organization_id)
    or exists (
      with recursive ancestors(team_id) as (
        select target_team_id

        union

        select edge.parent_team_id
        from public.team_edges edge
        join ancestors current_team
          on current_team.team_id = edge.child_team_id
        where edge.organization_id = target_organization_id
      )
      select 1
      from ancestors
      join public.team_memberships membership
        on membership.organization_id = target_organization_id
       and membership.team_id = ancestors.team_id
      where membership.user_id = (select auth.uid())
        and (
          ancestors.team_id = target_team_id
          or membership.role = 'admin'
        )
    );
$$;

comment on function private.can_view_team(uuid, uuid) is
  'Organization admins see every team; members see direct teams and team admins also see descendants.';

create or replace function private.has_facility_admin_membership(
  target_organization_id uuid,
  target_facility_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.facility_memberships membership
    where membership.organization_id = target_organization_id
      and membership.facility_id = target_facility_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  );
$$;

comment on function private.has_facility_admin_membership(uuid, uuid) is
  'Checks the direct facility membership role without broadening facility configuration policies.';

revoke all on function private.is_team_admin(uuid, uuid) from public, anon;
revoke all on function private.can_view_team(uuid, uuid) from public, anon;
revoke all on function private.has_facility_admin_membership(uuid, uuid) from public, anon;
grant execute on function private.is_team_admin(uuid, uuid) to authenticated;
grant execute on function private.can_view_team(uuid, uuid) to authenticated;
grant execute on function private.has_facility_admin_membership(uuid, uuid) to authenticated;

-- A team administrator may edit only the team where they hold a direct admin
-- membership. Creation, deletion and graph changes remain organization-only.
drop policy if exists "members can view teams" on public.teams;
drop policy if exists "organization admins can update teams" on public.teams;
drop policy if exists "organization or team admins can update teams" on public.teams;

create policy "scoped members can view teams" on public.teams
  for select to authenticated
  using ((select private.can_view_team(organization_id, id)));

create policy "organization or team admins can update teams" on public.teams
  for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, id))
  );

-- Descendant edges are visible to a parent team administrator, but only an
-- organization administrator may mutate the graph through the existing policy
-- and add_team_edge RPC.
drop policy if exists "members can view team edges" on public.team_edges;
create policy "scoped members can view team edges" on public.team_edges
  for select to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.can_view_team(organization_id, parent_team_id))
    or (select private.can_view_team(organization_id, child_team_id))
  );

drop policy if exists "members can view direct team memberships" on public.team_memberships;
drop policy if exists "organization admins can insert team memberships" on public.team_memberships;
drop policy if exists "organization admins can update team memberships" on public.team_memberships;
drop policy if exists "organization admins can delete team memberships" on public.team_memberships;
drop policy if exists "organization or team admins can insert team memberships" on public.team_memberships;
drop policy if exists "organization or team admins can update team memberships" on public.team_memberships;
drop policy if exists "organization or team admins can delete team memberships" on public.team_memberships;

create policy "scoped members can view team memberships"
  on public.team_memberships for select to authenticated
  using ((select private.can_view_team(organization_id, team_id)));

create policy "organization or team admins can insert team memberships"
  on public.team_memberships for insert to authenticated
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  );

create policy "organization or team admins can update team memberships"
  on public.team_memberships for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  );

create policy "organization or team admins can delete team memberships"
  on public.team_memberships for delete to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  );

-- Protect a delegated team from losing its final direct administrator. An
-- organization administrator can intentionally remove the last administrator.
create or replace function private.protect_last_team_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := (select auth.uid());
  admin_count integer;
begin
  if old.role <> 'admin'
    or (tg_op = 'UPDATE' and new.role = 'admin')
    or actor_user_id is null
    or private.is_organization_admin(old.organization_id)
  then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'openexpert-team-admin:' || old.organization_id::text || ':' || old.team_id::text,
      0
    )
  );

  select count(*)
  into admin_count
  from public.team_memberships membership
  where membership.organization_id = old.organization_id
    and membership.team_id = old.team_id
    and membership.role = 'admin';

  if admin_count <= 1 then
    raise exception 'team_requires_direct_admin'
      using errcode = '23514', constraint = 'team_memberships_require_admin';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_last_team_admin() from public, anon, authenticated;

drop trigger if exists team_memberships_protect_last_admin on public.team_memberships;
create trigger team_memberships_protect_last_admin
  before update of role or delete on public.team_memberships
  for each row execute function private.protect_last_team_admin();

-- Team/facility links can be changed by organization administrators or by a
-- direct team administrator who is also a direct administrator of the target
-- facility. This does not restore facility-wide configuration authority.
drop policy if exists "scoped members can view team facility links" on public.team_facilities;
drop policy if exists "organization or facility admins can link teams" on public.team_facilities;
drop policy if exists "organization or facility admins can unlink teams" on public.team_facilities;

create policy "scoped members can view team facility links" on public.team_facilities
  for select to authenticated
  using (
    (select private.can_view_facility(organization_id, facility_id))
    or (select private.can_view_team(organization_id, team_id))
  );

create policy "organization or scoped team admins can link facilities"
  on public.team_facilities for insert to authenticated
  with check (
    (select private.is_organization_admin(organization_id))
    or (
      (select private.is_team_admin(organization_id, team_id))
      and (select private.has_facility_admin_membership(organization_id, facility_id))
    )
  );

create policy "organization or scoped team admins can unlink facilities"
  on public.team_facilities for delete to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (
      (select private.is_team_admin(organization_id, team_id))
      and (select private.has_facility_admin_membership(organization_id, facility_id))
    )
  );

-- A parent team administrator should be able to read facilities linked to a
-- descendant without receiving facility configuration rights.
create or replace function private.can_view_facility(
  target_organization_id uuid,
  target_facility_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organization_admin(target_organization_id)
    or exists (
      select 1
      from public.facility_memberships membership
      where membership.organization_id = target_organization_id
        and membership.facility_id = target_facility_id
        and membership.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.team_facilities link
      where link.organization_id = target_organization_id
        and link.facility_id = target_facility_id
        and private.can_view_team(link.organization_id, link.team_id)
    );
$$;
