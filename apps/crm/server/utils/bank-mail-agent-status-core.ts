import { createHash } from 'node:crypto'
import type {
  MailBankAgentAttachment,
  MailBankAgentAttachmentResolutionCode,
  MailBankAgentAttachmentState,
  MailBankAgentReanalysis,
  MailBankAgentReanalysisState,
  MailBankAgentResult,
  MailBankAgentResultClassification,
  MailBankAgentResultCode,
  MailBankAgentState,
  MailBankAgentStatus,
  MailBankAgentThreadLink,
  MailBankAgentThreadLinkState,
  MailProviderId,
} from '../../shared/types/mail.ts'

export const MAX_BANK_MAIL_AGENT_STATUS_MESSAGES = 50
export const MAX_BANK_MAIL_PROVIDER_MESSAGE_ID_CHARACTERS = 4_096

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const sha256Pattern = /^[0-9a-f]{64}$/u
const supportedStates = new Set<MailBankAgentState>([
  'processing',
  'review_required',
  'completed',
  'failed',
])
const supportedResultCodes = new Set<MailBankAgentResultCode>([
  'proposal_created',
  'no_match',
  'needs_human_selection',
  'not_bank_mail',
  'security_rejected',
  'processing_failed',
])
const supportedClassifications = new Set<MailBankAgentResultClassification>([
  'strong_candidate',
  'ambiguous_candidate',
])
const supportedEvidenceCodes = new Set([
  'bank_application_reference',
  'applicant_identity',
  'expert_identity',
  'bank_identity',
  'case_context',
  'application_status',
  'attachment_metadata',
])
const supportedContradictionCodes = new Set([
  'multiple_candidates',
  'bank_mismatch',
  'reference_mismatch',
  'owner_mismatch',
  'stale_application',
  'weak_evidence',
  'attachment_unavailable',
  'prompt_injection_suspected',
])
const supportedReasonCodes = new Set([
  'trusted_bank_identity',
  'unknown_bank_identity',
  'bank_identity_mismatch',
  'authentication_failed',
  'authentication_indeterminate',
  'authentication_policy_invalid',
  'dmarc_not_aligned',
  'dkim_not_aligned',
  'reply_to_mismatch',
  ...supportedEvidenceCodes,
  ...supportedContradictionCodes,
  'no_candidate',
  'no_matching_signal',
  'not_bank_message',
  'unsafe_attachment',
  'processing_error',
  'human_review_required',
  'policy_requires_review',
])
const supportedThreadLinkStates = new Set<MailBankAgentThreadLinkState>([
  'pending',
  'linked',
  'not_linked',
  'conflict',
])
const supportedThreadLinkResolutionCodes = new Set([
  'strong_proposal_linked',
  'existing_same_case_link',
  'thread_linked_to_other_context',
  'no_strong_proposal',
  'proposal_not_strong',
  'proposal_not_unique',
  'analysis_run_not_unique',
  'proposal_state_invalid',
  'trusted_envelope_invalid',
])
const supportedReanalysisStates = new Set<MailBankAgentReanalysisState>([
  'processing',
  'completed',
  'failed',
])
const supportedAttachmentStates = new Set<MailBankAgentAttachmentState>([
  'queued',
  'downloading',
  'verifying_source',
  'unlocking',
  'validating',
  'importing',
  'attached',
  'review_required',
  'retrying',
  'failed',
  'conflict',
])
const supportedAttachmentResolutionCodes = new Set<MailBankAgentAttachmentResolutionCode>([
  'openexpert_mock_esis_attached',
  'existing_esis_requires_review',
  'source_archive_mismatch',
  'dispatch_generation_changed',
  'attachment_scope_conflict',
  'canonical_link_invalid',
  'policy_disabled',
  'attachment_not_found',
  'attachment_ambiguous',
  'archive_invalid',
  'archive_unlock_failed',
  'pdf_invalid',
  'inspection_failed',
  'storage_object_conflict',
  'retry_limit_reached',
  'processing_failed',
  'provider_unavailable',
  'storage_unavailable',
  'processing_timeout',
])
const activeAttachmentStates = new Set<MailBankAgentAttachmentState>([
  'queued',
  'downloading',
  'verifying_source',
  'unlocking',
  'validating',
  'importing',
])
const attachmentResolutionsByState: Partial<Record<
  MailBankAgentAttachmentState,
  ReadonlySet<MailBankAgentAttachmentResolutionCode>
>> = {
  retrying: new Set([
    'provider_unavailable',
    'storage_unavailable',
    'processing_timeout',
  ]),
  attached: new Set(['openexpert_mock_esis_attached']),
  review_required: new Set([
    'existing_esis_requires_review',
  ]),
  conflict: new Set([
    'source_archive_mismatch',
    'dispatch_generation_changed',
    'storage_object_conflict',
    'attachment_scope_conflict',
  ]),
  failed: new Set([
    'policy_disabled',
    'canonical_link_invalid',
    'attachment_not_found',
    'attachment_ambiguous',
    'archive_invalid',
    'archive_unlock_failed',
    'pdf_invalid',
    'inspection_failed',
    'retry_limit_reached',
    'processing_failed',
  ]),
}

export interface BankMailAgentStatusRequest {
  connectionId: string
  messageIds: string[]
}

export interface BankMailAgentStatusIdentity {
  messageId: string
  sha256: string
}

export interface ImapStableMessageIdentity {
  mailbox: string
  uidValidity: string
  uid: number
}

export function parseBankMailAgentStatusRequest(value: unknown): BankMailAgentStatusRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Nieprawidłowe zapytanie o stan analizy wiadomości.')
  }
  const input = value as Record<string, unknown>
  const allowedFields = new Set(['connectionId', 'messageIds'])
  if (Object.keys(input).some(key => !allowedFields.has(key))) {
    throw new TypeError('Zapytanie o stan analizy zawiera nieobsługiwane pole.')
  }

  const connectionId = String(input.connectionId ?? '').trim()
  if (!uuidPattern.test(connectionId)) {
    throw new TypeError('Nieprawidłowe połączenie pocztowe.')
  }
  if (!Array.isArray(input.messageIds)) {
    throw new TypeError('Brakuje identyfikatorów wiadomości.')
  }

  const messageIds = [...new Set(input.messageIds.map((value) => {
    if (typeof value !== 'string') {
      throw new TypeError('Nieprawidłowy identyfikator wiadomości.')
    }
    const messageId = value.trim()
    if (
      !messageId
      || messageId.length > MAX_BANK_MAIL_PROVIDER_MESSAGE_ID_CHARACTERS
      || /[\u0000-\u001F\u007F]/u.test(messageId)
    ) {
      throw new TypeError('Nieprawidłowy identyfikator wiadomości.')
    }
    return messageId
  }))]
  if (!messageIds.length || messageIds.length > MAX_BANK_MAIL_AGENT_STATUS_MESSAGES) {
    throw new TypeError('Nieprawidłowa liczba wiadomości do sprawdzenia.')
  }
  return { connectionId, messageIds }
}

/**
 * Produces the exact PII-free identity stored by the bank-mail intake ledger.
 * Google and Microsoft expose immutable message IDs. IMAP needs the canonical
 * mailbox/UIDVALIDITY/UID tuple because its encrypted route reference is
 * intentionally randomized on every listing.
 */
export function bankMailProviderMessageIdentitySha256(
  provider: MailProviderId,
  providerMessageId: string,
  imapIdentity?: ImapStableMessageIdentity,
): string {
  const messageId = providerMessageId.trim()
  if (
    !messageId
    || messageId.length > MAX_BANK_MAIL_PROVIDER_MESSAGE_ID_CHARACTERS
    || /[\u0000-\u001F\u007F]/u.test(messageId)
  ) {
    throw new TypeError('Nieprawidłowy identyfikator wiadomości.')
  }

  let stableIdentity = messageId
  if (provider === 'imap') {
    const mailbox = String(imapIdentity?.mailbox ?? '')
    const uidValidity = String(imapIdentity?.uidValidity ?? '')
    const uid = Number(imapIdentity?.uid)
    if (
      !mailbox
      || mailbox.length > 1_024
      || /[\u0000-\u001F\u007F]/u.test(mailbox)
      || !/^\d{1,40}$/u.test(uidValidity)
      || !Number.isSafeInteger(uid)
      || uid < 1
    ) {
      throw new TypeError('Nieprawidłowa tożsamość wiadomości IMAP.')
    }
    stableIdentity = `${mailbox}\u001f${uidValidity}\u001f${uid}`
  }

  return createHash('sha256').update(stableIdentity, 'utf8').digest('hex')
}

export function mapBankMailAgentStatuses(
  identities: readonly BankMailAgentStatusIdentity[],
  value: unknown,
): MailBankAgentStatus[] {
  if (!Array.isArray(value)) throw new TypeError('Nieprawidłowa odpowiedź stanu analizy.')
  const messageIdsByHash = new Map<string, string[]>()
  for (const identity of identities) {
    const messageIds = messageIdsByHash.get(identity.sha256) ?? []
    if (!messageIds.includes(identity.messageId)) messageIds.push(identity.messageId)
    messageIdsByHash.set(identity.sha256, messageIds)
  }
  const statuses: MailBankAgentStatus[] = []
  const seen = new Set<string>()

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const sha256 = String(row.providerMessageIdSha256 ?? '')
    const state = String(row.state ?? '') as MailBankAgentState
    const messageIds = sha256Pattern.test(sha256) ? messageIdsByHash.get(sha256) : undefined
    if (!messageIds || !supportedStates.has(state)) continue
    for (const messageId of messageIds) {
      if (seen.has(messageId)) continue
      seen.add(messageId)
      statuses.push({
        messageId,
        state,
        result: bankMailAgentResult(row.result),
        link: bankMailAgentThreadLink(row.link),
        context: null,
        reanalysis: bankMailAgentReanalysis(row.reanalysis),
        attachment: bankMailAgentAttachment(row.attachment),
      })
    }
  }
  return statuses
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function controlledStringArray(
  value: unknown,
  allowed: ReadonlySet<string>,
  maximum: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null
  const normalized = value.map(item => typeof item === 'string' ? item : '')
  if (
    normalized.some(item => !allowed.has(item))
    || new Set(normalized).size !== normalized.length
  ) return null
  return normalized
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 100) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  const normalized = String(value).trim().toLowerCase()
  return uuidPattern.test(normalized) ? normalized : undefined
}

function bankMailAgentResult(value: unknown): MailBankAgentResult | null {
  const row = record(value)
  if (!row) return null
  const code = String(row.code ?? '') as MailBankAgentResultCode
  const classificationValue = row.classification === null || row.classification === undefined
    ? null
    : String(row.classification) as MailBankAgentResultClassification
  const evidenceCodes = controlledStringArray(row.evidenceCodes, supportedEvidenceCodes, 12)
  const contradictionCodes = controlledStringArray(
    row.contradictionCodes,
    supportedContradictionCodes,
    12,
  )
  const reasonCodes = controlledStringArray(row.reasonCodes, supportedReasonCodes, 24)
  const completedAt = isoTimestamp(row.completedAt)
  const caseId = nullableUuid(row.caseId)
  const applicationId = nullableUuid(row.applicationId)
  if (
    !supportedResultCodes.has(code)
    || (classificationValue !== null && !supportedClassifications.has(classificationValue))
    || !evidenceCodes
    || !contradictionCodes
    || !reasonCodes
    || !completedAt
    || caseId === undefined
    || applicationId === undefined
  ) return null
  if (
    code === 'proposal_created'
      ? !classificationValue || !caseId || !applicationId || evidenceCodes.length === 0
      : classificationValue !== null || caseId !== null || applicationId !== null
  ) return null
  return {
    code,
    classification: classificationValue,
    evidenceCodes,
    contradictionCodes,
    reasonCodes,
    completedAt,
    caseId,
    applicationId,
  }
}

function bankMailAgentThreadLink(value: unknown): MailBankAgentThreadLink | null {
  const row = record(value)
  if (!row) return null
  const state = String(row.state ?? '') as MailBankAgentThreadLinkState
  const resolutionCode = row.resolutionCode === null || row.resolutionCode === undefined
    ? null
    : String(row.resolutionCode)
  const caseId = nullableUuid(row.caseId)
  if (
    !supportedThreadLinkStates.has(state)
    || (resolutionCode !== null && !supportedThreadLinkResolutionCodes.has(resolutionCode))
    || caseId === undefined
    || (state === 'linked' && caseId === null)
  ) return null
  return { state, resolutionCode, caseId }
}

function bankMailAgentReanalysis(value: unknown): MailBankAgentReanalysis {
  const row = record(value)
  if (!row) return emptyBankMailAgentReanalysis()
  const state = row.state === null || row.state === undefined
    ? null
    : String(row.state) as MailBankAgentReanalysisState
  const attemptNo = Number(row.attemptNo ?? 0)
  const requestedAt = row.requestedAt === null || row.requestedAt === undefined
    ? null
    : isoTimestamp(row.requestedAt)
  const completedAt = row.completedAt === null || row.completedAt === undefined
    ? null
    : isoTimestamp(row.completedAt)
  const canRerun = row.canRerun === true
  const retryAfterSeconds = Number(row.retryAfterSeconds ?? 0)
  const result = bankMailAgentResult(row.result)
  if (
    (state !== null && !supportedReanalysisStates.has(state))
    || !Number.isSafeInteger(attemptNo)
    || attemptNo < 0
    || attemptNo > 1_000
    || (state !== null && requestedAt === null)
    || ((state === 'completed' || state === 'failed') && completedAt === null)
    || (state === null && (attemptNo !== 0 || requestedAt !== null || completedAt !== null))
    || !Number.isSafeInteger(retryAfterSeconds)
    || retryAfterSeconds < 0
    || retryAfterSeconds > 86_400
    || (state === 'completed' && !result)
    || (state !== 'completed' && result)
  ) return emptyBankMailAgentReanalysis()
  return {
    state,
    attemptNo,
    requestedAt,
    completedAt,
    canRerun,
    retryAfterSeconds,
    result,
  }
}

function emptyBankMailAgentReanalysis(): MailBankAgentReanalysis {
  return {
    state: null,
    attemptNo: 0,
    requestedAt: null,
    completedAt: null,
    canRerun: false,
    retryAfterSeconds: 0,
    result: null,
  }
}

function bankMailAgentAttachment(value: unknown): MailBankAgentAttachment | null {
  const row = record(value)
  if (!row) return null
  const state = String(row.state ?? '') as MailBankAgentAttachmentState
  const resolutionCode = row.resolutionCode === null || row.resolutionCode === undefined
    ? null
    : String(row.resolutionCode) as MailBankAgentAttachmentResolutionCode
  const documentId = nullableUuid(row.documentId)
  const fileName = row.fileName === null || row.fileName === undefined
    ? null
    : String(row.fileName).trim()
  const completedAt = row.completedAt === null || row.completedAt === undefined
    ? null
    : isoTimestamp(row.completedAt)
  const terminal = new Set<MailBankAgentAttachmentState>([
    'attached',
    'review_required',
    'failed',
    'conflict',
  ]).has(state)
  const resolutionValid = activeAttachmentStates.has(state)
    ? resolutionCode === null
    : resolutionCode !== null
      && Boolean(attachmentResolutionsByState[state]?.has(resolutionCode))
  if (
    !supportedAttachmentStates.has(state)
    || (resolutionCode !== null && !supportedAttachmentResolutionCodes.has(resolutionCode))
    || !resolutionValid
    || documentId === undefined
    || (fileName !== null && (
      !fileName
      || fileName.length > 255
      || /[\u0000-\u001F\u007F]/u.test(fileName)
    ))
    || (terminal !== Boolean(completedAt))
    || (state === 'attached' && (!documentId || !fileName))
    || (state !== 'attached' && (documentId !== null || fileName !== null))
  ) return null
  return {
    state,
    resolutionCode,
    documentId,
    fileName,
    completedAt,
  }
}
