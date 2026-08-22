import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createMailAgentAttachmentReference,
  mailAgentAttachmentReferenceConnectionId,
  openMailAgentAttachmentReference,
} from '../server/utils/mail-agent-reference.ts'
import {
  createMailAgentThreadReference,
  mailAgentThreadReferenceConnectionId,
  openMailAgentThreadReference,
} from '../server/utils/mail-agent-thread-reference.ts'

const secret = 'test-mail-agent-reference-secret-000000000000'
const connectionId = '11111111-1111-4111-8111-111111111111'
const now = Date.UTC(2026, 7, 22, 12)

test('seals an attachment locator and verifies its connection binding', () => {
  const reference = createMailAgentAttachmentReference({
    connectionId,
    threadId: 'thread-reference',
    messageId: 'message-reference',
    attachmentId: 'attachment-reference=',
    attachmentIndex: 2,
  }, secret, now)

  assert.equal(mailAgentAttachmentReferenceConnectionId(reference), connectionId)
  assert.doesNotMatch(
    Buffer.from(reference, 'base64url').toString('utf8'),
    /thread-reference|message-reference|attachment-reference/u,
  )
  assert.deepEqual(openMailAgentAttachmentReference(reference, secret, now + 1), {
    connectionId,
    threadId: 'thread-reference',
    messageId: 'message-reference',
    attachmentId: 'attachment-reference=',
    attachmentIndex: 2,
    expiresAt: now + 60 * 60 * 1_000,
  })
})

test('rejects tampered, wrongly bound and expired attachment references', () => {
  const reference = createMailAgentAttachmentReference({
    connectionId,
    threadId: 'thread-reference',
    messageId: 'message-reference',
    attachmentId: null,
    attachmentIndex: 0,
  }, secret, now)
  const replacement = reference.endsWith('A') ? 'B' : 'A'
  const tampered = `${reference.slice(0, -1)}${replacement}`

  assert.throws(() => openMailAgentAttachmentReference(tampered, secret, now), /nieprawidłowy albo wygasł/u)
  assert.throws(() => openMailAgentAttachmentReference(reference, `${secret}-wrong`, now), /nieprawidłowy albo wygasł/u)
  assert.throws(() => openMailAgentAttachmentReference(reference, secret, now + 60 * 60 * 1_000), /nieprawidłowy albo wygasł/u)
  assert.throws(() => openMailAgentAttachmentReference(reference, secret, now + 60 * 60 * 1_000 + 1), /nieprawidłowy albo wygasł/u)
})

test('seals participant-bound thread access separately from attachment references', () => {
  const reference = createMailAgentThreadReference({
    connectionId,
    threadId: 'thread-reference',
    accessMode: 'participants',
    participantEmails: ['Client@Example.com', 'client@example.com'],
  }, secret, now)

  assert.equal(mailAgentThreadReferenceConnectionId(reference), connectionId)
  assert.deepEqual(openMailAgentThreadReference(reference, secret, now + 1), {
    connectionId,
    threadId: 'thread-reference',
    accessMode: 'participants',
    participantEmails: ['client@example.com'],
    expiresAt: now + 60 * 60 * 1_000,
  })
  assert.throws(
    () => openMailAgentAttachmentReference(reference, secret, now + 1),
    /nieprawidłowy albo wygasł/u,
  )
})

test('rejects thread references with the wrong domain key or invalid participant scope', () => {
  assert.throws(() => createMailAgentThreadReference({
    connectionId,
    threadId: 'thread-reference',
    accessMode: 'participants',
    participantEmails: [],
  }, secret, now), /Zakres uczestników/u)

  const reference = createMailAgentThreadReference({
    connectionId,
    threadId: 'thread-reference',
    accessMode: 'linked',
    participantEmails: [],
  }, secret, now)
  assert.throws(
    () => openMailAgentThreadReference(reference, `${secret}-wrong`, now + 1),
    /nieprawidłowy albo wygasł/u,
  )
})
