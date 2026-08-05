import { getQuery, getRouterParam } from 'h3'
import { requiredUuid } from '~~/server/utils/portal-auth'
import {
  requirePortalConversation,
} from '~~/server/utils/portal-conversation'
import {
  servePortalMessageAttachment,
} from '~~/server/utils/portal-message-attachments'

export default defineEventHandler(async (event) => {
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const context = await requirePortalConversation(event, caseId)
  const download = getQuery(event).download
  return servePortalMessageAttachment(
    event,
    context,
    getRouterParam(event, 'attachmentId'),
    download === '1' || download === 'true',
  )
})
