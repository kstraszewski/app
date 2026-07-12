-- Organization-specific presentation and visibility for financial institutions.
-- The shared source catalogue stays immutable; tenant administrators only
-- customize how a bank is presented inside their own organization.

create table public.mortgage_bank_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bank_id uuid not null references public.mortgage_banks(id) on delete cascade,
  is_enabled boolean not null default true,
  custom_name text check (custom_name is null or btrim(custom_name) <> ''),
  custom_website_url text check (custom_website_url is null or btrim(custom_website_url) <> ''),
  logo_path text,
  notes text,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, bank_id),
  check (custom_name is null or char_length(custom_name) <= 200),
  check (
    custom_website_url is null
    or (
      char_length(custom_website_url) <= 500
      and custom_website_url ~* '^https?://[^[:space:]]+$'
    )
  ),
  check (notes is null or char_length(notes) <= 4000),
  check (
    logo_path is null
    or (
      char_length(logo_path) <= 500
      and logo_path like organization_id::text || '/' || bank_id::text || '/%'
    )
  )
);

create table public.mortgage_bank_override_revisions (
  id uuid primary key default gen_random_uuid(),
  override_id uuid references public.mortgage_bank_overrides(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bank_id uuid not null references public.mortgage_banks(id) on delete cascade,
  revision integer not null check (revision > 0),
  action text not null check (action in ('created', 'updated', 'reset')),
  is_enabled boolean not null,
  custom_name text,
  custom_website_url text,
  logo_path text,
  notes text,
  changed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index mortgage_bank_overrides_organization_idx
  on public.mortgage_bank_overrides(organization_id, bank_id);
create index mortgage_bank_override_revisions_lookup_idx
  on public.mortgage_bank_override_revisions(organization_id, bank_id, created_at desc);

create or replace function private.prepare_mortgage_bank_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    actor_id := coalesce(actor_id, new.updated_by, new.created_by);
    if actor_id is null then
      raise exception 'authenticated_user_required' using errcode = '42501';
    end if;
    new.created_by := actor_id;
    new.updated_by := actor_id;
    new.revision := 1;
    new.created_at := now();
  else
    actor_id := coalesce(actor_id, old.updated_by);
    new.organization_id := old.organization_id;
    new.bank_id := old.bank_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor_id;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.audit_mortgage_bank_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.mortgage_bank_override_revisions (
      override_id, organization_id, bank_id, revision, action,
      is_enabled, custom_name, custom_website_url, logo_path, notes, changed_by
    ) values (
      null, old.organization_id, old.bank_id, old.revision + 1, 'reset',
      old.is_enabled, old.custom_name, old.custom_website_url, old.logo_path,
      old.notes, coalesce((select auth.uid()), old.updated_by)
    );
    return old;
  end if;

  insert into public.mortgage_bank_override_revisions (
    override_id, organization_id, bank_id, revision, action,
    is_enabled, custom_name, custom_website_url, logo_path, notes, changed_by
  ) values (
    new.id, new.organization_id, new.bank_id, new.revision,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.is_enabled, new.custom_name, new.custom_website_url, new.logo_path,
    new.notes, new.updated_by
  );
  return new;
end;
$$;

revoke all on function private.prepare_mortgage_bank_override() from public, anon, authenticated;
revoke all on function private.audit_mortgage_bank_override() from public, anon, authenticated;

create trigger mortgage_bank_overrides_prepare
  before insert or update on public.mortgage_bank_overrides
  for each row execute function private.prepare_mortgage_bank_override();

create trigger mortgage_bank_overrides_audit
  after insert or update or delete on public.mortgage_bank_overrides
  for each row execute function private.audit_mortgage_bank_override();

alter table public.mortgage_bank_overrides enable row level security;
alter table public.mortgage_bank_override_revisions enable row level security;

create policy mortgage_bank_overrides_member_read
  on public.mortgage_bank_overrides for select to authenticated
  using (private.is_organization_member(organization_id));

create policy mortgage_bank_overrides_admin_insert
  on public.mortgage_bank_overrides for insert to authenticated
  with check (private.is_organization_admin(organization_id));

create policy mortgage_bank_overrides_admin_update
  on public.mortgage_bank_overrides for update to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

create policy mortgage_bank_overrides_admin_delete
  on public.mortgage_bank_overrides for delete to authenticated
  using (private.is_organization_admin(organization_id));

create policy mortgage_bank_override_revisions_admin_read
  on public.mortgage_bank_override_revisions for select to authenticated
  using (private.is_organization_admin(organization_id));

revoke all on public.mortgage_bank_overrides from anon, authenticated;
revoke all on public.mortgage_bank_override_revisions from anon, authenticated;
grant select, insert, delete on public.mortgage_bank_overrides to authenticated;
grant update (is_enabled, custom_name, custom_website_url, logo_path, notes)
  on public.mortgage_bank_overrides to authenticated;
grant select on public.mortgage_bank_override_revisions to authenticated;
grant all on public.mortgage_bank_overrides to service_role;
grant all on public.mortgage_bank_override_revisions to service_role;

-- Logos are presentation assets, so reads are public while every mutation is
-- scoped to an organization admin and an organization-owned path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mortgage-bank-logos',
  'mortgage-bank-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.can_manage_mortgage_bank_logo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.user_id = (select auth.uid())
      and membership.role = 'admin'
      and membership.organization_id::text = (storage.foldername(object_name))[1]
  );
$$;

revoke all on function private.can_manage_mortgage_bank_logo(text) from public, anon, authenticated;
grant execute on function private.can_manage_mortgage_bank_logo(text) to authenticated;

create policy mortgage_bank_logos_admin_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'mortgage-bank-logos'
    and private.can_manage_mortgage_bank_logo(name)
  );

create policy mortgage_bank_logos_admin_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mortgage-bank-logos'
    and private.can_manage_mortgage_bank_logo(name)
  );

create policy mortgage_bank_logos_admin_update
  on storage.objects for update to authenticated
  using (
    bucket_id = 'mortgage-bank-logos'
    and private.can_manage_mortgage_bank_logo(name)
  )
  with check (
    bucket_id = 'mortgage-bank-logos'
    and private.can_manage_mortgage_bank_logo(name)
  );

create policy mortgage_bank_logos_admin_delete
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'mortgage-bank-logos'
    and private.can_manage_mortgage_bank_logo(name)
  );
