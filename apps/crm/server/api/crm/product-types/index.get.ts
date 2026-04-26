import { getQuery } from 'h3'
import { requireCrmSession, textValue, throwDbError } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const domain = textValue(getQuery(event).domain)

  let request = session.supabase
    .from('crm_product_types')
    .select('*')
    .eq('is_active', true)
    .order('domain')
    .order('name')

  if (domain) request = request.eq('domain', domain)

  const { data, error } = await request
  throwDbError(error)

  return { data: data ?? [] }
})

