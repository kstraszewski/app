import { createError, readBody, setHeader } from 'h3'
import {
  ensureCaseConversation,
  ensureCaseGroupConversation,
  loadCaseConversationSnapshot,
} from '~~/server/utils/case-conversations'
import { asRecord, getRequiredParam } from '~~/server/utils/crm'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const body = asRecord(await readBody(event))
  if (Object.keys(body).some(key => !['kind', 'clientPersonId'].includes(key))) {
    throw createError({ statusCode: 400, statusMessage: 'Unsupported conversation field' })
  }
  const kind = body.kind ?? 'direct'
  if (kind !== 'direct' && kind !== 'group') {
    throw createError({ statusCode: 400, statusMessage: 'Conversation kind is invalid' })
  }
  if (kind === 'group' && body.clientPersonId !== undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Group conversation cannot have one recipient' })
  }
  if (kind === 'direct' && body.clientPersonId === undefined) {
    throw createError({ statusCode: 400, statusMessage: 'Direct conversation requires a recipient' })
  }
  const caseId = getRequiredParam(event, 'id')
  const access = kind === 'group'
    ? await ensureCaseGroupConversation(event, caseId)
    : await ensureCaseConversation(event, caseId, body.clientPersonId)
  const snapshot = await loadCaseConversationSnapshot(event, access, { limit: 100 })
  return { data: snapshot }
})
