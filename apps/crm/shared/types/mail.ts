export type MailFolderId = 'INBOX' | 'STARRED' | 'SENT' | 'DRAFT'

export interface MailAddress {
  name: string
  email: string | null
  label: string
}

export interface MailConnectionInfo {
  id: string
  provider: 'google'
  accountEmail: string
  capabilities: {
    canSend: boolean
  }
  status: 'active' | 'error' | 'revoked'
  errorMessage: string | null
  updatedAt: string
}

export interface MailConnectionPayload {
  configured: boolean
  provider: {
    id: 'google'
    label: 'Gmail'
    connectPath: string | null
  }
  connection: MailConnectionInfo | null
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
  bodyTruncated: boolean
  attachments: MailAttachment[]
  security: MailMessageSecurity
}

export interface MailThreadDetail {
  id: string
  subject: string
  messages: MailMessageDetail[]
  omittedMessageCount: number
  externalUrl: string
}

export interface MailThreadListPayload {
  data: MailThreadSummary[]
  folders: MailFolderSummary[]
  nextPageToken: string | null
  resultSizeEstimate: number
  partialFailureCount: number
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
