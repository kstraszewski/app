import { createHash, randomUUID } from 'node:crypto'
import type {
  ImapSmtpConnectionInput,
  MailConnectionInfo,
} from '../../../../../shared/types/mail.ts'
import { requireCrmSession, throwDbError } from '~~/server/utils/crm'
import { assertMailConnectionSetupRateLimit } from '~~/server/utils/mail-connection-rate-limit'
import {
  encryptMailSecret,
  mailConnectionSecretContext,
} from '~~/server/utils/mail-crypto'
import { loadUserMailConnections } from '~~/server/utils/mail-connections'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'
import { safeImapSmtpError } from '~~/server/utils/mail-imap-errors'
import {
  readImapSmtpConnectionInput,
  sameMailAccountEmail,
} from '~~/server/utils/mail-imap-setup'

export default defineEventHandler(async (event): Promise<{ data: MailConnectionInfo }> => {
  setPrivateMailResponseHeaders(event)
  const session = await requireCrmSession(event)
  await assertMailConnectionSetupRateLimit(event, session.userId)
  const input = await readImapSmtpConnectionInput(event)

  const { backendData, connections } = await loadUserMailConnections(event, session)
  const accountId = imapAccountId(input)
  const replacement = input.replacementConnectionId
    ? connections.find(connection => (
        connection.id === input.replacementConnectionId
        && connection.provider === 'imap'
      ))
    : null
  if (input.replacementConnectionId && !replacement) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono skrzynki do ponownego połączenia.' })
  }
  if (replacement && !sameMailAccountEmail(replacement.account_email, input.accountEmail)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Połącz ponownie tę samą skrzynkę e-mail.',
    })
  }
  const existingByAccount = connections.find(connection => (
    connection.provider === 'imap' && connection.account_id === accountId
  ))
  if (replacement && existingByAccount && replacement.id !== existingByAccount.id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ta konfiguracja jest już zapisana jako inne konto pocztowe.',
    })
  }
  try {
    const adapter = await import('~~/server/utils/mail-imap-smtp')
    await adapter.verifyImapSmtpConnection(input)
  }
  catch (error) {
    throw safeImapSmtpError(error, 'setup')
  }
  const existing = replacement || existingByAccount
  const connectionId = existing?.id || randomUUID()
  const encryptedCredentials = encryptMailSecret(
    event,
    JSON.stringify({
      imapPassword: input.imapPassword,
      smtpPassword: input.smtpPassword,
    }),
    mailConnectionSecretContext({
      organizationId: session.organizationId,
      ownerUserId: session.userId,
      connectionId,
      purpose: 'credentials',
    }),
  )
  if (!encryptedCredentials) {
    throw createError({ statusCode: 500, statusMessage: 'Nie udało się zabezpieczyć danych poczty.' })
  }
  const now = new Date().toISOString()
  const values = {
    id: connectionId,
    organization_id: session.organizationId,
    owner_user_id: session.userId,
    provider: 'imap',
    account_id: accountId,
    account_email: input.accountEmail,
    display_name: input.displayName || null,
    auth_type: 'password',
    encrypted_access_token: null,
    encrypted_refresh_token: null,
    encrypted_credentials: encryptedCredentials,
    token_expires_at: null,
    scopes: [],
    imap_host: input.imapHost,
    imap_port: input.imapPort,
    imap_security: input.imapSecurity,
    imap_username: input.imapUsername,
    smtp_host: input.smtpHost,
    smtp_port: input.smtpPort,
    smtp_security: input.smtpSecurity,
    smtp_username: input.smtpUsername,
    status: 'active',
    last_error: null,
    last_verified_at: now,
  }
  const result = existing
    ? await backendData
        .from('mail_connections')
        .update(values)
        .eq('organization_id', session.organizationId)
        .eq('owner_user_id', session.userId)
        .eq('id', existing.id)
    : await backendData.from('mail_connections').insert(values)
  throwDbError(result.error)

  return {
    data: {
      id: connectionId,
      provider: 'imap',
      providerLabel: 'IMAP + SMTP',
      providerIcon: 'i-lucide-mail',
      displayName: input.displayName || input.accountEmail,
      accountEmail: input.accountEmail,
      capabilities: {
        canRead: true,
        canSearch: true,
        canSend: true,
        maxAttachmentBytes: 3 * 1024 * 1024,
        maxTotalAttachmentBytes: 3 * 1024 * 1024,
      },
      status: 'active',
      errorMessage: null,
      externalMailboxUrl: null,
      externalSentUrl: null,
      lastVerifiedAt: now,
      updatedAt: now,
    },
  }
})

function imapAccountId(input: ImapSmtpConnectionInput): string {
  return createHash('sha256')
    .update([
      input.accountEmail,
      input.imapHost,
      input.imapUsername,
      input.smtpHost,
      input.smtpUsername,
    ].join('\0'), 'utf8')
    .digest('hex')
}
