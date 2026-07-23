import { getQuery, setHeader } from 'h3'
import { parseCaseSearchFilters, searchCrmCases } from '~~/server/utils/cases'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'no-store')
  const filters = parseCaseSearchFilters(getQuery(event))
  const result = await searchCrmCases(session, filters)

  return {
    data: result.data,
    count: result.count,
    page_info: {
      has_more: result.pageInfo.hasMore,
      offset: result.pageInfo.offset,
      limit: result.pageInfo.limit,
    },
    pageInfo: result.pageInfo,
    facets: result.facets,
  }
})
