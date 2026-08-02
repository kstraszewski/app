import { getQuery, setHeader } from 'h3'
import {
  loadCaseConversationSnapshot,
  parseConversationPageQuery,
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
  const snapshot = await loadCaseConversationSnapshot(
    event,
    access,
    parseConversationPageQuery(getQuery(event)),
  )
  return { data: snapshot }
})
