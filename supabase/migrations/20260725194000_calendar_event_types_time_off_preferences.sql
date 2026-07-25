-- Calendar entry types, per-organization scheduling preferences and native
-- expert time off. Physical/online client meetings remain appointments; time
-- off is deliberately separate because it has no client or booking service.

alter table public.appointments
  add column meeting_mode text not null default 'office',
  add column meeting_url text;

alter table public.appointments
  add constraint appointments_meeting_mode_check
    check (meeting_mode in ('office', 'online')),
  add constraint appointments_meeting_url_check
    check (
      meeting_url is null
      or (
        meeting_url = btrim(meeting_url)
        and length(meeting_url) between 8 and 2048
        and meeting_url ~* '^https?://[^[:space:]]+$'
      )
    ),
  add constraint appointments_meeting_shape_check
    check (
      (meeting_mode = 'office' and meeting_url is null)
      or meeting_mode = 'online'
    );

comment on column public.appointments.meeting_mode is
  'Client meeting delivery mode. Facility remains the scheduling, authorization and reporting context for both modes.';
comment on column public.appointments.meeting_url is
  'Optional HTTP(S) join URL for online meetings. Access tokens and provider secrets must not be stored here.';

create table public.organization_user_preferences (
  organization_id uuid not null,
  user_id uuid not null,
  default_facility_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id),
  constraint organization_user_preferences_membership_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id)
    on delete cascade,
  constraint organization_user_preferences_default_facility_fkey
    foreign key (organization_id, default_facility_id)
    references public.facilities(organization_id, id)
    on delete set null (default_facility_id)
);

create index organization_user_preferences_default_facility_idx
  on public.organization_user_preferences(
    organization_id,
    default_facility_id
  )
  where default_facility_id is not null;

comment on table public.organization_user_preferences is
  'Scheduling preferences scoped to one organization membership. Endpoint authorization decides which organization facility the user may select.';

create table public.expert_time_off (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  expert_user_id uuid not null,
  kind text not null default 'vacation'
    check (kind in ('vacation')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  time_off_period tstzrange generated always as (
    tstzrange(starts_at, ends_at, '[)')
  ) stored,
  timezone text not null check (btrim(timezone) <> ''),
  all_day boolean not null default true,
  status text not null default 'active'
    check (status in ('active', 'cancelled')),
  notes text check (notes is null or length(notes) <= 2000),
  created_by_user_id uuid not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint expert_time_off_expert_membership_fkey
    foreign key (organization_id, expert_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint expert_time_off_creator_membership_fkey
    foreign key (organization_id, created_by_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint expert_time_off_valid_period_check
    check (starts_at < ends_at),
  constraint expert_time_off_all_day_check
    check (all_day),
  constraint expert_time_off_calendar_boundaries_check
    check (
      starts_at = (
        ((starts_at at time zone timezone)::date)::timestamp
        at time zone timezone
      )
      and ends_at = (
        ((ends_at at time zone timezone)::date)::timestamp
        at time zone timezone
      )
    ),
  constraint expert_time_off_cancellation_shape_check
    check (
      (status = 'active' and cancelled_at is null)
      or (status = 'cancelled' and cancelled_at is not null)
    )
);

create index expert_time_off_expert_start_idx
  on public.expert_time_off(
    organization_id,
    expert_user_id,
    starts_at
  );
create index expert_time_off_active_calendar_idx
  on public.expert_time_off(
    organization_id,
    starts_at,
    expert_user_id
  )
  where status = 'active';
create index expert_time_off_active_period_idx
  on public.expert_time_off
  using gist (organization_id, expert_user_id, time_off_period)
  where status = 'active';

comment on table public.expert_time_off is
  'Native expert absences. Active rows reserve the expert globally through appointment_resource_reservations.';
comment on column public.expert_time_off.all_day is
  'Presentation intent. starts_at and ends_at remain authoritative half-open instants, including across DST changes.';

create trigger organization_user_preferences_set_updated_at
  before update on public.organization_user_preferences
  for each row execute function public.set_updated_at();

create trigger expert_time_off_set_updated_at
  before update on public.expert_time_off
  for each row execute function public.set_updated_at();

create trigger expert_time_off_validate_timezone
  before insert or update of timezone on public.expert_time_off
  for each row execute function private.validate_facility_timezone();

-- Reuse the existing resource-reservation exclusion constraint so an
-- appointment and time-off row cannot race each other into the same expert
-- period. Existing appointment-owned reservations remain fully compatible.
alter table public.appointment_resource_reservations
  alter column appointment_id drop not null,
  add column time_off_id uuid,
  add constraint appointment_resource_reservations_parent_check
    check (num_nonnulls(appointment_id, time_off_id) = 1),
  add constraint appointment_resource_reservations_time_off_fkey
    foreign key (organization_id, time_off_id)
    references public.expert_time_off(organization_id, id)
    on delete cascade;

create unique index appointment_resource_reservations_time_off_owner_key
  on public.appointment_resource_reservations(
    organization_id,
    time_off_id,
    resource_type,
    resource_id
  )
  where time_off_id is not null;

comment on column public.appointment_resource_reservations.appointment_id is
  'Appointment parent. Exactly one of appointment_id and time_off_id must be present.';
comment on column public.appointment_resource_reservations.time_off_id is
  'Native time-off parent. Exactly one of appointment_id and time_off_id must be present.';

create or replace function private.sync_expert_time_off_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform private.release_expired_booking_holds();
  end if;

  if tg_op = 'UPDATE'
     and old.expert_user_id is distinct from new.expert_user_id then
    delete from public.appointment_resource_reservations reservation
    where reservation.organization_id = old.organization_id
      and reservation.time_off_id = old.id
      and reservation.resource_type = 'expert'
      and reservation.resource_id = old.expert_user_id;
  end if;

  insert into public.appointment_resource_reservations (
    organization_id,
    appointment_id,
    time_off_id,
    resource_type,
    resource_id,
    busy_period,
    status,
    hold_expires_at
  ) values (
    new.organization_id,
    null,
    new.id,
    'expert',
    new.expert_user_id,
    new.time_off_period,
    case when new.status = 'active' then 'confirmed' else 'cancelled' end,
    null
  )
  on conflict (
    organization_id,
    time_off_id,
    resource_type,
    resource_id
  ) where time_off_id is not null
  do update set
    busy_period = excluded.busy_period,
    status = excluded.status,
    hold_expires_at = null,
    updated_at = now();

  return new;
end;
$$;

create trigger expert_time_off_sync_reservation
  after insert or update of expert_user_id, starts_at, ends_at, status
  on public.expert_time_off
  for each row execute function private.sync_expert_time_off_reservation();

revoke all on function private.sync_expert_time_off_reservation()
  from public, anon, authenticated, service_role;

-- The staff response is extended in place, so both RPC signatures return the
-- same representation.
create or replace function private.staff_booking_result(target_appointment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', appointment.id,
      'organizationId', appointment.organization_id,
      'facilityId', appointment.facility_id,
      'serviceId', appointment.service_id,
      'expertUserId', appointment.expert_user_id,
      'clientId', appointment.client_id,
      'clientPersonId', appointment.client_person_id,
      'startsAt', appointment.starts_at,
      'endsAt', appointment.ends_at,
      'timezone', appointment.timezone,
      'status', appointment.status,
      'source', appointment.source,
      'meetingMode', appointment.meeting_mode,
      'meetingUrl', appointment.meeting_url,
      'customerName', appointment.customer_name,
      'customerEmail', appointment.customer_email,
      'customerPhone', appointment.customer_phone,
      'notes', appointment.notes,
      'createdByUserId', appointment.created_by_user_id,
      'createdAt', appointment.created_at
    )
  )
  from public.appointments appointment
  where appointment.id = target_appointment_id;
$$;

create function public.create_staff_appointment(
  p_organization_id uuid,
  p_facility_id uuid,
  p_service_id uuid,
  p_expert_user_id uuid,
  p_client_id uuid,
  p_client_person_id uuid,
  p_starts_at timestamptz,
  p_notes text,
  p_created_by_user_id uuid,
  p_idempotency_key text,
  p_meeting_mode text,
  p_meeting_url text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  facility_timezone text;
  service_duration_minutes integer;
  normalized_meeting_url text;
  client_record public.crm_clients;
  person_record public.crm_client_people;
  inserted_appointment public.appointments;
  existing_appointment public.appointments;
begin
  normalized_meeting_url := nullif(btrim(p_meeting_url), '');

  if p_starts_at is null
     or p_client_id is null
     or p_created_by_user_id is null
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or (p_notes is not null and length(btrim(p_notes)) > 2000)
     or p_meeting_mode is null
     or p_meeting_mode not in ('office', 'online')
     or (
       p_meeting_mode = 'office'
       and normalized_meeting_url is not null
     )
     or (
       p_meeting_mode = 'online'
       and normalized_meeting_url is not null
       and (
         length(normalized_meeting_url) > 2048
         or normalized_meeting_url !~* '^https?://[^[:space:]]+$'
       )
     ) then
    raise exception 'invalid_staff_booking_request' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_created_by_user_id
      and (
        membership.role = 'admin'
        or exists (
          select 1
          from public.facility_memberships facility_membership
          where facility_membership.organization_id = p_organization_id
            and facility_membership.facility_id = p_facility_id
            and facility_membership.user_id = p_created_by_user_id
        )
        or exists (
          select 1
          from public.team_facilities team_facility
          join public.team_memberships team_membership
            on team_membership.organization_id = team_facility.organization_id
           and team_membership.team_id = team_facility.team_id
           and team_membership.user_id = p_created_by_user_id
          where team_facility.organization_id = p_organization_id
            and team_facility.facility_id = p_facility_id
        )
      )
  ) then
    raise exception 'facility_membership_required' using errcode = '42501';
  end if;

  select facility.timezone, service.duration_minutes
  into facility_timezone, service_duration_minutes
  from public.facilities facility
  join public.facility_services facility_service
    on facility_service.organization_id = facility.organization_id
   and facility_service.facility_id = facility.id
   and facility_service.service_id = p_service_id
   and facility_service.is_active
  join public.booking_services service
    on service.organization_id = facility_service.organization_id
   and service.id = facility_service.service_id
   and service.is_active
  join public.facility_service_experts service_expert
    on service_expert.organization_id = facility_service.organization_id
   and service_expert.facility_id = facility_service.facility_id
   and service_expert.service_id = facility_service.service_id
   and service_expert.user_id = p_expert_user_id
   and service_expert.is_active
  join public.facility_memberships expert_membership
    on expert_membership.organization_id = service_expert.organization_id
   and expert_membership.facility_id = service_expert.facility_id
   and expert_membership.user_id = service_expert.user_id
   and expert_membership.is_bookable
  where facility.organization_id = p_organization_id
    and facility.id = p_facility_id
    and facility.is_active;

  if not found then
    raise exception 'expert_not_bookable_for_service' using errcode = '23503';
  end if;

  select client.*
  into client_record
  from public.crm_clients client
  where client.organization_id = p_organization_id
    and client.id = p_client_id;

  if not found then
    raise exception 'crm_client_not_found' using errcode = 'P0002';
  end if;

  if p_client_person_id is not null then
    select person.*
    into person_record
    from public.crm_client_people person
    where person.organization_id = p_organization_id
      and person.client_id = p_client_id
      and person.id = p_client_person_id;

    if not found then
      raise exception 'crm_client_person_not_found' using errcode = '23503';
    end if;
  else
    select person.*
    into person_record
    from public.crm_client_people person
    where person.organization_id = p_organization_id
      and person.client_id = p_client_id
    order by (person.role = 'primary') desc, person.created_at, person.id
    limit 1;
  end if;

  if person_record.id is null then
    raise exception 'crm_client_person_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'openexpert-staff-booking:' || p_organization_id::text || ':'
      || p_created_by_user_id::text || ':' || btrim(p_idempotency_key),
    0
  ));

  select appointment.*
  into existing_appointment
  from public.appointments appointment
  where appointment.organization_id = p_organization_id
    and appointment.created_by_user_id = p_created_by_user_id
    and appointment.source = 'staff'
    and appointment.idempotency_key = btrim(p_idempotency_key);

  if found then
    if existing_appointment.facility_id = p_facility_id
       and existing_appointment.service_id = p_service_id
       and existing_appointment.expert_user_id = p_expert_user_id
       and existing_appointment.client_id = p_client_id
       and (
         p_client_person_id is null
         or existing_appointment.client_person_id = p_client_person_id
       )
       and existing_appointment.starts_at = p_starts_at
       and existing_appointment.notes is not distinct from nullif(btrim(p_notes), '')
       and existing_appointment.meeting_mode = p_meeting_mode
       and existing_appointment.meeting_url is not distinct from normalized_meeting_url then
      return private.staff_booking_result(existing_appointment.id);
    end if;

    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  perform private.release_expired_booking_holds();

  if not private.expert_slot_is_available(
    p_organization_id,
    p_facility_id,
    p_service_id,
    p_expert_user_id,
    p_starts_at
  ) then
    raise exception 'booking_slot_conflict'
      using errcode = '23P01',
            constraint = 'appointment_expert_reservations_no_overlap';
  end if;

  insert into public.appointments (
    organization_id,
    facility_id,
    service_id,
    expert_user_id,
    client_id,
    client_person_id,
    starts_at,
    ends_at,
    timezone,
    status,
    confirmed_at,
    customer_name,
    customer_email,
    customer_phone,
    notes,
    source,
    idempotency_key,
    created_by_user_id,
    meeting_mode,
    meeting_url
  ) values (
    p_organization_id,
    p_facility_id,
    p_service_id,
    p_expert_user_id,
    p_client_id,
    person_record.id,
    p_starts_at,
    p_starts_at + make_interval(mins => service_duration_minutes),
    facility_timezone,
    'confirmed',
    now(),
    coalesce(person_record.display_name, client_record.display_name),
    lower(nullif(btrim(coalesce(person_record.email, client_record.primary_email)), '')),
    nullif(btrim(coalesce(person_record.phone, client_record.primary_phone)), ''),
    nullif(btrim(p_notes), ''),
    'staff',
    btrim(p_idempotency_key),
    p_created_by_user_id,
    p_meeting_mode,
    normalized_meeting_url
  )
  returning * into inserted_appointment;

  return private.staff_booking_result(inserted_appointment.id);
end;
$$;

-- Backwards compatibility for existing callers: the original signature keeps
-- creating office appointments.
create or replace function public.create_staff_appointment(
  p_organization_id uuid,
  p_facility_id uuid,
  p_service_id uuid,
  p_expert_user_id uuid,
  p_client_id uuid,
  p_client_person_id uuid,
  p_starts_at timestamptz,
  p_notes text,
  p_created_by_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select public.create_staff_appointment(
    p_organization_id,
    p_facility_id,
    p_service_id,
    p_expert_user_id,
    p_client_id,
    p_client_person_id,
    p_starts_at,
    p_notes,
    p_created_by_user_id,
    p_idempotency_key,
    'office',
    null
  );
$$;

-- Keep downstream calendar/invitation workers aware of the meeting mode and
-- online join URL.
create or replace function private.enqueue_appointment_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_topic text;
begin
  event_topic := case
    when new.status = 'cancelled' then 'appointment.cancelled'
    when new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed')
      then 'appointment.confirmed'
    when new.status = 'hold' and tg_op = 'INSERT' then 'appointment.hold.created'
    else 'appointment.updated'
  end;

  insert into public.booking_outbox (
    organization_id,
    topic,
    aggregate_type,
    aggregate_id,
    idempotency_key,
    payload
  ) values (
    new.organization_id,
    event_topic,
    'appointment',
    new.id,
    'appointment:' || new.id::text || ':' || event_topic || ':' || txid_current()::text,
    jsonb_build_object(
      'appointmentId', new.id,
      'clientId', new.client_id,
      'clientPersonId', new.client_person_id,
      'facilityId', new.facility_id,
      'serviceId', new.service_id,
      'expertUserId', new.expert_user_id,
      'status', new.status,
      'meetingMode', new.meeting_mode,
      'meetingUrl', new.meeting_url,
      'startsAt', new.starts_at,
      'endsAt', new.ends_at
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger appointments_enqueue_outbox on public.appointments;
create trigger appointments_enqueue_outbox
  after insert or update of
    starts_at,
    ends_at,
    expert_user_id,
    status,
    client_id,
    client_person_id,
    meeting_mode,
    meeting_url
  on public.appointments
  for each row execute function private.enqueue_appointment_outbox();

-- Both preference and time-off data are mediated by authenticated Nitro
-- endpoints. No browser role receives direct table access.
alter table public.organization_user_preferences enable row level security;
alter table public.expert_time_off enable row level security;

revoke all on table
  public.organization_user_preferences,
  public.expert_time_off
from public, anon, authenticated;

grant all privileges on table
  public.organization_user_preferences,
  public.expert_time_off
to service_role;

revoke all on function private.staff_booking_result(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_appointment_outbox()
  from public, anon, authenticated, service_role;

revoke all on function public.create_staff_appointment(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.create_staff_appointment(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_staff_appointment(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, text
) to service_role;
grant execute on function public.create_staff_appointment(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, text, text, text
) to service_role;
