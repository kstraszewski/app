-- Organization-specific catalogue overrides. The source catalogue remains
-- immutable for tenant users; an organization can only customize what its own
-- members see in the comparator.

create table public.mortgage_product_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.mortgage_products(id) on delete cascade,
  is_enabled boolean not null default true,
  custom_name text check (custom_name is null or btrim(custom_name) <> ''),
  parameters jsonb not null default '{}'::jsonb,
  notes text,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id),
  check (jsonb_typeof(parameters) = 'object'),
  check (
    parameters - array[
      'effective_from', 'effective_to', 'calculation_date', 'data_status',
      'completeness_score', 'interest_type', 'fixed_rate_pct',
      'fixed_period_months', 'margin_pct', 'reference_rate_code',
      'reference_rate_pct', 'reference_rate_as_of',
      'representative_apr_pct', 'min_amount', 'max_amount',
      'min_term_months', 'max_term_months', 'max_ltv_pct', 'is_eco',
      'cost_rules', 'requirements', 'representative_example',
      'assumptions', 'unknown_fields'
    ]::text[] = '{}'::jsonb
  )
);

create table public.mortgage_product_override_revisions (
  id uuid primary key default gen_random_uuid(),
  override_id uuid references public.mortgage_product_overrides(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.mortgage_products(id) on delete cascade,
  revision integer not null check (revision > 0),
  action text not null check (action in ('created', 'updated', 'reset')),
  is_enabled boolean not null,
  custom_name text,
  parameters jsonb not null,
  notes text,
  changed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index mortgage_product_overrides_organization_idx
  on public.mortgage_product_overrides(organization_id, product_id);
create index mortgage_product_override_revisions_lookup_idx
  on public.mortgage_product_override_revisions(organization_id, product_id, created_at desc);

create or replace function private.prepare_mortgage_product_override()
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
    new.product_id := old.product_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor_id;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.audit_mortgage_product_override()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.mortgage_product_override_revisions (
      override_id, organization_id, product_id, revision, action,
      is_enabled, custom_name, parameters, notes, changed_by
    ) values (
      null, old.organization_id, old.product_id, old.revision + 1, 'reset',
      old.is_enabled, old.custom_name, old.parameters, old.notes,
      coalesce((select auth.uid()), old.updated_by)
    );
    return old;
  end if;

  insert into public.mortgage_product_override_revisions (
    override_id, organization_id, product_id, revision, action,
    is_enabled, custom_name, parameters, notes, changed_by
  ) values (
    new.id, new.organization_id, new.product_id, new.revision,
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    new.is_enabled, new.custom_name, new.parameters, new.notes, new.updated_by
  );
  return new;
end;
$$;

revoke all on function private.prepare_mortgage_product_override() from public, anon, authenticated;
revoke all on function private.audit_mortgage_product_override() from public, anon, authenticated;

create trigger mortgage_product_overrides_prepare
  before insert or update on public.mortgage_product_overrides
  for each row execute function private.prepare_mortgage_product_override();

create trigger mortgage_product_overrides_audit
  after insert or update or delete on public.mortgage_product_overrides
  for each row execute function private.audit_mortgage_product_override();

alter table public.mortgage_product_overrides enable row level security;
alter table public.mortgage_product_override_revisions enable row level security;

create policy mortgage_product_overrides_member_read
  on public.mortgage_product_overrides for select to authenticated
  using (private.is_organization_member(organization_id));

create policy mortgage_product_overrides_admin_insert
  on public.mortgage_product_overrides for insert to authenticated
  with check (private.is_organization_admin(organization_id));

create policy mortgage_product_overrides_admin_update
  on public.mortgage_product_overrides for update to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

create policy mortgage_product_overrides_admin_delete
  on public.mortgage_product_overrides for delete to authenticated
  using (private.is_organization_admin(organization_id));

create policy mortgage_product_override_revisions_admin_read
  on public.mortgage_product_override_revisions for select to authenticated
  using (private.is_organization_admin(organization_id));

revoke all on public.mortgage_product_overrides from anon, authenticated;
revoke all on public.mortgage_product_override_revisions from anon, authenticated;

grant select, insert, delete on public.mortgage_product_overrides to authenticated;
grant update (is_enabled, custom_name, parameters, notes) on public.mortgage_product_overrides to authenticated;
grant select on public.mortgage_product_override_revisions to authenticated;

grant all on public.mortgage_product_overrides to service_role;
grant all on public.mortgage_product_override_revisions to service_role;
