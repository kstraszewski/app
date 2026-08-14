import type { H3Event } from 'h3'
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
import { fetchGmailThreadPage } from './mail-providers.ts'

export async function loadMailThreadPage(
  event: H3Event,
  input: {
    connectionId: string
    folder: MailFolderId
    search?: string
    pageToken?: string
  },
): Promise<MailThreadListPayload> {
  const session = await requireCrmSession(event)
  const { backendData, connection } = await requireUserMailConnection(
    event,
    session,
    input.connectionId,
  )
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
    pageToken?: string
  },
): Promise<MailThreadListPayload> {
  if (connection.provider === 'imap') {
    const module = await import('./mail-imap-smtp.ts')
    return module.fetchImapSmtpThreadPage(
      imapSmtpRuntimeForConnection(event, connection),
      {
        folder: input.folder,
        query: input.search,
        pageToken: input.pageToken,
        maxResults: 20,
      },
    )
  }

  const accessToken = await activeMailAccessToken(event, backendData, connection)
  if (connection.provider === 'google') {
    return fetchGmailThreadPage(accessToken, connection.account_email, {
      folder: input.folder,
      query: input.search,
      pageToken: input.pageToken,
      maxResults: 20,
    })
  }

  const module = await import('./mail-microsoft.ts')
  return module.fetchMicrosoftMailThreadPage(
    accessToken,
    connection.account_email,
    {
      folder: input.folder,
      query: input.search,
      cursor: input.pageToken,
      maxResults: 20,
      referenceSecret: connectionReferenceSecret(event, connection),
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
