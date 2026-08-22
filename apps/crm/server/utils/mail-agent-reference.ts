import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto'
import { CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH } from '../../shared/types/agent-mail.ts'

export const MAIL_AGENT_ATTACHMENT_REFERENCE_TTL_MS = 60 * 60 * 1_000
export const MAIL_AGENT_ATTACHMENT_REFERENCE_MAX_LENGTH
  = CRM_AGENT_MAIL_ATTACHMENT_REFERENCE_MAX_LENGTH

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
// Thread continuations embed a provider cursor plus the exact participant
// boundary inside the encrypted messageId sentinel. The final envelope remains
// capped separately at 24 KB.
const maximumProviderReferenceLength = 10_000
const referenceVersion = 1
const connectionSelectorBytes = 16
const nonceBytes = 12
const authenticationTagBytes = 16
const referenceContext = Buffer.from('openexpert/crm-agent-mail-attachment/v1\0', 'utf8')

export interface MailAgentAttachmentReferencePayload {
  connectionId: string
  threadId: string
  messageId: string
  attachmentId: string | null
  attachmentIndex: number
  expiresAt: number
}

interface EncodedMailAgentAttachmentReference {
  v: 1
  c: string
  t: string
  m: string
  a: string | null
  i: number
  e: number
}

function invalidReference(): TypeError {
  return new TypeError('Odnośnik do załącznika jest nieprawidłowy albo wygasł.')
}

function providerReference(value: unknown): string {
  const normalized = String(value ?? '').trim()
  if (
    !normalized
    || normalized.length > maximumProviderReferenceLength
    || /[\u0000-\u001F\u007F]/u.test(normalized)
  ) throw invalidReference()
  return normalized
}

function parsePayload(value: unknown): MailAgentAttachmentReferencePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidReference()
  const record = value as Partial<EncodedMailAgentAttachmentReference>
  const keys = Object.keys(record).sort().join(',')
  if (keys !== 'a,c,e,i,m,t,v' || record.v !== 1) throw invalidReference()

  const connectionId = String(record.c ?? '').toLowerCase()
  if (!uuidPattern.test(connectionId)) throw invalidReference()
  const attachmentIndex = Number(record.i)
  const expiresAt = Number(record.e)
  if (
    !Number.isSafeInteger(attachmentIndex)
    || attachmentIndex < 0
    || attachmentIndex > 99
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= 0
  ) throw invalidReference()

  return {
    connectionId,
    threadId: providerReference(record.t),
    messageId: providerReference(record.m),
    attachmentId: record.a === null ? null : providerReference(record.a),
    attachmentIndex,
    expiresAt,
  }
}

function encodedPayload(input: MailAgentAttachmentReferencePayload): EncodedMailAgentAttachmentReference {
  const parsed = parsePayload({
    v: 1,
    c: input.connectionId,
    t: input.threadId,
    m: input.messageId,
    a: input.attachmentId,
    i: input.attachmentIndex,
    e: input.expiresAt,
  })
  return {
    v: 1,
    c: parsed.connectionId,
    t: parsed.threadId,
    m: parsed.messageId,
    a: parsed.attachmentId,
    i: parsed.attachmentIndex,
    e: parsed.expiresAt,
  }
}

function requiredSecret(secret: string): string {
  const normalized = String(secret ?? '')
  if (Buffer.byteLength(normalized, 'utf8') < 16) {
    throw new TypeError('Sekret odnośników załączników nie jest skonfigurowany.')
  }
  return normalized
}

function encryptionKey(secret: string): Buffer {
  return createHmac('sha256', requiredSecret(secret))
    .update(referenceContext)
    .update('encryption-key', 'utf8')
    .digest()
}

function connectionIdBytes(connectionId: string): Buffer {
  const normalized = connectionId.toLowerCase()
  if (!uuidPattern.test(normalized)) throw invalidReference()
  return Buffer.from(normalized.replaceAll('-', ''), 'hex')
}

function connectionIdFromBytes(bytes: Uint8Array): string {
  if (bytes.byteLength !== connectionSelectorBytes) throw invalidReference()
  const hex = Buffer.from(bytes).toString('hex')
  const connectionId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
  if (!uuidPattern.test(connectionId)) throw invalidReference()
  return connectionId
}

interface DecodedReferenceEnvelope {
  connectionId: string
  connectionSelector: Buffer
  nonce: Buffer
  authenticationTag: Buffer
  ciphertext: Buffer
}

function decodeEnvelope(value: string): DecodedReferenceEnvelope {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAIL_AGENT_ATTACHMENT_REFERENCE_MAX_LENGTH
    || !/^[A-Za-z0-9_-]+$/u.test(value)
  ) throw invalidReference()

  let envelope: Buffer
  try {
    envelope = Buffer.from(value, 'base64url')
  }
  catch {
    throw invalidReference()
  }
  if (
    envelope.toString('base64url') !== value
    || envelope.length <= 1 + connectionSelectorBytes + nonceBytes + authenticationTagBytes
    || envelope[0] !== referenceVersion
  ) throw invalidReference()

  const selectorStart = 1
  const nonceStart = selectorStart + connectionSelectorBytes
  const tagStart = nonceStart + nonceBytes
  const ciphertextStart = tagStart + authenticationTagBytes
  const connectionSelector = envelope.subarray(selectorStart, nonceStart)
  return {
    connectionId: connectionIdFromBytes(connectionSelector),
    connectionSelector,
    nonce: envelope.subarray(nonceStart, tagStart),
    authenticationTag: envelope.subarray(tagStart, ciphertextStart),
    ciphertext: envelope.subarray(ciphertextStart),
  }
}

function decodedPayload(payload: Uint8Array): MailAgentAttachmentReferencePayload {
  try {
    return parsePayload(JSON.parse(Buffer.from(payload).toString('utf8')))
  }
  catch {
    throw invalidReference()
  }
}

export function createMailAgentAttachmentReference(
  input: Omit<MailAgentAttachmentReferencePayload, 'expiresAt'> & { expiresAt?: number },
  secret: string,
  now = Date.now(),
): string {
  const expiresAt = input.expiresAt ?? now + MAIL_AGENT_ATTACHMENT_REFERENCE_TTL_MS
  if (
    !Number.isSafeInteger(now)
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= now
    || expiresAt > now + MAIL_AGENT_ATTACHMENT_REFERENCE_TTL_MS
  ) throw new TypeError('Czas ważności odnośnika do załącznika jest nieprawidłowy.')

  const payload = Buffer.from(JSON.stringify(encodedPayload({ ...input, expiresAt })), 'utf8')
  const connectionSelector = connectionIdBytes(input.connectionId)
  const nonce = randomBytes(nonceBytes)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), nonce)
  cipher.setAAD(Buffer.concat([referenceContext, connectionSelector]), {
    plaintextLength: payload.byteLength,
  })
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()])
  const reference = Buffer.concat([
    Buffer.from([referenceVersion]),
    connectionSelector,
    nonce,
    cipher.getAuthTag(),
    ciphertext,
  ]).toString('base64url')
  if (reference.length > MAIL_AGENT_ATTACHMENT_REFERENCE_MAX_LENGTH) {
    throw new TypeError('Odnośnik do załącznika jest zbyt długi.')
  }
  return reference
}

/**
 * Reads only the connection selector needed to locate the per-connection
 * verification secret. Callers must not trust any other unverified field.
 */
export function mailAgentAttachmentReferenceConnectionId(value: string): string {
  return decodeEnvelope(value).connectionId
}

export function openMailAgentAttachmentReference(
  value: string,
  secret: string,
  now = Date.now(),
): MailAgentAttachmentReferencePayload {
  const envelope = decodeEnvelope(value)
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), envelope.nonce)
    decipher.setAAD(Buffer.concat([referenceContext, envelope.connectionSelector]), {
      plaintextLength: envelope.ciphertext.byteLength,
    })
    decipher.setAuthTag(envelope.authenticationTag)
    const plaintext = Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ])
    const payload = decodedPayload(plaintext)
    if (
      payload.connectionId !== envelope.connectionId
      || !Number.isSafeInteger(now)
      || payload.expiresAt <= now
    ) throw invalidReference()
    return payload
  }
  catch {
    throw invalidReference()
  }
}
