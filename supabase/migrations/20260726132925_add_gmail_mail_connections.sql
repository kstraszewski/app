-- Gmail OAuth credentials are application-encrypted before storage. The
-- browser never receives tokens and authenticated users have no direct table
-- privileges; Nitro endpoints mediate access with service_role after checking
-- the current organization membership.
create table public.mail_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_user_id uuid not null,
  provider text not null default 'google' check (provider = 'google'),
  account_id text not null check (btrim(account_id) <> ''),
  account_email text not null check (
    btrim(account_email) <> ''
    and account_email = lower(btrim(account_email))
  ),
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'error', 'revoked')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint mail_connections_owner_fkey
    foreign key (organization_id, owner_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade
);

create unique index mail_connections_owner_provider_key
  on public.mail_connections(organization_id, owner_user_id, provider);

alter table public.mail_connections enable row level security;

revoke all on table public.mail_connections from public, anon, authenticated;
grant all privileges on table public.mail_connections to service_role;

create trigger mail_connections_set_updated_at
  before update on public.mail_connections
  for each row execute function public.set_updated_at();

comment on table public.mail_connections is
  'Server-only, application-encrypted OAuth credentials for personal Gmail integrations.';
