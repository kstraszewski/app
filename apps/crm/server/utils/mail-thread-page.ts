import type { H3Event } from 'h3'
import { scheduleOpenExpertBackgroundTask } from '@openexpert/auth/server'
import type {
  MailFolderId,
  MailProviderId,
  MailThreadListPayload,
} from '../../shared/types/mail.ts'
import { requireCrmSession } from './crm.ts'
import { deriveMailReferenceSecret } from './mail-crypto.ts'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
  type MailConnectionRow,
} from './mail-connections.ts'
import { imapSmtpRuntimeForConnection } from './mail-imap-runtime.ts'
import {
  imapSmtpConnectionFailureReason,
  safeImapSmtpError,
} from './mail-imap-errors.ts'
import { fetchGmailThread, fetchGmailThreadPage } from './mail-providers.ts'
import { mailContextSearchQuery } from './mail-context-core.ts'
import { ingestGmailBankMailThreadPage } from './bank-mail-agent-ingestion.ts'

export async function loadMailThreadPage(
  event: H3Event,
  input: {
    connectionId: string
    folder: MailFolderId
    search?: string
    participantEmails?: string[]
    pageToken?: string
    maxResults?: number
  },
): Promise<MailThreadListPayload> {
  const session = await requireCrmSession(event)
  const { backendData, connection } = await requireUserMailConnection(
    event,
    session,
    input.connectionId,
  )
  return fetchMailThreadPageForConnection(event, {
    ...input,
    backendData,
    session,
    connection,
  })
}

export async function fetchMailThreadPageForConnection(
  event: H3Event,
  input: {
    backendData: any
    session: Awaited<ReturnType<typeof requireCrmSession>>
    connection: MailConnectionRow
    folder: MailFolderId
    search?: string
    participantEmails?: string[]
    pageToken?: string
    maxResults?: number
    observeBankMail?: boolean
    excludeDrafts?: boolean
  },
): Promise<MailThreadListPayload> {
  const { backendData, connection, session } = input
  if (connection.status === 'revoked') {
    throw createError({
      statusCode: 409,
      statusMessage: `Połącz ponownie konto ${providerLabel(connection.provider)}.`,
    })
  }
  try {
    const result = await fetchProviderPage(event, backendData, connection, input)
    if (connection.status !== 'active') {
      await markMailConnectionStatus(backendData, connection, 'active', null, true)
    }
    if (
      connection.provider === 'google'
      && input.folder === 'INBOX'
      && !input.pageToken
      && input.observeBankMail !== false
    ) {
      const task = ingestGmailBankMailThreadPage(event, {
        backendData,
        session,
        connection,
        summaries: result.data,
        loadThread: async (threadId) => fetchGmailThread(
          await activeMailAccessToken(event, backendData, connection),
          connection.account_email,
          threadId,
        ),
      }).catch((error) => {
        console.error('[bank-mail-agent] Gmail page ingestion failed', {
          connectionId: connection.id,
          error: error instanceof Error ? error.message.slice(0, 300) : 'unknown_error',
        })
      })
      scheduleOpenExpertBackgroundTask(task, event.waitUntil.bind(event))
    }
    return result
  }
  catch (error) {
    throw await handleMailProviderError(backendData, connection, error)
  }
}

async function fetchProviderPage(
  event: H3Event,
  backendData: any,
  connection: MailConnectionRow,
  input: {
    folder: MailFolderId
    search?: string
    participantEmails?: string[]
    pageToken?: string
    maxResults?: number
    excludeDrafts?: boolean
  },
): Promise<MailThreadListPayload> {
  const maxResults = Math.min(20, Math.max(1, Math.trunc(input.maxResults ?? 20)))
  if (connection.provider === 'imap') {
    const module = await import('./mail-imap-smtp.ts')
    return module.fetchImapSmtpThreadPage(
      imapSmtpRuntimeForConnection(event, connection),
      {
        folder: input.folder,
        query: input.search,
        participantEmails: input.participantEmails,
        pageToken: input.pageToken,
        maxResults,
        excludeDrafts: input.excludeDrafts,
      },
    )
  }

  const accessToken = await activeMailAccessToken(event, backendData, connection)
  if (connection.provider === 'google') {
    return fetchGmailThreadPage(accessToken, connection.account_email, {
      folder: input.folder,
      query: input.participantEmails?.length
        ? mailContextSearchQuery('google', input.participantEmails, input.search)
        : input.search,
      pageToken: input.pageToken,
      maxResults,
      excludeDrafts: input.excludeDrafts,
    })
  }

  const module = await import('./mail-microsoft.ts')
  return module.fetchMicrosoftMailThreadPage(
    accessToken,
    connection.account_email,
    {
      folder: input.folder,
      query: input.participantEmails?.length
        ? mailContextSearchQuery('microsoft', input.participantEmails, input.search)
        : input.search,
      cursor: input.pageToken,
      maxResults,
      referenceSecret: connectionReferenceSecret(event, connection),
      excludeDrafts: input.excludeDrafts,
    },
  )
}

export async function handleMailProviderError(
  backendData: any,
  connection: MailConnectionRow,
  error: unknown,
): Promise<unknown> {
  const statusCode = Number((error as { statusCode?: number })?.statusCode)
  if (connection.provider !== 'imap' && (statusCode === 401 || statusCode === 403)) {
    await markMailConnectionStatus(
      backendData,
      connection,
      'revoked',
      `${providerLabel(connection.provider)} no longer authorizes mailbox access`,
    )
    return createError({
      statusCode: 409,
      statusMessage: `Połącz ponownie konto ${providerLabel(connection.provider)}.`,
    })
  }
  if (connection.provider === 'imap') {
    const failureReason = imapSmtpConnectionFailureReason(error)
    if (failureReason) {
      try {
        await markMailConnectionStatus(
          backendData,
          connection,
          'error',
          failureReason,
        )
      }
      catch {
        // A status-write failure must not replace the sanitized provider error.
      }
    }
    return safeImapSmtpError(error, 'read')
  }
  return error
}

export function connectionReferenceSecret(
  event: H3Event,
  connection: MailConnectionRow,
): string {
  return deriveMailReferenceSecret(event, {
    organizationId: connection.organization_id,
    ownerUserId: connection.owner_user_id,
    connectionId: connection.id,
  })
}

function providerLabel(provider: MailProviderId): string {
  if (provider === 'google') return 'Gmail'
  if (provider === 'microsoft') return 'Outlook'
  return 'IMAP/SMTP'
}
