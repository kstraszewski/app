import { createHmac } from 'node:crypto'
import {
  createMailAgentAttachmentReference,
  mailAgentAttachmentReferenceConnectionId,
  openMailAgentAttachmentReference,
} from './mail-agent-reference.ts'

const threadMessagePrefix = 'openexpert-agent-mail-thread-v1.'
const threadReferenceIndex = 99

export type MailAgentThreadAccessMode = 'mailbox' | 'linked' | 'participants'

export interface MailAgentThreadReferencePayload {
  connectionId: string
  threadId: string
  accessMode: MailAgentThreadAccessMode
  participantEmails: string[]
  expiresAt: number
}

interface EncodedThreadAccess {
  v: 1
  m: 'm' | 'l' | 'p'
  p: string[]
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
  input: Omit<MailAgentThreadReferencePayload, 'expiresAt'> & { expiresAt?: number },
  secret: string,
  now = Date.now(),
): string {
  const access = encodeThreadAccess(input.accessMode, input.participantEmails)
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

function encodeThreadAccess(
  accessMode: MailAgentThreadAccessMode,
  participantEmails: string[],
): EncodedThreadAccess {
  if (!['mailbox', 'linked', 'participants'].includes(accessMode)) {
    throw new TypeError('Tryb dostępu do wątku jest nieprawidłowy.')
  }
  const participants = [...new Set((participantEmails ?? []).map(normalizedParticipantEmail))]
  if (
    participants.length > 12
    || (accessMode === 'participants' && participants.length < 1)
    || (accessMode !== 'participants' && participants.length > 0)
  ) throw new TypeError('Zakres uczestników wątku jest nieprawidłowy.')
  return {
    v: 1,
    m: accessMode === 'mailbox' ? 'm' : accessMode === 'linked' ? 'l' : 'p',
    p: participants,
  }
}

function decodeThreadAccess(value: string): {
  accessMode: MailAgentThreadAccessMode
  participantEmails: string[]
} {
  try {
    const canonical = Buffer.from(value, 'base64url')
    if (canonical.toString('base64url') !== value) throw new Error('non-canonical')
    const parsed = JSON.parse(canonical.toString('utf8')) as Partial<EncodedThreadAccess>
    if (
      !parsed
      || typeof parsed !== 'object'
      || Array.isArray(parsed)
      || Object.keys(parsed).sort().join(',') !== 'm,p,v'
      || parsed.v !== 1
      || !['m', 'l', 'p'].includes(String(parsed.m))
      || !Array.isArray(parsed.p)
    ) throw new Error('invalid')
    const accessMode: MailAgentThreadAccessMode = parsed.m === 'm'
      ? 'mailbox'
      : parsed.m === 'l' ? 'linked' : 'participants'
    const encoded = encodeThreadAccess(accessMode, parsed.p)
    return { accessMode, participantEmails: encoded.p }
  }
  catch {
    throw new TypeError('Odnośnik do wątku jest nieprawidłowy albo wygasł.')
  }
}
