-- Organization-specific assumptions for the public-facing mortgage capacity
-- estimate. Regulatory formula constants stay in application code; this table
-- contains only model/bank-policy parameters and dated public-data snapshots.

create table public.mortgage_capacity_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  policy_as_of date not null,
  minimum_social_as_of date not null,
  nbp_reference_rate_as_of date not null,
  dsti_limit_pct numeric(5, 2) not null check (dsti_limit_pct > 0 and dsti_limit_pct <= 100),
  income_buffer_pct numeric(5, 2) not null check (income_buffer_pct >= 0 and income_buffer_pct <= 50),
  credit_limit_monthly_charge_pct numeric(5, 2) not null check (credit_limit_monthly_charge_pct >= 0 and credit_limit_monthly_charge_pct <= 100),
  max_ltv_pct numeric(5, 2) not null check (max_ltv_pct > 0 and max_ltv_pct <= 80),
  default_interest_rate_pct numeric(6, 3) not null check (default_interest_rate_pct >= 0 and default_interest_rate_pct <= 50),
  default_interest_type text not null check (default_interest_type in ('periodically_fixed', 'variable', 'fixed_for_term')),
  default_fixed_rate_period_months integer not null check (default_fixed_rate_period_months between 60 and 420),
  nbp_reference_rate_pct numeric(6, 3) not null check (nbp_reference_rate_pct >= 0 and nbp_reference_rate_pct <= 30),
  variable_rate_volatility_buffer_pct numeric(6, 3) not null check (variable_rate_volatility_buffer_pct >= 0 and variable_rate_volatility_buffer_pct <= 10),
  minimum_social_1_person numeric(12, 2) not null check (minimum_social_1_person >= 0),
  minimum_social_2_people numeric(12, 2) not null check (minimum_social_2_people >= 0),
  minimum_social_3_people numeric(12, 2) not null check (minimum_social_3_people >= 0),
  minimum_social_4_people numeric(12, 2) not null check (minimum_social_4_people >= 0),
  minimum_social_5_people numeric(12, 2) not null check (minimum_social_5_people >= 0),
  minimum_social_additional_person numeric(12, 2) not null check (minimum_social_additional_person >= 0),
  notes text check (notes is null or char_length(notes) <= 4000),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mortgage_capacity_setting_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision integer not null check (revision > 0),
  action text not null check (action in ('created', 'updated', 'reset')),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  changed_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, revision)
);

create index mortgage_capacity_setting_revisions_lookup_idx
  on public.mortgage_capacity_setting_revisions(organization_id, created_at desc);

create or replace function private.prepare_mortgage_capacity_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'authenticated_user_required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := actor_id;
    new.updated_by := actor_id;
    new.revision := coalesce((
      select max(history.revision)
      from public.mortgage_capacity_setting_revisions as history
      where history.organization_id = new.organization_id
    ), 0) + 1;
    new.created_at := now();
  else
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := actor_id;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.audit_mortgage_capacity_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.mortgage_capacity_settings%rowtype;
  audit_revision integer;
  audit_action text;
  actor_id uuid;
begin
  if tg_op = 'DELETE' then
    source_row := old;
    audit_revision := old.revision + 1;
    audit_action := 'reset';
    actor_id := coalesce((select auth.uid()), old.updated_by);
  else
    source_row := new;
    audit_revision := new.revision;
    audit_action := case when tg_op = 'INSERT' then 'created' else 'updated' end;
    actor_id := new.updated_by;
  end if;

  insert into public.mortgage_capacity_setting_revisions (
    organization_id,
    revision,
    action,
    settings,
    changed_by
  ) values (
    source_row.organization_id,
    audit_revision,
    audit_action,
    to_jsonb(source_row)
      - 'organization_id'
      - 'revision'
      - 'created_by'
      - 'updated_by'
      - 'created_at'
      - 'updated_at',
    actor_id
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.prepare_mortgage_capacity_settings() from public, anon, authenticated;
revoke all on function private.audit_mortgage_capacity_settings() from public, anon, authenticated;

create trigger mortgage_capacity_settings_prepare
  before insert or update on public.mortgage_capacity_settings
  for each row execute function private.prepare_mortgage_capacity_settings();

create trigger mortgage_capacity_settings_audit
  after insert or update or delete on public.mortgage_capacity_settings
  for each row execute function private.audit_mortgage_capacity_settings();

alter table public.mortgage_capacity_settings enable row level security;
alter table public.mortgage_capacity_setting_revisions enable row level security;

create policy mortgage_capacity_settings_member_read
  on public.mortgage_capacity_settings for select to authenticated
  using (private.is_organization_member(organization_id));

create policy mortgage_capacity_settings_admin_insert
  on public.mortgage_capacity_settings for insert to authenticated
  with check (private.is_organization_admin(organization_id));

create policy mortgage_capacity_settings_admin_update
  on public.mortgage_capacity_settings for update to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

create policy mortgage_capacity_settings_admin_delete
  on public.mortgage_capacity_settings for delete to authenticated
  using (private.is_organization_admin(organization_id));

create policy mortgage_capacity_setting_revisions_admin_read
  on public.mortgage_capacity_setting_revisions for select to authenticated
  using (private.is_organization_admin(organization_id));

revoke all on public.mortgage_capacity_settings from anon, authenticated;
revoke all on public.mortgage_capacity_setting_revisions from anon, authenticated;

grant select, insert, delete on public.mortgage_capacity_settings to authenticated;
grant update (
  policy_as_of,
  minimum_social_as_of,
  nbp_reference_rate_as_of,
  dsti_limit_pct,
  income_buffer_pct,
  credit_limit_monthly_charge_pct,
  max_ltv_pct,
  default_interest_rate_pct,
  default_interest_type,
  default_fixed_rate_period_months,
  nbp_reference_rate_pct,
  variable_rate_volatility_buffer_pct,
  minimum_social_1_person,
  minimum_social_2_people,
  minimum_social_3_people,
  minimum_social_4_people,
  minimum_social_5_people,
  minimum_social_additional_person,
  notes
) on public.mortgage_capacity_settings to authenticated;
grant select on public.mortgage_capacity_setting_revisions to authenticated;

grant all on public.mortgage_capacity_settings to service_role;
grant all on public.mortgage_capacity_setting_revisions to service_role;
