import { getQuery } from 'h3'
import { requireCrmSession, textValue, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const query = getQuery(event)
  const search = textValue(query.q)
  const limit = Math.min(Number(query.limit ?? 50) || 50, 100)

  let request = session.supabase
    .from('crm_clients')
    .select('*', { count: 'exact' })
    .eq('organization_id', session.organizationId)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (search) {
    const escaped = search.replaceAll('%', '\\%').replaceAll(',', ' ')
    request = request.or(`display_name.ilike.%${escaped}%,primary_email.ilike.%${escaped}%,primary_phone.ilike.%${escaped}%`)
  }

  const { data, error, count } = await request
  throwDbError(error)

  return { data: data ?? [], count: count ?? 0 }
})
