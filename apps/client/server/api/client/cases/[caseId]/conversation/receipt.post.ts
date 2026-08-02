import { ReceiptUpdateInputSchema } from '@openexpert/messaging'
import { createError, getRouterParam, readBody, setHeader } from 'h3'
import {
  requirePortalConversation,
  updatePortalConversationReceipt,
} from '~~/server/utils/portal-conversation'
import { requiredUuid } from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const parsed = ReceiptUpdateInputSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: parsed.error.issues[0]?.message ?? 'Invalid receipt',
    })
  }

  const context = await requirePortalConversation(event, caseId)
  const result = await updatePortalConversationReceipt(event, context, parsed.data)
  return { data: result }
})
