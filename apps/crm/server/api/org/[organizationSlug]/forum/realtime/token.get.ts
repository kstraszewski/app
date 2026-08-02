import { createError, setHeader } from 'h3'
import { createOrganizationForumTokenRequest } from '~~/server/utils/organization-forum-realtime'
import { requireCrmSession } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  setHeader(event, 'Cache-Control', 'private, no-store')

  const token = await createOrganizationForumTokenRequest(
    event,
    session.organizationId,
    session.userId,
  )
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Realtime transport is not configured; use polling',
    })
  }

  return { data: token }
})
