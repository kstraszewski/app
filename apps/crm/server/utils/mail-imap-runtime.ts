import { createError, type H3Event } from 'h3'
import { deriveMailReferenceSecret } from './mail-crypto.ts'
import {
  decryptImapSmtpCredentials,
  type MailConnectionRow,
} from './mail-connections.ts'
import type { ImapSmtpRuntimeConfig } from './mail-imap-smtp.ts'

export function imapSmtpRuntimeForConnection(
  event: H3Event,
  connection: MailConnectionRow,
): ImapSmtpRuntimeConfig {
  if (
    connection.provider !== 'imap'
    || !connection.imap_host
    || !connection.imap_port
    || !connection.imap_security
    || !connection.imap_username
    || !connection.smtp_host
    || !connection.smtp_port
    || !connection.smtp_security
    || !connection.smtp_username
  ) {
    throw createError({ statusCode: 500, statusMessage: 'Konfiguracja skrzynki IMAP/SMTP jest niekompletna.' })
  }
  const credentials = decryptImapSmtpCredentials(event, connection)
  return {
    connection: {
      provider: 'imap',
      accountEmail: connection.account_email,
      displayName: connection.display_name || undefined,
      imap: {
        host: connection.imap_host,
        port: connection.imap_port,
        security: connection.imap_security,
        username: connection.imap_username,
      },
      smtp: {
        host: connection.smtp_host,
        port: connection.smtp_port,
        security: connection.smtp_security,
        username: connection.smtp_username,
      },
    },
    secrets: {
      imapPassword: credentials.imapPassword,
      smtpPassword: credentials.smtpPassword,
    },
    referenceSecret: deriveMailReferenceSecret(event, {
      organizationId: connection.organization_id,
      ownerUserId: connection.owner_user_id,
      connectionId: connection.id,
    }),
  }
}
