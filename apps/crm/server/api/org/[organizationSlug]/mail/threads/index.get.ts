import { getQuery } from 'h3'
import type {
  MailFolderId,
  MailThreadListPayload,
} from '../../../../../../shared/types/mail.ts'
import { textValue } from '~~/server/utils/crm'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'
import { loadMailThreadPage } from '~~/server/utils/mail-thread-page'

const MAIL_FOLDERS: MailFolderId[] = ['INBOX', 'STARRED', 'SENT', 'DRAFT']

export default defineEventHandler(async (event): Promise<MailThreadListPayload> => {
  setPrivateMailResponseHeaders(event)
  const query = getQuery(event)
  const folder = (textValue(query.folder)?.toUpperCase() || 'INBOX') as MailFolderId
  if (!MAIL_FOLDERS.includes(folder)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid mail folder' })
  }
  const search = textValue(query.q)
  if (search) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Wyszukiwanie wiadomości wymaga prywatnego endpointu POST.',
    })
  }
  const pageToken = textValue(query.pageToken)
  if (pageToken && pageToken.length > 2_048) {
    throw createError({ statusCode: 400, statusMessage: 'Mail page token is too long' })
  }

  return loadMailThreadPage(event, { folder, pageToken })
})
