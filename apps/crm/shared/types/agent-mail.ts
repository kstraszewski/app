export const CRM_AGENT_MAIL_ACCESS = {
  purpose: 'openexpert:crm-agent-mail:read',
  purposeClaim: 'oe_agent_mail_purpose',
  organizationIdClaim: 'oe_agent_mail_organization_id',
  organizationSlugClaim: 'oe_agent_mail_organization_slug',
} as const

export const CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH = 24_000

export type CrmAgentMailFolder = 'all' | 'inbox' | 'sent'

export type CrmAgentMailAttachmentFilter = 'any' | 'with_attachments'

export type CrmAgentMailScopeType = 'client' | 'case'

export interface CrmAgentMailScope {
  type: CrmAgentMailScopeType
  id: string
}

export interface CrmAgentMailSearchRequest {
  query?: string
  participantEmail?: string
  scope?: CrmAgentMailScope
  folder: CrmAgentMailFolder
  attachmentFilter: CrmAgentMailAttachmentFilter
  limit: number
  cursor?: string
}

export interface CrmAgentMailAddressSummary {
  name: string
  email: string | null
  label: string
}

export interface CrmAgentMailAttachmentSummary {
  reference: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export type CrmAgentMailMatchReason
  = | 'manual_link'
    | 'sent_from_context'
    | 'bank_mail_agent'
    | 'participant_email'
    | 'mailbox_search'

export interface CrmAgentMailThreadSummary {
  reference: string
  mailbox: string
  provider: 'google' | 'microsoft' | 'imap'
  folders: Array<'inbox' | 'sent'>
  matchReason: CrmAgentMailMatchReason
  matchedEmails: string[]
  participants: CrmAgentMailAddressSummary[]
  subject: string
  latestAt: string | null
  listedMessageCount: number
  snippet: string
  hasAttachments: boolean
  url: string
}

export interface CrmAgentMailSearchResponse {
  data: {
    folder: CrmAgentMailFolder
    attachmentFilter: CrmAgentMailAttachmentFilter
    query: string | null
    participantEmail: string | null
    context: {
      type: CrmAgentMailScopeType
      id: string
      label: string
      emailCount: number
      emailsTruncated: boolean
    } | null
    searchedAccountCount: number
    partialFailureCount: number
    coverage: {
      complete: boolean
      nextCursor: string | null
      omittedLinkedThreadCount: number
      omittedResultCount: number
      reason: 'complete' | 'more_available' | 'partial_failure' | 'context_email_limit' | 'linked_window_limit' | 'result_window_limit' | 'continuation_unavailable'
    }
    threads: CrmAgentMailThreadSummary[]
  }
}

export interface CrmAgentMailThreadReadRequest {
  references: string[]
  question?: string
}

export type CrmAgentMailMessageDirection = 'received' | 'sent' | 'other'

export interface CrmAgentMailThreadMessage {
  ordinal: number
  direction: CrmAgentMailMessageDirection
  from: CrmAgentMailAddressSummary | null
  to: CrmAgentMailAddressSummary[]
  cc: CrmAgentMailAddressSummary[]
  subject: string
  sentAt: string | null
  bodyExcerpt: string
  bodyExcerptStart: number
  bodyTruncated: boolean
  authentication: 'pass' | 'fail' | 'unknown'
  replyToMismatch: boolean
  attachments: CrmAgentMailAttachmentSummary[]
  omittedAttachmentCount: number
}

export interface CrmAgentMailThreadReadResult {
  rank: number
  mailbox: string
  provider: 'google' | 'microsoft' | 'imap'
  subject: string
  providerMessageCount: number
  matchedMessageCountInWindow: number
  filteredMessageCount: number
  returnedMessageCount: number
  omittedMessageCount: number
  messages: CrmAgentMailThreadMessage[]
  url: string
}

export interface CrmAgentMailThreadReadResponse {
  data: {
    requestedThreadCount: number
    readThreadCount: number
    failureCount: number
    threads: CrmAgentMailThreadReadResult[]
  }
}

export interface CrmAgentMailAttachmentReadRequest {
  reference: string
  question?: string
}

export interface CrmAgentMailAttachmentExcerpt {
  locator: string | null
  text: string
}

export type CrmAgentMailAttachmentReadStatus = 'extracted' | 'no_text' | 'unsupported'

export interface CrmAgentMailAttachmentReadResponse {
  data: {
    fileName: string
    mimeType: string
    sizeBytes: number
    source: {
      mailbox: string
      sender: string | null
      subject: string
      sentAt: string | null
    }
    extraction: {
      status: CrmAgentMailAttachmentReadStatus
      kind: string
      pageCount: number | null
      truncated: boolean
      reason: string | null
      excerpts: CrmAgentMailAttachmentExcerpt[]
    }
  }
}
