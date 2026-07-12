-- Required consent semantics and explicit per-user client ownership.
-- Requirement is part of the immutable consent version. Seeded marketing
-- consents remain optional; legal/admin users can opt a future version in.

alter table public.crm_consent_definition_versions
  add column is_required boolean not null default false;

drop function public.create_crm_consent_definition(
  uuid, text, text, text, text, text, text, text, text, integer, text, timestamptz, timestamptz, text
);

create function public.create_crm_consent_definition(
  p_organization_id uuid,
  p_code text,
  p_internal_name text,
  p_display_title text,
  p_content text,
  p_purpose text,
  p_channel text,
  p_legal_basis text,
  p_is_required boolean,
  p_status text,
  p_sort_order integer,
  p_language_code text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_change_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_definition_id uuid := gen_random_uuid();
  new_version_id uuid := gen_random_uuid();
begin
  if not private.is_organization_admin(p_organization_id) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  insert into public.crm_consent_definitions (
    id,
    organization_id,
    code,
    context,
    current_version_id,
    created_by_user_id,
    updated_by_user_id
  ) values (
    new_definition_id,
    p_organization_id,
    p_code,
    'client_creation',
    new_version_id,
    (select auth.uid()),
    (select auth.uid())
  );

  insert into public.crm_consent_definition_versions (
    id,
    organization_id,
    definition_id,
    version,
    internal_name,
    display_title,
    content,
    purpose,
    channel,
    legal_basis,
    is_required,
    status,
    sort_order,
    language_code,
    effective_from,
    effective_to,
    change_note,
    created_by_user_id
  ) values (
    new_version_id,
    p_organization_id,
    new_definition_id,
    1,
    p_internal_name,
    p_display_title,
    p_content,
    p_purpose,
    p_channel,
    p_legal_basis,
    coalesce(p_is_required, false),
    p_status,
    p_sort_order,
    p_language_code,
    coalesce(p_effective_from, now()),
    p_effective_to,
    p_change_note,
    (select auth.uid())
  );

  return new_definition_id;
end;
$$;

drop function public.update_crm_consent_definition(
  uuid, uuid, text, text, text, text, text, text, text, integer, text, timestamptz, timestamptz, text
);

create function public.update_crm_consent_definition(
  p_definition_id uuid,
  p_organization_id uuid,
  p_internal_name text,
  p_display_title text,
  p_content text,
  p_purpose text,
  p_channel text,
  p_legal_basis text,
  p_is_required boolean,
  p_status text,
  p_sort_order integer,
  p_language_code text,
  p_effective_from timestamptz,
  p_effective_to timestamptz,
  p_change_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_definition public.crm_consent_definitions;
  previous_version integer;
  new_version_id uuid := gen_random_uuid();
begin
  if not private.is_organization_admin(p_organization_id) then
    raise exception 'organization_admin_required' using errcode = '42501';
  end if;

  select definition.*
  into target_definition
  from public.crm_consent_definitions definition
  where definition.organization_id = p_organization_id
    and definition.id = p_definition_id
  for update;

  if not found then
    raise exception 'consent_definition_not_found' using errcode = 'P0002';
  end if;

  select consent_version.version
  into previous_version
  from public.crm_consent_definition_versions consent_version
  where consent_version.organization_id = p_organization_id
    and consent_version.definition_id = p_definition_id
    and consent_version.id = target_definition.current_version_id;

  insert into public.crm_consent_definition_versions (
    id,
    organization_id,
    definition_id,
    version,
    internal_name,
    display_title,
    content,
    purpose,
    channel,
    legal_basis,
    is_required,
    status,
    sort_order,
    language_code,
    effective_from,
    effective_to,
    change_note,
    created_by_user_id
  ) values (
    new_version_id,
    p_organization_id,
    p_definition_id,
    previous_version + 1,
    p_internal_name,
    p_display_title,
    p_content,
    p_purpose,
    p_channel,
    p_legal_basis,
    coalesce(p_is_required, false),
    p_status,
    p_sort_order,
    p_language_code,
    coalesce(p_effective_from, now()),
    p_effective_to,
    p_change_note,
    (select auth.uid())
  );

  update public.crm_consent_definitions
  set current_version_id = new_version_id,
      updated_by_user_id = (select auth.uid())
  where organization_id = p_organization_id
    and id = p_definition_id;

  return new_version_id;
end;
$$;

revoke all on function public.create_crm_consent_definition(
  uuid, text, text, text, text, text, text, text, boolean, text, integer, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.create_crm_consent_definition(
  uuid, text, text, text, text, text, text, text, boolean, text, integer, text, timestamptz, timestamptz, text
) to authenticated;

revoke all on function public.update_crm_consent_definition(
  uuid, uuid, text, text, text, text, text, text, boolean, text, integer, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.update_crm_consent_definition(
  uuid, uuid, text, text, text, text, text, text, boolean, text, integer, text, timestamptz, timestamptz, text
) to authenticated;

-- A member creates clients for themselves. Only an organization admin can
-- delegate a new client to another member or change an existing owner.
create or replace function private.validate_crm_client_owner_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if new.owner_user_id is null then
    raise exception 'client_owner_is_required' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = new.owner_user_id
  ) then
    raise exception 'client_owner_not_organization_member' using errcode = '23503';
  end if;

  -- Direct database/service-role maintenance has no auth subject and remains
  -- protected by the same-organization foreign key above.
  if actor_id is null then
    return new;
  end if;

  if tg_op = 'INSERT'
    and new.owner_user_id <> actor_id
    and not private.is_organization_admin(new.organization_id)
  then
    raise exception 'client_owner_assignment_admin_required' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
    and new.owner_user_id is distinct from old.owner_user_id
    and not private.is_organization_admin(new.organization_id)
  then
    raise exception 'client_owner_assignment_admin_required' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_crm_client_owner_assignment()
  from public, anon, authenticated;

create trigger crm_clients_validate_owner_assignment
  before insert or update of owner_user_id on public.crm_clients
  for each row execute function private.validate_crm_client_owner_assignment();

-- This deferred check closes direct Data API/MCP insert paths. A client insert
-- is valid only when the same transaction records a decision for every active
-- definition and grants every definition marked as required.
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
          and consent_event.source = 'client_creation'
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
          and consent_event.source = 'client_creation'
      )
  ) then
    raise exception 'required_consent_not_granted' using errcode = '23514';
  end if;

  return null;
end;
$$;

revoke all on function private.enforce_crm_client_creation_consents()
  from public, anon, authenticated;

create constraint trigger crm_clients_enforce_creation_consents
  after insert on public.crm_clients
  deferrable initially deferred
  for each row execute function private.enforce_crm_client_creation_consents();

create or replace function public.create_crm_client_with_consents(
  p_organization_id uuid,
  p_owner_user_id uuid,
  p_display_name text,
  p_status_code text,
  p_lead_source text,
  p_primary_email text,
  p_primary_phone text,
  p_tags text[],
  p_notes text,
  p_metadata jsonb,
  p_primary_person jsonb,
  p_consent_decisions jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_client public.crm_clients;
  inserted_person public.crm_client_people;
  consent_record record;
  supplied_decision jsonb;
  decision_granted boolean;
  decision_contact_value text;
  inserted_consent_events jsonb := '[]'::jsonb;
  active_consent_count integer;
  effective_owner_user_id uuid := coalesce(p_owner_user_id, (select auth.uid()));
begin
  if not private.is_organization_member(p_organization_id) then
    raise exception 'organization_membership_required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = effective_owner_user_id
  ) then
    raise exception 'client_owner_not_organization_member' using errcode = '23503';
  end if;

  if effective_owner_user_id <> (select auth.uid())
    and not private.is_organization_admin(p_organization_id)
  then
    raise exception 'client_owner_assignment_admin_required' using errcode = '42501';
  end if;

  if nullif(btrim(p_display_name), '') is null then
    raise exception 'display_name_is_required' using errcode = '23514';
  end if;

  if jsonb_typeof(coalesce(p_consent_decisions, '[]'::jsonb)) <> 'array' then
    raise exception 'consent_decisions_must_be_an_array' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
    where jsonb_typeof(decision) <> 'object'
      or jsonb_typeof(decision -> 'granted') is distinct from 'boolean'
      or nullif(decision ->> 'definition_id', '') is null
      or nullif(decision ->> 'version_id', '') is null
  ) then
    raise exception 'consent_decision_is_invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
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
  where definition.organization_id = p_organization_id
    and definition.context = 'client_creation'
    and consent_version.status = 'published'
    and consent_version.effective_from <= now()
    and (consent_version.effective_to is null or consent_version.effective_to > now());

  if jsonb_array_length(coalesce(p_consent_decisions, '[]'::jsonb)) <> active_consent_count then
    raise exception 'consent_catalogue_is_stale' using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
    where not exists (
      select 1
      from public.crm_consent_definitions definition
      join public.crm_consent_definition_versions consent_version
        on consent_version.organization_id = definition.organization_id
       and consent_version.definition_id = definition.id
       and consent_version.id = definition.current_version_id
      where definition.organization_id = p_organization_id
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
    where definition.organization_id = p_organization_id
      and definition.context = 'client_creation'
      and consent_version.status = 'published'
      and consent_version.is_required
      and consent_version.effective_from <= now()
      and (consent_version.effective_to is null or consent_version.effective_to > now())
      and not exists (
        select 1
        from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
        where decision ->> 'definition_id' = definition.id::text
          and decision ->> 'version_id' = consent_version.id::text
          and (decision ->> 'granted')::boolean is true
      )
  ) then
    raise exception 'required_consent_not_granted' using errcode = '23514';
  end if;

  insert into public.crm_clients (
    organization_id,
    owner_user_id,
    display_name,
    status_code,
    lead_source,
    primary_email,
    primary_phone,
    tags,
    notes,
    metadata
  ) values (
    p_organization_id,
    effective_owner_user_id,
    btrim(p_display_name),
    coalesce(nullif(btrim(p_status_code), ''), 'lead'),
    nullif(btrim(p_lead_source), ''),
    nullif(btrim(p_primary_email), ''),
    nullif(btrim(p_primary_phone), ''),
    coalesce(p_tags, '{}'::text[]),
    nullif(btrim(p_notes), ''),
    coalesce(p_metadata, '{}'::jsonb)
  ) returning * into inserted_client;

  insert into public.crm_client_people (
    organization_id,
    client_id,
    role,
    first_name,
    last_name,
    display_name,
    email,
    phone,
    pesel,
    date_of_birth,
    metadata
  ) values (
    p_organization_id,
    inserted_client.id,
    coalesce(nullif(btrim(p_primary_person ->> 'role'), ''), 'primary'),
    nullif(btrim(p_primary_person ->> 'first_name'), ''),
    nullif(btrim(p_primary_person ->> 'last_name'), ''),
    coalesce(nullif(btrim(p_primary_person ->> 'display_name'), ''), inserted_client.display_name),
    coalesce(nullif(btrim(p_primary_person ->> 'email'), ''), inserted_client.primary_email),
    coalesce(nullif(btrim(p_primary_person ->> 'phone'), ''), inserted_client.primary_phone),
    nullif(btrim(p_primary_person ->> 'pesel'), ''),
    case
      when nullif(btrim(p_primary_person ->> 'date_of_birth'), '') is null then null
      else (p_primary_person ->> 'date_of_birth')::date
    end,
    case
      when jsonb_typeof(p_primary_person -> 'metadata') = 'object'
        then p_primary_person -> 'metadata'
      else '{}'::jsonb
    end
  ) returning * into inserted_person;

  for consent_record in
    select definition.id as definition_id, consent_version.*
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
    order by consent_version.sort_order, consent_version.display_title
  loop
    select decision
    into supplied_decision
    from jsonb_array_elements(coalesce(p_consent_decisions, '[]'::jsonb)) decision
    where decision ->> 'definition_id' = consent_record.definition_id::text
    limit 1;

    decision_granted := (supplied_decision ->> 'granted')::boolean;
    decision_contact_value := case consent_record.channel
      when 'email' then inserted_person.email
      when 'sms' then inserted_person.phone
      when 'phone' then inserted_person.phone
      when 'messaging' then inserted_person.phone
      else coalesce(inserted_person.email, inserted_person.phone)
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
      metadata
    ) values (
      p_organization_id,
      inserted_client.id,
      inserted_person.id,
      consent_record.definition_id,
      consent_record.id,
      case when decision_granted then 'granted' else 'declined' end,
      case when decision_granted then decision_contact_value else null end,
      'client_creation',
      (select auth.uid()),
      jsonb_build_object('form', 'crm_client_creation_v2')
    )
    returning inserted_consent_events || jsonb_build_array(to_jsonb(crm_client_consent_events.*))
    into inserted_consent_events;
  end loop;

  insert into public.crm_activities (
    organization_id,
    actor_user_id,
    client_id,
    activity_type,
    title,
    body,
    payload
  ) values (
    p_organization_id,
    (select auth.uid()),
    inserted_client.id,
    'client_created',
    'Dodano klienta',
    inserted_client.display_name,
    jsonb_build_object(
      'owner_user_id', inserted_client.owner_user_id,
      'consent_events_recorded', jsonb_array_length(inserted_consent_events),
      'consents_granted', (
        select count(*)
        from jsonb_array_elements(inserted_consent_events) event
        where event ->> 'decision' = 'granted'
      )
    )
  );

  return jsonb_build_object(
    'data', to_jsonb(inserted_client),
    'people', jsonb_build_array(to_jsonb(inserted_person)),
    'consents', inserted_consent_events
  );
end;
$$;
