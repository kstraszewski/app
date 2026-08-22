import { createHash } from 'node:crypto'
import type { H3Event } from 'h3'
import type { MailThreadDetail } from '../../shared/types/mail.ts'
import { ingestGmailBankMailThread } from './bank-mail-agent-ingestion.ts'
import { requireCrmSession, type CrmSession } from './crm.ts'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
  type MailConnectionRow,
} from './mail-connections.ts'
import { imapSmtpRuntimeForConnection } from './mail-imap-runtime.ts'
import { fetchGmailThread } from './mail-providers.ts'
import {
  connectionReferenceSecret,
  handleMailProviderError,
} from './mail-thread-page.ts'

export interface FetchMailThreadDetailInput {
  backendData: any
  session: CrmSession
  connection: MailConnectionRow
  threadId: string
  observeBankMail?: boolean
}

function requiredThreadId(value: string): string {
  const threadId = String(value ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,4096}$/u.test(threadId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid mail thread ID' })
  }
  return threadId
}

export async function fetchMailThreadDetailForConnection(
  event: H3Event,
  input: FetchMailThreadDetailInput,
): Promise<MailThreadDetail> {
  const threadId = requiredThreadId(input.threadId)
  const { backendData, connection } = input
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
    if (connection.provider === 'google' && input.observeBankMail !== false) {
      try {
        await ingestGmailBankMailThread(event, {
          backendData,
          session: input.session,
          connection,
          thread: data,
        })
      }
      catch (error) {
        console.error('[bank-mail-agent] Gmail thread ingestion failed', {
          connectionId: connection.id,
          threadIdHash: createHash('sha256').update(data.id, 'utf8').digest('hex'),
          error: error instanceof Error ? error.message.slice(0, 300) : 'unknown_error',
        })
      }
    }
    return data
  }
  catch (error) {
    throw await handleMailProviderError(backendData, connection, error)
  }
}

export async function loadUserMailThreadDetail(
  event: H3Event,
  input: {
    connectionId: string
    threadId: string
    observeBankMail?: boolean
  },
): Promise<MailThreadDetail> {
  const session = await requireCrmSession(event)
  const { backendData, connection } = await requireUserMailConnection(
    event,
    session,
    input.connectionId,
  )
  return fetchMailThreadDetailForConnection(event, {
    ...input,
    backendData,
    session,
    connection,
  })
}

async function fetchImapThread(
  event: Parameters<typeof imapSmtpRuntimeForConnection>[0],
  connection: Parameters<typeof imapSmtpRuntimeForConnection>[1],
  threadId: string,
) {
  const module = await import('./mail-imap-smtp.ts')
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
  const module = await import('./mail-microsoft.ts')
  return module.fetchMicrosoftMailThread(
    accessToken,
    accountEmail,
    threadId,
    { referenceSecret },
  )
}
