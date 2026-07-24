-- Harden widget analytics for historical accuracy, aggregate list counts, and
-- keep daily reporting efficient as event volume grows.

alter table public.booking_widgets
  add column analytics_started_at timestamptz not null default now();

comment on column public.booking_widgets.analytics_started_at is
  'Earliest timestamp included in widget funnel analytics. Prevents pre-tracking bookings from distorting conversion.';

create index booking_widget_events_retention_idx
  on public.booking_widget_events(occurred_at);

create or replace function private.prune_booking_widget_events()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- Sampled per-widget cleanup avoids adding a delete query to every public
  -- request while still enforcing retention for widgets that generate traffic.
  if random() < 0.01 then
    delete from public.booking_widget_events event
    where event.organization_id = new.organization_id
      and event.widget_id = new.widget_id
      and event.occurred_at < now() - interval '400 days';
  end if;
  return new;
end;
$$;

revoke all on function private.prune_booking_widget_events() from public;

create trigger booking_widget_events_retention
before insert on public.booking_widget_events
for each row execute function private.prune_booking_widget_events();

create or replace function public.get_personal_booking_widget_counts(
  p_organization_id uuid,
  p_expert_user_id uuid,
  p_since timestamptz
)
returns table(widget_id uuid, bookings bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    widget.id as widget_id,
    count(appointment.id)::bigint as bookings
  from public.booking_widgets widget
  left join public.appointments appointment
    on appointment.organization_id = widget.organization_id
   and appointment.widget_id = widget.id
   and appointment.expert_user_id = p_expert_user_id
   and appointment.created_at >= coalesce(p_since, '-infinity'::timestamptz)
  where widget.organization_id = p_organization_id
    and widget.fixed_expert_user_id = p_expert_user_id
    and (
      select private.can_manage_booking_widget(
        widget.organization_id,
        widget.facility_id,
        widget.fixed_expert_user_id
      )
    )
  group by widget.id;
$$;

revoke all on function public.get_personal_booking_widget_counts(uuid, uuid, timestamptz)
  from public, anon;
grant execute on function public.get_personal_booking_widget_counts(uuid, uuid, timestamptz)
  to authenticated, service_role;

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
  effective_start timestamptz;
  event_summary jsonb;
  appointment_summary jsonb;
  daily_result jsonb;
  top_services_result jsonb;
  last_booking_at timestamptz;
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
    widget.fixed_expert_user_id,
    widget.analytics_started_at,
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
  effective_start := greatest(period_start, widget_record.analytics_started_at);

  select jsonb_build_object(
    'views', count(*) filter (where event.event_type = 'widget_view'),
    'embeddedViews', count(*) filter (
      where event.event_type = 'widget_view' and event.is_embedded
    ),
    'availabilitySearches', count(*) filter (
      where event.event_type = 'availability_search'
    ),
    'bookingAttempts', count(*) filter (
      where event.event_type = 'booking_attempt'
    )
  )
  into event_summary
  from public.booking_widget_events event
  where event.organization_id = widget_record.organization_id
    and event.widget_id = widget_record.id
    and event.occurred_at >= effective_start
    and event.occurred_at < period_end;

  select jsonb_build_object(
    'bookings', count(*),
    'confirmedBookings', count(*) filter (where appointment.status = 'confirmed'),
    'cancelledBookings', count(*) filter (where appointment.status = 'cancelled')
  )
  into appointment_summary
  from public.appointments appointment
  where appointment.organization_id = widget_record.organization_id
    and appointment.widget_id = widget_record.id
    and appointment.created_at >= effective_start
    and appointment.created_at < period_end;

  select max(appointment.created_at)
  into last_booking_at
  from public.appointments appointment
  where appointment.organization_id = widget_record.organization_id
    and appointment.widget_id = widget_record.id
    and appointment.created_at >= widget_record.analytics_started_at;

  with
  days as (
    select day::date as day
    from generate_series(p_from, p_to, interval '1 day') day
  ),
  event_daily as (
    select
      (event.occurred_at at time zone widget_record.timezone)::date as day,
      count(*) filter (where event.event_type = 'widget_view') as views,
      count(*) filter (where event.event_type = 'availability_search') as availability_searches,
      count(*) filter (where event.event_type = 'booking_attempt') as booking_attempts
    from public.booking_widget_events event
    where event.organization_id = widget_record.organization_id
      and event.widget_id = widget_record.id
      and event.occurred_at >= effective_start
      and event.occurred_at < period_end
    group by (event.occurred_at at time zone widget_record.timezone)::date
  ),
  appointment_daily as (
    select
      (appointment.created_at at time zone widget_record.timezone)::date as day,
      count(*) as bookings
    from public.appointments appointment
    where appointment.organization_id = widget_record.organization_id
      and appointment.widget_id = widget_record.id
      and appointment.created_at >= effective_start
      and appointment.created_at < period_end
    group by (appointment.created_at at time zone widget_record.timezone)::date
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', days.day,
        'views', coalesce(event_daily.views, 0),
        'availabilitySearches', coalesce(event_daily.availability_searches, 0),
        'bookingAttempts', coalesce(event_daily.booking_attempts, 0),
        'bookings', coalesce(appointment_daily.bookings, 0)
      )
      order by days.day
    ),
    '[]'::jsonb
  )
  into daily_result
  from days
  left join event_daily on event_daily.day = days.day
  left join appointment_daily on appointment_daily.day = days.day;

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
  into top_services_result
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
      and appointment.created_at >= effective_start
      and appointment.created_at < period_end
    group by service.id, service.name
    order by count(*) desc, service.name
    limit 5
  ) service_value;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'timeZone', widget_record.timezone,
      'trackingStartedAt', widget_record.analytics_started_at
    ),
    'summary',
      event_summary
      || appointment_summary
      || jsonb_build_object('lastBookingAt', last_booking_at),
    'daily', daily_result,
    'topServices', top_services_result
  );
end;
$$;

revoke all on function public.get_booking_widget_analytics(uuid, uuid, date, date)
  from public, anon;
grant execute on function public.get_booking_widget_analytics(uuid, uuid, date, date)
  to authenticated, service_role;
