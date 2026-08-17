import { createHash, randomBytes } from 'node:crypto'
import type { MailContextScope } from '../../shared/types/mail.ts'

const CRLF = '\r\n'
const MIME_BASE64_LINE_LENGTH = 76
const SUBJECT_CHUNK_BYTE_LENGTH = 42

export interface GmailSendAttachment {
  filename: string
  mimeType: string
  data: Uint8Array
}

export interface GmailSendMessageInput {
  from?: string
  to?: string | readonly string[]
  cc?: string | readonly string[]
  bcc?: string | readonly string[]
  subject: string
  text: string
  attachments?: readonly GmailSendAttachment[]
  messageId?: string
  threadId?: string
  inReplyTo?: string
  references?: string | readonly string[]
}

export interface GmailSendPayload {
  raw: string
  threadId?: string
}

export interface GmailSendRequestHashInput {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  threadId: string
  attachments: GmailSendAttachment[]
  context?: {
    type: 'client' | 'case'
    id: string
  }
  contexts?: readonly MailContextScope[]
}

export function gmailSendRequestHash(input: GmailSendRequestHashInput): string {
  const attachments = input.attachments.map(attachment => ({
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.data.byteLength,
    sha256: createHash('sha256').update(attachment.data).digest('hex'),
  }))
  const contexts = input.contexts?.length
    ? canonicalHashContexts(input.contexts)
    : null
  return createHash('sha256').update(JSON.stringify({
    to: input.to.map(value => value.toLowerCase()),
    cc: input.cc.map(value => value.toLowerCase()),
    bcc: input.bcc.map(value => value.toLowerCase()),
    subject: input.subject,
    body: input.body,
    threadId: input.threadId,
    ...(contexts?.length
      ? { contexts }
      : input.context ? { context: input.context } : {}),
    attachments,
  }), 'utf8').digest('hex')
}

function canonicalHashContexts(contexts: readonly MailContextScope[]): MailContextScope[] {
  const unique = new Map<string, MailContextScope>()
  for (const context of contexts) {
    const scope = {
      type: context.type,
      id: String(context.id).trim().toLowerCase(),
    } as MailContextScope
    unique.set(`${scope.type}:${scope.id}`, scope)
  }
  return [...unique.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === 'case' ? -1 : 1
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

export function gmailSendMessageId(idempotencyKey: string): string {
  return `<${idempotencyKey}@mail.openexpert.app>`
}

export function parseGmailRecipientList(value: string): string[] {
  if (/[\0\r]/u.test(value)) {
    throw new TypeError('Recipient list contains invalid control characters')
  }
  const recipients = value
    .split(/[;,\n]+/u)
    .map(recipient => recipient.trim())
    .filter(Boolean)

  const unique: string[] = []
  const seen = new Set<string>()
  for (const recipient of recipients) {
    if (!validEmailAddress(recipient)) {
      throw new TypeError(`Invalid email recipient: ${recipient.slice(0, 100)}`)
    }
    const key = recipient.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(recipient)
    }
  }
  if (unique.length > 50 || unique.join(', ').length > 900) {
    throw new TypeError('Recipient list is too long')
  }
  return unique
}

/**
 * Builds the request body accepted by Gmail's `users.messages.send` endpoint.
 *
 * The MIME message uses CRLF line endings and base64 transfer encoding. The
 * complete RFC 2822 message is returned as unpadded base64url in `raw`.
 */
export function buildGmailSendPayload(input: GmailSendMessageInput): GmailSendPayload {
  const from = optionalHeaderValue(input.from, 'From')
  const to = recipientHeaderValue(input.to, 'To')
  const cc = recipientHeaderValue(input.cc, 'Cc')
  const bcc = recipientHeaderValue(input.bcc, 'Bcc')
  const subject = encodeSubject(input.subject)
  const messageId = optionalHeaderValue(input.messageId, 'Message-ID')
  const inReplyTo = optionalHeaderValue(input.inReplyTo, 'In-Reply-To')
  const references = referencesHeaderValue(input.references)
  const threadId = optionalHeaderValue(input.threadId, 'threadId')
  const attachments = input.attachments ?? []

  if (!to && !cc && !bcc) {
    throw new TypeError('At least one To, Cc, or Bcc recipient is required')
  }

  const headers: string[] = []
  if (from) headers.push(`From: ${from}`)
  if (to) headers.push(`To: ${to}`)
  if (cc) headers.push(`Cc: ${cc}`)
  if (bcc) headers.push(`Bcc: ${bcc}`)
  headers.push(`Subject: ${subject}`)
  if (messageId) headers.push(`Message-ID: ${messageId}`)
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`)
  if (references) headers.push(`References: ${references}`)
  headers.push('MIME-Version: 1.0')

  let message: string
  if (attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset="UTF-8"')
    headers.push('Content-Transfer-Encoding: base64')
    message = [
      ...headers,
      '',
      encodeMimeBase64(normalizeTextLineEndings(input.text)),
      '',
    ].join(CRLF)
  }
  else {
    const boundary = createMimeBoundary()
    headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)

    const parts = [
      [
        `--${boundary}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        encodeMimeBase64(normalizeTextLineEndings(input.text)),
      ].join(CRLF),
      ...attachments.map(attachment => attachmentMimePart(boundary, attachment)),
      `--${boundary}--`,
    ]

    message = [
      ...headers,
      '',
      ...parts,
      '',
    ].join(CRLF)
  }

  return {
    raw: Buffer.from(message, 'utf8').toString('base64url'),
    ...(threadId ? { threadId } : {}),
  }
}

function attachmentMimePart(
  boundary: string,
  attachment: GmailSendAttachment,
): string {
  const filename = requiredHeaderValue(attachment.filename, 'attachment filename')
  const mimeType = requiredHeaderValue(attachment.mimeType, 'attachment MIME type')
  if (Buffer.byteLength(filename, 'utf8') > 180) {
    throw new TypeError('Attachment filename is too long')
  }
  if (
    mimeType.length > 100
    || !/^[A-Z0-9!#$&^_.+-]+\/[A-Z0-9!#$&^_.+-]+$/iu.test(mimeType)
  ) {
    throw new TypeError('Attachment MIME type is invalid')
  }

  const fallbackFilename = asciiFilenameFallback(filename)
  const encodedFilename = encodeRfc5987Value(filename)

  return [
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${fallbackFilename}";`,
    ` filename*=UTF-8''${encodedFilename}`,
    '',
    encodeMimeBase64(attachment.data),
  ].join(CRLF)
}

function recipientHeaderValue(
  value: string | readonly string[] | undefined,
  headerName: string,
): string {
  const recipients = (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .map(recipient => requiredHeaderValue(recipient, headerName).trim())
    .filter(Boolean)

  return recipients.join(', ')
}

function referencesHeaderValue(
  value: string | readonly string[] | undefined,
): string {
  if (value === undefined) return ''
  const entries = (Array.isArray(value) ? value : [value])
    .map(reference => requiredHeaderValue(reference, 'References').trim())
    .filter(Boolean)
  return entries.join(' ')
}

function optionalHeaderValue(
  value: string | undefined,
  fieldName: string,
): string {
  if (value === undefined) return ''
  return requiredHeaderValue(value, fieldName).trim()
}

function requiredHeaderValue(value: string, fieldName: string): string {
  if (/[\0\r\n]/u.test(value)) {
    throw new TypeError(`${fieldName} cannot contain NUL, CR, or LF characters`)
  }
  if (!value.trim()) {
    throw new TypeError(`${fieldName} cannot be empty`)
  }
  return value
}

function encodeSubject(subject: string): string {
  if (/[\0\r\n]/u.test(subject)) {
    throw new TypeError('Subject cannot contain NUL, CR, or LF characters')
  }
  if (!subject) return ''

  const chunks: string[] = []
  let current = ''

  for (const character of subject) {
    const candidate = current + character
    if (current && Buffer.byteLength(candidate, 'utf8') > SUBJECT_CHUNK_BYTE_LENGTH) {
      chunks.push(current)
      current = character
    }
    else {
      current = candidate
    }
  }
  if (current) chunks.push(current)

  return chunks
    .map(chunk => `=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`)
    .join(`${CRLF} `)
}

function normalizeTextLineEndings(value: string): string {
  return value.replace(/\r\n|\r|\n/gu, CRLF)
}

function encodeMimeBase64(value: string | Uint8Array): string {
  const base64 = typeof value === 'string'
    ? Buffer.from(value, 'utf8').toString('base64')
    : Buffer.from(value).toString('base64')

  if (!base64) return ''
  const lines: string[] = []
  for (let offset = 0; offset < base64.length; offset += MIME_BASE64_LINE_LENGTH) {
    lines.push(base64.slice(offset, offset + MIME_BASE64_LINE_LENGTH))
  }
  return lines.join(CRLF)
}

function createMimeBoundary(): string {
  return `----=_OpenExpert_${randomBytes(18).toString('hex')}`
}

function validEmailAddress(value: string): boolean {
  if (value.length > 254 || /\s/u.test(value)) return false
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (
    local.length > 64
    || local.startsWith('.')
    || local.endsWith('.')
    || local.includes('..')
    || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu.test(local)
    || domain.length > 253
  ) {
    return false
  }
  const labels = domain.split('.')
  return labels.length >= 2 && labels.every(label => (
    label.length >= 1
    && label.length <= 63
    && /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/iu.test(label)
  ))
}

function asciiFilenameFallback(filename: string): string {
  const fallback = filename
    .replace(/[^\x20-\x7E]/gu, '_')
    .replace(/["\\]/gu, '\\$&')
  return fallback || 'attachment'
}

function encodeRfc5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/gu, character => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ))
}
