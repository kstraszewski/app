-- Global mortgage offer backoffice.
-- Drafts remain private to the service role. Authenticated users can read only
-- the currently published catalogue; published version payloads are immutable.

alter table public.mortgage_products
  add column current_published_version_id uuid,
  add column revision bigint not null default 1,
  add column archived_at timestamptz,
  add column archived_by_user_id uuid references public.users(id) on delete set null,
  add column created_by_user_id uuid references public.users(id) on delete set null,
  add column updated_by_user_id uuid references public.users(id) on delete set null,
  add constraint mortgage_products_revision_positive_check check (revision > 0);

alter table public.mortgage_product_versions
  add column version_number integer,
  add column lifecycle_status text,
  add column calculator_schema_version integer,
  add column calculator_engine_version text,
  add column content_sha256 text,
  add column validation_report jsonb,
  add column published_at timestamptz,
  add column published_by_user_id uuid references public.users(id) on delete no action,
  add column retired_at timestamptz,
  add column retired_by_user_id uuid references public.users(id) on delete no action;

with numbered as (
  select
    version.id,
    row_number() over (
      partition by version.product_id
      order by version.retrieved_at, version.created_at, version.id
    )::integer as version_number,
    row_number() over (
      partition by version.product_id
      order by version.retrieved_at desc, version.created_at desc, version.id desc
    ) as newest_rank
  from public.mortgage_product_versions version
)
update public.mortgage_product_versions version
set
  version_number = numbered.version_number,
  lifecycle_status = case when numbered.newest_rank = 1 then 'published' else 'retired' end,
  calculator_schema_version = 1,
  calculator_engine_version = 'legacy-flat-v1',
  validation_report = jsonb_build_object(
    'valid', false,
    'issues', jsonb_build_array(jsonb_build_object(
      'kind', 'warning',
      'code', 'legacy_catalog_version',
      'path', '',
      'message', 'Legacy flat catalogue version; review before republishing as V2.'
    ))
  ),
  published_at = coalesce(version.created_at, version.retrieved_at),
  retired_at = case
    when numbered.newest_rank = 1 then null
    else coalesce(version.updated_at, version.created_at, version.retrieved_at)
  end
from numbered
where numbered.id = version.id;

update public.mortgage_product_versions version
set content_sha256 = encode(
  extensions.digest(
    convert_to(
      (to_jsonb(version) - array[
        'content_sha256',
        'updated_at',
        'lifecycle_status',
        'retired_at',
        'retired_by_user_id'
      ])::text,
      'utf8'
    ),
    'sha256'
  ),
  'hex'
);

alter table public.mortgage_product_versions
  alter column version_number set not null,
  alter column lifecycle_status set not null,
  alter column lifecycle_status set default 'published',
  alter column calculator_schema_version set not null,
  alter column calculator_schema_version set default 1,
  alter column calculator_engine_version set not null,
  alter column calculator_engine_version set default 'legacy-flat-v1',
  alter column content_sha256 set not null,
  alter column validation_report set not null,
  alter column validation_report set default '{}'::jsonb,
  add constraint mortgage_product_versions_number_positive_check
    check (version_number > 0),
  add constraint mortgage_product_versions_lifecycle_check
    check (lifecycle_status in ('published', 'retired')),
  add constraint mortgage_product_versions_schema_positive_check
    check (calculator_schema_version > 0),
  add constraint mortgage_product_versions_engine_not_blank_check
    check (btrim(calculator_engine_version) <> ''),
  add constraint mortgage_product_versions_content_sha256_check
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint mortgage_product_versions_validation_object_check
    check (jsonb_typeof(validation_report) = 'object'),
  add constraint mortgage_product_versions_retirement_check
    check (
      (lifecycle_status = 'published' and retired_at is null and retired_by_user_id is null)
      or (lifecycle_status = 'retired' and retired_at is not null)
    ),
  add constraint mortgage_product_versions_product_number_key
    unique (product_id, version_number),
  add constraint mortgage_product_versions_product_id_id_key
    unique (product_id, id);

create or replace function private.prepare_mortgage_product_version_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.version_number is null then
    -- Existing catalogue importers do not yet know about version_number.
    -- Locking the owning product makes the per-product allocation safe.
    perform 1
    from public.mortgage_products product
    where product.id = new.product_id
    for update;

    select coalesce(max(version.version_number), 0) + 1
    into new.version_number
    from public.mortgage_product_versions version
    where version.product_id = new.product_id;
  end if;

  if new.lifecycle_status = 'published' and new.published_at is null then
    new.published_at := coalesce(new.created_at, new.retrieved_at, now());
  elsif new.lifecycle_status = 'retired' and new.retired_at is null then
    new.retired_at := now();
  end if;

  if new.content_sha256 is null then
    new.content_sha256 := encode(
      extensions.digest(
        convert_to(
          (to_jsonb(new) - array[
            'content_sha256',
            'updated_at',
            'lifecycle_status',
            'retired_at',
            'retired_by_user_id'
          ])::text,
          'utf8'
        ),
        'sha256'
      ),
      'hex'
    );
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_mortgage_product_version_insert()
  from public, anon, authenticated;

create trigger mortgage_product_versions_prepare_insert
  before insert on public.mortgage_product_versions
  for each row execute function private.prepare_mortgage_product_version_insert();

create table public.mortgage_product_drafts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.mortgage_products(id) on delete cascade,
  base_version_id uuid,
  revision bigint not null default 1 check (revision > 0),
  draft_data jsonb not null,
  validation_report jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mortgage_product_drafts_data_object_check
    check (jsonb_typeof(draft_data) = 'object'),
  constraint mortgage_product_drafts_validation_object_check
    check (jsonb_typeof(validation_report) = 'object'),
  constraint mortgage_product_drafts_base_version_fkey
    foreign key (product_id, base_version_id)
    references public.mortgage_product_versions(product_id, id) on delete restrict
);

create table public.mortgage_product_version_variants (
  id uuid primary key default gen_random_uuid(),
  product_version_id uuid not null references public.mortgage_product_versions(id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  name text not null check (btrim(name) <> ''),
  sort_order integer not null default 0,
  is_default boolean not null default false,
  min_amount numeric(14, 2) check (min_amount is null or min_amount >= 0),
  max_amount numeric(14, 2) check (max_amount is null or max_amount >= 0),
  min_term_months integer check (min_term_months is null or min_term_months > 0),
  max_term_months integer check (max_term_months is null or max_term_months > 0),
  min_ltv_pct numeric(7, 4) check (min_ltv_pct is null or min_ltv_pct between 0 and 200),
  max_ltv_pct numeric(7, 4) check (max_ltv_pct is null or max_ltv_pct between 0 and 200),
  interest_type text not null check (interest_type in ('fixed_periodic', 'variable', 'mixed')),
  fixed_rate_pct numeric(8, 5),
  fixed_period_months integer check (fixed_period_months is null or fixed_period_months > 0),
  margin_pct numeric(8, 5),
  reference_rate_code text,
  reference_rate_pct numeric(8, 5),
  reference_rate_as_of date,
  representative_apr_pct numeric(8, 5),
  calculation_readiness text not null default 'complete'
    check (calculation_readiness in ('complete', 'partial', 'unsupported')),
  pricing_config jsonb not null,
  eligibility_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint mortgage_product_version_variants_amount_range_check
    check (max_amount is null or min_amount is null or max_amount >= min_amount),
  constraint mortgage_product_version_variants_term_range_check
    check (max_term_months is null or min_term_months is null or max_term_months >= min_term_months),
  constraint mortgage_product_version_variants_ltv_range_check
    check (max_ltv_pct is null or min_ltv_pct is null or max_ltv_pct >= min_ltv_pct),
  constraint mortgage_product_version_variants_pricing_object_check
    check (jsonb_typeof(pricing_config) = 'object'),
  constraint mortgage_product_version_variants_eligibility_object_check
    check (jsonb_typeof(eligibility_config) = 'object'),
  constraint mortgage_product_version_variants_version_code_key
    unique (product_version_id, code)
);

create unique index mortgage_product_version_variants_one_default_idx
  on public.mortgage_product_version_variants(product_version_id)
  where is_default;
create index mortgage_product_version_variants_version_sort_idx
  on public.mortgage_product_version_variants(product_version_id, sort_order, id);
create index mortgage_product_version_variants_amount_idx
  on public.mortgage_product_version_variants(product_version_id, min_amount, max_amount);
create index mortgage_product_version_variants_pricing_gin_idx
  on public.mortgage_product_version_variants using gin (pricing_config jsonb_path_ops);
create index mortgage_product_version_variants_eligibility_gin_idx
  on public.mortgage_product_version_variants using gin (eligibility_config jsonb_path_ops);

insert into public.mortgage_product_version_variants (
  product_version_id,
  code,
  name,
  sort_order,
  is_default,
  min_amount,
  max_amount,
  min_term_months,
  max_term_months,
  max_ltv_pct,
  interest_type,
  fixed_rate_pct,
  fixed_period_months,
  margin_pct,
  reference_rate_code,
  reference_rate_pct,
  reference_rate_as_of,
  representative_apr_pct,
  calculation_readiness,
  pricing_config,
  eligibility_config
)
select
  version.id,
  'standard',
  'Wariant standardowy',
  0,
  true,
  version.min_amount,
  version.max_amount,
  version.min_term_months,
  version.max_term_months,
  version.max_ltv_pct,
  version.interest_type,
  version.fixed_rate_pct,
  version.fixed_period_months,
  version.margin_pct,
  version.reference_rate_code,
  version.reference_rate_pct,
  version.reference_rate_as_of,
  version.representative_apr_pct,
  case
    when cardinality(version.unknown_fields) > 0 then 'partial'
    else 'complete'
  end,
  jsonb_build_object(
    'schemaVersion', 'openexpert.mortgage-offer/legacy',
    'legacyVersionId', version.id,
    'costRules', version.cost_rules,
    'assumptions', version.assumptions,
    'unknownFields', to_jsonb(version.unknown_fields)
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'minAmount', version.min_amount,
    'maxAmount', version.max_amount,
    'minTermMonths', version.min_term_months,
    'maxTermMonths', version.max_term_months,
    'maxLtvPct', version.max_ltv_pct
  ))
from public.mortgage_product_versions version
on conflict (product_version_id, code) do nothing;

create table public.mortgage_product_version_sources (
  product_version_id uuid not null references public.mortgage_product_versions(id) on delete cascade,
  source_document_id uuid not null references public.mortgage_source_documents(id) on delete restrict,
  source_role text not null default 'primary'
    check (source_role in (
      'primary',
      'pricing',
      'eligibility',
      'costs',
      'documents',
      'legal',
      'general',
      'representative_example',
      'other'
    )),
  created_at timestamptz not null default now(),
  primary key (product_version_id, source_document_id, source_role)
);

create index mortgage_product_version_sources_document_idx
  on public.mortgage_product_version_sources(source_document_id, product_version_id);

insert into public.mortgage_product_version_sources (
  product_version_id,
  source_document_id,
  source_role
)
select version.id, version.source_document_id, 'primary'
from public.mortgage_product_versions version
where version.source_document_id is not null
on conflict do nothing;

create table public.mortgage_catalog_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid references public.mortgage_banks(id) on delete restrict,
  product_id uuid references public.mortgage_products(id) on delete restrict,
  draft_id uuid,
  product_version_id uuid references public.mortgage_product_versions(id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  actor_user_id uuid references public.users(id) on delete no action,
  revision_before bigint,
  revision_after bigint,
  content_sha256_before text,
  content_sha256_after text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint mortgage_catalog_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint mortgage_catalog_events_before_hash_check
    check (content_sha256_before is null or content_sha256_before ~ '^[0-9a-f]{64}$'),
  constraint mortgage_catalog_events_after_hash_check
    check (content_sha256_after is null or content_sha256_after ~ '^[0-9a-f]{64}$')
);

comment on column public.mortgage_catalog_events.draft_id is
  'Stable audit identifier, intentionally not a foreign key because successful publication deletes the draft.';

create index mortgage_products_current_published_version_idx
  on public.mortgage_products(current_published_version_id)
  where current_published_version_id is not null;
create index mortgage_products_archived_idx
  on public.mortgage_products(archived_at) where archived_at is not null;
create index mortgage_products_archived_by_idx
  on public.mortgage_products(archived_by_user_id) where archived_by_user_id is not null;
create index mortgage_products_created_by_idx
  on public.mortgage_products(created_by_user_id) where created_by_user_id is not null;
create index mortgage_products_updated_by_idx
  on public.mortgage_products(updated_by_user_id) where updated_by_user_id is not null;
create index mortgage_product_versions_published_idx
  on public.mortgage_product_versions(product_id, lifecycle_status, version_number desc);
create index mortgage_product_versions_published_by_idx
  on public.mortgage_product_versions(published_by_user_id) where published_by_user_id is not null;
create index mortgage_product_versions_retired_by_idx
  on public.mortgage_product_versions(retired_by_user_id) where retired_by_user_id is not null;
create index mortgage_product_drafts_base_version_idx
  on public.mortgage_product_drafts(base_version_id) where base_version_id is not null;
create index mortgage_product_drafts_created_by_idx
  on public.mortgage_product_drafts(created_by_user_id) where created_by_user_id is not null;
create index mortgage_product_drafts_updated_by_idx
  on public.mortgage_product_drafts(updated_by_user_id) where updated_by_user_id is not null;
create index mortgage_catalog_events_product_created_idx
  on public.mortgage_catalog_events(product_id, created_at desc, id desc);
create index mortgage_catalog_events_version_idx
  on public.mortgage_catalog_events(product_version_id) where product_version_id is not null;
create index mortgage_catalog_events_bank_idx
  on public.mortgage_catalog_events(bank_id, created_at desc) where bank_id is not null;
create index mortgage_catalog_events_actor_idx
  on public.mortgage_catalog_events(actor_user_id, created_at desc) where actor_user_id is not null;

with current_versions as (
  select distinct on (version.product_id)
    version.product_id,
    version.id
  from public.mortgage_product_versions version
  where version.lifecycle_status = 'published'
  order by version.product_id, version.version_number desc
)
update public.mortgage_products product
set current_published_version_id = current_versions.id
from current_versions
where current_versions.product_id = product.id;

alter table public.mortgage_products
  add constraint mortgage_products_current_published_version_fkey
  foreign key (id, current_published_version_id)
  references public.mortgage_product_versions(product_id, id)
  on delete restrict
  deferrable initially deferred;

create trigger mortgage_product_drafts_set_updated_at
  before update on public.mortgage_product_drafts
  for each row execute function public.set_updated_at();

create or replace function private.protect_mortgage_product_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'published_mortgage_version_is_immutable'
      using errcode = '55000';
  end if;

  if old.lifecycle_status = 'retired'
     and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'retired_mortgage_version_is_immutable'
      using errcode = '55000';
  end if;

  if old.lifecycle_status = 'published' then
    if new.lifecycle_status not in ('published', 'retired') then
      raise exception 'invalid_mortgage_version_lifecycle_transition'
        using errcode = '23514';
    end if;

    if (to_jsonb(new) - array[
          'lifecycle_status',
          'retired_at',
          'retired_by_user_id',
          'updated_at'
        ]) is distinct from
       (to_jsonb(old) - array[
          'lifecycle_status',
          'retired_at',
          'retired_by_user_id',
          'updated_at'
        ]) then
      raise exception 'published_mortgage_version_content_is_immutable'
        using errcode = '55000';
    end if;

    if new.lifecycle_status = 'published'
       and (new.retired_at is not null or new.retired_by_user_id is not null) then
      raise exception 'published_mortgage_version_cannot_have_retirement_metadata'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_mortgage_product_version() from public, anon, authenticated;

create trigger mortgage_product_versions_protect_immutable
  before update or delete on public.mortgage_product_versions
  for each row execute function private.protect_mortgage_product_version();

create or replace function private.protect_mortgage_catalog_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'mortgage_catalog_events_are_append_only'
    using errcode = '55000';
end;
$$;

revoke all on function private.protect_mortgage_catalog_event() from public, anon, authenticated;

create trigger mortgage_catalog_events_protect_append_only
  before update or delete on public.mortgage_catalog_events
  for each row execute function private.protect_mortgage_catalog_event();

create or replace function private.protect_published_mortgage_version_child()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_version_ids uuid[];
  version_is_locked boolean;
begin
  target_version_ids := case tg_op
    when 'INSERT' then array[new.product_version_id]
    when 'DELETE' then array[old.product_version_id]
    else array[old.product_version_id, new.product_version_id]
  end;

  select exists (
    select 1
    from public.mortgage_product_versions version
    join public.mortgage_products product on product.id = version.product_id
    where version.id = any(target_version_ids)
      and (
        version.lifecycle_status = 'retired'
        or product.current_published_version_id = version.id
      )
  )
  into version_is_locked;

  if version_is_locked then
    raise exception 'published_mortgage_version_children_are_immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.protect_published_mortgage_version_child()
  from public, anon, authenticated;

create trigger mortgage_product_version_variants_protect_immutable
  before insert or update or delete on public.mortgage_product_version_variants
  for each row execute function private.protect_published_mortgage_version_child();

create trigger mortgage_product_version_sources_protect_immutable
  before insert or update or delete on public.mortgage_product_version_sources
  for each row execute function private.protect_published_mortgage_version_child();

create or replace function private.protect_published_mortgage_source_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.mortgage_product_version_sources link
    join public.mortgage_product_versions version on version.id = link.product_version_id
    join public.mortgage_products product on product.id = version.product_id
    where link.source_document_id = old.id
      and version.calculator_schema_version >= 2
      and (
        version.lifecycle_status = 'retired'
        or product.current_published_version_id = version.id
      )
  ) then
    raise exception 'published_mortgage_source_document_is_immutable'
      using errcode = '55000';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.protect_published_mortgage_source_document()
  from public, anon, authenticated;

create trigger mortgage_source_documents_protect_published_evidence
  before update or delete on public.mortgage_source_documents
  for each row execute function private.protect_published_mortgage_source_document();

create or replace function private.finalize_legacy_mortgage_product_version_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  product_record public.mortgage_products%rowtype;
  prior_hash text;
begin
  -- The post-reset catalogue synchronizer still writes the legacy flat shape.
  -- V2 publications explicitly use schema 2 and are finalized only by the RPC.
  if new.calculator_schema_version <> 1
     or new.calculator_engine_version <> 'legacy-flat-v1' then
    return new;
  end if;

  select product.*
  into product_record
  from public.mortgage_products product
  where product.id = new.product_id
  for update;

  insert into public.mortgage_product_version_variants (
    product_version_id,
    code,
    name,
    sort_order,
    is_default,
    min_amount,
    max_amount,
    min_term_months,
    max_term_months,
    max_ltv_pct,
    interest_type,
    fixed_rate_pct,
    fixed_period_months,
    margin_pct,
    reference_rate_code,
    reference_rate_pct,
    reference_rate_as_of,
    representative_apr_pct,
    calculation_readiness,
    pricing_config,
    eligibility_config
  ) values (
    new.id,
    'standard',
    'Wariant standardowy',
    0,
    true,
    new.min_amount,
    new.max_amount,
    new.min_term_months,
    new.max_term_months,
    new.max_ltv_pct,
    new.interest_type,
    new.fixed_rate_pct,
    new.fixed_period_months,
    new.margin_pct,
    new.reference_rate_code,
    new.reference_rate_pct,
    new.reference_rate_as_of,
    new.representative_apr_pct,
    case when cardinality(new.unknown_fields) > 0 then 'partial' else 'complete' end,
    jsonb_build_object(
      'schemaVersion', 'openexpert.mortgage-offer/legacy',
      'legacyVersionId', new.id,
      'costRules', new.cost_rules,
      'assumptions', new.assumptions,
      'unknownFields', to_jsonb(new.unknown_fields)
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'minAmount', new.min_amount,
      'maxAmount', new.max_amount,
      'minTermMonths', new.min_term_months,
      'maxTermMonths', new.max_term_months,
      'maxLtvPct', new.max_ltv_pct
    ))
  )
  on conflict (product_version_id, code) do nothing;

  if new.source_document_id is not null then
    insert into public.mortgage_product_version_sources (
      product_version_id,
      source_document_id,
      source_role
    ) values (new.id, new.source_document_id, 'primary')
    on conflict do nothing;
  end if;

  if new.lifecycle_status = 'published' then
    if product_record.current_published_version_id is not null
       and product_record.current_published_version_id <> new.id then
      select version.content_sha256
      into prior_hash
      from public.mortgage_product_versions version
      where version.id = product_record.current_published_version_id;

      update public.mortgage_product_versions version
      set
        lifecycle_status = 'retired',
        retired_at = now(),
        retired_by_user_id = null
      where version.id = product_record.current_published_version_id
        and version.lifecycle_status = 'published';
    end if;

    update public.mortgage_products product
    set
      current_published_version_id = new.id,
      revision = product.revision + 1
    where product.id = new.product_id;

    insert into public.mortgage_catalog_events (
      bank_id,
      product_id,
      product_version_id,
      event_type,
      revision_before,
      revision_after,
      content_sha256_before,
      content_sha256_after,
      metadata
    ) values (
      product_record.bank_id,
      new.product_id,
      new.id,
      'product.legacy_imported',
      product_record.revision,
      product_record.revision + 1,
      prior_hash,
      new.content_sha256,
      jsonb_build_object(
        'versionNumber', new.version_number,
        'versionKey', new.version_key,
        'calculatorSchemaVersion', new.calculator_schema_version,
        'calculatorEngineVersion', new.calculator_engine_version
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function private.finalize_legacy_mortgage_product_version_insert()
  from public, anon, authenticated;

create trigger mortgage_product_versions_finalize_legacy_insert
  after insert on public.mortgage_product_versions
  for each row execute function private.finalize_legacy_mortgage_product_version_insert();

alter table public.mortgage_product_drafts enable row level security;
alter table public.mortgage_product_version_variants enable row level security;
alter table public.mortgage_product_version_sources enable row level security;
alter table public.mortgage_catalog_events enable row level security;

drop policy mortgage_products_authenticated_read on public.mortgage_products;
create policy mortgage_products_authenticated_read
  on public.mortgage_products for select to authenticated
  using (
    is_active
    and archived_at is null
    and current_published_version_id is not null
  );

drop policy mortgage_product_versions_authenticated_read
  on public.mortgage_product_versions;
create policy mortgage_product_versions_authenticated_read
  on public.mortgage_product_versions for select to authenticated
  using (
    lifecycle_status = 'published'
    and exists (
      select 1
      from public.mortgage_products product
      where product.id = mortgage_product_versions.product_id
        and product.current_published_version_id = mortgage_product_versions.id
        and product.is_active
        and product.archived_at is null
    )
  );

create policy mortgage_product_version_variants_authenticated_read
  on public.mortgage_product_version_variants for select to authenticated
  using (
    exists (
      select 1
      from public.mortgage_product_versions version
      join public.mortgage_products product on product.id = version.product_id
      where version.id = mortgage_product_version_variants.product_version_id
        and version.lifecycle_status = 'published'
        and product.current_published_version_id = version.id
        and product.is_active
        and product.archived_at is null
    )
  );

create policy mortgage_product_version_sources_authenticated_read
  on public.mortgage_product_version_sources for select to authenticated
  using (
    exists (
      select 1
      from public.mortgage_product_versions version
      join public.mortgage_products product on product.id = version.product_id
      where version.id = mortgage_product_version_sources.product_version_id
        and version.lifecycle_status = 'published'
        and product.current_published_version_id = version.id
        and product.is_active
        and product.archived_at is null
    )
  );

revoke all on public.mortgage_products from public, anon, authenticated;
revoke all on public.mortgage_product_versions from public, anon, authenticated;
revoke all on public.mortgage_product_drafts from public, anon, authenticated;
revoke all on public.mortgage_product_version_variants from public, anon, authenticated;
revoke all on public.mortgage_product_version_sources from public, anon, authenticated;
revoke all on public.mortgage_catalog_events from public, anon, authenticated;

grant select on public.mortgage_products to authenticated;
grant select on public.mortgage_product_versions to authenticated;
grant select on public.mortgage_product_version_variants to authenticated;
grant select on public.mortgage_product_version_sources to authenticated;

grant all on public.mortgage_products to service_role;
grant all on public.mortgage_product_versions to service_role;
grant all on public.mortgage_product_drafts to service_role;
grant all on public.mortgage_product_version_variants to service_role;
grant all on public.mortgage_product_version_sources to service_role;
grant all on public.mortgage_catalog_events to service_role;

create or replace function public.create_mortgage_product_draft_v2(
  p_bank_id uuid,
  p_slug text,
  p_name text,
  p_category text,
  p_distribution_channel text,
  p_draft_data jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product_record public.mortgage_products%rowtype;
  draft_record public.mortgage_product_drafts%rowtype;
begin
  if not exists (
    select 1
    from public.platform_user_roles platform_role
    where platform_role.user_id = p_actor_user_id
      and platform_role.role = 'super_admin'
  ) then
    raise exception 'super_admin_actor_required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_draft_data) <> 'object'
     or p_draft_data ->> 'schemaVersion' <> 'openexpert.mortgage-offer/2.0' then
    raise exception 'invalid_mortgage_offer_v2_draft' using errcode = '23514';
  end if;

  insert into public.mortgage_products (
    bank_id,
    slug,
    name,
    category,
    distribution_channel,
    is_active,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_bank_id,
    p_slug,
    p_name,
    p_category,
    p_distribution_channel,
    false,
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into product_record;

  insert into public.mortgage_product_drafts (
    product_id,
    revision,
    draft_data,
    validation_report,
    created_by_user_id,
    updated_by_user_id
  ) values (
    product_record.id,
    1,
    p_draft_data,
    '{}'::jsonb,
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into draft_record;

  insert into public.mortgage_catalog_events (
    bank_id,
    product_id,
    draft_id,
    event_type,
    actor_user_id,
    revision_before,
    revision_after,
    metadata
  ) values (
    p_bank_id,
    product_record.id,
    draft_record.id,
    'offer_created',
    p_actor_user_id,
    0,
    1,
    jsonb_build_object('schemaVersion', p_draft_data ->> 'schemaVersion')
  );

  return jsonb_build_object(
    'productId', product_record.id,
    'bankId', product_record.bank_id,
    'slug', product_record.slug,
    'name', product_record.name,
    'category', product_record.category,
    'distributionChannel', product_record.distribution_channel,
    'productCreatedAt', product_record.created_at,
    'productUpdatedAt', product_record.updated_at,
    'draftId', draft_record.id,
    'draftRevision', draft_record.revision,
    'draftData', draft_record.draft_data,
    'draftUpdatedAt', draft_record.updated_at,
    'draftUpdatedBy', draft_record.updated_by_user_id
  );
end;
$$;

comment on function public.create_mortgage_product_draft_v2(uuid, text, text, text, text, jsonb, uuid) is
  'Service-role-only atomic creation of a mortgage product, its initial V2 draft and audit event.';
revoke all on function public.create_mortgage_product_draft_v2(uuid, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.create_mortgage_product_draft_v2(uuid, text, text, text, text, jsonb, uuid)
  to service_role;

create or replace function public.save_mortgage_product_draft_v2(
  p_product_id uuid,
  p_expected_revision bigint,
  p_draft_data jsonb,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product_record public.mortgage_products%rowtype;
  draft_record public.mortgage_product_drafts%rowtype;
  draft_exists boolean := false;
begin
  if not exists (
    select 1
    from public.platform_user_roles platform_role
    where platform_role.user_id = p_actor_user_id
      and platform_role.role = 'super_admin'
  ) then
    raise exception 'super_admin_actor_required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_draft_data) <> 'object'
     or p_draft_data ->> 'schemaVersion' <> 'openexpert.mortgage-offer/2.0' then
    raise exception 'invalid_mortgage_offer_v2_draft' using errcode = '23514';
  end if;

  select product.*
  into product_record
  from public.mortgage_products product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'mortgage_product_not_found' using errcode = 'P0002';
  end if;
  if product_record.archived_at is not null then
    raise exception 'archived_mortgage_product_cannot_be_edited' using errcode = '55000';
  end if;

  select draft.*
  into draft_record
  from public.mortgage_product_drafts draft
  where draft.product_id = p_product_id
  for update;
  draft_exists := found;

  if draft_exists then
    if draft_record.revision <> p_expected_revision then
      raise exception 'mortgage_draft_revision_conflict' using errcode = '40001';
    end if;
    update public.mortgage_product_drafts draft
    set
      revision = draft.revision + 1,
      draft_data = p_draft_data,
      validation_report = '{}'::jsonb,
      updated_by_user_id = p_actor_user_id,
      updated_at = now()
    where draft.id = draft_record.id
    returning * into draft_record;
  else
    if p_expected_revision <> 0 then
      raise exception 'mortgage_draft_revision_conflict' using errcode = '40001';
    end if;
    insert into public.mortgage_product_drafts (
      product_id,
      base_version_id,
      revision,
      draft_data,
      validation_report,
      created_by_user_id,
      updated_by_user_id
    ) values (
      p_product_id,
      product_record.current_published_version_id,
      1,
      p_draft_data,
      '{}'::jsonb,
      p_actor_user_id,
      p_actor_user_id
    )
    returning * into draft_record;
  end if;

  update public.mortgage_products product
  set updated_by_user_id = p_actor_user_id, updated_at = now()
  where product.id = p_product_id;

  insert into public.mortgage_catalog_events (
    bank_id,
    product_id,
    draft_id,
    event_type,
    actor_user_id,
    revision_before,
    revision_after,
    metadata
  ) values (
    product_record.bank_id,
    p_product_id,
    draft_record.id,
    'draft_saved',
    p_actor_user_id,
    p_expected_revision,
    draft_record.revision,
    jsonb_build_object('schemaVersion', p_draft_data ->> 'schemaVersion')
  );

  return jsonb_build_object(
    'draftId', draft_record.id,
    'draftRevision', draft_record.revision,
    'draftData', draft_record.draft_data,
    'draftUpdatedAt', draft_record.updated_at,
    'draftUpdatedBy', draft_record.updated_by_user_id
  );
end;
$$;

comment on function public.save_mortgage_product_draft_v2(uuid, bigint, jsonb, uuid) is
  'Service-role-only optimistic and atomic save of a mortgage V2 draft with its audit event.';
revoke all on function public.save_mortgage_product_draft_v2(uuid, bigint, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_mortgage_product_draft_v2(uuid, bigint, jsonb, uuid)
  to service_role;

create or replace function public.publish_mortgage_product_draft(
  p_product_id uuid,
  p_expected_revision bigint,
  p_actor_user_id uuid
)
returns table(version_id uuid, version_number integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  product_record public.mortgage_products%rowtype;
  draft_record public.mortgage_product_drafts%rowtype;
  first_phase jsonb;
  first_formula jsonb;
  formula_kind text;
  flat_interest_type text;
  variant_interest_type text;
  next_version_number integer;
  published_version_id uuid;
  draft_hash text;
  prior_hash text;
  primary_source_id uuid;
  min_amount_value numeric(14, 2);
  max_amount_value numeric(14, 2);
  min_term_value integer;
  max_term_value integer;
  max_ltv_value numeric(7, 4);
  fixed_rate_value numeric(8, 5);
  fixed_months_value integer;
  margin_value numeric(8, 5);
  reference_rate_value numeric(8, 5);
  reference_rate_code_value text;
  reference_rate_as_of_value date;
  requirements_value jsonb;
  sources_value jsonb;
begin
  if not exists (
    select 1
    from public.platform_user_roles platform_role
    where platform_role.user_id = p_actor_user_id
      and platform_role.role = 'super_admin'
  ) then
    raise exception 'super_admin_actor_required'
      using errcode = '42501';
  end if;

  -- Lock the product first. This serializes version-number allocation and gives
  -- all callers a stable lock order before the draft row is acquired.
  select product.*
  into product_record
  from public.mortgage_products product
  where product.id = p_product_id
  for update;

  if not found then
    raise exception 'mortgage_product_not_found'
      using errcode = 'P0002';
  end if;

  if product_record.archived_at is not null then
    raise exception 'archived_mortgage_product_cannot_be_published'
      using errcode = '55000';
  end if;

  select draft.*
  into draft_record
  from public.mortgage_product_drafts draft
  where draft.product_id = p_product_id
  for update;

  if not found then
    raise exception 'mortgage_product_draft_not_found'
      using errcode = 'P0002';
  end if;

  if draft_record.revision <> p_expected_revision then
    raise exception 'mortgage_product_draft_revision_conflict'
      using
        errcode = '40001',
        detail = format(
          'Expected revision %s, current revision is %s.',
          p_expected_revision,
          draft_record.revision
        );
  end if;

  if draft_record.draft_data ->> 'schemaVersion'
       <> 'openexpert.mortgage-offer/2.0'
     or draft_record.draft_data ->> 'currency' <> 'PLN'
     or jsonb_typeof(draft_record.draft_data -> 'validity') <> 'object'
     or jsonb_typeof(draft_record.draft_data -> 'calculationPolicy') <> 'object'
     or jsonb_typeof(draft_record.draft_data -> 'eligibility') <> 'object'
     or jsonb_typeof(draft_record.draft_data #> '{eligibility,allowedInstallmentTypes}') <> 'array'
     or jsonb_typeof(draft_record.draft_data #> '{ratePlan,phases}') <> 'array'
     or jsonb_array_length(draft_record.draft_data #> '{ratePlan,phases}') = 0
     or jsonb_typeof(draft_record.draft_data #> '{ratePlan,modifiers}') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'features') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'presets') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'costs') <> 'array'
     or jsonb_typeof(draft_record.draft_data -> 'disbursementPolicy') <> 'object'
     or draft_record.draft_data #>> '{calculationPolicy,accrual}' <> 'nominal_monthly_12'
     or jsonb_typeof(draft_record.draft_data #> '{documentation,sources}') <> 'array'
     or jsonb_array_length(draft_record.draft_data #> '{documentation,sources}') = 0
     or draft_record.draft_data #>> '{validity,effectiveFrom}' > current_date::text
     or coalesce(
       nullif(draft_record.draft_data #>> '{validity,effectiveTo}', ''),
       '9999-12-31'
     ) < current_date::text then
    raise exception 'invalid_mortgage_offer_v2_draft'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(draft_record.draft_data -> 'costs') cost
    where cost ->> 'state' = 'unknown'
  ) then
    raise exception 'unknown_mortgage_offer_costs_cannot_be_published'
      using errcode = '23514';
  end if;

  first_phase := draft_record.draft_data #> '{ratePlan,phases,0}';
  first_formula := first_phase -> 'formula';
  formula_kind := first_formula ->> 'kind';

  if formula_kind not in ('fixed', 'index_plus_margin') then
    raise exception 'unsupported_mortgage_rate_formula'
      using errcode = '23514';
  end if;

  begin
    min_amount_value := (draft_record.draft_data #>> '{eligibility,minAmount}')::numeric;
    max_amount_value := nullif(draft_record.draft_data #>> '{eligibility,maxAmount}', '')::numeric;
    min_term_value := (draft_record.draft_data #>> '{eligibility,minTermMonths}')::integer;
    max_term_value := (draft_record.draft_data #>> '{eligibility,maxTermMonths}')::integer;
    max_ltv_value := (draft_record.draft_data #>> '{eligibility,maxLtvPct}')::numeric;

    if formula_kind = 'fixed' then
      fixed_rate_value := (first_formula ->> 'ratePct')::numeric;
      fixed_months_value := greatest(
        1,
        case
          when first_phase #>> '{period,from,kind}' = 'month'
            and first_phase #>> '{period,endExclusive,kind}' = 'month'
          then
            (first_phase #>> '{period,endExclusive,month}')::integer
            - (first_phase #>> '{period,from,month}')::integer
          else max_term_value
        end
      );
    else
      margin_value := (first_formula ->> 'marginPct')::numeric;
      reference_rate_value := (first_formula ->> 'indexValuePct')::numeric;
      reference_rate_code_value := nullif(btrim(first_formula ->> 'indexCode'), '');
      reference_rate_as_of_value := nullif(
        coalesce(
          first_formula ->> 'indexAsOf',
          draft_record.draft_data #>> '{validity,pricingAsOf}'
        ),
        ''
      )::date;
    end if;
  exception
    when invalid_text_representation
      or invalid_datetime_format
      or numeric_value_out_of_range
      or datetime_field_overflow then
      raise exception 'invalid_mortgage_offer_v2_numeric_or_date_value'
        using errcode = '23514';
  end;

  if min_amount_value < 0
     or (max_amount_value is not null and max_amount_value < min_amount_value)
     or min_term_value <= 0
     or max_term_value < min_term_value
     or max_ltv_value < 0
     or max_ltv_value > 200
     or (formula_kind = 'fixed' and fixed_rate_value is null)
     or (
       formula_kind = 'index_plus_margin'
       and (
         margin_value is null
         or reference_rate_value is null
         or reference_rate_code_value is null
         or reference_rate_as_of_value is null
       )
     ) then
    raise exception 'invalid_mortgage_offer_v2_ranges'
      using errcode = '23514';
  end if;

  requirements_value := coalesce(
    draft_record.draft_data #> '{documentation,requirements}',
    '[]'::jsonb
  );
  sources_value := coalesce(
    draft_record.draft_data #> '{documentation,sources}',
    '[]'::jsonb
  );

  if jsonb_typeof(requirements_value) <> 'array'
     or jsonb_typeof(sources_value) <> 'array' then
    raise exception 'invalid_mortgage_offer_documentation'
      using errcode = '23514';
  end if;

  select source.id
  into primary_source_id
  from jsonb_array_elements(sources_value) with ordinality as item(value, position)
  join public.mortgage_source_documents source
    on source.id::text = coalesce(
      item.value ->> 'sourceId',
      item.value ->> 'sourceDocumentId',
      item.value ->> 'source_document_id'
    )
   and source.bank_id = product_record.bank_id
   and (source.product_id is null or source.product_id = p_product_id)
  order by
    case when coalesce(item.value ->> 'role', 'primary') = 'primary' then 0 else 1 end,
    item.position
  limit 1;

  select coalesce(max(version.version_number), 0) + 1
  into next_version_number
  from public.mortgage_product_versions version
  where version.product_id = p_product_id;

  if product_record.current_published_version_id is not null then
    select version.content_sha256
    into prior_hash
    from public.mortgage_product_versions version
    where version.id = product_record.current_published_version_id;

    update public.mortgage_product_versions version
    set
      lifecycle_status = 'retired',
      retired_at = now(),
      retired_by_user_id = p_actor_user_id
    where version.id = product_record.current_published_version_id
      and version.lifecycle_status = 'published';
  end if;

  draft_hash := encode(
    extensions.digest(
      convert_to(draft_record.draft_data::text, 'utf8'),
      'sha256'
    ),
    'hex'
  );

  flat_interest_type := case
    when formula_kind = 'fixed' then 'fixed_periodic'
    else 'variable'
  end;
  variant_interest_type := case
    when exists (
      select 1
      from jsonb_array_elements(draft_record.draft_data #> '{ratePlan,phases}') phase
      where phase #>> '{formula,kind}' = 'fixed'
    ) and exists (
      select 1
      from jsonb_array_elements(draft_record.draft_data #> '{ratePlan,phases}') phase
      where phase #>> '{formula,kind}' = 'index_plus_margin'
    ) then 'mixed'
    else flat_interest_type
  end;

  insert into public.mortgage_product_versions (
    version_key,
    product_id,
    source_document_id,
    effective_from,
    effective_to,
    retrieved_at,
    calculation_date,
    data_status,
    completeness_score,
    interest_type,
    fixed_rate_pct,
    fixed_period_months,
    margin_pct,
    reference_rate_code,
    reference_rate_pct,
    reference_rate_as_of,
    min_amount,
    max_amount,
    min_term_months,
    max_term_months,
    max_ltv_pct,
    cost_rules,
    requirements,
    representative_example,
    assumptions,
    unknown_fields,
    document_requirements,
    multiform_template_ids,
    version_number,
    lifecycle_status,
    calculator_schema_version,
    calculator_engine_version,
    content_sha256,
    validation_report,
    published_at,
    published_by_user_id
  ) values (
    product_record.id::text || '-v' || next_version_number::text,
    p_product_id,
    primary_source_id,
    nullif(draft_record.draft_data #>> '{validity,effectiveFrom}', '')::date,
    nullif(draft_record.draft_data #>> '{validity,effectiveTo}', '')::date,
    now(),
    nullif(draft_record.draft_data #>> '{validity,pricingAsOf}', '')::date,
    'confirmed',
    100,
    flat_interest_type,
    fixed_rate_value,
    fixed_months_value,
    margin_value,
    reference_rate_code_value,
    reference_rate_value,
    reference_rate_as_of_value,
    min_amount_value,
    max_amount_value,
    min_term_value,
    max_term_value,
    max_ltv_value,
    jsonb_build_object(
      'schemaVersion', draft_record.draft_data ->> 'schemaVersion',
      'costs', draft_record.draft_data -> 'costs'
    ),
    '[]'::jsonb,
    '{}'::jsonb,
    '[]'::jsonb,
    '{}'::text[],
    requirements_value,
    '{}'::text[],
    next_version_number,
    'published',
    2,
    'openexpert-mortgage-v2',
    draft_hash,
    jsonb_build_object('valid', true, 'issues', '[]'::jsonb),
    now(),
    p_actor_user_id
  )
  returning id into published_version_id;

  insert into public.mortgage_product_version_variants (
    product_version_id,
    code,
    name,
    sort_order,
    is_default,
    min_amount,
    max_amount,
    min_term_months,
    max_term_months,
    max_ltv_pct,
    interest_type,
    fixed_rate_pct,
    fixed_period_months,
    margin_pct,
    reference_rate_code,
    reference_rate_pct,
    reference_rate_as_of,
    calculation_readiness,
    pricing_config,
    eligibility_config
  ) values (
    published_version_id,
    'standard',
    'Wariant standardowy',
    0,
    true,
    min_amount_value,
    max_amount_value,
    min_term_value,
    max_term_value,
    max_ltv_value,
    variant_interest_type,
    fixed_rate_value,
    fixed_months_value,
    margin_value,
    reference_rate_code_value,
    reference_rate_value,
    reference_rate_as_of_value,
    'complete',
    draft_record.draft_data,
    draft_record.draft_data -> 'eligibility'
  );

  insert into public.mortgage_product_version_sources (
    product_version_id,
    source_document_id,
    source_role
  )
  select
    published_version_id,
    source.id,
    case
      when coalesce(item.value ->> 'role', 'primary') in (
        'primary',
        'pricing',
        'eligibility',
        'costs',
        'documents',
        'legal',
        'general',
        'representative_example',
        'other'
      ) then coalesce(item.value ->> 'role', 'primary')
      else 'other'
    end
  from jsonb_array_elements(sources_value) item(value)
  join public.mortgage_source_documents source
    on source.id::text = coalesce(
      item.value ->> 'sourceId',
      item.value ->> 'sourceDocumentId',
      item.value ->> 'source_document_id'
    )
   and source.bank_id = product_record.bank_id
   and (source.product_id is null or source.product_id = p_product_id)
  on conflict do nothing;

  update public.mortgage_products product
  set
    current_published_version_id = published_version_id,
    revision = product.revision + 1,
    is_active = true,
    updated_by_user_id = p_actor_user_id
  where product.id = p_product_id;

  insert into public.mortgage_catalog_events (
    bank_id,
    product_id,
    draft_id,
    product_version_id,
    event_type,
    actor_user_id,
    revision_before,
    revision_after,
    content_sha256_before,
    content_sha256_after,
    metadata
  ) values (
    product_record.bank_id,
    p_product_id,
    draft_record.id,
    published_version_id,
    'product.published',
    p_actor_user_id,
    product_record.revision,
    product_record.revision + 1,
    prior_hash,
    draft_hash,
    jsonb_build_object(
      'draftRevision', draft_record.revision,
      'versionNumber', next_version_number,
      'calculatorSchemaVersion', 2,
      'calculatorEngineVersion', 'openexpert-mortgage-v2'
    )
  );

  delete from public.mortgage_product_drafts draft
  where draft.id = draft_record.id;

  return query select published_version_id, next_version_number;
end;
$$;

comment on function public.publish_mortgage_product_draft(uuid, bigint, uuid) is
  'Service-role-only atomic publication of one optimistic mortgage V2 draft as an immutable version and standard variant.';

revoke all on function public.publish_mortgage_product_draft(uuid, bigint, uuid)
  from public, anon, authenticated;
grant execute on function public.publish_mortgage_product_draft(uuid, bigint, uuid)
  to service_role;
