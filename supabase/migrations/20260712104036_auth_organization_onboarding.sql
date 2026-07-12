alter table public.users
  add column if not exists full_name text;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id
  from public.users
  where id = (select auth.uid())
  limit 1;
$$;

revoke all on function private.current_organization_id() from public, anon;
grant execute on function private.current_organization_id() to authenticated;

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
    'org-' || new_organization_id::text
  );

  insert into public.users (id, organization_id, email, role, full_name)
  values (
    new.id,
    new_organization_id,
    lower(coalesce(new.email, '')),
    'admin',
    requested_full_name
  );

  return new;
end;
$$;

revoke all on function private.provision_auth_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.provision_auth_user();

-- Repair Auth users created before automatic provisioning was introduced.
do $$
declare
  existing_auth_user record;
  generated_organization_id uuid;
begin
  for existing_auth_user in
    select au.id, au.email, au.raw_user_meta_data
    from auth.users au
    where not exists (select 1 from public.users pu where pu.id = au.id)
  loop
    generated_organization_id := gen_random_uuid();

    insert into public.organizations (id, name, slug)
    values (
      generated_organization_id,
      coalesce(
        nullif(trim(existing_auth_user.raw_user_meta_data ->> 'organization_name'), ''),
        split_part(coalesce(existing_auth_user.email, 'OpenExpert'), '@', 1)
      ),
      'org-' || generated_organization_id::text
    );

    insert into public.users (id, organization_id, email, role, full_name)
    values (
      existing_auth_user.id,
      generated_organization_id,
      lower(coalesce(existing_auth_user.email, '')),
      'admin',
      nullif(trim(existing_auth_user.raw_user_meta_data ->> 'full_name'), '')
    );
  end loop;
end;
$$;

drop policy if exists "users see own org" on public.organizations;
create policy "users see own org" on public.organizations
  for select to authenticated
  using (id = (select private.current_organization_id()));

drop policy if exists "users see own profile and org members" on public.users;
create policy "users see own profile and org members" on public.users
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));

drop function if exists public.current_organization_id();
