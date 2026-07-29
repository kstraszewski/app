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
  with query_terms as (
    select distinct term.lexeme
    from unnest(
      tsvector_to_array(
        to_tsvector('simple'::regconfig, coalesce(query_text, ''))
      )
    ) as term(lexeme)
    where term.lexeme <> ''
  ),
  search_query as (
    select case
      when count(*) = 0 then null::tsquery
      else to_tsquery(
        'simple'::regconfig,
        string_agg(quote_literal(query_terms.lexeme) || ':*', ' & ' order by query_terms.lexeme)
      )
    end as value
    from query_terms
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
    where search_query.value is not null
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
      replace(
        replace(
          ts_headline(
            'simple'::regconfig,
            eligible.content,
            search_query.value,
            'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=26,MinWords=8,FragmentDelimiter= … '
          ),
          '<mark>',
          ''
        ),
        '</mark>',
        ''
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
