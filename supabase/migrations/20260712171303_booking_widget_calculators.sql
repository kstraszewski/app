-- Public booking widgets can start with a mortgage calculator or open the
-- calendar immediately. A widget may also be owned by one bookable expert;
-- that binding is enforced by tenant-safe foreign keys and booking RPCs.

alter table public.booking_widgets
  add column widget_type text not null default 'calendar',
  add column fixed_expert_user_id uuid,
  add column created_by_user_id uuid default auth.uid(),
  add constraint booking_widgets_widget_type_check check (
    widget_type in ('calendar', 'mortgage_capacity', 'mortgage_payment')
  ),
  add constraint booking_widgets_fixed_expert_mode_check check (
    fixed_expert_user_id is null or booking_mode = 'expert'
  ),
  add constraint booking_widgets_fixed_expert_creator_check check (
    fixed_expert_user_id is null or created_by_user_id is not null
  ),
  add constraint booking_widgets_fixed_expert_fkey
    foreign key (organization_id, facility_id, fixed_expert_user_id)
    references public.facility_memberships(organization_id, facility_id, user_id),
  add constraint booking_widgets_created_by_fkey
    foreign key (organization_id, created_by_user_id)
    references public.organization_memberships(organization_id, user_id);

create index booking_widgets_fixed_expert_idx
  on public.booking_widgets(organization_id, facility_id, fixed_expert_user_id)
  where fixed_expert_user_id is not null;

create index booking_widgets_created_by_idx
  on public.booking_widgets(organization_id, created_by_user_id)
  where created_by_user_id is not null;

alter table public.appointments
  add column booking_context jsonb not null default '{}'::jsonb,
  add column request_fingerprint text,
  add constraint appointments_booking_context_check check (
    jsonb_typeof(booking_context) = 'object'
    and octet_length(booking_context::text) <= 16384
  ),
  add constraint appointments_request_fingerprint_check check (
    request_fingerprint is null
    or request_fingerprint ~ '^[0-9a-f]{64}$'
  );

comment on column public.booking_widgets.widget_type is
  'calendar opens booking directly; mortgage widgets show a calculator before booking.';
comment on column public.booking_widgets.fixed_expert_user_id is
  'Optional facility member that every slot and booking for this widget must use.';
comment on column public.appointments.booking_context is
  'Validated, data-minimized calculator result submitted before booking; limited to 16 KiB.';
comment on column public.appointments.request_fingerprint is
  'Sha-256 fingerprint of the complete public booking request for idempotency.';

create or replace function private.can_manage_booking_widget(
  target_organization_id uuid,
  target_facility_id uuid,
  target_fixed_expert_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
      and (
        private.is_organization_admin(target_organization_id)
        or private.is_facility_admin(target_organization_id, target_facility_id)
        or (
          target_fixed_expert_user_id = (select auth.uid())
          and exists (
            select 1
            from public.facility_memberships membership
            where membership.organization_id = target_organization_id
              and membership.facility_id = target_facility_id
              and membership.user_id = (select auth.uid())
              and membership.is_bookable
          )
        )
      ),
    false
  );
$$;

revoke all on function private.can_manage_booking_widget(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_manage_booking_widget(uuid, uuid, uuid)
  to authenticated;

create or replace function private.can_write_booking_widget(
  target_organization_id uuid,
  target_facility_id uuid,
  target_fixed_expert_user_id uuid,
  target_created_by_user_id uuid,
  target_booking_mode text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
      and (
        private.is_organization_admin(target_organization_id)
        or private.is_facility_admin(target_organization_id, target_facility_id)
        or (
          target_fixed_expert_user_id = (select auth.uid())
          and target_created_by_user_id = (select auth.uid())
          and target_booking_mode = 'expert'
          and exists (
            select 1
            from public.facility_memberships membership
            where membership.organization_id = target_organization_id
              and membership.facility_id = target_facility_id
              and membership.user_id = (select auth.uid())
              and membership.is_bookable
          )
        )
      ),
    false
  );
$$;

revoke all on function private.can_write_booking_widget(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.can_write_booking_widget(uuid, uuid, uuid, uuid, text)
  to authenticated;

drop policy "facility admins can manage booking widgets"
  on public.booking_widgets;

create policy "admins or fixed experts can manage booking widgets"
  on public.booking_widgets for all to authenticated
  using (
    (select private.can_manage_booking_widget(
      organization_id,
      facility_id,
      fixed_expert_user_id
    ))
  )
  with check (
    (select private.can_write_booking_widget(
      organization_id,
      facility_id,
      fixed_expert_user_id,
      created_by_user_id,
      booking_mode
    ))
  );

drop policy "facility admins can manage booking widget services"
  on public.booking_widget_services;

create policy "admins or fixed experts can manage booking widget services"
  on public.booking_widget_services for all to authenticated
  using (
    exists (
      select 1
      from public.booking_widgets widget
      where widget.organization_id = booking_widget_services.organization_id
        and widget.facility_id = booking_widget_services.facility_id
        and widget.id = booking_widget_services.widget_id
        and (select private.can_manage_booking_widget(
          widget.organization_id,
          widget.facility_id,
          widget.fixed_expert_user_id
        ))
    )
  )
  with check (
    exists (
      select 1
      from public.booking_widgets widget
      where widget.organization_id = booking_widget_services.organization_id
        and widget.facility_id = booking_widget_services.facility_id
        and widget.id = booking_widget_services.widget_id
        and (select private.can_manage_booking_widget(
          widget.organization_id,
          widget.facility_id,
          widget.fixed_expert_user_id
        ))
        and (
          widget.fixed_expert_user_id is null
          or exists (
            select 1
            from public.facility_service_experts service_expert
            where service_expert.organization_id = booking_widget_services.organization_id
              and service_expert.facility_id = booking_widget_services.facility_id
              and service_expert.service_id = booking_widget_services.service_id
              and service_expert.user_id = widget.fixed_expert_user_id
              and service_expert.is_active
          )
        )
    )
  );

-- Resolve the booking contact without overwriting an existing client's owner
-- or replacing a different verified contact. Consent evidence always records
-- the exact trimmed e-mail/phone submitted with this booking.
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
  identity_key text;
  matched_client_ids uuid[];
  resolved_client public.crm_clients;
  resolved_person public.crm_client_people;
  consent_record record;
  supplied_decision jsonb;
  decision_granted boolean;
  decision_contact_value text;
begin
  if submitted_email is null then
    raise exception 'customer_email_is_required' using errcode = '23514';
  end if;

  if submitted_phone is null
     or normalized_phone is null
     or length(normalized_phone) not between 7 and 15 then
    raise exception 'customer_phone_is_invalid' using errcode = '23514';
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

  -- Lock both identities in lexical order. The same order is used by every
  -- booking request, preventing e-mail/phone lock inversions.
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

  select array_agg(distinct candidate.client_id order by candidate.client_id)
  into matched_client_ids
  from (
    select client.id as client_id
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

    select person.client_id
    from public.crm_client_people person
    where person.organization_id = target_organization_id
      and (
        person.email_normalized = normalized_email
        or (normalized_phone is not null and person.phone_normalized = normalized_phone)
      )
  ) candidate;

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

    -- Only fill missing primary contacts. A submitted secondary contact must
    -- not replace a different contact already stored on the client.
    update public.crm_clients client
    set primary_email = case
          when client.primary_email_normalized is null then submitted_email
          else client.primary_email
        end,
        primary_phone = case
          when client.primary_phone_normalized is null then submitted_phone
          else client.primary_phone
        end
    where client.organization_id = target_organization_id
      and client.id = resolved_client.id
    returning client.* into resolved_client;
  else
    insert into public.crm_clients (
      organization_id,
      owner_user_id,
      display_name,
      status_code,
      lead_source,
      primary_email,
      primary_phone,
      metadata
    ) values (
      target_organization_id,
      target_owner_user_id,
      btrim(customer_name),
      'lead',
      'booking_widget',
      submitted_email,
      submitted_phone,
      jsonb_build_object(
        'createdFromBookingWidget', true,
        'bookingWidgetId', target_widget_id
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
        'bookingWidgetId', target_widget_id
      )
    )
    returning * into resolved_person;
  else
    -- These writes preserve the normalized identities selected above while
    -- retaining the exact formatting most recently submitted by the subject.
    update public.crm_client_people person
    set email = submitted_email,
        phone = submitted_phone
    where person.organization_id = target_organization_id
      and person.client_id = resolved_client.id
      and person.id = resolved_person.id
    returning person.* into resolved_person;
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
        'bookingWidgetId', target_widget_id
      )
    );
  end loop;

  return query select resolved_client.id, resolved_person.id;
end;
$$;

revoke all on function private.resolve_widget_crm_client(
  uuid, uuid, uuid, text, text, text, jsonb, text
) from public, anon, authenticated, service_role;

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
  select widget.*,
         facility.name as facility_name,
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
      'bookingMode', widget_record.booking_mode,
      'widgetType', widget_record.widget_type,
      'fixedExpertUserId', widget_record.fixed_expert_user_id
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
               jsonb_agg(
                 service_expert.service_id order by service_expert.service_id
               ) as service_ids
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
          and (
            widget_record.fixed_expert_user_id is null
            or service_expert.user_id = widget_record.fixed_expert_user_id
          )
        group by service_expert.user_id, app_user.full_name
      ) expert
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'definitionId', definition.id,
          'versionId', consent_version.id,
          'code', definition.code,
          'displayTitle', consent_version.display_title,
          'content', consent_version.content,
          'purpose', consent_version.purpose,
          'channel', consent_version.channel,
          'legalBasis', consent_version.legal_basis,
          'isRequired', consent_version.is_required,
          'languageCode', consent_version.language_code,
          'contentSha256', consent_version.content_sha256
        ) order by consent_version.sort_order, consent_version.display_title, definition.id
      )
      from public.crm_consent_definitions definition
      join public.crm_consent_definition_versions consent_version
        on consent_version.organization_id = definition.organization_id
       and consent_version.definition_id = definition.id
       and consent_version.id = definition.current_version_id
      where definition.organization_id = widget_record.organization_id
        and definition.context = 'client_creation'
        and consent_version.status = 'published'
        and consent_version.effective_from <= now()
        and (consent_version.effective_to is null or consent_version.effective_to > now())
    ), '[]'::jsonb),
    'capacityPolicy', case
      when widget_record.widget_type = 'mortgage_capacity' then (
        select jsonb_build_object(
          'policyAsOf', settings.policy_as_of,
          'minimumSocialAsOf', settings.minimum_social_as_of,
          'nbpReferenceRateAsOf', settings.nbp_reference_rate_as_of,
          'dstiLimitPct', settings.dsti_limit_pct,
          'incomeBufferPct', settings.income_buffer_pct,
          'creditLimitMonthlyChargePct', settings.credit_limit_monthly_charge_pct,
          'maxLtvPct', settings.max_ltv_pct,
          'defaultInterestRatePct', settings.default_interest_rate_pct,
          'defaultInterestType', settings.default_interest_type,
          'defaultFixedRatePeriodMonths', settings.default_fixed_rate_period_months,
          'nbpReferenceRatePct', settings.nbp_reference_rate_pct,
          'variableRateVolatilityBufferPct', settings.variable_rate_volatility_buffer_pct,
          'minimumSocialMonthly', jsonb_build_array(
            settings.minimum_social_1_person,
            settings.minimum_social_2_people,
            settings.minimum_social_3_people,
            settings.minimum_social_4_people,
            settings.minimum_social_5_people
          ),
          'minimumSocialAdditionalPerson', settings.minimum_social_additional_person
        )
        from public.mortgage_capacity_settings settings
        where settings.organization_id = widget_record.organization_id
      )
      else null
    end,
    'capacityPolicyRevision', case
      when widget_record.widget_type = 'mortgage_capacity' then coalesce((
        select settings.revision
        from public.mortgage_capacity_settings settings
        where settings.organization_id = widget_record.organization_id
      ), 0)
      else null
    end,
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
  effective_expert_user_id uuid;
begin
  if p_starts_on is null or p_ends_on is null
     or p_ends_on < p_starts_on
     or p_ends_on - p_starts_on > 31 then
    raise exception 'booking_slot_range_must_be_between_1_and_32_days'
      using errcode = '22023';
  end if;

  select widget.id,
         widget.organization_id,
         widget.facility_id,
         widget.booking_mode,
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
      and (
        effective_expert_user_id is null
        or service_expert.user_id = effective_expert_user_id
      )
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
declare
  widget_record public.booking_widgets;
  normalized_patch jsonb := coalesce(p_widget_patch, '{}'::jsonb);
begin
  select widget.*
  into widget_record
  from public.booking_widgets widget
  where widget.organization_id = p_organization_id
    and widget.facility_id = p_facility_id
    and widget.id = p_widget_id
  for update;

  if not found then
    raise exception 'booking_widget_not_found' using errcode = 'P0002';
  end if;

  if not private.can_manage_booking_widget(
    widget_record.organization_id,
    widget_record.facility_id,
    widget_record.fixed_expert_user_id
  ) then
    raise exception 'booking_widget_manager_required' using errcode = '42501';
  end if;

  if jsonb_typeof(normalized_patch) <> 'object' then
    raise exception 'widget_patch_must_be_an_object' using errcode = '22023';
  end if;

  if normalized_patch ? 'fixed_expert_user_id'
     or normalized_patch ? 'created_by_user_id' then
    raise exception 'widget_owner_fields_cannot_be_patched' using errcode = '22023';
  end if;

  if widget_record.fixed_expert_user_id is not null
     and normalized_patch ? 'booking_mode'
     and normalized_patch ->> 'booking_mode' <> 'expert' then
    raise exception 'fixed_expert_widget_requires_expert_mode' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(normalized_patch) patch_key
    where patch_key not in (
      'name',
      'slug',
      'title',
      'subtitle',
      'theme',
      'accent_color',
      'allowed_origins',
      'booking_mode',
      'widget_type',
      'locale',
      'is_active'
    )
  ) then
    raise exception 'unsupported_booking_widget_patch_field' using errcode = '22023';
  end if;

  if normalized_patch ? 'allowed_origins'
     and jsonb_typeof(normalized_patch -> 'allowed_origins') <> 'array' then
    raise exception 'allowed_origins_must_be_an_array' using errcode = '22023';
  end if;

  if normalized_patch <> '{}'::jsonb then
    update public.booking_widgets widget
    set name = case
          when normalized_patch ? 'name' then normalized_patch ->> 'name'
          else widget.name
        end,
        slug = case
          when normalized_patch ? 'slug' then normalized_patch ->> 'slug'
          else widget.slug
        end,
        title = case
          when normalized_patch ? 'title' then normalized_patch ->> 'title'
          else widget.title
        end,
        subtitle = case
          when normalized_patch ? 'subtitle' then normalized_patch ->> 'subtitle'
          else widget.subtitle
        end,
        theme = case
          when normalized_patch ? 'theme' then normalized_patch ->> 'theme'
          else widget.theme
        end,
        accent_color = case
          when normalized_patch ? 'accent_color' then normalized_patch ->> 'accent_color'
          else widget.accent_color
        end,
        allowed_origins = case
          when normalized_patch ? 'allowed_origins' then array(
            select jsonb_array_elements_text(normalized_patch -> 'allowed_origins')
          )
          else widget.allowed_origins
        end,
        booking_mode = case
          when normalized_patch ? 'booking_mode' then normalized_patch ->> 'booking_mode'
          else widget.booking_mode
        end,
        widget_type = case
          when normalized_patch ? 'widget_type' then normalized_patch ->> 'widget_type'
          else widget.widget_type
        end,
        locale = case
          when normalized_patch ? 'locale' then normalized_patch ->> 'locale'
          else widget.locale
        end,
        is_active = case
          when normalized_patch ? 'is_active'
            then (normalized_patch ->> 'is_active')::boolean
          else widget.is_active
        end
    where widget.organization_id = p_organization_id
      and widget.facility_id = p_facility_id
      and widget.id = p_widget_id;
  end if;

  if coalesce(p_update_services, false) then
    if exists (
      select 1
      from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id
      where not exists (
        select 1
        from public.facility_services facility_service
        where facility_service.organization_id = p_organization_id
          and facility_service.facility_id = p_facility_id
          and facility_service.service_id = selected_service_id
          and facility_service.is_active
      )
    ) then
      raise exception 'service_not_active_at_facility' using errcode = '23503';
    end if;

    if widget_record.fixed_expert_user_id is not null
       and exists (
         select 1
         from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id
         where not exists (
           select 1
           from public.facility_service_experts service_expert
           where service_expert.organization_id = p_organization_id
             and service_expert.facility_id = p_facility_id
             and service_expert.service_id = selected_service_id
             and service_expert.user_id = widget_record.fixed_expert_user_id
             and service_expert.is_active
         )
       ) then
      raise exception 'service_not_assigned_to_fixed_expert' using errcode = '23503';
    end if;

    delete from public.booking_widget_services allowed_service
    where allowed_service.organization_id = p_organization_id
      and allowed_service.facility_id = p_facility_id
      and allowed_service.widget_id = p_widget_id;

    insert into public.booking_widget_services (
      organization_id,
      facility_id,
      widget_id,
      service_id
    )
    select p_organization_id,
           p_facility_id,
           p_widget_id,
           selected_service_id
    from (
      select distinct selected_service_id
      from unnest(coalesce(p_service_ids, '{}'::uuid[])) selected_service_id
    ) selected_services;
  end if;
end;
$$;

drop function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb
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
  p_booking_context jsonb
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
  normalized_booking_context jsonb := coalesce(p_booking_context, '{}'::jsonb);
  normalized_consent_decisions jsonb := coalesce(p_consent_decisions, '[]'::jsonb);
  canonical_consent_decisions jsonb;
  booking_request_fingerprint text;
begin
  if p_starts_at is null
     or nullif(btrim(p_customer_name), '') is null
     or length(btrim(p_customer_name)) > 200
     or nullif(btrim(p_customer_email), '') is null
     or length(btrim(p_customer_email)) > 320
     or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or nullif(btrim(p_customer_phone), '') is null
     or length(btrim(p_customer_phone)) > 50
     or length(regexp_replace(p_customer_phone, '[^0-9]+', '', 'g')) not between 7 and 15
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
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

  select coalesce(
    jsonb_agg(
      decision order by decision ->> 'definition_id', decision ->> 'version_id'
    ),
    '[]'::jsonb
  )
  into canonical_consent_decisions
  from jsonb_array_elements(normalized_consent_decisions) decision;

  booking_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'fingerprintVersion', 1,
          'widgetToken', p_widget_token,
          'serviceId', p_service_id,
          'startsAt', p_starts_at,
          'customerName', btrim(p_customer_name),
          'customerEmail', lower(btrim(p_customer_email)),
          'customerPhone', nullif(btrim(p_customer_phone), ''),
          'requestedExpertUserId', p_expert_user_id,
          'notes', nullif(btrim(p_notes), ''),
          'bookingContext', normalized_booking_context,
          'consentDecisions', canonical_consent_decisions
        )::text,
        'utf8'
      ),
      'sha256'
    ),
    'hex'
  );

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
          btrim(p_customer_phone),
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
          btrim(p_customer_phone),
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

-- Public booking traffic is mediated by the server, which applies origin and
-- rate-limit checks. Never expose these security-definer RPCs to browser roles.
revoke all on function public.get_booking_widget_catalog(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_booking_widget_slots(uuid, uuid, date, date, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.consume_booking_rate_limit(
  uuid, text, text, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.update_booking_widget_configuration(
  uuid, uuid, uuid, jsonb, boolean, uuid[]
) from public, anon, authenticated, service_role;

grant execute on function public.get_booking_widget_catalog(uuid)
  to service_role;
grant execute on function public.get_booking_widget_slots(uuid, uuid, date, date, uuid)
  to service_role;
grant execute on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb, jsonb
) to service_role;
grant execute on function public.consume_booking_rate_limit(
  uuid, text, text, integer, integer
) to service_role;
grant execute on function public.update_booking_widget_configuration(
  uuid, uuid, uuid, jsonb, boolean, uuid[]
) to authenticated, service_role;
