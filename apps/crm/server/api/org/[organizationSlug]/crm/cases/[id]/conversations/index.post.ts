import { createError, readBody, setHeader } from 'h3'
import {
  ensureCaseConversation,
  loadCaseConversationSnapshot,
} from '~~/server/utils/case-conversations'
import { asRecord, getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = asRecord(await readBody(event))
  if (Object.keys(body).some(key => key !== 'clientPersonId')) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported conversation field' })
  }
  const access = await ensureCaseConversation(
    event,
    getRequiredParam(event, 'id'),
    body.clientPersonId,
  )
  const snapshot = await loadCaseConversationSnapshot(event, access, { limit: 100 })
  return { data: snapshot }
})
