import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createImapSmtpAdapter,
  fetchImapSmtpThread,
  fetchImapSmtpThreadPage,
  findImapSmtpSentMessage,
  IMAP_MAX_BODY_CHARACTERS,
  IMAP_MAX_SOURCE_BYTES,
  ImapSmtpConfigurationError,
  ImapSmtpDeliveryError,
  ImapSmtpMailboxStateError,
  imapClientOptions,
  openImapMessageReference,
  sealImapMessageReference,
  sendImapSmtpMessage,
  smtpTransportOptions,
  verifyImapSmtpConnection,
  type ImapClientLike,
  type ImapSmtpAdapterRuntime,
  type ImapSmtpConnectionConfig,
  type ImapSmtpRuntimeConfig,
} from '../server/utils/mail-imap-smtp.ts'
import {
  MailHostSecurityError,
  type ResolvedMailEndpoint,
} from '../server/utils/mail-host-security.ts'
import {
  imapSmtpConnectionFailureReason,
  safeImapSmtpError,
} from '../server/utils/mail-imap-errors.ts'
import {
  normalizeMailAccountEmail,
  sameMailAccountEmail,
} from '../server/utils/mail-imap-setup.ts'

const referenceSecret = 'reference-secret-that-is-longer-than-thirty-two-bytes'

const connection: ImapSmtpConnectionConfig = {
  provider: 'imap',
  accountEmail: 'Konrad@example.com',
  displayName: 'Konrad',
  trustedAuthenticationResultsHost: 'mx.example.com',
  imap: {
    host: 'imap.example.com',
    port: 993,
    security: 'tls',
    username: 'Konrad@example.com',
  },
  smtp: {
    host: 'smtp.example.com',
    port: 587,
    security: 'starttls',
    username: 'Konrad@example.com',
  },
}

const secrets = {
  imapPassword: 'imap-app-password',
  smtpPassword: 'smtp-app-password',
}

function resolved(kind: 'imap' | 'smtp'): ResolvedMailEndpoint {
  return {
    host: `${kind}.example.com`,
    port: kind === 'imap' ? 993 : 587,
    security: kind === 'imap' ? 'tls' : 'starttls',
    address: kind === 'imap' ? '8.8.8.8' : '1.1.1.1',
    family: 4,
    addresses: [{ address: kind === 'imap' ? '8.8.8.8' : '1.1.1.1', family: 4 }],
    servername: `${kind}.example.com`,
  }
}

function runtimeConfig(runtime: ImapSmtpAdapterRuntime): ImapSmtpRuntimeConfig {
  return { connection, secrets, referenceSecret, runtime }
}

test('compares reconnect mailbox identity in a normalized form without alias guessing', () => {
  assert.equal(normalizeMailAccountEmail('  Konrad@Example.COM  '), 'konrad@example.com')
  assert.equal(sameMailAccountEmail('Konrad@Example.COM', ' konrad@example.com '), true)
  assert.equal(sameMailAccountEmail('konrad+crm@example.com', 'konrad@example.com'), false)
  assert.equal(sameMailAccountEmail('other@example.com', 'konrad@example.com'), false)
})

test('seals route-safe message references and rejects tampering or the wrong secret', () => {
  const value = sealImapMessageReference({
    mailbox: 'Odebrane/Decyzje',
    uidValidity: '998877665544',
    uid: 42,
    messageId: '<decision-42@bank.example>',
  }, referenceSecret)

  assert.match(value, /^[A-Za-z0-9_-]+$/u)
  assert.doesNotMatch(value, /Odebrane|Decyzje|decision/u)
  assert.deepEqual(openImapMessageReference(value, referenceSecret), {
    mailbox: 'Odebrane/Decyzje',
    uidValidity: '998877665544',
    uid: 42,
    messageId: '<decision-42@bank.example>',
  })

  const last = value.at(-1)!
  const tampered = `${value.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`
  assert.throws(() => openImapMessageReference(tampered, referenceSecret), TypeError)
  assert.throws(
    () => openImapMessageReference(value, `${referenceSecret}-different`),
    TypeError,
  )
})

test('builds pinned TLS options without raw protocol logging or pooling', () => {
  const imap = imapClientOptions(connection.imap, secrets.imapPassword, resolved('imap'))
  assert.deepEqual(imap, {
    host: '8.8.8.8',
    port: 993,
    secure: true,
    servername: 'imap.example.com',
    auth: { user: 'Konrad@example.com', pass: 'imap-app-password' },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      servername: 'imap.example.com',
    },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
    maxLineLength: 256 * 1024,
    maxLiteralSize: IMAP_MAX_SOURCE_BYTES + 64 * 1024,
    disableAutoIdle: true,
    disableCompression: true,
    logger: false,
    emitLogs: false,
    logRaw: false,
  })

  const smtp = smtpTransportOptions(connection.smtp!, secrets.smtpPassword, resolved('smtp'))
  assert.equal(smtp.host, '1.1.1.1')
  assert.equal(smtp.secure, false)
  assert.equal(smtp.requireTLS, true)
  assert.equal(smtp.ignoreTLS, false)
  assert.equal(smtp.pool, false)
  assert.equal(smtp.logger, false)
  assert.equal(smtp.debug, false)
  assert.deepEqual(smtp.tls, {
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
    servername: 'smtp.example.com',
  })
})

test('maps IMAP/SMTP failures to sanitized H3 responses and preserves ambiguous delivery', () => {
  const sensitive = 'imap.secret.example USER=konrad@example.com PASS=top-secret provider-raw'
  const cases: Array<{ error: unknown; operation: 'setup' | 'read' | 'send'; status: number }> = [
    {
      error: new MailHostSecurityError('NON_PUBLIC_ADDRESS', sensitive),
      operation: 'setup',
      status: 400,
    },
    {
      error: Object.assign(new Error(sensitive), { code: 'EAUTH' }),
      operation: 'read',
      status: 409,
    },
    {
      error: Object.assign(new Error(sensitive), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }),
      operation: 'read',
      status: 502,
    },
    {
      error: Object.assign(new Error(sensitive), { code: 'ETIMEDOUT' }),
      operation: 'setup',
      status: 504,
    },
    {
      error: new ImapSmtpConfigurationError(sensitive),
      operation: 'send',
      status: 400,
    },
  ]

  for (const value of cases) {
    const mapped = safeImapSmtpError(value.error, value.operation)
    assert.equal(mapped.statusCode, value.status)
    assert.doesNotMatch(JSON.stringify(mapped.toJSON()), /secret|konrad@example|provider-raw/iu)
  }

  const ambiguous = safeImapSmtpError(
    new ImapSmtpDeliveryError(sensitive, true, { cause: new Error(sensitive) }),
    'send',
  )
  assert.equal(ambiguous.statusCode, 502)
  assert.deepEqual(ambiguous.data, { deliveryAmbiguous: true })
  assert.doesNotMatch(JSON.stringify(ambiguous.toJSON()), /secret|konrad@example|provider-raw/iu)
})

test('only transport, TLS, timeout, authentication and credential failures poison a connection', () => {
  assert.equal(imapSmtpConnectionFailureReason(new TypeError('bad cursor')), null)
  assert.equal(
    imapSmtpConnectionFailureReason(new ImapSmtpConfigurationError('bad request configuration')),
    null,
  )
  assert.equal(imapSmtpConnectionFailureReason(new ImapSmtpMailboxStateError(
    'UIDVALIDITY_CHANGED',
    'UIDVALIDITY changed',
  )), null)
  assert.equal(
    imapSmtpConnectionFailureReason(Object.assign(new Error('raw auth response'), { code: 'EAUTH' })),
    'IMAP_SMTP_AUTHENTICATION_FAILED',
  )
  assert.equal(
    imapSmtpConnectionFailureReason(Object.assign(new Error('socket failed'), { code: 'ECONNREFUSED' })),
    'IMAP_SMTP_TRANSPORT_FAILED',
  )
  const mappedTimeout = safeImapSmtpError(
    Object.assign(new Error('raw provider timeout'), { code: 'CONNECT_TIMEOUT' }),
    'send',
  )
  assert.equal(mappedTimeout.statusCode, 504)
  assert.equal(imapSmtpConnectionFailureReason(mappedTimeout), 'IMAP_SMTP_TIMEOUT')
  assert.deepEqual(Object.keys(mappedTimeout).includes('imapSmtpConnectionFailureReason'), false)
  const mappedAmbiguousTransport = safeImapSmtpError(
    new ImapSmtpDeliveryError('ambiguous', true, {
      cause: Object.assign(new Error('socket closed after DATA'), { code: 'ECONNRESET' }),
    }),
    'send',
  )
  assert.deepEqual(mappedAmbiguousTransport.data, { deliveryAmbiguous: true })
  assert.equal(
    imapSmtpConnectionFailureReason(mappedAmbiguousTransport),
    'IMAP_SMTP_TRANSPORT_FAILED',
  )
})

test('flat connection verification performs short IMAP list and SMTP verify sessions', async () => {
  const resolvedKinds: string[] = []
  const clientOptions: Record<string, unknown>[] = []
  const smtpOptions: Record<string, unknown>[] = []
  let connected = 0
  let loggedOut = 0
  let smtpVerified = 0
  let smtpClosed = 0
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async (kind) => {
      resolvedKinds.push(kind)
      return resolved(kind)
    },
    createImapClient: (options) => {
      clientOptions.push(options)
      return {
        connect: async () => { connected += 1 },
        logout: async () => { loggedOut += 1 },
        close: () => {},
        list: async () => [{ path: 'INBOX', specialUse: '\\Inbox' }],
      } as any
    },
    createSmtpTransport: (options) => {
      smtpOptions.push(options)
      return {
        verify: async () => { smtpVerified += 1 },
        sendMail: async () => ({}),
        close: () => { smtpClosed += 1 },
      }
    },
  }

  const result = await verifyImapSmtpConnection({
    displayName: 'Konrad',
    accountEmail: 'konrad@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'tls',
    imapUsername: 'konrad@example.com',
    imapPassword: 'imap-password',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpUsername: 'konrad@example.com',
    smtpPassword: 'smtp-password',
  }, runtime)

  assert.deepEqual(result, {
    imap: { ok: true, folderCount: 1 },
    smtp: { ok: true },
  })
  assert.deepEqual(resolvedKinds.sort(), ['imap', 'smtp'])
  assert.equal(connected, 1)
  assert.equal(loggedOut, 1)
  assert.equal(smtpVerified, 1)
  assert.equal(smtpClosed, 1)
  assert.equal((clientOptions[0] as any).disableAutoIdle, true)
  assert.deepEqual((clientOptions[0] as any).auth, {
    user: 'konrad@example.com',
    pass: 'imap-password',
  })
  assert.equal((smtpOptions[0] as any).requireTLS, true)
})

test('reuses one validated DNS result while failing over IMAP and SMTP across every public address', async () => {
  const resolutions = new Map<string, number>()
  const imapHosts: string[] = []
  const smtpHosts: string[] = []
  const multiResolved = (kind: 'imap' | 'smtp'): ResolvedMailEndpoint => ({
    ...resolved(kind),
    address: '8.8.8.8',
    family: 4,
    addresses: [
      { address: '8.8.8.8', family: 4 },
      { address: '2001:4860:4860:0000:0000:0000:0000:8888', family: 6 },
    ],
  })
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async (kind) => {
      resolutions.set(kind, (resolutions.get(kind) ?? 0) + 1)
      return multiResolved(kind)
    },
    createImapClient: (options) => {
      const host = String(options.host)
      imapHosts.push(host)
      return {
        connect: async () => {
          if (host === '8.8.8.8') {
            throw Object.assign(new Error('first address unavailable'), { code: 'ECONNREFUSED' })
          }
        },
        logout: async () => {},
        close: () => {},
        list: async () => [{ path: 'INBOX' }],
      } as any
    },
    createSmtpTransport: (options) => {
      const host = String(options.host)
      smtpHosts.push(host)
      return {
        verify: async () => {
          if (host === '8.8.8.8') {
            throw Object.assign(new Error('first address unavailable'), { code: 'ECONNREFUSED' })
          }
        },
        sendMail: async () => ({}),
        close: () => {},
      }
    },
  }

  await verifyImapSmtpConnection({
    displayName: 'Konrad',
    accountEmail: 'konrad@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapSecurity: 'tls',
    imapUsername: 'konrad@example.com',
    imapPassword: 'imap-password',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
    smtpUsername: 'konrad@example.com',
    smtpPassword: 'smtp-password',
  }, runtime)

  assert.deepEqual(Object.fromEntries(resolutions), { imap: 1, smtp: 1 })
  assert.deepEqual(imapHosts, [
    '8.8.8.8',
    '2001:4860:4860:0000:0000:0000:0000:8888',
  ])
  assert.deepEqual(smtpHosts, imapHosts)
})

test('SMTP failover retries only errors known to occur before message data was accepted', async () => {
  const messageId = '<address-failover@mail.openexpert.app>'
  const raw = Buffer.from(`Message-ID: ${messageId}\r\nTo: anna@example.com\r\n\r\nTreść`)
  let smtpResolutions = 0
  const smtpHosts: string[] = []
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async (kind) => {
      if (kind === 'smtp') smtpResolutions += 1
      return {
        ...resolved(kind),
        address: '8.8.8.8',
        addresses: [
          { address: '8.8.8.8', family: 4 },
          { address: '1.1.1.1', family: 4 },
        ],
      }
    },
    compileMime: async () => ({
      message: raw,
      messageId,
      envelope: { from: 'Konrad@example.com', to: ['anna@example.com'] },
    }),
    createSmtpTransport: (options) => {
      const host = String(options.host)
      smtpHosts.push(host)
      return {
        verify: async () => {},
        sendMail: async () => {
          if (host === '8.8.8.8') {
            throw Object.assign(new Error('connect rejected'), { code: 'ECONNREFUSED' })
          }
          return { accepted: ['anna@example.com'], rejected: [] }
        },
        close: () => {},
      }
    },
    createImapClient: () => ({
      connect: async () => {},
      logout: async () => {},
      close: () => {},
      list: async () => [],
    }) as any,
  }

  const result = await sendImapSmtpMessage(runtimeConfig(runtime), {
    idempotencyKey: 'address-failover',
    messageId,
    to: 'anna@example.com',
    subject: 'Test',
    text: 'Treść',
  })
  assert.equal(result.partial, false)
  assert.equal(smtpResolutions, 1)
  assert.deepEqual(smtpHosts, ['8.8.8.8', '1.1.1.1'])

  smtpHosts.length = 0
  const ambiguousRuntime: ImapSmtpAdapterRuntime = {
    ...runtime,
    createSmtpTransport: (options) => {
      smtpHosts.push(String(options.host))
      return {
        verify: async () => {},
        sendMail: async () => {
          // Nodemailer uses command=CONN for generic socket callbacks even if
          // the socket closes after DATA; it must therefore remain ambiguous.
          throw Object.assign(new Error('socket closed'), {
            code: 'ESOCKET',
            command: 'CONN',
          })
        },
        close: () => {},
      }
    },
  }
  await assert.rejects(
    sendImapSmtpMessage(runtimeConfig(ambiguousRuntime), {
      idempotencyKey: 'address-failover-ambiguous',
      messageId,
      to: 'anna@example.com',
      subject: 'Test',
      text: 'Treść',
    }),
    (error: unknown) => (
      error instanceof ImapSmtpDeliveryError
      && error.deliveryAmbiguous
    ),
  )
  assert.deepEqual(smtpHosts, ['8.8.8.8'])
})

test('lists by UID and binds every opaque reference to mailbox UIDVALIDITY', async () => {
  let released = 0
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    createImapClient: () => {
      const client: any = {
        mailbox: false,
        connect: async () => {},
        logout: async () => {},
        close: () => {},
        list: async () => [],
        getMailboxLock: async () => {
          client.mailbox = { exists: 2, uidValidity: 1234n, uidNext: 103 }
          return { release: () => { released += 1 } }
        },
        fetch: async function* () {
          yield {
            uid: 102,
            envelope: {
              from: [{ name: 'Bank', address: 'decyzje@bank.example' }],
              to: [{ address: 'Konrad@example.com' }],
              subject: 'Decyzja kredytowa',
              messageId: '<decision-102@bank.example>',
              date: new Date('2026-08-14T08:00:00.000Z'),
            },
            flags: new Set(['\\Seen']),
          }
          yield {
            uid: 101,
            envelope: {
              from: [{ address: 'doradca@example.net' }],
              subject: 'Dokumenty',
              messageId: '<docs-101@example.net>',
            },
            flags: new Set(),
          }
        },
      }
      return client as unknown as ImapClientLike
    },
  }

  const adapter = createImapSmtpAdapter(connection, secrets, referenceSecret, runtime)
  const page = await adapter.listMessages({ mailbox: 'INBOX', pageSize: 2 })
  assert.equal(page.data.length, 2)
  assert.equal(page.data[0]?.subject, 'Decyzja kredytowa')
  assert.equal(page.data[0]?.unread, false)
  assert.equal(page.data[1]?.unread, true)
  assert.equal(released, 1)
  assert.deepEqual(openImapMessageReference(page.data[0]!.id, referenceSecret), {
    mailbox: 'INBOX',
    uidValidity: '1234',
    uid: 102,
    messageId: '<decision-102@bank.example>',
  })
})

test('returns provider-neutral folders and a connection-bound opaque STARRED cursor', async () => {
  const searches: unknown[] = []
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    createImapClient: () => {
      const client: any = {
        mailbox: false,
        connect: async () => {},
        logout: async () => {},
        close: () => {},
        list: async () => [{
          path: 'INBOX',
          name: 'Odebrane',
          specialUse: '\\Inbox',
          status: { messages: 30, unseen: 4 },
        }, {
          path: 'Sent',
          name: 'Wysłane',
          specialUse: '\\Sent',
          status: { messages: 12, unseen: 0 },
        }, {
          path: 'Drafts',
          name: 'Szkice',
          specialUse: '\\Drafts',
          status: { messages: 2, unseen: 2 },
        }],
        getMailboxLock: async (mailbox: string) => {
          assert.equal(mailbox, 'INBOX')
          client.mailbox = { exists: 3, uidValidity: 999n, uidNext: 4 }
          return { release: () => {} }
        },
        search: async (query: unknown) => {
          searches.push(query)
          return [1, 2, 3]
        },
        fetch: async function* (uids: number[]) {
          for (const uid of uids) {
            yield {
              uid,
              envelope: {
                from: [{ address: `bank-${uid}@example.com` }],
                subject: `Wiadomość ${uid}`,
                messageId: `<message-${uid}@example.com>`,
              },
              flags: new Set(['\\Flagged']),
            }
          }
        },
      }
      return client as ImapClientLike
    },
  }
  const config = runtimeConfig(runtime)

  const first = await fetchImapSmtpThreadPage(config, {
    folder: 'STARRED',
    maxResults: 1,
  })
  assert.deepEqual(first.folders, [{
    id: 'INBOX',
    label: 'Odebrane',
    messagesTotal: 30,
    messagesUnread: 4,
  }, {
    id: 'STARRED',
    label: 'Oznaczone',
    messagesTotal: null,
    messagesUnread: null,
  }, {
    id: 'SENT',
    label: 'Wysłane',
    messagesTotal: 12,
    messagesUnread: 0,
  }, {
    id: 'DRAFT',
    label: 'Szkice',
    messagesTotal: 2,
    messagesUnread: 2,
  }])
  assert.equal(first.partialFailureCount, 1)
  assert.equal(first.data[0]?.subject, 'Wiadomość 3')
  assert.ok(first.nextPageToken)
  assert.match(first.nextPageToken, /^[A-Za-z0-9_-]+$/u)
  assert.doesNotMatch(first.nextPageToken, /INBOX|STARRED/u)
  assert.deepEqual(searches[0], { flagged: true, uid: '1:*' })

  const second = await fetchImapSmtpThreadPage(config, {
    folder: 'STARRED',
    pageToken: first.nextPageToken,
    maxResults: 1,
  })
  assert.equal(second.data[0]?.subject, 'Wiadomość 2')
  assert.ok(second.nextPageToken)

  const token = first.nextPageToken
  const tail = token.at(-1)!
  await assert.rejects(
    fetchImapSmtpThreadPage(config, {
      folder: 'STARRED',
      pageToken: `${token.slice(0, -1)}${tail === 'A' ? 'B' : 'A'}`,
      maxResults: 1,
    }),
    /Kursor strony IMAP/u,
  )
})

test('uses IMAP address fields with OR for contextual participant search', async () => {
  const searches: unknown[] = []
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    createImapClient: () => {
      const client: any = {
        mailbox: false,
        connect: async () => {},
        logout: async () => {},
        close: () => {},
        list: async () => [{
          path: 'INBOX',
          name: 'Odebrane',
          specialUse: '\\Inbox',
          status: { messages: 0, unseen: 0 },
        }],
        getMailboxLock: async () => {
          client.mailbox = { exists: 0, uidValidity: 1n, uidNext: 1 }
          return { release: () => {} }
        },
        search: async (query: unknown) => {
          searches.push(query)
          return []
        },
        fetch: async function* () {},
      }
      return client as ImapClientLike
    },
  }

  await fetchImapSmtpThreadPage(runtimeConfig(runtime), {
    folder: 'INBOX',
    participantEmails: ['client@example.com', 'partner@example.com'],
  })

  assert.deepEqual(searches, [{
    or: [
      { from: 'client@example.com' },
      { to: 'client@example.com' },
      { cc: 'client@example.com' },
      { bcc: 'client@example.com' },
      { from: 'partner@example.com' },
      { to: 'partner@example.com' },
      { cc: 'partner@example.com' },
      { bcc: 'partner@example.com' },
    ],
    uid: '1:*',
  }])
})

test('recognizes conservative Polish and English folder names only when SPECIAL-USE is absent', async () => {
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    createImapClient: () => ({
      connect: async () => {},
      logout: async () => {},
      close: () => {},
      list: async () => [{
        path: 'INBOX',
        name: 'Odebrane',
      }, {
        path: 'Sent Items',
      }, {
        path: 'Elementy robocze',
      }, {
        path: 'Kosz',
      }, {
        path: 'Junk Email',
      }, {
        path: 'Projects/Sent',
        name: 'Sent',
        specialUse: '\\Important',
      }],
    }) as any,
  }

  const folders = await createImapSmtpAdapter(
    connection,
    secrets,
    referenceSecret,
    runtime,
  ).listFolderSummaries()
  assert.equal(folders.find(folder => folder.path === 'Sent Items')?.role, 'sent')
  assert.equal(folders.find(folder => folder.path === 'Elementy robocze')?.role, 'drafts')
  assert.equal(folders.find(folder => folder.path === 'Kosz')?.role, 'trash')
  assert.equal(folders.find(folder => folder.path === 'Junk Email')?.role, 'spam')
  assert.equal(folders.find(folder => folder.path === 'Projects/Sent')?.role, 'other')
})

test('an explicit Sent mailbox takes priority over SPECIAL-USE and name fallbacks', async () => {
  const messageId = '<explicit-sent-folder@mail.openexpert.app>'
  const raw = Buffer.from(`Message-ID: ${messageId}\r\nTo: anna@example.com\r\n\r\nTreść`)
  let appendedMailbox = ''
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    compileMime: async () => ({
      message: raw,
      messageId,
      envelope: { from: 'Konrad@example.com', to: ['anna@example.com'] },
    }),
    createSmtpTransport: () => ({
      verify: async () => {},
      sendMail: async () => ({ accepted: ['anna@example.com'], rejected: [] }),
      close: () => {},
    }),
    createImapClient: () => ({
      connect: async () => {},
      logout: async () => {},
      close: () => {},
      list: async () => [{ path: 'Sent Items', specialUse: '\\Sent' }],
      append: async (mailbox: string) => {
        appendedMailbox = mailbox
        return false
      },
    }) as any,
  }
  await createImapSmtpAdapter(
    { ...connection, sentMailbox: 'Archiwum/Wysłane OpenExpert' },
    secrets,
    referenceSecret,
    runtime,
  ).sendMessage({
    idempotencyKey: 'explicit-sent-folder',
    messageId,
    to: 'anna@example.com',
    subject: 'Test',
    text: 'Treść',
  })
  assert.equal(appendedMailbox, 'Archiwum/Wysłane OpenExpert')
})

test('hard-caps MIME source and plaintext while returning inert message detail', async () => {
  const raw = Buffer.alloc(IMAP_MAX_SOURCE_BYTES + 1, 0x61)
  let parserBytes = 0
  let released = 0
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    createImapClient: () => {
      const client: any = {
        mailbox: false,
        connect: async () => {},
        logout: async () => {},
        close: () => {},
        list: async () => [],
        getMailboxLock: async () => {
          client.mailbox = { uidValidity: 77n }
          return { release: () => { released += 1 } }
        },
        fetchOne: async () => ({
          uid: 7,
          source: raw,
          size: raw.length + 100,
          envelope: {
            subject: 'Treść decyzji',
            messageId: '<message-7@bank.example>',
          },
          flags: new Set(),
          bodyStructure: {
            type: 'multipart/mixed',
            childNodes: [{
              part: '2',
              type: 'application/pdf',
              disposition: 'attachment',
              dispositionParameters: { filename: 'decyzja.pdf' },
              size: 1234,
            }],
          },
        }),
      }
      return client as unknown as ImapClientLike
    },
    parseMime: async (source) => {
      parserBytes = source.byteLength
      return {
        text: `Bezpieczny tekst\n${'x'.repeat(IMAP_MAX_BODY_CHARACTERS + 100)}`,
        html: '<div style="display:none">Preheader&nbsp;&zwnj;</div><h1>Bezpieczny HTML</h1><img src="https://cdn.example.com/oferta.png" alt="Oferta"><script>alert(1)</script>',
        from: { name: 'Bank', address: 'decyzje@bank.example' },
        headers: [{
          key: 'authentication-results',
          value: 'attacker.example; spf=fail; dmarc=fail',
        }, {
          key: 'authentication-results',
          value: 'mx.example.com; spf=pass; dmarc=pass',
        }],
      }
    },
  }
  const reference = sealImapMessageReference({
    mailbox: 'INBOX',
    uidValidity: '77',
    uid: 7,
    messageId: '<message-7@bank.example>',
  }, referenceSecret)

  const detail = await fetchImapSmtpThread(runtimeConfig(runtime), reference)
  assert.equal(parserBytes, IMAP_MAX_SOURCE_BYTES)
  assert.equal(detail.externalUrl, null)
  assert.equal(detail.messages.length, 1)
  assert.equal(detail.messages[0]?.bodyText.length, IMAP_MAX_BODY_CHARACTERS)
  assert.equal(detail.messages[0]?.bodyTruncated, true)
  assert.match(detail.messages[0]?.bodyHtml || '', /<h1>Bezpieczny HTML<\/h1>/u)
  assert.doesNotMatch(detail.messages[0]?.bodyHtml || '', /script|alert|\ssrc="https:/iu)
  assert.match(detail.messages[0]?.bodyHtml || '', /data-mail-remote-src="https:\/\/cdn\.example\.com\/oferta\.png"/u)
  assert.equal(detail.messages[0]?.hasRemoteImages, true)
  assert.equal(detail.messages[0]?.bodyHtmlTruncated, true)
  assert.equal(detail.messages[0]?.security.authentication, 'pass')
  assert.equal(detail.messages[0]?.attachments[0]?.filename, 'decyzja.pdf')
  assert.equal(released, 1)
})

test('uses the persisted Message-ID, keeps Bcc envelope-only, and appends the same MIME to Sent', async () => {
  const messageId = '<58f147b8-62c1-4c0b-81a8-e0d2bafed903@mail.openexpert.app>'
  const raw = Buffer.from([
    `Message-ID: ${messageId}`,
    'To: anna@example.com',
    'Subject: Decyzja',
    '',
    'Treść',
  ].join('\r\n'))
  let compileInput: Record<string, unknown> | null = null
  let smtpInput: Record<string, unknown> | null = null
  let appended: Buffer | null = null
  const runtime: ImapSmtpAdapterRuntime = {
    now: () => new Date('2026-08-14T10:00:00.000Z'),
    resolveEndpoint: async kind => resolved(kind),
    compileMime: async (input) => {
      compileInput = input
      return {
        message: raw,
        messageId,
        envelope: {
          from: 'Konrad@example.com',
          to: ['anna@example.com', 'blind@example.com'],
        },
      }
    },
    createSmtpTransport: () => ({
      verify: async () => {},
      sendMail: async (input) => {
        smtpInput = input
        return {
          messageId,
          accepted: ['anna@example.com'],
          rejected: ['blind@example.com'],
        }
      },
      close: () => {},
    }),
    createImapClient: () => ({
      connect: async () => {},
      logout: async () => {},
      close: () => {},
      list: async () => [{ path: 'Sent', specialUse: '\\Sent' }],
      append: async (_path: string, source: Buffer) => {
        appended = source
        return { uid: 55, uidValidity: 66n }
      },
    }) as any,
  }

  const result = await sendImapSmtpMessage(runtimeConfig(runtime), {
    idempotencyKey: '58f147b8-62c1-4c0b-81a8-e0d2bafed903',
    messageId,
    to: 'anna@example.com',
    bcc: 'blind@example.com',
    subject: 'Decyzja',
    text: 'Treść',
  })

  assert.equal((compileInput as any).messageId, messageId)
  assert.equal('bcc' in (compileInput ?? {}), false)
  assert.deepEqual((compileInput as any).envelope.to, [
    'anna@example.com',
    'blind@example.com',
  ])
  assert.deepEqual((smtpInput as any).raw, raw)
  assert.equal(raw.toString('utf8').includes('Bcc:'), false)
  assert.deepEqual(appended, raw)
  assert.match(result.id, /^[A-Za-z0-9_-]+$/u)
  assert.equal(result.threadId, result.id)
  assert.deepEqual(openImapMessageReference(result.id, referenceSecret), {
    mailbox: 'Sent',
    uidValidity: '66',
    uid: 55,
    messageId,
  })
  assert.equal(result.messageId, messageId)
  assert.deepEqual(result.accepted, ['anna@example.com'])
  assert.deepEqual(result.rejected, ['blind@example.com'])
  assert.equal(result.partial, true)
  assert.equal(result.sentCopySaved, true)
})

test('uses a stable opaque fallback when APPEND cannot return a message UID', async () => {
  const messageId = '<fallback-reference@mail.openexpert.app>'
  const raw = Buffer.from(`Message-ID: ${messageId}\r\nTo: anna@example.com\r\n\r\nTreść`)
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    compileMime: async () => ({
      message: raw,
      messageId,
      envelope: { from: 'Konrad@example.com', to: ['anna@example.com'] },
    }),
    createSmtpTransport: () => ({
      verify: async () => {},
      sendMail: async () => ({ accepted: ['anna@example.com'], rejected: [] }),
      close: () => {},
    }),
    createImapClient: () => ({
      connect: async () => {},
      logout: async () => {},
      close: () => {},
      list: async () => [],
    }) as any,
  }
  const adapter = createImapSmtpAdapter(connection, secrets, referenceSecret, runtime)
  const input = {
    idempotencyKey: 'fallback-reference',
    messageId,
    to: 'anna@example.com',
    subject: 'Test',
    text: 'Treść',
  }

  const first = await adapter.sendMessage(input)
  const second = await adapter.sendMessage(input)
  assert.match(first.id, /^imap_[A-Za-z0-9_-]{43}$/u)
  assert.equal(first.id, second.id)
  assert.equal(first.threadId, first.id)
  assert.equal(first.sentCopySaved, false)
  assert.equal(first.partial, false)
})

test('marks SMTP delivery partial when a requested recipient is not accounted for', async () => {
  const messageId = '<unaccounted-recipient@mail.openexpert.app>'
  const raw = Buffer.from(`Message-ID: ${messageId}\r\nTo: anna@example.com\r\n\r\nTreść`)
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    compileMime: async () => ({
      message: raw,
      messageId,
      envelope: {
        from: 'Konrad@example.com',
        to: ['anna@example.com', 'blind@example.com'],
      },
    }),
    createSmtpTransport: () => ({
      verify: async () => {},
      sendMail: async () => ({ accepted: ['anna@example.com'], rejected: [] }),
      close: () => {},
    }),
    createImapClient: () => ({
      connect: async () => {},
      logout: async () => {},
      close: () => {},
      list: async () => [],
    }) as any,
  }

  const result = await createImapSmtpAdapter(
    connection,
    secrets,
    referenceSecret,
    runtime,
  ).sendMessage({
    idempotencyKey: 'unaccounted-recipient',
    messageId,
    to: ['anna@example.com', 'blind@example.com'],
    subject: 'Test',
    text: 'Treść',
  })

  assert.deepEqual(result.accepted, ['anna@example.com'])
  assert.deepEqual(result.rejected, [])
  assert.equal(result.partial, true)
})

test('Nodemailer compiler emits the exact persisted Message-ID without a Bcc header', async () => {
  const messageId = '<nodemailer-compile@mail.openexpert.app>'
  let smtpMessage: Record<string, unknown> | null = null
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    createSmtpTransport: () => ({
      verify: async () => {},
      sendMail: async (message) => {
        smtpMessage = message
        return { accepted: ['anna@example.com', 'blind@example.com'], rejected: [] }
      },
      close: () => {},
    }),
    createImapClient: () => ({
      connect: async () => {},
      logout: async () => {},
      close: () => {},
      list: async () => [],
    }) as any,
  }
  const result = await createImapSmtpAdapter(
    connection,
    secrets,
    referenceSecret,
    runtime,
  ).sendMessage({
    idempotencyKey: 'nodemailer-compile',
    messageId,
    to: 'anna@example.com',
    bcc: 'blind@example.com',
    subject: 'Zażółć — decyzja',
    text: 'Dzień dobry,\n\nTreść.',
  })

  const source = Buffer.from((smtpMessage as any).raw).toString('utf8')
  assert.match(source, /^Message-ID: <nodemailer-compile@mail\.openexpert\.app>\r$/mu)
  assert.doesNotMatch(source, /^(?:Bcc|Resent-Bcc):/imu)
  assert.deepEqual((smtpMessage as any).envelope.to, [
    'anna@example.com',
    'blind@example.com',
  ])
  assert.equal(result.messageId, messageId)
})

test('finds a sent message by exact Message-ID and returns an opaque reference', async () => {
  const messageId = '<sent-123@mail.openexpert.app>'
  let search: unknown
  const runtime: ImapSmtpAdapterRuntime = {
    resolveEndpoint: async kind => resolved(kind),
    createImapClient: () => {
      const client: any = {
        mailbox: false,
        connect: async () => {},
        logout: async () => {},
        close: () => {},
        list: async () => [{ path: 'Wysłane', specialUse: '\\Sent' }],
        getMailboxLock: async () => {
          client.mailbox = { uidValidity: 9001n }
          return { release: () => {} }
        },
        search: async (value: unknown) => {
          search = value
          return [41, 42]
        },
        fetchOne: async () => ({
          uid: 42,
          envelope: { messageId },
        }),
      }
      return client as unknown as ImapClientLike
    },
  }

  const found = await findImapSmtpSentMessage(runtimeConfig(runtime), messageId)
  assert.deepEqual(search, { header: { 'message-id': messageId } })
  assert.ok(found)
  assert.equal(found.messageId, messageId)
  assert.equal(found.id, found.threadId)
  assert.deepEqual(openImapMessageReference(found.id, referenceSecret), {
    mailbox: 'Wysłane',
    uidValidity: '9001',
    uid: 42,
    messageId,
  })
})

test('rejects a caller-supplied Message-ID with hidden header content', async () => {
  const adapter = createImapSmtpAdapter(connection, secrets, referenceSecret, {
    resolveEndpoint: async kind => resolved(kind),
  })
  await assert.rejects(
    adapter.sendMessage({
      idempotencyKey: 'safe-request',
      messageId: '<safe@mail.openexpert.app>\r\nBcc: attacker@example.com',
      to: 'anna@example.com',
      subject: 'Test',
      text: 'Treść',
    }),
    /Message-ID jest nieprawidłowy/u,
  )
})

test('refuses to send or archive a compiled MIME source containing Bcc', async () => {
  const messageId = '<request-with-bcc@mail.openexpert.app>'
  let smtpCreated = false
  const adapter = createImapSmtpAdapter(connection, secrets, referenceSecret, {
    resolveEndpoint: async kind => resolved(kind),
    compileMime: async () => ({
      message: Buffer.from([
        `Message-ID: ${messageId}`,
        'To: anna@example.com',
        'Bcc: blind@example.com',
        '',
        'Treść',
      ].join('\r\n')),
      messageId,
      envelope: {
        from: 'Konrad@example.com',
        to: ['anna@example.com', 'blind@example.com'],
      },
    }),
    createSmtpTransport: () => {
      smtpCreated = true
      throw new Error('must not create SMTP transport')
    },
  })

  await assert.rejects(
    adapter.sendMessage({
      idempotencyKey: 'request-with-bcc',
      messageId,
      to: 'anna@example.com',
      bcc: 'blind@example.com',
      subject: 'Test',
      text: 'Treść',
    }),
    /ujawnia odbiorców Bcc/u,
  )
  assert.equal(smtpCreated, false)
})
