import { setHeader } from 'h3'
import { requireAvailablePortalIdentity } from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  await requireAvailablePortalIdentity(event)

  return {
    data: { available: true },
  }
})
