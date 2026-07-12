-- Facilities, scheduling, public booking widgets and calendar synchronization.
--
-- OpenExpert is the source of truth for appointments. External calendars only
-- contribute busy ranges and receive mirrored appointment events. All business
-- timestamps are timestamptz; recurring schedules use a facility-local IANA
-- timezone and minute-precision, half-open intervals.

create extension if not exists btree_gist with schema extensions;

-- Team roles are intentionally explicit and consistent with facility roles.
-- Existing `lead` memberships retain their authority as `admin`.
alter table public.team_memberships
  drop constraint team_memberships_role_check;

update public.team_memberships
set role = 'admin'
where role = 'lead';

alter table public.team_memberships
  add constraint team_memberships_role_check
  check (role in ('admin', 'member'));

create or replace function private.is_team_member(
  target_organization_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.organization_id = target_organization_id
      and membership.team_id = target_team_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_team_admin(
  target_organization_id uuid,
  target_team_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_memberships membership
    where membership.organization_id = target_organization_id
      and membership.team_id = target_team_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  );
$$;

revoke all on function private.is_team_member(uuid, uuid) from public, anon;
revoke all on function private.is_team_admin(uuid, uuid) from public, anon;
grant execute on function private.is_team_member(uuid, uuid) to authenticated;
grant execute on function private.is_team_admin(uuid, uuid) to authenticated;

-- Team admins may edit their team and manage direct memberships. Creating or
-- deleting a team remains an organization-admin operation.
drop policy if exists "admins can manage teams" on public.teams;
drop policy if exists "organization admins can insert teams" on public.teams;
drop policy if exists "organization admins can update teams" on public.teams;
drop policy if exists "organization admins can delete teams" on public.teams;
create policy "organization admins can insert teams" on public.teams
  for insert to authenticated
  with check ((select private.is_organization_admin(organization_id)));
create policy "organization or team admins can update teams" on public.teams
  for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, id))
  );
create policy "organization admins can delete teams" on public.teams
  for delete to authenticated
  using ((select private.is_organization_admin(organization_id)));

drop policy if exists "admins can manage direct team memberships" on public.team_memberships;
drop policy if exists "organization admins can insert team memberships" on public.team_memberships;
drop policy if exists "organization admins can update team memberships" on public.team_memberships;
drop policy if exists "organization admins can delete team memberships" on public.team_memberships;
create policy "organization or team admins can insert team memberships"
  on public.team_memberships for insert to authenticated
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  );
create policy "organization or team admins can update team memberships"
  on public.team_memberships for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  );
create policy "organization or team admins can delete team memberships"
  on public.team_memberships for delete to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_team_admin(organization_id, team_id))
  );

create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  timezone text not null default 'Europe/Warsaw' check (btrim(timezone) <> ''),
  address_line1 text,
  address_line2 text,
  postal_code text,
  city text,
  country_code text not null default 'PL' check (country_code ~ '^[A-Z]{2}$'),
  phone text,
  email text check (email is null or email = lower(btrim(email))),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, slug)
);

create table public.team_facilities (
  organization_id uuid not null,
  team_id uuid not null,
  facility_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, team_id, facility_id),
  constraint team_facilities_team_fkey
    foreign key (organization_id, team_id)
    references public.teams(organization_id, id) on delete cascade,
  constraint team_facilities_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id) on delete cascade
);

create index team_facilities_facility_team_idx
  on public.team_facilities(organization_id, facility_id, team_id);

create table public.facility_memberships (
  organization_id uuid not null,
  facility_id uuid not null,
  user_id uuid not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  is_bookable boolean not null default true,
  booking_priority integer not null default 100 check (booking_priority between 0 and 10000),
  last_assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, facility_id, user_id),
  constraint facility_memberships_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id) on delete cascade,
  constraint facility_memberships_organization_member_fkey
    foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade
);

create index facility_memberships_user_facility_idx
  on public.facility_memberships(organization_id, user_id, facility_id);
create index facility_memberships_bookable_idx
  on public.facility_memberships(organization_id, facility_id, booking_priority, last_assigned_at)
  where is_bookable;

create or replace function private.is_facility_member(
  target_organization_id uuid,
  target_facility_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.facility_memberships membership
    where membership.organization_id = target_organization_id
      and membership.facility_id = target_facility_id
      and membership.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_facility_admin(
  target_organization_id uuid,
  target_facility_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.facility_memberships membership
    where membership.organization_id = target_organization_id
      and membership.facility_id = target_facility_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'admin'
  );
$$;

create or replace function private.can_view_facility(
  target_organization_id uuid,
  target_facility_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_organization_admin(target_organization_id)
    or exists (
      select 1
      from public.facility_memberships membership
      where membership.organization_id = target_organization_id
        and membership.facility_id = target_facility_id
        and membership.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.team_facilities link
      join public.team_memberships membership
        on membership.organization_id = link.organization_id
       and membership.team_id = link.team_id
      where link.organization_id = target_organization_id
        and link.facility_id = target_facility_id
        and membership.user_id = (select auth.uid())
    );
$$;

revoke all on function private.is_facility_member(uuid, uuid) from public, anon;
revoke all on function private.is_facility_admin(uuid, uuid) from public, anon;
revoke all on function private.can_view_facility(uuid, uuid) from public, anon;
grant execute on function private.is_facility_member(uuid, uuid) to authenticated;
grant execute on function private.is_facility_admin(uuid, uuid) to authenticated;
grant execute on function private.can_view_facility(uuid, uuid) to authenticated;

create or replace function private.validate_facility_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from pg_catalog.pg_timezone_names zone where zone.name = new.timezone
  ) then
    raise exception 'invalid_iana_timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger facilities_validate_timezone
  before insert or update of timezone on public.facilities
  for each row execute function private.validate_facility_timezone();

create table public.facility_opening_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  facility_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  is_active boolean not null default true,
  opening_range int4range generated always as (
    int4range(
      (extract(epoch from opens_at)::integer / 60),
      (extract(epoch from closes_at)::integer / 60),
      '[)'
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facility_opening_hours_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id) on delete cascade,
  constraint facility_opening_hours_valid_period check (
    opens_at < closes_at
    and extract(second from opens_at) = 0
    and extract(second from closes_at) = 0
  ),
  constraint facility_opening_hours_no_overlap
    exclude using gist (
      organization_id with =,
      facility_id with =,
      weekday with =,
      opening_range with &&
    ) where (is_active)
);

create index facility_opening_hours_facility_weekday_idx
  on public.facility_opening_hours(organization_id, facility_id, weekday);

create table public.facility_opening_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  facility_id uuid not null,
  local_date date not null,
  is_closed boolean not null default false,
  opens_at time,
  closes_at time,
  opening_range int4range generated always as (
    case
      when is_closed then int4range(0, 1440, '[)')
      else int4range(
        (extract(epoch from opens_at)::integer / 60),
        (extract(epoch from closes_at)::integer / 60),
        '[)'
      )
    end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint facility_opening_overrides_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id) on delete cascade,
  constraint facility_opening_overrides_shape check (
    (is_closed and opens_at is null and closes_at is null)
    or (
      not is_closed
      and opens_at is not null
      and closes_at is not null
      and opens_at < closes_at
      and extract(second from opens_at) = 0
      and extract(second from closes_at) = 0
    )
  ),
  constraint facility_opening_overrides_no_overlap
    exclude using gist (
      organization_id with =,
      facility_id with =,
      local_date with =,
      opening_range with &&
    )
);

create index facility_opening_overrides_facility_date_idx
  on public.facility_opening_overrides(organization_id, facility_id, local_date);

create table public.expert_availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  facility_id uuid not null,
  user_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  valid_from date,
  valid_until date,
  is_active boolean not null default true,
  availability_range int4range generated always as (
    int4range(
      (extract(epoch from starts_at)::integer / 60),
      (extract(epoch from ends_at)::integer / 60),
      '[)'
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expert_availability_rules_membership_fkey
    foreign key (organization_id, facility_id, user_id)
    references public.facility_memberships(organization_id, facility_id, user_id)
    on delete cascade,
  constraint expert_availability_rules_valid_period check (
    starts_at < ends_at
    and extract(second from starts_at) = 0
    and extract(second from ends_at) = 0
    and (valid_from is null or valid_until is null or valid_from <= valid_until)
  ),
  constraint expert_availability_rules_no_overlap
    exclude using gist (
      organization_id with =,
      facility_id with =,
      user_id with =,
      weekday with =,
      availability_range with &&,
      daterange(valid_from, valid_until, '[]') with &&
    ) where (is_active)
);

create index expert_availability_rules_lookup_idx
  on public.expert_availability_rules(
    organization_id, facility_id, user_id, weekday, valid_from, valid_until
  );

create table public.expert_availability_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  facility_id uuid not null,
  user_id uuid not null,
  local_date date not null,
  is_unavailable boolean not null default false,
  starts_at time,
  ends_at time,
  availability_range int4range generated always as (
    case
      when is_unavailable then int4range(0, 1440, '[)')
      else int4range(
        (extract(epoch from starts_at)::integer / 60),
        (extract(epoch from ends_at)::integer / 60),
        '[)'
      )
    end
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expert_availability_overrides_membership_fkey
    foreign key (organization_id, facility_id, user_id)
    references public.facility_memberships(organization_id, facility_id, user_id)
    on delete cascade,
  constraint expert_availability_overrides_shape check (
    (is_unavailable and starts_at is null and ends_at is null)
    or (
      not is_unavailable
      and starts_at is not null
      and ends_at is not null
      and starts_at < ends_at
      and extract(second from starts_at) = 0
      and extract(second from ends_at) = 0
    )
  ),
  constraint expert_availability_overrides_no_overlap
    exclude using gist (
      organization_id with =,
      facility_id with =,
      user_id with =,
      local_date with =,
      availability_range with &&
    )
);

create index expert_availability_overrides_lookup_idx
  on public.expert_availability_overrides(organization_id, facility_id, user_id, local_date);

create table public.booking_services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text,
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes between 0 and 1440),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes between 0 and 1440),
  slot_interval_minutes integer not null default 15 check (slot_interval_minutes between 5 and 1440),
  min_notice_minutes integer not null default 60 check (min_notice_minutes between 0 and 525600),
  max_advance_days integer not null default 90 check (max_advance_days between 1 and 730),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, slug)
);

create table public.facility_services (
  organization_id uuid not null,
  facility_id uuid not null,
  service_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, facility_id, service_id),
  constraint facility_services_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id) on delete cascade,
  constraint facility_services_service_fkey
    foreign key (organization_id, service_id)
    references public.booking_services(organization_id, id) on delete cascade
);

create index facility_services_service_facility_idx
  on public.facility_services(organization_id, service_id, facility_id);

create table public.facility_service_experts (
  organization_id uuid not null,
  facility_id uuid not null,
  service_id uuid not null,
  user_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, facility_id, service_id, user_id),
  constraint facility_service_experts_service_fkey
    foreign key (organization_id, facility_id, service_id)
    references public.facility_services(organization_id, facility_id, service_id)
    on delete cascade,
  constraint facility_service_experts_membership_fkey
    foreign key (organization_id, facility_id, user_id)
    references public.facility_memberships(organization_id, facility_id, user_id)
    on delete cascade
);

create index facility_service_experts_user_idx
  on public.facility_service_experts(organization_id, user_id, facility_id, service_id);

create table public.booking_widgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  facility_id uuid not null,
  name text not null check (btrim(name) <> ''),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  public_token uuid not null default gen_random_uuid() unique,
  title text not null check (btrim(title) <> ''),
  subtitle text,
  theme text not null default 'auto' check (theme in ('light', 'dark', 'auto')),
  accent_color text not null default '#2563EB'
    check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  allowed_origins text[] not null default '{}',
  booking_mode text not null default 'both'
    check (booking_mode in ('facility', 'expert', 'both')),
  locale text not null default 'pl-PL' check (btrim(locale) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, facility_id, id),
  unique (organization_id, facility_id, slug),
  constraint booking_widgets_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id) on delete cascade,
  constraint booking_widgets_allowed_origins_shape check (
    array_position(allowed_origins, null) is null
  )
);

create index booking_widgets_facility_active_idx
  on public.booking_widgets(organization_id, facility_id, is_active);

create table public.booking_widget_services (
  organization_id uuid not null,
  facility_id uuid not null,
  widget_id uuid not null,
  service_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, facility_id, widget_id, service_id),
  constraint booking_widget_services_widget_fkey
    foreign key (organization_id, facility_id, widget_id)
    references public.booking_widgets(organization_id, facility_id, id) on delete cascade,
  constraint booking_widget_services_facility_service_fkey
    foreign key (organization_id, facility_id, service_id)
    references public.facility_services(organization_id, facility_id, service_id)
    on delete cascade
);

create index booking_widget_services_service_widget_idx
  on public.booking_widget_services(organization_id, facility_id, service_id, widget_id);

create table public.booking_rate_limits (
  widget_id uuid not null references public.booking_widgets(id) on delete cascade,
  rate_scope text not null check (rate_scope in ('catalog', 'slots', 'booking')),
  client_key text not null check (btrim(client_key) <> '' and length(client_key) <= 128),
  window_started_at timestamptz not null,
  request_count bigint not null default 1 check (request_count > 0),
  primary key (widget_id, rate_scope, client_key, window_started_at)
);

create index booking_rate_limits_expiry_idx
  on public.booking_rate_limits(window_started_at);

create or replace function public.consume_booking_rate_limit(
  p_widget_token uuid,
  p_scope text,
  p_client_key text,
  p_limit integer,
  p_window_seconds integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_widget_id uuid;
  window_start timestamptz;
  current_count bigint;
  retry_after integer;
begin
  if p_scope not in ('catalog', 'slots', 'booking')
     or nullif(btrim(p_client_key), '') is null
     or length(p_client_key) > 128
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_booking_rate_limit_request' using errcode = '22023';
  end if;

  select widget.id
  into target_widget_id
  from public.booking_widgets widget
  where widget.public_token = p_widget_token
    and widget.is_active;
  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.booking_rate_limits (
    widget_id, rate_scope, client_key, window_started_at, request_count
  ) values (
    target_widget_id, p_scope, p_client_key, window_start, 1
  )
  on conflict (widget_id, rate_scope, client_key, window_started_at)
  do update set request_count = public.booking_rate_limits.request_count + 1
  returning request_count into current_count;

  delete from public.booking_rate_limits rate_limit
  where rate_limit.window_started_at < clock_timestamp() - interval '1 day';

  if current_count <= p_limit then
    return 0;
  end if;

  retry_after := ceil(extract(epoch from (
    window_start + make_interval(secs => p_window_seconds) - clock_timestamp()
  )))::integer;
  return greatest(1, retry_after);
end;
$$;

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  facility_id uuid not null,
  service_id uuid not null,
  expert_user_id uuid not null,
  widget_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  appointment_period tstzrange generated always as (
    tstzrange(starts_at, ends_at, '[)')
  ) stored,
  timezone text not null,
  status text not null default 'hold'
    check (status in ('hold', 'confirmed', 'cancelled')),
  hold_expires_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  customer_name text not null check (btrim(customer_name) <> ''),
  customer_email text not null check (customer_email = lower(btrim(customer_email))),
  customer_phone text,
  notes text,
  source text not null default 'widget'
    check (source in ('widget', 'staff', 'import', 'api')),
  idempotency_key text check (
    idempotency_key is null
    or (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200)
  ),
  manage_token uuid not null default gen_random_uuid() unique,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint appointments_valid_period check (starts_at < ends_at),
  constraint appointments_hold_shape check (
    (status = 'hold' and hold_expires_at is not null)
    or (status <> 'hold' and hold_expires_at is null)
  ),
  constraint appointments_confirmation_shape check (
    (status = 'confirmed' and confirmed_at is not null)
    or status <> 'confirmed'
  ),
  constraint appointments_cancellation_shape check (
    (status = 'cancelled' and cancelled_at is not null)
    or status <> 'cancelled'
  ),
  constraint appointments_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id),
  constraint appointments_service_fkey
    foreign key (organization_id, service_id)
    references public.booking_services(organization_id, id),
  constraint appointments_expert_user_fkey
    foreign key (expert_user_id)
    references public.users(id),
  constraint appointments_widget_fkey
    foreign key (widget_id)
    references public.booking_widgets(id) on delete set null,
  constraint appointments_created_by_member_fkey
    foreign key (organization_id, created_by_user_id)
    references public.organization_memberships(organization_id, user_id)
);

create index appointments_facility_start_idx
  on public.appointments(organization_id, facility_id, starts_at);
create index appointments_expert_start_idx
  on public.appointments(organization_id, expert_user_id, starts_at);
create index appointments_service_start_idx
  on public.appointments(organization_id, service_id, starts_at);
create index appointments_widget_created_idx
  on public.appointments(organization_id, widget_id, created_at desc)
  where widget_id is not null;
create unique index appointments_widget_idempotency_key
  on public.appointments(widget_id, idempotency_key)
  where widget_id is not null and idempotency_key is not null;
create index appointments_active_period_idx
  on public.appointments using gist (appointment_period)
  where status in ('hold', 'confirmed');
create index appointments_expired_holds_idx
  on public.appointments(hold_expires_at)
  where status = 'hold';

create table public.appointment_resource_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null,
  resource_type text not null check (resource_type in ('expert', 'facility', 'room', 'equipment')),
  resource_id uuid not null,
  busy_period tstzrange not null,
  status text not null check (status in ('hold', 'confirmed', 'cancelled')),
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, appointment_id, resource_type, resource_id),
  constraint appointment_resource_reservations_appointment_fkey
    foreign key (organization_id, appointment_id)
    references public.appointments(organization_id, id) on delete cascade,
  constraint appointment_resource_reservations_valid_period check (
    not isempty(busy_period)
    and lower(busy_period) is not null
    and upper(busy_period) is not null
    and lower_inc(busy_period)
    and not upper_inc(busy_period)
  ),
  constraint appointment_resource_reservations_hold_shape check (
    (status = 'hold' and hold_expires_at is not null)
    or (status <> 'hold' and hold_expires_at is null)
  ),
  constraint appointment_expert_reservations_no_overlap
    exclude using gist (
      resource_id with =,
      busy_period with &&
    ) where (resource_type = 'expert' and status in ('hold', 'confirmed')),
  constraint appointment_scoped_resources_no_overlap
    exclude using gist (
      organization_id with =,
      resource_type with =,
      resource_id with =,
      busy_period with &&
    ) where (resource_type <> 'expert' and status in ('hold', 'confirmed'))
);

create index appointment_resource_reservations_appointment_idx
  on public.appointment_resource_reservations(organization_id, appointment_id);
create index appointment_resource_reservations_resource_period_idx
  on public.appointment_resource_reservations
  using gist (organization_id, resource_type, resource_id, busy_period);
create index appointment_expert_reservations_period_idx
  on public.appointment_resource_reservations
  using gist (resource_id, busy_period)
  where resource_type = 'expert';

-- OAuth credentials are application-encrypted before storage. The table has no
-- grants for anon/authenticated; server-only endpoints use service_role.
create table public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_kind text not null check (owner_kind in ('expert', 'facility')),
  owner_user_id uuid,
  facility_id uuid,
  provider text not null check (provider in ('google', 'microsoft')),
  account_id text not null check (btrim(account_id) <> ''),
  account_email text check (account_email is null or account_email = lower(btrim(account_email))),
  encrypted_access_token text,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  selected_calendar_id text,
  selected_calendar_name text,
  read_calendar_ids text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'active', 'error', 'revoked')),
  sync_cursor text,
  webhook_channel_id text,
  webhook_resource_id text,
  webhook_client_state_encrypted text,
  webhook_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint calendar_connections_owner_shape check (
    (owner_kind = 'expert' and owner_user_id is not null and facility_id is null)
    or (owner_kind = 'facility' and owner_user_id is null and facility_id is not null)
  ),
  constraint calendar_connections_owner_user_fkey
    foreign key (organization_id, owner_user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  constraint calendar_connections_facility_fkey
    foreign key (organization_id, facility_id)
    references public.facilities(organization_id, id) on delete cascade
);

create unique index calendar_connections_expert_provider_key
  on public.calendar_connections(organization_id, owner_user_id, provider)
  where owner_kind = 'expert';
create unique index calendar_connections_facility_provider_key
  on public.calendar_connections(organization_id, facility_id, provider)
  where owner_kind = 'facility';
create index calendar_connections_webhook_expiry_idx
  on public.calendar_connections(webhook_expires_at)
  where status = 'active' and webhook_expires_at is not null;

create table public.external_busy_blocks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  calendar_id text not null check (btrim(calendar_id) <> ''),
  external_event_id text not null check (btrim(external_event_id) <> ''),
  busy_period tstzrange not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_busy_blocks_connection_fkey
    foreign key (organization_id, connection_id)
    references public.calendar_connections(organization_id, id) on delete cascade,
  constraint external_busy_blocks_valid_period check (
    not isempty(busy_period)
    and lower(busy_period) is not null
    and upper(busy_period) is not null
    and lower_inc(busy_period)
    and not upper_inc(busy_period)
  )
);

create unique index external_busy_blocks_external_instance_key
  on public.external_busy_blocks(
    connection_id,
    calendar_id,
    external_event_id,
    lower(busy_period),
    upper(busy_period)
  );
create index external_busy_blocks_connection_calendar_idx
  on public.external_busy_blocks(organization_id, connection_id, calendar_id);
create index external_busy_blocks_period_idx
  on public.external_busy_blocks using gist (busy_period);

create or replace function public.replace_calendar_busy_blocks(
  p_organization_id uuid,
  p_connection_id uuid,
  p_blocks jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if jsonb_typeof(coalesce(p_blocks, '[]'::jsonb)) <> 'array' then
    raise exception 'calendar_busy_blocks_must_be_an_array' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.calendar_connections connection
    where connection.organization_id = p_organization_id
      and connection.id = p_connection_id
  ) then
    raise exception 'calendar_connection_not_found' using errcode = 'P0002';
  end if;

  delete from public.external_busy_blocks busy
  where busy.organization_id = p_organization_id
    and busy.connection_id = p_connection_id;

  insert into public.external_busy_blocks (
    organization_id, connection_id, calendar_id, external_event_id, busy_period
  )
  select p_organization_id,
         p_connection_id,
         item ->> 'calendarId',
         item ->> 'externalEventId',
         tstzrange(
           (item ->> 'startsAt')::timestamptz,
           (item ->> 'endsAt')::timestamptz,
           '[)'
         )
  from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb)) item;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create table public.appointment_calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  appointment_id uuid not null,
  connection_id uuid not null,
  calendar_id text not null check (btrim(calendar_id) <> ''),
  external_event_id text not null check (btrim(external_event_id) <> ''),
  provider_etag text,
  source_fingerprint text,
  sync_status text not null default 'pending'
    check (sync_status in ('pending', 'synced', 'error', 'deleted')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_calendar_events_appointment_fkey
    foreign key (organization_id, appointment_id)
    references public.appointments(organization_id, id) on delete cascade,
  constraint appointment_calendar_events_connection_fkey
    foreign key (organization_id, connection_id)
    references public.calendar_connections(organization_id, id) on delete cascade,
  unique (appointment_id, connection_id, calendar_id),
  unique (connection_id, calendar_id, external_event_id)
);

create index appointment_calendar_events_organization_appointment_idx
  on public.appointment_calendar_events(organization_id, appointment_id);
create index appointment_calendar_events_sync_status_idx
  on public.appointment_calendar_events(sync_status, updated_at)
  where sync_status in ('pending', 'error');

create or replace function private.reset_calendar_connection_dependents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.account_id is distinct from new.account_id
     or old.selected_calendar_id is distinct from new.selected_calendar_id then
    delete from public.external_busy_blocks busy
    where busy.organization_id = old.organization_id
      and busy.connection_id = old.id;
    delete from public.appointment_calendar_events calendar_event
    where calendar_event.organization_id = old.organization_id
      and calendar_event.connection_id = old.id;
  end if;
  return new;
end;
$$;

create trigger calendar_connections_reset_dependents
  before update of account_id, selected_calendar_id on public.calendar_connections
  for each row execute function private.reset_calendar_connection_dependents();

create table public.booking_outbox (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  topic text not null check (btrim(topic) <> ''),
  aggregate_type text not null check (btrim(aggregate_type) <> ''),
  aggregate_id uuid not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index booking_outbox_pending_idx
  on public.booking_outbox(available_at, id)
  where status in ('pending', 'failed');
create index booking_outbox_aggregate_idx
  on public.booking_outbox(organization_id, aggregate_type, aggregate_id);

-- Keep the expert reservation in the same transaction as every appointment
-- mutation. A facility is deliberately not reserved: multiple experts may work
-- there concurrently; rooms/equipment are added only as explicit resources.
create or replace function private.sync_appointment_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  service_record record;
  reservation_period tstzrange;
begin
  select service.buffer_before_minutes, service.buffer_after_minutes
  into strict service_record
  from public.booking_services service
  where service.organization_id = new.organization_id
    and service.id = new.service_id;

  reservation_period := tstzrange(
    new.starts_at - make_interval(mins => service_record.buffer_before_minutes),
    new.ends_at + make_interval(mins => service_record.buffer_after_minutes),
    '[)'
  );

  if tg_op = 'UPDATE' and old.expert_user_id <> new.expert_user_id then
    delete from public.appointment_resource_reservations reservation
    where reservation.organization_id = old.organization_id
      and reservation.appointment_id = old.id
      and reservation.resource_type = 'expert'
      and reservation.resource_id = old.expert_user_id;
  end if;

  insert into public.appointment_resource_reservations (
    organization_id,
    appointment_id,
    resource_type,
    resource_id,
    busy_period,
    status,
    hold_expires_at
  ) values (
    new.organization_id,
    new.id,
    'expert',
    new.expert_user_id,
    reservation_period,
    new.status,
    new.hold_expires_at
  )
  on conflict (organization_id, appointment_id, resource_type, resource_id)
  do update set
    busy_period = excluded.busy_period,
    status = excluded.status,
    hold_expires_at = excluded.hold_expires_at,
    updated_at = now();

  return new;
end;
$$;

create trigger appointments_sync_reservation
  after insert or update of
    starts_at, ends_at, expert_user_id, service_id, status, hold_expires_at
  on public.appointments
  for each row execute function private.sync_appointment_reservation();

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
      'facilityId', new.facility_id,
      'serviceId', new.service_id,
      'expertUserId', new.expert_user_id,
      'status', new.status,
      'startsAt', new.starts_at,
      'endsAt', new.ends_at
    )
  )
  on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

create trigger appointments_enqueue_outbox
  after insert or update of starts_at, ends_at, expert_user_id, status
  on public.appointments
  for each row execute function private.enqueue_appointment_outbox();

create or replace function private.release_expired_booking_holds(
  target_facility_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released_count integer;
begin
  update public.appointments appointment
  set status = 'cancelled',
      hold_expires_at = null,
      cancelled_at = now(),
      cancellation_reason = 'hold_expired'
  where appointment.status = 'hold'
    and appointment.hold_expires_at <= now()
    and (target_facility_id is null or appointment.facility_id = target_facility_id);

  get diagnostics released_count = row_count;
  return released_count;
end;
$$;

-- Validate a concrete expert at a concrete instant against facility hours,
-- expert presence, internal reservations and privacy-minimized external busy.
create or replace function private.expert_slot_is_available(
  target_organization_id uuid,
  target_facility_id uuid,
  target_service_id uuid,
  target_expert_user_id uuid,
  requested_start timestamptz
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  facility_record record;
  service_record record;
  requested_end timestamptz;
  requested_busy_period tstzrange;
  local_start timestamp;
  local_busy_start timestamp;
  local_busy_end timestamp;
  local_day date;
  local_weekday integer;
  local_start_minute integer;
  local_busy_range int4range;
begin
  select facility.timezone
  into facility_record
  from public.facilities facility
  where facility.organization_id = target_organization_id
    and facility.id = target_facility_id
    and facility.is_active;

  if not found then
    return false;
  end if;

  select service.duration_minutes,
         service.buffer_before_minutes,
         service.buffer_after_minutes,
         service.slot_interval_minutes,
         service.min_notice_minutes,
         service.max_advance_days
  into service_record
  from public.booking_services service
  join public.facility_services facility_service
    on facility_service.organization_id = service.organization_id
   and facility_service.service_id = service.id
   and facility_service.facility_id = target_facility_id
   and facility_service.is_active
  join public.facility_service_experts expert
    on expert.organization_id = facility_service.organization_id
   and expert.facility_id = facility_service.facility_id
   and expert.service_id = facility_service.service_id
   and expert.user_id = target_expert_user_id
   and expert.is_active
  join public.facility_memberships membership
    on membership.organization_id = expert.organization_id
   and membership.facility_id = expert.facility_id
   and membership.user_id = expert.user_id
   and membership.is_bookable
  where service.organization_id = target_organization_id
    and service.id = target_service_id
    and service.is_active;

  if not found then
    return false;
  end if;

  if requested_start < now() + make_interval(mins => service_record.min_notice_minutes)
     or requested_start > now() + make_interval(days => service_record.max_advance_days) then
    return false;
  end if;

  requested_end := requested_start + make_interval(mins => service_record.duration_minutes);
  requested_busy_period := tstzrange(
    requested_start - make_interval(mins => service_record.buffer_before_minutes),
    requested_end + make_interval(mins => service_record.buffer_after_minutes),
    '[)'
  );
  local_start := requested_start at time zone facility_record.timezone;
  local_busy_start := lower(requested_busy_period) at time zone facility_record.timezone;
  local_busy_end := upper(requested_busy_period) at time zone facility_record.timezone;
  local_day := local_start::date;
  local_weekday := extract(isodow from local_day)::integer - 1;

  if extract(second from local_start) <> 0
     or local_busy_start::date <> (local_busy_end - interval '1 microsecond')::date then
    return false;
  end if;

  local_start_minute := extract(hour from local_start)::integer * 60
    + extract(minute from local_start)::integer;
  local_busy_range := int4range(
    extract(hour from local_busy_start)::integer * 60
      + extract(minute from local_busy_start)::integer,
    extract(hour from local_busy_end)::integer * 60
      + extract(minute from local_busy_end)::integer,
    '[)'
  );

  if exists (
    select 1
    from public.facility_opening_overrides override
    where override.organization_id = target_organization_id
      and override.facility_id = target_facility_id
      and override.local_date = local_day
  ) then
    if not exists (
      select 1
      from public.facility_opening_overrides override
      where override.organization_id = target_organization_id
        and override.facility_id = target_facility_id
        and override.local_date = local_day
        and not override.is_closed
        and local_busy_range <@ override.opening_range
        and mod(
          local_start_minute - lower(override.opening_range)
            - service_record.buffer_before_minutes,
          service_record.slot_interval_minutes
        ) = 0
    ) then
      return false;
    end if;
  elsif not exists (
    select 1
    from public.facility_opening_hours opening
    where opening.organization_id = target_organization_id
      and opening.facility_id = target_facility_id
      and opening.weekday = local_weekday
      and opening.is_active
      and local_busy_range <@ opening.opening_range
      and mod(
        local_start_minute - lower(opening.opening_range)
          - service_record.buffer_before_minutes,
        service_record.slot_interval_minutes
      ) = 0
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.expert_availability_overrides override
    where override.organization_id = target_organization_id
      and override.facility_id = target_facility_id
      and override.user_id = target_expert_user_id
      and override.local_date = local_day
  ) then
    if not exists (
      select 1
      from public.expert_availability_overrides override
      where override.organization_id = target_organization_id
        and override.facility_id = target_facility_id
        and override.user_id = target_expert_user_id
        and override.local_date = local_day
        and not override.is_unavailable
        and local_busy_range <@ override.availability_range
    ) then
      return false;
    end if;
  elsif not exists (
    select 1
    from public.expert_availability_rules rule
    where rule.organization_id = target_organization_id
      and rule.facility_id = target_facility_id
      and rule.user_id = target_expert_user_id
      and rule.weekday = local_weekday
      and rule.is_active
      and (rule.valid_from is null or rule.valid_from <= local_day)
      and (rule.valid_until is null or rule.valid_until >= local_day)
      and local_busy_range <@ rule.availability_range
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.appointment_resource_reservations reservation
    where reservation.resource_type = 'expert'
      and reservation.resource_id = target_expert_user_id
      and reservation.busy_period && requested_busy_period
      and (
        reservation.status = 'confirmed'
        or (reservation.status = 'hold' and reservation.hold_expires_at > now())
      )
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.external_busy_blocks busy
    join public.calendar_connections connection
      on connection.organization_id = busy.organization_id
     and connection.id = busy.connection_id
     and connection.status in ('active', 'error')
    where busy.busy_period && requested_busy_period
      and (
        (connection.owner_kind = 'expert' and connection.owner_user_id = target_expert_user_id)
        or (
          busy.organization_id = target_organization_id
          and connection.owner_kind = 'facility'
          and connection.facility_id = target_facility_id
        )
      )
      and not exists (
        select 1
        from public.appointment_calendar_events mirrored_event
        join public.appointments mirrored_appointment
          on mirrored_appointment.organization_id = mirrored_event.organization_id
         and mirrored_appointment.id = mirrored_event.appointment_id
        where mirrored_event.organization_id = busy.organization_id
          and mirrored_event.connection_id = busy.connection_id
          and mirrored_event.sync_status <> 'deleted'
          and mirrored_appointment.appointment_period = busy.busy_period
      )
  ) then
    return false;
  end if;

  return true;
end;
$$;

create or replace function private.assert_widget_origin_allowed(target_widget_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  permitted_origins text[];
  request_origin text;
begin
  select widget.allowed_origins
  into strict permitted_origins
  from public.booking_widgets widget
  where widget.id = target_widget_id;

  request_origin := nullif(
    current_setting('request.headers', true)::jsonb ->> 'origin',
    ''
  );

  if cardinality(permitted_origins) > 0
     and request_origin is not null
     and not (request_origin = any(permitted_origins)) then
    raise exception 'booking_widget_origin_not_allowed' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.get_booking_widget_catalog(p_widget_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  widget_record record;
  result jsonb;
begin
  select widget.*, facility.name as facility_name,
         facility.timezone as facility_timezone,
         concat_ws(
           ', ',
           nullif(facility.address_line1, ''),
           nullif(facility.address_line2, ''),
           nullif(concat_ws(' ', facility.postal_code, facility.city), ''),
           facility.country_code
         ) as facility_address
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
   and facility.is_active
  where widget.public_token = p_widget_token
    and widget.is_active;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'widget', jsonb_build_object(
      'key', widget_record.public_token::text,
      'title', widget_record.title,
      'subtitle', widget_record.subtitle,
      'theme', widget_record.theme,
      'accentColor', widget_record.accent_color,
      'bookingMode', widget_record.booking_mode
    ),
    'facility', jsonb_build_object(
      'id', widget_record.facility_id,
      'name', widget_record.facility_name,
      'address', widget_record.facility_address,
      'timezone', widget_record.facility_timezone
    ),
    'services', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', service.id,
          'name', service.name,
          'description', service.description,
          'durationMinutes', service.duration_minutes
        ) order by service.name, service.id
      )
      from public.booking_widget_services allowed_service
      join public.facility_services facility_service
        on facility_service.organization_id = allowed_service.organization_id
       and facility_service.facility_id = allowed_service.facility_id
       and facility_service.service_id = allowed_service.service_id
       and facility_service.is_active
      join public.booking_services service
        on service.organization_id = allowed_service.organization_id
       and service.id = allowed_service.service_id
       and service.is_active
      where allowed_service.organization_id = widget_record.organization_id
        and allowed_service.facility_id = widget_record.facility_id
        and allowed_service.widget_id = widget_record.id
    ), '[]'::jsonb),
    'experts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'userId', expert.user_id,
          'name', expert.expert_name,
          'serviceIds', expert.service_ids
        ) order by expert.expert_name, expert.user_id
      )
      from (
        select service_expert.user_id,
               coalesce(app_user.full_name, 'Ekspert') as expert_name,
               jsonb_agg(service_expert.service_id order by service_expert.service_id) as service_ids
        from public.facility_service_experts service_expert
        join public.booking_widget_services allowed_service
          on allowed_service.organization_id = service_expert.organization_id
         and allowed_service.facility_id = service_expert.facility_id
         and allowed_service.service_id = service_expert.service_id
         and allowed_service.widget_id = widget_record.id
        join public.facility_memberships membership
          on membership.organization_id = service_expert.organization_id
         and membership.facility_id = service_expert.facility_id
         and membership.user_id = service_expert.user_id
         and membership.is_bookable
        join public.users app_user on app_user.id = service_expert.user_id
        where service_expert.organization_id = widget_record.organization_id
          and service_expert.facility_id = widget_record.facility_id
          and service_expert.is_active
        group by service_expert.user_id, app_user.full_name
      ) expert
    ), '[]'::jsonb),
    '_private', jsonb_build_object(
      'allowedOrigins', to_jsonb(widget_record.allowed_origins)
    )
  ) into result;

  return result;
end;
$$;

create or replace function public.get_booking_widget_slots(
  p_widget_token uuid,
  p_service_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_expert_user_id uuid default null
)
returns table (
  starts_at timestamptz,
  ends_at timestamptz,
  expert_user_id uuid,
  expert_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  widget_record record;
  service_record record;
begin
  if p_starts_on is null or p_ends_on is null
     or p_ends_on < p_starts_on
     or p_ends_on - p_starts_on > 31 then
    raise exception 'booking_slot_range_must_be_between_1_and_32_days'
      using errcode = '22023';
  end if;

  select widget.id, widget.organization_id, widget.facility_id,
         widget.booking_mode, facility.timezone
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
   and facility.is_active
  where widget.public_token = p_widget_token
    and widget.is_active;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  perform private.assert_widget_origin_allowed(widget_record.id);

  if widget_record.booking_mode = 'expert' and p_expert_user_id is null then
    raise exception 'booking_widget_requires_expert' using errcode = '22023';
  elsif widget_record.booking_mode = 'facility' and p_expert_user_id is not null then
    raise exception 'booking_widget_does_not_allow_expert_selection' using errcode = '22023';
  end if;

  select service.duration_minutes,
         service.buffer_before_minutes,
         service.buffer_after_minutes,
         service.slot_interval_minutes
  into service_record
  from public.booking_widget_services allowed_service
  join public.facility_services facility_service
    on facility_service.organization_id = allowed_service.organization_id
   and facility_service.facility_id = allowed_service.facility_id
   and facility_service.service_id = allowed_service.service_id
   and facility_service.is_active
  join public.booking_services service
    on service.organization_id = allowed_service.organization_id
   and service.id = allowed_service.service_id
   and service.is_active
  where allowed_service.organization_id = widget_record.organization_id
    and allowed_service.facility_id = widget_record.facility_id
    and allowed_service.widget_id = widget_record.id
    and allowed_service.service_id = p_service_id;

  if not found then
    raise exception 'booking_service_not_available_in_widget' using errcode = '23503';
  end if;

  return query
  with local_dates as (
    select day_value::date as local_date
    from generate_series(
      p_starts_on::timestamp,
      p_ends_on::timestamp,
      interval '1 day'
    ) day_value
  ),
  facility_periods as (
    select local_date.local_date,
           override.opens_at,
           override.closes_at
    from local_dates local_date
    join public.facility_opening_overrides override
      on override.organization_id = widget_record.organization_id
     and override.facility_id = widget_record.facility_id
     and override.local_date = local_date.local_date
     and not override.is_closed

    union all

    select local_date.local_date,
           opening.opens_at,
           opening.closes_at
    from local_dates local_date
    join public.facility_opening_hours opening
      on opening.organization_id = widget_record.organization_id
     and opening.facility_id = widget_record.facility_id
     and opening.weekday = extract(isodow from local_date.local_date)::integer - 1
     and opening.is_active
    where not exists (
      select 1
      from public.facility_opening_overrides override
      where override.organization_id = widget_record.organization_id
        and override.facility_id = widget_record.facility_id
        and override.local_date = local_date.local_date
    )
  ),
  experts as (
    select service_expert.user_id,
           coalesce(app_user.full_name, 'Ekspert') as display_name
    from public.facility_service_experts service_expert
    join public.facility_memberships membership
      on membership.organization_id = service_expert.organization_id
     and membership.facility_id = service_expert.facility_id
     and membership.user_id = service_expert.user_id
     and membership.is_bookable
    join public.users app_user on app_user.id = service_expert.user_id
    where service_expert.organization_id = widget_record.organization_id
      and service_expert.facility_id = widget_record.facility_id
      and service_expert.service_id = p_service_id
      and service_expert.is_active
      and (p_expert_user_id is null or service_expert.user_id = p_expert_user_id)
  ),
  candidate_slots as (
    select (
             slot_local.slot_value at time zone widget_record.timezone
           ) as slot_starts_at,
           expert.user_id,
           expert.display_name
    from facility_periods period
    cross join experts expert
    cross join lateral generate_series(
      period.local_date + period.opens_at
        + make_interval(mins => service_record.buffer_before_minutes),
      period.local_date + period.closes_at
        - make_interval(
            mins => service_record.duration_minutes
              + service_record.buffer_after_minutes
          ),
      make_interval(mins => service_record.slot_interval_minutes)
    ) slot_local(slot_value)
  )
  select distinct
         candidate.slot_starts_at,
         candidate.slot_starts_at
           + make_interval(mins => service_record.duration_minutes),
         candidate.user_id,
         candidate.display_name
  from candidate_slots candidate
  where private.expert_slot_is_available(
    widget_record.organization_id,
    widget_record.facility_id,
    p_service_id,
    candidate.user_id,
    candidate.slot_starts_at
  )
  order by 1, 4, 3;
end;
$$;

create or replace function private.widget_booking_result(target_appointment_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', appointment.id,
      'status', appointment.status,
      'startsAt', appointment.starts_at,
      'endsAt', appointment.ends_at,
      'facilityId', appointment.facility_id,
      'serviceId', appointment.service_id,
      'expert', jsonb_build_object(
        'userId', appointment.expert_user_id,
        'name', coalesce(app_user.full_name, 'Ekspert')
      )
    ),
    'managementToken', appointment.manage_token
  )
  from public.appointments appointment
  join public.users app_user on app_user.id = appointment.expert_user_id
  where appointment.id = target_appointment_id;
$$;

create or replace function public.create_widget_booking(
  p_widget_token uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_email text,
  p_idempotency_key text,
  p_customer_phone text default null,
  p_expert_user_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  widget_record record;
  service_record record;
  candidate record;
  inserted_appointment public.appointments;
  existing_appointment_id uuid;
begin
  if p_starts_at is null
     or nullif(btrim(p_customer_name), '') is null
     or length(btrim(p_customer_name)) > 200
     or nullif(btrim(p_customer_email), '') is null
     or length(btrim(p_customer_email)) > 320
     or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or (p_customer_phone is not null and length(btrim(p_customer_phone)) > 50)
     or (p_notes is not null and length(btrim(p_notes)) > 2000)
     or length(p_idempotency_key) > 200 then
    raise exception 'invalid_booking_request' using errcode = '22023';
  end if;

  select widget.id, widget.organization_id, widget.facility_id,
         widget.booking_mode, facility.timezone
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
   and facility.is_active
  where widget.public_token = p_widget_token
    and widget.is_active;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  perform private.assert_widget_origin_allowed(widget_record.id);

  if widget_record.booking_mode = 'expert' and p_expert_user_id is null then
    raise exception 'booking_widget_requires_expert' using errcode = '22023';
  elsif widget_record.booking_mode = 'facility' and p_expert_user_id is not null then
    raise exception 'booking_widget_does_not_allow_expert_selection' using errcode = '22023';
  end if;

  -- Serialize only retries carrying the same widget-scoped key. This makes a
  -- concurrent network retry observe and return the first committed booking
  -- instead of assigning a second expert before the unique check is visible.
  perform pg_advisory_xact_lock(hashtextextended(
    'openexpert-widget-booking:' || widget_record.id::text || ':' || btrim(p_idempotency_key),
    0
  ));

  select appointment.id
  into existing_appointment_id
  from public.appointments appointment
  where appointment.widget_id = widget_record.id
    and appointment.idempotency_key = btrim(p_idempotency_key)
    and appointment.service_id = p_service_id
    and appointment.starts_at = p_starts_at
    and appointment.customer_name = btrim(p_customer_name)
    and appointment.customer_email = lower(btrim(p_customer_email))
    and appointment.customer_phone is not distinct from nullif(btrim(p_customer_phone), '')
    and appointment.notes is not distinct from nullif(btrim(p_notes), '')
    and (p_expert_user_id is null or appointment.expert_user_id = p_expert_user_id);

  if found then
    return private.widget_booking_result(existing_appointment_id);
  end if;

  if exists (
    select 1
    from public.appointments appointment
    where appointment.widget_id = widget_record.id
      and appointment.idempotency_key = btrim(p_idempotency_key)
  ) then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  select service.duration_minutes
  into service_record
  from public.booking_widget_services allowed_service
  join public.facility_services facility_service
    on facility_service.organization_id = allowed_service.organization_id
   and facility_service.facility_id = allowed_service.facility_id
   and facility_service.service_id = allowed_service.service_id
   and facility_service.is_active
  join public.booking_services service
    on service.organization_id = allowed_service.organization_id
   and service.id = allowed_service.service_id
   and service.is_active
  where allowed_service.organization_id = widget_record.organization_id
    and allowed_service.facility_id = widget_record.facility_id
    and allowed_service.widget_id = widget_record.id
    and allowed_service.service_id = p_service_id;

  if not found then
    raise exception 'booking_service_not_available_in_widget' using errcode = '23503';
  end if;

  perform private.release_expired_booking_holds();

  for candidate in
    select service_expert.user_id
    from public.facility_service_experts service_expert
    join public.facility_memberships membership
      on membership.organization_id = service_expert.organization_id
     and membership.facility_id = service_expert.facility_id
     and membership.user_id = service_expert.user_id
     and membership.is_bookable
    where service_expert.organization_id = widget_record.organization_id
      and service_expert.facility_id = widget_record.facility_id
      and service_expert.service_id = p_service_id
      and service_expert.is_active
      and (p_expert_user_id is null or service_expert.user_id = p_expert_user_id)
    order by membership.booking_priority,
             membership.last_assigned_at asc nulls first,
             service_expert.user_id
  loop
    if private.expert_slot_is_available(
      widget_record.organization_id,
      widget_record.facility_id,
      p_service_id,
      candidate.user_id,
      p_starts_at
    ) then
      begin
        insert into public.appointments (
          organization_id,
          facility_id,
          service_id,
          expert_user_id,
          widget_id,
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
          idempotency_key
        ) values (
          widget_record.organization_id,
          widget_record.facility_id,
          p_service_id,
          candidate.user_id,
          widget_record.id,
          p_starts_at,
          p_starts_at + make_interval(mins => service_record.duration_minutes),
          widget_record.timezone,
          'confirmed',
          now(),
          btrim(p_customer_name),
          lower(btrim(p_customer_email)),
          nullif(btrim(p_customer_phone), ''),
          nullif(btrim(p_notes), ''),
          'widget',
          btrim(p_idempotency_key)
        )
        returning * into inserted_appointment;

        update public.facility_memberships membership
        set last_assigned_at = now()
        where membership.organization_id = widget_record.organization_id
          and membership.facility_id = widget_record.facility_id
          and membership.user_id = candidate.user_id;

        return private.widget_booking_result(inserted_appointment.id);
      exception
        when exclusion_violation then
          -- Another transaction won this expert; any-expert booking tries the
          -- next concrete candidate before returning a 23P01 slot conflict.
          continue;
        when unique_violation then
          select appointment.id
          into existing_appointment_id
          from public.appointments appointment
          where appointment.widget_id = widget_record.id
            and appointment.idempotency_key = btrim(p_idempotency_key)
            and appointment.service_id = p_service_id
            and appointment.starts_at = p_starts_at
            and appointment.customer_name = btrim(p_customer_name)
            and appointment.customer_email = lower(btrim(p_customer_email))
            and appointment.customer_phone is not distinct from nullif(btrim(p_customer_phone), '')
            and appointment.notes is not distinct from nullif(btrim(p_notes), '')
            and (p_expert_user_id is null or appointment.expert_user_id = p_expert_user_id);

          if found then
            return private.widget_booking_result(existing_appointment_id);
          end if;
          raise exception 'idempotency_key_reused' using errcode = '23505';
      end;
    end if;
  end loop;

  raise exception 'booking_slot_conflict'
    using errcode = '23P01',
          constraint = 'appointment_expert_reservations_no_overlap';
end;
$$;

create or replace function public.replace_facility_opening_hours(
  p_organization_id uuid,
  p_facility_id uuid,
  p_hours jsonb,
  p_overrides jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (
    private.is_organization_admin(p_organization_id)
    or private.is_facility_admin(p_organization_id, p_facility_id)
  ) then
    raise exception 'facility_admin_required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.facilities facility
    where facility.organization_id = p_organization_id
      and facility.id = p_facility_id
  ) then
    raise exception 'facility_not_found' using errcode = '23503';
  end if;

  if jsonb_typeof(coalesce(p_hours, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'schedule_payload_must_be_arrays' using errcode = '22023';
  end if;

  delete from public.facility_opening_hours opening
  where opening.organization_id = p_organization_id
    and opening.facility_id = p_facility_id;

  insert into public.facility_opening_hours (
    organization_id, facility_id, weekday, opens_at, closes_at, is_active
  )
  select p_organization_id,
         p_facility_id,
         (item ->> 'weekday')::smallint,
         coalesce(item ->> 'opensAt', item ->> 'opens_at')::time,
         coalesce(item ->> 'closesAt', item ->> 'closes_at')::time,
         coalesce((item ->> 'isActive')::boolean, (item ->> 'is_active')::boolean, true)
  from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) item;

  delete from public.facility_opening_overrides override
  where override.organization_id = p_organization_id
    and override.facility_id = p_facility_id;

  insert into public.facility_opening_overrides (
    organization_id, facility_id, local_date, is_closed, opens_at, closes_at
  )
  select p_organization_id,
         p_facility_id,
         coalesce(item ->> 'localDate', item ->> 'local_date')::date,
         coalesce((item ->> 'isClosed')::boolean, (item ->> 'is_closed')::boolean, false),
         case
           when coalesce((item ->> 'isClosed')::boolean, (item ->> 'is_closed')::boolean, false)
             then null
           else coalesce(item ->> 'opensAt', item ->> 'opens_at')::time
         end,
         case
           when coalesce((item ->> 'isClosed')::boolean, (item ->> 'is_closed')::boolean, false)
             then null
           else coalesce(item ->> 'closesAt', item ->> 'closes_at')::time
         end
  from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) item;
end;
$$;

create or replace function public.replace_expert_availability(
  p_organization_id uuid,
  p_facility_id uuid,
  p_user_id uuid,
  p_rules jsonb,
  p_overrides jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (
    private.is_organization_admin(p_organization_id)
    or private.is_facility_admin(p_organization_id, p_facility_id)
    or (
      p_user_id = (select auth.uid())
      and exists (
        select 1
        from public.facility_memberships membership
        where membership.organization_id = p_organization_id
          and membership.facility_id = p_facility_id
          and membership.user_id = p_user_id
      )
    )
  ) then
    raise exception 'expert_or_facility_admin_required' using errcode = '42501';
  end if;

  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_overrides, '[]'::jsonb)) <> 'array' then
    raise exception 'schedule_payload_must_be_arrays' using errcode = '22023';
  end if;

  delete from public.expert_availability_rules rule
  where rule.organization_id = p_organization_id
    and rule.facility_id = p_facility_id
    and rule.user_id = p_user_id;

  insert into public.expert_availability_rules (
    organization_id,
    facility_id,
    user_id,
    weekday,
    starts_at,
    ends_at,
    valid_from,
    valid_until,
    is_active
  )
  select p_organization_id,
         p_facility_id,
         p_user_id,
         (item ->> 'weekday')::smallint,
         coalesce(item ->> 'startsAt', item ->> 'starts_at')::time,
         coalesce(item ->> 'endsAt', item ->> 'ends_at')::time,
         nullif(coalesce(item ->> 'validFrom', item ->> 'valid_from'), '')::date,
         nullif(coalesce(item ->> 'validUntil', item ->> 'valid_until'), '')::date,
         coalesce((item ->> 'isActive')::boolean, (item ->> 'is_active')::boolean, true)
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) item;

  delete from public.expert_availability_overrides override
  where override.organization_id = p_organization_id
    and override.facility_id = p_facility_id
    and override.user_id = p_user_id;

  insert into public.expert_availability_overrides (
    organization_id,
    facility_id,
    user_id,
    local_date,
    is_unavailable,
    starts_at,
    ends_at
  )
  select p_organization_id,
         p_facility_id,
         p_user_id,
         coalesce(item ->> 'localDate', item ->> 'local_date')::date,
         coalesce(
           (item ->> 'isUnavailable')::boolean,
           (item ->> 'is_unavailable')::boolean,
           false
         ),
         case
           when coalesce(
             (item ->> 'isUnavailable')::boolean,
             (item ->> 'is_unavailable')::boolean,
             false
           ) then null
           else coalesce(item ->> 'startsAt', item ->> 'starts_at')::time
         end,
         case
           when coalesce(
             (item ->> 'isUnavailable')::boolean,
             (item ->> 'is_unavailable')::boolean,
             false
           ) then null
           else coalesce(item ->> 'endsAt', item ->> 'ends_at')::time
         end
  from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) item;
end;
$$;

create or replace function public.update_facility_service_configuration(
  p_organization_id uuid,
  p_facility_id uuid,
  p_service_id uuid,
  p_service_patch jsonb,
  p_update_availability boolean,
  p_is_available boolean,
  p_update_experts boolean,
  p_expert_user_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (
    private.is_organization_admin(p_organization_id)
    or private.is_facility_admin(p_organization_id, p_facility_id)
  ) then
    raise exception 'facility_admin_required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.facility_services facility_service
    where facility_service.organization_id = p_organization_id
      and facility_service.facility_id = p_facility_id
      and facility_service.service_id = p_service_id
  ) then
    raise exception 'facility_service_not_found' using errcode = 'P0002';
  end if;

  if coalesce(p_service_patch, '{}'::jsonb) <> '{}'::jsonb then
    if not private.is_organization_admin(p_organization_id) then
      raise exception 'organization_admin_required' using errcode = '42501';
    end if;

    update public.booking_services service
    set name = case when p_service_patch ? 'name' then p_service_patch ->> 'name' else service.name end,
        slug = case when p_service_patch ? 'slug' then p_service_patch ->> 'slug' else service.slug end,
        description = case when p_service_patch ? 'description' then p_service_patch ->> 'description' else service.description end,
        duration_minutes = case when p_service_patch ? 'duration_minutes' then (p_service_patch ->> 'duration_minutes')::integer else service.duration_minutes end,
        buffer_before_minutes = case when p_service_patch ? 'buffer_before_minutes' then (p_service_patch ->> 'buffer_before_minutes')::integer else service.buffer_before_minutes end,
        buffer_after_minutes = case when p_service_patch ? 'buffer_after_minutes' then (p_service_patch ->> 'buffer_after_minutes')::integer else service.buffer_after_minutes end,
        slot_interval_minutes = case when p_service_patch ? 'slot_interval_minutes' then (p_service_patch ->> 'slot_interval_minutes')::integer else service.slot_interval_minutes end,
        min_notice_minutes = case when p_service_patch ? 'min_notice_minutes' then (p_service_patch ->> 'min_notice_minutes')::integer else service.min_notice_minutes end,
        max_advance_days = case when p_service_patch ? 'max_advance_days' then (p_service_patch ->> 'max_advance_days')::integer else service.max_advance_days end,
        is_active = case when p_service_patch ? 'is_active' then (p_service_patch ->> 'is_active')::boolean else service.is_active end
    where service.organization_id = p_organization_id
      and service.id = p_service_id;

    if p_service_patch ? 'buffer_before_minutes'
       or p_service_patch ? 'buffer_after_minutes' then
      update public.appointments appointment
      set service_id = appointment.service_id
      where appointment.organization_id = p_organization_id
        and appointment.service_id = p_service_id
        and appointment.status in ('hold', 'confirmed');
    end if;
  end if;

  if p_update_availability then
    update public.facility_services facility_service
    set is_active = p_is_available
    where facility_service.organization_id = p_organization_id
      and facility_service.facility_id = p_facility_id
      and facility_service.service_id = p_service_id;
  end if;

  if p_update_experts then
    if exists (
      select 1
      from unnest(coalesce(p_expert_user_ids, '{}'::uuid[])) selected_user_id
      where not exists (
        select 1 from public.facility_memberships membership
        where membership.organization_id = p_organization_id
          and membership.facility_id = p_facility_id
          and membership.user_id = selected_user_id
          and membership.is_bookable
      )
    ) then
      raise exception 'expert_not_bookable_at_facility' using errcode = '23503';
    end if;

    update public.facility_service_experts service_expert
    set is_active = false
    where service_expert.organization_id = p_organization_id
      and service_expert.facility_id = p_facility_id
      and service_expert.service_id = p_service_id;

    insert into public.facility_service_experts (
      organization_id, facility_id, service_id, user_id, is_active
    )
    select p_organization_id, p_facility_id, p_service_id, selected_user_id, true
    from unnest(coalesce(p_expert_user_ids, '{}'::uuid[])) selected_user_id
    on conflict (organization_id, facility_id, service_id, user_id)
    do update set is_active = true, updated_at = now();
  end if;
end;
$$;

create or replace function public.update_booking_widget_configuration(
  p_organization_id uuid,
  p_facility_id uuid,
  p_widget_id uuid,
  p_widget_patch jsonb,
  p_update_services boolean,
  p_service_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not (
    private.is_organization_admin(p_organization_id)
    or private.is_facility_admin(p_organization_id, p_facility_id)
  ) then
    raise exception 'facility_admin_required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.booking_widgets widget
    where widget.organization_id = p_organization_id
      and widget.facility_id = p_facility_id
      and widget.id = p_widget_id
  ) then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  if coalesce(p_widget_patch, '{}'::jsonb) <> '{}'::jsonb then
    update public.booking_widgets widget
    set name = case when p_widget_patch ? 'name' then p_widget_patch ->> 'name' else widget.name end,
        slug = case when p_widget_patch ? 'slug' then p_widget_patch ->> 'slug' else widget.slug end,
        title = case when p_widget_patch ? 'title' then p_widget_patch ->> 'title' else widget.title end,
        subtitle = case when p_widget_patch ? 'subtitle' then p_widget_patch ->> 'subtitle' else widget.subtitle end,
        theme = case when p_widget_patch ? 'theme' then p_widget_patch ->> 'theme' else widget.theme end,
        accent_color = case when p_widget_patch ? 'accent_color' then p_widget_patch ->> 'accent_color' else widget.accent_color end,
        allowed_origins = case
          when p_widget_patch ? 'allowed_origins' then array(
            select jsonb_array_elements_text(p_widget_patch -> 'allowed_origins')
          )
          else widget.allowed_origins
        end,
        booking_mode = case when p_widget_patch ? 'booking_mode' then p_widget_patch ->> 'booking_mode' else widget.booking_mode end,
        locale = case when p_widget_patch ? 'locale' then p_widget_patch ->> 'locale' else widget.locale end,
        is_active = case when p_widget_patch ? 'is_active' then (p_widget_patch ->> 'is_active')::boolean else widget.is_active end
    where widget.organization_id = p_organization_id
      and widget.facility_id = p_facility_id
      and widget.id = p_widget_id;
  end if;

  if p_update_services then
    if exists (
      select 1
      from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id
      where not exists (
        select 1 from public.facility_services facility_service
        where facility_service.organization_id = p_organization_id
          and facility_service.facility_id = p_facility_id
          and facility_service.service_id = selected_service_id
          and facility_service.is_active
      )
    ) then
      raise exception 'service_not_active_at_facility' using errcode = '23503';
    end if;

    delete from public.booking_widget_services allowed_service
    where allowed_service.organization_id = p_organization_id
      and allowed_service.facility_id = p_facility_id
      and allowed_service.widget_id = p_widget_id;

    insert into public.booking_widget_services (
      organization_id, facility_id, widget_id, service_id
    )
    select p_organization_id, p_facility_id, p_widget_id, selected_service_id
    from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id;
  end if;
end;
$$;

-- RLS is enabled on every table in the exposed public schema. Anonymous users
-- receive no direct table or RPC privileges. Public booking traffic is
-- mediated by Nitro, which applies origin checks and rate limits.
alter table public.facilities enable row level security;
alter table public.team_facilities enable row level security;
alter table public.facility_memberships enable row level security;
alter table public.facility_opening_hours enable row level security;
alter table public.facility_opening_overrides enable row level security;
alter table public.expert_availability_rules enable row level security;
alter table public.expert_availability_overrides enable row level security;
alter table public.booking_services enable row level security;
alter table public.facility_services enable row level security;
alter table public.facility_service_experts enable row level security;
alter table public.booking_widgets enable row level security;
alter table public.booking_widget_services enable row level security;
alter table public.booking_rate_limits enable row level security;
alter table public.appointments enable row level security;
alter table public.appointment_resource_reservations enable row level security;
alter table public.calendar_connections enable row level security;
alter table public.external_busy_blocks enable row level security;
alter table public.appointment_calendar_events enable row level security;
alter table public.booking_outbox enable row level security;

create policy "scoped members can view facilities" on public.facilities
  for select to authenticated
  using ((select private.can_view_facility(organization_id, id)));
create policy "organization admins can create facilities" on public.facilities
  for insert to authenticated
  with check ((select private.is_organization_admin(organization_id)));
create policy "facility admins can update facilities" on public.facilities
  for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, id))
  );
create policy "organization admins can delete facilities" on public.facilities
  for delete to authenticated
  using ((select private.is_organization_admin(organization_id)));

create policy "scoped members can view team facility links" on public.team_facilities
  for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "organization or facility admins can link teams"
  on public.team_facilities for insert to authenticated
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );
create policy "organization or facility admins can unlink teams"
  on public.team_facilities for delete to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view facility memberships"
  on public.facility_memberships for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins can insert facility memberships"
  on public.facility_memberships for insert to authenticated
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );
create policy "facility admins can update facility memberships"
  on public.facility_memberships for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );
create policy "facility admins can delete facility memberships"
  on public.facility_memberships for delete to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view facility opening hours"
  on public.facility_opening_hours for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins can manage facility opening hours"
  on public.facility_opening_hours for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view facility opening overrides"
  on public.facility_opening_overrides for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins can manage facility opening overrides"
  on public.facility_opening_overrides for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view expert availability rules"
  on public.expert_availability_rules for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "admins or experts can manage expert availability rules"
  on public.expert_availability_rules for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
    or (
      user_id = (select auth.uid())
      and (select private.is_facility_member(organization_id, facility_id))
    )
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
    or (
      user_id = (select auth.uid())
      and (select private.is_facility_member(organization_id, facility_id))
    )
  );

create policy "scoped members can view expert availability overrides"
  on public.expert_availability_overrides for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "admins or experts can manage expert availability overrides"
  on public.expert_availability_overrides for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
    or (
      user_id = (select auth.uid())
      and (select private.is_facility_member(organization_id, facility_id))
    )
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
    or (
      user_id = (select auth.uid())
      and (select private.is_facility_member(organization_id, facility_id))
    )
  );

create policy "organization members can view booking services"
  on public.booking_services for select to authenticated
  using ((select private.is_organization_member(organization_id)));
create policy "organization admins can manage booking services"
  on public.booking_services for all to authenticated
  using ((select private.is_organization_admin(organization_id)))
  with check ((select private.is_organization_admin(organization_id)));

create policy "scoped members can view facility services"
  on public.facility_services for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins can manage facility services"
  on public.facility_services for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view facility service experts"
  on public.facility_service_experts for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins can manage facility service experts"
  on public.facility_service_experts for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view booking widgets"
  on public.booking_widgets for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins can manage booking widgets"
  on public.booking_widgets for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view booking widget services"
  on public.booking_widget_services for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins can manage booking widget services"
  on public.booking_widget_services for all to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
  );

create policy "scoped members can view appointments" on public.appointments
  for select to authenticated
  using ((select private.can_view_facility(organization_id, facility_id)));
create policy "facility admins or assigned experts can insert appointments"
  on public.appointments for insert to authenticated
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
    or (
      expert_user_id = (select auth.uid())
      and (select private.is_facility_member(organization_id, facility_id))
    )
  );
create policy "facility admins or assigned experts can update appointments"
  on public.appointments for update to authenticated
  using (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
    or expert_user_id = (select auth.uid())
  )
  with check (
    (select private.is_organization_admin(organization_id))
    or (select private.is_facility_admin(organization_id, facility_id))
    or (
      expert_user_id = (select auth.uid())
      and (select private.is_facility_member(organization_id, facility_id))
    )
  );
create policy "organization admins can delete appointments" on public.appointments
  for delete to authenticated
  using ((select private.is_organization_admin(organization_id)));

-- Tables below are intentionally server-only. RLS has no authenticated policy
-- and grants are revoked below: reservations, OAuth secrets, busy cache,
-- provider mappings and the durable outbox cannot be queried from browsers.

revoke all on table
  public.facilities,
  public.team_facilities,
  public.facility_memberships,
  public.facility_opening_hours,
  public.facility_opening_overrides,
  public.expert_availability_rules,
  public.expert_availability_overrides,
  public.booking_services,
  public.facility_services,
  public.facility_service_experts,
  public.booking_widgets,
  public.booking_widget_services,
  public.booking_rate_limits,
  public.appointments,
  public.appointment_resource_reservations,
  public.calendar_connections,
  public.external_busy_blocks,
  public.appointment_calendar_events,
  public.booking_outbox
from anon, authenticated;

grant select, insert, update, delete on table
  public.facilities,
  public.facility_memberships,
  public.facility_opening_hours,
  public.facility_opening_overrides,
  public.expert_availability_rules,
  public.expert_availability_overrides,
  public.booking_services,
  public.facility_services,
  public.facility_service_experts,
  public.booking_widgets,
  public.booking_widget_services
to authenticated;

grant select, insert, delete on table public.team_facilities to authenticated;

grant all privileges on table
  public.facilities,
  public.team_facilities,
  public.facility_memberships,
  public.facility_opening_hours,
  public.facility_opening_overrides,
  public.expert_availability_rules,
  public.expert_availability_overrides,
  public.booking_services,
  public.facility_services,
  public.facility_service_experts,
  public.booking_widgets,
  public.booking_widget_services,
  public.booking_rate_limits,
  public.appointments,
  public.appointment_resource_reservations,
  public.calendar_connections,
  public.external_busy_blocks,
  public.appointment_calendar_events,
  public.booking_outbox
to service_role;
grant usage, select on sequence public.booking_outbox_id_seq to service_role;

revoke all on function private.validate_facility_timezone() from public, anon, authenticated;
revoke all on function private.sync_appointment_reservation() from public, anon, authenticated;
revoke all on function private.enqueue_appointment_outbox() from public, anon, authenticated;
revoke all on function private.reset_calendar_connection_dependents() from public, anon, authenticated;
revoke all on function private.release_expired_booking_holds(uuid) from public, anon, authenticated;
revoke all on function private.expert_slot_is_available(uuid, uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function private.assert_widget_origin_allowed(uuid) from public, anon, authenticated;
revoke all on function private.widget_booking_result(uuid) from public, anon, authenticated;

revoke all on function public.get_booking_widget_catalog(uuid) from public, anon, authenticated;
revoke all on function public.get_booking_widget_slots(uuid, uuid, date, date, uuid)
  from public, anon, authenticated;
revoke all on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text
) from public, anon, authenticated;
revoke all on function public.replace_facility_opening_hours(uuid, uuid, jsonb, jsonb)
  from public, anon;
revoke all on function public.replace_expert_availability(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon;
revoke all on function public.update_facility_service_configuration(
  uuid, uuid, uuid, jsonb, boolean, boolean, boolean, uuid[]
) from public, anon;
revoke all on function public.update_booking_widget_configuration(
  uuid, uuid, uuid, jsonb, boolean, uuid[]
) from public, anon;
revoke all on function public.replace_calendar_busy_blocks(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.consume_booking_rate_limit(uuid, text, text, integer, integer)
  from public, anon, authenticated;

grant execute on function public.get_booking_widget_catalog(uuid)
  to service_role;
grant execute on function public.get_booking_widget_slots(uuid, uuid, date, date, uuid)
  to service_role;
grant execute on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text
) to service_role;
grant execute on function public.replace_facility_opening_hours(uuid, uuid, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.replace_expert_availability(uuid, uuid, uuid, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.update_facility_service_configuration(
  uuid, uuid, uuid, jsonb, boolean, boolean, boolean, uuid[]
) to authenticated, service_role;
grant execute on function public.update_booking_widget_configuration(
  uuid, uuid, uuid, jsonb, boolean, uuid[]
) to authenticated, service_role;
grant execute on function public.replace_calendar_busy_blocks(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.consume_booking_rate_limit(uuid, text, text, integer, integer)
  to service_role;

create trigger facilities_set_updated_at
  before update on public.facilities
  for each row execute function public.set_updated_at();
create trigger facility_memberships_set_updated_at
  before update on public.facility_memberships
  for each row execute function public.set_updated_at();
create trigger facility_opening_hours_set_updated_at
  before update on public.facility_opening_hours
  for each row execute function public.set_updated_at();
create trigger facility_opening_overrides_set_updated_at
  before update on public.facility_opening_overrides
  for each row execute function public.set_updated_at();
create trigger expert_availability_rules_set_updated_at
  before update on public.expert_availability_rules
  for each row execute function public.set_updated_at();
create trigger expert_availability_overrides_set_updated_at
  before update on public.expert_availability_overrides
  for each row execute function public.set_updated_at();
create trigger booking_services_set_updated_at
  before update on public.booking_services
  for each row execute function public.set_updated_at();
create trigger facility_services_set_updated_at
  before update on public.facility_services
  for each row execute function public.set_updated_at();
create trigger facility_service_experts_set_updated_at
  before update on public.facility_service_experts
  for each row execute function public.set_updated_at();
create trigger booking_widgets_set_updated_at
  before update on public.booking_widgets
  for each row execute function public.set_updated_at();
create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();
create trigger appointment_resource_reservations_set_updated_at
  before update on public.appointment_resource_reservations
  for each row execute function public.set_updated_at();
create trigger calendar_connections_set_updated_at
  before update on public.calendar_connections
  for each row execute function public.set_updated_at();
create trigger external_busy_blocks_set_updated_at
  before update on public.external_busy_blocks
  for each row execute function public.set_updated_at();
create trigger appointment_calendar_events_set_updated_at
  before update on public.appointment_calendar_events
  for each row execute function public.set_updated_at();

comment on column public.facility_opening_hours.weekday is
  'ISO weekday used by the UI: 0=Monday through 6=Sunday.';
comment on column public.expert_availability_rules.weekday is
  'ISO weekday used by the UI: 0=Monday through 6=Sunday.';
comment on column public.facilities.timezone is
  'IANA timezone used to interpret local recurring schedules; defaults to Europe/Warsaw.';
comment on column public.booking_widgets.public_token is
  'Public, high-entropy widget identifier; it is not an authorization secret.';
comment on column public.booking_widgets.allowed_origins is
  'Embedding allowlist enforced by the server API and defensively checked by booking RPCs.';
comment on table public.calendar_connections is
  'Server-only OAuth connection metadata; encrypted_* values must be application-encrypted.';
comment on table public.external_busy_blocks is
  'Privacy-minimized external availability cache: identifiers and half-open busy ranges only.';
comment on table public.appointment_resource_reservations is
  'Concrete expert/room/equipment holds protected by a GiST overlap exclusion constraint.';

notify pgrst, 'reload schema';
