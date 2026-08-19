import { getQuery } from 'h3'
import { hasSuperAdminRole, requireCrmSession } from '~~/server/utils/crm'
import { loadMortgageCatalog } from '~~/server/utils/mortgage-catalog'
import { isOpenExpertMockBankEnabled } from '~~/server/utils/openexpert-mock-bank-service'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const superAdmin = await hasSuperAdminRole(session)
  const includeDisabled = getQuery(event).includeDisabled === '1' && superAdmin
  const mockBankEnabled = isOpenExpertMockBankEnabled(event, session.organizationId)
  const catalog = await loadMortgageCatalog(session, {
    includeDisabled,
    includeMock: mockBankEnabled,
  })

  return {
    ...catalog,
    role: session.role,
    superAdmin,
  }
})
