import { defineTool } from 'eve/tools'
import { z } from 'zod'
import { requireCrmAgentCaller } from '../lib/caller'
import { createAgentServiceClient } from '../lib/data-api'

const caseScopeSchema = z.enum(['mine', 'organization'])

export default defineTool({
  description: 'List or search CRM cases visible in the authenticated user’s current organization. Use scope mine for the caller’s own cases and organization only when they explicitly ask for all organization cases.',
  inputSchema: z.object({
    query: z.string().trim().min(1).max(120).optional()
      .describe('Optional fragment of the case title.'),
    scope: caseScopeSchema.default('mine')
      .describe('mine returns cases assigned to the caller; organization returns all cases in the verified organization.'),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  async execute({ query: searchText, scope, limit }, ctx) {
    const caller = requireCrmAgentCaller(ctx)
    const dataApi = createAgentServiceClient()
    const fixedCaseId = caller.invocation?.scope.caseId
    let casesQuery = dataApi
      .from('crm_cases')
      .select('id, title, status_code, priority, progress_percent, owner_user_id, updated_at', { count: 'exact' })
      .eq('organization_id', caller.organizationId)
      .order('updated_at', { ascending: false })
      .limit(fixedCaseId ? 1 : limit)

    if (fixedCaseId) casesQuery = casesQuery.eq('id', fixedCaseId)
    else if (scope === 'mine') casesQuery = casesQuery.eq('owner_user_id', caller.userId)
    if (!fixedCaseId && searchText) {
      const escapedSearch = searchText.replace(/[\\%_]/g, value => `\\${value}`)
      casesQuery = casesQuery.ilike('title', `%${escapedSearch}%`)
    }

    const { data: cases, error: casesError, count } = await casesQuery
    if (casesError) throw new Error(`Nie udało się pobrać spraw: ${casesError.message}`)

    const caseRows = cases ?? []
    const caseIds = caseRows.map(item => String(item.id))
    const ownerIds = [...new Set(caseRows
      .map(item => item.owner_user_id ? String(item.owner_user_id) : null)
      .filter((value): value is string => Boolean(value)))]

    const [linksResult, ownersResult] = await Promise.all([
      caseIds.length
        ? dataApi
            .from('crm_case_clients')
            .select('case_id, client_id, is_primary')
            .eq('organization_id', caller.organizationId)
            .in('case_id', caseIds)
            .order('is_primary', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      ownerIds.length
        ? dataApi
            .from('users')
            .select('id, full_name, email')
            .in('id', ownerIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (linksResult.error) throw new Error(`Nie udało się pobrać klientów spraw: ${linksResult.error.message}`)
    if (ownersResult.error) throw new Error(`Nie udało się pobrać opiekunów spraw: ${ownersResult.error.message}`)

    const links = linksResult.data ?? []
    const clientIds = [...new Set(links.map(link => String(link.client_id)))]
    const clientsResult = clientIds.length
      ? await dataApi
          .from('crm_clients')
          .select('id, display_name')
          .eq('organization_id', caller.organizationId)
          .in('id', clientIds)
      : { data: [], error: null }
    if (clientsResult.error) throw new Error(`Nie udało się pobrać nazw klientów: ${clientsResult.error.message}`)

    const clientNameById = new Map((clientsResult.data ?? []).map(client => [
      String(client.id),
      String(client.display_name),
    ]))
    const ownerById = new Map((ownersResult.data ?? []).map(owner => [
      String(owner.id),
      String(owner.full_name || owner.email || 'Nie przypisano'),
    ]))
    const clientsByCaseId = new Map<string, string[]>()
    for (const link of links) {
      const caseId = String(link.case_id)
      const name = clientNameById.get(String(link.client_id))
      if (!name) continue
      const names = clientsByCaseId.get(caseId) ?? []
      names.push(name)
      clientsByCaseId.set(caseId, names)
    }

    return {
      scope: fixedCaseId ? 'fixed-invocation' : scope,
      total: count ?? caseRows.length,
      cases: caseRows.map(item => ({
        title: String(item.title),
        statusCode: String(item.status_code),
        priority: String(item.priority),
        progressPercent: Number(item.progress_percent ?? 0),
        updatedAt: String(item.updated_at),
        clients: clientsByCaseId.get(String(item.id)) ?? [],
        owner: item.owner_user_id
          ? ownerById.get(String(item.owner_user_id)) ?? 'Nie przypisano'
          : 'Nie przypisano',
        url: `/org/${encodeURIComponent(caller.organizationSlug)}/cases/${encodeURIComponent(String(item.id))}`,
      })),
    }
  },
})
