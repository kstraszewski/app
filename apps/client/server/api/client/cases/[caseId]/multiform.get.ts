import { getRouterParam, setHeader } from 'h3'
import { loadPortalMultiform } from '~~/server/utils/portal-multiform'
import { requiredUuid } from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const { data } = await loadPortalMultiform(event, caseId)
  return { data }
})
