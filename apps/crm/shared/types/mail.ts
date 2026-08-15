export type MailProviderId = 'google' | 'microsoft' | 'imap'

export type MailConnectionStatus = 'active' | 'error' | 'revoked'

export type MailFolderId = 'INBOX' | 'STARRED' | 'SENT' | 'DRAFT'

export interface MailAddress {
  name: string
  email: string | null
  label: string
}

export interface MailProviderOption {
  id: MailProviderId
  label: string
  description: string
  icon: string
  connectionKind: 'oauth' | 'credentials'
  configured: boolean
  connectPath: string | null
}

export interface MailConnectionCapabilities {
  canRead: boolean
  canSearch: boolean
  canSend: boolean
  maxAttachmentBytes: number
  maxTotalAttachmentBytes: number
}

export interface MailConnectionInfo {
  id: string
  provider: MailProviderId
  providerLabel: string
  providerIcon: string
  displayName: string
  accountEmail: string
  capabilities: MailConnectionCapabilities
  status: MailConnectionStatus
  errorMessage: string | null
  externalMailboxUrl: string | null
  externalSentUrl: string | null
  lastVerifiedAt: string | null
  updatedAt: string
}

export interface MailConnectionPayload {
  providers: MailProviderOption[]
  connections: MailConnectionInfo[]
}

export interface MailFolderSummary {
  id: MailFolderId
  label: string
  messagesTotal: number | null
  messagesUnread: number | null
}

export interface MailThreadSummary {
  id: string
  messageCount: number
  participants: MailAddress[]
  participantsLabel: string
  subject: string
  snippet: string
  latestAt: string | null
  unread: boolean
  starred: boolean
  important: boolean
  draft: boolean
  hasAttachments: boolean
}

export interface MailAttachment {
  id: string | null
  filename: string
  mimeType: string
  size: number
}

export type MailAuthenticationStatus = 'pass' | 'fail' | 'unknown'

export interface MailMessageSecurity {
  authentication: MailAuthenticationStatus
  replyToMismatch: boolean
}

export interface MailMessageDetail {
  id: string
  from: MailAddress | null
  replyTo: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  sentAt: string | null
  unread: boolean
  bodyText: string
  /** Server-sanitized HTML suitable only for the sandboxed mail preview. */
  bodyHtml?: string | null
  bodyHtmlTruncated?: boolean
  hasRemoteImages?: boolean
  bodyTruncated: boolean
  attachments: MailAttachment[]
  security: MailMessageSecurity
}

export interface MailThreadDetail {
  id: string
  subject: string
  messages: MailMessageDetail[]
  omittedMessageCount: number
  externalUrl: string | null
}

export interface MailThreadListPayload {
  data: MailThreadSummary[]
  folders: MailFolderSummary[]
  nextPageToken: string | null
  resultSizeEstimate: number
  partialFailureCount: number
}

export type MailContextScopeType = 'client' | 'case'

export interface MailContextScope {
  type: MailContextScopeType
  id: string
}

export type MailContextMatchReason =
  | 'manual_link'
  | 'sent_from_context'
  | 'participant_email'
  | null

export interface MailContextDescriptor extends MailContextScope {
  label: string
  /** Server-resolved CRM addresses suitable for a contextual composer. */
  composeTo: string[]
  emailCount: number
  emailsTruncated: boolean
}

export type MailContextFolderId = Extract<MailFolderId, 'INBOX' | 'SENT'>

export type MailContextPageTokens = Partial<Record<MailContextFolderId, string | null>>

export interface MailContextThreadSummary extends MailThreadSummary {
  connectionId: string
  folders: MailContextFolderId[]
  linked: boolean
  suggested: boolean
  matchReason: MailContextMatchReason
  matchedEmails: string[]
}

export interface MailContextThreadListPayload {
  context: MailContextDescriptor
  data: MailContextThreadSummary[]
  nextPageTokens: Record<MailContextFolderId, string | null>
  resultSizeEstimate: number
  partialFailureCount: number
}

export interface MailContextLinkPayload {
  data: {
    linked: boolean
  }
}

export interface MailThreadDetailPayload {
  data: MailThreadDetail
}

export interface MailSendPayload {
  data: {
    id: string
    threadId: string
  }
}

export type MailTransportSecurity = 'tls' | 'starttls'

export interface ImapSmtpConnectionInput {
  /** Existing owned IMAP connection replaced after a successful re-test. */
  replacementConnectionId?: string
  displayName: string
  accountEmail: string
  imapHost: string
  imapPort: number
  imapSecurity: MailTransportSecurity
  imapUsername: string
  imapPassword: string
  smtpHost: string
  smtpPort: number
  smtpSecurity: MailTransportSecurity
  smtpUsername: string
  smtpPassword: string
}
