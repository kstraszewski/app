-- Bind durable Eve sessions to the authenticated CRM user and organization.
-- Route authentication verifies this table before a session can be resumed,
-- streamed, or cancelled by another request.

create table public.crm_eve_sessions (
  session_id text primary key
    check (btrim(session_id) <> '' and length(session_id) <= 256),
  organization_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_eve_sessions_organization_member_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade
);

create index crm_eve_sessions_user_organization_idx
  on public.crm_eve_sessions(user_id, organization_id, updated_at desc);

create trigger crm_eve_sessions_set_updated_at
  before update on public.crm_eve_sessions
  for each row execute function public.set_updated_at();

alter table public.crm_eve_sessions enable row level security;

create policy crm_eve_sessions_owner_read
  on public.crm_eve_sessions
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.is_organization_member(organization_id)
  );

revoke all on table public.crm_eve_sessions from public, anon, authenticated;
grant select on table public.crm_eve_sessions to authenticated;
grant all privileges on table public.crm_eve_sessions to service_role;

comment on table public.crm_eve_sessions is
  'Ownership registry for durable Eve sessions used by the authenticated CRM assistant.';
