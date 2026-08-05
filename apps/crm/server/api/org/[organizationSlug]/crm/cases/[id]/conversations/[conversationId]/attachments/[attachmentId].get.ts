import { getQuery } from 'h3'
import {
  serveStaffMessageAttachment,
} from '~~/server/utils/case-message-attachments'
import {
  requireCaseConversationAccess,
} from '~~/server/utils/case-conversations'
import { getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  const access = await requireCaseConversationAccess(
    event,
    getRequiredParam(event, 'id'),
    getRequiredParam(event, 'conversationId'),
  )
  const download = getQuery(event).download
  return serveStaffMessageAttachment(
    event,
    access,
    getRequiredParam(event, 'attachmentId'),
    download === '1' || download === 'true',
  )
})
