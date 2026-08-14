import type { H3Event } from 'h3'
import type {
  MailFolderId,
  MailThreadListPayload,
} from '../../shared/types/mail.ts'
import { requireCrmSession } from './crm.ts'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
} from './mail-connections.ts'
import { fetchGmailThreadPage } from './mail-providers.ts'

export async function loadMailThreadPage(
  event: H3Event,
  input: {
    folder: MailFolderId
    search?: string
    pageToken?: string
  },
): Promise<MailThreadListPayload> {
  const session = await requireCrmSession(event)
  const { backendData, connection } = await requireUserMailConnection(event, session)
  const accessToken = await activeMailAccessToken(event, backendData, connection)
  try {
    const result = await fetchGmailThreadPage(
      accessToken,
      connection.account_email,
      {
        folder: input.folder,
        query: input.search,
        pageToken: input.pageToken,
        maxResults: 20,
      },
    )
    if (connection.status !== 'active') {
      await markMailConnectionStatus(backendData, connection, 'active', null)
    }
    return result
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode)
    if (statusCode === 401 || statusCode === 403) {
      await markMailConnectionStatus(
        backendData,
        connection,
        'revoked',
        'Google no longer authorizes access to this Gmail account',
      )
      throw createError({ statusCode: 409, statusMessage: 'Reconnect Gmail to continue' })
    }
    throw error
  }
}
