import { ReserveMessageAttachmentInputSchema } from '@openexpert/messaging'
import { createError, getRouterParam, readBody, setHeader } from 'h3'
import { requiredUuid } from '~~/server/utils/portal-auth'
import {
  requirePortalConversation,
} from '~~/server/utils/portal-conversation'
import {
  reservePortalMessageAttachment,
} from '~~/server/utils/portal-message-attachments'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const parsed = ReserveMessageAttachmentInputSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Invalid attachment',
    })
  }
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const context = await requirePortalConversation(event, caseId)
  const result = await reservePortalMessageAttachment(event, context, parsed.data)
  return { data: result }
})
