-- Privacy-preserving funnel analytics for public booking widgets.
--
-- Events deliberately contain no IP address, user agent, referrer, contact
-- details or free-form metadata. Successful bookings remain authoritative in
-- public.appointments; this table only captures earlier funnel steps.

create table public.booking_widget_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  facility_id uuid not null,
  widget_id uuid not null,
  event_type text not null check (
    event_type in ('widget_view', 'availability_search', 'booking_attempt')
  ),
  service_id uuid,
  is_embedded boolean not null default false,
  occurred_at timestamptz not null default now(),
  constraint booking_widget_events_widget_fkey
    foreign key (organization_id, facility_id, widget_id)
    references public.booking_widgets(organization_id, facility_id, id)
    on delete cascade,
  constraint booking_widget_events_service_fkey
    foreign key (organization_id, service_id)
    references public.booking_services(organization_id, id)
    on delete set null (service_id),
  constraint booking_widget_events_service_shape check (
    (event_type = 'widget_view' and service_id is null)
    or (event_type <> 'widget_view' and service_id is not null)
  )
);

create index booking_widget_events_widget_time_idx
  on public.booking_widget_events(organization_id, widget_id, occurred_at desc);

create index booking_widget_events_service_time_idx
  on public.booking_widget_events(organization_id, service_id, occurred_at desc)
  where service_id is not null;

comment on table public.booking_widget_events is
  'PII-free funnel events for booking widgets. Successful bookings are read from appointments.';

alter table public.booking_widget_events enable row level security;

revoke all on table public.booking_widget_events from public, anon, authenticated;
revoke all on sequence public.booking_widget_events_id_seq from public, anon, authenticated;

grant select, insert, delete on table public.booking_widget_events to service_role;
grant usage, select on sequence public.booking_widget_events_id_seq to service_role;

create or replace function public.record_booking_widget_event(
  p_widget_token uuid,
  p_event_type text,
  p_service_id uuid default null,
  p_is_embedded boolean default false
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  widget_record record;
begin
  if p_event_type not in ('widget_view', 'availability_search', 'booking_attempt') then
    raise exception 'invalid_booking_widget_event_type' using errcode = '22023';
  end if;

  if (p_event_type = 'widget_view' and p_service_id is not null)
     or (p_event_type <> 'widget_view' and p_service_id is null) then
    raise exception 'invalid_booking_widget_event_service' using errcode = '22023';
  end if;

  select widget.id, widget.organization_id, widget.facility_id
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

  if p_service_id is not null
     and not exists (
       select 1
       from public.booking_widget_services widget_service
       join public.facility_services facility_service
         on facility_service.organization_id = widget_service.organization_id
        and facility_service.facility_id = widget_service.facility_id
        and facility_service.service_id = widget_service.service_id
        and facility_service.is_active
       join public.booking_services service
         on service.organization_id = widget_service.organization_id
        and service.id = widget_service.service_id
        and service.is_active
       where widget_service.organization_id = widget_record.organization_id
         and widget_service.facility_id = widget_record.facility_id
         and widget_service.widget_id = widget_record.id
         and widget_service.service_id = p_service_id
     ) then
    raise exception 'booking_service_not_available_in_widget' using errcode = '23503';
  end if;

  insert into public.booking_widget_events (
    organization_id,
    facility_id,
    widget_id,
    event_type,
    service_id,
    is_embedded
  ) values (
    widget_record.organization_id,
    widget_record.facility_id,
    widget_record.id,
    p_event_type,
    p_service_id,
    coalesce(p_is_embedded, false)
  );
end;
$$;

revoke all on function public.record_booking_widget_event(uuid, text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_booking_widget_event(uuid, text, uuid, boolean)
  to service_role;

create or replace function public.get_booking_widget_analytics(
  p_organization_id uuid,
  p_widget_id uuid,
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  widget_record record;
  period_start timestamptz;
  period_end timestamptz;
  result jsonb;
begin
  if p_from is null
     or p_to is null
     or p_to < p_from
     or (p_to - p_from) > 365 then
    raise exception 'invalid_booking_widget_analytics_range' using errcode = '22023';
  end if;

  select
    widget.organization_id,
    widget.facility_id,
    widget.id,
    facility.timezone
  into widget_record
  from public.booking_widgets widget
  join public.facilities facility
    on facility.organization_id = widget.organization_id
   and facility.id = widget.facility_id
  where widget.organization_id = p_organization_id
    and widget.id = p_widget_id
    and (
      select private.can_manage_booking_widget(
        widget.organization_id,
        widget.facility_id,
        widget.fixed_expert_user_id
      )
    );

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  period_start := p_from::timestamp at time zone widget_record.timezone;
  period_end := (p_to + 1)::timestamp at time zone widget_record.timezone;

  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'timeZone', widget_record.timezone
    ),
    'summary', jsonb_build_object(
      'views', (
        select count(*)
        from public.booking_widget_events event
        where event.organization_id = widget_record.organization_id
          and event.widget_id = widget_record.id
          and event.event_type = 'widget_view'
          and event.occurred_at >= period_start
          and event.occurred_at < period_end
      ),
      'embeddedViews', (
        select count(*)
        from public.booking_widget_events event
        where event.organization_id = widget_record.organization_id
          and event.widget_id = widget_record.id
          and event.event_type = 'widget_view'
          and event.is_embedded
          and event.occurred_at >= period_start
          and event.occurred_at < period_end
      ),
      'availabilitySearches', (
        select count(*)
        from public.booking_widget_events event
        where event.organization_id = widget_record.organization_id
          and event.widget_id = widget_record.id
          and event.event_type = 'availability_search'
          and event.occurred_at >= period_start
          and event.occurred_at < period_end
      ),
      'bookingAttempts', (
        select count(*)
        from public.booking_widget_events event
        where event.organization_id = widget_record.organization_id
          and event.widget_id = widget_record.id
          and event.event_type = 'booking_attempt'
          and event.occurred_at >= period_start
          and event.occurred_at < period_end
      ),
      'bookings', (
        select count(*)
        from public.appointments appointment
        where appointment.organization_id = widget_record.organization_id
          and appointment.widget_id = widget_record.id
          and appointment.created_at >= period_start
          and appointment.created_at < period_end
      ),
      'confirmedBookings', (
        select count(*)
        from public.appointments appointment
        where appointment.organization_id = widget_record.organization_id
          and appointment.widget_id = widget_record.id
          and appointment.status = 'confirmed'
          and appointment.created_at >= period_start
          and appointment.created_at < period_end
      ),
      'cancelledBookings', (
        select count(*)
        from public.appointments appointment
        where appointment.organization_id = widget_record.organization_id
          and appointment.widget_id = widget_record.id
          and appointment.status = 'cancelled'
          and appointment.created_at >= period_start
          and appointment.created_at < period_end
      ),
      'lastBookingAt', (
        select max(appointment.created_at)
        from public.appointments appointment
        where appointment.organization_id = widget_record.organization_id
          and appointment.widget_id = widget_record.id
      )
    ),
    'daily', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'date', day_value.day,
            'views', day_value.views,
            'availabilitySearches', day_value.availability_searches,
            'bookingAttempts', day_value.booking_attempts,
            'bookings', day_value.bookings
          )
          order by day_value.day
        ),
        '[]'::jsonb
      )
      from (
        select
          day::date as day,
          (
            select count(*)
            from public.booking_widget_events event
            where event.organization_id = widget_record.organization_id
              and event.widget_id = widget_record.id
              and event.event_type = 'widget_view'
              and (event.occurred_at at time zone widget_record.timezone)::date = day::date
          ) as views,
          (
            select count(*)
            from public.booking_widget_events event
            where event.organization_id = widget_record.organization_id
              and event.widget_id = widget_record.id
              and event.event_type = 'availability_search'
              and (event.occurred_at at time zone widget_record.timezone)::date = day::date
          ) as availability_searches,
          (
            select count(*)
            from public.booking_widget_events event
            where event.organization_id = widget_record.organization_id
              and event.widget_id = widget_record.id
              and event.event_type = 'booking_attempt'
              and (event.occurred_at at time zone widget_record.timezone)::date = day::date
          ) as booking_attempts,
          (
            select count(*)
            from public.appointments appointment
            where appointment.organization_id = widget_record.organization_id
              and appointment.widget_id = widget_record.id
              and (appointment.created_at at time zone widget_record.timezone)::date = day::date
          ) as bookings
        from generate_series(p_from, p_to, interval '1 day') day
      ) day_value
    ),
    'topServices', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'serviceId', service_value.service_id,
            'name', service_value.service_name,
            'bookings', service_value.bookings
          )
          order by service_value.bookings desc, service_value.service_name
        ),
        '[]'::jsonb
      )
      from (
        select
          service.id as service_id,
          service.name as service_name,
          count(*) as bookings
        from public.appointments appointment
        join public.booking_services service
          on service.organization_id = appointment.organization_id
         and service.id = appointment.service_id
        where appointment.organization_id = widget_record.organization_id
          and appointment.widget_id = widget_record.id
          and appointment.created_at >= period_start
          and appointment.created_at < period_end
        group by service.id, service.name
        order by count(*) desc, service.name
        limit 5
      ) service_value
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_booking_widget_analytics(uuid, uuid, date, date)
  from public, anon;
grant execute on function public.get_booking_widget_analytics(uuid, uuid, date, date)
  to authenticated, service_role;
