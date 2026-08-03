import { setHeader } from 'h3'
import { listCrmConversationInbox } from '~~/server/utils/case-conversation-inbox'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  return { data: await listCrmConversationInbox(event) }
})
