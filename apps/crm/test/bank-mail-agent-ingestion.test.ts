import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bankMailAttachmentEncrypted,
  canonicalBankMailSourceSha256,
  matchingBankSenderIdentity,
} from '../server/utils/bank-mail-agent-ingestion-core.ts'
import type { MailMessageDetail } from '../shared/types/mail.ts'

function message(from: string): MailMessageDetail {
  return {
    id: 'gmail-message-1',
    from: { name: 'OpenExpert Bank', email: from, label: from },
    replyTo: [],
    to: [],
    cc: [],
    subject: '[DEMO] OpenExpert Bank — formularz ESIS — OEB-20260821-123456',
    sentAt: '2026-08-21T10:00:00.000Z',
    unread: true,
    bodyText: 'Numer wniosku: OEB-20260821-123456',
    bodyHtml: null,
    bodyHtmlTruncated: false,
    hasRemoteImages: false,
    bodyTruncated: false,
    attachments: [{ id: 'attachment-1', filename: 'esis.zip', mimeType: 'application/zip', size: 1234 }],
    security: { authentication: 'pass', dmarcAligned: true, replyToMismatch: false },
  }
}

test('bank sender allowlist requires an exact domain unless subdomains are enabled', () => {
  const exact = { bank_id: 'bank-1', sender_domain: 'openexpert.app', allow_subdomains: false }
  assert.equal(matchingBankSenderIdentity([exact], message('dokumenty@openexpert.app'))?.bank_id, 'bank-1')
  assert.equal(matchingBankSenderIdentity([exact], message('dokumenty@mail.openexpert.app')), null)
  assert.equal(matchingBankSenderIdentity(
    [{ ...exact, allow_subdomains: true }],
    message('dokumenty@mail.openexpert.app'),
  )?.bank_id, 'bank-1')
  assert.equal(matchingBankSenderIdentity([exact], message('dokumenty@openexpert.app.evil.test')), null)
})

test('canonical source hash is stable and changes with inspected content or DMARC', () => {
  const input = message('dokumenty@openexpert.app')
  assert.equal(canonicalBankMailSourceSha256(input), canonicalBankMailSourceSha256({ ...input }))
  assert.notEqual(
    canonicalBankMailSourceSha256(input),
    canonicalBankMailSourceSha256({ ...input, bodyText: `${input.bodyText}!` }),
  )
  assert.notEqual(
    canonicalBankMailSourceSha256(input),
    canonicalBankMailSourceSha256({
      ...input,
      security: { ...input.security, dmarcAligned: false },
    }),
  )
})

test('encrypted ZIP metadata is explicit without opening the attachment', () => {
  assert.equal(bankMailAttachmentEncrypted('ESIS.ZIP', 'application/octet-stream'), true)
  assert.equal(bankMailAttachmentEncrypted('decyzja.pdf', 'application/pdf'), null)
})
