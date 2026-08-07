import { getQuery, getRouterParam, setHeader } from 'h3'
import {
  loadPortalConversationSnapshot,
  parseConversationPageQuery,
  parsePortalConversationThread,
  requirePortalConversation,
} from '~~/server/utils/portal-conversation'
import { requiredUuid } from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const query = getQuery(event)
  const context = await requirePortalConversation(
    event,
    caseId,
    parsePortalConversationThread(query.thread),
  )
  const page = parseConversationPageQuery(query)
  const snapshot = await loadPortalConversationSnapshot(event, context, page)
  return { data: snapshot }
})
