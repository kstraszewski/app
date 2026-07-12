-- organizations: jedna instancja = jedna organizacja z wieloma ekspertami
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

-- users: profil eksperta powiązany z auth.users
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'expert' check (role in ('expert', 'admin')),
  created_at timestamptz not null default now()
);

create index users_organization_id_idx on public.users(organization_id);

-- Public waitlist is written through the landing server API using the
-- server-only Supabase key. Anonymous browser clients have no table policy.
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(trim(email))),
  survey_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.waitlist enable row level security;

-- helper: zwraca organization_id aktualnego użytkownika
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.users where id = auth.uid() limit 1;
$$;

-- policies: widzisz tylko swoją organizację
create policy "users see own org" on public.organizations
  for select using (id = public.current_organization_id());

create policy "users see own profile and org members" on public.users
  for select using (organization_id = public.current_organization_id());
