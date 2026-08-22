import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { fetchGmailAttachmentBytesCore } from '../server/utils/mail-gmail-attachment.ts'
import {
  gmailMessageDetail,
  gmailMessageSecurity,
  gmailSearchQueryWithoutDrafts,
  gmailThreadDetail,
  gmailThreadSummary,
  parseMailAddresses,
  type GmailMessageResource,
  type GmailThreadResource,
} from '../server/utils/gmail-message.ts'
import { mailAgentMessageMatchesParticipants } from '../server/utils/mail-agent-thread-core.ts'
import { mailMessageIsDraft } from '../server/utils/mail-message-draft-state.ts'
import { mailContextMatchedEmails } from '../server/utils/mail-context-core.ts'

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function mockFetch(
  t: TestContext,
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
): void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    )
    return handler(url, init)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = original
  })
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

test('downloads Gmail attachment bytes through the attachment endpoint with a hard limit', async (t) => {
  const expected = Uint8Array.from([0, 1, 2, 255])
  mockFetch(t, (url, init) => {
    assert.equal(
      url.pathname,
      '/gmail/v1/users/me/messages/message-attachment/attachments/provider-attachment',
    )
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer access-token')
    return new Response(JSON.stringify({
      size: expected.byteLength,
      data: Buffer.from(expected).toString('base64url'),
    }))
  })

  const result = await fetchGmailAttachmentBytesCore('access-token', {
    messageId: 'message-attachment',
    attachmentId: 'provider-attachment',
    attachmentIndex: 0,
    maxBytes: expected.byteLength,
  })
  assert.deepEqual(result, expected)
})

test('falls back to the indexed inline Gmail body.data and rejects bytes over the caller limit', async (t) => {
  const inline = Uint8Array.from([80, 68, 70, 0, 255])
  mockFetch(t, (url) => {
    assert.equal(url.searchParams.get('format'), 'full')
    assert.equal(url.searchParams.get('fields'), 'payload')
    return new Response(JSON.stringify({
      payload: {
        mimeType: 'multipart/mixed',
        parts: [{
          filename: 'first.txt',
          mimeType: 'text/plain',
          body: { data: base64url('first') },
        }, {
          filename: 'decision.pdf',
          mimeType: 'application/pdf',
          body: {
            size: inline.byteLength,
            data: Buffer.from(inline).toString('base64url'),
          },
        }],
      },
    }))
  })

  const result = await fetchGmailAttachmentBytesCore('access-token', {
    messageId: 'message-inline',
    attachmentIndex: 1,
    maxBytes: inline.byteLength,
  })
  assert.deepEqual(result, inline)

  await assert.rejects(
    fetchGmailAttachmentBytesCore('access-token', {
      messageId: 'message-inline',
      attachmentIndex: 1,
      maxBytes: inline.byteLength - 1,
    }),
    (error: any) => error?.statusCode === 413,
  )
})

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

test('agent Gmail summaries drop draft-only threads and summarize mixed threads from correspondence', () => {
  const sent = message('message-sent', {
    internalDate: '1774515600000',
    labelIds: ['SENT'],
    snippet: 'Wysłana treść',
  })
  const draft = message('message-draft', {
    internalDate: '1774519200000',
    labelIds: ['DRAFT'],
    snippet: 'Poufna treść szkicu',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'konrad@example.com' },
        { name: 'To', value: 'draft-recipient@example.com' },
        { name: 'Subject', value: 'Poufny szkic' },
      ],
      body: { data: base64url('Poufna treść szkicu') },
    },
  })

  const draftOnly = gmailThreadSummary({ id: 'draft-only', messages: [draft] }, 'konrad@example.com', {
    excludeDrafts: true,
  })
  assert.equal(draftOnly.id, '')

  const mixed = gmailThreadSummary({
    id: 'mixed-thread',
    snippet: 'Poufna treść szkicu',
    messages: [sent, draft],
  }, 'konrad@example.com', { excludeDrafts: true })
  assert.equal(mixed.id, 'mixed-thread')
  assert.equal(mixed.latestMessageId, 'message-sent')
  assert.equal(mixed.messageCount, 1)
  assert.equal(mixed.subject, 'Dokumenty do sprawy')
  assert.equal(mixed.snippet, 'Wysłana treść')
  assert.equal(mixed.draft, false)
  assert.doesNotMatch(JSON.stringify(mixed), /Poufny szkic|draft-recipient|Poufna treść szkicu/u)
})

test('agent Gmail search excludes drafts per message and keeps BCC out of summaries', () => {
  assert.equal(gmailSearchQueryWithoutDrafts(undefined), '-is:draft')
  assert.equal(
    gmailSearchQueryWithoutDrafts('{client@example.com} has:attachment'),
    '({client@example.com} has:attachment) -is:draft',
  )
  const summary = gmailThreadSummary({
    id: 'blind-copy-thread',
    messages: [message('blind-copy-message', {
      labelIds: ['SENT'],
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'konrad@example.com' },
          { name: 'To', value: 'visible@example.com' },
          { name: 'Bcc', value: 'secret-client@example.com' },
        ],
      },
    })],
  }, 'konrad@example.com', { excludeDrafts: true })
  assert.deepEqual(summary.participants.map(value => value.email), ['visible@example.com'])
  assert.deepEqual(mailContextMatchedEmails(summary, ['secret-client@example.com']), [
    'secret-client@example.com',
  ])
  assert.doesNotMatch(JSON.stringify(summary), /secret-client@example\.com/u)
})

test('prefers plain text and returns attachment metadata', () => {
  const parsed = gmailMessageDetail(message('message-2', {
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Jan Kowalski" <JAN@EXAMPLE.COM>' },
        { name: 'To', value: 'Konrad <konrad@example.com>, biuro@example.com' },
        { name: 'Cc', value: 'Doradca <doradca@example.com>' },
        { name: 'Bcc', value: 'Klient <client@example.com>' },
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
  assert.equal(
    mailAgentMessageMatchesParticipants(parsed, ['client@example.com'], 'jan@example.com'),
    true,
  )
  assert.doesNotMatch(JSON.stringify(parsed), /client@example\.com/u)
  assert.deepEqual(parsed.attachments, [{
    id: 'attachment-2',
    filename: 'oferta.pdf',
    mimeType: 'application/pdf',
    size: 2048,
  }])
})

test('marks a Gmail draft internally without adding a public DTO field', () => {
  const parsed = gmailMessageDetail(message('message-draft-detail', {
    labelIds: ['DRAFT'],
  }))
  assert.equal(mailMessageIsDraft({ ...parsed }), true)
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(parsed)), 'draft'), false)
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
  const parsed = gmailMessageDetail(message('message-with-attached-mail', {
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
          mimeType: 'text/html',
          body: {
            data: base64url(`<article>${'Treść załączonej wiadomości. '.repeat(20)}</article>`),
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
  }))

  assert.equal(parsed.bodyText, 'Właściwa treść tekstowa.')
  assert.match(parsed.bodyHtml || '', /Właściwa treść HTML/u)
  assert.doesNotMatch(parsed.bodyHtml || '', /załączonej wiadomości|HTML załącznika/iu)
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

test('continues a Gmail thread through stable 12-message windows without gaps', () => {
  const messages = Array.from({ length: 25 }, (_, index) => message(`message-${index + 1}`, {
    internalDate: String(1_700_000_000_000 + index),
  }))
  const first = gmailThreadDetail(
    { id: 'thread-windowed', messages },
    'konrad@example.com',
    'https://mail.google.com/thread-windowed',
    { maxMessages: 12 },
  )
  assert.deepEqual(first.messages.map(value => value.id), messages.slice(13).map(value => value.id))
  assert.equal(first.providerMessageCount, 25)
  assert.equal(first.newerMessageCount, 0)
  assert.equal(first.omittedMessageCount, 13)
  assert.equal(first.nextPageToken, 'message-14')

  const second = gmailThreadDetail(
    { id: 'thread-windowed', messages },
    'konrad@example.com',
    'https://mail.google.com/thread-windowed',
    {
      maxMessages: 12,
      beforeMessageId: first.nextPageToken!,
      newerMessageCount: 12,
      providerMessageCount: 25,
    },
  )
  assert.deepEqual(second.messages.map(value => value.id), messages.slice(1, 13).map(value => value.id))
  assert.equal(second.omittedMessageCount, 1)
  assert.equal(second.nextPageToken, 'message-2')

  const third = gmailThreadDetail(
    { id: 'thread-windowed', messages },
    'konrad@example.com',
    'https://mail.google.com/thread-windowed',
    {
      maxMessages: 12,
      beforeMessageId: second.nextPageToken!,
      newerMessageCount: 24,
      providerMessageCount: 25,
    },
  )
  assert.deepEqual(third.messages.map(value => value.id), ['message-1'])
  assert.equal(third.omittedMessageCount, 0)
  assert.equal(third.nextPageToken, null)
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
