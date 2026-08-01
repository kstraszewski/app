import { createError, getRouterParam, setHeader } from 'h3'
import { loadPortalCases } from '~~/server/utils/portal-cases'
import { requiredUuid } from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const { cases } = await loadPortalCases(event)
  const portalCase = cases.find(candidate => candidate.id === caseId)
  if (!portalCase) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }
  return { data: portalCase }
})
