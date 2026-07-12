-- CRM clients are first-class scheduling subjects. This migration adds:
-- * tenant-safe appointment -> client/person links with a legacy backfill,
-- * normalized contact/search projections and indexes for advanced filtering,
-- * public-widget consent capture without attributing it to a staff member,
-- * atomic staff and widget scheduling contracts.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;

create or replace function private.crm_search_normalize(input text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    coalesce(input, '')
  ));
$$;

alter table public.crm_clients
  add column primary_email_normalized text generated always as (
    lower(nullif(btrim(primary_email), ''))
  ) stored,
  add column primary_phone_normalized text generated always as (
    nullif(regexp_replace(coalesce(primary_phone, ''), '[^0-9]+', '', 'g'), '')
  ) stored,
  add column search_text text not null default '',
  add column search_vector tsvector not null default ''::tsvector;

alter table public.crm_client_people
  add column email_normalized text generated always as (
    lower(nullif(btrim(email), ''))
  ) stored,
  add column phone_normalized text generated always as (
    nullif(regexp_replace(coalesce(phone, ''), '[^0-9]+', '', 'g'), '')
  ) stored;

alter table public.crm_client_people
  add constraint crm_client_people_organization_client_id_key
  unique (organization_id, client_id, id);

create or replace function private.crm_client_search_projection(
  target_organization_id uuid,
  target_client_id uuid
)
returns table(search_text text, search_vector tsvector)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.crm_search_normalize(concat_ws(
      ' ',
      client.display_name,
      client.primary_email,
      client.primary_phone,
      client.lead_source,
      client.notes,
      array_to_string(client.tags, ' '),
      people.people_text
    )),
    setweight(to_tsvector('simple', private.crm_search_normalize(client.display_name)), 'A')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ', client.primary_email, client.primary_phone, array_to_string(client.tags, ' ')
      ))), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(people.people_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ', client.lead_source, client.notes
      ))), 'C')
  from public.crm_clients client
  left join lateral (
    select string_agg(concat_ws(
      ' ', person.display_name, person.first_name, person.last_name,
      person.email, person.phone, person.pesel
    ), ' ' order by person.created_at, person.id) as people_text
    from public.crm_client_people person
    where person.organization_id = client.organization_id
      and person.client_id = client.id
  ) people on true
  where client.organization_id = target_organization_id
    and client.id = target_client_id;
$$;

create or replace function private.refresh_crm_client_search_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.crm_clients client
    set (search_text, search_vector) = (
      select projection.search_text, projection.search_vector
      from private.crm_client_search_projection(
        old.organization_id,
        old.client_id
      ) projection
    )
    where client.organization_id = old.organization_id
      and client.id = old.client_id;
  end if;

  if tg_op = 'INSERT'
     or (tg_op = 'UPDATE' and new.client_id is distinct from old.client_id) then
    update public.crm_clients client
    set (search_text, search_vector) = (
      select projection.search_text, projection.search_vector
      from private.crm_client_search_projection(
        new.organization_id,
        new.client_id
      ) projection
    )
    where client.organization_id = new.organization_id
      and client.id = new.client_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.set_crm_client_search_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  people_text text;
begin
  select string_agg(concat_ws(
    ' ', person.display_name, person.first_name, person.last_name,
    person.email, person.phone, person.pesel
  ), ' ' order by person.created_at, person.id)
  into people_text
  from public.crm_client_people person
  where person.organization_id = new.organization_id
    and person.client_id = new.id;

  new.search_text := private.crm_search_normalize(concat_ws(
    ' ', new.display_name, new.primary_email, new.primary_phone, new.lead_source, new.notes,
    array_to_string(new.tags, ' '), people_text
  ));
  new.search_vector :=
    setweight(to_tsvector('simple', private.crm_search_normalize(new.display_name)), 'A')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ', new.primary_email, new.primary_phone, array_to_string(new.tags, ' ')
    ))), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(people_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ', new.lead_source, new.notes
    ))), 'C');

  return new;
end;
$$;

create trigger crm_clients_set_search_projection
  before insert or update of display_name, primary_email, primary_phone, lead_source, notes, tags
  on public.crm_clients
  for each row execute function private.set_crm_client_search_projection();

create trigger crm_client_people_refresh_client_search_projection
  after insert or update of client_id, first_name, last_name, display_name, email, phone, pesel
    or delete
  on public.crm_client_people
  for each row execute function private.refresh_crm_client_search_projection();

update public.crm_clients client
set (search_text, search_vector) = (
  select projection.search_text, projection.search_vector
  from private.crm_client_search_projection(
    client.organization_id,
    client.id
  ) projection
);

revoke all on function private.crm_search_normalize(text)
  from public, anon, authenticated, service_role;
revoke all on function private.crm_client_search_projection(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_crm_client_search_projection()
  from public, anon, authenticated, service_role;
revoke all on function private.set_crm_client_search_projection()
  from public, anon, authenticated, service_role;

create index crm_clients_search_vector_idx
  on public.crm_clients using gin (search_vector);
create index crm_clients_search_text_trgm_idx
  on public.crm_clients using gin (search_text extensions.gin_trgm_ops);
create index crm_clients_organization_email_idx
  on public.crm_clients(organization_id, primary_email_normalized)
  where primary_email_normalized is not null;
create index crm_clients_organization_phone_idx
  on public.crm_clients(organization_id, primary_phone_normalized)
  where primary_phone_normalized is not null;
create index crm_client_people_organization_email_idx
  on public.crm_client_people(organization_id, email_normalized, client_id)
  where email_normalized is not null;
create index crm_client_people_organization_phone_idx
  on public.crm_client_people(organization_id, phone_normalized, client_id)
  where phone_normalized is not null;
create index crm_clients_organization_status_updated_idx
  on public.crm_clients(organization_id, status_code, updated_at desc, id);
create index crm_clients_organization_owner_updated_idx
  on public.crm_clients(organization_id, owner_user_id, updated_at desc, id);
create index crm_clients_organization_source_updated_idx
  on public.crm_clients(organization_id, lead_source, updated_at desc, id)
  where lead_source is not null;
create index crm_clients_organization_created_idx
  on public.crm_clients(organization_id, created_at desc, id);
create index crm_clients_tags_idx
  on public.crm_clients using gin (tags);
create index crm_clients_metadata_idx
  on public.crm_clients using gin (metadata jsonb_path_ops);
create index crm_client_consent_events_client_definition_latest_idx
  on public.crm_client_consent_events(
    organization_id, client_id, definition_id, occurred_at desc, id desc
  );

-- Consent decisions submitted by a public widget are recorded as system
-- evidence. They deliberately have no recorded_by_user_id: assigning the
-- decision to the selected expert would corrupt the audit trail.
alter table public.crm_client_consent_events
  alter column recorded_by_user_id drop not null,
  drop constraint crm_client_consent_events_source_check,
  add constraint crm_client_consent_events_source_check check (
    source in ('client_creation', 'client_card', 'import', 'api', 'booking_widget')
  ),
  add constraint crm_client_consent_events_actor_shape check (
    (source = 'booking_widget' and recorded_by_user_id is null)
    or (source <> 'booking_widget' and recorded_by_user_id is not null)
  );

create or replace function private.enforce_crm_client_creation_consents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = new.organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from public.crm_client_consent_events consent_event
        where consent_event.organization_id = new.organization_id
          and consent_event.client_id = new.id
          and consent_event.definition_id = definition.id
          and consent_event.definition_version_id = consent_version.id
          and consent_event.source in ('client_creation', 'booking_widget')
      )
  ) then
    raise exception 'client_consent_decisions_required' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = new.organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.is_required
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from public.crm_client_consent_events consent_event
        where consent_event.organization_id = new.organization_id
          and consent_event.client_id = new.id
          and consent_event.definition_id = definition.id
          and consent_event.definition_version_id = consent_version.id
          and consent_event.decision = 'granted'
          and consent_event.source in ('client_creation', 'booking_widget')
      )
  ) then
    raise exception 'required_consent_not_granted' using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_crm_client_creation_consents()
  from public, anon, authenticated, service_role;

alter table public.appointments
  add column client_id uuid,
  add column client_person_id uuid;

-- Preserve historic appointments without inventing consent decisions. Legacy
-- rows predate consent capture, so backfilled CRM clients are marked in metadata
-- and the deferred new-client consent trigger is disabled only for this block.
alter table public.crm_clients
  disable trigger crm_clients_enforce_creation_consents;

do $$
declare
  appointment_record record;
  matched_client_id uuid;
  matched_client_ids uuid[];
  matched_person_id uuid;
  effective_owner_user_id uuid;
  normalized_email text;
  normalized_phone text;
  identity_conflict boolean;
begin
  for appointment_record in
    select appointment.*
    from public.appointments appointment
    where appointment.client_id is null
    order by appointment.organization_id, appointment.created_at, appointment.id
  loop
    normalized_email := lower(nullif(btrim(appointment_record.customer_email), ''));
    normalized_phone := nullif(regexp_replace(
      coalesce(appointment_record.customer_phone, ''), '[^0-9]+', '', 'g'
    ), '');

    select array_agg(distinct candidate.client_id order by candidate.client_id)
    into matched_client_ids
    from (
      select client.id as client_id
      from public.crm_clients client
      where client.organization_id = appointment_record.organization_id
        and (
          (normalized_email is not null and client.primary_email_normalized = normalized_email)
          or (normalized_phone is not null and client.primary_phone_normalized = normalized_phone)
        )

      union all

      select person.client_id
      from public.crm_client_people person
      where person.organization_id = appointment_record.organization_id
        and (
          (normalized_email is not null and person.email_normalized = normalized_email)
          or (normalized_phone is not null and person.phone_normalized = normalized_phone)
        )
    ) candidate;

    identity_conflict := cardinality(matched_client_ids) > 1;
    matched_client_id := case
      when cardinality(matched_client_ids) = 1 then matched_client_ids[1]
      else null
    end;

    if matched_client_id is null then
      select membership.user_id
      into effective_owner_user_id
      from public.organization_memberships membership
      where membership.organization_id = appointment_record.organization_id
        and membership.user_id = appointment_record.expert_user_id
      limit 1;

      if effective_owner_user_id is null then
        select membership.user_id
        into effective_owner_user_id
        from public.organization_memberships membership
        where membership.organization_id = appointment_record.organization_id
        order by (membership.role = 'admin') desc, membership.created_at, membership.user_id
        limit 1;
      end if;

      if effective_owner_user_id is null then
        raise exception 'appointment_backfill_organization_has_no_member'
          using errcode = '23503';
      end if;

      insert into public.crm_clients (
        organization_id, owner_user_id, display_name, status_code, lead_source,
        primary_email, primary_phone, metadata
      ) values (
        appointment_record.organization_id,
        effective_owner_user_id,
        appointment_record.customer_name,
        'lead',
        'appointment_backfill',
        normalized_email,
        nullif(btrim(appointment_record.customer_phone), ''),
        jsonb_build_object(
          'legacyAppointmentBackfill', true,
          'legacyIdentityConflict', identity_conflict,
          'firstAppointmentId', appointment_record.id
        )
      )
      returning id into matched_client_id;
    end if;

    select person.id
    into matched_person_id
    from public.crm_client_people person
    where person.organization_id = appointment_record.organization_id
      and person.client_id = matched_client_id
      and (
        (normalized_email is not null and person.email_normalized = normalized_email)
        or (normalized_phone is not null and person.phone_normalized = normalized_phone)
      )
    order by (person.role = 'primary') desc, person.created_at, person.id
    limit 1;

    if matched_person_id is null then
      insert into public.crm_client_people (
        organization_id, client_id, role, display_name, email, phone, metadata
      ) values (
        appointment_record.organization_id,
        matched_client_id,
        case
          when exists (
            select 1 from public.crm_client_people person
            where person.organization_id = appointment_record.organization_id
              and person.client_id = matched_client_id
          ) then 'appointment_contact'
          else 'primary'
        end,
        appointment_record.customer_name,
        normalized_email,
        nullif(btrim(appointment_record.customer_phone), ''),
        jsonb_build_object('legacyAppointmentBackfill', true)
      )
      returning id into matched_person_id;
    end if;

    update public.appointments appointment
    set client_id = matched_client_id,
        client_person_id = matched_person_id
    where appointment.id = appointment_record.id;

    matched_client_id := null;
    matched_person_id := null;
    effective_owner_user_id := null;
    matched_client_ids := null;
    identity_conflict := false;
  end loop;
end;
$$;

alter table public.crm_clients
  enable trigger crm_clients_enforce_creation_consents;

alter table public.appointments
  alter column client_id set not null,
  alter column customer_email drop not null,
  add constraint appointments_client_fkey
    foreign key (organization_id, client_id)
    references public.crm_clients(organization_id, id),
  add constraint appointments_client_person_fkey
    foreign key (organization_id, client_id, client_person_id)
    references public.crm_client_people(organization_id, client_id, id);

create index appointments_client_start_idx
  on public.appointments(organization_id, client_id, starts_at desc);
create index appointments_client_person_start_idx
  on public.appointments(organization_id, client_person_id, starts_at desc)
  where client_person_id is not null;
create unique index appointments_staff_idempotency_key
  on public.appointments(organization_id, created_by_user_id, idempotency_key)
  where source = 'staff' and idempotency_key is not null;

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
    starts_at, ends_at, expert_user_id, status, client_id, client_person_id
  on public.appointments
  for each row execute function private.enqueue_appointment_outbox();

revoke all on function private.enqueue_appointment_outbox()
  from public, anon, authenticated, service_role;

create or replace function private.validate_widget_consent_decisions(
  target_organization_id uuid,
  consent_decisions jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_consent_count integer;
begin
  if jsonb_typeof(coalesce(consent_decisions, '[]'::jsonb)) <> 'array' then
    raise exception 'consent_decisions_must_be_an_array' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
    where jsonb_typeof(decision) <> 'object'
      or jsonb_typeof(decision -> 'granted') is distinct from 'boolean'
      or nullif(decision ->> 'definition_id', '') is null
      or nullif(decision ->> 'version_id', '') is null
  ) then
    raise exception 'consent_decision_is_invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
    group by decision ->> 'definition_id'
    having count(*) > 1
  ) then
    raise exception 'duplicate_consent_decision' using errcode = '23514';
  end if;

  select count(*)
  into active_consent_count
  from public.crm_consent_definitions definition
  join public.crm_consent_definition_versions consent_version
    on consent_version.organization_id = definition.organization_id
   and consent_version.definition_id = definition.id
   and consent_version.id = definition.current_version_id
  where definition.organization_id = target_organization_id
    and definition.context = 'client_creation'
    and consent_version.status = 'published'
    and consent_version.effective_from <= now()
    and (consent_version.effective_to is null or consent_version.effective_to > now());

  if jsonb_array_length(coalesce(consent_decisions, '[]'::jsonb)) <> active_consent_count then
    raise exception 'consent_catalogue_is_stale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
    where not exists (
      select 1
      from public.crm_consent_definitions definition
      join public.crm_consent_definition_versions consent_version
        on consent_version.organization_id = definition.organization_id
       and consent_version.definition_id = definition.id
       and consent_version.id = definition.current_version_id
      where definition.organization_id = target_organization_id
        and definition.context = 'client_creation'
        and definition.id::text = decision ->> 'definition_id'
        and consent_version.id::text = decision ->> 'version_id'
        and consent_version.status = 'published'
        and consent_version.effective_from <= now()
        and (consent_version.effective_to is null or consent_version.effective_to > now())
    )
  ) then
    raise exception 'consent_catalogue_is_stale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.crm_consent_definitions definition
    join public.crm_consent_definition_versions consent_version
      on consent_version.organization_id = definition.organization_id
     and consent_version.definition_id = definition.id
     and consent_version.id = definition.current_version_id
    where definition.organization_id = target_organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.is_required
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(consent_decisions, '[]'::jsonb)) decision
        where decision ->> 'definition_id' = definition.id::text
          and decision ->> 'version_id' = consent_version.id::text
          and (decision ->> 'granted')::boolean is true
      )
  ) then
    raise exception 'required_consent_not_granted' using errcode = '23514';
  end if;
end;
$$;

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
  normalized_email text := lower(nullif(btrim(customer_email), ''));
  normalized_phone text := nullif(regexp_replace(
    coalesce(customer_phone, ''), '[^0-9]+', '', 'g'
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
  if normalized_email is null then
    raise exception 'customer_email_is_required' using errcode = '23514';
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

  -- All contact locks use the same lexical order to avoid deadlocks when two
  -- requests carry the same e-mail/phone pair in a different presentation.
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
    raise exception 'customer_contact_matches_multiple_clients' using errcode = '23505';
  end if;

  if cardinality(matched_client_ids) = 1 then
    select client.*
    into strict resolved_client
    from public.crm_clients client
    where client.organization_id = target_organization_id
      and client.id = matched_client_ids[1];
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
      normalized_email,
      nullif(btrim(customer_phone), ''),
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
    and (
      person.email_normalized = normalized_email
      or (normalized_phone is not null and person.phone_normalized = normalized_phone)
    )
  order by
    (person.email_normalized = normalized_email) desc,
    (person.role = 'primary') desc,
    person.created_at,
    person.id
  limit 1;

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
          select 1 from public.crm_client_people person
          where person.organization_id = target_organization_id
            and person.client_id = resolved_client.id
        ) then 'booking_contact'
        else 'primary'
      end,
      btrim(customer_name),
      normalized_email,
      nullif(btrim(customer_phone), ''),
      jsonb_build_object(
        'createdFromBookingWidget', true,
        'bookingWidgetId', target_widget_id
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
      when 'email' then resolved_person.email
      when 'sms' then resolved_person.phone
      when 'phone' then resolved_person.phone
      when 'messaging' then resolved_person.phone
      else coalesce(resolved_person.email, resolved_person.phone)
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

revoke all on function private.validate_widget_consent_decisions(uuid, jsonb)
  from public, anon, authenticated, service_role;
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
    '_private', jsonb_build_object(
      'allowedOrigins', to_jsonb(widget_record.allowed_origins)
    )
  ) into result;

  return result;
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
  join public.users app_user on app_user.id = appointment.expert_user_id
  where appointment.id = target_appointment_id;
$$;

revoke all on function private.widget_booking_result(uuid)
  from public, anon, authenticated, service_role;

-- Remove the old overload completely. Keeping it would let callers bypass the
-- consent/client contract and would also make PostgREST overload resolution
-- ambiguous.
drop function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text
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
  p_consent_decisions jsonb
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
begin
  if p_starts_at is null
     or nullif(btrim(p_customer_name), '') is null
     or length(btrim(p_customer_name)) > 200
     or nullif(btrim(p_customer_email), '') is null
     or length(btrim(p_customer_email)) > 320
     or p_customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or (p_customer_phone is not null and length(btrim(p_customer_phone)) > 50)
     or (p_notes is not null and length(btrim(p_notes)) > 2000) then
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

  perform private.validate_widget_consent_decisions(
    widget_record.organization_id,
    p_consent_decisions
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
        select resolved.client_id, resolved.client_person_id
        into strict resolved_client
        from private.resolve_widget_crm_client(
          widget_record.organization_id,
          candidate.user_id,
          widget_record.id,
          btrim(p_customer_name),
          lower(btrim(p_customer_email)),
          nullif(btrim(p_customer_phone), ''),
          p_consent_decisions,
          'widget:' || widget_record.id::text || ':booking:' || btrim(p_idempotency_key)
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
          idempotency_key
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
          raise;
      end;
    end if;
  end loop;

  raise exception 'booking_slot_conflict'
    using errcode = '23P01',
          constraint = 'appointment_expert_reservations_no_overlap';
end;
$$;

create function public.get_staff_booking_slots(
  p_organization_id uuid,
  p_facility_id uuid,
  p_service_id uuid,
  p_local_date date,
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
  facility_record record;
  service_record record;
begin
  if p_local_date is null then
    raise exception 'booking_date_is_required' using errcode = '22023';
  end if;

  select facility.timezone
  into facility_record
  from public.facilities facility
  where facility.organization_id = p_organization_id
    and facility.id = p_facility_id
    and facility.is_active;

  if not found then
    raise exception 'facility_not_found' using errcode = 'P0002';
  end if;

  select service.duration_minutes,
         service.buffer_before_minutes,
         service.buffer_after_minutes,
         service.slot_interval_minutes
  into service_record
  from public.booking_services service
  join public.facility_services facility_service
    on facility_service.organization_id = service.organization_id
   and facility_service.service_id = service.id
   and facility_service.facility_id = p_facility_id
   and facility_service.is_active
  where service.organization_id = p_organization_id
    and service.id = p_service_id
    and service.is_active;

  if not found then
    raise exception 'facility_service_not_found' using errcode = 'P0002';
  end if;

  if p_expert_user_id is not null and not exists (
    select 1
    from public.facility_service_experts service_expert
    join public.facility_memberships membership
      on membership.organization_id = service_expert.organization_id
     and membership.facility_id = service_expert.facility_id
     and membership.user_id = service_expert.user_id
     and membership.is_bookable
    where service_expert.organization_id = p_organization_id
      and service_expert.facility_id = p_facility_id
      and service_expert.service_id = p_service_id
      and service_expert.user_id = p_expert_user_id
      and service_expert.is_active
  ) then
    raise exception 'expert_not_bookable_for_service' using errcode = '23503';
  end if;

  return query
  with facility_periods as (
    select override.opens_at, override.closes_at
    from public.facility_opening_overrides override
    where override.organization_id = p_organization_id
      and override.facility_id = p_facility_id
      and override.local_date = p_local_date
      and not override.is_closed

    union all

    select opening.opens_at, opening.closes_at
    from public.facility_opening_hours opening
    where opening.organization_id = p_organization_id
      and opening.facility_id = p_facility_id
      and opening.weekday = extract(isodow from p_local_date)::integer - 1
      and opening.is_active
      and not exists (
        select 1
        from public.facility_opening_overrides override
        where override.organization_id = p_organization_id
          and override.facility_id = p_facility_id
          and override.local_date = p_local_date
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
    where service_expert.organization_id = p_organization_id
      and service_expert.facility_id = p_facility_id
      and service_expert.service_id = p_service_id
      and service_expert.is_active
      and (p_expert_user_id is null or service_expert.user_id = p_expert_user_id)
  ),
  candidate_slots as (
    select (
             slot_local.slot_value at time zone facility_record.timezone
           ) as slot_starts_at,
           expert.user_id,
           expert.display_name
    from facility_periods period
    cross join experts expert
    cross join lateral generate_series(
      p_local_date + period.opens_at
        + make_interval(mins => service_record.buffer_before_minutes),
      p_local_date + period.closes_at
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
    p_organization_id,
    p_facility_id,
    p_service_id,
    candidate.user_id,
    candidate.slot_starts_at
  )
  order by 1, 4, 3;
end;
$$;

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
  p_idempotency_key text
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
  client_record public.crm_clients;
  person_record public.crm_client_people;
  inserted_appointment public.appointments;
  existing_appointment public.appointments;
begin
  if p_starts_at is null
     or p_client_id is null
     or p_created_by_user_id is null
     or nullif(btrim(p_idempotency_key), '') is null
     or length(btrim(p_idempotency_key)) < 8
     or length(btrim(p_idempotency_key)) > 200
     or (p_notes is not null and length(btrim(p_notes)) > 2000) then
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
       and existing_appointment.notes is not distinct from nullif(btrim(p_notes), '') then
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
    created_by_user_id
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
    p_created_by_user_id
  )
  returning * into inserted_appointment;

  return private.staff_booking_result(inserted_appointment.id);
end;
$$;

revoke all on function private.staff_booking_result(uuid)
  from public, anon, authenticated, service_role;

create function public.search_crm_clients(
  p_organization_id uuid,
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  filters jsonb := coalesce(p_filters, '{}'::jsonb);
  search_term text;
  search_query tsquery;
  status_codes text[];
  owner_user_ids uuid[];
  owner_mode text;
  tags_any text[];
  tags_all text[];
  lead_sources text[];
  created_from timestamptz;
  created_to timestamptz;
  updated_from timestamptz;
  updated_to timestamptz;
  has_email boolean;
  has_phone boolean;
  consent_definition_id uuid;
  consent_decision text;
  target_sort text;
  target_limit integer;
  target_offset integer;
  target_cursor jsonb;
  cursor_id uuid;
  cursor_timestamp timestamptz;
  cursor_name text;
  include_facets boolean;
  result jsonb;
begin
  if jsonb_typeof(filters) <> 'object' then
    raise exception 'client_filters_must_be_an_object' using errcode = '22023';
  end if;

  if current_user <> 'service_role' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;

  if jsonb_typeof(coalesce(filters -> 'statusCodes', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'tagsAny', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'tagsAll', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'leadSources', '[]'::jsonb)) <> 'array' then
    raise exception 'client_filter_arrays_are_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) value
    where value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'owner_user_ids_are_invalid' using errcode = '22023';
  end if;

  search_term := nullif(btrim(filters ->> 'q'), '');
  if length(coalesce(search_term, '')) > 200 then
    raise exception 'client_search_query_is_too_long' using errcode = '22023';
  end if;
  if search_term is not null then
    search_term := lower(extensions.unaccent(
      'extensions.unaccent'::regdictionary,
      search_term
    ));
    search_query := websearch_to_tsquery('simple', search_term);
  end if;

  select coalesce(array_agg(value), '{}'::text[])
  into status_codes
  from jsonb_array_elements_text(coalesce(filters -> 'statusCodes', '[]'::jsonb)) value;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into owner_user_ids
  from jsonb_array_elements_text(coalesce(filters -> 'ownerUserIds', '[]'::jsonb)) value;

  select coalesce(array_agg(value), '{}'::text[])
  into tags_any
  from jsonb_array_elements_text(coalesce(filters -> 'tagsAny', '[]'::jsonb)) value;

  select coalesce(array_agg(value), '{}'::text[])
  into tags_all
  from jsonb_array_elements_text(coalesce(filters -> 'tagsAll', '[]'::jsonb)) value;

  select coalesce(array_agg(value), '{}'::text[])
  into lead_sources
  from jsonb_array_elements_text(coalesce(filters -> 'leadSources', '[]'::jsonb)) value;

  owner_mode := coalesce(nullif(filters ->> 'ownerMode', ''), 'all');
  if owner_mode not in ('all', 'assigned', 'unassigned') then
    raise exception 'owner_mode_is_invalid' using errcode = '22023';
  end if;

  created_from := nullif(filters ->> 'createdFrom', '')::timestamptz;
  created_to := nullif(filters ->> 'createdTo', '')::timestamptz;
  updated_from := nullif(filters ->> 'updatedFrom', '')::timestamptz;
  updated_to := nullif(filters ->> 'updatedTo', '')::timestamptz;
  has_email := nullif(filters ->> 'hasEmail', '')::boolean;
  has_phone := nullif(filters ->> 'hasPhone', '')::boolean;

  if nullif(filters ->> 'consentDefinitionId', '') is not null then
    if (filters ->> 'consentDefinitionId') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'consent_definition_id_is_invalid' using errcode = '22023';
    end if;
    consent_definition_id := (filters ->> 'consentDefinitionId')::uuid;
  end if;

  consent_decision := nullif(filters ->> 'consentDecision', '');
  if consent_decision is not null
     and consent_decision not in ('granted', 'declined', 'withdrawn', 'unknown') then
    raise exception 'consent_decision_is_invalid' using errcode = '22023';
  end if;
  if consent_decision is not null and consent_definition_id is null then
    raise exception 'consent_definition_is_required_for_decision_filter'
      using errcode = '22023';
  end if;

  target_sort := coalesce(nullif(filters ->> 'sort', ''), 'updated_desc');
  if target_sort not in (
    'updated_desc', 'updated_asc', 'created_desc', 'created_asc',
    'name_asc', 'name_desc'
  ) then
    raise exception 'client_sort_is_invalid' using errcode = '22023';
  end if;

  target_limit := least(greatest(coalesce((filters ->> 'limit')::integer, 50), 1), 100);
  target_offset := coalesce((filters ->> 'offset')::integer, 0);
  if target_offset < 0 or target_offset > 100000 then
    raise exception 'client_offset_is_invalid' using errcode = '22023';
  end if;

  target_cursor := filters -> 'cursor';
  if target_cursor is not null and jsonb_typeof(target_cursor) <> 'object' then
    raise exception 'client_cursor_is_invalid' using errcode = '22023';
  end if;
  if target_cursor is not null and target_offset > 0 then
    raise exception 'client_cursor_and_offset_are_mutually_exclusive'
      using errcode = '22023';
  end if;

  if target_cursor is not null then
    if coalesce(target_cursor ->> 'id', '') !~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or nullif(target_cursor ->> 'value', '') is null then
      raise exception 'client_cursor_is_invalid' using errcode = '22023';
    end if;

    cursor_id := (target_cursor ->> 'id')::uuid;
    if target_sort in ('updated_desc', 'updated_asc', 'created_desc', 'created_asc') then
      cursor_timestamp := (target_cursor ->> 'value')::timestamptz;
    else
      cursor_name := lower(target_cursor ->> 'value');
    end if;
  end if;

  include_facets := coalesce((filters ->> 'includeFacets')::boolean, false);

  with filtered as materialized (
    select
      client.id,
      client.organization_id,
      client.owner_user_id,
      client.status_code,
      client.lead_source,
      client.tags,
      client.primary_email_normalized,
      client.primary_phone_normalized,
      client.display_name,
      client.created_at,
      client.updated_at,
      (
        to_jsonb(client)
          - 'search_text'
          - 'search_vector'
          - 'primary_email_normalized'
          - 'primary_phone_normalized'
      ) || jsonb_build_object(
        'owner', case
          when owner.id is null then null
          else jsonb_build_object(
            'id', owner.id,
            'name', coalesce(owner.full_name, owner.email),
            'email', owner.email
          )
        end,
        'primaryPerson', primary_person.person_json
      ) as row_json
    from public.crm_clients client
    left join public.users owner on owner.id = client.owner_user_id
    left join lateral (
      select to_jsonb(person)
        - 'email_normalized'
        - 'phone_normalized' as person_json
      from public.crm_client_people person
      where person.organization_id = client.organization_id
        and person.client_id = client.id
      order by (person.role = 'primary') desc, person.created_at, person.id
      limit 1
    ) primary_person on true
    where client.organization_id = p_organization_id
      and (
        search_term is null
        or client.search_vector @@ search_query
        or client.search_text ilike '%' || search_term || '%'
      )
      and (cardinality(status_codes) = 0 or client.status_code = any(status_codes))
      and (
        owner_mode = 'all'
        or (owner_mode = 'assigned' and client.owner_user_id is not null)
        or (owner_mode = 'unassigned' and client.owner_user_id is null)
      )
      and (
        cardinality(owner_user_ids) = 0
        or client.owner_user_id = any(owner_user_ids)
      )
      and (cardinality(tags_any) = 0 or client.tags && tags_any)
      and (cardinality(tags_all) = 0 or client.tags @> tags_all)
      and (
        cardinality(lead_sources) = 0
        or client.lead_source = any(lead_sources)
      )
      and (created_from is null or client.created_at >= created_from)
      and (created_to is null or client.created_at <= created_to)
      and (updated_from is null or client.updated_at >= updated_from)
      and (updated_to is null or client.updated_at <= updated_to)
      and (
        has_email is null
        or (client.primary_email_normalized is not null) = has_email
      )
      and (
        has_phone is null
        or (client.primary_phone_normalized is not null) = has_phone
      )
      and (
        consent_definition_id is null
        or (
          consent_decision is null
          and exists (
            select 1
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
          )
        )
        or (
          consent_decision = 'unknown'
          and not exists (
            select 1
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
          )
        )
        or (
          consent_decision in ('granted', 'declined', 'withdrawn')
          and consent_decision = (
            select consent_event.decision
            from public.crm_client_consent_events consent_event
            where consent_event.organization_id = client.organization_id
              and consent_event.client_id = client.id
              and consent_event.definition_id = consent_definition_id
            order by consent_event.occurred_at desc, consent_event.id desc
            limit 1
          )
        )
      )
  ),
  cursor_filtered as (
    select filtered.*
    from filtered
    where target_cursor is null
      or (
        target_sort = 'updated_desc'
        and (
          filtered.updated_at < cursor_timestamp
          or (filtered.updated_at = cursor_timestamp and filtered.id < cursor_id)
        )
      )
      or (
        target_sort = 'updated_asc'
        and (
          filtered.updated_at > cursor_timestamp
          or (filtered.updated_at = cursor_timestamp and filtered.id > cursor_id)
        )
      )
      or (
        target_sort = 'created_desc'
        and (
          filtered.created_at < cursor_timestamp
          or (filtered.created_at = cursor_timestamp and filtered.id < cursor_id)
        )
      )
      or (
        target_sort = 'created_asc'
        and (
          filtered.created_at > cursor_timestamp
          or (filtered.created_at = cursor_timestamp and filtered.id > cursor_id)
        )
      )
      or (
        target_sort = 'name_asc'
        and (
          lower(filtered.display_name) > cursor_name
          or (lower(filtered.display_name) = cursor_name and filtered.id > cursor_id)
        )
      )
      or (
        target_sort = 'name_desc'
        and (
          lower(filtered.display_name) < cursor_name
          or (lower(filtered.display_name) = cursor_name and filtered.id < cursor_id)
        )
      )
  ),
  paged as materialized (
    select cursor_filtered.*
    from cursor_filtered
    order by
      case when target_sort = 'updated_desc' then updated_at end desc,
      case when target_sort = 'updated_asc' then updated_at end asc,
      case when target_sort = 'created_desc' then created_at end desc,
      case when target_sort = 'created_asc' then created_at end asc,
      case when target_sort = 'name_asc' then lower(display_name) end asc,
      case when target_sort = 'name_desc' then lower(display_name) end desc,
      case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then id end desc,
      case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then id end asc
    limit target_limit + 1
    offset target_offset
  ),
  page_rows as materialized (
    select paged.*
    from paged
    order by
      case when target_sort = 'updated_desc' then updated_at end desc,
      case when target_sort = 'updated_asc' then updated_at end asc,
      case when target_sort = 'created_desc' then created_at end desc,
      case when target_sort = 'created_asc' then created_at end asc,
      case when target_sort = 'name_asc' then lower(display_name) end asc,
      case when target_sort = 'name_desc' then lower(display_name) end desc,
      case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then id end desc,
      case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then id end asc
    limit target_limit
  ),
  last_row as (
    select page_rows.*
    from page_rows
    order by
      case when target_sort = 'updated_desc' then updated_at end asc,
      case when target_sort = 'updated_asc' then updated_at end desc,
      case when target_sort = 'created_desc' then created_at end asc,
      case when target_sort = 'created_asc' then created_at end desc,
      case when target_sort = 'name_asc' then lower(display_name) end desc,
      case when target_sort = 'name_desc' then lower(display_name) end asc,
      case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then id end asc,
      case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then id end desc
    limit 1
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(page_rows.row_json order by
        case when target_sort = 'updated_desc' then page_rows.updated_at end desc,
        case when target_sort = 'updated_asc' then page_rows.updated_at end asc,
        case when target_sort = 'created_desc' then page_rows.created_at end desc,
        case when target_sort = 'created_asc' then page_rows.created_at end asc,
        case when target_sort = 'name_asc' then lower(page_rows.display_name) end asc,
        case when target_sort = 'name_desc' then lower(page_rows.display_name) end desc,
        case when target_sort in ('updated_desc', 'created_desc', 'name_desc') then page_rows.id end desc,
        case when target_sort in ('updated_asc', 'created_asc', 'name_asc') then page_rows.id end asc
      )
      from page_rows
    ), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'pageInfo', jsonb_build_object(
      'hasMore', (select count(*) > target_limit from paged),
      'nextCursor', case
        when (select count(*) > target_limit from paged) then (
          select jsonb_build_object(
            'value', case
              when target_sort in ('updated_desc', 'updated_asc') then last_row.updated_at::text
              when target_sort in ('created_desc', 'created_asc') then last_row.created_at::text
              else lower(last_row.display_name)
            end,
            'id', last_row.id
          )
          from last_row
        )
        else null
      end,
      'offset', target_offset,
      'limit', target_limit
    ),
    'facets', case when include_facets then jsonb_build_object(
      'statuses', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', status.status_code,
          'label', status.status_code,
          'count', status.client_count
        ) order by status.status_code)
        from (
          select filtered.status_code, count(*) as client_count
          from filtered
          group by filtered.status_code
        ) status
      ), '[]'::jsonb),
      'sources', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', source.lead_source,
          'label', source.lead_source,
          'count', source.client_count
        ) order by source.lead_source)
        from (
          select filtered.lead_source, count(*) as client_count
          from filtered
          where filtered.lead_source is not null
          group by filtered.lead_source
        ) source
      ), '[]'::jsonb),
      'tags', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', tag.tag_value,
          'label', tag.tag_value,
          'count', tag.client_count
        ) order by tag.tag_value)
        from (
          select tag_value, count(*) as client_count
          from filtered
          cross join lateral unnest(filtered.tags) tag_value
          group by tag_value
        ) tag
      ), '[]'::jsonb),
      'owners', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', owner_facet.owner_value,
          'label', owner_facet.owner_label,
          'count', owner_facet.client_count
        ) order by owner_facet.owner_label, owner_facet.owner_value)
        from (
          select
            coalesce(filtered.owner_user_id::text, 'unassigned') as owner_value,
            coalesce(app_user.full_name, app_user.email, 'Nieprzypisany') as owner_label,
            count(*) as client_count
          from filtered
          left join public.users app_user on app_user.id = filtered.owner_user_id
          group by filtered.owner_user_id, app_user.full_name, app_user.email
        ) owner_facet
      ), '[]'::jsonb),
      'consentDefinitions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', definition.id,
          'code', definition.code,
          'currentVersionId', consent_version.id,
          'currentVersion', jsonb_build_object(
            'id', consent_version.id,
            'version', consent_version.version,
            'displayTitle', consent_version.display_title,
            'content', consent_version.content,
            'purpose', consent_version.purpose,
            'channel', consent_version.channel,
            'legalBasis', consent_version.legal_basis,
            'isRequired', consent_version.is_required
          ),
          'counts', jsonb_build_object(
            'granted', (
              select count(*) from filtered
              where (
                select event.decision
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
                order by event.occurred_at desc, event.id desc
                limit 1
              ) = 'granted'
            ),
            'declined', (
              select count(*) from filtered
              where (
                select event.decision
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
                order by event.occurred_at desc, event.id desc
                limit 1
              ) = 'declined'
            ),
            'withdrawn', (
              select count(*) from filtered
              where (
                select event.decision
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
                order by event.occurred_at desc, event.id desc
                limit 1
              ) = 'withdrawn'
            ),
            'unknown', (
              select count(*) from filtered
              where not exists (
                select 1
                from public.crm_client_consent_events event
                where event.organization_id = p_organization_id
                  and event.client_id = filtered.id
                  and event.definition_id = definition.id
              )
            )
          )
        ) order by consent_version.sort_order, consent_version.display_title)
        from public.crm_consent_definitions definition
        join public.crm_consent_definition_versions consent_version
          on consent_version.organization_id = definition.organization_id
         and consent_version.definition_id = definition.id
         and consent_version.id = definition.current_version_id
        where definition.organization_id = p_organization_id
          and definition.context = 'client_creation'
          and consent_version.status = 'published'
          and consent_version.effective_from <= now()
          and (consent_version.effective_to is null or consent_version.effective_to > now())
      ), '[]'::jsonb),
      'dateBounds', jsonb_build_object(
        'createdMin', (select min(filtered.created_at) from filtered),
        'createdMax', (select max(filtered.created_at) from filtered),
        'updatedMin', (select min(filtered.updated_at) from filtered),
        'updatedMax', (select max(filtered.updated_at) from filtered)
      ),
      'contactCounts', jsonb_build_object(
        'email', (select count(*) from filtered where primary_email_normalized is not null),
        'phone', (select count(*) from filtered where primary_phone_normalized is not null),
        'both', (select count(*) from filtered where primary_email_normalized is not null and primary_phone_normalized is not null),
        'none', (select count(*) from filtered where primary_email_normalized is null and primary_phone_normalized is null)
      )
    ) else null end
  )
  into result;

  return result;
end;
$$;

revoke all on function public.get_booking_widget_catalog(uuid)
  from public, anon, authenticated;
grant execute on function public.get_booking_widget_catalog(uuid)
  to service_role;

revoke all on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_widget_booking(
  uuid, uuid, timestamptz, text, text, text, text, uuid, text, jsonb
) to service_role;

revoke all on function public.get_staff_booking_slots(
  uuid, uuid, uuid, date, uuid
) from public, anon, authenticated;
grant execute on function public.get_staff_booking_slots(
  uuid, uuid, uuid, date, uuid
) to service_role;

revoke all on function public.create_staff_appointment(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_staff_appointment(
  uuid, uuid, uuid, uuid, uuid, uuid, timestamptz, text, uuid, text
) to service_role;

revoke all on function public.search_crm_clients(uuid, jsonb)
  from public, anon;
grant execute on function public.search_crm_clients(uuid, jsonb)
  to authenticated, service_role;

comment on column public.appointments.client_id is
  'Required tenant-scoped CRM client for the appointment; customer_* columns are immutable contact snapshots.';
comment on column public.appointments.client_person_id is
  'Optional tenant-scoped person subject. When set, it must belong to appointments.client_id.';
comment on function public.search_crm_clients(uuid, jsonb) is
  'Advanced tenant-scoped CRM search with exact count, cursor/offset pagination and optional facets.';
