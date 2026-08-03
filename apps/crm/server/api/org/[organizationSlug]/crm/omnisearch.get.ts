import { createError, getQuery, setHeader } from 'h3'
import { canAccessCrmOmnisearch } from '~~/shared/types/omnisearch'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  hasSuperAdminRole,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import { searchMortgageBankFilesForOmnisearch } from '~~/server/utils/mortgage-bank-file-omnisearch'
import {
  mapCrmOmnisearchResponse,
  parseCrmOmnisearchInput,
} from '~~/server/utils/omnisearch'
import {
  listOrganizationForumThreads,
  organizationForumQueryEmbedding,
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
  const queryEmbeddingPromise = (async () => {
    try {
      return await organizationForumQueryEmbedding(
        String(runtimeConfig.googleGenerativeAiApiKey || ''),
        input.query,
        AbortSignal.timeout(1_500),
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
      return await searchMortgageBankFilesForOmnisearch(serverDataBackend(event), {
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

  const [{ data, error }, forum, bankFiles] = await Promise.all([
    session.dataApi.rpc('search_crm_omnisearch', {
      p_organization_id: session.organizationId,
      p_query: input.query,
      p_limit: input.limit,
    }),
    forumPromise,
    bankFilesPromise,
  ])
  throwDbError(error)

  const payload = {
    ...record(data),
    bankFiles,
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
