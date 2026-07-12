-- Shared, versioned catalogue of public mortgage product observations.
-- These rows are informational inputs for a deterministic calculator, not
-- individualized bank offers or credit decisions.

create table public.mortgage_banks (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (btrim(name) <> ''),
  website_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mortgage_products (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.mortgage_banks(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (btrim(name) <> ''),
  category text not null default 'housing' check (category in ('housing', 'construction', 'refinance', 'eco', 'family')),
  distribution_channel text not null default 'bank_public_website',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_id, slug)
);

create table public.mortgage_source_documents (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  bank_id uuid not null references public.mortgage_banks(id) on delete restrict,
  product_id uuid references public.mortgage_products(id) on delete set null,
  title text not null,
  source_url text not null,
  source_kind text not null check (source_kind in ('product_page', 'general_information', 'pricing_table', 'promotion_rules', 'other')),
  mime_type text,
  sha256 text,
  storage_path text unique,
  retrieved_at timestamptz not null,
  published_at date,
  retrieval_status text not null default 'pending' check (retrieval_status in ('pending', 'downloaded', 'failed')),
  extraction_status text not null default 'reviewed' check (extraction_status in ('pending', 'automatic', 'reviewed', 'quarantined')),
  facts jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.mortgage_product_versions (
  id uuid primary key default gen_random_uuid(),
  version_key text not null unique,
  product_id uuid not null references public.mortgage_products(id) on delete cascade,
  source_document_id uuid references public.mortgage_source_documents(id) on delete set null,
  effective_from date,
  effective_to date,
  retrieved_at timestamptz not null,
  calculation_date date,
  data_status text not null check (data_status in ('confirmed', 'inferred', 'draft')),
  completeness_score smallint not null check (completeness_score between 0 and 100),
  interest_type text not null check (interest_type in ('fixed_periodic', 'variable')),
  fixed_rate_pct numeric(8, 5),
  fixed_period_months integer check (fixed_period_months is null or fixed_period_months > 0),
  margin_pct numeric(8, 5),
  reference_rate_code text,
  reference_rate_pct numeric(8, 5),
  reference_rate_as_of date,
  representative_apr_pct numeric(8, 5),
  min_amount numeric(14, 2),
  max_amount numeric(14, 2),
  min_term_months integer,
  max_term_months integer,
  max_ltv_pct numeric(7, 4),
  is_eco boolean not null default false,
  cost_rules jsonb not null default '{}'::jsonb,
  requirements jsonb not null default '[]'::jsonb,
  representative_example jsonb not null default '{}'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  unknown_fields text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (interest_type = 'fixed_periodic' and fixed_rate_pct is not null and fixed_period_months is not null)
    or interest_type = 'variable'
  )
);

create index mortgage_products_active_bank_idx
  on public.mortgage_products(is_active, bank_id);
create index mortgage_product_versions_product_retrieved_idx
  on public.mortgage_product_versions(product_id, retrieved_at desc);
create index mortgage_source_documents_bank_retrieved_idx
  on public.mortgage_source_documents(bank_id, retrieved_at desc);

create trigger mortgage_banks_set_updated_at
  before update on public.mortgage_banks
  for each row execute function public.set_updated_at();
create trigger mortgage_products_set_updated_at
  before update on public.mortgage_products
  for each row execute function public.set_updated_at();
create trigger mortgage_source_documents_set_updated_at
  before update on public.mortgage_source_documents
  for each row execute function public.set_updated_at();
create trigger mortgage_product_versions_set_updated_at
  before update on public.mortgage_product_versions
  for each row execute function public.set_updated_at();

alter table public.mortgage_banks enable row level security;
alter table public.mortgage_products enable row level security;
alter table public.mortgage_source_documents enable row level security;
alter table public.mortgage_product_versions enable row level security;

create policy mortgage_banks_authenticated_read
  on public.mortgage_banks for select to authenticated using (true);
create policy mortgage_products_authenticated_read
  on public.mortgage_products for select to authenticated using (true);
create policy mortgage_source_documents_authenticated_read
  on public.mortgage_source_documents for select to authenticated using (true);
create policy mortgage_product_versions_authenticated_read
  on public.mortgage_product_versions for select to authenticated using (true);

revoke all on public.mortgage_banks from anon, authenticated;
revoke all on public.mortgage_products from anon, authenticated;
revoke all on public.mortgage_source_documents from anon, authenticated;
revoke all on public.mortgage_product_versions from anon, authenticated;
grant select on public.mortgage_banks to authenticated;
grant select on public.mortgage_products to authenticated;
grant select on public.mortgage_source_documents to authenticated;
grant select on public.mortgage_product_versions to authenticated;
grant all on public.mortgage_banks to service_role;
grant all on public.mortgage_products to service_role;
grant all on public.mortgage_source_documents to service_role;
grant all on public.mortgage_product_versions to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('mortgage-source-documents', 'mortgage-source-documents', false, 20971520)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy mortgage_source_storage_authenticated_read
  on storage.objects for select to authenticated
  using (bucket_id = 'mortgage-source-documents');
