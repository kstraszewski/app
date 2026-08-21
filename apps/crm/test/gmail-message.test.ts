import assert from 'node:assert/strict'
import test from 'node:test'
import {
  gmailMessageDetail,
  gmailMessageAttachmentSources,
  gmailMessageSecurity,
  gmailThreadDetail,
  gmailThreadSummary,
  GmailMimeStructureError,
  MAX_GMAIL_MESSAGE_ATTACHMENTS,
  MAX_GMAIL_MIME_DEPTH,
  MAX_GMAIL_MIME_PARTS,
  parseMailAddresses,
  type GmailMessagePart,
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
    latestMessageId: 'message-1',
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

test('prefers the Gmail attachment resource when a part also contains inline data', () => {
  const sources = gmailMessageAttachmentSources(message('dual-locator', {
    payload: {
      mimeType: 'multipart/mixed',
      parts: [{
        filename: 'document.zip',
        mimeType: 'application/zip',
        body: {
          attachmentId: 'opaque-resource-id',
          data: 'UEsDBA',
          size: 123,
        },
      }],
    },
  }))
  assert.deepEqual(sources, [{
    attachmentId: 'opaque-resource-id',
    inlineData: null,
    filename: 'document.zip',
    mimeType: 'application/zip',
    size: 123,
  }])
})

test('walks Gmail MIME iteratively with strict depth, part and attachment bounds', () => {
  let nested: GmailMessagePart = {
    mimeType: 'text/plain',
    body: { data: base64url('bounded') },
  }
  for (let depth = 0; depth < MAX_GMAIL_MIME_DEPTH; depth += 1) {
    nested = { mimeType: 'multipart/mixed', parts: [nested] }
  }
  assert.equal(gmailMessageDetail(message('bounded-depth', { payload: nested })).bodyText, 'bounded')
  nested = { mimeType: 'multipart/mixed', parts: [nested] }
  assert.throws(
    () => gmailMessageDetail(message('too-deep', { payload: nested })),
    GmailMimeStructureError,
  )

  const tooManyParts: GmailMessagePart = {
    mimeType: 'multipart/mixed',
    parts: Array.from({ length: MAX_GMAIL_MIME_PARTS }, () => ({ mimeType: 'text/plain' })),
  }
  assert.throws(
    () => gmailMessageDetail(message('too-many-parts', { payload: tooManyParts })),
    GmailMimeStructureError,
  )

  const attachments: GmailMessagePart = {
    mimeType: 'multipart/mixed',
    parts: Array.from({ length: MAX_GMAIL_MESSAGE_ATTACHMENTS + 1 }, (_, index) => ({
      mimeType: 'application/octet-stream',
      filename: `attachment-${index}.zip`,
      body: { attachmentId: `attachment-${index}`, size: 1 },
    })),
  }
  assert.throws(
    () => gmailMessageAttachmentSources(message('too-many-attachments', { payload: attachments })),
    GmailMimeStructureError,
  )
})

test('keeps the plain alternative and returns the fullest sanitized HTML body', () => {
  const parsed = gmailMessageDetail(message('message-rich-html', {
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'offers@example.com' },
        { name: 'Subject', value: 'Oferta' },
      ],
      parts: [{
        mimeType: 'text/plain',
        body: { data: base64url('Czytelna wersja tekstowa.') },
      }, {
        mimeType: 'text/html',
        body: { data: base64url('<p>Skrócona wersja HTML</p>') },
      }, {
        mimeType: 'text/html',
        body: {
          data: base64url(`
            <div style="display: none; max-height: 0; overflow: hidden">
              Ukryty preheader&nbsp;&zwnj;&zwnj;
            </div>
            <main>
              <h1>Pełna wersja HTML</h1>
              <p>Treść promocyjna z bezpiecznym formatowaniem.</p>
              <img src="https://cdn.example.com/offer.png" alt="Oferta">
            </main>
            <script>window.location = 'https://attacker.example'</script>
          `),
        },
      }],
    },
  }))

  assert.equal(parsed.bodyText, 'Czytelna wersja tekstowa.')
  assert.ok(parsed.bodyHtml)
  assert.match(parsed.bodyHtml, /Pełna wersja HTML/u)
  assert.doesNotMatch(parsed.bodyHtml, /Skrócona wersja HTML/u)
  assert.doesNotMatch(parsed.bodyHtml, /<script|window\.location|attacker\.example/iu)
  assert.match(parsed.bodyHtml, /display\s*:\s*none/iu)
  assert.doesNotMatch(parsed.bodyHtml, /&amp;zwnj;/iu)
  assert.equal(parsed.hasRemoteImages, true)
  assert.equal(parsed.bodyHtmlTruncated, false)
})

test('ignores attached MIME subtrees when selecting the message body', () => {
  const raw = message('message-with-attached-mail', {
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'offers@example.com' },
        { name: 'Subject', value: 'Właściwa wiadomość' },
      ],
      parts: [{
        mimeType: 'multipart/alternative',
        parts: [{
          mimeType: 'text/plain',
          body: { data: base64url('Właściwa treść tekstowa.') },
        }, {
          mimeType: 'text/html',
          body: { data: base64url('<main><h1>Właściwa treść HTML</h1></main>') },
        }],
      }, {
        mimeType: 'message/rfc822',
        parts: [{
          mimeType: 'application/zip',
          filename: 'nested-untrusted.zip',
          body: {
            attachmentId: 'nested-untrusted-id',
            size: 123,
          },
        }],
      }, {
        mimeType: 'multipart/alternative',
        headers: [{
          name: 'Content-Disposition',
          value: 'attachment; filename="forwarded.eml"',
        }],
        parts: [{
          mimeType: 'text/plain',
          body: { data: base64url('Tekst załącznika, nie treść wiadomości.') },
        }, {
          mimeType: 'text/html',
          body: {
            data: base64url(`<section>${'Dłuższy HTML załącznika. '.repeat(20)}</section>`),
          },
        }],
      }],
    },
  })
  const parsed = gmailMessageDetail(raw)

  assert.equal(parsed.bodyText, 'Właściwa treść tekstowa.')
  assert.match(parsed.bodyHtml || '', /Właściwa treść HTML/u)
  assert.doesNotMatch(parsed.bodyHtml || '', /załączonej wiadomości|HTML załącznika/iu)
  assert.deepEqual(gmailMessageAttachmentSources(raw), [])
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

test('surfaces Gmail authentication failures and Reply-To domain mismatches', () => {
  const suspicious = message('message-security', {
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Bank <decyzje@bank.example>' },
        { name: 'Reply-To', value: 'Odpowiedź <kontakt@lookalike.example>' },
        {
          name: 'Authentication-Results',
          value: 'mx.google.com; spf=fail; dkim=fail; dmarc=fail',
        },
      ],
      body: { data: base64url('Zweryfikuj tę wiadomość.') },
    },
  })

  assert.deepEqual(gmailMessageSecurity(suspicious), {
    authentication: 'fail',
    dkimAligned: false,
    dmarcAligned: false,
    replyToMismatch: true,
  })
  assert.deepEqual(gmailMessageSecurity(message('message-auth-pass', {
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'OpenExpert Bank <dokumenty@openexpert.app>' },
        {
          name: 'Authentication-Results',
          value: 'mx.google.com; dkim=pass header.i=@openexpert.app; dmarc=pass',
        },
      ],
    },
  })), {
    authentication: 'pass',
    dkimAligned: true,
    dmarcAligned: true,
    replyToMismatch: false,
  })
})

test('ignores forged Authentication-Results that are not stamped by Gmail', () => {
  const forged = message('message-forged-auth', {
    payload: {
      mimeType: 'text/plain',
      headers: [{
        name: 'Authentication-Results',
        value: 'attacker.example; spf=pass; dkim=pass; dmarc=pass',
      }, {
        name: 'Authentication-Results',
        value: 'evil.mx.google.com; spf=pass; dkim=pass; dmarc=pass',
      }],
    },
  })

  assert.deepEqual(gmailMessageSecurity(forged), {
    authentication: 'unknown',
    dkimAligned: false,
    dmarcAligned: false,
    replyToMismatch: false,
  })

  const forgedPassBeforeTrustedFailure = message('message-trusted-auth-failure', {
    payload: {
      mimeType: 'text/plain',
      headers: [{
        name: 'Authentication-Results',
        value: 'attacker.example; spf=pass; dkim=pass; dmarc=pass',
      }, {
        name: 'Authentication-Results',
        value: 'mx.google.com; spf=fail; dkim=fail; dmarc=fail',
      }],
    },
  })
  assert.equal(gmailMessageSecurity(forgedPassBeforeTrustedFailure).authentication, 'fail')
})

test('requires an authoritative DKIM pass aligned exactly to the From domain', () => {
  const security = (from: string, authenticationResults: string) => gmailMessageSecurity(
    message('message-dkim-alignment', {
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: from },
          { name: 'Authentication-Results', value: authenticationResults },
        ],
      },
    }),
  )

  assert.deepEqual(
    security(
      'OpenExpert Bank <dokumenty@openexpert.app>',
      'mx.google.com; spf=pass smtp.mailfrom=send.openexpert.app',
    ),
    {
      authentication: 'pass',
      dkimAligned: false,
      dmarcAligned: false,
      replyToMismatch: false,
    },
  )
  assert.equal(
    security(
      'OpenExpert Bank <dokumenty@openexpert.app>',
      'mx.google.com; dkim=pass header.i=@resend.dev',
    ).dkimAligned,
    false,
  )
  assert.equal(
    security(
      'OpenExpert Bank <dokumenty@openexpert.app>',
      'mx.google.com; dkim=pass header.s=resend',
    ).dkimAligned,
    false,
  )
  assert.equal(
    security(
      'Spoofed Bank <dokumenty@lookalike.example>',
      'mx.google.com; dkim=pass header.i=@openexpert.app',
    ).dkimAligned,
    false,
  )
  assert.equal(
    security(
      'OpenExpert Bank <dokumenty@openexpert.app>',
      'mx.google.com; dkim=pass header.d=openexpert.app',
    ).dkimAligned,
    true,
  )
  assert.deepEqual(
    security(
      'OpenExpert Bank <dokumenty@openexpert.app>',
      'mx.google.com; dkim=pass header.i=@openexpert.app header.s=resend; dkim=pass header.i=@amazonses.com header.s=224i4yxa5dv7c2xz3womw6peuasteono; spf=pass smtp.mailfrom=send.openexpert.app',
    ),
    {
      authentication: 'pass',
      dkimAligned: true,
      dmarcAligned: false,
      replyToMismatch: false,
    },
  )
  assert.deepEqual(
    security(
      'OpenExpert Bank <dokumenty@openexpert.app>',
      'mx.google.com; spf=pass; dkim=pass header.i=@openexpert.app; dmarc=fail header.from=openexpert.app',
    ),
    {
      // Aggregate authentication remains a DMARC failure. The controlled
      // database policy consumes the separate aligned-DKIM signal instead.
      authentication: 'fail',
      dkimAligned: true,
      dmarcAligned: false,
      replyToMismatch: false,
    },
  )
  assert.equal(
    security(
      'OpenExpert Bank <dokumenty@openexpert.app>',
      'attacker.example; dkim=pass header.i=@openexpert.app',
    ).dkimAligned,
    false,
  )
})

test('removes bidirectional override controls from displayed mail metadata', () => {
  const parsed = gmailMessageDetail(message('message-controls', {
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: 'Bank\u202Eexe.pdf <bank@example.com>' },
        { name: 'Subject', value: 'Decyzja\u202Eexe.pdf' },
      ],
      parts: [{
        filename: 'decyzja\u202Eexe.pdf',
        mimeType: 'application/pdf',
        body: { attachmentId: 'attachment-controls', size: 100 },
      }],
    },
  }))

  assert.equal(parsed.subject, 'Decyzjaexe.pdf')
  assert.equal(parsed.from?.label, 'Bankexe.pdf')
  assert.equal(parsed.attachments[0]?.filename, 'decyzjaexe.pdf')
})

test('decodes RFC 2047 encoded subjects and sender names', () => {
  const parsed = gmailMessageDetail(message('message-encoded-headers', {
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: '=?UTF-8?Q?Pawe=C5=82_Nowak?= <pawel@example.com>' },
        { name: 'Subject', value: '=?UTF-8?B?RGVjeXpqYSBrcmVkeXRvd2Eg4oCUIFBLSw==?=' },
      ],
      body: { data: base64url('Treść') },
    },
  }))

  assert.equal(parsed.from?.label, 'Paweł Nowak')
  assert.equal(parsed.subject, 'Decyzja kredytowa — PKK')
})

test('keeps the newest HTML messages within the total thread HTML budget', () => {
  const largeHtml = (label: string) => (
    `<div><strong>${label}</strong>${'A'.repeat(389_800)}</div>`
  )
  const messages = [
    { id: 'message-html-oldest', label: 'Najstarsza', offset: 0 },
    { id: 'message-html-middle', label: 'Środkowa', offset: 1 },
    { id: 'message-html-newest', label: 'Najnowsza', offset: 2 },
  ].map(({ id, label, offset }) => message(id, {
    internalDate: String(1774515600000 + offset * 1000),
    payload: {
      mimeType: 'text/html',
      headers: [
        { name: 'From', value: 'Bank <bank@example.com>' },
        { name: 'Subject', value: 'Budżet HTML wątku' },
      ],
      body: { data: base64url(largeHtml(label)) },
    },
  }))

  const detail = gmailThreadDetail(
    { id: 'thread-html-budget', messages },
    'konrad@example.com',
    'https://mail.google.com/thread-html-budget',
  )

  assert.deepEqual(detail.messages.map(item => item.id), [
    'message-html-oldest',
    'message-html-middle',
    'message-html-newest',
  ])
  assert.equal(detail.messages[0]?.bodyHtml, null)
  assert.equal(detail.messages[0]?.bodyHtmlTruncated, true)
  assert.match(detail.messages[1]?.bodyHtml || '', /Środkowa/u)
  assert.equal(detail.messages[1]?.bodyHtmlTruncated, false)
  assert.match(detail.messages[2]?.bodyHtml || '', /Najnowsza/u)
  assert.equal(detail.messages[2]?.bodyHtmlTruncated, false)
  assert.ok(
    detail.messages.reduce((sum, item) => sum + (item.bodyHtml?.length || 0), 0)
      <= 1_000_000,
  )
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
