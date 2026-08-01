import { getRouterParam, readBody, setHeader } from 'h3'
import { requiredUuid } from '~~/server/utils/portal-auth'
import { savePortalMultiform } from '~~/server/utils/portal-multiform'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const draft = await savePortalMultiform(event, caseId, await readBody(event))
  return { data: { access: 'unlocked', draft } }
})
