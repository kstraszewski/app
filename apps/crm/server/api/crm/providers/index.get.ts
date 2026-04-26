import { getQuery } from 'h3'
import { requireCrmSession, textValue, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const kind = textValue(getQuery(event).kind)

  let request = session.supabase
    .from('crm_providers')
    .select('*')
    .eq('is_active', true)
    .order('kind')
    .order('name')

  if (kind) request = request.eq('kind', kind)

  const { data, error } = await request
  throwDbError(error)

  return { data: data ?? [] }
})

