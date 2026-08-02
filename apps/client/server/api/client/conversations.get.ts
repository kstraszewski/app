import { setHeader } from 'h3'
import { listPortalConversationSummaries } from '~~/server/utils/portal-conversation'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const conversations = await listPortalConversationSummaries(event)
  return { data: { conversations } }
})
