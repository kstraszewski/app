-- Make CRM search behave like a single, forgiving search box:
-- * include company identifiers and every client contact,
-- * project client identity, case details, products and properties into cases,
-- * keep ranked client search in Postgres instead of sorting a page in the UI.

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
      client.primary_phone_normalized,
      client.lead_source,
      client.notes,
      array_to_string(client.tags, ' '),
      identifiers.identifiers_text,
      people.people_text
    )),
    setweight(to_tsvector('simple', private.crm_search_normalize(client.display_name)), 'A')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ',
        client.primary_email,
        client.primary_phone,
        client.primary_phone_normalized,
        array_to_string(client.tags, ' ')
      ))), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(identifiers.identifiers_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(people.people_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ', client.lead_source, client.notes
      ))), 'C')
  from public.crm_clients client
  left join lateral (
    select concat_ws(
      ' ',
      client.metadata ->> 'tax_id',
      client.metadata ->> 'nip',
      client.metadata ->> 'regon',
      client.metadata ->> 'krs',
      client.metadata ->> 'registry_number',
      nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
    ) as identifiers_text
  ) identifiers on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      person.display_name,
      person.first_name,
      person.last_name,
      person.email,
      person.phone,
      person.phone_normalized,
      person.pesel,
      nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
    ), ' ' order by person.created_at, person.id) as people_text
    from public.crm_client_people person
    where person.organization_id = client.organization_id
      and person.client_id = client.id
  ) people on true
  where client.organization_id = target_organization_id
    and client.id = target_client_id;
$$;

create or replace function private.set_crm_client_search_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  people_text text;
  identifiers_text text;
  primary_phone_digits text;
begin
  select string_agg(concat_ws(
    ' ',
    person.display_name,
    person.first_name,
    person.last_name,
    person.email,
    person.phone,
    person.phone_normalized,
    person.pesel,
    nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
  ), ' ' order by person.created_at, person.id)
  into people_text
  from public.crm_client_people person
  where person.organization_id = new.organization_id
    and person.client_id = new.id;

  primary_phone_digits := nullif(
    regexp_replace(coalesce(new.primary_phone, ''), '[^0-9]+', '', 'g'),
    ''
  );
  identifiers_text := concat_ws(
    ' ',
    new.metadata ->> 'tax_id',
    new.metadata ->> 'nip',
    new.metadata ->> 'regon',
    new.metadata ->> 'krs',
    new.metadata ->> 'registry_number',
    nullif(regexp_replace(coalesce(new.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
    nullif(regexp_replace(coalesce(new.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
  );

  new.search_text := private.crm_search_normalize(concat_ws(
    ' ',
    new.display_name,
    new.primary_email,
    new.primary_phone,
    primary_phone_digits,
    new.lead_source,
    new.notes,
    array_to_string(new.tags, ' '),
    identifiers_text,
    people_text
  ));
  new.search_vector :=
    setweight(to_tsvector('simple', private.crm_search_normalize(new.display_name)), 'A')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ',
      new.primary_email,
      new.primary_phone,
      primary_phone_digits,
      array_to_string(new.tags, ' ')
    ))), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(identifiers_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(people_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ', new.lead_source, new.notes
    ))), 'C');

  return new;
end;
$$;

drop trigger if exists crm_clients_set_search_projection on public.crm_clients;
create trigger crm_clients_set_search_projection
  before insert or update of
    display_name, primary_email, primary_phone, lead_source, notes, tags, metadata
  on public.crm_clients
  for each row execute function private.set_crm_client_search_projection();

-- Backfill derived client data without changing business timestamps or
-- rebuilding the old case projection for every individual client.
alter table public.crm_clients disable trigger set_crm_clients_updated_at;
alter table public.crm_clients disable trigger crm_clients_refresh_case_search_projection;

update public.crm_clients client
set (search_text, search_vector) = (
  select projection.search_text, projection.search_vector
  from private.crm_client_search_projection(client.organization_id, client.id) projection
);

alter table public.crm_clients enable trigger crm_clients_refresh_case_search_projection;
alter table public.crm_clients enable trigger set_crm_clients_updated_at;

create or replace function private.crm_case_search_projection(
  target_organization_id uuid,
  target_case_id uuid
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
      crm_case.title,
      crm_case.description,
      crm_case.status_code,
      clients.clients_text,
      items.items_text,
      properties.properties_text,
      offers.offers_text
    )),
    setweight(
      to_tsvector('simple', private.crm_search_normalize(crm_case.title)),
      'A'
    )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(clients.clients_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(items.items_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(properties.properties_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(offers.offers_text)),
        'B'
      )
      || setweight(
        to_tsvector('simple', private.crm_search_normalize(concat_ws(
          ' ', crm_case.description, crm_case.status_code
        ))),
        'C'
      )
  from public.crm_cases crm_case
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      client.display_name,
      client.primary_email,
      client.primary_phone,
      client.primary_phone_normalized,
      nullif(regexp_replace(coalesce(client.primary_phone, ''), '[^0-9]+', '', 'g'), ''),
      client.metadata ->> 'tax_id',
      client.metadata ->> 'nip',
      client.metadata ->> 'regon',
      client.metadata ->> 'krs',
      client.metadata ->> 'registry_number',
      nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
      nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), ''),
      (
        select string_agg(concat_ws(
          ' ',
          person.display_name,
          person.first_name,
          person.last_name,
          person.email,
          person.phone,
          person.phone_normalized,
          nullif(regexp_replace(coalesce(person.phone, ''), '[^0-9]+', '', 'g'), ''),
          person.pesel,
          nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
        ), ' ' order by person.created_at, person.id)
        from public.crm_client_people person
        where person.organization_id = client.organization_id
          and person.client_id = client.id
      )
    ), ' ' order by case_client.is_primary desc, client.display_name, client.id) as clients_text
    from public.crm_case_clients case_client
    join public.crm_clients client
      on client.organization_id = case_client.organization_id
     and client.id = case_client.client_id
    where case_client.organization_id = crm_case.organization_id
      and case_client.case_id = crm_case.id
  ) clients on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      item.title,
      item.status_code,
      product_type.name,
      product_type.code,
      product_type.domain
    ), ' ' order by item.created_at, item.id) as items_text
    from public.crm_case_items item
    join public.crm_product_types product_type
      on product_type.id = item.product_type_id
    where item.organization_id = crm_case.organization_id
      and item.case_id = crm_case.id
  ) items on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      property.listing_title,
      property.address,
      property.city,
      property.postal_code,
      property.property_type,
      property.market_type,
      property.description
    ), ' ' order by property.created_at, property.id) as properties_text
    from public.crm_properties property
    left join public.crm_case_items property_item
      on property_item.organization_id = property.organization_id
     and property_item.id = property.case_item_id
    where property.organization_id = crm_case.organization_id
      and coalesce(property.case_id, property_item.case_id) = crm_case.id
  ) properties on true
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      snapshot.bank_name,
      snapshot.product_name,
      snapshot.version_key,
      snapshot.catalog_snapshot -> 'version' ->> 'reference_rate_code'
    ), ' ' order by snapshot.saved_at, snapshot.id) as offers_text
    from public.crm_case_offer_snapshots snapshot
    where snapshot.organization_id = crm_case.organization_id
      and snapshot.case_id = crm_case.id
  ) offers on true
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id;
$$;

create or replace function private.refresh_crm_case_search_from_property()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_case_id uuid;
  new_case_id uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_case_id := old.case_id;
    if old_case_id is null and old.case_item_id is not null then
      select item.case_id
      into old_case_id
      from public.crm_case_items item
      where item.organization_id = old.organization_id
        and item.id = old.case_item_id;
    end if;
    if old_case_id is not null then
      perform private.refresh_crm_case_search_projection(old.organization_id, old_case_id);
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    new_case_id := new.case_id;
    if new_case_id is null and new.case_item_id is not null then
      select item.case_id
      into new_case_id
      from public.crm_case_items item
      where item.organization_id = new.organization_id
        and item.id = new.case_item_id;
    end if;
    if new_case_id is not null
       and (
         tg_op = 'INSERT'
         or (new.organization_id, new_case_id)
           is distinct from (old.organization_id, old_case_id)
       ) then
      perform private.refresh_crm_case_search_projection(new.organization_id, new_case_id);
    elsif tg_op = 'UPDATE' and new_case_id is not null then
      perform private.refresh_crm_case_search_projection(new.organization_id, new_case_id);
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.refresh_crm_case_search_from_product_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
begin
  for target in
    select distinct item.organization_id, item.case_id
    from public.crm_case_items item
    where item.product_type_id = new.id
  loop
    perform private.refresh_crm_case_search_projection(
      target.organization_id,
      target.case_id
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists crm_cases_refresh_search_projection on public.crm_cases;
create trigger crm_cases_refresh_search_projection
  after insert or update of title, description, status_code
  on public.crm_cases
  for each row execute function private.refresh_crm_case_search_from_case();

drop trigger if exists crm_case_items_refresh_case_search_projection on public.crm_case_items;
create trigger crm_case_items_refresh_case_search_projection
  after insert or update of case_id, product_type_id, title, status_code or delete
  on public.crm_case_items
  for each row execute function private.refresh_crm_case_search_from_relation();

drop trigger if exists crm_properties_refresh_case_search_projection on public.crm_properties;
create trigger crm_properties_refresh_case_search_projection
  after insert or update of
    case_id, case_item_id, listing_title, address, city, postal_code,
    property_type, market_type, description
    or delete
  on public.crm_properties
  for each row execute function private.refresh_crm_case_search_from_property();

drop trigger if exists crm_product_types_refresh_case_search_projection
  on public.crm_product_types;
create trigger crm_product_types_refresh_case_search_projection
  after update of name, code, domain
  on public.crm_product_types
  for each row execute function private.refresh_crm_case_search_from_product_type();

alter table public.crm_cases disable trigger set_crm_cases_updated_at;

update public.crm_cases crm_case
set (search_text, search_vector) = (
  select projection.search_text, projection.search_vector
  from private.crm_case_search_projection(crm_case.organization_id, crm_case.id) projection
);

alter table public.crm_cases enable trigger set_crm_cases_updated_at;

-- Ranked search is a separate RPC so the mature filter/facet RPC remains
-- backward compatible. The server chooses this function only for text searches.
create or replace function public.search_crm_clients_ranked(
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
  target_limit integer;
  target_offset integer;
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
  if search_term is null then
    raise exception 'client_search_query_is_required' using errcode = '22023';
  end if;
  if length(search_term) > 200 then
    raise exception 'client_search_query_is_too_long' using errcode = '22023';
  end if;
  if search_term ~ '^[+0-9[:space:]()./-]+$'
     and length(regexp_replace(search_term, '[^0-9]+', '', 'g')) >= 3 then
    search_term := regexp_replace(search_term, '[^0-9]+', '', 'g');
  end if;
  search_term := lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    search_term
  ));
  search_query := websearch_to_tsquery('simple', search_term);

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

  target_limit := least(greatest(coalesce((filters ->> 'limit')::integer, 50), 1), 100);
  target_offset := coalesce((filters ->> 'offset')::integer, 0);
  if target_offset < 0 or target_offset > 100000 then
    raise exception 'client_offset_is_invalid' using errcode = '22023';
  end if;

  with filtered as materialized (
    select
      client.id,
      client.display_name,
      client.created_at,
      client.updated_at,
      (
        case
          when lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            client.display_name
          )) = search_term then 4
          when lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            client.display_name
          )) like search_term || '%' then 2
          else 0
        end
        + ts_rank_cd(client.search_vector, search_query, 32) * 3
        + extensions.similarity(
          lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            client.display_name
          )),
          search_term
        )
        + extensions.similarity(client.search_text, search_term) * 0.15
      )::real as relevance,
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
        'primaryPerson', primary_person.person_json,
        'matchedPerson', matched_person.person_json
      ) as row_json
    from public.crm_clients client
    left join public.users owner on owner.id = client.owner_user_id
    left join lateral (
      select jsonb_build_object(
        'id', person.id,
        'display_name', person.display_name,
        'first_name', person.first_name,
        'last_name', person.last_name,
        'email', person.email,
        'phone', person.phone,
        'pesel_last4', nullif(right(
          regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'),
          4
        ), '')
      ) as person_json
      from public.crm_client_people person
      where person.organization_id = client.organization_id
        and person.client_id = client.id
      order by (person.role = 'primary') desc, person.created_at, person.id
      limit 1
    ) primary_person on true
    left join lateral (
      select jsonb_build_object(
        'id', person.id,
        'display_name', person.display_name,
        'first_name', person.first_name,
        'last_name', person.last_name,
        'email', person.email,
        'phone', person.phone,
        'pesel_last4', nullif(right(
          regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'),
          4
        ), '')
      ) as person_json
      from public.crm_client_people person
      where person.organization_id = client.organization_id
        and person.client_id = client.id
        and (
          lower(extensions.unaccent(
            'extensions.unaccent'::regdictionary,
            concat_ws(
              ' ',
              person.display_name,
              person.first_name,
              person.last_name,
              person.email,
              person.phone,
              person.phone_normalized,
              person.pesel,
              nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
            )
          )) ilike '%' || search_term || '%'
          or to_tsvector(
            'simple',
            lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                person.display_name,
                person.first_name,
                person.last_name,
                person.email,
                person.phone,
                person.phone_normalized,
                person.pesel
              )
            ))
          ) @@ search_query
        )
      order by (person.role = 'primary') desc, person.created_at, person.id
      limit 1
    ) matched_person on true
    where client.organization_id = p_organization_id
      and (
        client.search_vector @@ search_query
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
  page_rows as materialized (
    select filtered.*
    from filtered
    order by relevance desc, updated_at desc, id
    limit target_limit
    offset target_offset
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(page_rows.row_json order by
        page_rows.relevance desc,
        page_rows.updated_at desc,
        page_rows.id
      )
      from page_rows
    ), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'pageInfo', jsonb_build_object(
      'hasMore', target_offset + target_limit < (select count(*) from filtered),
      'nextCursor', null,
      'offset', target_offset,
      'limit', target_limit
    ),
    'facets', null
  )
  into result;

  return result;
end;
$$;

-- Add an explainable match to case rows without returning sensitive values.
-- The base RPC keeps ownership of filters, ranking, facets and tenant checks.
create or replace function public.search_crm_cases_with_context(
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
  result jsonb;
begin
  search_term := nullif(btrim(filters ->> 'q'), '');
  if search_term is not null
     and search_term ~ '^[+0-9[:space:]()./-]+$'
     and length(regexp_replace(search_term, '[^0-9]+', '', 'g')) >= 3 then
    search_term := regexp_replace(search_term, '[^0-9]+', '', 'g');
    filters := jsonb_set(filters, '{q}', to_jsonb(search_term));
  end if;

  result := public.search_crm_cases(p_organization_id, filters);
  if search_term is null then
    return result;
  end if;

  search_term := lower(extensions.unaccent(
    'extensions.unaccent'::regdictionary,
    search_term
  ));
  search_query := websearch_to_tsquery('simple', search_term);

  return jsonb_set(
    result,
    '{data}',
    coalesce((
      select jsonb_agg(
        rows.case_row || jsonb_build_object('match_context', context.match_context)
        order by rows.position
      )
      from jsonb_array_elements(coalesce(result -> 'data', '[]'::jsonb))
        with ordinality as rows(case_row, position)
      left join lateral (
        select jsonb_build_object(
          'type', candidate.match_type,
          'label', candidate.label
        ) as match_context
        from (
          select
            1 as priority,
            'person'::text as match_type,
            person.display_name as label
          from public.crm_case_clients case_client
          join public.crm_client_people person
            on person.organization_id = case_client.organization_id
           and person.client_id = case_client.client_id
          where case_client.organization_id = p_organization_id
            and case_client.case_id = (rows.case_row ->> 'id')::uuid
            and (
              lower(extensions.unaccent(
                'extensions.unaccent'::regdictionary,
                concat_ws(
                  ' ',
                  person.display_name,
                  person.first_name,
                  person.last_name,
                  person.email,
                  person.phone,
                  person.phone_normalized,
                  nullif(regexp_replace(coalesce(person.phone, ''), '[^0-9]+', '', 'g'), ''),
                  person.pesel,
                  nullif(regexp_replace(coalesce(person.pesel, ''), '[^0-9]+', '', 'g'), '')
                )
              )) ilike '%' || search_term || '%'
              or to_tsvector(
                'simple',
                lower(extensions.unaccent(
                  'extensions.unaccent'::regdictionary,
                  concat_ws(
                    ' ',
                    person.display_name,
                    person.first_name,
                    person.last_name,
                    person.email,
                    person.phone,
                    person.phone_normalized,
                    person.pesel
                  )
                ))
              ) @@ search_query
            )

          union all

          select
            2,
            'client'::text,
            client.display_name
          from public.crm_case_clients case_client
          join public.crm_clients client
            on client.organization_id = case_client.organization_id
           and client.id = case_client.client_id
          where case_client.organization_id = p_organization_id
            and case_client.case_id = (rows.case_row ->> 'id')::uuid
            and lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                client.display_name,
                client.primary_email,
                client.primary_phone,
                client.primary_phone_normalized,
                nullif(regexp_replace(coalesce(client.primary_phone, ''), '[^0-9]+', '', 'g'), ''),
                client.metadata ->> 'tax_id',
                client.metadata ->> 'nip',
                client.metadata ->> 'regon',
                client.metadata ->> 'krs',
                client.metadata ->> 'registry_number',
                nullif(regexp_replace(coalesce(client.metadata ->> 'tax_id', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'nip', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'regon', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'krs', ''), '[^0-9]+', '', 'g'), ''),
                nullif(regexp_replace(coalesce(client.metadata ->> 'registry_number', ''), '[^0-9]+', '', 'g'), '')
              )
            )) ilike '%' || search_term || '%'

          union all

          select
            3,
            'product'::text,
            coalesce(nullif(item.title, ''), product_type.name)
          from public.crm_case_items item
          join public.crm_product_types product_type
            on product_type.id = item.product_type_id
          where item.organization_id = p_organization_id
            and item.case_id = (rows.case_row ->> 'id')::uuid
            and lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                item.title,
                item.status_code,
                product_type.name,
                product_type.code,
                product_type.domain
              )
            )) ilike '%' || search_term || '%'

          union all

          select
            4,
            'property'::text,
            coalesce(
              nullif(property.listing_title, ''),
              nullif(property.address, ''),
              property.city
            )
          from public.crm_properties property
          left join public.crm_case_items property_item
            on property_item.organization_id = property.organization_id
           and property_item.id = property.case_item_id
          where property.organization_id = p_organization_id
            and coalesce(property.case_id, property_item.case_id)
              = (rows.case_row ->> 'id')::uuid
            and lower(extensions.unaccent(
              'extensions.unaccent'::regdictionary,
              concat_ws(
                ' ',
                property.listing_title,
                property.address,
                property.city,
                property.postal_code,
                property.property_type,
                property.market_type,
                property.description
              )
            )) ilike '%' || search_term || '%'
        ) candidate
        where candidate.label is not null
        order by candidate.priority, candidate.label
        limit 1
      ) context on true
    ), '[]'::jsonb),
    true
  );
end;
$$;

revoke all on function private.crm_client_search_projection(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.set_crm_client_search_projection()
  from public, anon, authenticated, service_role;
revoke all on function private.crm_case_search_projection(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_crm_case_search_from_property()
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_crm_case_search_from_product_type()
  from public, anon, authenticated, service_role;

revoke all on function public.search_crm_clients_ranked(uuid, jsonb)
  from public, anon;
grant execute on function public.search_crm_clients_ranked(uuid, jsonb)
  to authenticated, service_role;

revoke all on function public.search_crm_cases_with_context(uuid, jsonb)
  from public, anon;
grant execute on function public.search_crm_cases_with_context(uuid, jsonb)
  to authenticated, service_role;

comment on function public.search_crm_clients_ranked(uuid, jsonb) is
  'Tenant-scoped ranked CRM client search used for user-entered text queries.';
comment on function public.search_crm_cases_with_context(uuid, jsonb) is
  'Tenant-scoped CRM case search that adds a non-sensitive explanation of the matched relation.';
