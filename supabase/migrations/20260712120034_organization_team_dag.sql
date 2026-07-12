-- Multi-organization membership and an arbitrarily deep team DAG.
-- users.organization_id remains the user's default organization for backwards
-- compatibility. Authorization is based exclusively on organization_memberships.

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'expert' check (role in ('expert', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  unique (organization_id, user_id, role)
);

create index organization_memberships_user_org_idx
  on public.organization_memberships(user_id, organization_id);

insert into public.organization_memberships (organization_id, user_id, role)
select organization_id, id, role
from public.users
on conflict (organization_id, user_id) do update
set role = excluded.role;

create index users_default_organization_membership_idx
  on public.users(organization_id, id, role);

-- The original FK used ON DELETE CASCADE, which would delete the global user
-- profile when only their default organization was removed. Multi-org users
-- must survive that operation, so the default org is now a restrictive FK.
alter table public.users
  drop constraint users_organization_id_fkey;

alter table public.users
  add constraint users_default_organization_membership_fkey
  foreign key (organization_id, id, role)
  references public.organization_memberships(organization_id, user_id, role)
  on update cascade
  deferrable initially deferred;

comment on column public.users.organization_id is
  'Default organization used for redirects only. Authorization uses organization_memberships.';
comment on column public.users.role is
  'Role mirror for the default organization. Per-organization roles live in organization_memberships.';

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null default 'team' check (kind in ('team', 'department', 'division', 'other')),
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, slug)
);

create table public.team_edges (
  organization_id uuid not null,
  parent_team_id uuid not null,
  child_team_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, parent_team_id, child_team_id),
  constraint team_edges_no_self_reference check (parent_team_id <> child_team_id),
  constraint team_edges_parent_fkey
    foreign key (organization_id, parent_team_id)
    references public.teams(organization_id, id)
    on delete cascade,
  constraint team_edges_child_fkey
    foreign key (organization_id, child_team_id)
    references public.teams(organization_id, id)
    on delete cascade
);

create index team_edges_child_parent_idx
  on public.team_edges(organization_id, child_team_id, parent_team_id);

create table public.team_memberships (
  organization_id uuid not null,
  team_id uuid not null,
  user_id uuid not null,
  role text not null default 'member' check (role in ('member', 'lead')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, team_id, user_id),
  constraint team_memberships_team_fkey
    foreign key (organization_id, team_id)
    references public.teams(organization_id, id)
    on delete cascade,
  constraint team_memberships_organization_member_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade
);

create index team_memberships_user_team_idx
  on public.team_memberships(organization_id, user_id, team_id);

create trigger organization_memberships_set_updated_at
  before update on public.organization_memberships
  for each row execute function public.set_updated_at();

create trigger teams_set_updated_at
  before update on public.teams
  for each row execute function public.set_updated_at();

create trigger team_memberships_set_updated_at
  before update on public.team_memberships
  for each row execute function public.set_updated_at();

create or replace function private.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  );
$$;

create or replace function private.shares_organization(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_user_id = (select auth.uid())
    or exists (
      select 1
      from public.organization_memberships mine
      join public.organization_memberships theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = (select auth.uid())
        and theirs.user_id = target_user_id
    );
$$;

revoke all on function private.is_organization_member(uuid) from public, anon;
revoke all on function private.is_organization_admin(uuid) from public, anon;
revoke all on function private.shares_organization(uuid) from public, anon;
grant execute on function private.is_organization_member(uuid) to authenticated;
grant execute on function private.is_organization_admin(uuid) to authenticated;
grant execute on function private.shares_organization(uuid) to authenticated;

-- A revision row is updated before every edge insert. Together with the
-- transaction advisory lock this serializes graph writes in READ COMMITTED and
-- raises a serialization error instead of accepting stale state at stricter
-- isolation levels.
create table private.team_graph_revisions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  revision bigint not null default 0
);

revoke all on table private.team_graph_revisions from public, anon, authenticated;

create or replace function private.team_edge_would_create_cycle(
  target_organization_id uuid,
  target_parent_team_id uuid,
  target_child_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive descendants(team_id) as (
    select edge.child_team_id
    from public.team_edges edge
    where edge.organization_id = target_organization_id
      and edge.parent_team_id = target_child_team_id

    union

    select edge.child_team_id
    from public.team_edges edge
    join descendants current_path
      on current_path.team_id = edge.parent_team_id
    where edge.organization_id = target_organization_id
  )
  select target_parent_team_id = target_child_team_id
    or exists (
      select 1
      from descendants
      where team_id = target_parent_team_id
    );
$$;

create or replace function private.reject_team_edge_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.team_edge_would_create_cycle(
    new.organization_id,
    new.parent_team_id,
    new.child_team_id
  ) then
    raise exception 'team_edge_would_create_cycle'
      using errcode = '23514', constraint = 'team_edges_acyclic';
  end if;

  return new;
end;
$$;

create trigger team_edges_reject_cycles
  before insert on public.team_edges
  for each row execute function private.reject_team_edge_cycle();

create or replace function private.add_team_edge(
  target_organization_id uuid,
  target_parent_team_id uuid,
  target_child_team_id uuid
)
returns public.team_edges
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted_edge public.team_edges;
begin
  if not private.is_organization_admin(target_organization_id) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('openexpert-team-dag:' || target_organization_id::text, 0)
  );

  insert into private.team_graph_revisions (organization_id, revision)
  values (target_organization_id, 1)
  on conflict (organization_id) do update
  set revision = private.team_graph_revisions.revision + 1;

  if private.team_edge_would_create_cycle(
    target_organization_id,
    target_parent_team_id,
    target_child_team_id
  ) then
    raise exception 'team_edge_would_create_cycle'
      using errcode = '23514', constraint = 'team_edges_acyclic';
  end if;

  insert into public.team_edges (
    organization_id,
    parent_team_id,
    child_team_id
  )
  values (
    target_organization_id,
    target_parent_team_id,
    target_child_team_id
  )
  returning * into inserted_edge;

  return inserted_edge;
end;
$$;

create or replace function public.add_team_edge(
  organization_id uuid,
  parent_team_id uuid,
  child_team_id uuid
)
returns setof public.team_edges
language sql
security invoker
set search_path = ''
as $$
  select (private.add_team_edge(organization_id, parent_team_id, child_team_id)).*;
$$;

revoke all on function private.team_edge_would_create_cycle(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function private.reject_team_edge_cycle() from public, anon, authenticated;
revoke all on function private.add_team_edge(uuid, uuid, uuid) from public, anon;
grant execute on function private.add_team_edge(uuid, uuid, uuid) to authenticated;
revoke all on function public.add_team_edge(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_team_edge(uuid, uuid, uuid) to authenticated;

create or replace function private.add_organization_member_by_email(
  target_organization_id uuid,
  target_email text,
  target_role text default 'expert'
)
returns public.organization_memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid;
  inserted_membership public.organization_memberships;
begin
  if not private.is_organization_admin(target_organization_id) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  if target_role not in ('expert', 'admin') then
    raise exception 'invalid_organization_role' using errcode = '23514';
  end if;

  select app_user.id
  into target_user_id
  from public.users app_user
  where lower(app_user.email) = lower(btrim(target_email))
  limit 1;

  if target_user_id is null then
    raise exception 'user_not_found' using errcode = '23503';
  end if;

  insert into public.organization_memberships (organization_id, user_id, role)
  values (target_organization_id, target_user_id, target_role)
  on conflict (organization_id, user_id) do update
  set role = excluded.role
  returning * into inserted_membership;

  return inserted_membership;
end;
$$;

create or replace function public.add_organization_member_by_email(
  organization_id uuid,
  email text,
  role text default 'expert'
)
returns setof public.organization_memberships
language sql
security invoker
set search_path = ''
as $$
  select (private.add_organization_member_by_email(organization_id, email, role)).*;
$$;

revoke all on function private.add_organization_member_by_email(uuid, text, text) from public, anon;
grant execute on function private.add_organization_member_by_email(uuid, text, text) to authenticated;
revoke all on function public.add_organization_member_by_email(uuid, text, text) from public, anon;
grant execute on function public.add_organization_member_by_email(uuid, text, text) to authenticated;

-- New signups create an organization, a profile and the first admin membership.
create or replace function private.organization_slug(organization_name text, organization_id uuid)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  with normalized as (
    select trim(both '-' from regexp_replace(
      translate(lower(coalesce(organization_name, 'org')), 'ąćęłńóśźż', 'acelnoszz'),
      '[^a-z0-9]+',
      '-',
      'g'
    )) as value
  )
  select coalesce(nullif(value, ''), 'org') || '-' || left(organization_id::text, 8)
  from normalized;
$$;

create or replace function private.provision_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_organization_id uuid := gen_random_uuid();
  requested_organization_name text;
  requested_full_name text;
begin
  if exists (select 1 from public.users where id = new.id) then
    return new;
  end if;

  requested_organization_name := nullif(trim(new.raw_user_meta_data ->> 'organization_name'), '');
  requested_full_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');

  insert into public.organizations (id, name, slug)
  values (
    new_organization_id,
    coalesce(requested_organization_name, split_part(coalesce(new.email, 'OpenExpert'), '@', 1)),
    private.organization_slug(
      coalesce(requested_organization_name, split_part(coalesce(new.email, 'OpenExpert'), '@', 1)),
      new_organization_id
    )
  );

  insert into public.users (id, organization_id, email, role, full_name)
  values (
    new.id,
    new_organization_id,
    lower(coalesce(new.email, '')),
    'admin',
    requested_full_name
  );

  insert into public.organization_memberships (organization_id, user_id, role)
  values (new_organization_id, new.id, 'admin');

  return new;
end;
$$;

revoke all on function private.organization_slug(text, uuid) from public, anon, authenticated;
revoke all on function private.provision_auth_user() from public, anon, authenticated;

-- Existing CRM ownership references must not point at a user from another org.
alter table public.crm_clients
  add constraint crm_clients_organization_owner_membership_fkey
  foreign key (organization_id, owner_user_id)
  references public.organization_memberships(organization_id, user_id);

alter table public.crm_cases
  add constraint crm_cases_organization_owner_membership_fkey
  foreign key (organization_id, owner_user_id)
  references public.organization_memberships(organization_id, user_id);

alter table public.crm_case_items
  add constraint crm_case_items_organization_owner_membership_fkey
  foreign key (organization_id, owner_user_id)
  references public.organization_memberships(organization_id, user_id);

alter table public.crm_tasks
  add constraint crm_tasks_organization_assignee_membership_fkey
  foreign key (organization_id, assignee_user_id)
  references public.organization_memberships(organization_id, user_id);

alter table public.crm_activities
  add constraint crm_activities_organization_actor_membership_fkey
  foreign key (organization_id, actor_user_id)
  references public.organization_memberships(organization_id, user_id);

create index crm_activities_org_actor_idx
  on public.crm_activities(organization_id, actor_user_id);

-- Cross-entity references also carry organization_id. This prevents a user who
-- legitimately belongs to two organizations from linking rows across tenants
-- through the Supabase Data API.
alter table public.crm_clients
  add constraint crm_clients_organization_id_id_key unique (organization_id, id);
alter table public.crm_client_people
  add constraint crm_client_people_organization_id_id_key unique (organization_id, id);
alter table public.crm_cases
  add constraint crm_cases_organization_id_id_key unique (organization_id, id);
alter table public.crm_providers
  add constraint crm_providers_organization_id_id_key unique (organization_id, id);
alter table public.crm_case_items
  add constraint crm_case_items_organization_id_id_key unique (organization_id, id);
alter table public.crm_item_submissions
  add constraint crm_item_submissions_organization_id_id_key unique (organization_id, id);

alter table public.crm_client_people
  add constraint crm_client_people_organization_client_fkey
  foreign key (organization_id, client_id)
  references public.crm_clients(organization_id, id)
  on delete cascade;

alter table public.crm_cases
  add constraint crm_cases_organization_client_fkey
  foreign key (organization_id, client_id)
  references public.crm_clients(organization_id, id)
  on delete cascade;

alter table public.crm_case_participants
  add constraint crm_case_participants_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.crm_cases(organization_id, id)
  on delete cascade;

alter table public.crm_case_participants
  add constraint crm_case_participants_organization_person_fkey
  foreign key (organization_id, person_id)
  references public.crm_client_people(organization_id, id)
  on delete cascade;

alter table public.crm_case_items
  add constraint crm_case_items_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.crm_cases(organization_id, id)
  on delete cascade;

alter table public.crm_item_submissions
  add constraint crm_item_submissions_organization_item_fkey
  foreign key (organization_id, case_item_id)
  references public.crm_case_items(organization_id, id)
  on delete cascade;

alter table public.crm_item_submissions
  add constraint crm_item_submissions_organization_provider_fkey
  foreign key (organization_id, provider_id)
  references public.crm_providers(organization_id, id);

alter table public.crm_case_item_settlements
  add constraint crm_settlements_organization_item_fkey
  foreign key (organization_id, case_item_id)
  references public.crm_case_items(organization_id, id)
  on delete cascade;

alter table public.crm_case_item_settlements
  add constraint crm_settlements_organization_payer_fkey
  foreign key (organization_id, payer_provider_id)
  references public.crm_providers(organization_id, id);

alter table public.crm_tasks
  add constraint crm_tasks_organization_client_fkey
  foreign key (organization_id, client_id)
  references public.crm_clients(organization_id, id)
  on delete cascade;

alter table public.crm_tasks
  add constraint crm_tasks_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.crm_cases(organization_id, id)
  on delete cascade;

alter table public.crm_tasks
  add constraint crm_tasks_organization_item_fkey
  foreign key (organization_id, case_item_id)
  references public.crm_case_items(organization_id, id)
  on delete cascade;

alter table public.crm_activities
  add constraint crm_activities_organization_client_fkey
  foreign key (organization_id, client_id)
  references public.crm_clients(organization_id, id)
  on delete cascade;

alter table public.crm_activities
  add constraint crm_activities_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.crm_cases(organization_id, id)
  on delete cascade;

alter table public.crm_activities
  add constraint crm_activities_organization_item_fkey
  foreign key (organization_id, case_item_id)
  references public.crm_case_items(organization_id, id)
  on delete cascade;

alter table public.crm_activities
  add constraint crm_activities_organization_submission_fkey
  foreign key (organization_id, submission_id)
  references public.crm_item_submissions(organization_id, id)
  on delete cascade;

alter table public.crm_documents
  add constraint crm_documents_organization_client_fkey
  foreign key (organization_id, client_id)
  references public.crm_clients(organization_id, id)
  on delete cascade;

alter table public.crm_documents
  add constraint crm_documents_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.crm_cases(organization_id, id)
  on delete cascade;

alter table public.crm_documents
  add constraint crm_documents_organization_item_fkey
  foreign key (organization_id, case_item_id)
  references public.crm_case_items(organization_id, id)
  on delete cascade;

alter table public.crm_properties
  add constraint crm_properties_organization_case_fkey
  foreign key (organization_id, case_id)
  references public.crm_cases(organization_id, id)
  on delete cascade;

create index crm_case_participants_org_person_idx
  on public.crm_case_participants(organization_id, person_id);
create index crm_submissions_org_provider_idx
  on public.crm_item_submissions(organization_id, provider_id);
create index crm_settlements_org_payer_idx
  on public.crm_case_item_settlements(organization_id, payer_provider_id);
create index crm_tasks_org_client_idx
  on public.crm_tasks(organization_id, client_id);
create index crm_tasks_org_case_idx
  on public.crm_tasks(organization_id, case_id);
create index crm_tasks_org_item_idx
  on public.crm_tasks(organization_id, case_item_id);
create index crm_activities_org_item_idx
  on public.crm_activities(organization_id, case_item_id);
create index crm_activities_org_submission_idx
  on public.crm_activities(organization_id, submission_id);
create index crm_documents_org_client_idx
  on public.crm_documents(organization_id, client_id);
create index crm_documents_org_item_idx
  on public.crm_documents(organization_id, case_item_id);
create or replace function private.validate_crm_product_type_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.crm_product_types product_type
    where product_type.id = new.product_type_id
      and (
        product_type.organization_id is null
        or product_type.organization_id = new.organization_id
      )
  ) then
    raise exception 'crm_product_type_outside_organization'
      using errcode = '23503', constraint = 'crm_case_items_product_type_organization';
  end if;

  return new;
end;
$$;

create trigger crm_case_items_validate_product_type_scope
  before insert or update of organization_id, product_type_id on public.crm_case_items
  for each row execute function private.validate_crm_product_type_scope();

revoke all on function private.validate_crm_product_type_scope() from public, anon, authenticated;

alter table public.organization_memberships enable row level security;
alter table public.teams enable row level security;
alter table public.team_edges enable row level security;
alter table public.team_memberships enable row level security;

-- Replace the original single-organization policies with membership policies.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename = any (array[
        'organizations',
        'users',
        'crm_product_types',
        'crm_workflows',
        'crm_workflow_statuses',
        'crm_clients',
        'crm_client_people',
        'crm_cases',
        'crm_case_participants',
        'crm_providers',
        'crm_case_items',
        'crm_item_submissions',
        'crm_case_item_settlements',
        'crm_tasks',
        'crm_activities',
        'crm_documents',
        'crm_properties'
      ])
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end;
$$;

create policy "members can view organizations" on public.organizations
  for select to authenticated
  using (private.is_organization_member(id));

create policy "admins can update organizations" on public.organizations
  for update to authenticated
  using (private.is_organization_admin(id))
  with check (private.is_organization_admin(id));

create policy "users can view shared organization profiles" on public.users
  for select to authenticated
  using (private.shares_organization(id));

create policy "members can view organization memberships" on public.organization_memberships
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy "admins can insert organization memberships" on public.organization_memberships
  for insert to authenticated
  with check (private.is_organization_admin(organization_id));

create policy "admins can update organization memberships" on public.organization_memberships
  for update to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

create policy "admins can delete organization memberships" on public.organization_memberships
  for delete to authenticated
  using (private.is_organization_admin(organization_id));

create policy "members can view teams" on public.teams
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy "admins can manage teams" on public.teams
  for all to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

create policy "members can view team edges" on public.team_edges
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy "admins can delete team edges" on public.team_edges
  for delete to authenticated
  using (private.is_organization_admin(organization_id));

create policy "members can view direct team memberships" on public.team_memberships
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy "admins can manage direct team memberships" on public.team_memberships
  for all to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_clients',
    'crm_client_people',
    'crm_cases',
    'crm_case_participants',
    'crm_providers',
    'crm_case_items',
    'crm_item_submissions',
    'crm_case_item_settlements',
    'crm_tasks',
    'crm_activities',
    'crm_documents',
    'crm_properties'
  ]
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.is_organization_member(organization_id)) with check (private.is_organization_member(organization_id))',
      table_name || '_organization_members',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_product_types',
    'crm_workflows',
    'crm_workflow_statuses'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id is null or private.is_organization_member(organization_id))',
      table_name || '_visible_to_members',
      table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (organization_id is not null and private.is_organization_member(organization_id))',
      table_name || '_insert_for_members',
      table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (organization_id is not null and private.is_organization_member(organization_id)) with check (organization_id is not null and private.is_organization_member(organization_id))',
      table_name || '_update_for_members',
      table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (organization_id is not null and private.is_organization_member(organization_id))',
      table_name || '_delete_for_members',
      table_name
    );
  end loop;
end;
$$;

revoke all on table
  public.organization_memberships,
  public.teams,
  public.team_edges,
  public.team_memberships
from anon, authenticated;

grant select, insert, delete on table public.organization_memberships to authenticated;
grant update (role) on table public.organization_memberships to authenticated;

grant select, insert, delete on table public.teams to authenticated;
grant update (name, slug, kind, description) on table public.teams to authenticated;

grant select, insert, delete on table public.team_memberships to authenticated;
grant update (role) on table public.team_memberships to authenticated;

grant select, delete on table public.team_edges to authenticated;
grant update (name, slug) on table public.organizations to authenticated;

grant all privileges on table
  public.organization_memberships,
  public.teams,
  public.team_edges,
  public.team_memberships
to service_role;
