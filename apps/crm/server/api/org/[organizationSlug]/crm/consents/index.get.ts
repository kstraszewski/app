import { getQuery } from 'h3'
import { loadConsentDefinitions } from '~~/server/utils/consents'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const activeOnly = getQuery(event).active === '1'
  const definitions = await loadConsentDefinitions(session, { activeOnly })

  return {
    role: session.role,
    canManage: session.role === 'admin',
    definitions,
  }
})

