create table if not exists public.organization_design_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_design_settings enable row level security;

grant select, insert, update on public.organization_design_settings to authenticated;

drop policy if exists "organization members read design settings"
  on public.organization_design_settings;
create policy "organization members read design settings"
on public.organization_design_settings
for select
to authenticated
using (
  organization_id in (
    select membership.organization_id
    from public.organization_memberships as membership
    where membership.user_id = (select auth.uid())
  )
);

drop policy if exists "organization admins insert design settings"
  on public.organization_design_settings;
create policy "organization admins insert design settings"
on public.organization_design_settings
for insert
to authenticated
with check (
  organization_id in (
    select membership.organization_id
    from public.organization_memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  )
);

drop policy if exists "organization admins update design settings"
  on public.organization_design_settings;
create policy "organization admins update design settings"
on public.organization_design_settings
for update
to authenticated
using (
  organization_id in (
    select membership.organization_id
    from public.organization_memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  )
)
with check (
  organization_id in (
    select membership.organization_id
    from public.organization_memberships as membership
    where membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  )
);

comment on table public.organization_design_settings is
  'Versioned organization-wide design tokens and brand assets. Only organization admins may change them.';
