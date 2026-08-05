import { getRouterParam, setHeader } from 'h3'
import { requiredUuid } from '~~/server/utils/portal-auth'
import {
  requirePortalConversation,
} from '~~/server/utils/portal-conversation'
import {
  discardPortalMessageAttachment,
} from '~~/server/utils/portal-message-attachments'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const context = await requirePortalConversation(event, caseId)
  await discardPortalMessageAttachment(
    event,
    context,
    getRouterParam(event, 'attachmentId'),
  )
  return { data: { discarded: true } }
})
