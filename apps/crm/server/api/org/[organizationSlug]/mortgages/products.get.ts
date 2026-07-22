import { getQuery } from 'h3'
import { hasSuperAdminRole, requireCrmSession } from '~~/server/utils/crm'
import { loadMortgageCatalog } from '~~/server/utils/mortgage-catalog'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const superAdmin = await hasSuperAdminRole(session)
  const includeDisabled = getQuery(event).includeDisabled === '1' && superAdmin
  const catalog = await loadMortgageCatalog(session, { includeDisabled })

  return {
    ...catalog,
    role: session.role,
    superAdmin,
  }
})
