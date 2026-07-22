-- A CRM case is a lightweight folder: a name, one or more clients and
-- immutable offer snapshots. The legacy crm_cases.client_id remains the
-- compatibility "primary client" until older dashboard/MCP consumers migrate.

create table public.crm_case_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  client_id uuid not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_case_clients_organization_case_fkey
    foreign key (organization_id, case_id)
    references public.crm_cases(organization_id, id) on delete cascade,
  constraint crm_case_clients_organization_client_fkey
    foreign key (organization_id, client_id)
    references public.crm_clients(organization_id, id) on delete cascade,
  constraint crm_case_clients_case_client_key unique (case_id, client_id)
);

create unique index crm_case_clients_one_primary_idx
  on public.crm_case_clients(case_id)
  where is_primary;
create index crm_case_clients_organization_case_idx
  on public.crm_case_clients(organization_id, case_id, client_id);
create index crm_case_clients_organization_client_idx
  on public.crm_case_clients(organization_id, client_id, case_id);

create trigger set_crm_case_clients_updated_at
  before update on public.crm_case_clients
  for each row execute function public.set_updated_at();

insert into public.crm_case_clients (
  organization_id,
  case_id,
  client_id,
  is_primary
)
select
  crm_case.organization_id,
  crm_case.id,
  crm_case.client_id,
  true
from public.crm_cases crm_case
on conflict (case_id, client_id) do update
set is_primary = true;

create table public.crm_case_offer_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null,
  bank_id uuid references public.mortgage_banks(id) on delete set null,
  mortgage_product_id uuid references public.mortgage_products(id) on delete set null,
  mortgage_product_version_id uuid references public.mortgage_product_versions(id) on delete set null,
  saved_by_user_id uuid references public.users(id) on delete set null,
  offer_type text not null default 'mortgage' check (btrim(offer_type) <> ''),
  bank_name text not null check (btrim(bank_name) <> ''),
  product_name text not null check (btrim(product_name) <> ''),
  version_key text,
  calculator_version text not null,
  currency char(3) not null default 'PLN',
  loan_amount numeric(14, 2) check (loan_amount is null or loan_amount > 0),
  first_installment numeric(14, 2) check (first_installment is null or first_installment >= 0),
  first_monthly_outflow numeric(14, 2) check (first_monthly_outflow is null or first_monthly_outflow >= 0),
  cost_first_five_years numeric(14, 2) check (cost_first_five_years is null or cost_first_five_years >= 0),
  total_cost numeric(14, 2) check (total_cost is null or total_cost >= 0),
  representative_apr_pct numeric(8, 5) check (
    representative_apr_pct is null
    or representative_apr_pct between 0 and 100
  ),
  scenario_snapshot jsonb not null check (jsonb_typeof(scenario_snapshot) = 'object'),
  catalog_snapshot jsonb not null check (jsonb_typeof(catalog_snapshot) = 'object'),
  calculation_snapshot jsonb not null check (jsonb_typeof(calculation_snapshot) = 'object'),
  stress_snapshot jsonb check (
    stress_snapshot is null
    or jsonb_typeof(stress_snapshot) = 'object'
  ),
  saved_at timestamptz not null default now(),
  constraint crm_case_offer_snapshots_organization_case_fkey
    foreign key (organization_id, case_id)
    references public.crm_cases(organization_id, id) on delete cascade
);

create index crm_case_offer_snapshots_organization_case_idx
  on public.crm_case_offer_snapshots(organization_id, case_id, saved_at desc, id);
create index crm_case_offer_snapshots_organization_bank_idx
  on public.crm_case_offer_snapshots(organization_id, bank_id, case_id)
  where bank_id is not null;
create index crm_case_offer_snapshots_product_idx
  on public.crm_case_offer_snapshots(mortgage_product_id, mortgage_product_version_id)
  where mortgage_product_id is not null;

alter table public.crm_cases
  add column search_text text not null default '',
  add column search_vector tsvector not null default ''::tsvector;

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
      clients.clients_text,
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
        to_tsvector('simple', private.crm_search_normalize(offers.offers_text)),
        'B'
      )
  from public.crm_cases crm_case
  left join lateral (
    select string_agg(concat_ws(
      ' ',
      client.display_name,
      client.primary_email,
      client.primary_phone
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

create or replace function private.refresh_crm_case_search_projection(
  target_organization_id uuid,
  target_case_id uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.crm_cases crm_case
  set (search_text, search_vector) = (
    select projection.search_text, projection.search_vector
    from private.crm_case_search_projection(
      target_organization_id,
      target_case_id
    ) projection
  )
  where crm_case.organization_id = target_organization_id
    and crm_case.id = target_case_id;
$$;

create or replace function private.refresh_crm_case_search_from_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_crm_case_search_projection(new.organization_id, new.id);
  return new;
end;
$$;

create or replace function private.refresh_crm_case_search_from_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.refresh_crm_case_search_projection(old.organization_id, old.case_id);
  end if;

  if tg_op = 'INSERT'
     or (
       tg_op = 'UPDATE'
       and (new.organization_id, new.case_id)
         is distinct from (old.organization_id, old.case_id)
     ) then
    perform private.refresh_crm_case_search_projection(new.organization_id, new.case_id);
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.refresh_crm_case_search_from_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
begin
  for target in
    select distinct case_client.organization_id, case_client.case_id
    from public.crm_case_clients case_client
    where (
      tg_op in ('UPDATE', 'DELETE')
      and case_client.organization_id = old.organization_id
      and case_client.client_id = old.id
    ) or (
      tg_op in ('INSERT', 'UPDATE')
      and case_client.organization_id = new.organization_id
      and case_client.client_id = new.id
    )
  loop
    perform private.refresh_crm_case_search_projection(
      target.organization_id,
      target.case_id
    );
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger crm_cases_refresh_search_projection
  after insert or update of title on public.crm_cases
  for each row execute function private.refresh_crm_case_search_from_case();

create trigger crm_case_clients_refresh_case_search_projection
  after insert or update of client_id, is_primary or delete
  on public.crm_case_clients
  for each row execute function private.refresh_crm_case_search_from_relation();

create trigger crm_case_offers_refresh_case_search_projection
  after insert or delete on public.crm_case_offer_snapshots
  for each row execute function private.refresh_crm_case_search_from_relation();

create trigger crm_clients_refresh_case_search_projection
  after update of display_name, primary_email, primary_phone, search_text
  on public.crm_clients
  for each row execute function private.refresh_crm_case_search_from_client();

update public.crm_cases crm_case
set (search_text, search_vector) = (
  select projection.search_text, projection.search_vector
  from private.crm_case_search_projection(
    crm_case.organization_id,
    crm_case.id
  ) projection
);

create index crm_cases_search_vector_idx
  on public.crm_cases using gin (search_vector);
create index crm_cases_search_text_trgm_idx
  on public.crm_cases using gin (search_text extensions.gin_trgm_ops);
create index crm_cases_organization_created_idx
  on public.crm_cases(organization_id, created_at desc, id);
create index crm_cases_organization_title_idx
  on public.crm_cases(organization_id, lower(title), id);

alter table public.crm_case_clients enable row level security;
alter table public.crm_case_offer_snapshots enable row level security;

create policy crm_case_clients_member_read
  on public.crm_case_clients for select to authenticated
  using ((select private.is_organization_member(organization_id)));
create policy crm_case_clients_member_insert
  on public.crm_case_clients for insert to authenticated
  with check ((select private.is_organization_member(organization_id)));
create policy crm_case_clients_member_update
  on public.crm_case_clients for update to authenticated
  using ((select private.is_organization_member(organization_id)))
  with check ((select private.is_organization_member(organization_id)));
create policy crm_case_clients_member_delete
  on public.crm_case_clients for delete to authenticated
  using ((select private.is_organization_member(organization_id)));

create policy crm_case_offer_snapshots_member_read
  on public.crm_case_offer_snapshots for select to authenticated
  using ((select private.is_organization_member(organization_id)));
create policy crm_case_offer_snapshots_member_insert
  on public.crm_case_offer_snapshots for insert to authenticated
  with check ((select private.is_organization_member(organization_id)));
create policy crm_case_offer_snapshots_member_delete
  on public.crm_case_offer_snapshots for delete to authenticated
  using ((select private.is_organization_member(organization_id)));

revoke all on public.crm_case_clients from public, anon, authenticated;
revoke all on public.crm_case_offer_snapshots from public, anon, authenticated;
grant select, insert, update, delete on public.crm_case_clients to authenticated;
grant select, insert, delete on public.crm_case_offer_snapshots to authenticated;
grant all on public.crm_case_clients to service_role;
grant all on public.crm_case_offer_snapshots to service_role;

create function public.set_crm_case_clients(
  p_organization_id uuid,
  p_case_id uuid,
  p_client_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  client_ids uuid[];
  client_count integer;
  result jsonb;
begin
  if current_user <> 'service_role' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;

  select coalesce(array_agg(unique_client.client_id order by unique_client.first_position), '{}'::uuid[])
  into client_ids
  from (
    select input.client_id, min(input.position) as first_position
    from unnest(coalesce(p_client_ids, '{}'::uuid[]))
      with ordinality as input(client_id, position)
    group by input.client_id
  ) unique_client;

  if cardinality(client_ids) = 0 or cardinality(client_ids) > 100 then
    raise exception 'case_clients_must_contain_between_1_and_100_clients'
      using errcode = '22023';
  end if;

  perform 1
  from public.crm_cases crm_case
  where crm_case.organization_id = p_organization_id
    and crm_case.id = p_case_id;
  if not found then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;

  select count(*)
  into client_count
  from public.crm_clients client
  where client.organization_id = p_organization_id
    and client.id = any(client_ids);
  if client_count <> cardinality(client_ids) then
    raise exception 'case_client_not_found' using errcode = '23503';
  end if;

  update public.crm_case_clients case_client
  set is_primary = false
  where case_client.organization_id = p_organization_id
    and case_client.case_id = p_case_id
    and case_client.is_primary;

  delete from public.crm_case_clients case_client
  where case_client.organization_id = p_organization_id
    and case_client.case_id = p_case_id
    and not (case_client.client_id = any(client_ids));

  insert into public.crm_case_clients (
    organization_id,
    case_id,
    client_id,
    is_primary
  )
  select
    p_organization_id,
    p_case_id,
    input.client_id,
    input.position = 1
  from unnest(client_ids) with ordinality as input(client_id, position)
  on conflict (case_id, client_id) do update
  set is_primary = excluded.is_primary,
      updated_at = now();

  update public.crm_cases crm_case
  set client_id = client_ids[1]
  where crm_case.organization_id = p_organization_id
    and crm_case.id = p_case_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', client.id,
      'display_name', client.display_name,
      'primary_email', client.primary_email,
      'primary_phone', client.primary_phone,
      'is_primary', case_client.is_primary
    )
    order by case_client.is_primary desc, client.display_name, client.id
  ), '[]'::jsonb)
  into result
  from public.crm_case_clients case_client
  join public.crm_clients client
    on client.organization_id = case_client.organization_id
   and client.id = case_client.client_id
  where case_client.organization_id = p_organization_id
    and case_client.case_id = p_case_id;

  return result;
end;
$$;

create function public.create_crm_case_simple(
  p_organization_id uuid,
  p_title text,
  p_client_ids uuid[],
  p_owner_user_id uuid default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  normalized_title text := btrim(coalesce(p_title, ''));
  first_client_id uuid;
  inserted_case public.crm_cases;
begin
  if current_user <> 'service_role' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;

  if normalized_title = '' or length(normalized_title) > 200 then
    raise exception 'case_title_must_contain_between_1_and_200_characters'
      using errcode = '22023';
  end if;
  if cardinality(coalesce(p_client_ids, '{}'::uuid[])) = 0 then
    raise exception 'case_requires_at_least_one_client' using errcode = '22023';
  end if;

  first_client_id := p_client_ids[1];
  if not exists (
    select 1
    from public.crm_clients client
    where client.organization_id = p_organization_id
      and client.id = first_client_id
  ) then
    raise exception 'case_client_not_found' using errcode = '23503';
  end if;

  if p_owner_user_id is not null and not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_owner_user_id
  ) then
    raise exception 'case_owner_must_be_an_organization_member' using errcode = '23503';
  end if;

  insert into public.crm_cases (
    organization_id,
    client_id,
    owner_user_id,
    title
  ) values (
    p_organization_id,
    first_client_id,
    p_owner_user_id,
    normalized_title
  )
  returning * into inserted_case;

  perform public.set_crm_case_clients(
    p_organization_id,
    inserted_case.id,
    p_client_ids
  );

  return to_jsonb(inserted_case) - 'search_text' - 'search_vector';
end;
$$;

create function public.search_crm_cases(
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
  client_ids uuid[];
  client_match text;
  bank_ids uuid[];
  offer_mode text;
  created_from timestamptz;
  created_to timestamptz;
  updated_from timestamptz;
  updated_to timestamptz;
  target_sort text;
  target_limit integer;
  target_offset integer;
  include_facets boolean;
  result jsonb;
begin
  if jsonb_typeof(filters) <> 'object' then
    raise exception 'case_filters_must_be_an_object' using errcode = '22023';
  end if;
  if current_user <> 'service_role' then
    if not private.is_organization_member(p_organization_id) then
      raise exception 'organization_membership_required' using errcode = '42501';
    end if;
  end if;
  if jsonb_typeof(coalesce(filters -> 'clientIds', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(filters -> 'bankIds', '[]'::jsonb)) <> 'array' then
    raise exception 'case_filter_arrays_are_invalid' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(
      coalesce(filters -> 'clientIds', '[]'::jsonb)
      || coalesce(filters -> 'bankIds', '[]'::jsonb)
    ) value
    where value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'case_filter_ids_are_invalid' using errcode = '22023';
  end if;

  search_term := nullif(btrim(filters ->> 'q'), '');
  if length(coalesce(search_term, '')) > 200 then
    raise exception 'case_search_query_is_too_long' using errcode = '22023';
  end if;
  if search_term is not null then
    search_term := lower(extensions.unaccent(
      'extensions.unaccent'::regdictionary,
      search_term
    ));
    search_query := websearch_to_tsquery('simple', search_term);
  end if;

  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into client_ids
  from jsonb_array_elements_text(coalesce(filters -> 'clientIds', '[]'::jsonb)) value;
  select coalesce(array_agg(value::uuid), '{}'::uuid[])
  into bank_ids
  from jsonb_array_elements_text(coalesce(filters -> 'bankIds', '[]'::jsonb)) value;

  client_match := coalesce(nullif(filters ->> 'clientMatch', ''), 'any');
  if client_match not in ('any', 'all') then
    raise exception 'case_client_match_is_invalid' using errcode = '22023';
  end if;
  offer_mode := coalesce(nullif(filters ->> 'offerMode', ''), 'all');
  if offer_mode not in ('all', 'with', 'without') then
    raise exception 'case_offer_mode_is_invalid' using errcode = '22023';
  end if;

  created_from := nullif(filters ->> 'createdFrom', '')::timestamptz;
  created_to := nullif(filters ->> 'createdTo', '')::timestamptz;
  updated_from := nullif(filters ->> 'updatedFrom', '')::timestamptz;
  updated_to := nullif(filters ->> 'updatedTo', '')::timestamptz;

  target_sort := coalesce(
    nullif(filters ->> 'sort', ''),
    case when search_term is null then 'updated_desc' else 'relevance' end
  );
  if target_sort not in (
    'relevance', 'updated_desc', 'updated_asc', 'created_desc', 'created_asc',
    'title_asc', 'title_desc', 'offers_desc'
  ) then
    raise exception 'case_sort_is_invalid' using errcode = '22023';
  end if;

  target_limit := least(greatest(coalesce((filters ->> 'limit')::integer, 25), 1), 100);
  target_offset := coalesce((filters ->> 'offset')::integer, 0);
  if target_offset < 0 or target_offset > 100000 then
    raise exception 'case_offset_is_invalid' using errcode = '22023';
  end if;
  include_facets := coalesce((filters ->> 'includeFacets')::boolean, false);

  with filtered as materialized (
    select
      crm_case.id,
      crm_case.title,
      crm_case.created_at,
      crm_case.updated_at,
      coalesce(clients.clients_json, '[]'::jsonb) as clients_json,
      coalesce(offers.offer_count, 0) as offer_count,
      coalesce(offers.banks_json, '[]'::jsonb) as banks_json,
      case when search_term is null then 0::real else (
        ts_rank_cd(crm_case.search_vector, search_query, 32)
        + extensions.similarity(crm_case.search_text, search_term) * 0.2
      )::real end as relevance,
      jsonb_build_object(
        'id', crm_case.id,
        'title', crm_case.title,
        'created_at', crm_case.created_at,
        'updated_at', crm_case.updated_at,
        'clients', coalesce(clients.clients_json, '[]'::jsonb),
        'offer_count', coalesce(offers.offer_count, 0),
        'banks', coalesce(offers.banks_json, '[]'::jsonb)
      ) as row_json
    from public.crm_cases crm_case
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'id', client.id,
        'display_name', client.display_name,
        'primary_email', client.primary_email,
        'primary_phone', client.primary_phone,
        'is_primary', case_client.is_primary
      ) order by case_client.is_primary desc, client.display_name, client.id) as clients_json
      from public.crm_case_clients case_client
      join public.crm_clients client
        on client.organization_id = case_client.organization_id
       and client.id = case_client.client_id
      where case_client.organization_id = crm_case.organization_id
        and case_client.case_id = crm_case.id
    ) clients on true
    left join lateral (
      select
        count(*)::integer as offer_count,
        coalesce(jsonb_agg(distinct jsonb_build_object(
          'id', snapshot.bank_id,
          'name', snapshot.bank_name
        )), '[]'::jsonb) as banks_json
      from public.crm_case_offer_snapshots snapshot
      where snapshot.organization_id = crm_case.organization_id
        and snapshot.case_id = crm_case.id
    ) offers on true
    where crm_case.organization_id = p_organization_id
      and (
        search_term is null
        or crm_case.search_vector @@ search_query
        or crm_case.search_text ilike '%' || search_term || '%'
      )
      and (
        cardinality(client_ids) = 0
        or (
          client_match = 'any'
          and exists (
            select 1
            from public.crm_case_clients case_client_filter
            where case_client_filter.organization_id = crm_case.organization_id
              and case_client_filter.case_id = crm_case.id
              and case_client_filter.client_id = any(client_ids)
          )
        )
        or (
          client_match = 'all'
          and (
            select count(distinct case_client_filter.client_id)
            from public.crm_case_clients case_client_filter
            where case_client_filter.organization_id = crm_case.organization_id
              and case_client_filter.case_id = crm_case.id
              and case_client_filter.client_id = any(client_ids)
          ) = cardinality(client_ids)
        )
      )
      and (
        cardinality(bank_ids) = 0
        or exists (
          select 1
          from public.crm_case_offer_snapshots snapshot_filter
          where snapshot_filter.organization_id = crm_case.organization_id
            and snapshot_filter.case_id = crm_case.id
            and snapshot_filter.bank_id = any(bank_ids)
        )
      )
      and (
        offer_mode = 'all'
        or (offer_mode = 'with' and coalesce(offers.offer_count, 0) > 0)
        or (offer_mode = 'without' and coalesce(offers.offer_count, 0) = 0)
      )
      and (created_from is null or crm_case.created_at >= created_from)
      and (created_to is null or crm_case.created_at <= created_to)
      and (updated_from is null or crm_case.updated_at >= updated_from)
      and (updated_to is null or crm_case.updated_at <= updated_to)
  ),
  page_rows as materialized (
    select filtered.*
    from filtered
    order by
      case when target_sort = 'relevance' then relevance end desc,
      case when target_sort = 'updated_desc' then updated_at end desc,
      case when target_sort = 'updated_asc' then updated_at end asc,
      case when target_sort = 'created_desc' then created_at end desc,
      case when target_sort = 'created_asc' then created_at end asc,
      case when target_sort = 'title_asc' then lower(title) end asc,
      case when target_sort = 'title_desc' then lower(title) end desc,
      case when target_sort = 'offers_desc' then offer_count end desc,
      case when target_sort in ('relevance', 'updated_desc', 'offers_desc') then updated_at end desc,
      case when target_sort in ('updated_asc', 'created_asc', 'title_asc') then id end asc,
      id desc
    limit target_limit
    offset target_offset
  )
  select jsonb_build_object(
    'data', coalesce((
      select jsonb_agg(page_rows.row_json order by
        case when target_sort = 'relevance' then page_rows.relevance end desc,
        case when target_sort = 'updated_desc' then page_rows.updated_at end desc,
        case when target_sort = 'updated_asc' then page_rows.updated_at end asc,
        case when target_sort = 'created_desc' then page_rows.created_at end desc,
        case when target_sort = 'created_asc' then page_rows.created_at end asc,
        case when target_sort = 'title_asc' then lower(page_rows.title) end asc,
        case when target_sort = 'title_desc' then lower(page_rows.title) end desc,
        case when target_sort = 'offers_desc' then page_rows.offer_count end desc,
        page_rows.id desc
      )
      from page_rows
    ), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'pageInfo', jsonb_build_object(
      'offset', target_offset,
      'limit', target_limit,
      'hasMore', target_offset + target_limit < (select count(*) from filtered)
    ),
    'facets', case when include_facets then jsonb_build_object(
      'banks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'value', bank.bank_id,
          'label', bank.bank_name,
          'count', bank.case_count
        ) order by bank.bank_name, bank.bank_id)
        from (
          select
            snapshot.bank_id,
            snapshot.bank_name,
            count(distinct snapshot.case_id) as case_count
          from public.crm_case_offer_snapshots snapshot
          join filtered on filtered.id = snapshot.case_id
          where snapshot.organization_id = p_organization_id
            and snapshot.bank_id is not null
          group by snapshot.bank_id, snapshot.bank_name
        ) bank
      ), '[]'::jsonb),
      'offerCounts', jsonb_build_object(
        'with', (select count(*) from filtered where offer_count > 0),
        'without', (select count(*) from filtered where offer_count = 0)
      ),
      'dateBounds', jsonb_build_object(
        'createdMin', (select min(created_at) from filtered),
        'createdMax', (select max(created_at) from filtered),
        'updatedMin', (select min(updated_at) from filtered),
        'updatedMax', (select max(updated_at) from filtered)
      )
    ) else null end
  )
  into result;

  return result;
end;
$$;

revoke all on function private.crm_case_search_projection(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_crm_case_search_projection(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_crm_case_search_from_case()
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_crm_case_search_from_relation()
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_crm_case_search_from_client()
  from public, anon, authenticated, service_role;

revoke all on function public.set_crm_case_clients(uuid, uuid, uuid[])
  from public, anon;
grant execute on function public.set_crm_case_clients(uuid, uuid, uuid[])
  to authenticated, service_role;
revoke all on function public.create_crm_case_simple(uuid, text, uuid[], uuid)
  from public, anon;
grant execute on function public.create_crm_case_simple(uuid, text, uuid[], uuid)
  to authenticated, service_role;
revoke all on function public.search_crm_cases(uuid, jsonb)
  from public, anon;
grant execute on function public.search_crm_cases(uuid, jsonb)
  to authenticated, service_role;

comment on table public.crm_case_clients is
  'Tenant-safe many-to-many client list for a CRM case. crm_cases.client_id mirrors the primary row for compatibility.';
comment on table public.crm_case_offer_snapshots is
  'Immutable offer and calculator snapshots saved to a CRM case.';
comment on function public.search_crm_cases(uuid, jsonb) is
  'Tenant-scoped full-text CRM case search with filters, exact count, pagination and optional facets.';
