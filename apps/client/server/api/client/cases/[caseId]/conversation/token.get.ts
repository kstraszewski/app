import { createError, getRouterParam, setHeader } from 'h3'
import { createConversationTokenRequest } from '~~/server/utils/messaging-ably'
import { requirePortalConversation } from '~~/server/utils/portal-conversation'
import { requiredUuid } from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const context = await requirePortalConversation(event, caseId)
  const token = await createConversationTokenRequest(
    event,
    context.conversation.id,
    `client:${context.access.session.identity.userId}`,
  )
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Realtime transport is not configured; use polling',
    })
  }
  return { data: token }
})
