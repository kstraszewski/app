create table public.platform_user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('super_admin')),
  granted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

alter table public.platform_user_roles enable row level security;

create policy "users can read their platform roles"
  on public.platform_user_roles for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.platform_user_roles from anon, authenticated;
grant select on public.platform_user_roles to authenticated;
grant all on public.platform_user_roles to service_role;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_user_roles platform_role
    where platform_role.user_id = (select auth.uid())
      and platform_role.role = 'super_admin'
  );
$$;

revoke all on function private.is_super_admin() from public, anon;
grant execute on function private.is_super_admin() to authenticated;

drop policy mortgage_product_overrides_admin_insert
  on public.mortgage_product_overrides;
drop policy mortgage_product_overrides_admin_update
  on public.mortgage_product_overrides;
drop policy mortgage_product_overrides_admin_delete
  on public.mortgage_product_overrides;
drop policy mortgage_product_override_revisions_admin_read
  on public.mortgage_product_override_revisions;

create policy mortgage_product_overrides_super_admin_insert
  on public.mortgage_product_overrides for insert to authenticated
  with check (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );
create policy mortgage_product_overrides_super_admin_update
  on public.mortgage_product_overrides for update to authenticated
  using (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  )
  with check (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );
create policy mortgage_product_overrides_super_admin_delete
  on public.mortgage_product_overrides for delete to authenticated
  using (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );
create policy mortgage_product_override_revisions_super_admin_read
  on public.mortgage_product_override_revisions for select to authenticated
  using (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );

drop policy mortgage_bank_overrides_admin_insert
  on public.mortgage_bank_overrides;
drop policy mortgage_bank_overrides_admin_update
  on public.mortgage_bank_overrides;
drop policy mortgage_bank_overrides_admin_delete
  on public.mortgage_bank_overrides;
drop policy mortgage_bank_override_revisions_admin_read
  on public.mortgage_bank_override_revisions;

create policy mortgage_bank_overrides_super_admin_insert
  on public.mortgage_bank_overrides for insert to authenticated
  with check (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );
create policy mortgage_bank_overrides_super_admin_update
  on public.mortgage_bank_overrides for update to authenticated
  using (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  )
  with check (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );
create policy mortgage_bank_overrides_super_admin_delete
  on public.mortgage_bank_overrides for delete to authenticated
  using (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );
create policy mortgage_bank_override_revisions_super_admin_read
  on public.mortgage_bank_override_revisions for select to authenticated
  using (
    (select private.is_super_admin())
    and (select private.is_organization_member(organization_id))
  );

create or replace function private.can_manage_mortgage_bank_logo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.user_id = (select auth.uid())
        and membership.organization_id::text = (storage.foldername(object_name))[1]
    );
$$;

comment on table public.platform_user_roles is
  'Global platform roles. Super admins manage only the mortgage product and institution catalog interfaces.';
