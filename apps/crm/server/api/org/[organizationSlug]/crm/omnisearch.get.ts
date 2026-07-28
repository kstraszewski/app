import { createError, getQuery, setHeader } from 'h3'
import { canAccessCrmOmnisearch } from '~~/shared/types/omnisearch'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import {
  mapCrmOmnisearchResponse,
  parseCrmOmnisearchInput,
} from '~~/server/utils/omnisearch'

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

  const { data, error } = await session.supabase.rpc('search_crm_omnisearch', {
    p_organization_id: session.organizationId,
    p_query: input.query,
    p_limit: input.limit,
  })
  throwDbError(error)

  return mapCrmOmnisearchResponse(data, session.organizationSlug, input.query)
})
