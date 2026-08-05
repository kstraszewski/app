import { ReserveMessageAttachmentInputSchema } from '@openexpert/messaging'
import { createError, readBody, setHeader } from 'h3'
import {
  reserveStaffMessageAttachment,
} from '~~/server/utils/case-message-attachments'
import {
  requireCaseConversationAccess,
} from '~~/server/utils/case-conversations'
import { getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const parsed = ReserveMessageAttachmentInputSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Invalid attachment',
    })
  }
  const access = await requireCaseConversationAccess(
    event,
    getRequiredParam(event, 'id'),
    getRequiredParam(event, 'conversationId'),
  )
  const result = await reserveStaffMessageAttachment(event, access, parsed.data)
  return { data: result }
})
