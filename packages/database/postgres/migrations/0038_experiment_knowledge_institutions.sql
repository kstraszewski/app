-- Relate organization knowledge documents to the shared mortgage institution
-- catalogue. A document may describe more than one institution.

CREATE TABLE public.experiment_knowledge_document_institutions (
  organization_id uuid NOT NULL,
  document_id uuid NOT NULL,
  financial_institution_id uuid NOT NULL,
  linked_by_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT experiment_knowledge_document_institutions_pkey
    PRIMARY KEY (document_id, financial_institution_id),
  CONSTRAINT experiment_knowledge_document_institutions_document_fkey
    FOREIGN KEY (organization_id, document_id)
    REFERENCES public.experiment_knowledge_documents(organization_id, id)
    ON DELETE CASCADE,
  CONSTRAINT experiment_knowledge_document_institutions_institution_fkey
    FOREIGN KEY (financial_institution_id)
    REFERENCES public.mortgage_banks(id)
    ON DELETE RESTRICT,
  CONSTRAINT experiment_knowledge_document_institutions_actor_fkey
    FOREIGN KEY (organization_id, linked_by_user_id)
    REFERENCES public.organization_memberships(organization_id, user_id)
);

COMMENT ON TABLE public.experiment_knowledge_document_institutions IS
  'Many-to-many links between organization knowledge and financial institutions.';

CREATE INDEX experiment_knowledge_document_institutions_filter_idx
  ON public.experiment_knowledge_document_institutions (
    organization_id,
    financial_institution_id,
    document_id
  );

ALTER TABLE public.experiment_knowledge_document_institutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY openexpert_service_all
  ON public.experiment_knowledge_document_institutions
  FOR ALL TO openexpert_service
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.experiment_knowledge_document_institutions
  FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.experiment_knowledge_document_institutions
  TO openexpert_service;

DROP FUNCTION public.search_experiment_knowledge(
  uuid,
  uuid,
  text,
  extensions.vector,
  text,
  integer,
  double precision,
  double precision,
  integer
);

CREATE FUNCTION public.search_experiment_knowledge(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_query text,
  p_query_embedding extensions.vector DEFAULT NULL::extensions.vector,
  p_kind text DEFAULT NULL::text,
  p_financial_institution_id uuid DEFAULT NULL::uuid,
  p_match_count integer DEFAULT 30,
  p_full_text_weight double precision DEFAULT 1.35,
  p_semantic_weight double precision DEFAULT 1.0,
  p_rrf_k integer DEFAULT 50
) RETURNS TABLE(
  document_id uuid,
  chunk_id bigint,
  kind text,
  title text,
  snippet text,
  indexing_status text,
  updated_at timestamp with time zone,
  score double precision
)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $$
DECLARE
  normalized_query text := nullif(regexp_replace(btrim(coalesce(p_query, '')), '\s+', ' ', 'g'), '');
  candidate_limit integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_memberships AS membership
    JOIN public.organization_user_admin_roles AS role_assignment
      ON role_assignment.organization_id = membership.organization_id
     AND role_assignment.user_id = membership.user_id
     AND role_assignment.role_key = 'experiments_access'::text
    WHERE membership.organization_id = p_organization_id
      AND membership.user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION 'experiments_access_required' USING errcode = '42501';
  END IF;

  IF normalized_query IS NULL
    OR char_length(normalized_query) > 300
    OR (p_kind IS NOT NULL AND p_kind <> ALL (ARRAY['text'::text, 'dynamic_html'::text]))
    OR p_match_count NOT BETWEEN 1 AND 100
    OR p_full_text_weight < 0
    OR p_semantic_weight < 0
    OR p_rrf_k NOT BETWEEN 1 AND 1000
  THEN
    RAISE EXCEPTION 'invalid_experiment_knowledge_search_request' USING errcode = '22023';
  END IF;

  candidate_limit := least(300, greatest(60, p_match_count * 5));

  RETURN QUERY
  WITH query_terms AS MATERIALIZED (
    SELECT DISTINCT term.lexeme
    FROM unnest(
      tsvector_to_array(to_tsvector('simple'::regconfig, normalized_query))
    ) AS term(lexeme)
    WHERE term.lexeme <> ''::text
  ),
  search_query AS MATERIALIZED (
    SELECT CASE
      WHEN count(*) = 0 THEN NULL::tsquery
      ELSE to_tsquery(
        'simple'::regconfig,
        string_agg(quote_literal(query_terms.lexeme) || ':*', ' & ' ORDER BY query_terms.lexeme)
      )
    END AS value
    FROM query_terms
  ),
  eligible AS MATERIALIZED (
    SELECT
      chunk.id AS chunk_id,
      chunk.document_id,
      chunk.content,
      chunk.search_vector,
      chunk.embedding,
      document.kind,
      document.title,
      document.indexing_status,
      document.updated_at
    FROM public.experiment_knowledge_chunks AS chunk
    JOIN public.experiment_knowledge_documents AS document
      ON document.organization_id = chunk.organization_id
     AND document.id = chunk.document_id
    WHERE chunk.organization_id = p_organization_id
      AND document.archived_at IS NULL
      AND (p_kind IS NULL OR document.kind = p_kind)
      AND (
        p_financial_institution_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.experiment_knowledge_document_institutions AS institution_link
          WHERE institution_link.organization_id = document.organization_id
            AND institution_link.document_id = document.id
            AND institution_link.financial_institution_id = p_financial_institution_id
        )
      )
  ),
  lexical AS MATERIALIZED (
    SELECT
      eligible.chunk_id,
      row_number() OVER (
        ORDER BY ts_rank_cd(eligible.search_vector, search_query.value) DESC, eligible.chunk_id
      ) AS rank_ix,
      regexp_replace(
        replace(
          replace(
            ts_headline(
              'simple'::regconfig,
              eligible.content,
              search_query.value,
              'StartSel=<mark>,StopSel=</mark>,MaxFragments=2,MaxWords=32,MinWords=8,FragmentDelimiter= … '
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
      ) AS snippet
    FROM eligible
    CROSS JOIN search_query
    WHERE search_query.value IS NOT NULL
      AND eligible.search_vector @@ search_query.value
    ORDER BY ts_rank_cd(eligible.search_vector, search_query.value) DESC, eligible.chunk_id
    LIMIT candidate_limit
  ),
  semantic AS MATERIALIZED (
    SELECT
      eligible.chunk_id,
      row_number() OVER (
        ORDER BY eligible.embedding OPERATOR(extensions.<=>) p_query_embedding, eligible.chunk_id
      ) AS rank_ix
    FROM eligible
    WHERE p_query_embedding IS NOT NULL
      AND eligible.embedding IS NOT NULL
    ORDER BY eligible.embedding OPERATOR(extensions.<=>) p_query_embedding, eligible.chunk_id
    LIMIT candidate_limit
  ),
  fused AS MATERIALIZED (
    SELECT
      coalesce(lexical.chunk_id, semantic.chunk_id) AS chunk_id,
      lexical.snippet,
      coalesce(p_full_text_weight / (p_rrf_k + lexical.rank_ix), 0.0)
        + coalesce(p_semantic_weight / (p_rrf_k + semantic.rank_ix), 0.0) AS score
    FROM lexical
    FULL JOIN semantic USING (chunk_id)
  ),
  per_document AS (
    SELECT
      eligible.document_id,
      eligible.chunk_id,
      eligible.kind,
      eligible.title,
      coalesce(
        fused.snippet,
        left(regexp_replace(eligible.content, '\s+', ' ', 'g'), 420)
      ) AS snippet,
      eligible.indexing_status,
      eligible.updated_at,
      fused.score,
      row_number() OVER (
        PARTITION BY eligible.document_id
        ORDER BY fused.score DESC, eligible.chunk_id
      ) AS document_rank
    FROM fused
    JOIN eligible USING (chunk_id)
  )
  SELECT
    per_document.document_id,
    per_document.chunk_id,
    per_document.kind,
    per_document.title,
    per_document.snippet,
    per_document.indexing_status,
    per_document.updated_at,
    per_document.score
  FROM per_document
  WHERE per_document.document_rank = 1
  ORDER BY per_document.score DESC, per_document.updated_at DESC, per_document.document_id
  LIMIT p_match_count;
END;
$$;

COMMENT ON FUNCTION public.search_experiment_knowledge(
  uuid,
  uuid,
  text,
  extensions.vector,
  text,
  uuid,
  integer,
  double precision,
  double precision,
  integer
) IS
  'Experiments-authorized weighted RRF search over organization knowledge, optionally filtered by financial institution.';

REVOKE ALL ON FUNCTION public.search_experiment_knowledge(
  uuid,
  uuid,
  text,
  extensions.vector,
  text,
  uuid,
  integer,
  double precision,
  double precision,
  integer
) FROM PUBLIC, anonymous, authenticated, openexpert_service;
GRANT EXECUTE ON FUNCTION public.search_experiment_knowledge(
  uuid,
  uuid,
  text,
  extensions.vector,
  text,
  uuid,
  integer,
  double precision,
  double precision,
  integer
) TO openexpert_service;
