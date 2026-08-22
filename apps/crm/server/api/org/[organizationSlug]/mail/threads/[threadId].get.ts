import type { MailThreadDetailPayload } from '../../../../../../shared/types/mail.ts'
import {
  getRequiredParam,
  textValue,
} from '~~/server/utils/crm'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'
import { loadUserMailThreadDetail } from '~~/server/utils/mail-thread-detail'
import { getQuery } from 'h3'

export default defineEventHandler(async (event): Promise<MailThreadDetailPayload> => {
  setPrivateMailResponseHeaders(event)
  const threadId = getRequiredParam(event, 'threadId')
  if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(threadId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid mail thread ID' })
  }
  const connectionId = textValue(getQuery(event).connectionId)
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'Mail connection ID is required' })
  }

  return {
    data: await loadUserMailThreadDetail(event, { connectionId, threadId }),
  }
})
