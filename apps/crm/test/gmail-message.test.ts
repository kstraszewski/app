import assert from 'node:assert/strict'
import test from 'node:test'
import {
  gmailMessageDetail,
  gmailThreadDetail,
  gmailThreadSummary,
  parseMailAddresses,
  type GmailMessageResource,
  type GmailThreadResource,
} from '../server/utils/gmail-message.ts'

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function message(
  id: string,
  overrides: Partial<GmailMessageResource> = {},
): GmailMessageResource {
  return {
    id,
    internalDate: '1774515600000',
    labelIds: ['INBOX'],
    snippet: 'Krótki podgląd',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Anna Nowak <anna@example.com>' },
        { name: 'To', value: 'Konrad <konrad@example.com>' },
        { name: 'Subject', value: 'Dokumenty do sprawy' },
      ],
      body: {
        data: base64url('Dzień dobry,\n\nprzesyłam dokumenty.'),
      },
    },
    ...overrides,
  }
}

test('summarizes a Gmail thread without exposing provider-specific payloads', () => {
  const thread: GmailThreadResource = {
    id: 'thread-1',
    messages: [
      message('message-1', {
        labelIds: ['INBOX', 'UNREAD', 'STARRED'],
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: 'Anna Nowak <anna@example.com>' },
            { name: 'To', value: 'konrad@example.com' },
            { name: 'Subject', value: 'Dokumenty do sprawy' },
          ],
          parts: [{
            mimeType: 'text/plain',
            body: { data: base64url('Treść') },
          }, {
            mimeType: 'application/pdf',
            filename: 'dokument.pdf',
            body: { attachmentId: 'attachment-1', size: 1234 },
          }],
        },
      }),
    ],
  }

  assert.deepEqual(gmailThreadSummary(thread, 'konrad@example.com'), {
    id: 'thread-1',
    messageCount: 1,
    participants: [{
      name: 'Anna Nowak',
      email: 'anna@example.com',
      label: 'Anna Nowak',
    }],
    participantsLabel: 'Anna Nowak',
    subject: 'Dokumenty do sprawy',
    snippet: 'Krótki podgląd',
    latestAt: '2026-03-26T09:00:00.000Z',
    unread: true,
    starred: true,
    important: false,
    draft: false,
    hasAttachments: true,
  })
})

test('prefers plain text and returns attachment metadata', () => {
  const parsed = gmailMessageDetail(message('message-2', {
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Jan Kowalski" <JAN@EXAMPLE.COM>' },
        { name: 'To', value: 'Konrad <konrad@example.com>, biuro@example.com' },
        { name: 'Cc', value: 'Doradca <doradca@example.com>' },
        { name: 'Subject', value: 'Załącznik' },
      ],
      parts: [{
        mimeType: 'multipart/alternative',
        parts: [{
          mimeType: 'text/plain',
          body: { data: base64url('Zażółć gęślą jaźń.\n\nBezpieczny tekst.') },
        }, {
          mimeType: 'text/html',
          body: { data: base64url('<p>Nie używaj tej wersji</p>') },
        }],
      }, {
        mimeType: 'application/pdf',
        filename: 'oferta.pdf',
        body: { attachmentId: 'attachment-2', size: 2048 },
      }],
    },
  }))

  assert.equal(parsed.bodyText, 'Zażółć gęślą jaźń.\n\nBezpieczny tekst.')
  assert.equal(parsed.from?.email, 'jan@example.com')
  assert.deepEqual(parsed.to.map(address => address.email), [
    'konrad@example.com',
    'biuro@example.com',
  ])
  assert.equal(parsed.cc[0]?.label, 'Doradca')
  assert.deepEqual(parsed.attachments, [{
    id: 'attachment-2',
    filename: 'oferta.pdf',
    mimeType: 'application/pdf',
    size: 2048,
  }])
})

test('turns HTML fallback into inert readable text', () => {
  const parsed = gmailMessageDetail(message('message-3', {
    payload: {
      mimeType: 'text/html',
      headers: [
        { name: 'From', value: 'alerts@example.com' },
        { name: 'Subject', value: 'Alert' },
      ],
      body: {
        data: base64url(`
          <style>.hidden { display: none }</style>
          <script>window.location = 'https://example.com'</script>
          <h1>Ważne &amp; pilne</h1>
          <p>Kliknij <a href="https://example.com">tutaj</a>.</p>
          <ul><li>Punkt pierwszy</li><li>Punkt drugi</li></ul>
        `),
      },
    },
  }))

  assert.match(parsed.bodyText, /Ważne & pilne/u)
  assert.match(parsed.bodyText, /Kliknij tutaj/u)
  assert.match(parsed.bodyText, /• Punkt pierwszy/u)
  assert.doesNotMatch(parsed.bodyText, /script|window\.location|<h1|href=/u)
})

test('caps long threads and keeps the most recent messages in chronological order', () => {
  const messages = Array.from({ length: 22 }, (_, index) => message(`message-${index}`, {
    internalDate: String(1774515600000 + index * 1000),
  })).reverse()
  const detail = gmailThreadDetail(
    { id: 'thread-long', messages },
    'konrad@example.com',
    'https://mail.google.com/thread-long',
  )

  assert.equal(detail.omittedMessageCount, 2)
  assert.equal(detail.messages.length, 20)
  assert.equal(detail.messages[0]?.id, 'message-2')
  assert.equal(detail.messages.at(-1)?.id, 'message-21')
  assert.equal(detail.externalUrl, 'https://mail.google.com/thread-long')
})

test('parses quoted names and comma-separated recipients', () => {
  assert.deepEqual(
    parseMailAddresses('"Kowalski, Jan" <jan@example.com>, biuro@example.org'),
    [{
      name: 'Kowalski, Jan',
      email: 'jan@example.com',
      label: 'Kowalski, Jan',
    }, {
      name: '',
      email: 'biuro@example.org',
      label: 'biuro@example.org',
    }],
  )
})
