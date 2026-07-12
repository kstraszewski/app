-- Integrate CRM client/consent capture with calculator-aware public widgets.
-- Public identity data is self-declared: an existing CRM client is reused only
-- when every supplied identifier (e-mail and phone) matches the same record.

create or replace function private.resolve_widget_crm_client(
  target_organization_id uuid,
  target_owner_user_id uuid,
  target_widget_id uuid,
  customer_name text,
  customer_email text,
  customer_phone text,
  consent_decisions jsonb,
  evidence_reference text
)
returns table(client_id uuid, client_person_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  submitted_email text := nullif(btrim(customer_email), '');
  submitted_phone text := nullif(btrim(customer_phone), '');
  normalized_email text := lower(submitted_email);
  normalized_phone text := nullif(regexp_replace(
    coalesce(submitted_phone, ''), '[^0-9]+', '', 'g'
  ), '');
  target_widget_type text;
  identity_key text;
  matched_client_ids uuid[] := '{}'::uuid[];
  possible_duplicate_exists boolean := false;
  resolved_client public.crm_clients;
  resolved_person public.crm_client_people;
  consent_record record;
  supplied_decision jsonb;
  decision_granted boolean;
  decision_contact_value text;
begin
  if normalized_email is null then
    raise exception 'customer_email_is_required' using errcode = '23514';
  end if;

  select widget.widget_type
  into target_widget_type
  from public.booking_widgets widget
  where widget.organization_id = target_organization_id
    and widget.id = target_widget_id;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  if normalized_phone is null then
    raise exception 'customer_phone_is_required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = target_owner_user_id
  ) then
    raise exception 'client_owner_not_organization_member' using errcode = '23503';
  end if;

  perform private.validate_widget_consent_decisions(
    target_organization_id,
    consent_decisions
  );

  -- Serialize requests that carry either identity. The exact-pair match below
  -- deliberately never joins an e-mail from one contact with another person's
  -- phone number.
  for identity_key in
    select identity.value
    from unnest(array[
      'email:' || normalized_email,
      case when normalized_phone is null then null else 'phone:' || normalized_phone end
    ]) identity(value)
    where identity.value is not null
    order by identity.value
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'openexpert-crm-client:' || target_organization_id::text || ':' || identity_key,
      0
    ));
  end loop;

  if normalized_phone is not null then
    select coalesce(
      array_agg(distinct candidate.client_id order by candidate.client_id),
      '{}'::uuid[]
    )
    into matched_client_ids
    from (
      select client.id as client_id
      from public.crm_clients client
      where client.organization_id = target_organization_id
        and client.primary_email_normalized = normalized_email
        and client.primary_phone_normalized = normalized_phone

      union all

      select person.client_id
      from public.crm_client_people person
      where person.organization_id = target_organization_id
        and person.email_normalized = normalized_email
        and person.phone_normalized = normalized_phone
    ) candidate;
  end if;

  if cardinality(matched_client_ids) > 1 then
    raise exception 'customer_contact_matches_multiple_clients'
      using errcode = 'P0001';
  end if;

  if cardinality(matched_client_ids) = 1 then
    select client.*
    into strict resolved_client
    from public.crm_clients client
    where client.organization_id = target_organization_id
      and client.id = matched_client_ids[1]
    for update;
  else
    select exists (
      select 1
      from public.crm_clients client
      where client.organization_id = target_organization_id
        and (
          client.primary_email_normalized = normalized_email
          or (
            normalized_phone is not null
            and client.primary_phone_normalized = normalized_phone
          )
        )
      union all
      select 1
      from public.crm_client_people person
      where person.organization_id = target_organization_id
        and (
          person.email_normalized = normalized_email
          or (
            normalized_phone is not null
            and person.phone_normalized = normalized_phone
          )
        )
    ) into possible_duplicate_exists;

    insert into public.crm_clients (
      organization_id,
      owner_user_id,
      display_name,
      status_code,
      lead_source,
      primary_email,
      primary_phone,
      tags,
      metadata
    ) values (
      target_organization_id,
      target_owner_user_id,
      btrim(customer_name),
      'lead',
      'booking_widget',
      submitted_email,
      submitted_phone,
      case
        when possible_duplicate_exists then array['possible-duplicate']::text[]
        else '{}'::text[]
      end,
      jsonb_build_object(
        'createdFromBookingWidget', true,
        'bookingWidgetId', target_widget_id,
        'identityVerification', 'self_declared',
        'possibleDuplicate', possible_duplicate_exists
      )
    )
    returning * into resolved_client;
  end if;

  select person.*
  into resolved_person
  from public.crm_client_people person
  where person.organization_id = target_organization_id
    and person.client_id = resolved_client.id
    and person.email_normalized = normalized_email
    and person.phone_normalized is not distinct from normalized_phone
  order by (person.role = 'primary') desc, person.created_at, person.id
  limit 1
  for update;

  if resolved_person.id is null then
    insert into public.crm_client_people (
      organization_id,
      client_id,
      role,
      display_name,
      email,
      phone,
      metadata
    ) values (
      target_organization_id,
      resolved_client.id,
      case
        when exists (
          select 1
          from public.crm_client_people person
          where person.organization_id = target_organization_id
            and person.client_id = resolved_client.id
        ) then 'booking_contact'
        else 'primary'
      end,
      btrim(customer_name),
      submitted_email,
      submitted_phone,
      jsonb_build_object(
        'createdFromBookingWidget', true,
        'bookingWidgetId', target_widget_id,
        'identityVerification', 'self_declared'
      )
    )
    returning * into resolved_person;
  end if;

  for consent_record in
    select definition.id as definition_id, consent_version.*
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = target_organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
    order by consent_version.sort_order, consent_version.display_title
  loop
    select decision
    into strict supplied_decision
    from jsonb_array_elements(consent_decisions) decision
    where decision ->> 'definition_id' = consent_record.definition_id::text
      and decision ->> 'version_id' = consent_record.id::text;

    decision_granted := (supplied_decision ->> 'granted')::boolean;
    decision_contact_value := case consent_record.channel
      when 'email' then submitted_email
      when 'sms' then submitted_phone
      when 'phone' then submitted_phone
      when 'messaging' then submitted_phone
      else coalesce(submitted_email, submitted_phone)
    end;

    if decision_granted and decision_contact_value is null then
      raise exception 'consent_contact_value_is_required' using errcode = '23514';
    end if;

    insert into public.crm_client_consent_events (
      organization_id,
      client_id,
      subject_person_id,
      definition_id,
      definition_version_id,
      decision,
      contact_value,
      source,
      recorded_by_user_id,
      evidence_reference,
      metadata
    ) values (
      target_organization_id,
      resolved_client.id,
      resolved_person.id,
      consent_record.definition_id,
      consent_record.id,
      case when decision_granted then 'granted' else 'declined' end,
      case when decision_granted then decision_contact_value else null end,
      'booking_widget',
      null,
      evidence_reference,
      jsonb_build_object(
        'form', 'booking_widget_v1',
        'bookingWidgetId', target_widget_id,
        'identityVerification', 'self_declared',
        'contactValueSource', 'booking_submission'
      )
    );
  end loop;

  return query select resolved_client.id, resolved_person.id;
end;
$$;

revoke all on function private.resolve_widget_crm_client(
  uuid, uuid, uuid, text, text, text, jsonb, text
) from public, anon, authenticated, service_role;

-- Booking retries remain rate-limited even after a widget is disabled. Other
-- public scopes still require an active widget.
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
    and (widget.is_active or p_scope = 'booking');
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

revoke all on function public.consume_booking_rate_limit(
  uuid, text, text, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.consume_booking_rate_limit(
  uuid, text, text, integer, integer
) to service_role;

-- Include stable display labels in both a fresh response and an idempotent
-- replay, so the API does not need the current widget catalogue to rebuild the
-- confirmation after configuration has changed.
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
      'facilityName', facility.name,
      'serviceId', appointment.service_id,
      'serviceName', service.name,
      'clientId', appointment.client_id,
      'clientPersonId', appointment.client_person_id,
      'expert', jsonb_build_object(
        'userId', appointment.expert_user_id,
        'name', coalesce(app_user.full_name, 'Ekspert')
      )
    ),
    'managementToken', appointment.manage_token
  )
  from public.appointments appointment
  join public.facilities facility
    on facility.organization_id = appointment.organization_id
   and facility.id = appointment.facility_id
  join public.booking_services service
    on service.organization_id = appointment.organization_id
   and service.id = appointment.service_id
  join public.users app_user on app_user.id = appointment.expert_user_id
  where appointment.id = target_appointment_id;
$$;

revoke all on function private.widget_booking_result(uuid)
  from public, anon, authenticated, service_role;

-- Check for a committed result before any validation that depends on mutable
-- widget, consent or calculator configuration. The caller supplies a SHA-256
-- of the canonical HTTP intent; only the server-side service role can execute
-- this function.
create function public.replay_widget_booking(
  p_widget_token uuid,
  p_idempotency_key text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_widget_id uuid;
  existing_appointment_id uuid;
  existing_request_fingerprint text;
begin
  if nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_booking_replay_request' using errcode = '22023';
  end if;

  select widget.id
  into target_widget_id
  from public.booking_widgets widget
  where widget.public_token = p_widget_token;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  perform private.assert_widget_origin_allowed(target_widget_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'openexpert-widget-booking:' || target_widget_id::text || ':'
      || btrim(p_idempotency_key),
    0
  ));

  select appointment.id, appointment.request_fingerprint
  into existing_appointment_id, existing_request_fingerprint
  from public.appointments appointment
  where appointment.widget_id = target_widget_id
    and appointment.idempotency_key = btrim(p_idempotency_key);

  if not found then
    return null;
  end if;

  if existing_request_fingerprint = p_request_fingerprint then
    return private.widget_booking_result(existing_appointment_id);
  end if;

  raise exception 'idempotency_key_reused' using errcode = 'P0001';
end;
$$;

revoke all on function public.replay_widget_booking(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.replay_widget_booking(uuid, text, text)
  to service_role;

drop function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb, jsonb
);

create function public.create_widget_booking(
  p_widget_token uuid,
  p_service_id uuid,
  p_starts_at timestamptz,
  p_customer_name text,
  p_customer_email text,
  p_idempotency_key text,
  p_customer_phone text,
  p_expert_user_id uuid,
  p_notes text,
  p_consent_decisions jsonb,
  p_booking_context jsonb,
  p_request_fingerprint text
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
  resolved_client record;
  inserted_appointment public.appointments;
  existing_appointment_id uuid;
  existing_request_fingerprint text;
  effective_expert_user_id uuid;
  normalized_customer_phone text := nullif(regexp_replace(
    coalesce(p_customer_phone, ''), '[^0-9]+', '', 'g'
  ), '');
  normalized_booking_context jsonb := coalesce(p_booking_context, '{}'::jsonb);
  normalized_consent_decisions jsonb := coalesce(p_consent_decisions, '[]'::jsonb);
  booking_request_fingerprint text := lower(p_request_fingerprint);
begin
  if p_starts_at is null
     or nullif(btrim(p_customer_name), '') is null
     or length(btrim(p_customer_name)) > 200
     or nullif(btrim(p_customer_email), '') is null
     or length(btrim(p_customer_email)) > 320
     or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (p_customer_phone is not null and length(btrim(p_customer_phone)) > 50)
     or (
       nullif(btrim(p_customer_phone), '') is not null
       and (
         normalized_customer_phone is null
         or length(normalized_customer_phone) < 7
         or length(normalized_customer_phone) > 15
       )
     )
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or p_request_fingerprint is null
     or p_request_fingerprint !~ '^[0-9a-f]{64}$'
     or (p_notes is not null and length(btrim(p_notes)) > 2000) then
    raise exception 'invalid_booking_request' using errcode = '22023';
  end if;

  if jsonb_typeof(normalized_booking_context) <> 'object'
     or octet_length(normalized_booking_context::text) > 16384 then
    raise exception 'invalid_booking_context' using errcode = '22023';
  end if;

  if jsonb_typeof(normalized_consent_decisions) <> 'array' then
    raise exception 'consent_decisions_must_be_an_array' using errcode = '23514';
  end if;

  select widget.id,
         widget.organization_id,
         widget.facility_id,
         widget.booking_mode,
         widget.widget_type,
         widget.fixed_expert_user_id,
         facility.timezone
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

  perform pg_advisory_xact_lock(hashtextextended(
    'openexpert-widget-booking:' || widget_record.id::text || ':'
      || btrim(p_idempotency_key),
    0
  ));

  select appointment.id, appointment.request_fingerprint
  into existing_appointment_id, existing_request_fingerprint
  from public.appointments appointment
  where appointment.widget_id = widget_record.id
    and appointment.idempotency_key = btrim(p_idempotency_key);

  if found then
    if existing_request_fingerprint = booking_request_fingerprint then
      return private.widget_booking_result(existing_appointment_id);
    end if;
    raise exception 'idempotency_key_reused' using errcode = 'P0001';
  end if;

  if normalized_customer_phone is null then
    raise exception 'customer_phone_is_required' using errcode = '23514';
  end if;

  if normalized_booking_context ->> 'widgetType' is distinct from widget_record.widget_type
     or normalized_booking_context ->> 'version' is distinct from '1' then
    raise exception 'invalid_booking_context' using errcode = '22023';
  end if;

  if widget_record.fixed_expert_user_id is not null then
    if p_expert_user_id is not null
       and p_expert_user_id <> widget_record.fixed_expert_user_id then
      raise exception 'booking_widget_is_fixed_to_another_expert'
        using errcode = '22023';
    end if;
    effective_expert_user_id := widget_record.fixed_expert_user_id;
  else
    effective_expert_user_id := p_expert_user_id;
    if widget_record.booking_mode = 'expert' and p_expert_user_id is null then
      raise exception 'booking_widget_requires_expert' using errcode = '22023';
    elsif widget_record.booking_mode = 'facility' and p_expert_user_id is not null then
      raise exception 'booking_widget_does_not_allow_expert_selection'
        using errcode = '22023';
    end if;
  end if;

  perform private.validate_widget_consent_decisions(
    widget_record.organization_id,
    normalized_consent_decisions
  );

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
      and (
        effective_expert_user_id is null
        or service_expert.user_id = effective_expert_user_id
      )
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
        select resolved.client_id, resolved.client_person_id
        into strict resolved_client
        from private.resolve_widget_crm_client(
          widget_record.organization_id,
          candidate.user_id,
          widget_record.id,
          btrim(p_customer_name),
          btrim(p_customer_email),
          nullif(btrim(p_customer_phone), ''),
          normalized_consent_decisions,
          'widget:' || widget_record.id::text || ':booking:'
            || btrim(p_idempotency_key)
        ) resolved;

        insert into public.appointments (
          organization_id,
          facility_id,
          service_id,
          expert_user_id,
          widget_id,
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
          booking_context,
          request_fingerprint
        ) values (
          widget_record.organization_id,
          widget_record.facility_id,
          p_service_id,
          candidate.user_id,
          widget_record.id,
          resolved_client.client_id,
          resolved_client.client_person_id,
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
          btrim(p_idempotency_key),
          normalized_booking_context,
          booking_request_fingerprint
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
          continue;
      end;
    end if;
  end loop;

  raise exception 'booking_slot_conflict'
    using errcode = '23P01',
          constraint = 'appointment_expert_reservations_no_overlap';
end;
$$;

revoke all on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb, jsonb, text
) to service_role;
