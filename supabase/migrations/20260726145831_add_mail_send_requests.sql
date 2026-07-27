-- A connection lookup must include both the organization and its owner. This
-- unique index is the referenced key for the defensive composite foreign key
-- below; it prevents a request from being attached to another user's account.
create unique index mail_connections_org_owner_id_key
  on public.mail_connections(organization_id, owner_user_id, id);

-- Server-only idempotency and delivery-state metadata for Gmail sends. Message
-- recipients, subjects, bodies, attachment names, and other message content
-- are deliberately never persisted here.
create table public.mail_send_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  owner_user_id uuid not null,
  connection_id uuid not null,
  idempotency_key uuid not null,
  request_hash text not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  message_id_header text not null
    check (
      btrim(message_id_header) <> ''
      and message_id_header !~ E'[\r\n]'
    ),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'unknown', 'failed')),
  provider_message_id text,
  provider_thread_id text,
  attempts integer not null default 1
    check (attempts >= 1),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mail_send_requests_membership_fkey
    foreign key (organization_id, owner_user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  constraint mail_send_requests_connection_fkey
    foreign key (organization_id, owner_user_id, connection_id)
    references public.mail_connections(organization_id, owner_user_id, id)
    on delete cascade,
  constraint mail_send_requests_idempotency_key
    unique (organization_id, owner_user_id, idempotency_key)
);

alter table public.mail_send_requests enable row level security;

revoke all on table public.mail_send_requests from public, anon, authenticated;
grant all privileges on table public.mail_send_requests to service_role;

create trigger mail_send_requests_set_updated_at
  before update on public.mail_send_requests
  for each row execute function public.set_updated_at();

comment on table public.mail_send_requests is
  'Server-only Gmail send idempotency and delivery-state metadata; never stores recipients, subjects, bodies, or attachment filenames.';
