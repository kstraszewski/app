import { getQuery, setHeader } from 'h3'
import {
  parseClientSearchFilters,
  searchCrmClients,
} from '~~/server/utils/clients'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const filters = parseClientSearchFilters(getQuery(event), session)
  const result = await searchCrmClients(session, filters)
  const nextCursorToken = result.pageInfo.nextCursor
    ? Buffer.from(JSON.stringify(result.pageInfo.nextCursor), 'utf8').toString('base64url')
    : null

  return {
    data: result.data,
    count: result.count,
    page_info: {
      has_more: result.pageInfo.hasMore,
      next_cursor: nextCursorToken,
      next_cursor_token: nextCursorToken,
      offset: result.pageInfo.offset,
      limit: result.pageInfo.limit,
    },
    // Camel-case aliases make the response convenient for API consumers while
    // the original data/count shape and the UI-oriented snake-case keys remain.
    pageInfo: result.pageInfo,
    next_cursor: nextCursorToken,
    next_cursor_token: nextCursorToken,
    has_more: result.pageInfo.hasMore,
    facets: result.facets,
  }
})
