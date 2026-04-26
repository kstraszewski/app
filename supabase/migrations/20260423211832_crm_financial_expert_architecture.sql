create schema if not exists private;

revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.users
  where id = (select auth.uid())
  limit 1;
$$;

grant execute on function private.current_organization_id() to authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.crm_product_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  domain text not null check (domain in ('credit', 'insurance', 'real_estate', 'other')),
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  is_system boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_system and organization_id is null) or (not is_system and organization_id is not null))
);

create table public.crm_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  scope text not null check (scope in ('case', 'case_item', 'submission', 'settlement')),
  domain text check (domain in ('credit', 'insurance', 'real_estate', 'other')),
  code text not null,
  name text not null,
  is_default boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((is_system and organization_id is null) or (not is_system and organization_id is not null))
);

create table public.crm_workflow_statuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.crm_workflows(id) on delete cascade,
  code text not null,
  label text not null,
  color text not null default 'neutral',
  sort_order integer not null default 0,
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid references public.users(id) on delete set null,
  display_name text not null,
  status_code text not null default 'lead',
  lead_source text,
  primary_email text,
  primary_phone text,
  tags text[] not null default '{}',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_client_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  role text not null default 'primary',
  first_name text,
  last_name text,
  display_name text not null,
  email text,
  phone text,
  pesel text,
  date_of_birth date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  owner_user_id uuid references public.users(id) on delete set null,
  title text not null,
  description text,
  status_code text not null default 'nowa',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_case_participants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.crm_cases(id) on delete cascade,
  person_id uuid not null references public.crm_client_people(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null default 'other' check (kind in ('bank', 'insurer', 'agency', 'developer', 'broker', 'other')),
  name text not null,
  tax_id text,
  contact_email text,
  contact_phone text,
  website text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_case_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.crm_cases(id) on delete cascade,
  product_type_id uuid not null references public.crm_product_types(id),
  owner_user_id uuid references public.users(id) on delete set null,
  title text not null,
  status_code text not null default 'kwalifikacja',
  amount_value numeric(14,2) check (amount_value is null or amount_value >= 0),
  currency char(3) not null default 'PLN',
  expected_close_date date,
  won_at timestamptz,
  lost_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_item_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_item_id uuid not null references public.crm_case_items(id) on delete cascade,
  provider_id uuid references public.crm_providers(id) on delete set null,
  status_code text not null default 'draft',
  external_reference text,
  submitted_at timestamptz,
  decision_at timestamptz,
  offered_amount numeric(14,2) check (offered_amount is null or offered_amount >= 0),
  premium_amount numeric(14,2) check (premium_amount is null or premium_amount >= 0),
  currency char(3) not null default 'PLN',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_case_item_settlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_item_id uuid not null references public.crm_case_items(id) on delete cascade,
  payer_provider_id uuid references public.crm_providers(id) on delete set null,
  status_code text not null default 'szacowane',
  expected_amount numeric(14,2) not null default 0 check (expected_amount >= 0),
  due_amount numeric(14,2) not null default 0 check (due_amount >= 0),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  currency char(3) not null default 'PLN',
  due_date date,
  paid_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  assignee_user_id uuid references public.users(id) on delete set null,
  client_id uuid references public.crm_clients(id) on delete cascade,
  case_id uuid references public.crm_cases(id) on delete cascade,
  case_item_id uuid references public.crm_case_items(id) on delete cascade,
  title text not null,
  description text,
  status_code text not null default 'open',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  client_id uuid references public.crm_clients(id) on delete cascade,
  case_id uuid references public.crm_cases(id) on delete cascade,
  case_item_id uuid references public.crm_case_items(id) on delete cascade,
  submission_id uuid references public.crm_item_submissions(id) on delete cascade,
  activity_type text not null,
  title text not null,
  body text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (num_nonnulls(client_id, case_id, case_item_id, submission_id) >= 1)
);

create table public.crm_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.crm_clients(id) on delete cascade,
  case_id uuid references public.crm_cases(id) on delete cascade,
  case_item_id uuid references public.crm_case_items(id) on delete cascade,
  submission_id uuid references public.crm_item_submissions(id) on delete cascade,
  document_type text not null default 'other',
  name text not null,
  status_code text not null default 'missing',
  storage_bucket text,
  storage_path text,
  received_at timestamptz,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(client_id, case_id, case_item_id, submission_id) >= 1)
);

create table public.crm_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.crm_cases(id) on delete cascade,
  case_item_id uuid references public.crm_case_items(id) on delete cascade,
  address text not null,
  city text,
  postal_code text,
  property_type text,
  market_type text check (market_type is null or market_type in ('primary', 'secondary', 'rental', 'other')),
  price_amount numeric(14,2) check (price_amount is null or price_amount >= 0),
  currency char(3) not null default 'PLN',
  area_m2 numeric(10,2) check (area_m2 is null or area_m2 >= 0),
  rooms numeric(4,1) check (rooms is null or rooms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(case_id, case_item_id) >= 1)
);

create unique index crm_product_types_system_code_key
  on public.crm_product_types(code)
  where organization_id is null;

create unique index crm_product_types_org_code_key
  on public.crm_product_types(organization_id, code)
  where organization_id is not null;

create unique index crm_workflows_system_code_key
  on public.crm_workflows(scope, code)
  where organization_id is null;

create unique index crm_workflows_org_code_key
  on public.crm_workflows(organization_id, scope, code)
  where organization_id is not null;

create unique index crm_workflow_statuses_workflow_code_key
  on public.crm_workflow_statuses(workflow_id, code);

create unique index crm_case_participants_case_person_role_key
  on public.crm_case_participants(case_id, person_id, role);

create unique index crm_case_item_settlements_case_item_key
  on public.crm_case_item_settlements(case_item_id);

create index crm_product_types_org_domain_idx on public.crm_product_types(organization_id, domain);
create index crm_workflows_org_scope_idx on public.crm_workflows(organization_id, scope);
create index crm_workflow_statuses_org_workflow_idx on public.crm_workflow_statuses(organization_id, workflow_id, sort_order);
create index crm_clients_org_status_idx on public.crm_clients(organization_id, status_code);
create index crm_clients_org_owner_idx on public.crm_clients(organization_id, owner_user_id);
create index crm_clients_org_updated_idx on public.crm_clients(organization_id, updated_at desc);
create index crm_client_people_org_client_idx on public.crm_client_people(organization_id, client_id);
create index crm_cases_org_status_idx on public.crm_cases(organization_id, status_code);
create index crm_cases_org_client_idx on public.crm_cases(organization_id, client_id);
create index crm_cases_org_owner_idx on public.crm_cases(organization_id, owner_user_id);
create index crm_cases_org_updated_idx on public.crm_cases(organization_id, updated_at desc);
create index crm_case_participants_org_case_idx on public.crm_case_participants(organization_id, case_id);
create index crm_providers_org_kind_idx on public.crm_providers(organization_id, kind);
create index crm_case_items_org_case_idx on public.crm_case_items(organization_id, case_id);
create index crm_case_items_org_status_idx on public.crm_case_items(organization_id, status_code);
create index crm_case_items_org_product_idx on public.crm_case_items(organization_id, product_type_id);
create index crm_item_submissions_org_item_idx on public.crm_item_submissions(organization_id, case_item_id);
create index crm_item_submissions_org_status_idx on public.crm_item_submissions(organization_id, status_code);
create index crm_item_submissions_org_provider_idx on public.crm_item_submissions(organization_id, provider_id);
create index crm_case_item_settlements_org_status_idx on public.crm_case_item_settlements(organization_id, status_code);
create index crm_case_item_settlements_org_due_idx on public.crm_case_item_settlements(organization_id, due_date);
create index crm_tasks_org_assignee_due_idx on public.crm_tasks(organization_id, assignee_user_id, due_at);
create index crm_tasks_org_status_idx on public.crm_tasks(organization_id, status_code);
create index crm_activities_org_case_created_idx on public.crm_activities(organization_id, case_id, created_at desc);
create index crm_activities_org_client_created_idx on public.crm_activities(organization_id, client_id, created_at desc);
create index crm_documents_org_case_idx on public.crm_documents(organization_id, case_id);
create index crm_documents_org_status_idx on public.crm_documents(organization_id, status_code);
create index crm_properties_org_case_idx on public.crm_properties(organization_id, case_id);

create trigger set_crm_product_types_updated_at before update on public.crm_product_types
  for each row execute function public.set_updated_at();
create trigger set_crm_workflows_updated_at before update on public.crm_workflows
  for each row execute function public.set_updated_at();
create trigger set_crm_workflow_statuses_updated_at before update on public.crm_workflow_statuses
  for each row execute function public.set_updated_at();
create trigger set_crm_clients_updated_at before update on public.crm_clients
  for each row execute function public.set_updated_at();
create trigger set_crm_client_people_updated_at before update on public.crm_client_people
  for each row execute function public.set_updated_at();
create trigger set_crm_cases_updated_at before update on public.crm_cases
  for each row execute function public.set_updated_at();
create trigger set_crm_case_participants_updated_at before update on public.crm_case_participants
  for each row execute function public.set_updated_at();
create trigger set_crm_providers_updated_at before update on public.crm_providers
  for each row execute function public.set_updated_at();
create trigger set_crm_case_items_updated_at before update on public.crm_case_items
  for each row execute function public.set_updated_at();
create trigger set_crm_item_submissions_updated_at before update on public.crm_item_submissions
  for each row execute function public.set_updated_at();
create trigger set_crm_case_item_settlements_updated_at before update on public.crm_case_item_settlements
  for each row execute function public.set_updated_at();
create trigger set_crm_tasks_updated_at before update on public.crm_tasks
  for each row execute function public.set_updated_at();
create trigger set_crm_documents_updated_at before update on public.crm_documents
  for each row execute function public.set_updated_at();
create trigger set_crm_properties_updated_at before update on public.crm_properties
  for each row execute function public.set_updated_at();

alter table public.crm_product_types enable row level security;
alter table public.crm_workflows enable row level security;
alter table public.crm_workflow_statuses enable row level security;
alter table public.crm_clients enable row level security;
alter table public.crm_client_people enable row level security;
alter table public.crm_cases enable row level security;
alter table public.crm_case_participants enable row level security;
alter table public.crm_providers enable row level security;
alter table public.crm_case_items enable row level security;
alter table public.crm_item_submissions enable row level security;
alter table public.crm_case_item_settlements enable row level security;
alter table public.crm_tasks enable row level security;
alter table public.crm_activities enable row level security;
alter table public.crm_documents enable row level security;
alter table public.crm_properties enable row level security;

create policy "crm product types are visible in org" on public.crm_product_types
  for select to authenticated
  using (organization_id is null or organization_id = (select private.current_organization_id()));
create policy "crm product types can be inserted in org" on public.crm_product_types
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()) and is_system = false);
create policy "crm product types can be updated in org" on public.crm_product_types
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()) and is_system = false);
create policy "crm product types can be deleted in org" on public.crm_product_types
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()) and is_system = false);

create policy "crm workflows are visible in org" on public.crm_workflows
  for select to authenticated
  using (organization_id is null or organization_id = (select private.current_organization_id()));
create policy "crm workflows can be inserted in org" on public.crm_workflows
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()) and is_system = false);
create policy "crm workflows can be updated in org" on public.crm_workflows
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()) and is_system = false);
create policy "crm workflows can be deleted in org" on public.crm_workflows
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()) and is_system = false);

create policy "crm workflow statuses are visible in org" on public.crm_workflow_statuses
  for select to authenticated
  using (organization_id is null or organization_id = (select private.current_organization_id()));
create policy "crm workflow statuses can be inserted in org" on public.crm_workflow_statuses
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm workflow statuses can be updated in org" on public.crm_workflow_statuses
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm workflow statuses can be deleted in org" on public.crm_workflow_statuses
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm clients are scoped to org" on public.crm_clients
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm clients can be inserted in org" on public.crm_clients
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm clients can be updated in org" on public.crm_clients
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm clients can be deleted in org" on public.crm_clients
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm client people are scoped to org" on public.crm_client_people
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm client people can be inserted in org" on public.crm_client_people
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm client people can be updated in org" on public.crm_client_people
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm client people can be deleted in org" on public.crm_client_people
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm cases are scoped to org" on public.crm_cases
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm cases can be inserted in org" on public.crm_cases
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm cases can be updated in org" on public.crm_cases
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm cases can be deleted in org" on public.crm_cases
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm case participants are scoped to org" on public.crm_case_participants
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm case participants can be inserted in org" on public.crm_case_participants
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm case participants can be updated in org" on public.crm_case_participants
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm case participants can be deleted in org" on public.crm_case_participants
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm providers are scoped to org" on public.crm_providers
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm providers can be inserted in org" on public.crm_providers
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm providers can be updated in org" on public.crm_providers
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm providers can be deleted in org" on public.crm_providers
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm case items are scoped to org" on public.crm_case_items
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm case items can be inserted in org" on public.crm_case_items
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm case items can be updated in org" on public.crm_case_items
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm case items can be deleted in org" on public.crm_case_items
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm submissions are scoped to org" on public.crm_item_submissions
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm submissions can be inserted in org" on public.crm_item_submissions
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm submissions can be updated in org" on public.crm_item_submissions
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm submissions can be deleted in org" on public.crm_item_submissions
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm settlements are scoped to org" on public.crm_case_item_settlements
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm settlements can be inserted in org" on public.crm_case_item_settlements
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm settlements can be updated in org" on public.crm_case_item_settlements
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm settlements can be deleted in org" on public.crm_case_item_settlements
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm tasks are scoped to org" on public.crm_tasks
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm tasks can be inserted in org" on public.crm_tasks
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm tasks can be updated in org" on public.crm_tasks
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm tasks can be deleted in org" on public.crm_tasks
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm activities are scoped to org" on public.crm_activities
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm activities can be inserted in org" on public.crm_activities
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm activities can be updated in org" on public.crm_activities
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm activities can be deleted in org" on public.crm_activities
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm documents are scoped to org" on public.crm_documents
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm documents can be inserted in org" on public.crm_documents
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm documents can be updated in org" on public.crm_documents
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm documents can be deleted in org" on public.crm_documents
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

create policy "crm properties are scoped to org" on public.crm_properties
  for select to authenticated
  using (organization_id = (select private.current_organization_id()));
create policy "crm properties can be inserted in org" on public.crm_properties
  for insert to authenticated
  with check (organization_id = (select private.current_organization_id()));
create policy "crm properties can be updated in org" on public.crm_properties
  for update to authenticated
  using (organization_id = (select private.current_organization_id()))
  with check (organization_id = (select private.current_organization_id()));
create policy "crm properties can be deleted in org" on public.crm_properties
  for delete to authenticated
  using (organization_id = (select private.current_organization_id()));

insert into public.crm_product_types (id, organization_id, domain, code, name, description, is_system)
values
  ('00000000-0000-4000-8000-000000001001', null, 'credit', 'credit_mortgage', 'Kredyt hipoteczny', 'Finansowanie zakupu lub budowy nieruchomosci.', true),
  ('00000000-0000-4000-8000-000000001002', null, 'credit', 'credit_cash', 'Kredyt gotowkowy', 'Finansowanie bez zabezpieczenia hipotecznego.', true),
  ('00000000-0000-4000-8000-000000001003', null, 'credit', 'credit_consolidation', 'Kredyt konsolidacyjny', 'Polaczenie zobowiazan klienta.', true),
  ('00000000-0000-4000-8000-000000001004', null, 'credit', 'credit_business', 'Kredyt firmowy', 'Finansowanie dzialalnosci gospodarczej.', true),
  ('00000000-0000-4000-8000-000000002001', null, 'insurance', 'insurance_life', 'Ubezpieczenie zycie', 'Ochrona zycia lub zdrowia klienta.', true),
  ('00000000-0000-4000-8000-000000002002', null, 'insurance', 'insurance_property', 'Ubezpieczenie nieruchomosci', 'Polisa nieruchomosci, czesto powiazana z kredytem.', true),
  ('00000000-0000-4000-8000-000000002003', null, 'insurance', 'insurance_motor', 'Ubezpieczenie komunikacyjne', 'OC, AC i produkty komunikacyjne.', true),
  ('00000000-0000-4000-8000-000000002004', null, 'insurance', 'insurance_business', 'Ubezpieczenie firmowe', 'Ochrona majatku i ryzyk firmowych.', true),
  ('00000000-0000-4000-8000-000000002005', null, 'insurance', 'insurance_travel', 'Ubezpieczenie podrozne', 'Polisa na wyjazd prywatny lub sluzbowy.', true),
  ('00000000-0000-4000-8000-000000002006', null, 'insurance', 'insurance_credit_linked', 'Ubezpieczenie pod kredyt', 'Produkt ubezpieczeniowy wymagany lub rekomendowany przy kredycie.', true),
  ('00000000-0000-4000-8000-000000003001', null, 'real_estate', 'real_estate_purchase', 'Zakup nieruchomosci', 'Proces zakupu nieruchomosci przez klienta.', true),
  ('00000000-0000-4000-8000-000000003002', null, 'real_estate', 'real_estate_sale', 'Sprzedaz nieruchomosci', 'Proces sprzedazy nieruchomosci klienta.', true),
  ('00000000-0000-4000-8000-000000003003', null, 'real_estate', 'real_estate_rent', 'Najem nieruchomosci', 'Proces najmu lub wynajmu nieruchomosci.', true),
  ('00000000-0000-4000-8000-000000003004', null, 'real_estate', 'real_estate_investment', 'Inwestycja w nieruchomosci', 'Analiza i prowadzenie zakupu inwestycyjnego.', true);

insert into public.crm_workflows (id, organization_id, scope, domain, code, name, is_default, is_system)
values
  ('00000000-0000-4000-8000-000000000101', null, 'case', null, 'case_default', 'Sprawa', true, true),
  ('00000000-0000-4000-8000-000000000201', null, 'case_item', 'credit', 'case_item_credit', 'Produkt kredytowy', true, true),
  ('00000000-0000-4000-8000-000000000202', null, 'case_item', 'insurance', 'case_item_insurance', 'Produkt ubezpieczeniowy', true, true),
  ('00000000-0000-4000-8000-000000000203', null, 'case_item', 'real_estate', 'case_item_real_estate', 'Produkt nieruchomosciowy', true, true),
  ('00000000-0000-4000-8000-000000000301', null, 'submission', null, 'submission_default', 'Zgloszenie do instytucji', true, true),
  ('00000000-0000-4000-8000-000000000401', null, 'settlement', null, 'settlement_default', 'Rozliczenie prowizji', true, true);

insert into public.crm_workflow_statuses (organization_id, workflow_id, code, label, color, sort_order, is_initial, is_terminal)
values
  (null, '00000000-0000-4000-8000-000000000101', 'nowa', 'Nowa', 'neutral', 10, true, false),
  (null, '00000000-0000-4000-8000-000000000101', 'analiza', 'Analiza', 'info', 20, false, false),
  (null, '00000000-0000-4000-8000-000000000101', 'aktywna', 'Aktywna', 'success', 30, false, false),
  (null, '00000000-0000-4000-8000-000000000101', 'czeka_na_klienta', 'Czeka na klienta', 'warning', 40, false, false),
  (null, '00000000-0000-4000-8000-000000000101', 'zakonczona', 'Zakonczona', 'success', 90, false, true),
  (null, '00000000-0000-4000-8000-000000000101', 'utracona', 'Utracona', 'error', 95, false, true),
  (null, '00000000-0000-4000-8000-000000000101', 'archiwum', 'Archiwum', 'neutral', 100, false, true),
  (null, '00000000-0000-4000-8000-000000000201', 'kwalifikacja', 'Kwalifikacja', 'neutral', 10, true, false),
  (null, '00000000-0000-4000-8000-000000000201', 'dokumenty', 'Dokumenty', 'warning', 20, false, false),
  (null, '00000000-0000-4000-8000-000000000201', 'oferty', 'Oferty', 'info', 30, false, false),
  (null, '00000000-0000-4000-8000-000000000201', 'wnioski_wyslane', 'Wnioski wyslane', 'info', 40, false, false),
  (null, '00000000-0000-4000-8000-000000000201', 'decyzja', 'Decyzja', 'warning', 50, false, false),
  (null, '00000000-0000-4000-8000-000000000201', 'umowa', 'Umowa', 'success', 60, false, false),
  (null, '00000000-0000-4000-8000-000000000201', 'uruchomiony', 'Uruchomiony', 'success', 90, false, true),
  (null, '00000000-0000-4000-8000-000000000201', 'utracony', 'Utracony', 'error', 95, false, true),
  (null, '00000000-0000-4000-8000-000000000202', 'analiza_potrzeb', 'Analiza potrzeb', 'neutral', 10, true, false),
  (null, '00000000-0000-4000-8000-000000000202', 'oferty', 'Oferty', 'info', 20, false, false),
  (null, '00000000-0000-4000-8000-000000000202', 'wybrana_oferta', 'Wybrana oferta', 'warning', 30, false, false),
  (null, '00000000-0000-4000-8000-000000000202', 'polisa_wystawiona', 'Polisa wystawiona', 'success', 50, false, false),
  (null, '00000000-0000-4000-8000-000000000202', 'aktywna', 'Aktywna', 'success', 90, false, true),
  (null, '00000000-0000-4000-8000-000000000202', 'odnowienie', 'Odnowienie', 'warning', 95, false, false),
  (null, '00000000-0000-4000-8000-000000000202', 'utracona', 'Utracona', 'error', 100, false, true),
  (null, '00000000-0000-4000-8000-000000000203', 'przyjecie', 'Przyjecie', 'neutral', 10, true, false),
  (null, '00000000-0000-4000-8000-000000000203', 'poszukiwanie_lub_listing', 'Poszukiwanie lub listing', 'info', 20, false, false),
  (null, '00000000-0000-4000-8000-000000000203', 'prezentacje', 'Prezentacje', 'info', 30, false, false),
  (null, '00000000-0000-4000-8000-000000000203', 'negocjacje', 'Negocjacje', 'warning', 40, false, false),
  (null, '00000000-0000-4000-8000-000000000203', 'umowa', 'Umowa', 'success', 60, false, false),
  (null, '00000000-0000-4000-8000-000000000203', 'zamknieta', 'Zamknieta', 'success', 90, false, true),
  (null, '00000000-0000-4000-8000-000000000203', 'utracona', 'Utracona', 'error', 95, false, true),
  (null, '00000000-0000-4000-8000-000000000301', 'draft', 'Draft', 'neutral', 10, true, false),
  (null, '00000000-0000-4000-8000-000000000301', 'wyslane', 'Wyslane', 'info', 20, false, false),
  (null, '00000000-0000-4000-8000-000000000301', 'w_analizie', 'W analizie', 'warning', 30, false, false),
  (null, '00000000-0000-4000-8000-000000000301', 'braki', 'Braki', 'warning', 40, false, false),
  (null, '00000000-0000-4000-8000-000000000301', 'zaakceptowane', 'Zaakceptowane', 'success', 80, false, true),
  (null, '00000000-0000-4000-8000-000000000301', 'odrzucone', 'Odrzucone', 'error', 90, false, true),
  (null, '00000000-0000-4000-8000-000000000301', 'wycofane', 'Wycofane', 'neutral', 95, false, true),
  (null, '00000000-0000-4000-8000-000000000401', 'szacowane', 'Szacowane', 'neutral', 10, true, false),
  (null, '00000000-0000-4000-8000-000000000401', 'oczekiwane', 'Oczekiwane', 'info', 20, false, false),
  (null, '00000000-0000-4000-8000-000000000401', 'nalezne', 'Nalezne', 'warning', 30, false, false),
  (null, '00000000-0000-4000-8000-000000000401', 'zaplacone', 'Zaplacone', 'success', 90, false, true),
  (null, '00000000-0000-4000-8000-000000000401', 'anulowane', 'Anulowane', 'neutral', 95, false, true),
  (null, '00000000-0000-4000-8000-000000000401', 'sporne', 'Sporne', 'error', 100, false, false);
