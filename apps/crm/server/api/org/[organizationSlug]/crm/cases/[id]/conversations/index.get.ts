import { setHeader } from 'h3'
import { listCaseConversations } from '~~/server/utils/case-conversations'
import { getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const result = await listCaseConversations(event, getRequiredParam(event, 'id'))
  return { data: result }
})
