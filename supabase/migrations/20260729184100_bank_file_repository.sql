-- Global, versioned repository of official financial-institution files.
-- Binary objects remain private and are only exposed through short-lived
-- signed URLs created by an authenticated server route.

create extension if not exists vector with schema extensions;

create table public.mortgage_bank_file_categories (
  id uuid primary key default gen_random_uuid(),
  category_key text not null,
  label text not null,
  icon text,
  sort_order integer not null default 100,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mortgage_bank_file_categories_key_format
    check (category_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint mortgage_bank_file_categories_key_unique unique (category_key)
);

create table public.mortgage_bank_files (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.mortgage_banks(id) on delete restrict,
  category_id uuid references public.mortgage_bank_file_categories(id) on delete set null,
  title text not null,
  description text,
  source_page_url text,
  current_version_id uuid,
  created_by_user_id uuid references public.users(id) on delete set null,
  updated_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint mortgage_bank_files_title_length
    check (char_length(btrim(title)) between 2 and 500),
  constraint mortgage_bank_files_description_length
    check (description is null or char_length(description) <= 10000),
  constraint mortgage_bank_files_source_page_url_length
    check (source_page_url is null or char_length(source_page_url) <= 4096)
);

create table public.mortgage_bank_file_versions (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.mortgage_bank_files(id) on delete cascade,
  version_number integer not null,
  version_label text not null,
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  mime_group text not null,
  size_bytes bigint not null,
  checksum_sha256 text not null,
  source_download_url text,
  resolved_download_url text,
  source_etag text,
  source_last_modified text,
  effective_from date,
  effective_to date,
  published_at date,
  status text not null default 'processing',
  extraction_status text not null default 'pending',
  embedding_status text not null default 'pending',
  page_count integer,
  extracted_text text,
  generated_description text,
  extraction_metadata jsonb not null default '{}'::jsonb,
  embedding_model text,
  embedding_dimensions integer,
  retrieved_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mortgage_bank_file_versions_number_positive check (version_number > 0),
  constraint mortgage_bank_file_versions_label_length
    check (char_length(btrim(version_label)) between 1 and 40),
  constraint mortgage_bank_file_versions_path_length
    check (char_length(storage_path) between 5 and 1024),
  constraint mortgage_bank_file_versions_name_length
    check (char_length(original_file_name) between 1 and 500),
  constraint mortgage_bank_file_versions_mime_length
    check (char_length(mime_type) between 3 and 255),
  constraint mortgage_bank_file_versions_mime_group
    check (mime_group in ('pdf', 'spreadsheet', 'document', 'image', 'other')),
  constraint mortgage_bank_file_versions_size
    check (size_bytes > 0 and size_bytes <= 52428800),
  constraint mortgage_bank_file_versions_sha256
    check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint mortgage_bank_file_versions_status
    check (status in ('current', 'draft', 'expired', 'archived', 'processing', 'failed')),
  constraint mortgage_bank_file_versions_extraction_status
    check (extraction_status in ('pending', 'processing', 'completed', 'failed', 'unsupported')),
  constraint mortgage_bank_file_versions_embedding_status
    check (embedding_status in ('disabled', 'pending', 'processing', 'completed', 'failed')),
  constraint mortgage_bank_file_versions_page_count
    check (page_count is null or page_count between 1 and 10000),
  constraint mortgage_bank_file_versions_effective_range
    check (effective_to is null or effective_from is null or effective_to >= effective_from),
  constraint mortgage_bank_file_versions_embedding_dimensions
    check (embedding_dimensions is null or embedding_dimensions between 128 and 3072),
  constraint mortgage_bank_file_versions_version_unique unique (file_id, version_number),
  constraint mortgage_bank_file_versions_storage_path_unique unique (storage_path)
);

alter table public.mortgage_bank_files
  add constraint mortgage_bank_files_current_version_fkey
  foreign key (current_version_id)
  references public.mortgage_bank_file_versions(id)
  on delete set null;

create table public.mortgage_bank_file_products (
  file_id uuid not null references public.mortgage_bank_files(id) on delete cascade,
  product_id uuid not null references public.mortgage_products(id) on delete cascade,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (file_id, product_id)
);

create table public.mortgage_bank_file_chunks (
  id bigint generated always as identity primary key,
  version_id uuid not null references public.mortgage_bank_file_versions(id) on delete cascade,
  chunk_index integer not null,
  page_start integer,
  page_end integer,
  locator text,
  content text not null,
  token_count integer,
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  constraint mortgage_bank_file_chunks_index_nonnegative check (chunk_index >= 0),
  constraint mortgage_bank_file_chunks_page_start check (page_start is null or page_start > 0),
  constraint mortgage_bank_file_chunks_page_end
    check (page_end is null or page_start is null or page_end >= page_start),
  constraint mortgage_bank_file_chunks_locator_length
    check (locator is null or char_length(locator) <= 500),
  constraint mortgage_bank_file_chunks_content_length
    check (char_length(content) between 1 and 50000),
  constraint mortgage_bank_file_chunks_token_count
    check (token_count is null or token_count >= 0),
  constraint mortgage_bank_file_chunks_version_index_unique unique (version_id, chunk_index)
);

create table public.mortgage_bank_file_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id bigint not null references public.mortgage_bank_file_chunks(id) on delete cascade,
  embedding_kind text not null default 'content',
  model text not null,
  dimensions integer not null,
  recipe_version text not null default 'search-result-v1',
  source_sha256 text not null,
  embedding extensions.vector(768) not null,
  created_at timestamptz not null default now(),
  constraint mortgage_bank_file_embeddings_kind
    check (embedding_kind in ('content', 'description', 'page_multimodal')),
  constraint mortgage_bank_file_embeddings_model_length
    check (char_length(model) between 2 and 160),
  constraint mortgage_bank_file_embeddings_dimensions check (dimensions = 768),
  constraint mortgage_bank_file_embeddings_recipe_length
    check (char_length(recipe_version) between 2 and 80),
  constraint mortgage_bank_file_embeddings_sha256
    check (source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint mortgage_bank_file_embeddings_unique
    unique (chunk_id, embedding_kind, model, recipe_version)
);

create table public.mortgage_bank_file_processing_jobs (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.mortgage_bank_file_versions(id) on delete cascade,
  job_type text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mortgage_bank_file_processing_jobs_type
    check (job_type in ('extract', 'describe', 'embed', 'refresh_source')),
  constraint mortgage_bank_file_processing_jobs_status
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  constraint mortgage_bank_file_processing_jobs_attempts
    check (attempts between 0 and 100),
  constraint mortgage_bank_file_processing_jobs_error_length
    check (last_error is null or char_length(last_error) <= 10000),
  constraint mortgage_bank_file_processing_jobs_unique
    unique (version_id, job_type)
);

create table public.mortgage_bank_file_events (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.mortgage_bank_files(id) on delete cascade,
  version_id uuid references public.mortgage_bank_file_versions(id) on delete set null,
  actor_user_id uuid references public.users(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint mortgage_bank_file_events_action_length
    check (char_length(action) between 2 and 100)
);

create unique index mortgage_bank_files_bank_title_unique
  on public.mortgage_bank_files (bank_id, lower(btrim(title)))
  where archived_at is null;

create index mortgage_bank_files_bank_current_idx
  on public.mortgage_bank_files (bank_id, current_version_id)
  where archived_at is null;

create index mortgage_bank_files_category_idx
  on public.mortgage_bank_files (category_id, bank_id)
  where archived_at is null;

create index mortgage_bank_files_title_trgm_idx
  on public.mortgage_bank_files using gin (title gin_trgm_ops);

create index mortgage_bank_file_versions_file_created_idx
  on public.mortgage_bank_file_versions (file_id, created_at desc);

create index mortgage_bank_file_versions_status_idx
  on public.mortgage_bank_file_versions (status, effective_from desc);

create index mortgage_bank_file_versions_checksum_idx
  on public.mortgage_bank_file_versions (checksum_sha256);

create index mortgage_bank_file_products_product_idx
  on public.mortgage_bank_file_products (product_id, file_id);

create index mortgage_bank_file_chunks_version_idx
  on public.mortgage_bank_file_chunks (version_id, chunk_index);

create index mortgage_bank_file_chunks_search_idx
  on public.mortgage_bank_file_chunks using gin (search_vector);

create index mortgage_bank_file_embeddings_hnsw_idx
  on public.mortgage_bank_file_embeddings
  using hnsw (embedding vector_cosine_ops);

create index mortgage_bank_file_jobs_ready_idx
  on public.mortgage_bank_file_processing_jobs (status, available_at)
  where status in ('pending', 'failed');

create index mortgage_bank_file_events_file_created_idx
  on public.mortgage_bank_file_events (file_id, created_at desc);

create trigger mortgage_bank_file_categories_set_updated_at
  before update on public.mortgage_bank_file_categories
  for each row execute function public.set_updated_at();

create trigger mortgage_bank_files_set_updated_at
  before update on public.mortgage_bank_files
  for each row execute function public.set_updated_at();

create trigger mortgage_bank_file_versions_set_updated_at
  before update on public.mortgage_bank_file_versions
  for each row execute function public.set_updated_at();

create trigger mortgage_bank_file_jobs_set_updated_at
  before update on public.mortgage_bank_file_processing_jobs
  for each row execute function public.set_updated_at();

create or replace function private.reject_mortgage_bank_file_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'mortgage_bank_file_events_are_append_only';
end;
$$;

create trigger mortgage_bank_file_events_append_only
  before update or delete on public.mortgage_bank_file_events
  for each row execute function private.reject_mortgage_bank_file_event_mutation();

create or replace function public.search_mortgage_bank_file_chunks(
  query_text text,
  query_embedding extensions.vector(768) default null,
  filter_bank_id uuid default null,
  filter_category_key text default null,
  filter_mime_group text default null,
  filter_product_id uuid default null,
  filter_status text default null,
  match_count integer default 30,
  full_text_weight double precision default 1.0,
  semantic_weight double precision default 1.0,
  rrf_k integer default 50
)
returns table (
  chunk_id bigint,
  file_id uuid,
  version_id uuid,
  page_number integer,
  locator text,
  snippet text,
  score double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  with search_query as (
    select websearch_to_tsquery('simple'::regconfig, coalesce(query_text, '')) as value
  ),
  eligible as (
    select
      chunk.id as chunk_id,
      file.id as file_id,
      version.id as version_id,
      chunk.page_start as page_number,
      chunk.locator,
      chunk.content,
      chunk.search_vector,
      latest_embedding.embedding
    from public.mortgage_bank_file_chunks as chunk
    join public.mortgage_bank_file_versions as version
      on version.id = chunk.version_id
    join public.mortgage_bank_files as file
      on file.current_version_id = version.id
    left join public.mortgage_bank_file_categories as category
      on category.id = file.category_id
    left join lateral (
      select stored.embedding
      from public.mortgage_bank_file_embeddings as stored
      where stored.chunk_id = chunk.id
        and stored.embedding_kind = 'content'
        and stored.model = 'gemini-embedding-2'
        and stored.dimensions = 768
      order by stored.created_at desc
      limit 1
    ) as latest_embedding on true
    where file.archived_at is null
      and (filter_bank_id is null or file.bank_id = filter_bank_id)
      and (filter_category_key is null or category.category_key = filter_category_key)
      and (filter_mime_group is null or version.mime_group = filter_mime_group)
      and (filter_status is null or version.status = filter_status)
      and (
        filter_product_id is null
        or exists (
          select 1
          from public.mortgage_bank_file_products as link
          where link.file_id = file.id
            and link.product_id = filter_product_id
        )
      )
  ),
  full_text as (
    select
      eligible.chunk_id,
      row_number() over (
        order by ts_rank_cd(eligible.search_vector, search_query.value) desc
      ) as rank_ix
    from eligible
    cross join search_query
    where search_query.value::text <> ''
      and eligible.search_vector @@ search_query.value
    order by ts_rank_cd(eligible.search_vector, search_query.value) desc
    limit least(greatest(match_count, 1), 100) * 2
  ),
  semantic as (
    select
      eligible.chunk_id,
      row_number() over (
        order by eligible.embedding operator(extensions.<=>) query_embedding
      ) as rank_ix
    from eligible
    where query_embedding is not null
      and eligible.embedding is not null
    order by eligible.embedding operator(extensions.<=>) query_embedding
    limit least(greatest(match_count, 1), 100) * 2
  ),
  ranked as (
    select
      coalesce(full_text.chunk_id, semantic.chunk_id) as chunk_id,
      coalesce(
        full_text_weight / (rrf_k + full_text.rank_ix),
        0.0
      ) + coalesce(
        semantic_weight / (rrf_k + semantic.rank_ix),
        0.0
      ) as score
    from full_text
    full join semantic using (chunk_id)
  )
  select
    eligible.chunk_id,
    eligible.file_id,
    eligible.version_id,
    eligible.page_number,
    eligible.locator,
    regexp_replace(
      ts_headline(
        'simple'::regconfig,
        eligible.content,
        search_query.value,
        'StartSel=,StopSel=,MaxFragments=2,MaxWords=26,MinWords=8,FragmentDelimiter= … '
      ),
      '\s+',
      ' ',
      'g'
    ) as snippet,
    ranked.score
  from ranked
  join eligible using (chunk_id)
  cross join search_query
  order by ranked.score desc, eligible.chunk_id
  limit least(greatest(match_count, 1), 100);
$$;

insert into public.mortgage_bank_file_categories (
  category_key,
  label,
  icon,
  sort_order
)
values
  ('application', 'Wnioski', 'i-lucide-file-pen-line', 10),
  ('pricing', 'Tabele i oprocentowanie', 'i-lucide-table-properties', 20),
  ('general_information', 'Informacje ogólne', 'i-lucide-file-text', 30),
  ('promotion_rules', 'Regulaminy promocji', 'i-lucide-badge-percent', 40),
  ('income_form', 'Dokumenty dochodowe', 'i-lucide-receipt-text', 50),
  ('disbursement_form', 'Wypłata kredytu', 'i-lucide-landmark', 60),
  ('risk_information', 'Ryzyka i stopy', 'i-lucide-shield-alert', 70),
  ('other', 'Pozostałe', 'i-lucide-folder', 100)
on conflict (category_key) do update
set
  label = excluded.label,
  icon = excluded.icon,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'mortgage-bank-files',
  'mortgage-bank-files',
  false,
  52428800,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.mortgage_bank_file_categories enable row level security;
alter table public.mortgage_bank_files enable row level security;
alter table public.mortgage_bank_file_versions enable row level security;
alter table public.mortgage_bank_file_products enable row level security;
alter table public.mortgage_bank_file_chunks enable row level security;
alter table public.mortgage_bank_file_embeddings enable row level security;
alter table public.mortgage_bank_file_processing_jobs enable row level security;
alter table public.mortgage_bank_file_events enable row level security;

revoke all on public.mortgage_bank_file_categories from public, anon, authenticated;
revoke all on public.mortgage_bank_files from public, anon, authenticated;
revoke all on public.mortgage_bank_file_versions from public, anon, authenticated;
revoke all on public.mortgage_bank_file_products from public, anon, authenticated;
revoke all on public.mortgage_bank_file_chunks from public, anon, authenticated;
revoke all on public.mortgage_bank_file_embeddings from public, anon, authenticated;
revoke all on public.mortgage_bank_file_processing_jobs from public, anon, authenticated;
revoke all on public.mortgage_bank_file_events from public, anon, authenticated;
revoke all on function public.search_mortgage_bank_file_chunks(
  text,
  extensions.vector,
  uuid,
  text,
  text,
  uuid,
  text,
  integer,
  double precision,
  double precision,
  integer
) from public, anon, authenticated;

grant select, insert, update, delete on public.mortgage_bank_file_categories to service_role;
grant select, insert, update, delete on public.mortgage_bank_files to service_role;
grant select, insert, update, delete on public.mortgage_bank_file_versions to service_role;
grant select, insert, update, delete on public.mortgage_bank_file_products to service_role;
grant select, insert, update, delete on public.mortgage_bank_file_chunks to service_role;
grant select, insert, update, delete on public.mortgage_bank_file_embeddings to service_role;
grant select, insert, update, delete on public.mortgage_bank_file_processing_jobs to service_role;
grant select, insert, update, delete on public.mortgage_bank_file_events to service_role;
grant usage, select on sequence public.mortgage_bank_file_chunks_id_seq to service_role;
grant execute on function public.search_mortgage_bank_file_chunks(
  text,
  extensions.vector,
  uuid,
  text,
  text,
  uuid,
  text,
  integer,
  double precision,
  double precision,
  integer
) to service_role;

comment on table public.mortgage_bank_files is
  'Global logical files owned by a financial institution; binaries and versions are stored separately.';
comment on table public.mortgage_bank_file_versions is
  'Immutable binary revisions plus extraction and embedding processing state.';
comment on table public.mortgage_bank_file_chunks is
  'Source-grounded searchable fragments with page/section locators.';
comment on table public.mortgage_bank_file_embeddings is
  'Optional Gemini Embedding 2 vectors. Original chunks remain the source of truth.';
comment on table public.mortgage_bank_file_events is
  'Append-only audit trail for repository mutations, previews and downloads.';
