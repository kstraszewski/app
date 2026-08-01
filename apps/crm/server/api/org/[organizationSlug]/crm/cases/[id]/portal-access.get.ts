import { createError, setHeader } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import { getClientPortalAccess } from '~~/server/utils/client-portal-access'
import { getRequiredParam, requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  setHeader(event, 'Cache-Control', 'private, no-store')
  return getClientPortalAccess(event, session, caseId)
})
