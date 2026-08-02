import { getQuery, getRouterParam, setHeader } from 'h3'
import {
  loadPortalConversationSnapshot,
  parseConversationPageQuery,
  requirePortalConversation,
} from '~~/server/utils/portal-conversation'
import { requiredUuid } from '~~/server/utils/portal-auth'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const caseId = requiredUuid(getRouterParam(event, 'caseId'), 'caseId')
  const context = await requirePortalConversation(event, caseId)
  const page = parseConversationPageQuery(getQuery(event))
  const snapshot = await loadPortalConversationSnapshot(event, context, page)
  return { data: snapshot }
})
