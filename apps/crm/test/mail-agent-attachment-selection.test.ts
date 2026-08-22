import assert from 'node:assert/strict'
import test from 'node:test'
import type { MailThreadDetail } from '../shared/types/mail.ts'
import {
  resolveMailAgentAttachment,
} from '../server/utils/mail-agent-attachment-selection.ts'
import type { MailAgentAttachmentReferencePayload } from '../server/utils/mail-agent-reference.ts'

const detail: MailThreadDetail = {
  id: 'thread-1',
  subject: 'Dokumenty',
  omittedMessageCount: 0,
  externalUrl: null,
  messages: [{
    id: 'message-1',
    from: null,
    replyTo: [],
    to: [],
    cc: [],
    subject: 'Dokumenty',
    sentAt: '2026-08-22T10:00:00.000Z',
    unread: false,
    bodyText: '',
    bodyHtml: null,
    bodyHtmlTruncated: false,
    hasRemoteImages: false,
    bodyTruncated: false,
    attachments: [
      { id: 'attachment-1', filename: 'decyzja.pdf', mimeType: 'application/pdf', size: 123 },
      { id: 'attachment-2', filename: 'tabela.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: 456 },
    ],
    security: { authentication: 'unknown', replyToMismatch: false },
  }],
}

function payload(overrides: Partial<MailAgentAttachmentReferencePayload> = {}): MailAgentAttachmentReferencePayload {
  return {
    connectionId: '11111111-1111-4111-8111-111111111111',
    threadId: 'thread-1',
    messageId: 'message-1',
    attachmentId: 'attachment-2',
    attachmentIndex: 1,
    expiresAt: Date.now() + 1_000,
    ...overrides,
  }
}

test('resolves only the exact live message and attachment binding', () => {
  const resolved = resolveMailAgentAttachment(detail, payload())
  assert.equal(resolved.message.id, 'message-1')
  assert.equal(resolved.attachment.filename, 'tabela.xlsx')
})

test('rejects stale or rearranged attachment references', () => {
  assert.throws(() => resolveMailAgentAttachment(detail, payload({ threadId: 'thread-2' })), /wygasł albo plik został przeniesiony/u)
  assert.throws(() => resolveMailAgentAttachment(detail, payload({ messageId: 'message-2' })), /wygasł albo plik został przeniesiony/u)
  assert.throws(() => resolveMailAgentAttachment(detail, payload({ attachmentIndex: 0 })), /wygasł albo plik został przeniesiony/u)
  assert.throws(() => resolveMailAgentAttachment(detail, payload({ attachmentId: 'attachment-1' })), /wygasł albo plik został przeniesiony/u)
})
