import { setResponseHeader } from 'h3'
import type { MailThreadDetailPayload } from '../../../../../../shared/types/mail.ts'
import {
  getRequiredParam,
  requireCrmSession,
} from '~~/server/utils/crm'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
} from '~~/server/utils/mail-connections'
import { fetchGmailThread } from '~~/server/utils/mail-providers'

export default defineEventHandler(async (event): Promise<MailThreadDetailPayload> => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const session = await requireCrmSession(event)
  const threadId = getRequiredParam(event, 'threadId')
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(threadId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Gmail thread ID' })
  }

  const { serviceRole, connection } = await requireUserMailConnection(event, session)
  const accessToken = await activeMailAccessToken(event, serviceRole, connection)
  try {
    const data = await fetchGmailThread(
      accessToken,
      connection.account_email,
      threadId,
    )
    if (connection.status !== 'active') {
      await markMailConnectionStatus(serviceRole, connection, 'active', null)
    }
    return { data }
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode)
    if (statusCode === 401 || statusCode === 403) {
      await markMailConnectionStatus(
        serviceRole,
        connection,
        'revoked',
        'Google no longer authorizes access to this Gmail account',
      )
      throw createError({ statusCode: 409, statusMessage: 'Reconnect Gmail to continue' })
    }
    throw error
  }
})
