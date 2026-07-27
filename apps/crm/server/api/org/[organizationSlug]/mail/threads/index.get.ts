import { getQuery, setResponseHeader } from 'h3'
import type {
  MailFolderId,
  MailThreadListPayload,
} from '../../../../../../shared/types/mail.ts'
import {
  requireCrmSession,
  textValue,
} from '~~/server/utils/crm'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
} from '~~/server/utils/mail-connections'
import { fetchGmailThreadPage } from '~~/server/utils/mail-providers'

const MAIL_FOLDERS: MailFolderId[] = ['INBOX', 'STARRED', 'SENT', 'DRAFT']

export default defineEventHandler(async (event): Promise<MailThreadListPayload> => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  const session = await requireCrmSession(event)
  const query = getQuery(event)
  const folder = (textValue(query.folder)?.toUpperCase() || 'INBOX') as MailFolderId
  if (!MAIL_FOLDERS.includes(folder)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid mail folder' })
  }
  const search = textValue(query.q)
  if (search && search.length > 500) {
    throw createError({ statusCode: 400, statusMessage: 'Mail search query is too long' })
  }
  const pageToken = textValue(query.pageToken)
  if (pageToken && pageToken.length > 2_048) {
    throw createError({ statusCode: 400, statusMessage: 'Mail page token is too long' })
  }

  const { serviceRole, connection } = await requireUserMailConnection(event, session)
  const accessToken = await activeMailAccessToken(event, serviceRole, connection)
  try {
    const result = await fetchGmailThreadPage(
      accessToken,
      connection.account_email,
      {
        folder,
        query: search,
        pageToken,
        maxResults: 20,
      },
    )
    if (connection.status !== 'active') {
      await markMailConnectionStatus(serviceRole, connection, 'active', null)
    }
    return result
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
