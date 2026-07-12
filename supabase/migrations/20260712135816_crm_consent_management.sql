-- Versioned consent definitions and append-only client decisions.
-- Legal text is never updated in place: every panel save creates a new
-- immutable version and moves the definition's current-version pointer.

create table public.crm_consent_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9]+(_[a-z0-9]+)*$'),
  context text not null default 'client_creation'
    check (context in ('client_creation')),
  current_version_id uuid not null,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_consent_definitions_organization_id_id_key
    unique (organization_id, id),
  constraint crm_consent_definitions_organization_code_key
    unique (organization_id, code),
  constraint crm_consent_definitions_created_by_fkey
    foreign key (organization_id, created_by_user_id)
    references public.organization_memberships(organization_id, user_id),
  constraint crm_consent_definitions_updated_by_fkey
    foreign key (organization_id, updated_by_user_id)
    references public.organization_memberships(organization_id, user_id)
);

create table public.crm_consent_definition_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  definition_id uuid not null,
  version integer not null check (version > 0),
  internal_name text not null check (btrim(internal_name) <> ''),
  display_title text not null check (btrim(display_title) <> ''),
  content text not null check (btrim(content) <> ''),
  purpose text not null check (btrim(purpose) <> ''),
  channel text not null check (channel in ('email', 'sms', 'phone', 'messaging', 'other')),
  legal_basis text not null check (btrim(legal_basis) <> ''),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  language_code text not null default 'pl'
    check (language_code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  change_note text,
  content_sha256 text generated always as (
    encode(extensions.digest(
      display_title || chr(31) || content || chr(31) || purpose || chr(31)
      || channel || chr(31) || legal_basis || chr(31) || language_code,
      'sha256'
    ), 'hex')
  ) stored,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  constraint crm_consent_versions_effective_range_check
    check (effective_to is null or effective_to > effective_from),
  constraint crm_consent_versions_definition_version_key
    unique (definition_id, version),
  constraint crm_consent_versions_organization_definition_id_key
    unique (organization_id, definition_id, id),
  constraint crm_consent_versions_definition_fkey
    foreign key (organization_id, definition_id)
    references public.crm_consent_definitions(organization_id, id),
  constraint crm_consent_versions_created_by_fkey
    foreign key (organization_id, created_by_user_id)
    references public.organization_memberships(organization_id, user_id)
);

alter table public.crm_consent_definitions
  add constraint crm_consent_definitions_current_version_fkey
  foreign key (organization_id, id, current_version_id)
  references public.crm_consent_definition_versions(organization_id, definition_id, id)
  deferrable initially deferred;

create table public.crm_client_consent_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  subject_person_id uuid not null,
  definition_id uuid not null,
  definition_version_id uuid not null,
  decision text not null check (decision in ('granted', 'declined', 'withdrawn')),
  contact_value text,
  source text not null check (source in ('client_creation', 'client_card', 'import', 'api')),
  occurred_at timestamptz not null default now(),
  recorded_by_user_id uuid not null,
  evidence_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint crm_client_consent_events_client_fkey
    foreign key (organization_id, client_id)
    references public.crm_clients(organization_id, id),
  constraint crm_client_consent_events_person_fkey
    foreign key (organization_id, subject_person_id)
    references public.crm_client_people(organization_id, id),
  constraint crm_client_consent_events_definition_fkey
    foreign key (organization_id, definition_id)
    references public.crm_consent_definitions(organization_id, id),
  constraint crm_client_consent_events_version_fkey
    foreign key (organization_id, definition_id, definition_version_id)
    references public.crm_consent_definition_versions(organization_id, definition_id, id),
  constraint crm_client_consent_events_recorded_by_fkey
    foreign key (organization_id, recorded_by_user_id)
    references public.organization_memberships(organization_id, user_id)
);

create index crm_consent_definitions_organization_context_idx
  on public.crm_consent_definitions(organization_id, context, code);

create index crm_consent_versions_definition_history_idx
  on public.crm_consent_definition_versions(organization_id, definition_id, version desc);

create index crm_client_consent_events_current_idx
  on public.crm_client_consent_events(
    organization_id,
    subject_person_id,
    definition_id,
    occurred_at desc,
    id desc
  );

create index crm_client_consent_events_client_idx
  on public.crm_client_consent_events(organization_id, client_id, occurred_at desc);

create trigger crm_consent_definitions_set_updated_at
  before update on public.crm_consent_definitions
  for each row execute function public.set_updated_at();

alter table public.crm_consent_definitions enable row level security;
alter table public.crm_consent_definition_versions enable row level security;
alter table public.crm_client_consent_events enable row level security;

create policy crm_consent_definitions_member_read
  on public.crm_consent_definitions
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy crm_consent_definitions_admin_insert
  on public.crm_consent_definitions
  for insert to authenticated
  with check (private.is_organization_admin(organization_id));

create policy crm_consent_definitions_admin_update
  on public.crm_consent_definitions
  for update to authenticated
  using (private.is_organization_admin(organization_id))
  with check (private.is_organization_admin(organization_id));

create policy crm_consent_versions_member_read
  on public.crm_consent_definition_versions
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy crm_consent_versions_admin_insert
  on public.crm_consent_definition_versions
  for insert to authenticated
  with check (private.is_organization_admin(organization_id));

create policy crm_client_consent_events_member_read
  on public.crm_client_consent_events
  for select to authenticated
  using (private.is_organization_member(organization_id));

create policy crm_client_consent_events_member_insert
  on public.crm_client_consent_events
  for insert to authenticated
  with check (
    private.is_organization_member(organization_id)
    and recorded_by_user_id = (select auth.uid())
  );

revoke all on table
  public.crm_consent_definitions,
  public.crm_consent_definition_versions,
  public.crm_client_consent_events
from anon, authenticated;

grant select, insert on public.crm_consent_definitions to authenticated;
grant update (current_version_id, updated_by_user_id) on public.crm_consent_definitions to authenticated;
grant select, insert on public.crm_consent_definition_versions to authenticated;
grant select, insert on public.crm_client_consent_events to authenticated;

grant all privileges on table
  public.crm_consent_definitions,
  public.crm_consent_definition_versions,
  public.crm_client_consent_events
to service_role;

create or replace function public.create_crm_consent_definition(
  p_organization_id uuid,
  p_code text,
  p_internal_name text,
  p_display_title text,
  p_content text,
  p_purpose text,
  p_channel text,
  p_legal_basis text,
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

create or replace function public.update_crm_consent_definition(
  p_definition_id uuid,
  p_organization_id uuid,
  p_internal_name text,
  p_display_title text,
  p_content text,
  p_purpose text,
  p_channel text,
  p_legal_basis text,
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
  uuid, text, text, text, text, text, text, text, text, integer, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.create_crm_consent_definition(
  uuid, text, text, text, text, text, text, text, text, integer, text, timestamptz, timestamptz, text
) to authenticated;

revoke all on function public.update_crm_consent_definition(
  uuid, uuid, text, text, text, text, text, text, text, integer, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.update_crm_consent_definition(
  uuid, uuid, text, text, text, text, text, text, text, integer, text, timestamptz, timestamptz, text
) to authenticated;

create or replace function private.provision_default_crm_consents(
  target_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  organization_name text;
  seed_record record;
  new_definition_id uuid;
  new_version_id uuid;
begin
  select organization.name
  into organization_name
  from public.organizations organization
  where organization.id = target_organization_id;

  if organization_name is null then
    return;
  end if;

  for seed_record in
    select *
    from (values
      (
        'marketing_email',
        'Marketing bezpośredni — e-mail',
        'Marketing e-mail',
        'Zgadzam się na przesyłanie przez ' || organization_name
          || ' informacji handlowych, w tym marketingu bezpośredniego dotyczącego produktów i usług oferowanych przez '
          || organization_name
          || ', na podany adres e-mail, zgodnie z art. 398 ustawy – Prawo komunikacji elektronicznej. Zgoda jest dobrowolna i mogę ją w każdej chwili wycofać.',
        'Przesyłanie informacji handlowych i marketingu bezpośredniego produktów i usług oferowanych przez ' || organization_name || '.',
        'email',
        10
      ),
      (
        'marketing_sms',
        'Marketing bezpośredni — SMS/MMS',
        'Marketing SMS/MMS',
        'Zgadzam się na przesyłanie przez ' || organization_name
          || ' informacji handlowych, w tym marketingu bezpośredniego dotyczącego produktów i usług oferowanych przez '
          || organization_name
          || ', na podany numer telefonu za pomocą wiadomości SMS/MMS, zgodnie z art. 398 ustawy – Prawo komunikacji elektronicznej. Zgoda jest dobrowolna i mogę ją w każdej chwili wycofać.',
        'Przesyłanie informacji handlowych i marketingu bezpośredniego produktów i usług oferowanych przez ' || organization_name || ' przez SMS/MMS.',
        'sms',
        20
      ),
      (
        'marketing_phone',
        'Marketing bezpośredni — telefon',
        'Marketing telefoniczny',
        'Zgadzam się na używanie przez ' || organization_name
          || ' podanego numeru telefonu do połączeń głosowych w celu przekazywania informacji handlowych i marketingu bezpośredniego dotyczącego produktów i usług oferowanych przez '
          || organization_name
          || ', zgodnie z art. 398 ustawy – Prawo komunikacji elektronicznej. Zgoda jest dobrowolna i mogę ją w każdej chwili wycofać.',
        'Prowadzenie marketingu bezpośredniego produktów i usług oferowanych przez ' || organization_name || ' podczas połączeń głosowych.',
        'phone',
        30
      )
    ) as seeds(code, internal_name, display_title, content, purpose, channel, sort_order)
  loop
    if not exists (
      select 1
      from public.crm_consent_definitions definition
      where definition.organization_id = target_organization_id
        and definition.code = seed_record.code
    ) then
      new_definition_id := gen_random_uuid();
      new_version_id := gen_random_uuid();

      insert into public.crm_consent_definitions (
        id,
        organization_id,
        code,
        context,
        current_version_id
      ) values (
        new_definition_id,
        target_organization_id,
        seed_record.code,
        'client_creation',
        new_version_id
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
        status,
        sort_order,
        language_code,
        change_note
      ) values (
        new_version_id,
        target_organization_id,
        new_definition_id,
        1,
        seed_record.internal_name,
        seed_record.display_title,
        seed_record.content,
        seed_record.purpose,
        seed_record.channel,
        'art. 398 PKE w zw. z art. 6 ust. 1 lit. a RODO',
        'published',
        seed_record.sort_order,
        'pl',
        'Podstawowy zestaw startowy — treść wymaga zatwierdzenia przez prawników lub IOD przed użyciem produkcyjnym.'
      );
    end if;
  end loop;
end;
$$;

create or replace function private.provision_default_crm_consents_on_organization_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.provision_default_crm_consents(new.id);
  return new;
end;
$$;

revoke all on function private.provision_default_crm_consents(uuid)
  from public, anon, authenticated;
revoke all on function private.provision_default_crm_consents_on_organization_insert()
  from public, anon, authenticated;

create trigger organizations_provision_default_crm_consents
  after insert on public.organizations
  for each row execute function private.provision_default_crm_consents_on_organization_insert();

select private.provision_default_crm_consents(organization.id)
from public.organizations organization;

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
begin
  if not private.is_organization_member(p_organization_id) then
    raise exception 'organization_membership_required' using errcode = '42501';
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
    group by decision ->> 'definition_id'
    having count(*) > 1
  ) then
    raise exception 'duplicate_consent_decision' using errcode = '23514';
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
        and definition.id = (decision ->> 'definition_id')::uuid
        and consent_version.id = (decision ->> 'version_id')::uuid
        and consent_version.status = 'published'
        and consent_version.effective_from <= now()
        and (consent_version.effective_to is null or consent_version.effective_to > now())
    )
  ) then
    raise exception 'consent_definition_is_stale' using errcode = '23514';
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
    coalesce(p_owner_user_id, (select auth.uid())),
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

    decision_granted := coalesce((supplied_decision ->> 'granted')::boolean, false);
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
      jsonb_build_object('form', 'crm_client_creation_v1')
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

revoke all on function public.create_crm_client_with_consents(
  uuid, uuid, text, text, text, text, text, text[], text, jsonb, jsonb, jsonb
) from public, anon;
grant execute on function public.create_crm_client_with_consents(
  uuid, uuid, text, text, text, text, text, text[], text, jsonb, jsonb, jsonb
) to authenticated;
