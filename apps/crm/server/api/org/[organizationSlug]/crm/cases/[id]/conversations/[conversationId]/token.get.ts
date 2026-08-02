import { createError, setHeader } from 'h3'
import { requireCaseConversationAccess } from '~~/server/utils/case-conversations'
import { getRequiredParam } from '~~/server/utils/crm'
import { createConversationTokenRequest } from '~~/server/utils/messaging-ably'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const access = await requireCaseConversationAccess(
    event,
    getRequiredParam(event, 'id'),
    getRequiredParam(event, 'conversationId'),
  )
  const token = await createConversationTokenRequest(
    event,
    access.conversation.id,
    `staff:${access.session.userId}`,
  )
  if (!token) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Realtime transport is not configured; use polling',
    })
  }
  return { data: token }
})
