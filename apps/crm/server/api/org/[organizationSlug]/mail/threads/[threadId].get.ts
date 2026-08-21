import type { MailThreadDetailPayload } from '../../../../../../shared/types/mail.ts'
import {
  getRequiredParam,
  requireCrmSession,
  textValue,
} from '~~/server/utils/crm'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
} from '~~/server/utils/mail-connections'
import { imapSmtpRuntimeForConnection } from '~~/server/utils/mail-imap-runtime'
import { fetchGmailThread } from '~~/server/utils/mail-providers'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'
import {
  connectionReferenceSecret,
  handleMailProviderError,
} from '~~/server/utils/mail-thread-page'
import { getQuery } from 'h3'
import { createHash } from 'node:crypto'
import { ingestGmailBankMailThread } from '~~/server/utils/bank-mail-agent-ingestion'

export default defineEventHandler(async (event): Promise<MailThreadDetailPayload> => {
  setPrivateMailResponseHeaders(event)
  const session = await requireCrmSession(event)
  const threadId = getRequiredParam(event, 'threadId')
  if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(threadId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid mail thread ID' })
  }
  const connectionId = textValue(getQuery(event).connectionId)
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'Mail connection ID is required' })
  }

  const { backendData, connection } = await requireUserMailConnection(
    event,
    session,
    connectionId,
  )
  try {
    const data = connection.provider === 'imap'
      ? await fetchImapThread(event, connection, threadId)
      : connection.provider === 'google'
        ? await fetchGmailThread(
            await activeMailAccessToken(event, backendData, connection),
            connection.account_email,
            threadId,
          )
        : await fetchMicrosoftThread(
            await activeMailAccessToken(event, backendData, connection),
            connection.account_email,
            threadId,
            connectionReferenceSecret(event, connection),
          )
    if (connection.status !== 'active') {
      await markMailConnectionStatus(backendData, connection, 'active', null, true)
    }
    if (connection.provider === 'google') {
      try {
        await ingestGmailBankMailThread(event, { backendData, session, connection, thread: data })
      }
      catch (error) {
        // Inbox reading must remain available if the optional AI intake is
        // temporarily unavailable. The intake ledger and runtime logs retain
        // the failure boundary without exposing message content.
        console.error('[bank-mail-agent] Gmail thread ingestion failed', {
          connectionId: connection.id,
          threadIdHash: createHash('sha256').update(data.id, 'utf8').digest('hex'),
          error: error instanceof Error ? error.message.slice(0, 300) : 'unknown_error',
        })
      }
    }
    return { data }
  } catch (error) {
    throw await handleMailProviderError(backendData, connection, error)
  }
})

async function fetchImapThread(
  event: Parameters<typeof imapSmtpRuntimeForConnection>[0],
  connection: Parameters<typeof imapSmtpRuntimeForConnection>[1],
  threadId: string,
) {
  const module = await import('~~/server/utils/mail-imap-smtp')
  return module.fetchImapSmtpThread(
    imapSmtpRuntimeForConnection(event, connection),
    threadId,
  )
}

async function fetchMicrosoftThread(
  accessToken: string,
  accountEmail: string,
  threadId: string,
  referenceSecret: string,
) {
  const module = await import('~~/server/utils/mail-microsoft')
  return module.fetchMicrosoftMailThread(
    accessToken,
    accountEmail,
    threadId,
    { referenceSecret },
  )
}
