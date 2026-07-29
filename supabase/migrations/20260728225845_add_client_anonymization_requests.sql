create table public.crm_client_anonymization_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null,
  subject_person_id uuid not null,
  idempotency_key uuid not null,
  request_number text not null,
  status text not null default 'received',
  request_channel text not null,
  legal_basis text not null default 'RODO art. 17',
  requested_at timestamptz not null,
  identity_verified_at timestamptz,
  identity_verified_by_user_id uuid,
  approved_at timestamptz,
  approved_by_user_id uuid,
  due_at timestamptz not null,
  justification text not null,
  review_note text,
  completed_at timestamptz,
  completed_by_user_id uuid,
  created_by_user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_client_anonymization_requests_organization_client_fkey
    foreign key (organization_id, client_id)
    references public.crm_clients(organization_id, id),
  constraint crm_client_anonymization_requests_subject_person_fkey
    foreign key (organization_id, client_id, subject_person_id)
    references public.crm_client_people(organization_id, client_id, id),
  constraint crm_client_anonymization_requests_identity_verifier_fkey
    foreign key (organization_id, identity_verified_by_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint crm_client_anonymization_requests_approver_fkey
    foreign key (organization_id, approved_by_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint crm_client_anonymization_requests_completed_by_fkey
    foreign key (organization_id, completed_by_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint crm_client_anonymization_requests_created_by_fkey
    foreign key (organization_id, created_by_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint crm_client_anonymization_requests_number_unique
    unique (organization_id, request_number),
  constraint crm_client_anonymization_requests_organization_id_id_key
    unique (organization_id, id),
  constraint crm_client_anonymization_requests_idempotency_key_unique
    unique (organization_id, idempotency_key),
  constraint crm_client_anonymization_requests_number_not_blank
    check (char_length(btrim(request_number)) between 5 and 80),
  constraint crm_client_anonymization_requests_status_valid
    check (status in (
      'received',
      'identity_verification',
      'legal_review',
      'approved',
      'in_progress',
      'completed',
      'rejected',
      'cancelled'
    )),
  constraint crm_client_anonymization_requests_channel_valid
    check (request_channel in ('email', 'phone', 'in_person', 'letter', 'other')),
  constraint crm_client_anonymization_requests_timeline_valid
    check (
      due_at >= requested_at
      and (identity_verified_at is null) = (identity_verified_by_user_id is null)
      and (approved_at is null) = (approved_by_user_id is null)
      and (completed_at is null) = (completed_by_user_id is null)
      and (
        status not in ('approved', 'in_progress', 'completed')
        or (identity_verified_at is not null and approved_at is not null)
      )
      and (
        status <> 'completed'
        or completed_at is not null
      )
    ),
  constraint crm_client_anonymization_requests_metadata_object
    check (jsonb_typeof(metadata) = 'object')
);

create index crm_client_anonymization_requests_client_idx
  on public.crm_client_anonymization_requests(
    organization_id,
    client_id,
    requested_at desc
  );

create index crm_client_anonymization_requests_queue_idx
  on public.crm_client_anonymization_requests(
    organization_id,
    status,
    due_at
  )
  where status in (
    'received',
    'identity_verification',
    'legal_review',
    'approved',
    'in_progress'
  );

create unique index crm_client_anonymization_requests_one_active_idx
  on public.crm_client_anonymization_requests(organization_id, subject_person_id)
  where status in (
    'received',
    'identity_verification',
    'legal_review',
    'approved',
    'in_progress'
  );

create trigger crm_client_anonymization_requests_set_updated_at
  before update on public.crm_client_anonymization_requests
  for each row execute function public.set_updated_at();

create or replace function private.protect_crm_client_anonymization_request_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    new.organization_id,
    new.client_id,
    new.subject_person_id,
    new.idempotency_key,
    new.request_number,
    new.requested_at,
    new.created_by_user_id,
    new.created_at
  ) is distinct from row(
    old.organization_id,
    old.client_id,
    old.subject_person_id,
    old.idempotency_key,
    old.request_number,
    old.requested_at,
    old.created_by_user_id,
    old.created_at
  ) then
    raise exception 'crm_client_anonymization_request_identity_is_immutable'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_crm_client_anonymization_request_identity()
from public, anon, authenticated;

create trigger crm_client_anonymization_requests_protect_identity
  before update on public.crm_client_anonymization_requests
  for each row execute function private.protect_crm_client_anonymization_request_identity();

create table public.crm_client_anonymization_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_user_id uuid not null,
  reason_code text,
  evidence_reference text,
  created_at timestamptz not null default now(),
  constraint crm_client_anonymization_request_events_request_fkey
    foreign key (organization_id, request_id)
    references public.crm_client_anonymization_requests(organization_id, id),
  constraint crm_client_anonymization_request_events_actor_fkey
    foreign key (organization_id, actor_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint crm_client_anonymization_request_events_type_valid
    check (event_type in (
      'request_received',
      'identity_verified',
      'legal_review_started',
      'approved',
      'execution_started',
      'completed',
      'rejected',
      'cancelled'
    )),
  constraint crm_client_anonymization_request_events_statuses_valid
    check (
      (from_status is null or from_status in (
        'received',
        'identity_verification',
        'legal_review',
        'approved',
        'in_progress',
        'completed',
        'rejected',
        'cancelled'
      ))
      and
      (to_status is null or to_status in (
        'received',
        'identity_verification',
        'legal_review',
        'approved',
        'in_progress',
        'completed',
        'rejected',
        'cancelled'
      ))
    )
);

create index crm_client_anonymization_request_events_request_idx
  on public.crm_client_anonymization_request_events(
    organization_id,
    request_id,
    created_at,
    id
  );

create index crm_client_anonymization_request_events_actor_idx
  on public.crm_client_anonymization_request_events(actor_user_id);

create or replace function private.protect_crm_client_anonymization_request_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'crm_client_anonymization_request_events_are_append_only'
    using errcode = '55000';
end;
$$;

revoke all on function private.protect_crm_client_anonymization_request_event()
from public, anon, authenticated;

create trigger crm_client_anonymization_request_events_protect_append_only
  before update or delete on public.crm_client_anonymization_request_events
  for each row execute function private.protect_crm_client_anonymization_request_event();

alter table public.crm_client_anonymization_requests enable row level security;
alter table public.crm_client_anonymization_request_events enable row level security;

create policy crm_client_anonymization_requests_admin_read
  on public.crm_client_anonymization_requests
  for select to authenticated
  using ((select private.is_organization_admin(organization_id)));

create policy crm_client_anonymization_request_events_admin_read
  on public.crm_client_anonymization_request_events
  for select to authenticated
  using ((select private.is_organization_admin(organization_id)));

revoke all on table public.crm_client_anonymization_requests
from anon, authenticated;

revoke all on table public.crm_client_anonymization_request_events
from anon, authenticated;

grant select on table public.crm_client_anonymization_requests
to authenticated;

grant select on table public.crm_client_anonymization_request_events
to authenticated;

grant all privileges on table public.crm_client_anonymization_requests
to service_role;

grant all privileges on table public.crm_client_anonymization_request_events
to service_role;

comment on table public.crm_client_anonymization_requests is
  'Compliance workflow for client data-erasure requests. Actual anonymization requires a separately authorized execution path.';

comment on column public.crm_client_anonymization_requests.request_number is
  'Organization-scoped technical reference; it must not contain client PII.';

comment on column public.crm_client_anonymization_requests.metadata is
  'Technical workflow metadata only. Do not duplicate client PII in this field.';

comment on table public.crm_client_anonymization_request_events is
  'Append-only compliance history for client anonymization requests.';

comment on column public.crm_client_anonymization_request_events.evidence_reference is
  'Non-PII technical pointer to evidence stored under an approved retention policy.';
