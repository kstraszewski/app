BEGIN;
SET LOCAL ROLE openexpert_owner;

DO $$
DECLARE
  target_organization_id uuid;
  target_user_id uuid;
  target_document_id uuid := gen_random_uuid();
  target_institution_id uuid;
  other_institution_id uuid;
  test_embedding extensions.vector := (
    '[' || array_to_string(ARRAY[1.0] || array_fill(0.0, ARRAY[767]), ',') || ']'
  )::extensions.vector;
  lexical_matches integer;
  semantic_matches integer;
  institution_matches integer;
  other_institution_matches integer;
BEGIN
  SELECT organization.id, role_assignment.user_id
  INTO target_organization_id, target_user_id
  FROM public.organizations AS organization
  JOIN public.organization_user_admin_roles AS role_assignment
    ON role_assignment.organization_id = organization.id
   AND role_assignment.role_key = 'experiments_access'::text
  WHERE organization.slug = 'openexpert-local'::text
  LIMIT 1;

  IF target_organization_id IS NULL OR target_user_id IS NULL THEN
    RAISE EXCEPTION 'experiment_knowledge_smoke_actor_missing';
  END IF;

  SELECT id INTO target_institution_id
  FROM public.mortgage_banks
  ORDER BY slug
  LIMIT 1;

  SELECT id INTO other_institution_id
  FROM public.mortgage_banks
  WHERE id <> target_institution_id
  ORDER BY slug
  LIMIT 1;

  IF target_institution_id IS NULL OR other_institution_id IS NULL THEN
    RAISE EXCEPTION 'experiment_knowledge_smoke_institutions_missing';
  END IF;

  INSERT INTO public.experiment_knowledge_documents (
    id,
    organization_id,
    owner_user_id,
    kind,
    title,
    text_content,
    plain_text,
    content_sha256,
    indexing_status,
    chunk_count
  ) VALUES (
    target_document_id,
    target_organization_id,
    target_user_id,
    'text',
    'Smoke wiedzy hybrydowej',
    'Unikalna fraza leksykalna kredytometr.',
    'Unikalna fraza leksykalna kredytometr.',
    repeat('a', 64),
    'ready',
    1
  );

  INSERT INTO public.experiment_knowledge_chunks (
    organization_id,
    document_id,
    chunk_index,
    title,
    content,
    token_count,
    source_sha256,
    embedding
  ) VALUES (
    target_organization_id,
    target_document_id,
    0,
    'Smoke wiedzy hybrydowej',
    'Unikalna fraza leksykalna kredytometr.',
    10,
    repeat('b', 64),
    test_embedding
  );

  INSERT INTO public.experiment_knowledge_document_institutions (
    organization_id,
    document_id,
    financial_institution_id,
    linked_by_user_id
  ) VALUES (
    target_organization_id,
    target_document_id,
    target_institution_id,
    target_user_id
  );

  SELECT count(*)
  INTO lexical_matches
  FROM public.search_experiment_knowledge(
    p_organization_id => target_organization_id,
    p_actor_user_id => target_user_id,
    p_query => 'kredytometr',
    p_query_embedding => NULL,
    p_match_count => 10
  ) AS result
  WHERE result.document_id = target_document_id;

  SELECT count(*)
  INTO semantic_matches
  FROM public.search_experiment_knowledge(
    p_organization_id => target_organization_id,
    p_actor_user_id => target_user_id,
    p_query => 'zupełnie inne słowa',
    p_query_embedding => test_embedding,
    p_match_count => 10
  ) AS result
  WHERE result.document_id = target_document_id;

  SELECT count(*)
  INTO institution_matches
  FROM public.search_experiment_knowledge(
    p_organization_id => target_organization_id,
    p_actor_user_id => target_user_id,
    p_query => 'kredytometr',
    p_query_embedding => NULL,
    p_financial_institution_id => target_institution_id,
    p_match_count => 10
  ) AS result
  WHERE result.document_id = target_document_id;

  SELECT count(*)
  INTO other_institution_matches
  FROM public.search_experiment_knowledge(
    p_organization_id => target_organization_id,
    p_actor_user_id => target_user_id,
    p_query => 'kredytometr',
    p_query_embedding => NULL,
    p_financial_institution_id => other_institution_id,
    p_match_count => 10
  ) AS result
  WHERE result.document_id = target_document_id;

  IF lexical_matches <> 1 OR semantic_matches <> 1
    OR institution_matches <> 1 OR other_institution_matches <> 0
  THEN
    RAISE EXCEPTION 'experiment_knowledge_hybrid_search_failed lexical=% semantic=% institution=% other=%',
      lexical_matches,
      semantic_matches,
      institution_matches,
      other_institution_matches;
  END IF;

  RAISE NOTICE 'experiment knowledge search smoke passed (lexical=%, semantic=%, institution=%, other=%)',
    lexical_matches,
    semantic_matches,
    institution_matches,
    other_institution_matches;
END;
$$;

ROLLBACK;
