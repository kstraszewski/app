import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { type TestContext } from 'node:test'
import {
  MICROSOFT_MAIL_CURSOR_MAX_LENGTH,
  MICROSOFT_MAIL_SCOPES,
  MICROSOFT_SIMPLE_ATTACHMENT_LIMIT_BYTES,
  MicrosoftMailError,
  decodeMicrosoftThreadReference,
  encodeMicrosoftThreadReference,
  exchangeMicrosoftMailOAuthCode,
  fetchMicrosoftMailAttachmentBytes,
  fetchMicrosoftMailIdentity,
  fetchMicrosoftMailMessageDetail,
  fetchMicrosoftMailReplyContext,
  fetchMicrosoftMailThread,
  fetchMicrosoftMailThreadPage,
  findMicrosoftSentMessage,
  microsoftMailAuthorizationUrl,
  microsoftMailProviderAvailability,
  microsoftMailTokenIncludesRequiredAccess,
  microsoftMessageSecurity,
  openMicrosoftMailCursor,
  refreshMicrosoftMailOAuthToken,
  sealMicrosoftMailCursor,
  sendMicrosoftMailMessage,
} from '../server/utils/mail-microsoft.ts'
import {
  mailContextMatchedEmails,
  mailContextSearchQuery,
} from '../server/utils/mail-context-core.ts'
import { mailAgentMessageMatchesParticipants } from '../server/utils/mail-agent-thread-core.ts'
import { mailMessageIsDraft } from '../server/utils/mail-message-draft-state.ts'

const CONFIG = {
  clientId: 'personal-sandbox-client-id',
  clientSecret: 'sandbox-client-secret',
  redirectUri: 'https://demo.openexpert.test/api/mail/oauth/microsoft/callback',
}
const REFERENCE_SECRET = 'per-connection-reference-secret-for-tests'

interface FetchCall {
  url: string
  init: RequestInit
}

function mockGlobalFetch(
  t: TestContext,
  handler: (call: FetchCall, index: number) => Response | Promise<Response>,
): FetchCall[] {
  const original = globalThis.fetch
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const call = {
      url: typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
      init,
    }
    calls.push(call)
    return handler(call, calls.length - 1)
  }) as typeof fetch
  t.after(() => {
    globalThis.fetch = original
  })
  return calls
}

function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function noContent(status = 204): Response {
  return new Response(null, { status })
}

function requestHeaders(call: FetchCall): Headers {
  return new Headers(call.init.headers)
}

function message(
  id: string,
  conversationId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    conversationId,
    subject: 'Decyzja kredytowa',
    from: { emailAddress: { name: 'Bank', address: 'decyzje@bank.example' } },
    toRecipients: [{ emailAddress: { address: 'expert@example.com' } }],
    receivedDateTime: '2026-08-14T08:00:00.000Z',
    bodyPreview: 'Bank wydał decyzję.',
    isRead: false,
    isDraft: false,
    hasAttachments: false,
    importance: 'normal',
    flag: { flagStatus: 'notFlagged' },
    ...overrides,
  }
}

test('builds a /common PKCE authorization URL with the complete delegated scope set', () => {
  assert.equal(microsoftMailProviderAvailability(CONFIG), true)
  assert.equal(microsoftMailProviderAvailability({ clientId: 'x' }), false)

  const result = new URL(microsoftMailAuthorizationUrl(CONFIG, {
    state: 'state-123',
    codeChallenge: 'A'.repeat(43),
    loginHint: 'owner@example.com',
  }))

  assert.equal(result.origin, 'https://login.microsoftonline.com')
  assert.equal(result.pathname, '/common/oauth2/v2.0/authorize')
  assert.equal(result.searchParams.get('response_type'), 'code')
  assert.equal(result.searchParams.get('response_mode'), 'query')
  assert.equal(result.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(result.searchParams.get('code_challenge'), 'A'.repeat(43))
  assert.equal(result.searchParams.get('login_hint'), 'owner@example.com')
  assert.deepEqual(
    result.searchParams.get('scope')?.split(' '),
    [...MICROSOFT_MAIL_SCOPES],
  )
  assert.equal(microsoftMailTokenIncludesRequiredAccess([
    'https://graph.microsoft.com/User.Read',
    'Mail.ReadWrite',
    'Mail.Send',
  ]), true)
})

test('exchanges an auth code and rotates refresh tokens without requiring redirectUri on refresh', async (t) => {
  const calls = mockGlobalFetch(t, (call, index) => {
    assert.equal(call.url, 'https://login.microsoftonline.com/common/oauth2/v2.0/token')
    const body = call.init.body as URLSearchParams
    if (index === 0) {
      assert.equal(body.get('grant_type'), 'authorization_code')
      assert.equal(body.get('code'), 'oauth-code')
      assert.equal(body.get('code_verifier'), 'B'.repeat(64))
      assert.equal(body.get('redirect_uri'), CONFIG.redirectUri)
      return jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        scope: MICROSOFT_MAIL_SCOPES.join(' '),
      })
    }
    assert.equal(body.get('grant_type'), 'refresh_token')
    assert.equal(body.get('refresh_token'), 'refresh-1')
    assert.equal(body.has('redirect_uri'), false)
    return jsonResponse({
      access_token: 'access-2',
      refresh_token: 'refresh-2',
      expires_in: 1800,
      scope: MICROSOFT_MAIL_SCOPES.join(' '),
    })
  })
  const now = Date.parse('2026-08-14T09:00:00.000Z')
  const exchanged = await exchangeMicrosoftMailOAuthCode(
    CONFIG,
    { code: 'oauth-code', codeVerifier: 'B'.repeat(64) },
    { now: () => now },
  )
  assert.equal(exchanged.refreshToken, 'refresh-1')
  assert.equal(exchanged.expiresAt, '2026-08-14T09:59:00.000Z')

  const refreshed = await refreshMicrosoftMailOAuthToken(
    { clientId: CONFIG.clientId, clientSecret: CONFIG.clientSecret },
    exchanged.refreshToken!,
    { now: () => now },
  )
  assert.equal(refreshed.accessToken, 'access-2')
  assert.equal(refreshed.refreshToken, 'refresh-2')
  assert.equal(calls.length, 2)
})

test('keeps the previous refresh token when Microsoft omits a rotated value', async (t) => {
  mockGlobalFetch(t, () => jsonResponse({
    access_token: 'new-access',
    expires_in: 3600,
  }))
  const token = await refreshMicrosoftMailOAuthToken(
    { clientId: CONFIG.clientId, clientSecret: CONFIG.clientSecret },
    'previous-refresh',
  )
  assert.equal(token.refreshToken, 'previous-refresh')
  assert.equal(microsoftMailTokenIncludesRequiredAccess(token.scopes), true)
})

test('maps invalid_grant to an explicit reconnect requirement', async (t) => {
  mockGlobalFetch(t, () => jsonResponse({ error: 'invalid_grant' }, 400))
  await assert.rejects(
    refreshMicrosoftMailOAuthToken(CONFIG, 'expired-refresh'),
    (error: unknown) => (
      error instanceof MicrosoftMailError
      && error.statusCode === 409
      && error.code === 'OAUTH_RECONNECT_REQUIRED'
    ),
  )
})

test('loads identity and supports personal accounts whose mail property is empty', async (t) => {
  const calls = mockGlobalFetch(t, () => jsonResponse({
    id: 'personal-account-id',
    displayName: 'Konrad',
    mail: null,
    userPrincipalName: 'Konrad@Outlook.com',
  }))
  assert.deepEqual(await fetchMicrosoftMailIdentity('access-token'), {
    accountId: 'personal-account-id',
    email: 'konrad@outlook.com',
    displayName: 'Konrad',
  })
  assert.match(calls[0]!.url, /\/v1\.0\/me\?/u)
  assert.equal(requestHeaders(calls[0]!).get('authorization'), 'Bearer access-token')
})

test('downloads bounded Microsoft fileAttachment contentBytes through dependencies.fetch', async () => {
  const expected = Uint8Array.from([0, 1, 2, 254, 255])
  let call: FetchCall | null = null
  const fetchImpl = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    call = {
      url: typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
      init,
    }
    return jsonResponse({
      '@odata.type': '#microsoft.graph.fileAttachment',
      size: expected.byteLength,
      contentBytes: Buffer.from(expected).toString('base64'),
    })
  }) as typeof fetch

  const result = await fetchMicrosoftMailAttachmentBytes('access-token', {
    messageId: 'message-provider-id',
    attachmentId: 'attachment-provider-id',
    maxBytes: expected.byteLength,
  }, { fetch: fetchImpl })

  assert.deepEqual(result, expected)
  assert.ok(call)
  const url = new URL(call.url)
  assert.equal(
    url.pathname,
    '/v1.0/me/messages/message-provider-id/attachments/attachment-provider-id',
  )
  assert.match(url.searchParams.get('$select') || '', /contentBytes/u)
  assert.equal(requestHeaders(call).get('authorization'), 'Bearer access-token')
  assert.equal(requestHeaders(call).get('prefer'), 'IdType="ImmutableId"')
})

test('rejects oversized and non-file Microsoft attachment responses', async () => {
  await assert.rejects(
    fetchMicrosoftMailAttachmentBytes('access-token', {
      messageId: 'message-provider-id',
      attachmentId: 'attachment-provider-id',
      maxBytes: 4,
    }, {
      fetch: async () => jsonResponse({
        '@odata.type': '#microsoft.graph.fileAttachment',
        size: 5,
        contentBytes: Buffer.alloc(5).toString('base64'),
      }),
    }),
    (error: unknown) => (
      error instanceof MicrosoftMailError
      && error.statusCode === 413
      && error.code === 'ATTACHMENT_TOO_LARGE'
    ),
  )

  await assert.rejects(
    fetchMicrosoftMailAttachmentBytes('access-token', {
      messageId: 'message-provider-id',
      attachmentId: 'attachment-provider-id',
      maxBytes: 4,
    }, {
      fetch: async () => jsonResponse({
        '@odata.type': '#microsoft.graph.itemAttachment',
        size: 4,
      }),
    }),
    (error: unknown) => (
      error instanceof MicrosoftMailError
      && error.statusCode === 409
      && error.code === 'ATTACHMENT_TYPE_UNSUPPORTED'
    ),
  )
})

test('signs opaque base64url thread references and rejects tampering or cross-connection use', () => {
  const encoded = encodeMicrosoftThreadReference({
    conversationId: 'AAkALg+case/sensitive=',
    anchorMessageId: 'AAMk-message+/=',
  }, REFERENCE_SECRET)
  assert.match(encoded, /^[A-Za-z0-9_-]+$/u)
  assert.deepEqual(decodeMicrosoftThreadReference(encoded, REFERENCE_SECRET), {
    conversationId: 'AAkALg+case/sensitive=',
    anchorMessageId: 'AAMk-message+/=',
  })
  assert.throws(
    () => decodeMicrosoftThreadReference(
      `${encoded.slice(0, -1)}${encoded.endsWith('A') ? 'B' : 'A'}`,
      REFERENCE_SECRET,
    ),
    (error: unknown) => error instanceof MicrosoftMailError && error.statusCode === 400,
  )
  assert.throws(
    () => decodeMicrosoftThreadReference(encoded, 'another-connection-secret'),
    (error: unknown) => error instanceof MicrosoftMailError && error.statusCode === 400,
  )
})

test('seals Graph nextLink cursors, binds them to the query, and blocks SSRF', () => {
  const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?%24skiptoken=opaque'
  const cursor = sealMicrosoftMailCursor(nextLink, 'INBOX\0query-a', REFERENCE_SECRET)
  assert.equal(
    openMicrosoftMailCursor(cursor, 'INBOX\0query-a', REFERENCE_SECRET),
    nextLink,
  )
  assert.throws(
    () => openMicrosoftMailCursor(cursor, 'INBOX\0query-b', REFERENCE_SECRET),
    (error: unknown) => error instanceof MicrosoftMailError && error.code === 'CURSOR_INVALID',
  )
  assert.throws(
    () => sealMicrosoftMailCursor(
      'https://attacker.example/v1.0/me/messages?%24skiptoken=stolen',
      'INBOX',
      REFERENCE_SECRET,
    ),
    (error: unknown) => error instanceof MicrosoftMailError && error.code === 'GRAPH_URL_INVALID',
  )

  const longNextLink = `https://graph.microsoft.com/v1.0/me/messages?%24skiptoken=${'x'.repeat(2_800)}`
  const longCursor = sealMicrosoftMailCursor(longNextLink, 'INBOX', REFERENCE_SECRET)
  assert.ok(longCursor.length <= MICROSOFT_MAIL_CURSOR_MAX_LENGTH)
  assert.equal(openMicrosoftMailCursor(longCursor, 'INBOX', REFERENCE_SECRET), longNextLink)
  assert.throws(
    () => sealMicrosoftMailCursor(
      `https://graph.microsoft.com/v1.0/me/messages?%24skiptoken=${'x'.repeat(4_000)}`,
      'INBOX',
      REFERENCE_SECRET,
    ),
    (error: unknown) => error instanceof MicrosoftMailError && error.code === 'CURSOR_TOO_LARGE',
  )
})

test('lists folders, groups a page by conversationId, and returns a sealed next cursor', async (t) => {
  const nextLink = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?%24skiptoken=next-page'
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname.endsWith('/mailFolders/inbox')) {
      return jsonResponse({ totalItemCount: 7, unreadItemCount: 2 })
    }
    if (url.pathname.endsWith('/mailFolders/sentitems')) {
      return jsonResponse({ totalItemCount: 4, unreadItemCount: 0 })
    }
    if (url.pathname.endsWith('/mailFolders/drafts')) {
      return jsonResponse({ totalItemCount: 1, unreadItemCount: 0 })
    }
    assert.equal(url.pathname, '/v1.0/me/mailFolders/inbox/messages')
    assert.equal(url.searchParams.get('$top'), '20')
    assert.equal(url.searchParams.get('$orderby'), 'receivedDateTime desc')
    return jsonResponse({
      value: [
        message('message-1', 'conversation-1'),
        message('message-2', 'conversation-1', {
          receivedDateTime: '2026-08-14T09:00:00.000Z',
          bodyPreview: 'Nowsza odpowiedź',
          isRead: true,
          flag: { flagStatus: 'flagged' },
          hasAttachments: true,
        }),
        message('message-3', 'conversation-2', {
          receivedDateTime: '2026-08-13T09:00:00.000Z',
          from: { emailAddress: { address: 'other@example.org' } },
        }),
      ],
      '@odata.nextLink': nextLink,
      '@odata.count': 12,
    })
  })

  const page = await fetchMicrosoftMailThreadPage(
    'access-token',
    'expert@example.com',
    { folder: 'INBOX', referenceSecret: REFERENCE_SECRET },
  )
  assert.equal(page.data.length, 2)
  assert.equal(page.data[0]?.messageCount, 2)
  assert.equal(page.data[0]?.latestMessageId, 'message-2')
  assert.equal(page.data[0]?.starred, true)
  assert.equal(page.data[0]?.hasAttachments, true)
  assert.deepEqual(
    decodeMicrosoftThreadReference(page.data[0]!.id, REFERENCE_SECRET),
    { conversationId: 'conversation-1', anchorMessageId: 'message-2' },
  )
  assert.deepEqual(page.folders.map(folder => [folder.id, folder.messagesTotal]), [
    ['INBOX', 7],
    ['STARRED', null],
    ['SENT', 4],
    ['DRAFT', 1],
  ])
  assert.equal(page.resultSizeEstimate, 12)
  assert.equal(page.providerMessageCountOnPage, 3)
  assert.ok(page.nextPageToken)
  assert.equal(calls.length, 4)
})

test('agent Microsoft pages drop draft-only hits and keep correspondence from mixed conversations', async (t) => {
  mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname === '/v1.0/me/messages') {
      return jsonResponse({ value: [
        message('message-real', 'conversation-mixed', {
          subject: 'Wysłana odpowiedź',
          sentDateTime: '2026-08-14T08:00:00.000Z',
          createdDateTime: '2026-08-14T08:00:00.000Z',
          isDraft: false,
          bccRecipients: [{ emailAddress: { address: 'secret-client@example.com' } }],
        }),
        message('message-draft-mixed', 'conversation-mixed', {
          subject: 'Poufny szkic',
          createdDateTime: '2026-08-14T09:00:00.000Z',
          isDraft: true,
        }),
        message('message-draft-only', 'conversation-draft-only', {
          subject: 'Wyłącznie szkic',
          createdDateTime: '2026-08-14T10:00:00.000Z',
          isDraft: true,
        }),
      ] })
    }
    return jsonResponse({ totalItemCount: 0, unreadItemCount: 0 })
  })

  const page = await fetchMicrosoftMailThreadPage('token', 'expert@example.com', {
    folder: 'ALL',
    referenceSecret: REFERENCE_SECRET,
    excludeDrafts: true,
  })
  assert.equal(page.providerMessageCountOnPage, 3)
  assert.equal(page.data.length, 1)
  assert.equal(page.data[0]?.latestMessageId, 'message-real')
  assert.equal(page.data[0]?.messageCount, 1)
  assert.equal(page.data[0]?.subject, 'Wysłana odpowiedź')
  assert.equal(page.data[0]?.draft, false)
  assert.deepEqual(mailContextMatchedEmails(page.data[0]!, ['secret-client@example.com']), [
    'secret-client@example.com',
  ])
  assert.doesNotMatch(
    JSON.stringify(page.data),
    /Poufny szkic|Wyłącznie szkic|secret-client@example\.com/u,
  )
})

test('uses the provider-wide Microsoft collection for all mail', async (t) => {
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname === '/v1.0/me/messages') {
      assert.equal(url.searchParams.get('$orderby'), 'createdDateTime desc')
      return jsonResponse({ value: [] })
    }
    return jsonResponse({ totalItemCount: 0, unreadItemCount: 0 })
  })
  await fetchMicrosoftMailThreadPage('token', 'expert@example.com', {
    folder: 'ALL',
    referenceSecret: REFERENCE_SECRET,
  })
  assert.equal(calls.length, 4)
})

test('uses Graph message search syntax and prevents combining it with the flagged filter', async (t) => {
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname.endsWith('/messages')) {
      assert.equal(url.searchParams.get('$search'), '"decyzja \\"pilna\\""')
      assert.equal(url.searchParams.has('$orderby'), false)
      return jsonResponse({ value: [] })
    }
    return jsonResponse({ totalItemCount: 0, unreadItemCount: 0 })
  })
  await fetchMicrosoftMailThreadPage('token', 'expert@example.com', {
    folder: 'INBOX',
    query: 'decyzja "pilna"',
    referenceSecret: REFERENCE_SECRET,
  })
  assert.equal(calls.length, 4)

  await assert.rejects(
    fetchMicrosoftMailThreadPage('token', 'expert@example.com', {
      folder: 'STARRED',
      query: 'decyzja',
      referenceSecret: REFERENCE_SECRET,
    }),
    (error: unknown) => (
      error instanceof MicrosoftMailError
      && error.code === 'SEARCH_WITH_FLAG_UNSUPPORTED'
    ),
  )
})

test('preserves contextual participants KQL inside the Graph search envelope', async (t) => {
  const contextualQuery = mailContextSearchQuery('microsoft', [
    'client@example.com',
    'partner@example.com',
  ])
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname.endsWith('/messages')) {
      assert.equal(
        url.searchParams.get('$search'),
        '"participants:client@example.com OR participants:partner@example.com"',
      )
      return jsonResponse({ value: [] })
    }
    return jsonResponse({ totalItemCount: 0, unreadItemCount: 0 })
  })

  await fetchMicrosoftMailThreadPage('token', 'expert@example.com', {
    folder: 'SENT',
    query: contextualQuery,
    referenceSecret: REFERENCE_SECRET,
  })
  assert.equal(calls.length, 4)
})

test('returns inert plain text, bounded headers, security, attachment metadata, and Outlook webLink', async (t) => {
  const threadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-detail',
    anchorMessageId: 'message-old',
  }, REFERENCE_SECRET)
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname.endsWith('/attachments')) {
      return jsonResponse({ value: [{
        id: 'attachment-1',
        name: 'decyzja.pdf',
        contentType: 'application/pdf',
        size: 2048,
        isInline: false,
      }, {
        id: 'inline-1',
        name: 'logo.png',
        contentType: 'image/png',
        size: 100,
        isInline: true,
      }] })
    }
    assert.equal(url.pathname, '/v1.0/me/messages')
    assert.match(url.searchParams.get('$filter') || '', /conversationId eq 'conversation-detail'/u)
    assert.match(url.searchParams.get('$filter') || '', /^createdDateTime ge /u)
    assert.equal(url.searchParams.get('$orderby'), 'createdDateTime desc')
    assert.equal(url.searchParams.get('$top'), '20')
    assert.equal(url.searchParams.get('$count'), 'true')
    const selectedFields = new Set((url.searchParams.get('$select') || '').split(','))
    assert.equal(selectedFields.has('body'), true)
    assert.equal(selectedFields.has('internetMessageHeaders'), true)
    assert.equal(selectedFields.has('bodyPreview'), false)
    assert.equal(selectedFields.has('flag'), false)
    assert.equal(selectedFields.has('importance'), false)
    return jsonResponse({ value: [
      message('message-old', 'conversation-detail', {
        body: { contentType: 'Text', content: 'Poprzednia wiadomość.' },
        internetMessageId: '<old@bank.example>',
      }),
      message('message-new', 'conversation-detail', {
        receivedDateTime: '2026-08-14T10:00:00.000Z',
        hasAttachments: true,
        body: {
          contentType: 'HTML',
          content: '<script>steal()</script><h1>Decyzja &amp; warunki</h1><p>Kredyt przyznany.</p><img src="https://cdn.bank.example/decyzja.png" alt="Decyzja">',
        },
        replyTo: [{ emailAddress: { address: 'kontakt@lookalike.example' } }],
        internetMessageId: '<decision@bank.example>',
        internetMessageHeaders: [{
          name: 'Authentication-Results',
          value: 'mx.microsoft.com; spf=fail; dkim=fail; dmarc=fail',
        }, {
          name: 'X-Safe',
          value: 'one\r\n two\u202E',
        }],
        webLink: 'https://outlook.office365.com/owa/?ItemID=message-new',
      }),
    ], '@odata.count': 2 })
  })

  const detail = await fetchMicrosoftMailThread(
    'token',
    'expert@example.com',
    threadId,
    { referenceSecret: REFERENCE_SECRET },
  )
  assert.equal(detail.messages.length, 2)
  const latest = detail.messages[1]!
  assert.match(latest.bodyText, /Decyzja & warunki/u)
  assert.match(latest.bodyText, /Kredyt przyznany/u)
  assert.doesNotMatch(latest.bodyText, /script|steal|<h1/u)
  assert.match(latest.bodyHtml || '', /<h1>Decyzja &amp; warunki<\/h1>/u)
  assert.doesNotMatch(latest.bodyHtml || '', /script|steal|\ssrc="https:/iu)
  assert.match(latest.bodyHtml || '', /data-mail-remote-src="https:\/\/cdn\.bank\.example\/decyzja\.png"/u)
  assert.equal(latest.hasRemoteImages, true)
  assert.deepEqual(latest.attachments, [{
    id: 'attachment-1',
    filename: 'decyzja.pdf',
    mimeType: 'application/pdf',
    size: 2048,
  }])
  assert.deepEqual(latest.security, { authentication: 'unknown', replyToMismatch: true })
  assert.equal(latest.internetMessageId, '<decision@bank.example>')
  assert.equal(latest.headers[1]?.value.includes('\u202E'), false)
  assert.equal(latest.webLink, 'https://outlook.office365.com/owa/?ItemID=message-new')
  assert.equal(detail.externalUrl, latest.webLink)
  assert.ok(calls.every(call => requestHeaders(call).get('prefer')?.includes('IdType="ImmutableId"')))
  assert.ok(calls
    .filter(call => new URL(call.url).pathname.endsWith('/messages'))
    .every(call => requestHeaders(call).get('prefer')?.includes('outlook.body-content-type="html"')))
})

test('keeps the newest Microsoft HTML messages within the total thread HTML budget', async (t) => {
  const conversationId = 'conversation-html-budget'
  const threadId = encodeMicrosoftThreadReference({
    conversationId,
    anchorMessageId: 'message-html-newest',
  }, REFERENCE_SECRET)
  const largeHtml = (label: string) => (
    `<div><strong>${label}</strong>${'A'.repeat(389_800)}</div>`
  )
  const graphMessages = [
    { id: 'message-html-newest', label: 'Najnowsza', hour: 10 },
    { id: 'message-html-middle', label: 'Środkowa', hour: 9 },
    { id: 'message-html-oldest', label: 'Najstarsza', hour: 8 },
  ].map(({ id, label, hour }) => {
    const date = new Date(Date.UTC(2026, 7, 14, hour)).toISOString()
    return message(id, conversationId, {
      receivedDateTime: date,
      createdDateTime: date,
      body: { contentType: 'HTML', content: largeHtml(label) },
    })
  })
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    assert.equal(url.pathname, '/v1.0/me/messages')
    assert.match(url.searchParams.get('$filter') || '', /conversation-html-budget/u)
    return jsonResponse({ value: graphMessages, '@odata.count': 3 })
  })

  const detail = await fetchMicrosoftMailThread(
    'token',
    'expert@example.com',
    threadId,
    { referenceSecret: REFERENCE_SECRET },
  )

  assert.equal(calls.length, 1)
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

test('loads exactly the newest 20 conversation bodies and reports the exact omitted count', async (t) => {
  const threadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-long',
    anchorMessageId: 'message-0',
  }, REFERENCE_SECRET)
  const newestWindow = Array.from({ length: 20 }, (_, offset) => {
    const index = 24 - offset
    const date = new Date(Date.UTC(2026, 7, 14, 8, index)).toISOString()
    return message(`message-${index}`, 'conversation-long', {
      receivedDateTime: date,
      createdDateTime: date,
      body: { contentType: 'Text', content: `Treść ${index}` },
    })
  })
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    assert.equal(url.pathname, '/v1.0/me/messages')
    assert.equal(url.searchParams.get('$orderby'), 'createdDateTime desc')
    assert.equal(url.searchParams.get('$top'), '20')
    assert.equal(url.searchParams.get('$count'), 'true')
    return jsonResponse({
      value: newestWindow,
      '@odata.count': 25,
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=20',
    })
  })

  const detail = await fetchMicrosoftMailThread(
    'token',
    'expert@example.com',
    threadId,
    { referenceSecret: REFERENCE_SECRET },
  )

  assert.equal(calls.length, 1)
  assert.equal(detail.messages.length, 20)
  assert.equal(detail.messages[0]?.id, 'message-5')
  assert.equal(detail.messages.at(-1)?.id, 'message-24')
  assert.equal(detail.omittedMessageCount, 5)
})

test('continues Microsoft detail through signed 12-message windows', async (t) => {
  const threadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-windowed',
    anchorMessageId: 'message-24',
  }, REFERENCE_SECRET)
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    const skip = Number(url.searchParams.get('$skip') ?? 0)
    const size = skip === 24 ? 1 : 12
    const newestIndex = 24 - skip
    const value = Array.from({ length: size }, (_, offset) => {
      const index = newestIndex - offset
      const date = new Date(Date.UTC(2026, 7, 14, 8, index)).toISOString()
      return message(`message-${index}`, 'conversation-windowed', {
        receivedDateTime: date,
        createdDateTime: date,
        body: { contentType: 'Text', content: `Treść ${index}` },
      })
    })
    return jsonResponse({
      value,
      '@odata.count': 25,
      ...(skip < 24
        ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/messages?$skip=${skip + 12}` }
        : {}),
    })
  })

  const first = await fetchMicrosoftMailThread(
    'token',
    'expert@example.com',
    threadId,
    { referenceSecret: REFERENCE_SECRET, maxMessages: 12 },
  )
  assert.deepEqual(first.messages.map(value => value.id), Array.from(
    { length: 12 },
    (_, offset) => `message-${13 + offset}`,
  ))
  assert.equal(first.omittedMessageCount, 13)
  assert.ok(first.nextPageToken)

  const second = await fetchMicrosoftMailThread(
    'token',
    'expert@example.com',
    threadId,
    {
      referenceSecret: REFERENCE_SECRET,
      maxMessages: 12,
      cursor: first.nextPageToken!,
      newerMessageCount: 12,
      providerMessageCount: 25,
    },
  )
  assert.deepEqual(second.messages.map(value => value.id), Array.from(
    { length: 12 },
    (_, offset) => `message-${1 + offset}`,
  ))
  assert.equal(second.omittedMessageCount, 1)

  const third = await fetchMicrosoftMailThread(
    'token',
    'expert@example.com',
    threadId,
    {
      referenceSecret: REFERENCE_SECRET,
      maxMessages: 12,
      cursor: second.nextPageToken!,
      newerMessageCount: 24,
      providerMessageCount: 25,
    },
  )
  assert.deepEqual(third.messages.map(value => value.id), ['message-0'])
  assert.equal(third.omittedMessageCount, 0)
  assert.equal(third.nextPageToken, null)
  assert.equal(calls.length, 3)
})

test('rejects pre-draft-state Microsoft detail cursors instead of reading an unmarked older window', async () => {
  const threadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-versioned-window',
    anchorMessageId: 'newest-message',
  }, REFERENCE_SECRET)
  const legacyBinding = `microsoft-mail-thread-window-v1\0${createHash('sha256').update(threadId).digest('hex')}`
  const legacyCursor = sealMicrosoftMailCursor(
    'https://graph.microsoft.com/v1.0/me/messages?%24skiptoken=legacy-detail-page',
    legacyBinding,
    REFERENCE_SECRET,
  )

  await assert.rejects(
    fetchMicrosoftMailThread('token', 'expert@example.com', threadId, {
      referenceSecret: REFERENCE_SECRET,
      cursor: legacyCursor,
      newerMessageCount: 12,
      providerMessageCount: 24,
    }),
    (error: unknown) => error instanceof MicrosoftMailError && error.code === 'CURSOR_INVALID',
  )
})

test('fails closed when Microsoft returns an empty page before the end of a thread', async (t) => {
  const threadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-empty-window',
    anchorMessageId: 'message-24',
  }, REFERENCE_SECRET)
  mockGlobalFetch(t, () => jsonResponse({
    value: [],
    '@odata.count': 25,
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=12',
  }))

  await assert.rejects(
    fetchMicrosoftMailThread(
      'token',
      'expert@example.com',
      threadId,
      { referenceSecret: REFERENCE_SECRET, maxMessages: 12 },
    ),
    (error: unknown) => error instanceof MicrosoftMailError
      && error.code === 'GRAPH_WINDOW_INCOMPLETE',
  )
})

test('loads an exact older Microsoft message for attachment references', async (t) => {
  const threadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-older-attachment',
    anchorMessageId: 'newest-message',
  }, REFERENCE_SECRET)
  mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname.endsWith('/attachments')) {
      return jsonResponse({ value: [{
        id: 'attachment-old',
        name: 'old.pdf',
        contentType: 'application/pdf',
        size: 42,
        isInline: false,
      }] })
    }
    assert.equal(url.pathname, '/v1.0/me/messages/older-message')
    assert.match(url.searchParams.get('$select') || '', /bccRecipients/u)
    assert.match(url.searchParams.get('$select') || '', /isDraft/u)
    return jsonResponse(message('older-message', 'conversation-older-attachment', {
      hasAttachments: true,
      isDraft: true,
      bccRecipients: [{ emailAddress: { name: 'Klient', address: 'client@example.com' } }],
      body: { contentType: 'Text', content: 'Starsza wiadomość z plikiem.' },
    }))
  })

  const detail = await fetchMicrosoftMailMessageDetail(
    'token',
    'older-message',
    threadId,
    { referenceSecret: REFERENCE_SECRET },
  )
  assert.equal(detail.id, 'older-message')
  assert.equal(detail.attachments[0]?.filename, 'old.pdf')
  assert.equal(
    mailAgentMessageMatchesParticipants(detail, ['client@example.com'], 'decyzje@bank.example'),
    true,
  )
  assert.doesNotMatch(JSON.stringify(detail), /client@example\.com/u)
  assert.equal(mailMessageIsDraft({ ...detail }), true)
  assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(detail)), 'draft'), false)
})

test('fails closed for forged Graph Authentication-Results headers', () => {
  const forgedPass = message('message-forged-auth', 'conversation-forged-auth', {
    internetMessageHeaders: [{
      name: 'Authentication-Results',
      value: 'mx.microsoft.com; spf=pass; dkim=pass; dmarc=pass',
    }],
  })
  assert.deepEqual(microsoftMessageSecurity(forgedPass), {
    authentication: 'unknown',
    replyToMismatch: false,
  })

  const forgedFailureWithMismatch = message('message-forged-failure', 'conversation-forged-auth', {
    replyTo: [{ emailAddress: { address: 'attacker@lookalike.example' } }],
    internetMessageHeaders: [{
      name: 'Authentication-Results',
      value: 'spf=fail; dkim=fail; dmarc=fail; compauth=fail',
    }],
  })
  assert.deepEqual(microsoftMessageSecurity(forgedFailureWithMismatch), {
    authentication: 'unknown',
    replyToMismatch: true,
  })
})

test('chooses the latest inbound message as the Graph reply target', async (t) => {
  const threadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-reply',
    anchorMessageId: 'message-inbound',
  }, REFERENCE_SECRET)
  mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    assert.match(url.searchParams.get('$filter') || '', /^createdDateTime ge /u)
    assert.match(url.searchParams.get('$filter') || '', /conversationId eq 'conversation-reply'/u)
    assert.equal(url.searchParams.get('$orderby'), 'createdDateTime desc')
    assert.equal(url.searchParams.get('$top'), '100')
    return jsonResponse({ value: [
      message('message-inbound', 'conversation-reply', {
        from: { emailAddress: { address: 'bank@example.com' } },
        replyTo: [{ emailAddress: { name: 'Bank replies', address: 'reply@bank.example.com' } }],
        receivedDateTime: '2026-08-14T08:00:00.000Z',
        createdDateTime: '2026-08-14T08:00:00.000Z',
      }),
      message('message-outbound', 'conversation-reply', {
        from: { emailAddress: { address: 'expert@example.com' } },
        sentDateTime: '2026-08-14T09:00:00.000Z',
        createdDateTime: '2026-08-14T09:00:00.000Z',
      }),
    ] })
  })

  const context = await fetchMicrosoftMailReplyContext(
    'token',
    'expert@example.com',
    threadId,
    { referenceSecret: REFERENCE_SECRET },
  )
  assert.equal(context.messageId, 'message-inbound')
  assert.deepEqual(context.recipients.map(recipient => recipient.email), ['reply@bank.example.com'])
})

test('sends a new message through draft, attachment, and send while preserving our Message-ID', async (t) => {
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    const method = String(call.init.method || 'GET').toUpperCase()
    if (url.pathname === '/v1.0/me/messages' && method === 'POST') {
      return jsonResponse({ id: 'immutable-draft-id', conversationId: 'conversation-send' }, 201)
    }
    if (url.pathname.endsWith('/attachments') && method === 'POST') {
      return jsonResponse({ id: 'attachment-created' }, 201)
    }
    if (url.pathname.endsWith('/send') && method === 'POST') return noContent(202)
    throw new Error(`Unexpected Microsoft request: ${method} ${url}`)
  })

  const sent = await sendMicrosoftMailMessage('token', {
    to: ['Receiver@Example.com'],
    cc: ['copy@example.com'],
    subject: 'Dokumenty',
    text: 'Treść wiadomości.',
    messageId: '<request-123@mail.openexpert.app>',
    attachments: [{
      filename: 'raport.pdf',
      mimeType: 'application/pdf',
      data: new Uint8Array([0, 1, 2, 255]),
    }],
  }, { referenceSecret: REFERENCE_SECRET })

  assert.equal(sent.id, 'immutable-draft-id')
  assert.deepEqual(decodeMicrosoftThreadReference(sent.threadId, REFERENCE_SECRET), {
    conversationId: 'conversation-send',
    anchorMessageId: 'immutable-draft-id',
  })
  const draftBody = JSON.parse(String(calls[0]!.init.body))
  assert.equal(draftBody.internetMessageId, '<request-123@mail.openexpert.app>')
  assert.deepEqual(draftBody.toRecipients, [{ emailAddress: { address: 'receiver@example.com' } }])
  assert.equal(draftBody.internetMessageHeaders[0].name, 'x-openexpert-idempotency-key')
  const attachmentBody = JSON.parse(String(calls[1]!.init.body))
  assert.equal(attachmentBody.contentBytes, 'AAEC/w==')
  assert.equal(requestHeaders(calls[2]!).get('content-length'), '0')
})

test('awaits onDraftCreated, never sends on callback failure, and preserves the durable draft', async (t) => {
  const operations: string[] = []
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    const method = String(call.init.method || 'GET').toUpperCase()
    if (url.pathname === '/v1.0/me/messages' && method === 'POST') {
      operations.push('create')
      return jsonResponse({ id: 'persist-first-draft', conversationId: 'persist-conversation' }, 201)
    }
    throw new Error(`Message must not be sent after callback failure: ${method} ${url}`)
  })

  await assert.rejects(
    sendMicrosoftMailMessage('token', {
      to: ['receiver@example.com'],
      subject: 'Persist first',
      text: 'Treść',
      messageId: '<persist-first@mail.openexpert.app>',
    }, {
      referenceSecret: REFERENCE_SECRET,
      onDraftCreated: async (draft) => {
        operations.push('callback')
        assert.equal(draft.id, 'persist-first-draft')
        assert.deepEqual(decodeMicrosoftThreadReference(draft.threadId, REFERENCE_SECRET), {
          conversationId: 'persist-conversation',
          anchorMessageId: 'persist-first-draft',
        })
        throw new Error('database unavailable')
      },
    }),
    /database unavailable/u,
  )
  assert.deepEqual(operations, ['create', 'callback'])
  assert.equal(calls.length, 1)
  assert.equal(calls.some(call => new URL(call.url).pathname.endsWith('/send')), false)
})

test('uses createReply then patches the returned draft before sending', async (t) => {
  const sourceThreadId = encodeMicrosoftThreadReference({
    conversationId: 'conversation-reply',
    anchorMessageId: 'original-message',
  }, REFERENCE_SECRET)
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    const method = String(call.init.method || 'GET').toUpperCase()
    if (url.pathname === '/v1.0/me/messages' && method === 'GET') {
      return jsonResponse({ value: [message('original-message', 'conversation-reply', {
        from: { emailAddress: { address: 'bank@example.com' } },
      })] })
    }
    if (url.pathname.endsWith('/messages/original-message/createReply')) {
      return jsonResponse({ id: 'reply-draft', conversationId: 'conversation-reply' }, 201)
    }
    if (url.pathname.endsWith('/messages/reply-draft') && method === 'PATCH') {
      return jsonResponse({ id: 'reply-draft', conversationId: 'conversation-reply' })
    }
    if (url.pathname.endsWith('/messages/reply-draft/send')) return noContent(202)
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  await sendMicrosoftMailMessage('token', {
    to: ['bank@example.com'],
    subject: 'Re: Decyzja',
    text: 'Dziękuję.',
    messageId: '<reply-123@mail.openexpert.app>',
    threadId: sourceThreadId,
  }, { referenceSecret: REFERENCE_SECRET, accountEmail: 'expert@example.com' })
  assert.equal(calls.length, 4)
  const patchBody = JSON.parse(String(calls[2]!.init.body))
  assert.equal(patchBody.internetMessageId, '<reply-123@mail.openexpert.app>')
  assert.equal('internetMessageHeaders' in patchBody, false)
})

test('uses a preauthenticated upload session for attachments at the 3 MB boundary', async (t) => {
  const attachment = new Uint8Array(MICROSOFT_SIMPLE_ATTACHMENT_LIMIT_BYTES)
  attachment[0] = 17
  attachment[attachment.length - 1] = 23
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    const method = String(call.init.method || 'GET').toUpperCase()
    if (url.pathname === '/v1.0/me/messages') {
      return jsonResponse({ id: 'large-draft', conversationId: 'large-conversation' }, 201)
    }
    if (url.pathname.endsWith('/attachments/createUploadSession')) {
      return jsonResponse({ uploadUrl: 'https://outlook.office.com/upload/session-123?token=secret' })
    }
    if (url.hostname === 'outlook.office.com' && method === 'PUT') return jsonResponse({ id: 'large-attachment' }, 201)
    if (url.pathname.endsWith('/send')) return noContent(202)
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  await sendMicrosoftMailMessage('token', {
    to: ['receiver@example.com'],
    subject: 'Duży plik',
    text: 'Plik w załączeniu.',
    messageId: '<large-123@mail.openexpert.app>',
    attachments: [{ filename: 'large.bin', mimeType: 'application/octet-stream', data: attachment }],
  }, { referenceSecret: REFERENCE_SECRET })

  const upload = calls.find(call => new URL(call.url).hostname === 'outlook.office.com')!
  assert.equal(requestHeaders(upload).has('authorization'), false)
  assert.equal(
    requestHeaders(upload).get('content-range'),
    `bytes 0-${attachment.length - 1}/${attachment.length}`,
  )
})

test('finds a sent message by our deterministic Internet Message-ID', async (t) => {
  const calls = mockGlobalFetch(t, () => jsonResponse({ value: [
    message('draft-match', 'conversation-lookup', {
      internetMessageId: '<lookup-123@mail.openexpert.app>',
      isDraft: true,
      from: { emailAddress: { address: 'expert@example.com' } },
    }),
    message('sent-match', 'conversation-lookup', {
      internetMessageId: '<lookup-123@mail.openexpert.app>',
      isDraft: false,
      sentDateTime: '2026-08-14T10:00:00.000Z',
      from: { emailAddress: { address: 'expert@example.com' } },
    }),
  ] }))
  const found = await findMicrosoftSentMessage(
    'token',
    '<lookup-123@mail.openexpert.app>',
    { referenceSecret: REFERENCE_SECRET, accountEmail: 'expert@example.com' },
  )
  assert.equal(found?.id, 'sent-match')
  assert.equal(
    new URL(calls[0]!.url).searchParams.get('$filter'),
    "internetMessageId eq '<lookup-123@mail.openexpert.app>'",
  )
})

test('prefers the persisted immutable provider ID during sent-message recovery', async (t) => {
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    assert.equal(url.pathname, '/v1.0/me/messages/persisted-immutable-id')
    assert.equal(url.searchParams.get('$select'), 'id,conversationId,isDraft')
    return jsonResponse({
      id: 'persisted-immutable-id',
      conversationId: 'persisted-conversation',
      isDraft: false,
    })
  })
  const found = await findMicrosoftSentMessage(
    'token',
    '<provider-first@mail.openexpert.app>',
    {
      referenceSecret: REFERENCE_SECRET,
      providerMessageId: 'persisted-immutable-id',
    },
  )
  assert.equal(found?.id, 'persisted-immutable-id')
  assert.equal(calls.length, 1)
  assert.equal(requestHeaders(calls[0]!).get('prefer'), 'IdType="ImmutableId"')
})

test('does not report a persisted provider draft as sent', async (t) => {
  const calls = mockGlobalFetch(t, () => jsonResponse({
    id: 'still-a-draft',
    conversationId: 'draft-conversation',
    isDraft: true,
  }))
  const found = await findMicrosoftSentMessage(
    'token',
    '<draft@mail.openexpert.app>',
    { referenceSecret: REFERENCE_SECRET, providerMessageId: 'still-a-draft' },
  )
  assert.equal(found, null)
  assert.equal(calls.length, 1)
})

test('retries safe Graph reads after 429 and 5xx using Retry-After', async (t) => {
  const sleeps: number[] = []
  let attempts = 0
  mockGlobalFetch(t, () => {
    attempts += 1
    if (attempts === 1) return jsonResponse({ error: { code: 'TooManyRequests' } }, 429, { 'retry-after': '2' })
    if (attempts === 2) return jsonResponse({ error: { code: 'ServiceUnavailable' } }, 503)
    return jsonResponse({
      id: 'account-id',
      displayName: 'Expert',
      mail: 'expert@example.com',
    })
  })
  const identity = await fetchMicrosoftMailIdentity('token', {
    sleep: async milliseconds => { sleeps.push(milliseconds) },
    random: () => 0,
  })
  assert.equal(identity.email, 'expert@example.com')
  assert.equal(attempts, 3)
  assert.deepEqual(sleeps, [2_000, 2_000])
})

test('does not retry an ambiguous send and leaves the draft for Sent-folder reconciliation', async (t) => {
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    if (url.pathname === '/v1.0/me/messages') {
      return jsonResponse({ id: 'ambiguous-draft', conversationId: 'ambiguous-conversation' }, 201)
    }
    if (url.pathname.endsWith('/send')) throw new Error('socket closed after upload')
    throw new Error(`Unexpected cleanup after ambiguous send: ${url}`)
  })
  await assert.rejects(
    sendMicrosoftMailMessage('token', {
      to: ['receiver@example.com'],
      subject: 'Niepewna wysyłka',
      text: 'Treść',
      messageId: '<ambiguous-123@mail.openexpert.app>',
    }, { referenceSecret: REFERENCE_SECRET }),
    (error: unknown) => (
      error instanceof MicrosoftMailError
      && error.deliveryAmbiguous
      && error.code === 'GRAPH_NETWORK_ERROR'
    ),
  )
  assert.equal(calls.length, 2)
})

test('deletes a draft after a definitive send rejection', async (t) => {
  const calls = mockGlobalFetch(t, (call) => {
    const url = new URL(call.url)
    const method = String(call.init.method || 'GET').toUpperCase()
    if (url.pathname === '/v1.0/me/messages') {
      return jsonResponse({ id: 'rejected-draft', conversationId: 'rejected-conversation' }, 201)
    }
    if (url.pathname.endsWith('/send')) {
      return jsonResponse({ error: { code: 'ErrorInvalidRecipients' } }, 400)
    }
    if (url.pathname.endsWith('/messages/rejected-draft') && method === 'DELETE') return noContent()
    throw new Error(`Unexpected request ${method} ${url}`)
  })
  await assert.rejects(
    sendMicrosoftMailMessage('token', {
      to: ['receiver@example.com'],
      subject: 'Odrzucona',
      text: 'Treść',
      messageId: '<rejected-123@mail.openexpert.app>',
    }, { referenceSecret: REFERENCE_SECRET }),
    (error: unknown) => error instanceof MicrosoftMailError && error.statusCode === 400,
  )
  assert.equal(calls.length, 3)
  assert.equal(calls[2]!.init.method, 'DELETE')
})
