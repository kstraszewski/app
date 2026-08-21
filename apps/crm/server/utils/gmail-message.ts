import { TextDecoder } from 'node:util'
import type {
  MailAddress,
  MailAttachment,
  MailMessageSecurity,
  MailMessageDetail,
  MailThreadDetail,
  MailThreadSummary,
} from '../../shared/types/mail.ts'
import { stripUnsafeMailDisplayControls } from '../../shared/utils/mail-security.ts'
import { sanitizeMailHtml } from './mail-html.ts'

export interface GmailHeader {
  name?: string
  value?: string
}

export interface GmailMessagePartBody {
  attachmentId?: string
  size?: number
  data?: string
}

export interface GmailMessagePart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: GmailMessagePartBody
  parts?: GmailMessagePart[]
}

export interface GmailMessageResource {
  id?: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailMessagePart
}

export interface GmailThreadResource {
  id?: string
  snippet?: string
  messages?: GmailMessageResource[]
}

export interface GmailAttachmentSource {
  attachmentId: string | null
  inlineData: string | null
  filename: string
  mimeType: string
  size: number
}

export const MAX_GMAIL_MIME_DEPTH = 10
export const MAX_GMAIL_MIME_PARTS = 100
export const MAX_GMAIL_MESSAGE_ATTACHMENTS = 20

export class GmailMimeStructureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmailMimeStructureError'
  }
}

const MESSAGE_BODY_CHARACTER_LIMIT = 160_000
const THREAD_BODY_CHARACTER_LIMIT = 500_000
const THREAD_HTML_CHARACTER_LIMIT = 1_000_000
const MAX_THREAD_MESSAGES = 20
const GMAIL_AUTHENTICATION_RESULTS_AUTHSERV_ID = 'mx.google.com'
const MAIL_DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u

export function gmailThreadSummary(
  thread: GmailThreadResource,
  accountEmail: string,
): MailThreadSummary {
  const messages = sortMessages(thread.messages ?? [])
  const latest = messages.at(-1)
  const labels = new Set(messages.flatMap(message => message.labelIds ?? []))
  const participants = threadParticipants(messages, accountEmail)

  return {
    id: String(thread.id ?? ''),
    latestMessageId: String(latest?.id ?? '') || undefined,
    messageCount: messages.length,
    participants,
    participantsLabel: participantLabel(participants),
    subject: displayHeader(latest, 'subject') || displayHeader(messages[0], 'subject') || '(bez tematu)',
    snippet: normalizeSnippet(latest?.snippet || thread.snippet || ''),
    latestAt: messageDate(latest),
    unread: labels.has('UNREAD'),
    starred: labels.has('STARRED'),
    important: labels.has('IMPORTANT'),
    draft: labels.has('DRAFT'),
    hasAttachments: messages.some(message => partHasAttachment(message.payload)),
  }
}

export function gmailThreadDetail(
  thread: GmailThreadResource,
  accountEmail: string,
  externalUrl: string,
): MailThreadDetail {
  const allMessages = sortMessages(thread.messages ?? [])
  const selectedMessages = allMessages.slice(-MAX_THREAD_MESSAGES)
  let remainingCharacters = THREAD_BODY_CHARACTER_LIMIT

  const messages = selectedMessages.map((message) => {
    const parsed = gmailMessageDetail(message)
    if (parsed.bodyText.length <= remainingCharacters) {
      remainingCharacters -= parsed.bodyText.length
      return parsed
    }

    const bodyText = parsed.bodyText.slice(0, Math.max(0, remainingCharacters)).trimEnd()
    remainingCharacters = 0
    return {
      ...parsed,
      bodyText,
      bodyTruncated: true,
    }
  })

  let remainingHtmlCharacters = THREAD_HTML_CHARACTER_LIMIT
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const parsed = messages[index]!
    if (!parsed.bodyHtml) continue
    if (parsed.bodyHtml.length <= remainingHtmlCharacters) {
      remainingHtmlCharacters -= parsed.bodyHtml.length
      continue
    }
    messages[index] = {
      ...parsed,
      bodyHtml: null,
      bodyHtmlTruncated: true,
    }
    remainingHtmlCharacters = 0
  }

  const subject = messages.at(-1)?.subject
    || displayHeader(allMessages.at(-1), 'subject')
    || '(bez tematu)'

  return {
    id: String(thread.id ?? ''),
    subject,
    messages,
    omittedMessageCount: Math.max(0, allMessages.length - selectedMessages.length),
    externalUrl: externalUrlForAccount(externalUrl, accountEmail),
  }
}

export function gmailMessageDetail(message: GmailMessageResource): MailMessageDetail {
  const textParts: string[] = []
  const htmlParts: string[] = []
  collectTextParts(message.payload, textParts, htmlParts)

  const plainBody = normalizeBody(textParts.filter(Boolean).join('\n\n'))
  const selectedHtmlBody = selectBestHtmlPart(htmlParts)
  const sanitizedHtml = selectedHtmlBody
    ? sanitizeMailHtml(selectedHtmlBody)
    : { html: null, hasRemoteImages: false, truncated: false }
  const htmlBody = plainBody ? '' : htmlToText(sanitizedHtml.html || selectedHtmlBody)
  const fallbackBody = normalizeSnippet(message.snippet || '')
  const fullBody = plainBody || htmlBody || fallbackBody
  const bodyTruncated = fullBody.length > MESSAGE_BODY_CHARACTER_LIMIT
  const bodyText = bodyTruncated
    ? fullBody.slice(0, MESSAGE_BODY_CHARACTER_LIMIT).trimEnd()
    : fullBody

  return {
    id: String(message.id ?? ''),
    from: parseMailAddresses(messageHeader(message, 'from'))[0] ?? null,
    replyTo: parseMailAddresses(messageHeader(message, 'reply-to')),
    to: parseMailAddresses(messageHeader(message, 'to')),
    cc: parseMailAddresses(messageHeader(message, 'cc')),
    subject: displayHeader(message, 'subject') || '(bez tematu)',
    sentAt: messageDate(message),
    unread: (message.labelIds ?? []).includes('UNREAD'),
    bodyText,
    bodyHtml: sanitizedHtml.html,
    bodyHtmlTruncated: sanitizedHtml.truncated,
    hasRemoteImages: sanitizedHtml.hasRemoteImages,
    bodyTruncated,
    attachments: collectAttachments(message.payload),
    security: gmailMessageSecurity(message),
  }
}

export function gmailMessageSecurity(message: GmailMessageResource): MailMessageSecurity {
  const trustedResults = headerValues(message.payload?.headers, 'authentication-results')
    // Gmail's own authentication verdict is stamped with `mx.google.com` as
    // authserv-id. Other Authentication-Results fields are transit data or
    // sender-controlled input and must not produce a pass/fail badge.
    // https://support.google.com/mail/answer/180707
    .filter(value => authenticationResultsAuthservId(value) === GMAIL_AUTHENTICATION_RESULTS_AUTHSERV_ID)
  const results = trustedResults
    .join(' ')
    .toLowerCase()
  const statusByMechanism = new Map<string, string>()
  for (const match of results.matchAll(/\b(spf|dkim|dmarc)=([a-z_-]+)/gu)) {
    const mechanism = match[1]
    const status = match[2]
    if (mechanism && status && !statusByMechanism.has(mechanism)) {
      statusByMechanism.set(mechanism, status)
    }
  }

  const dmarc = statusByMechanism.get('dmarc')
  const spf = statusByMechanism.get('spf')
  const dkim = statusByMechanism.get('dkim')
  const authentication = dmarc === 'pass'
    ? 'pass'
    : dmarc === 'fail'
      ? 'fail'
      : spf === 'pass' || dkim === 'pass'
        ? 'pass'
        : [spf, dkim].some(value => (
            value === 'fail'
            || value === 'softfail'
            || value === 'permerror'
          ))
          ? 'fail'
          : 'unknown'

  const fromDomain = addressDomain(
    parseMailAddresses(messageHeader(message, 'from'))[0]?.email,
  )
  const replyToDomains = parseMailAddresses(messageHeader(message, 'reply-to'))
    .map(address => addressDomain(address.email))
    .filter(Boolean)

  return {
    authentication,
    dkimAligned: Boolean(
      fromDomain
      && trustedResults.some(value => authenticationResultsHasAlignedDkimPass(value, fromDomain)),
    ),
    dmarcAligned: dmarc === 'pass',
    replyToMismatch: Boolean(
      fromDomain
      && replyToDomains.length
      && replyToDomains.some(domain => domain !== fromDomain),
    ),
  }
}

function authenticationResultsHasAlignedDkimPass(
  value: string,
  fromDomain: string,
): boolean {
  for (const clause of value.split(';').slice(1)) {
    if (!/^\s*dkim=pass(?:\s|$)/iu.test(clause)) continue
    for (const match of clause.matchAll(/\bheader\.(i|d)=("[^"]*"|[^\s;]+)/giu)) {
      const kind = match[1]?.toLowerCase()
      const rawValue = String(match[2] ?? '').replace(/^"|"$/gu, '')
      if (kind === 'i' && !rawValue.includes('@')) continue
      const identityDomain = kind === 'i'
        ? rawValue.slice(rawValue.lastIndexOf('@') + 1)
        : rawValue
      const normalizedDomain = identityDomain.trim().toLowerCase().replace(/\.$/u, '')
      if (
        normalizedDomain === fromDomain
        && MAIL_DOMAIN_PATTERN.test(normalizedDomain)
      ) return true
    }
  }
  return false
}

function authenticationResultsAuthservId(value: string): string | null {
  const firstClause = value.split(';', 1)[0]?.trim().toLowerCase() || ''
  return /^[a-z0-9.-]+$/u.test(firstClause) ? firstClause : null
}

export function parseMailAddresses(value: string): MailAddress[] {
  const safeValue = stripUnsafeMailDisplayControls(value)
  if (!safeValue.trim()) return []

  return splitAddressHeader(safeValue)
    .slice(0, 50)
    .map((entry): MailAddress | null => {
      const angleMatch = entry.match(/^(.*?)<([^<>]+)>$/u)
      const rawEmail = angleMatch?.[2]?.trim()
        || entry.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0]
        || null
      const email = rawEmail?.replace(/^mailto:/iu, '').trim().toLowerCase() || null
      const rawName = angleMatch?.[1]?.trim() || (email ? entry.replace(email, '').trim() : entry.trim())
      const name = decodeHeaderLabel(rawName.replace(/^["']|["']$/gu, '').trim())
      const label = name || email || decodeHeaderLabel(entry.trim())
      if (!label) return null
      return { name, email, label }
    })
    .filter((address): address is MailAddress => Boolean(address))
}

export function messageHeader(
  message: GmailMessageResource | undefined,
  name: string,
): string {
  return headerValue(message?.payload?.headers, name)
}

function headerValue(headers: GmailHeader[] | undefined, name: string): string {
  const header = headers?.find(item => item.name?.toLowerCase() === name.toLowerCase())
  return String(header?.value ?? '').trim()
}

function headerValues(headers: GmailHeader[] | undefined, name: string): string[] {
  return (headers ?? [])
    .filter(item => item.name?.toLowerCase() === name.toLowerCase())
    .map(item => String(item.value ?? '').trim())
    .filter(Boolean)
}

function displayHeader(
  message: GmailMessageResource | undefined,
  name: string,
): string {
  return stripUnsafeMailDisplayControls(decodeMimeWords(messageHeader(message, name)))
    .replace(/\r?\n[ \t]*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function sortMessages(messages: GmailMessageResource[]): GmailMessageResource[] {
  return [...messages].sort((left, right) => {
    const leftTime = Number(left.internalDate ?? 0)
    const rightTime = Number(right.internalDate ?? 0)
    return leftTime - rightTime
  })
}

function messageDate(message: GmailMessageResource | undefined): string | null {
  const internalDate = Number(message?.internalDate)
  if (Number.isFinite(internalDate) && internalDate > 0) {
    return new Date(internalDate).toISOString()
  }

  const headerDate = messageHeader(message, 'date')
  const parsedDate = Date.parse(headerDate)
  return Number.isNaN(parsedDate) ? null : new Date(parsedDate).toISOString()
}

function threadParticipants(
  messages: GmailMessageResource[],
  accountEmail: string,
): MailAddress[] {
  const normalizedAccountEmail = accountEmail.trim().toLowerCase()
  return uniqueAddresses(messages.flatMap(message => [
    ...parseMailAddresses(messageHeader(message, 'from')),
    ...parseMailAddresses(messageHeader(message, 'to')),
    ...parseMailAddresses(messageHeader(message, 'cc')),
    ...parseMailAddresses(messageHeader(message, 'bcc')),
  ])).filter(address => address.email !== normalizedAccountEmail)
}

function uniqueAddresses(addresses: MailAddress[]): MailAddress[] {
  const seen = new Set<string>()
  return addresses.filter((address) => {
    const key = address.email || address.label.toLocaleLowerCase('pl')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function participantLabel(participants: MailAddress[]): string {
  if (!participants.length) return 'Nieznany nadawca'
  const visible = participants.slice(0, 3).map(participant => participant.label)
  const remaining = participants.length - visible.length
  return remaining > 0 ? `${visible.join(', ')} +${remaining}` : visible.join(', ')
}

function splitAddressHeader(value: string): string[] {
  const entries: string[] = []
  let current = ''
  let quoted = false
  let angleDepth = 0

  for (const character of value) {
    if (character === '"') quoted = !quoted
    if (!quoted && character === '<') angleDepth += 1
    if (!quoted && character === '>') angleDepth = Math.max(0, angleDepth - 1)

    if (character === ',' && !quoted && angleDepth === 0) {
      if (current.trim()) entries.push(current.trim())
      current = ''
      continue
    }
    current += character
  }
  if (current.trim()) entries.push(current.trim())
  return entries
}

function collectTextParts(
  part: GmailMessagePart | undefined,
  textParts: string[],
  htmlParts: string[],
): void {
  walkGmailMimeParts(part, (candidate) => {
    const filename = String(candidate.filename ?? '').trim()
    const mimeType = String(candidate.mimeType ?? '').toLowerCase()
    const disposition = headerValue(candidate.headers, 'content-disposition')
      .split(';', 1)[0]
      ?.trim()
      .toLowerCase()
    if (filename || disposition === 'attachment' || mimeType === 'message/rfc822') return false

    if (candidate.body?.data) {
      const decoded = decodePartBody(candidate)
      if (mimeType === 'text/plain') textParts.push(decoded)
      else if (mimeType === 'text/html') htmlParts.push(decoded)
    }
    return true
  })
}

function selectBestHtmlPart(parts: string[]): string {
  let selected = ''
  for (const part of parts) {
    const candidate = part.trim()
    if (candidate.length > selected.length) selected = candidate
  }
  return selected
}

function decodePartBody(part: GmailMessagePart): string {
  const value = part.body?.data
  if (!value) return ''
  try {
    const bytes = Buffer.from(value.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64')
    const contentType = headerValue(part.headers, 'content-type')
    const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/iu)?.[1] || 'utf-8'
    try {
      return new TextDecoder(charset, { fatal: false }).decode(bytes)
    } catch {
      return bytes.toString('utf8')
    }
  } catch {
    return ''
  }
}

export function gmailMessageAttachmentSources(
  message: GmailMessageResource,
): GmailAttachmentSource[] {
  const part = message.payload
  if (!part) return []
  const result: GmailAttachmentSource[] = []
  walkGmailMimeParts(part, (candidate) => {
    const filename = String(candidate.filename ?? '').trim()
    const mimeType = String(candidate.mimeType ?? '').toLowerCase()
    const disposition = headerValue(candidate.headers, 'content-disposition')
      .split(';', 1)[0]
      ?.trim()
      .toLowerCase()
    if (filename) {
      result.push({
        attachmentId: candidate.body?.attachmentId || null,
        inlineData: candidate.body?.data || null,
        filename: stripUnsafeMailDisplayControls(filename).trim() || 'załącznik',
        mimeType: mimeType || 'application/octet-stream',
        size: Math.max(0, Number(candidate.body?.size) || 0),
      })
    }
    // An attached message/container is one opaque MIME attachment. Never
    // treat files nested inside it as attachments of the trusted outer mail.
    return !(filename || disposition === 'attachment' || mimeType === 'message/rfc822')
  })
  return result
}

function walkGmailMimeParts(
  root: GmailMessagePart | undefined,
  visit: (part: GmailMessagePart) => boolean | void,
): void {
  if (!root) return
  const stack: Array<{ part: unknown, depth: number, active: boolean }> = [
    { part: root, depth: 0, active: true },
  ]
  let partCount = 0
  let attachmentCount = 0

  while (stack.length) {
    const frame = stack.pop()!
    if (!frame.part || typeof frame.part !== 'object' || Array.isArray(frame.part)) {
      throw new GmailMimeStructureError('Gmail MIME tree contains an invalid part')
    }
    if (frame.depth > MAX_GMAIL_MIME_DEPTH) {
      throw new GmailMimeStructureError('Gmail MIME tree is too deep')
    }
    partCount += 1
    if (partCount > MAX_GMAIL_MIME_PARTS) {
      throw new GmailMimeStructureError('Gmail MIME tree has too many parts')
    }

    const part = frame.part as GmailMessagePart
    if (String(part.filename ?? '').trim()) {
      attachmentCount += 1
      if (attachmentCount > MAX_GMAIL_MESSAGE_ATTACHMENTS) {
        throw new GmailMimeStructureError('Gmail message has too many attachments')
      }
    }
    const children = part.parts
    if (children !== undefined && !Array.isArray(children)) {
      throw new GmailMimeStructureError('Gmail MIME part children are invalid')
    }
    if ((children?.length ?? 0) > 0 && frame.depth >= MAX_GMAIL_MIME_DEPTH) {
      throw new GmailMimeStructureError('Gmail MIME tree is too deep')
    }

    const descendantsActive = frame.active && visit(part) !== false
    for (let index = (children?.length ?? 0) - 1; index >= 0; index -= 1) {
      stack.push({
        part: children![index],
        depth: frame.depth + 1,
        active: descendantsActive,
      })
    }
  }
}

function collectAttachments(part: GmailMessagePart | undefined): MailAttachment[] {
  if (!part) return []
  return gmailMessageAttachmentSources({ payload: part }).map(source => ({
    id: source.attachmentId,
    filename: source.filename,
    mimeType: source.mimeType,
    size: source.size,
  }))
}

function partHasAttachment(part: GmailMessagePart | undefined): boolean {
  let found = false
  walkGmailMimeParts(part, (candidate) => {
    if (String(candidate.filename ?? '').trim()) found = true
    return true
  })
  return found
}

function normalizeSnippet(value: string): string {
  return stripUnsafeMailDisplayControls(decodeHtmlEntities(value))
    .replace(/\s+/gu, ' ')
    .trim()
}

function normalizeBody(value: string): string {
  return stripUnsafeMailDisplayControls(decodeHtmlEntities(value))
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
}

function htmlToText(value: string): string {
  const withoutActiveContent = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/giu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
  const withLineBreaks = withoutActiveContent
    .replace(/<(?:br|hr)\b[^>]*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|tr|h[1-6])\s*>/giu, '\n\n')
    .replace(/<li\b[^>]*>/giu, '\n• ')
    .replace(/<\/(?:li|td|th)\s*>/giu, ' ')
  return normalizeBody(
    withLineBreaks
      .replace(/<[^>]+>/gu, ' ')
      .replace(/[ \t]+/gu, ' ')
      .replace(/[ \t]*\n[ \t]*/gu, '\n')
      .replace(/\s+([.,!?;:])/gu, '$1'),
  )
}

function decodeHeaderLabel(value: string): string {
  return stripUnsafeMailDisplayControls(decodeHtmlEntities(decodeMimeWords(value)))
    .replace(/\s+/gu, ' ')
    .trim()
}

function decodeMimeWords(value: string): string {
  const joined = value.replace(/(\?=)[ \t]+(?==\?)/gu, '$1')
  return joined.replace(
    /=\?([^?\s]+)\?([bq])\?([^?]*)\?=/giu,
    (encodedWord, charset: string, encoding: string, payload: string) => {
      try {
        const bytes = encoding.toLowerCase() === 'b'
          ? Buffer.from(payload, 'base64')
          : Buffer.from(
              payload
                .replace(/_/gu, ' ')
                .replace(/=([\dA-F]{2})/giu, (_match, hex: string) => (
                  String.fromCharCode(Number.parseInt(hex, 16))
                )),
              'latin1',
            )
        return new TextDecoder(charset, { fatal: false }).decode(bytes)
      } catch {
        return encodedWord
      }
    },
  )
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: '\'',
    bull: '•',
    gt: '>',
    hellip: '…',
    lt: '<',
    mdash: '—',
    middot: '·',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    zwnj: '',
    zwj: '',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, key: string) => {
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16)
      return validUnicodeCodePoint(code) ? String.fromCodePoint(code) : entity
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10)
      return validUnicodeCodePoint(code) ? String.fromCodePoint(code) : entity
    }
    return named[key.toLowerCase()] ?? entity
  })
}

function validUnicodeCodePoint(value: number): boolean {
  return Number.isInteger(value)
    && value >= 0
    && value <= 0x10FFFF
    && !(value >= 0xD800 && value <= 0xDFFF)
}

function externalUrlForAccount(baseUrl: string, accountEmail: string): string {
  if (baseUrl) return baseUrl
  return `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all`
}

function addressDomain(email: string | null | undefined): string {
  const at = email?.lastIndexOf('@') ?? -1
  return at >= 0 ? email!.slice(at + 1).toLowerCase() : ''
}
