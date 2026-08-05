import { setHeader } from 'h3'
import {
  completeStaffMessageAttachment,
} from '~~/server/utils/case-message-attachments'
import {
  requireCaseConversationAccess,
} from '~~/server/utils/case-conversations'
import { getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const access = await requireCaseConversationAccess(
    event,
    getRequiredParam(event, 'id'),
    getRequiredParam(event, 'conversationId'),
  )
  const attachment = await completeStaffMessageAttachment(
    event,
    access,
    getRequiredParam(event, 'attachmentId'),
  )
  return { data: { attachment } }
})
