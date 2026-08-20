const MAX_SUBJECT_CHARACTERS = 400
const MAX_BODY_CHARACTERS = 32_000
const MAX_FILENAME_CHARACTERS = 180
const MAX_ATTACHMENTS = 10

const emailAddressPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu
const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>{}\[\]]+/giu
const labelledProtectedIdentifierPattern
  = /\b(PESEL|NIP)\b\s*(?:nr\.?\s*)?[:=#-]?\s*[0-9][0-9 .-]{8,16}/giu
const standaloneProtectedIdentifierPattern
  = /(?<![\p{L}\p{N}])(?:\d[ .-]?){9,10}\d(?![\p{L}\p{N}])/gu

export interface BankMailAgentAttachmentContext {
  filename: string
  mimeType: string
  size: number
  encrypted?: boolean | null
}

export interface BankMailAgentPromptInput {
  subject: string
  bodyText: string
  bodyTruncated: boolean
  attachments: readonly BankMailAgentAttachmentContext[]
}

export interface BankMailAgentPromptPayload {
  surface: 'bank-mail-intake'
  task: 'classify-and-propose-case-match'
  contentTrust: 'untrusted'
  constraints: {
    noAutomaticAttachment: true
    noProtectedIdentifiersIncluded: true
    useTrustedToolsForScopeAndSenderIdentity: true
  }
  message: {
    subject: string
    bodyText: string
    bodyTruncated: boolean
    attachmentsTruncated: boolean
    attachments: Array<{
      token: string
      filename: string
      mimeType: string
      size: number
      encrypted: boolean | null
    }>
  }
}

function boundedInteger(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(Math.trunc(value), 25 * 1024 * 1024)
}

/**
 * Normalizes untrusted mail text before it becomes model input. Exact PESEL/NIP
 * values, mailbox addresses and links are deliberately unavailable to EVE.
 */
export function sanitizeBankMailAgentText(value: string, maximum: number): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .replace(labelledProtectedIdentifierPattern, '$1 [identyfikator chroniony]')
    .replace(standaloneProtectedIdentifierPattern, '[identyfikator chroniony]')
    .replace(emailAddressPattern, '[adres e-mail]')
    .replace(urlPattern, '[link]')
    .trim()
    .slice(0, maximum)
}

function normalizedMimeType(value: string): string {
  const normalized = value.trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(normalized)
    ? normalized.slice(0, 120)
    : 'application/octet-stream'
}

export function buildBankMailAgentPromptPayload(
  input: BankMailAgentPromptInput,
): BankMailAgentPromptPayload {
  const attachments = input.attachments.slice(0, MAX_ATTACHMENTS).map((attachment, index) => ({
    token: `attachment-${index + 1}`,
    filename: sanitizeBankMailAgentText(attachment.filename, MAX_FILENAME_CHARACTERS),
    mimeType: normalizedMimeType(attachment.mimeType),
    size: boundedInteger(attachment.size),
    encrypted: typeof attachment.encrypted === 'boolean' ? attachment.encrypted : null,
  }))

  const normalizedBody = sanitizeBankMailAgentText(input.bodyText, MAX_BODY_CHARACTERS)

  return {
    surface: 'bank-mail-intake',
    task: 'classify-and-propose-case-match',
    contentTrust: 'untrusted',
    constraints: {
      noAutomaticAttachment: true,
      noProtectedIdentifiersIncluded: true,
      useTrustedToolsForScopeAndSenderIdentity: true,
    },
    message: {
      subject: sanitizeBankMailAgentText(input.subject, MAX_SUBJECT_CHARACTERS),
      bodyText: normalizedBody,
      bodyTruncated: input.bodyTruncated || normalizedBody.length < input.bodyText.trim().length,
      attachmentsTruncated: input.attachments.length > attachments.length,
      attachments,
    },
  }
}

export function buildBankMailAgentPrompt(input: BankMailAgentPromptInput): string {
  return JSON.stringify(buildBankMailAgentPromptPayload(input))
}
