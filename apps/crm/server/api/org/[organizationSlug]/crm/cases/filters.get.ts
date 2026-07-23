import { parseCaseSearchFilters, searchCrmCases } from '~~/server/utils/cases'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const [searchResult, clientsResult] = await Promise.all([
    searchCrmCases(session, parseCaseSearchFilters({ limit: 1 }, { forceFacets: true })),
    session.supabase
      .from('crm_clients')
      .select('id, display_name, primary_email, primary_phone')
      .eq('organization_id', session.organizationId)
      .order('display_name')
      .limit(500),
  ])
  throwDbError(clientsResult.error)

  const facets = searchResult.facets ?? {}
  return {
    clients: clientsResult.data ?? [],
    banks: Array.isArray(facets.banks) ? facets.banks : [],
    offer_counts: facets.offerCounts ?? facets.offer_counts ?? { with: 0, without: 0 },
    date_bounds: facets.dateBounds ?? facets.date_bounds ?? null,
  }
})
