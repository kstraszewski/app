import { SendMessageInputSchema } from '@openexpert/messaging'
import { randomUUID } from 'node:crypto'
import { createError, getQuery, getRouterParam, readBody, setHeader } from 'h3'
import {
  asRecord,
  requiredUuid,
} from '~~/server/utils/portal-auth'
import {
  parsePortalConversationThread,
  requirePortalConversation,
  sendPortalConversationMessage,
} from '~~/server/utils/portal-conversation'

/**
 * Backwards-compatible adapter for clients released before the conversation
 * API. New clients use /conversation and supply their own idempotency key.
 */
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const body = asRecord(await readBody(event))
  if (Object.keys(body).some(key => key !== 'message')) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported message field' })
  }

  const parsed = SendMessageInputSchema.safeParse({
    body: body.message,
    clientMessageId: randomUUID(),
  })
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Message must contain between 1 and 4000 characters',
    })
  }
  const context = await requirePortalConversation(
    event,
    caseId,
    parsePortalConversationThread(getQuery(event).thread),
  )
  const result = await sendPortalConversationMessage(event, context, parsed.data)

  return {
    data: {
      id: result.message.id,
      conversationId: result.message.conversationId,
      sequence: result.message.sequence,
      createdAt: result.message.createdAt,
      sent: true,
      delivered: false,
    },
  }
})
