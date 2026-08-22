import { createHmac } from 'node:crypto'
import {
  createMailAgentAttachmentReference,
  mailAgentAttachmentReferenceConnectionId,
  openMailAgentAttachmentReference,
} from './mail-agent-reference.ts'

const threadMessagePrefix = 'openexpert-agent-mail-thread-v1.'
const threadReferenceIndex = 99

export type MailAgentThreadAccessMode = 'mailbox' | 'linked' | 'participants'

export interface MailAgentThreadContinuation {
  cursor: string
  newerMessageCount: number
  providerMessageCount: number
}

export interface MailAgentThreadReferencePayload {
  connectionId: string
  threadId: string
  accessMode: MailAgentThreadAccessMode
  participantEmails: string[]
  continuation: MailAgentThreadContinuation | null
  expiresAt: number
}

interface EncodedThreadAccess {
  v: 1
  m: 'm' | 'l' | 'p'
  p: string[]
}

interface EncodedThreadAccessV2 {
  v: 2
  m: 'm' | 'l' | 'p'
  p: string[]
  w: { c: string; n: number; t: number }
}

function threadReferenceSecret(secret: string): string {
  const value = String(secret ?? '')
  if (Buffer.byteLength(value, 'utf8') < 16) {
    throw new TypeError('Sekret odnośników wątków nie jest skonfigurowany.')
  }
  return createHmac('sha256', value)
    .update('openexpert/crm-agent-mail-thread-reference/v1\0', 'utf8')
    .digest('base64url')
}

/**
 * Thread references reuse the audited AEAD envelope used for attachments, but
 * with a domain-separated key and an exact sentinel payload. An attachment
 * reference therefore cannot be replayed as a thread reference or vice versa.
 */
export function createMailAgentThreadReference(
  input: Omit<MailAgentThreadReferencePayload, 'expiresAt' | 'continuation'> & {
    expiresAt?: number
    continuation?: MailAgentThreadContinuation | null
  },
  secret: string,
  now = Date.now(),
): string {
  const access = encodeThreadAccess(
    input.accessMode,
    input.participantEmails,
    input.continuation ?? null,
  )
  return createMailAgentAttachmentReference({
    connectionId: input.connectionId,
    threadId: input.threadId,
    messageId: `${threadMessagePrefix}${Buffer.from(JSON.stringify(access), 'utf8').toString('base64url')}`,
    attachmentId: null,
    attachmentIndex: threadReferenceIndex,
    ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
  }, threadReferenceSecret(secret), now)
}

export function mailAgentThreadReferenceConnectionId(value: string): string {
  return mailAgentAttachmentReferenceConnectionId(value)
}

export function openMailAgentThreadReference(
  value: string,
  secret: string,
  now = Date.now(),
): MailAgentThreadReferencePayload {
  const payload = openMailAgentAttachmentReference(
    value,
    threadReferenceSecret(secret),
    now,
  )
  if (
    !payload.messageId.startsWith(threadMessagePrefix)
    || payload.attachmentId !== null
    || payload.attachmentIndex !== threadReferenceIndex
  ) {
    throw new TypeError('Odnośnik do wątku jest nieprawidłowy albo wygasł.')
  }
  const access = decodeThreadAccess(payload.messageId.slice(threadMessagePrefix.length))
  return {
    connectionId: payload.connectionId,
    threadId: payload.threadId,
    accessMode: access.accessMode,
    participantEmails: access.participantEmails,
    continuation: access.continuation,
    expiresAt: payload.expiresAt,
  }
}

function normalizedParticipantEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase()
  if (
    !email
    || email.length > 254
    || /[\u0000-\u0020\u007F]/u.test(email)
    || !/^[^@]+@[^@]+$/u.test(email)
  ) throw new TypeError('Zakres uczestników wątku jest nieprawidłowy.')
  return email
}

function normalizedContinuation(value: unknown): MailAgentThreadContinuation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Kontynuacja wątku jest nieprawidłowa.')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort().join(',')
  const encoded = keys === 'c,n,t'
  const cursor = String(encoded ? record.c : record.cursor).trim()
  const newerMessageCount = Number(encoded ? record.n : record.newerMessageCount)
  const providerMessageCount = Number(encoded ? record.t : record.providerMessageCount)
  if (
    (!encoded && keys !== 'cursor,newerMessageCount,providerMessageCount')
    || !cursor
    || cursor.length > 6_000
    || /[\u0000-\u001F\u007F]/u.test(cursor)
    || !Number.isSafeInteger(newerMessageCount)
    || newerMessageCount < 1
    || newerMessageCount > 100_000
    || !Number.isSafeInteger(providerMessageCount)
    || providerMessageCount < 2
    || providerMessageCount > 100_000
    || newerMessageCount >= providerMessageCount
  ) throw new TypeError('Kontynuacja wątku jest nieprawidłowa.')
  return { cursor, newerMessageCount, providerMessageCount }
}

function encodeThreadAccess(
  accessMode: MailAgentThreadAccessMode,
  participantEmails: string[],
  continuation: MailAgentThreadContinuation | null,
): EncodedThreadAccess | EncodedThreadAccessV2 {
  if (!['mailbox', 'linked', 'participants'].includes(accessMode)) {
    throw new TypeError('Tryb dostępu do wątku jest nieprawidłowy.')
  }
  const participants = [...new Set((participantEmails ?? []).map(normalizedParticipantEmail))]
  if (
    participants.length > 12
    || (accessMode === 'participants' && participants.length < 1)
    || (accessMode !== 'participants' && participants.length > 0)
  ) throw new TypeError('Zakres uczestników wątku jest nieprawidłowy.')
  const base = {
    v: 1,
    m: accessMode === 'mailbox' ? 'm' : accessMode === 'linked' ? 'l' : 'p',
    p: participants,
  } satisfies EncodedThreadAccess
  if (!continuation) return base
  const window = normalizedContinuation(continuation)
  return {
    ...base,
    v: 2,
    w: {
      c: window.cursor,
      n: window.newerMessageCount,
      t: window.providerMessageCount,
    },
  }
}

function decodeThreadAccess(value: string): {
  accessMode: MailAgentThreadAccessMode
  participantEmails: string[]
  continuation: MailAgentThreadContinuation | null
} {
  try {
    const canonical = Buffer.from(value, 'base64url')
    if (canonical.toString('base64url') !== value) throw new Error('non-canonical')
    const parsed = JSON.parse(canonical.toString('utf8')) as Record<string, unknown>
    const keys = Object.keys(parsed).sort().join(',')
    const legacy = parsed.v === 1 && keys === 'm,p,v'
    const current = parsed.v === 2 && keys === 'm,p,v,w'
    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || (!legacy && !current)
      || !['m', 'l', 'p'].includes(String(parsed.m))
      || !Array.isArray(parsed.p)
    ) throw new Error('invalid')
    const accessMode: MailAgentThreadAccessMode = parsed.m === 'm'
      ? 'mailbox'
      : parsed.m === 'l' ? 'linked' : 'participants'
    const continuation = current
      ? normalizedContinuation(parsed.w)
      : null
    const encoded = encodeThreadAccess(accessMode, parsed.p, continuation)
    return { accessMode, participantEmails: encoded.p, continuation }
  }
  catch {
    throw new TypeError('Odnośnik do wątku jest nieprawidłowy albo wygasł.')
  }
}
