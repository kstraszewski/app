import { SendMessageInputSchema } from '@openexpert/messaging'
import { createError, readBody, setHeader } from 'h3'
import {
  requireCaseConversationAccess,
  sendStaffConversationMessage,
} from '~~/server/utils/case-conversations'
import { getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const parsed = SendMessageInputSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Invalid message',
    })
  }
  const access = await requireCaseConversationAccess(
    event,
    getRequiredParam(event, 'id'),
    getRequiredParam(event, 'conversationId'),
  )
  const result = await sendStaffConversationMessage(event, access, parsed.data)
  return { data: result }
})
