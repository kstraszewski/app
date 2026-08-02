import { createError, getQuery, setHeader } from 'h3'
import { canAccessCrmOmnisearch } from '~~/shared/types/omnisearch'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
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
  const forumPromise = (async () => {
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await organizationForumQueryEmbedding(
        String(runtimeConfig.googleGenerativeAiApiKey || ''),
        input.query,
        AbortSignal.timeout(1_500),
      )
    }
    catch (error) {
      console.warn('[crm-omnisearch] Forum query embedding unavailable; using lexical search', error)
    }

    try {
      return await listOrganizationForumThreads(session.dataApi, session.organizationId, {
        query: input.query,
        categoryId: null,
        status: null,
        type: null,
        limit: input.limit,
      }, queryEmbedding)
    }
    catch (error) {
      console.warn('[crm-omnisearch] Forum search unavailable', error)
      return null
    }
  })()

  const [{ data, error }, forum] = await Promise.all([
    session.dataApi.rpc('search_crm_omnisearch', {
      p_organization_id: session.organizationId,
      p_query: input.query,
      p_limit: input.limit,
    }),
    forumPromise,
  ])
  throwDbError(error)

  const payload = {
    ...record(data),
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
