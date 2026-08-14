import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildGmailSendPayload,
  gmailSendMessageId,
  gmailSendRequestHash,
  parseGmailRecipientList,
  type GmailSendMessageInput,
} from '../server/utils/gmail-send.ts'
import { gmailBlockedAttachmentExtension } from '../shared/utils/mail-security.ts'

function decodeRaw(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8')
}

function decodeEncodedWords(value: string): string {
  return [...value.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/giu)]
    .map(match => Buffer.from(match[1]!, 'base64').toString('utf8'))
    .join('')
}

function build(overrides: Partial<GmailSendMessageInput> = {}) {
  return buildGmailSendPayload({
    to: 'anna@example.com',
    subject: 'Test',
    text: 'Treść',
    ...overrides,
  })
}

test('builds an unpadded base64url UTF-8 message with To, Cc, and Bcc', () => {
  const payload = build({
    to: ['Anna <anna@example.com>', 'biuro@example.com'],
    cc: 'doradca@example.com',
    bcc: ['archiwum@example.com'],
    subject: 'Zażółć gęślą jaźń — dokumenty',
    text: 'Dzień dobry,\n\nZażółć gęślą jaźń.',
  })

  assert.match(payload.raw, /^[A-Za-z0-9_-]+$/u)
  assert.doesNotMatch(payload.raw, /=/u)

  const message = decodeRaw(payload.raw)
  assert.match(message, /^To: Anna <anna@example\.com>, biuro@example\.com\r\n/mu)
  assert.match(message, /^Cc: doradca@example\.com\r\n/mu)
  assert.match(message, /^Bcc: archiwum@example\.com\r\n/mu)
  const subjectHeader = message.match(/^Subject: (.+(?:\r\n .+)*)\r\n/mu)?.[1]
  assert.equal(decodeEncodedWords(subjectHeader ?? ''), 'Zażółć gęślą jaźń — dokumenty')
  assert.doesNotMatch(message.replaceAll('\r\n', ''), /[\r\n]/u)

  const encodedText = message.split('\r\n\r\n')[1]?.trim() ?? ''
  assert.equal(
    Buffer.from(encodedText.replaceAll('\r\n', ''), 'base64').toString('utf8'),
    'Dzień dobry,\r\n\r\nZażółć gęślą jaźń.',
  )
})

test('returns Gmail threadId separately and includes reply headers', () => {
  const payload = build({
    messageId: '<request-123@mail.openexpert.app>',
    threadId: '18f123abc456',
    inReplyTo: '<message-2@example.com>',
    references: ['<message-1@example.com>', '<message-2@example.com>'],
  })

  assert.equal(payload.threadId, '18f123abc456')
  const message = decodeRaw(payload.raw)
  assert.match(message, /^Message-ID: <request-123@mail\.openexpert\.app>\r\n/mu)
  assert.match(message, /^In-Reply-To: <message-2@example\.com>\r\n/mu)
  assert.match(
    message,
    /^References: <message-1@example\.com> <message-2@example\.com>\r\n/mu,
  )
})

test('builds multipart MIME attachments with RFC 5987 filename and wrapped base64', () => {
  const attachment = Buffer.from(Array.from({ length: 120 }, (_, index) => index))
  const payload = build({
    subject: 'Załącznik',
    text: 'Plik w załączeniu.',
    attachments: [{
      filename: 'zażółć raport.pdf',
      mimeType: 'application/pdf',
      data: attachment,
    }],
  })

  const message = decodeRaw(payload.raw)
  const boundary = message.match(
    /^Content-Type: multipart\/mixed; boundary="([^"]+)"\r\n/mu,
  )?.[1]
  assert.ok(boundary)
  assert.equal(message.match(new RegExp(`--${boundary}`, 'gu'))?.length, 3)
  assert.match(message, /Content-Type: text\/plain; charset="UTF-8"\r\n/u)
  assert.match(message, /Content-Type: application\/pdf\r\n/u)
  assert.match(
    message,
    /filename\*=UTF-8''za%C5%BC%C3%B3%C5%82%C4%87%20raport\.pdf\r\n/u,
  )
  assert.match(message, new RegExp(`--${boundary}--\\r\\n$`, 'u'))

  const attachmentPart = message.split(`--${boundary}`)[2] ?? ''
  const encodedAttachment = attachmentPart.split('\r\n\r\n')[1]?.trim() ?? ''
  const encodedLines = encodedAttachment.split('\r\n')
  assert.ok(encodedLines.length > 1)
  assert.ok(encodedLines.every(line => line.length <= 76))
  assert.deepEqual(
    Buffer.from(encodedLines.join(''), 'base64'),
    attachment,
  )
})

test('rejects CRLF injection in every caller-controlled header', () => {
  const attempts: Partial<GmailSendMessageInput>[] = [
    { subject: 'Temat\r\nBcc: attacker@example.com' },
    { to: 'victim@example.com\nCc: attacker@example.com' },
    { inReplyTo: '<safe@example.com>\r\nX-Evil: yes' },
    { messageId: '<safe@example.com>\r\nX-Evil: yes' },
    {
      attachments: [{
        filename: 'raport.pdf\r\nX-Evil: yes',
        mimeType: 'application/pdf',
        data: Buffer.from('file'),
      }],
    },
  ]

  for (const attempt of attempts) {
    assert.throws(
      () => build(attempt),
      /cannot contain NUL, CR, or LF characters/u,
    )
  }
})

test('parses, deduplicates, and validates plain recipient lists', () => {
  assert.deepEqual(
    parseGmailRecipientList('Anna@example.com; biuro@example.org,\nanna@example.com'),
    ['Anna@example.com', 'biuro@example.org'],
  )
  assert.throws(
    () => parseGmailRecipientList('Anna <anna@example.com>'),
    /Invalid email recipient/u,
  )
  assert.throws(
    () => parseGmailRecipientList('safe@example.com\r\nBcc: attacker@example.com'),
    /invalid control characters/u,
  )
})

test('creates deterministic content hashes and Message-ID values for idempotency', () => {
  const input = {
    to: ['Anna@Example.com'],
    cc: [],
    bcc: [],
    subject: 'Dokumenty',
    body: 'Treść',
    threadId: '',
    attachments: [{
      filename: 'raport.pdf',
      mimeType: 'application/pdf',
      data: Buffer.from('plik'),
    }],
  }
  const first = gmailSendRequestHash(input)
  assert.match(first, /^[0-9a-f]{64}$/u)
  assert.equal(first, gmailSendRequestHash({
    ...input,
    to: ['anna@example.com'],
  }))
  assert.notEqual(first, gmailSendRequestHash({
    ...input,
    body: 'Zmieniona treść',
  }))
  assert.equal(
    gmailSendMessageId('58f147b8-62c1-4c0b-81a8-e0d2bafed903'),
    '<58f147b8-62c1-4c0b-81a8-e0d2bafed903@mail.openexpert.app>',
  )
})

test('recognizes executable and script attachments blocked by Gmail', () => {
  assert.equal(gmailBlockedAttachmentExtension('decyzja.pdf.exe'), 'exe')
  assert.equal(gmailBlockedAttachmentExtension('skrypt.JS'), 'js')
  assert.equal(gmailBlockedAttachmentExtension('raport.pdf'), null)
})
