-- Make client identity lookup insensitive to phone and PESEL formatting.
-- The original, human-readable values remain in the projection while their
-- digit-only variants support queries such as 48123456789 for +48 123 456 789.

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
      || setweight(to_tsvector('simple', private.crm_search_normalize(people.people_text)), 'B')
      || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
        ' ', client.lead_source, client.notes
      ))), 'C')
  from public.crm_clients client
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

  new.search_text := private.crm_search_normalize(concat_ws(
    ' ',
    new.display_name,
    new.primary_email,
    new.primary_phone,
    primary_phone_digits,
    new.lead_source,
    new.notes,
    array_to_string(new.tags, ' '),
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
    || setweight(to_tsvector('simple', private.crm_search_normalize(people_text)), 'B')
    || setweight(to_tsvector('simple', private.crm_search_normalize(concat_ws(
      ' ', new.lead_source, new.notes
    ))), 'C');

  return new;
end;
$$;

-- The immediately following relevance migration installs the final projection
-- and performs one consolidated backfill. Avoid taking a second full-table lock
-- for this short-lived intermediate projection.

revoke all on function private.crm_client_search_projection(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.set_crm_client_search_projection()
  from public, anon, authenticated, service_role;

comment on function private.crm_client_search_projection(uuid, uuid) is
  'Builds client search text with readable and digit-normalized identity values.';
