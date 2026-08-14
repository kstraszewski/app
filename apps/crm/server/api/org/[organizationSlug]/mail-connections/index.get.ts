import { useRuntimeConfig } from '#imports'
import type {
  MailConnectionInfo,
  MailConnectionPayload,
  MailProviderId,
  MailProviderOption,
} from '../../../../../shared/types/mail.ts'
import { requireCrmSession } from '~~/server/utils/crm'
import { mailCredentialEncryptionAvailable } from '~~/server/utils/mail-crypto'
import {
  type MailConnectionRow,
  loadUserMailConnections,
} from '~~/server/utils/mail-connections'
import {
  mailProviderAvailability,
  mailTokenIncludesReadAccess,
  mailTokenIncludesSendAccess,
} from '~~/server/utils/mail-providers'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'

interface MicrosoftMailConfig {
  clientId?: string
  clientSecret?: string
}

const MAX_MAIL_ATTACHMENT_BYTES = 3 * 1024 * 1024

export default defineEventHandler(async (event): Promise<MailConnectionPayload> => {
  setPrivateMailResponseHeaders(event)
  const session = await requireCrmSession(event)
  const { connections } = await loadUserMailConnections(event, session)
  const returnTo = `/org/${encodeURIComponent(session.organizationSlug)}/mail`
  const microsoftConfig = (
    useRuntimeConfig(event).mailOAuth as { microsoft?: MicrosoftMailConfig }
  ).microsoft
  const encryptionConfigured = mailCredentialEncryptionAvailable(event)
  const providers: MailProviderOption[] = [
    oauthProvider(
      'google',
      'Gmail',
      'Konto Google z bezpiecznym OAuth — bez przekazywania hasła do CRM.',
      '/assets/google-icon.svg',
      mailProviderAvailability(event),
      session.organizationSlug,
      returnTo,
    ),
    oauthProvider(
      'microsoft',
      'Outlook i Microsoft 365',
      'Prywatny Outlook, Hotmail, Live lub służbowe konto Microsoft 365.',
      'i-lucide-panels-top-left',
      Boolean(
        encryptionConfigured
        && microsoftConfig?.clientId
        && microsoftConfig.clientSecret,
      ),
      session.organizationSlug,
      returnTo,
    ),
    {
      id: 'imap',
      label: 'Inna poczta (IMAP + SMTP)',
      description: 'Dowolny dostawca oferujący szyfrowane IMAP i SMTP, np. home.pl, OVH, Yahoo lub iCloud.',
      icon: 'i-lucide-mail',
      connectionKind: 'credentials',
      configured: encryptionConfigured,
      connectPath: null,
    },
  ]

  return {
    providers,
    connections: connections.map(connectionInfo),
  }
})

function oauthProvider(
  id: Extract<MailProviderId, 'google' | 'microsoft'>,
  label: string,
  description: string,
  icon: string,
  configured: boolean,
  organizationSlug: string,
  returnTo: string,
): MailProviderOption {
  return {
    id,
    label,
    description,
    icon,
    connectionKind: 'oauth',
    configured,
    connectPath: configured
      ? `/api/org/${encodeURIComponent(organizationSlug)}/mail-connections/${id}/connect?returnTo=${encodeURIComponent(returnTo)}`
      : null,
  }
}

function connectionInfo(connection: MailConnectionRow): MailConnectionInfo {
  const metadata = providerMetadata(connection.provider, connection.account_email)
  const scopes = connection.scopes ?? []
  const canRead = connection.provider === 'google'
    ? mailTokenIncludesReadAccess(scopes)
    : connection.provider === 'microsoft'
      ? scopes.some(scope => ['mail.read', 'mail.readwrite'].includes(scope.toLowerCase()))
      : true
  const canSend = connection.provider === 'google'
    ? mailTokenIncludesSendAccess(scopes)
    : connection.provider === 'microsoft'
      ? scopes.some(scope => scope.toLowerCase() === 'mail.send')
      : true
  return {
    id: connection.id,
    provider: connection.provider,
    providerLabel: metadata.label,
    providerIcon: metadata.icon,
    displayName: connection.display_name?.trim() || connection.account_email,
    accountEmail: connection.account_email,
    capabilities: {
      canRead,
      canSearch: canRead,
      canSend,
      maxAttachmentBytes: MAX_MAIL_ATTACHMENT_BYTES,
      maxTotalAttachmentBytes: MAX_MAIL_ATTACHMENT_BYTES,
    },
    status: connection.status,
    errorMessage: connection.last_error,
    externalMailboxUrl: metadata.externalMailboxUrl,
    externalSentUrl: metadata.externalSentUrl,
    lastVerifiedAt: connection.last_verified_at,
    updatedAt: connection.updated_at,
  }
}

function providerMetadata(provider: MailProviderId, email: string) {
  if (provider === 'google') {
    const encoded = encodeURIComponent(email)
    return {
      label: 'Gmail',
      icon: '/assets/google-icon.svg',
      externalMailboxUrl: `https://mail.google.com/mail/u/${encoded}/`,
      externalSentUrl: `https://mail.google.com/mail/u/${encoded}/#sent`,
    }
  }
  if (provider === 'microsoft') {
    return {
      label: 'Outlook',
      icon: 'i-lucide-panels-top-left',
      externalMailboxUrl: 'https://outlook.office.com/mail/',
      externalSentUrl: 'https://outlook.office.com/mail/sentitems',
    }
  }
  return {
    label: 'IMAP + SMTP',
    icon: 'i-lucide-mail',
    externalMailboxUrl: null,
    externalSentUrl: null,
  }
}
