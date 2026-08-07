import { createError, getQuery, setHeader } from 'h3'
import { canAccessCrmOmnisearch } from '~~/shared/types/omnisearch'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  hasAdministrativePermission,
  hasSuperAdminRole,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  experimentKnowledgeInstitutionsByDocumentIds,
  experimentKnowledgeQueryEmbedding,
} from '~~/server/utils/experiment-knowledge'
import { searchMortgageBankFilesForOmnisearch } from '~~/server/utils/mortgage-bank-file-omnisearch'
import {
  mapCrmOmnisearchResponse,
  parseCrmOmnisearchInput,
} from '~~/server/utils/omnisearch'
import {
  listOrganizationForumThreads,
} from '~~/server/utils/organization-forum'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')

  if (!canAccessCrmOmnisearch(session.role)) {
    throw createError({
      statusCode: 403,
      statusMessage: 'CRM organization membership is required',
    })
  }

  const requestQuery = getQuery(event)
  let input
  try {
    input = parseCrmOmnisearchInput(requestQuery.q, requestQuery.limit)
  }
  catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : 'Invalid omnisearch query',
    })
  }

  const runtimeConfig = useRuntimeConfig(event)
  const backendData = serverDataBackend(event)
  const queryEmbeddingPromise = (async () => {
    try {
      return await experimentKnowledgeQueryEmbedding(
        String(runtimeConfig.googleGenerativeAiApiKey || ''),
        String(runtimeConfig.aiGatewayApiKey || ''),
        input.query,
        AbortSignal.timeout(2_000),
      )
    }
    catch (error) {
      console.warn('[crm-omnisearch] Query embedding unavailable; using lexical search', error)
      return null
    }
  })()

  const forumPromise = (async () => {
    try {
      return await listOrganizationForumThreads(session.dataApi, session.organizationId, {
        query: input.query,
        categoryId: null,
        status: null,
        type: null,
        limit: input.limit,
      }, await queryEmbeddingPromise)
    }
    catch (error) {
      console.warn('[crm-omnisearch] Forum search unavailable', error)
      return null
    }
  })()

  const bankFilesPromise = (async () => {
    try {
      if (!await hasSuperAdminRole(session)) return []
      return await searchMortgageBankFilesForOmnisearch(backendData, {
        query: input.query,
        limit: input.limit,
        queryEmbedding: await queryEmbeddingPromise,
      })
    }
    catch (error) {
      console.warn('[crm-omnisearch] Bank-file search unavailable', error)
      return []
    }
  })()

  const knowledgePromise = (async () => {
    try {
      if (!await hasAdministrativePermission(session, 'experiments.use')) return []
      const result = await backendData.rpc('search_experiment_knowledge', {
        p_organization_id: session.organizationId,
        p_actor_user_id: session.userId,
        p_query: input.query,
        p_query_embedding: await queryEmbeddingPromise,
        p_kind: null,
        p_financial_institution_id: null,
        p_match_count: input.limit,
        p_full_text_weight: 1.35,
        p_semantic_weight: 1,
        p_rrf_k: 50,
      })
      if (result.error) throw result.error

      const rows = Array.isArray(result.data)
        ? result.data.map(record).filter(row => Object.keys(row).length > 0)
        : []
      const institutionsByDocument = await experimentKnowledgeInstitutionsByDocumentIds(
        { session, backendData },
        rows.map(row => String(row.document_id)),
      )

      return rows.map(row => ({
        document_id: row.document_id,
        kind: row.kind,
        title: row.title,
        snippet: row.snippet,
        indexing_status: row.indexing_status,
        updated_at: row.updated_at,
        score: row.score,
        institution_names: institutionsByDocument
          .get(String(row.document_id))
          ?.map(institution => institution.name) ?? [],
      }))
    }
    catch (error) {
      console.warn('[crm-omnisearch] Knowledge search unavailable', error)
      return []
    }
  })()

  const [{ data, error }, forum, bankFiles, knowledge] = await Promise.all([
    session.dataApi.rpc('search_crm_omnisearch', {
      p_organization_id: session.organizationId,
      p_query: input.query,
      p_limit: input.limit,
    }),
    forumPromise,
    bankFilesPromise,
    knowledgePromise,
  ])
  throwDbError(error)

  const payload = {
    ...record(data),
    bankFiles,
    knowledge,
    forum: forum?.threads.map(thread => ({
      id: thread.id,
      title: thread.title,
      type: thread.type,
      status: thread.status,
      category_name: thread.category.name,
      matched_in: Array.isArray(thread.matchedIn)
        ? thread.matchedIn.join(', ')
        : thread.matchedIn,
      excerpt: thread.snippet || thread.excerpt,
    })) ?? [],
  }

  return mapCrmOmnisearchResponse(payload, session.organizationSlug, input.query)
})
