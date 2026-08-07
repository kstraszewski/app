import { useRuntimeConfig } from '#imports'
import { getQuery } from 'h3'
import {
  experimentKnowledgeInstitutionsByDocumentIds,
  experimentKnowledgeQueryEmbedding,
  experimentKnowledgeUuid,
  listExperimentKnowledgeInstitutions,
  requireExperimentKnowledgeAccess,
} from '~~/server/utils/experiment-knowledge'

type DatabaseRecord = Record<string, any>

function firstQueryValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function optionalText(value: unknown, maximum: number) {
  const input = firstQueryValue(value)
  if (typeof input !== 'string') return null
  const normalized = input.replace(/\s+/gu, ' ').trim()
  return normalized ? normalized.slice(0, maximum) : null
}

export default defineEventHandler(async (event) => {
  const context = await requireExperimentKnowledgeAccess(event)
  const query = getQuery(event)
  const searchText = optionalText(query.q, 300)
  const requestedKind = optionalText(query.kind, 40)
  const kind = requestedKind === 'text' || requestedKind === 'dynamic_html'
    ? requestedKind
    : null
  const requestedInstitutionId = optionalText(query.institutionId, 40)
  const institutionId = requestedInstitutionId
    ? experimentKnowledgeUuid(requestedInstitutionId, 'institutionId')
    : null
  const institutions = await listExperimentKnowledgeInstitutions(context)

  if (!searchText) {
    let filteredDocumentIds: string[] | null = null
    if (institutionId) {
      const linksResult = await context.backendData
        .from('experiment_knowledge_document_institutions')
        .select('document_id')
        .eq('organization_id', context.session.organizationId)
        .eq('financial_institution_id', institutionId)
      if (linksResult.error) throw linksResult.error
      const linkedDocumentIds: string[] = (linksResult.data ?? [])
        .map((row: DatabaseRecord) => String(row.document_id))
      if (!linkedDocumentIds.length) {
        return {
          data: [],
          meta: { query: null, kind, institutionId, institutions, usedSemanticSearch: false },
        }
      }
      filteredDocumentIds = linkedDocumentIds
    }

    let request = context.backendData
      .from('experiment_knowledge_documents')
      .select('id, owner_user_id, kind, title, plain_text, revision, indexing_status, indexing_error, embedding_model, chunk_count, created_at, updated_at')
      .eq('organization_id', context.session.organizationId)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(100)
    if (kind) request = request.eq('kind', kind)
    if (filteredDocumentIds) request = request.in('id', filteredDocumentIds)
    const result = await request
    if (result.error) throw result.error
    const rows = (result.data ?? []) as DatabaseRecord[]
    const institutionsByDocument = await experimentKnowledgeInstitutionsByDocumentIds(
      context,
      rows.map(row => String(row.id)),
    )

    return {
      data: rows.map(row => ({
        id: String(row.id),
        ownerUserId: String(row.owner_user_id),
        kind: String(row.kind),
        title: String(row.title),
        snippet: String(row.plain_text).replace(/\s+/gu, ' ').slice(0, 260),
        revision: Number(row.revision),
        indexingStatus: String(row.indexing_status),
        indexingError: row.indexing_error === null ? null : String(row.indexing_error),
        embeddingModel: String(row.embedding_model),
        chunkCount: Number(row.chunk_count),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        score: null,
        institutions: institutionsByDocument.get(String(row.id)) ?? [],
      })),
      meta: { query: null, kind, institutionId, institutions, usedSemanticSearch: false },
    }
  }

  const runtimeConfig = useRuntimeConfig(event)
  const googleApiKey = String(runtimeConfig.googleGenerativeAiApiKey || '').trim()
  let queryEmbedding: number[] | null = null
  try {
    queryEmbedding = await experimentKnowledgeQueryEmbedding(
      googleApiKey,
      String(runtimeConfig.aiGatewayApiKey || '').trim(),
      searchText,
      AbortSignal.timeout(2_500),
    )
  }
  catch {
    queryEmbedding = null
  }

  const result = await context.backendData.rpc('search_experiment_knowledge', {
    p_organization_id: context.session.organizationId,
    p_actor_user_id: context.session.userId,
    p_query: searchText,
    p_query_embedding: queryEmbedding,
    p_kind: kind,
    p_financial_institution_id: institutionId,
    p_match_count: 60,
    p_full_text_weight: 1.35,
    p_semantic_weight: 1,
    p_rrf_k: 50,
  })
  if (result.error) throw result.error
  const rows = (result.data ?? []) as DatabaseRecord[]
  const institutionsByDocument = await experimentKnowledgeInstitutionsByDocumentIds(
    context,
    rows.map(row => String(row.document_id)),
  )

  return {
    data: rows.map(row => ({
      id: String(row.document_id),
      kind: String(row.kind),
      title: String(row.title),
      snippet: String(row.snippet ?? '').replace(/\s+/gu, ' ').trim(),
      indexingStatus: String(row.indexing_status),
      updatedAt: String(row.updated_at),
      score: Number(row.score),
      institutions: institutionsByDocument.get(String(row.document_id)) ?? [],
    })),
    meta: { query: searchText, kind, institutionId, institutions, usedSemanticSearch: Boolean(queryEmbedding) },
  }
})
