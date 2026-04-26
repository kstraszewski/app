import { getQuery } from 'h3'
import { requireCrmSession, textValue, throwDbError } from '~~/server/utils/crm'

type Row = Record<string, any>

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const query = getQuery(event)
  const search = textValue(query.q)
  const clientId = textValue(query.client_id)
  const status = textValue(query.status_code)
  const limit = Math.min(Number(query.limit ?? 50) || 50, 100)

  let request = session.supabase
    .from('crm_cases')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (clientId) request = request.eq('client_id', clientId)
  if (status) request = request.eq('status_code', status)
  if (search) {
    const escaped = search.replaceAll('%', '\\%').replaceAll(',', ' ')
    request = request.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%`)
  }

  const { data: cases, error, count } = await request
  throwDbError(error)

  const clientIds = [...new Set(((cases ?? []) as Row[]).map((item: Row) => item.client_id).filter(Boolean))]
  const caseIds = [...new Set(((cases ?? []) as Row[]).map((item: Row) => item.id).filter(Boolean))]

  const [clientsResult, itemsResult] = await Promise.all([
    clientIds.length
      ? session.supabase.from('crm_clients').select('id, display_name, status_code, primary_email, primary_phone').in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    caseIds.length
      ? session.supabase.from('crm_case_items').select('id, case_id, product_type_id, title, status_code, amount_value, currency, updated_at').in('case_id', caseIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  throwDbError(clientsResult.error)
  throwDbError(itemsResult.error)

  const clientsById = new Map(((clientsResult.data ?? []) as Row[]).map((client: Row) => [String(client.id), client]))
  const itemsByCase = new Map<string, unknown[]>()
  for (const item of (itemsResult.data ?? []) as Row[]) {
    const caseKey = String(item.case_id)
    itemsByCase.set(caseKey, [...(itemsByCase.get(caseKey) ?? []), item])
  }

  return {
    data: ((cases ?? []) as Row[]).map((caseRow: Row) => ({
      ...caseRow,
      client: clientsById.get(String(caseRow.client_id)) ?? null,
      items: itemsByCase.get(String(caseRow.id)) ?? [],
    })),
    count: count ?? 0,
  }
})
