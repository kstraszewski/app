-- One authenticated identity can be used in several product contexts. A workforce
-- membership and a client relationship are independent capabilities.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'pl-PL'
    check (locale ~ '^[a-z]{2}(?:-[A-Z]{2})?$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Serialize signups with the backfill and trigger replacement. Without this,
-- an Auth row could be created by the legacy workforce-provisioning trigger
-- between the snapshot below and the new neutral provisioning behavior.
lock table auth.users in share row exclusive mode;

-- Signing in is authentication only. It must not implicitly create an
-- organization or grant an administrator role. Workforce onboarding is an
-- explicit, authenticated operation below.
create or replace function private.provision_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do update
  set display_name = coalesce(
    public.profiles.display_name,
    excluded.display_name
  );

  return new;
end;
$$;

revoke all on function private.provision_auth_user()
  from public, anon, authenticated;

insert into public.profiles (id, display_name)
select
  auth_user.id,
  coalesce(
    app_user.full_name,
    nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), '')
  )
from auth.users auth_user
left join public.users app_user on app_user.id = auth_user.id
on conflict (id) do nothing;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles are visible to their identity"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy "profiles are editable by their identity"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

grant select on table public.profiles to authenticated;
grant update (display_name, locale) on table public.profiles to authenticated;
grant all privileges on table public.profiles to service_role;

create or replace function private.create_organization_with_admin(
  organization_name text,
  requested_full_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_auth_user auth.users;
  new_organization_id uuid := gen_random_uuid();
  normalized_name text := nullif(btrim(organization_name), '');
  normalized_full_name text := nullif(btrim(requested_full_name), '');
  new_slug text;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  if normalized_name is null or length(normalized_name) > 160 then
    raise exception 'invalid_organization_name' using errcode = '22023';
  end if;

  if normalized_full_name is not null and length(normalized_full_name) > 200 then
    raise exception 'invalid_full_name' using errcode = '22023';
  end if;

  if exists (select 1 from public.users where id = current_user_id) then
    raise exception 'workforce_profile_already_exists' using errcode = '23505';
  end if;

  select *
  into current_auth_user
  from auth.users
  where id = current_user_id;

  if not found then
    raise exception 'auth_user_not_found' using errcode = 'P0002';
  end if;

  if nullif(btrim(current_auth_user.email), '') is null then
    raise exception 'workforce_email_required' using errcode = '22023';
  end if;

  new_slug := private.organization_slug(normalized_name, new_organization_id);

  insert into public.organizations (id, name, slug)
  values (new_organization_id, normalized_name, new_slug);

  -- The legacy public.users table remains the workforce profile. Its
  -- membership FK is deferrable, so both rows are created atomically.
  insert into public.users (
    id,
    organization_id,
    email,
    role,
    full_name
  )
  values (
    current_user_id,
    new_organization_id,
    lower(coalesce(current_auth_user.email, '')),
    'admin',
    coalesce(
      normalized_full_name,
      nullif(btrim(current_auth_user.raw_user_meta_data ->> 'full_name'), '')
    )
  );

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role
  )
  values (new_organization_id, current_user_id, 'admin');

  insert into public.profiles (id, display_name)
  values (
    current_user_id,
    coalesce(
      normalized_full_name,
      nullif(btrim(current_auth_user.raw_user_meta_data ->> 'full_name'), '')
    )
  )
  on conflict (id) do update
  set display_name = coalesce(excluded.display_name, public.profiles.display_name);

  return jsonb_build_object(
    'id', new_organization_id,
    'name', normalized_name,
    'slug', new_slug,
    'role', 'admin'
  );
end;
$$;

create or replace function public.create_organization_with_admin(
  organization_name text,
  full_name text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_organization_with_admin(organization_name, full_name);
$$;

revoke all on function private.create_organization_with_admin(text, text)
  from public, anon;
grant execute on function private.create_organization_with_admin(text, text)
  to authenticated;
revoke all on function public.create_organization_with_admin(text, text)
  from public, anon;
grant execute on function public.create_organization_with_admin(text, text)
  to authenticated;

create table public.client_account_links (
  auth_user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null,
  client_id uuid not null,
  client_person_id uuid not null,
  source_appointment_id uuid,
  verification_method text not null
    check (verification_method in ('email', 'phone')),
  verified_contact_normalized text not null
    check (
      btrim(verified_contact_normalized) <> ''
      and verified_contact_normalized = lower(btrim(verified_contact_normalized))
      and length(verified_contact_normalized) <= 320
    ),
  verified_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (auth_user_id, organization_id, client_person_id),
  constraint client_account_links_person_fkey
    foreign key (organization_id, client_id, client_person_id)
    references public.crm_client_people(organization_id, client_id, id)
    on delete cascade,
  constraint client_account_links_appointment_fkey
    foreign key (organization_id, source_appointment_id)
    references public.appointments(organization_id, id)
    on delete set null (source_appointment_id)
);

create unique index client_account_links_active_person_idx
  on public.client_account_links(organization_id, client_person_id)
  where revoked_at is null;

create index client_account_links_identity_idx
  on public.client_account_links(
    auth_user_id,
    organization_id,
    client_person_id
  )
  where revoked_at is null;

alter table public.client_account_links enable row level security;

create policy "client links are visible to their identity"
  on public.client_account_links
  for select
  to authenticated
  using (
    auth_user_id = (select auth.uid())
    and revoked_at is null
  );

grant select on table public.client_account_links to authenticated;
grant all privileges on table public.client_account_links to service_role;

-- An active widget is shareable by URL, but directory publication is a
-- separate and explicit decision.
alter table public.booking_widgets
  add column is_directory_listed boolean not null default false;

alter table public.booking_widgets
  add constraint booking_widgets_directory_calendar_only
  check (not is_directory_listed or widget_type = 'calendar');

create index booking_widgets_public_directory_idx
  on public.booking_widgets(created_at, id)
  where is_active and is_directory_listed and widget_type = 'calendar';

comment on table public.profiles is
  'Neutral account profile shared by workforce and client product contexts.';
comment on table public.client_account_links is
  'Verified client-portal access for one Auth identity and one CRM person.';
comment on column public.booking_widgets.is_directory_listed is
  'Explicit opt-in for the public OpenExpert experts and facilities directory.';
