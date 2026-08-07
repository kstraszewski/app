import { ReceiptUpdateInputSchema } from '@openexpert/messaging'
import { createError, readBody, setHeader } from 'h3'
import {
  requireCaseConversationAccess,
  updateStaffConversationReceipt,
} from '~~/server/utils/case-conversations'
import { getRequiredParam } from '~~/server/utils/crm'
import { nudgeNotificationOutbox } from '~~/server/utils/notifications'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const parsed = ReceiptUpdateInputSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Invalid receipt',
    })
  }
  const access = await requireCaseConversationAccess(
    event,
    getRequiredParam(event, 'id'),
    getRequiredParam(event, 'conversationId'),
  )
  const result = await updateStaffConversationReceipt(event, access, parsed.data)
  if (result.notificationsReadCount > 0) await nudgeNotificationOutbox(event)
  return { data: result }
})
