-- Privacy-preserving, visit-based booking widget funnel.
--
-- visit_id is an ephemeral UUID generated in memory by the public widget. It is
-- deliberately not linked to a cookie, account, IP address, contact detail or
-- any other identifier.

alter table public.booking_widget_events
  add column visit_id uuid,
  add column event_id text;

update public.booking_widget_events
set visit_id = gen_random_uuid()
where visit_id is null;

alter table public.booking_widget_events
  alter column visit_id set not null;

comment on column public.booking_widget_events.visit_id is
  'Ephemeral, per-widget-page-load UUID used only to deduplicate funnel stages. Not persisted in a browser cookie.';

comment on column public.booking_widget_events.event_id is
  'SHA-256 digest of the random booking idempotency key. Contains no booking or customer data.';

alter table public.booking_widget_events
  drop constraint booking_widget_events_event_type_check,
  drop constraint booking_widget_events_service_shape,
  drop constraint booking_widget_events_service_fkey;

-- Legacy service-scoped rows may already have a null service after the former
-- ON DELETE SET NULL action. NOT VALID preserves them, while PostgreSQL still
-- enforces the stricter shape for every new or updated row.
alter table public.booking_widget_events
  add constraint booking_widget_events_event_type_check check (
    event_type in (
      'widget_view',
      'widget_engaged',
      'calculator_started',
      'calculator_completed',
      'service_selected',
      'availability_search',
      'availability_found',
      'slot_selected',
      'contact_started',
      'booking_attempt',
      'booking_completed'
    )
  ),
  add constraint booking_widget_events_service_shape check (
    (
      event_type in (
        'widget_view',
        'widget_engaged',
        'calculator_started',
        'calculator_completed'
      )
      and service_id is null
    )
    or (
      event_type in (
        'service_selected',
        'availability_search',
        'availability_found',
        'slot_selected',
        'contact_started',
        'booking_attempt',
        'booking_completed'
      )
      and service_id is not null
    )
  ) not valid,
  add constraint booking_widget_events_event_id_shape check (
    (
      event_type in ('booking_attempt', 'booking_completed')
      and event_id is not null
      and event_id ~ '^[0-9a-f]{64}$'
    )
    or (
      event_type not in ('booking_attempt', 'booking_completed')
      and event_id is null
    )
  ) not valid,
  add constraint booking_widget_events_service_fkey
    foreign key (organization_id, service_id)
    references public.booking_services(organization_id, id)
    on delete cascade;

create unique index booking_widget_events_visit_event_service_key
  on public.booking_widget_events(widget_id, visit_id, event_type, service_id)
  nulls not distinct;

comment on index public.booking_widget_events_visit_event_service_key is
  'One funnel stage per widget visit, event type and optional service. Makes public retries idempotent.';

create unique index booking_widget_events_booking_event_key
  on public.booking_widget_events(widget_id, event_type, event_id)
  where event_id is not null;

comment on index public.booking_widget_events_booking_event_key is
  'Prevents an idempotent booking retry from becoming a second attempt or completion after a page refresh.';

update public.booking_widgets
set analytics_started_at = statement_timestamp();

create or replace function private.prune_booking_widget_events()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- The existing trigger samples inserts, but every sampled cleanup is global.
  -- This also removes stale events for widgets that no longer receive traffic.
  if random() < 0.01 then
    delete from public.booking_widget_events event
    where event.occurred_at < now() - interval '120 days';
  end if;
  return new;
end;
$$;

revoke all on function private.prune_booking_widget_events() from public;

alter table public.booking_rate_limits
  drop constraint if exists booking_rate_limits_rate_scope_check;

alter table public.booking_rate_limits
  add constraint booking_rate_limits_rate_scope_check check (
    rate_scope in ('catalog', 'slots', 'booking', 'analytics')
  );

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
  if p_scope not in ('catalog', 'slots', 'booking', 'analytics')
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
    and (widget.is_active or p_scope = 'booking');

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );

  insert into public.booking_rate_limits (
    widget_id,
    rate_scope,
    client_key,
    window_started_at,
    request_count
  ) values (
    target_widget_id,
    p_scope,
    p_client_key,
    window_start,
    1
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

revoke all on function public.consume_booking_rate_limit(uuid, text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.consume_booking_rate_limit(uuid, text, text, integer, integer)
  to service_role;

drop function if exists public.record_booking_widget_event(uuid, text, uuid, boolean);

create function public.record_booking_widget_event(
  p_widget_token uuid,
  p_visit_id uuid,
  p_event_type text,
  p_service_id uuid default null,
  p_event_id text default null,
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
  service_scoped_event boolean;
begin
  if p_visit_id is null then
    raise exception 'invalid_booking_widget_visit' using errcode = '22023';
  end if;

  if p_event_type is null
     or p_event_type not in (
       'widget_view',
       'widget_engaged',
       'calculator_started',
       'calculator_completed',
       'service_selected',
       'availability_search',
       'availability_found',
       'slot_selected',
       'contact_started',
       'booking_attempt',
       'booking_completed'
     ) then
    raise exception 'invalid_booking_widget_event_type' using errcode = '22023';
  end if;

  service_scoped_event := p_event_type in (
    'service_selected',
    'availability_search',
    'availability_found',
    'slot_selected',
    'contact_started',
    'booking_attempt',
    'booking_completed'
  );

  if (service_scoped_event and p_service_id is null)
     or (not service_scoped_event and p_service_id is not null) then
    raise exception 'invalid_booking_widget_event_service' using errcode = '22023';
  end if;

  if (
    p_event_type in ('booking_attempt', 'booking_completed')
    and (
      p_event_id is null
      or p_event_id !~ '^[0-9a-f]{64}$'
    )
  ) or (
    p_event_type not in ('booking_attempt', 'booking_completed')
    and p_event_id is not null
  ) then
    raise exception 'invalid_booking_widget_event_id' using errcode = '22023';
  end if;

  select
    widget.id,
    widget.organization_id,
    widget.facility_id
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
     and p_event_type <> 'booking_completed'
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

  if p_service_id is not null
     and p_event_type = 'booking_completed'
     and not exists (
       select 1
       from public.booking_services service
       where service.organization_id = widget_record.organization_id
         and service.id = p_service_id
     ) then
    raise exception 'booking_service_not_found' using errcode = '23503';
  end if;

  insert into public.booking_widget_events (
    organization_id,
    facility_id,
    widget_id,
    visit_id,
    event_type,
    service_id,
    event_id,
    is_embedded
  ) values (
    widget_record.organization_id,
    widget_record.facility_id,
    widget_record.id,
    p_visit_id,
    p_event_type,
    p_service_id,
    p_event_id,
    coalesce(p_is_embedded, false)
  )
  on conflict do nothing;
end;
$$;

revoke all on function public.record_booking_widget_event(uuid, uuid, text, uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_booking_widget_event(uuid, uuid, text, uuid, text, boolean)
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
  effective_start timestamptz;
  last_booking_at timestamptz;
  result jsonb;
begin
  if p_from is null
     or p_to is null
     or p_to < p_from
     or (p_to - p_from) > 89 then
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

  select max(appointment.created_at)
  into last_booking_at
  from public.appointments appointment
  where appointment.organization_id = widget_record.organization_id
    and appointment.widget_id = widget_record.id
    and appointment.created_at >= effective_start
    and appointment.created_at < period_end;

  with
  filtered_events as materialized (
    select
      event.visit_id,
      event.event_type,
      event.service_id,
      event.is_embedded,
      (event.occurred_at at time zone widget_record.timezone)::date as day
    from public.booking_widget_events event
    where event.organization_id = widget_record.organization_id
      and event.widget_id = widget_record.id
      and event.occurred_at >= effective_start
      and event.occurred_at < period_end
  ),
  filtered_appointments as materialized (
    select
      appointment.id,
      appointment.service_id,
      appointment.status,
      (appointment.created_at at time zone widget_record.timezone)::date as day
    from public.appointments appointment
    where appointment.organization_id = widget_record.organization_id
      and appointment.widget_id = widget_record.id
      and appointment.created_at >= effective_start
      and appointment.created_at < period_end
  ),
  event_totals as (
    select
      count(distinct visit_id) filter (
        where event_type = 'widget_view'
      ) as views,
      count(distinct visit_id) filter (
        where event_type = 'widget_view' and is_embedded
      ) as embedded_views,
      count(distinct visit_id) filter (
        where event_type = 'widget_engaged'
      ) as engaged_visits,
      count(distinct visit_id) filter (
        where event_type = 'calculator_started'
      ) as calculator_starts,
      count(distinct visit_id) filter (
        where event_type = 'calculator_completed'
      ) as calculator_completions,
      count(distinct visit_id) filter (
        where event_type = 'service_selected'
      ) as service_selections,
      count(distinct visit_id) filter (
        where event_type = 'availability_search'
      ) as availability_searches,
      count(distinct visit_id) filter (
        where event_type = 'availability_found'
      ) as availability_found,
      count(distinct visit_id) filter (
        where event_type = 'slot_selected'
      ) as slot_selections,
      count(distinct visit_id) filter (
        where event_type = 'contact_started'
      ) as contact_starts,
      count(distinct visit_id) filter (
        where event_type = 'booking_attempt'
      ) as booking_attempts,
      count(distinct visit_id) filter (
        where event_type = 'booking_completed'
      ) as booking_completions
    from filtered_events
  ),
  appointment_totals as (
    select
      count(*) as bookings,
      count(*) filter (where status = 'confirmed') as confirmed_bookings,
      count(*) filter (where status = 'cancelled') as cancelled_bookings
    from filtered_appointments
  ),
  days as (
    select day::date as day
    from generate_series(
      p_from::timestamp,
      p_to::timestamp,
      interval '1 day'
    ) day
  ),
  event_daily as (
    select
      day,
      count(distinct visit_id) filter (
        where event_type = 'widget_view'
      ) as views,
      count(distinct visit_id) filter (
        where event_type = 'widget_engaged'
      ) as engaged_visits,
      count(distinct visit_id) filter (
        where event_type = 'calculator_completed'
      ) as calculator_completions,
      count(distinct visit_id) filter (
        where event_type = 'availability_search'
      ) as availability_searches,
      count(distinct visit_id) filter (
        where event_type = 'availability_found'
      ) as availability_found,
      count(distinct visit_id) filter (
        where event_type = 'slot_selected'
      ) as slot_selections,
      count(distinct visit_id) filter (
        where event_type = 'contact_started'
      ) as contact_starts,
      count(distinct visit_id) filter (
        where event_type = 'booking_attempt'
      ) as booking_attempts,
      count(distinct visit_id) filter (
        where event_type = 'booking_completed'
      ) as booking_completions
    from filtered_events
    group by day
  ),
  appointment_daily as (
    select
      day,
      count(*) as bookings
    from filtered_appointments
    group by day
  ),
  daily_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'date', days.day,
          'views', coalesce(event_daily.views, 0),
          'engagedVisits', coalesce(event_daily.engaged_visits, 0),
          'calculatorCompletions', coalesce(event_daily.calculator_completions, 0),
          'availabilitySearches', coalesce(event_daily.availability_searches, 0),
          'availabilityFound', coalesce(event_daily.availability_found, 0),
          'slotSelections', coalesce(event_daily.slot_selections, 0),
          'contactStarts', coalesce(event_daily.contact_starts, 0),
          'bookingAttempts', coalesce(event_daily.booking_attempts, 0),
          'bookingCompletions', coalesce(event_daily.booking_completions, 0),
          'bookings', coalesce(appointment_daily.bookings, 0)
        )
        order by days.day
      ),
      '[]'::jsonb
    ) as value
    from days
    left join event_daily on event_daily.day = days.day
    left join appointment_daily on appointment_daily.day = days.day
  ),
  interest_by_service as (
    select
      service_id,
      count(distinct visit_id) as interest
    from filtered_events
    where service_id is not null
      and event_type in (
        'service_selected',
        'availability_search',
        'availability_found',
        'slot_selected',
        'contact_started',
        'booking_attempt',
        'booking_completed'
      )
    group by service_id
  ),
  bookings_by_service as (
    select
      service_id,
      count(*) as bookings
    from filtered_appointments
    group by service_id
  ),
  service_metrics as (
    select
      coalesce(interest.service_id, booking.service_id) as service_id,
      coalesce(interest.interest, 0) as interest,
      coalesce(booking.bookings, 0) as bookings
    from interest_by_service interest
    full outer join bookings_by_service booking
      on booking.service_id = interest.service_id
  ),
  top_service_rows as (
    select
      service.id as service_id,
      service.name as service_name,
      metric.interest,
      metric.bookings
    from service_metrics metric
    join public.booking_services service
      on service.organization_id = widget_record.organization_id
     and service.id = metric.service_id
    order by metric.interest desc, metric.bookings desc, service.name
    limit 5
  ),
  top_services_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'serviceId', service_id,
          'name', service_name,
          'interest', interest,
          'bookings', bookings
        )
        order by interest desc, bookings desc, service_name
      ),
      '[]'::jsonb
    ) as value
    from top_service_rows
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from,
      'to', p_to,
      'timeZone', widget_record.timezone,
      'trackingStartedAt', widget_record.analytics_started_at
    ),
    'summary', jsonb_build_object(
      'views', event_totals.views,
      'embeddedViews', event_totals.embedded_views,
      'engagedVisits', event_totals.engaged_visits,
      'calculatorStarts', event_totals.calculator_starts,
      'calculatorCompletions', event_totals.calculator_completions,
      'serviceSelections', event_totals.service_selections,
      'availabilitySearches', event_totals.availability_searches,
      'availabilityFound', event_totals.availability_found,
      'slotSelections', event_totals.slot_selections,
      'contactStarts', event_totals.contact_starts,
      'bookingAttempts', event_totals.booking_attempts,
      'bookingCompletions', event_totals.booking_completions,
      'bookings', appointment_totals.bookings,
      'confirmedBookings', appointment_totals.confirmed_bookings,
      'cancelledBookings', appointment_totals.cancelled_bookings,
      'lastBookingAt', last_booking_at
    ),
    'daily', daily_json.value,
    'topServices', top_services_json.value
  )
  into result
  from event_totals
  cross join appointment_totals
  cross join daily_json
  cross join top_services_json;

  return result;
end;
$$;

revoke all on function public.get_booking_widget_analytics(uuid, uuid, date, date)
  from public, anon;
grant execute on function public.get_booking_widget_analytics(uuid, uuid, date, date)
  to authenticated, service_role;
