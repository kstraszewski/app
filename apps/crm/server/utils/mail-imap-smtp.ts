import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto'
import type {
  ImapSmtpConnectionInput,
  MailAddress,
  MailAttachment,
  MailFolderId,
  MailFolderSummary,
  MailMessageSecurity,
  MailThreadDetail,
  MailThreadListPayload,
  MailThreadSummary,
} from '../../shared/types/mail.ts'
import { stripUnsafeMailDisplayControls } from '../../shared/utils/mail-security.ts'
import { sanitizeMailHtml } from './mail-html.ts'
import {
  normalizeMailEndpoint,
  normalizeMailHostname,
  resolveSecureMailEndpoint,
  type MailEndpointConfig,
  type MailHostResolverRuntime,
  type NormalizedMailEndpoint,
  type ResolvedMailEndpoint,
} from './mail-host-security.ts'

export const IMAP_PROVIDER_ID = 'imap' as const
export const IMAP_MAX_SOURCE_BYTES = 2 * 1024 * 1024
export const IMAP_MAX_BODY_CHARACTERS = 160_000

const CONNECTION_TIMEOUT_MS = 8_000
const GREETING_TIMEOUT_MS = 8_000
const SOCKET_TIMEOUT_MS = 15_000
const OPERATION_TIMEOUT_MS = 30_000
const LOGOUT_TIMEOUT_MS = 3_000
const MAX_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 20
const MAX_MAILBOX_LENGTH = 1_024
const MAX_SEARCH_LENGTH = 500
const MAX_SEARCH_UID_WINDOW = 50_000
const MAX_SUBJECT_LENGTH = 500
const MAX_BODY_LENGTH = 200_000
const MAX_RECIPIENTS = 50
const MAX_ATTACHMENTS = 10
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 16 * 1024 * 1024
const MAX_OUTGOING_SOURCE_BYTES = 24 * 1024 * 1024
const MAX_IMAP_LINE_BYTES = 256 * 1024
const MAX_IMAP_LITERAL_BYTES = IMAP_MAX_SOURCE_BYTES + 64 * 1024
const REFERENCE_AAD = Buffer.from('openexpert/imap-message-reference/v1', 'utf8')
const PAGE_CURSOR_AAD = Buffer.from('openexpert/imap-page-cursor/v1', 'utf8')

export interface ImapAccountEndpointConfig extends MailEndpointConfig {
  username: string
}

export interface SmtpAccountEndpointConfig extends MailEndpointConfig {
  username: string
}

export interface ImapSmtpConnectionConfig {
  provider: typeof IMAP_PROVIDER_ID
  accountEmail: string
  displayName?: string
  imap: ImapAccountEndpointConfig
  smtp?: SmtpAccountEndpointConfig
  /** Optional explicit Sent folder for servers without SPECIAL-USE metadata. */
  sentMailbox?: string
  /**
   * Optional trusted authserv-id for Authentication-Results. Without an
   * explicit trust anchor, authentication status remains unknown.
   */
  trustedAuthenticationResultsHost?: string
}

export interface ImapSmtpConnectionSecrets {
  /** Prefer a provider-issued app password. Never expose it back to the browser. */
  imapPassword: string
  /** Defaults to imapPassword only when omitted. */
  smtpPassword?: string
}

export type ImapFolderRole =
  | 'inbox'
  | 'sent'
  | 'drafts'
  | 'archive'
  | 'trash'
  | 'spam'
  | 'other'

export interface ImapFolderSummary {
  id: string
  path: string
  name: string
  role: ImapFolderRole
  specialUse: string | null
  messagesTotal: number | null
  messagesUnread: number | null
}

export interface ImapMessagePage {
  data: MailThreadSummary[]
  nextOffset: number | null
  resultSizeEstimate: number
}

export interface ImapPageCursor {
  folder: MailFolderId
  mailbox: string
  offset: number
  pageSize: number
  query: string
  flaggedOnly: boolean
}

export interface ImapMessageReference {
  mailbox: string
  uidValidity: string
  uid: number
  messageId: string | null
}

export interface ImapMessageDetail {
  reference: string
  messageId: string | null
  references: string[]
  inReplyTo: string | null
  from: MailAddress | null
  replyTo: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  subject: string
  sentAt: string | null
  unread: boolean
  bodyText: string
  bodyHtml: string | null
  bodyHtmlTruncated: boolean
  hasRemoteImages: boolean
  bodyTruncated: boolean
  attachments: MailAttachment[]
  security: MailMessageSecurity
}

export interface ImapReplyContext {
  subject: string
  inReplyTo: string
  references: string[]
}

export interface ImapSmtpSendAttachment {
  filename: string
  mimeType: string
  data: Uint8Array
}

export interface ImapSmtpSendInput {
  idempotencyKey: string
  /** Persisted RFC Message-ID used by the shared send/recovery workflow. */
  messageId?: string
  to: string | readonly string[]
  cc?: string | readonly string[]
  bcc?: string | readonly string[]
  subject: string
  text: string
  attachments?: readonly ImapSmtpSendAttachment[]
  inReplyTo?: string
  references?: readonly string[]
}

export interface ImapSmtpSendResult {
  id: string
  threadId: string
  messageId: string
  accepted: string[]
  rejected: string[]
  partial: boolean
  sentCopySaved: boolean
}

export interface ImapSmtpConnectionTestResult {
  imap: { ok: true; folderCount: number }
  smtp: { ok: true } | null
}

export interface ImapSmtpSentMessage {
  id: string
  threadId: string
  messageId: string
  status: 'sent'
}

export interface ImapClientLike {
  mailbox?: {
    exists?: number
    uidValidity?: bigint | number | string
    uidNext?: number
  } | false
  connect(): Promise<void>
  logout(): Promise<void>
  close(): void
  list(options?: unknown): Promise<any[]>
  getMailboxLock(path: string, options?: unknown): Promise<{ release(): void }>
  fetch(range: unknown, query: unknown, options?: unknown): AsyncIterable<any> | Iterable<any>
  fetchOne(range: unknown, query: unknown, options?: unknown): Promise<any>
  search(query: unknown, options?: unknown): Promise<number[] | false>
  append(
    path: string,
    content: Buffer | string,
    flags?: string[],
    internalDate?: Date,
  ): Promise<unknown>
}

export interface SmtpTransportLike {
  verify(): Promise<unknown>
  sendMail(message: Record<string, unknown>): Promise<{
    messageId?: string
    accepted?: unknown[]
    rejected?: unknown[]
    pending?: unknown[]
    response?: string
  }>
  close(): void
}

export interface CompiledMimeMessage {
  message: Buffer
  messageId: string
  envelope: { from: string; to: string[] }
}

export interface ImapSmtpAdapterRuntime {
  hostResolver?: MailHostResolverRuntime
  resolveEndpoint?: typeof resolveSecureMailEndpoint
  createImapClient?: (options: Record<string, unknown>) => Promise<ImapClientLike> | ImapClientLike
  createSmtpTransport?: (
    options: Record<string, unknown>,
  ) => Promise<SmtpTransportLike> | SmtpTransportLike
  compileMime?: (message: Record<string, unknown>) => Promise<CompiledMimeMessage>
  parseMime?: (source: Uint8Array) => Promise<any>
  now?: () => Date
}

/**
 * Complete server-side runtime bundle used by the provider-level exports.
 * `secrets` and `referenceSecret` must only come from encrypted server storage.
 */
export interface ImapSmtpRuntimeConfig {
  connection: ImapSmtpConnectionConfig
  secrets: ImapSmtpConnectionSecrets
  referenceSecret: string
  runtime?: ImapSmtpAdapterRuntime
}

export class ImapSmtpConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImapSmtpConfigurationError'
  }
}

export class ImapSmtpDeliveryError extends Error {
  readonly deliveryAmbiguous: boolean

  constructor(message: string, deliveryAmbiguous: boolean, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImapSmtpDeliveryError'
    this.deliveryAmbiguous = deliveryAmbiguous
  }
}

export class ImapSmtpMailboxStateError extends Error {
  readonly code: 'MESSAGE_NOT_FOUND' | 'UIDVALIDITY_CHANGED' | 'REPLY_UNAVAILABLE'

  constructor(
    code: 'MESSAGE_NOT_FOUND' | 'UIDVALIDITY_CHANGED' | 'REPLY_UNAVAILABLE',
    message: string,
  ) {
    super(message)
    this.name = 'ImapSmtpMailboxStateError'
    this.code = code
  }
}

/**
 * Creates an on-demand IMAP/SMTP adapter. It never keeps an IDLE connection or
 * provider client in module state; every operation connects, works and logs out.
 */
export function createImapSmtpAdapter(
  rawConfig: ImapSmtpConnectionConfig,
  rawSecrets: ImapSmtpConnectionSecrets,
  referenceSecret: string,
  runtime: ImapSmtpAdapterRuntime = {},
) {
  const config = normalizeConnectionConfig(rawConfig)
  const secrets = normalizeConnectionSecrets(rawSecrets)
  assertReferenceSecret(referenceSecret)

  const resolveEndpoint = runtime.resolveEndpoint ?? resolveSecureMailEndpoint

  async function resolvedCandidates(
    kind: 'imap' | 'smtp',
    endpoint: NormalizedMailEndpoint,
  ): Promise<ResolvedMailEndpoint[]> {
    const resolved = await resolveEndpoint(kind, endpoint, runtime.hostResolver)
    const addresses = resolved.addresses.length
      ? resolved.addresses
      : [{ address: resolved.address, family: resolved.family }]
    return addresses.map(address => ({
      ...resolved,
      ...address,
      addresses: resolved.addresses,
    }))
  }

  async function createConnectedImapClient(): Promise<ImapClientLike> {
    const endpoints = await resolvedCandidates('imap', config.imap)
    let lastError: unknown
    for (const [index, endpoint] of endpoints.entries()) {
      const options = imapClientOptions(config.imap, secrets.imapPassword, endpoint)
      let client: ImapClientLike | null = null
      try {
        client = runtime.createImapClient
          ? await runtime.createImapClient(options)
          : await defaultCreateImapClient(options)
        await withDeadline(client.connect(), OPERATION_TIMEOUT_MS, 'Przekroczono czas połączenia IMAP.')
        return client
      } catch (error) {
        client?.close()
        lastError = error
        if (index === endpoints.length - 1 || !mayRetryDifferentAddress(error)) throw error
      }
    }
    throw lastError
  }

  async function withImap<T>(operation: (client: ImapClientLike) => Promise<T>): Promise<T> {
    const client = await createConnectedImapClient()
    try {
      return await withDeadline(
        operation(client),
        OPERATION_TIMEOUT_MS,
        'Przekroczono czas operacji IMAP.',
      )
    } finally {
      try {
        await withDeadline(client.logout(), LOGOUT_TIMEOUT_MS, 'IMAP logout timeout')
      } catch {
        client.close()
      }
    }
  }

  async function createSmtp(endpoint: ResolvedMailEndpoint): Promise<SmtpTransportLike> {
    if (!config.smtp) {
      throw new ImapSmtpConfigurationError('Dla tego konta nie skonfigurowano serwera SMTP.')
    }
    const options = smtpTransportOptions(
      config.smtp,
      secrets.smtpPassword ?? secrets.imapPassword,
      endpoint,
    )
    return runtime.createSmtpTransport
      ? runtime.createSmtpTransport(options)
      : defaultCreateSmtpTransport(options)
  }

  async function getMessageDetail(reference: string): Promise<ImapMessageDetail> {
    const decoded = openImapMessageReference(reference, referenceSecret)
    return withImap(async (client) => {
      const lock = await client.getMailboxLock(decoded.mailbox, {
        readOnly: true,
        description: 'openexpert-message-detail',
      })
      try {
        assertUidValidity(client, decoded.uidValidity)
        const fetched = await client.fetchOne(decoded.uid, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          internalDate: true,
          size: true,
          source: { start: 0, maxLength: IMAP_MAX_SOURCE_BYTES + 1 },
        }, { uid: true })
        if (!fetched || Number(fetched.uid) !== decoded.uid) {
          throw new ImapSmtpMailboxStateError(
            'MESSAGE_NOT_FOUND',
            'Wiadomość IMAP nie istnieje lub została przeniesiona.',
          )
        }

        const rawSource = Buffer.isBuffer(fetched.source)
          ? fetched.source
          : Buffer.from(fetched.source ?? '')
        const sourceWasCapped = rawSource.length > IMAP_MAX_SOURCE_BYTES
        const source = rawSource.subarray(0, IMAP_MAX_SOURCE_BYTES)
        const parsed = source.length
          ? await safeParseMime(source, runtime)
          : {}
        return messageDetail(
          reference,
          decoded,
          fetched,
          parsed,
          sourceWasCapped || Number(fetched.size ?? 0) > source.length,
          config.trustedAuthenticationResultsHost,
        )
      } finally {
        lock.release()
      }
    })
  }

  return {
    provider: IMAP_PROVIDER_ID,
    accountEmail: config.accountEmail,
    capabilities: {
      canRead: true,
      canSend: Boolean(config.smtp),
      canSearch: true,
    },

    async testConnection(): Promise<ImapSmtpConnectionTestResult> {
      const imapPromise = withImap(async (client) => {
        const folders = await client.list()
        if (!folders.some(folder => folderRole(folder) === 'inbox')) {
          throw new Error('Serwer IMAP nie udostępnia skrzynki odbiorczej.')
        }
        return { ok: true as const, folderCount: folders.length }
      })

      const smtpPromise = config.smtp
        ? (async () => {
            const endpoints = await resolvedCandidates('smtp', config.smtp!)
            let lastError: unknown
            for (const [index, endpoint] of endpoints.entries()) {
              let transport: SmtpTransportLike | null = null
              try {
                transport = await createSmtp(endpoint)
                await withDeadline(
                  transport.verify(),
                  OPERATION_TIMEOUT_MS,
                  'Przekroczono czas weryfikacji SMTP.',
                )
                return { ok: true as const }
              } catch (error) {
                lastError = error
                if (index === endpoints.length - 1 || !mayRetryDifferentAddress(error)) throw error
              } finally {
                transport?.close()
              }
            }
            throw lastError
          })()
        : Promise.resolve(null)

      const [imap, smtp] = await Promise.all([imapPromise, smtpPromise])
      return { imap, smtp }
    },

    async listFolderSummaries(): Promise<ImapFolderSummary[]> {
      return withImap(async (client) => {
        const folders = await client.list({
          statusQuery: { messages: true, unseen: true, uidValidity: true, uidNext: true },
        })
        return folders
          .filter(folder => folder && folder.selectable !== false)
          .slice(0, 250)
          .map(folderSummary)
          .sort(compareFolders)
      })
    },

    async listMessages(input: {
      mailbox: string
      offset?: number
      pageSize?: number
      flaggedOnly?: boolean
    }): Promise<ImapMessagePage> {
      return loadMessagePage(input)
    },

    async searchMessages(input: {
      mailbox: string
      query: string
      offset?: number
      pageSize?: number
      flaggedOnly?: boolean
    }): Promise<ImapMessagePage> {
      const query = normalizeSearchQuery(input.query)
      return loadMessagePage({ ...input, query })
    },

    async searchMessagesByParticipants(input: {
      mailbox: string
      participantEmails: string[]
      offset?: number
      pageSize?: number
      flaggedOnly?: boolean
    }): Promise<ImapMessagePage> {
      const participantEmails = normalizeParticipantEmails(input.participantEmails)
      return loadMessagePage({ ...input, participantEmails })
    },

    getMessageDetail,

    async getThreadDetail(reference: string): Promise<MailThreadDetail> {
      const detail = await getMessageDetail(reference)
      return {
        id: reference,
        subject: detail.subject,
        messages: [{
          id: reference,
          from: detail.from,
          replyTo: detail.replyTo,
          to: detail.to,
          cc: detail.cc,
          subject: detail.subject,
          sentAt: detail.sentAt,
          unread: detail.unread,
          bodyText: detail.bodyText,
          bodyHtml: detail.bodyHtml,
          bodyHtmlTruncated: detail.bodyHtmlTruncated,
          hasRemoteImages: detail.hasRemoteImages,
          bodyTruncated: detail.bodyTruncated,
          attachments: detail.attachments,
          security: detail.security,
        }],
        omittedMessageCount: 0,
        externalUrl: null,
      }
    },

    async getReplyContext(reference: string): Promise<ImapReplyContext> {
      const detail = await getMessageDetail(reference)
      const inReplyTo = detail.messageId || openImapMessageReference(reference, referenceSecret).messageId
      if (!inReplyTo) {
        throw new ImapSmtpMailboxStateError(
          'REPLY_UNAVAILABLE',
          'Ta wiadomość nie zawiera identyfikatora potrzebnego do odpowiedzi.',
        )
      }
      return {
        subject: replySubject(detail.subject),
        inReplyTo,
        references: boundedReferences([...detail.references, inReplyTo]),
      }
    },

    async findSentMessage(messageIdValue: string): Promise<ImapSmtpSentMessage | null> {
      const messageId = requiredMessageId(messageIdValue, 'Identyfikator wysłanej wiadomości')
      return withImap(async (client) => {
        let sentMailbox = config.sentMailbox
        if (!sentMailbox) {
          const folders = await client.list()
          sentMailbox = folders.find(folder => folderRole(folder) === 'sent')?.path
        }
        if (!sentMailbox) return null
        const mailbox = normalizeMailbox(sentMailbox)
        const lock = await client.getMailboxLock(mailbox, {
          readOnly: true,
          description: 'openexpert-sent-message-lookup',
        })
        try {
          const uidValidity = currentUidValidity(client)
          const found = await client.search({
            header: { 'message-id': messageId },
          }, { uid: true })
          const candidates = (found || [])
            .map(Number)
            .filter(value => Number.isSafeInteger(value) && value > 0)
            .sort((left, right) => right - left)
            .slice(0, 10)
          if (!candidates.length) return null
          for (const candidateUid of candidates) {
            const fetched = await client.fetchOne(candidateUid, {
              uid: true,
              envelope: true,
            }, { uid: true })
            const fetchedMessageId = normalizeMessageId(fetched?.envelope?.messageId)
            if (
              !fetched
              || Number(fetched.uid) !== candidateUid
              || fetchedMessageId !== messageId
            ) {
              continue
            }
            const reference = sealImapMessageReference({
              mailbox,
              uidValidity,
              uid: candidateUid,
              messageId,
            }, referenceSecret)
            return {
              id: reference,
              threadId: reference,
              messageId,
              status: 'sent' as const,
            }
          }
          return null
        } finally {
          lock.release()
        }
      })
    },

    async sendMessage(input: ImapSmtpSendInput): Promise<ImapSmtpSendResult> {
      if (!config.smtp) {
        throw new ImapSmtpConfigurationError('Dla tego konta nie skonfigurowano serwera SMTP.')
      }
      const normalized = normalizeSendInput(input)
      const messageId = normalized.messageId
      const sentAt = runtime.now?.() ?? new Date()
      const envelopeRecipients = [...normalized.to, ...normalized.cc, ...normalized.bcc]
      const compileInput: Record<string, unknown> = {
        from: mailboxLabel(config.displayName, config.accountEmail),
        to: normalized.to,
        cc: normalized.cc,
        // Deliberately omit Bcc from the MIME source. Blind recipients only
        // exist in the SMTP envelope and cannot leak through the Sent copy.
        subject: normalized.subject,
        text: normalized.text,
        attachments: normalized.attachments.map(attachment => ({
          filename: attachment.filename,
          contentType: attachment.mimeType,
          content: Buffer.from(attachment.data),
        })),
        messageId,
        date: sentAt,
        inReplyTo: normalized.inReplyTo || undefined,
        references: normalized.references.length ? normalized.references : undefined,
        envelope: {
          from: config.accountEmail,
          to: envelopeRecipients,
        },
        newline: 'windows',
        disableFileAccess: true,
        disableUrlAccess: true,
      }
      const compiled = runtime.compileMime
        ? await runtime.compileMime(compileInput)
        : await defaultCompileMime(compileInput)
      if (!compiled.message.length || compiled.message.length > MAX_OUTGOING_SOURCE_BYTES) {
        throw new ImapSmtpConfigurationError('Wiadomość jest zbyt duża do wysłania przez SMTP.')
      }
      assertCompiledMimeHeaders(compiled.message, messageId)

      let sendResult: Awaited<ReturnType<SmtpTransportLike['sendMail']>> | null = null
      const endpoints = await resolvedCandidates('smtp', config.smtp)
      for (const [index, endpoint] of endpoints.entries()) {
        let transport: SmtpTransportLike | null = null
        try {
          transport = await createSmtp(endpoint)
          sendResult = await withDeadline(
            transport.sendMail({
              raw: compiled.message,
              envelope: {
                from: config.accountEmail,
                to: envelopeRecipients,
              },
              disableFileAccess: true,
              disableUrlAccess: true,
            }),
            OPERATION_TIMEOUT_MS,
            'Nie udało się potwierdzić wysyłki SMTP.',
          )
          break
        } catch (error) {
          const deliveryError = smtpDeliveryError(error)
          if (
            index === endpoints.length - 1
            || deliveryError.deliveryAmbiguous
            || !mayRetryDifferentAddress(error)
          ) throw deliveryError
        } finally {
          transport?.close()
        }
      }
      if (!sendResult) {
        throw new ImapSmtpDeliveryError(
          'Nie udało się potwierdzić wysyłki. Sprawdź folder Wysłane przed ponowieniem.',
          true,
        )
      }

      const accepted = normalizeProviderAddresses(sendResult.accepted)
      const rejected = normalizeProviderAddresses([
        ...(sendResult.rejected ?? []),
        ...(sendResult.pending ?? []),
      ])
      if (!accepted.length) {
        throw new ImapSmtpDeliveryError(
          'Serwer SMTP nie zaakceptował żadnego odbiorcy.',
          false,
        )
      }
      const acceptedSet = new Set(accepted)
      const partial = rejected.length > 0 || envelopeRecipients.some(
        recipient => !acceptedSet.has(recipient.toLowerCase()),
      )

      let sentCopy: { saved: boolean; reference: string | null } = {
        saved: false,
        reference: null,
      }
      try {
        sentCopy = await appendSentCopy(compiled.message, sentAt, messageId)
      } catch {
        // Delivery has already succeeded. Failure to archive must never cause
        // an automatic SMTP retry and duplicate the message for recipients.
      }

      const providerReference = sentCopy.reference
        ?? stableImapSentReference(messageId, referenceSecret)

      return {
        id: providerReference,
        threadId: providerReference,
        messageId,
        accepted,
        rejected,
        partial,
        sentCopySaved: sentCopy.saved,
      }
    },
  }

  async function loadMessagePage(input: {
    mailbox: string
    query?: string
    participantEmails?: string[]
    offset?: number
    pageSize?: number
    flaggedOnly?: boolean
  }): Promise<ImapMessagePage> {
    const mailbox = normalizeMailbox(input.mailbox)
    const offset = boundedInteger(input.offset, 0, 0, 1_000_000, 'offset')
    const pageSize = boundedInteger(input.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'pageSize')

    return withImap(async (client) => {
      const lock = await client.getMailboxLock(mailbox, {
        readOnly: true,
        description: 'openexpert-message-list',
      })
      try {
        const uidValidity = currentUidValidity(client)
        let range: string | number[] | null = null
        let resultSizeEstimate = 0
        let nextOffset: number | null = null
        if (input.query || input.participantEmails?.length || input.flaggedOnly) {
          const uidNext = Math.max(1, Number(client.mailbox && client.mailbox.uidNext) || 1)
          const firstSearchUid = Math.max(1, uidNext - MAX_SEARCH_UID_WINDOW)
          const participantCriteria = input.participantEmails?.flatMap(email => [
            { from: email },
            { to: email },
            { cc: email },
            { bcc: email },
          ])
          const found = await client.search({
            ...(input.query ? { text: input.query } : {}),
            ...(participantCriteria?.length ? { or: participantCriteria } : {}),
            ...(input.flaggedOnly ? { flagged: true } : {}),
            uid: `${firstSearchUid}:*`,
          }, { uid: true })
          const uids = (found || [])
            .map(Number)
            .filter(uid => Number.isSafeInteger(uid) && uid > 0)
            .sort((left, right) => right - left)
          resultSizeEstimate = uids.length
          const page = uids.slice(offset, offset + pageSize)
          range = page.length ? page : null
          nextOffset = offset + page.length < uids.length ? offset + page.length : null
        } else {
          const exists = Math.max(0, Number(client.mailbox && client.mailbox.exists) || 0)
          resultSizeEstimate = exists
          const end = exists - offset
          const start = Math.max(1, end - pageSize + 1)
          range = end >= 1 ? `${start}:${end}` : null
          const fetchedCount = end >= 1 ? end - start + 1 : 0
          nextOffset = offset + fetchedCount < exists ? offset + fetchedCount : null
        }

        if (!range) return { data: [], nextOffset: null, resultSizeEstimate }
        const messages: any[] = []
        const iterable = client.fetch(range, {
          uid: true,
          envelope: true,
          flags: true,
          bodyStructure: true,
          internalDate: true,
          size: true,
        }, Array.isArray(range) ? { uid: true } : undefined)
        for await (const message of iterable) messages.push(message)
        messages.sort((left, right) => messageTimestamp(right) - messageTimestamp(left))

        return {
          data: messages.map(message => messageSummary(
            message,
            sealImapMessageReference({
              mailbox,
              uidValidity,
              uid: requiredUid(message.uid),
              messageId: normalizeMessageId(message.envelope?.messageId),
            }, referenceSecret),
            config.accountEmail,
          )),
          nextOffset,
          resultSizeEstimate,
        }
      } finally {
        lock.release()
      }
    })
  }

  async function appendSentCopy(
    source: Buffer,
    sentAt: Date,
    messageId: string,
  ): Promise<{ saved: boolean; reference: string | null }> {
    return withImap(async (client) => {
      let sentMailbox = config.sentMailbox
      if (!sentMailbox) {
        const folders = await client.list()
        sentMailbox = folders.find(folder => folderRole(folder) === 'sent')?.path
      }
      if (!sentMailbox) return { saved: false, reference: null }
      const mailbox = normalizeMailbox(sentMailbox)
      const result = await client.append(mailbox, source, ['\\Seen'], sentAt)
      if (result === false) return { saved: false, reference: null }
      const response = result as { uid?: unknown; uidValidity?: unknown }
      const uid = Number(response?.uid)
      const uidValidity = String(response?.uidValidity ?? '')
      const reference = Number.isSafeInteger(uid)
        && uid > 0
        && /^\d{1,40}$/u.test(uidValidity)
        ? sealImapMessageReference({ mailbox, uidValidity, uid, messageId }, referenceSecret)
        : null
      return { saved: true, reference }
    })
  }
}

export function verifyImapSmtpConnection(
  input: ImapSmtpConnectionInput,
  runtime?: ImapSmtpAdapterRuntime,
): Promise<ImapSmtpConnectionTestResult>
export function verifyImapSmtpConnection(
  input: ImapSmtpRuntimeConfig,
): Promise<ImapSmtpConnectionTestResult>
export async function verifyImapSmtpConnection(
  input: ImapSmtpConnectionInput | ImapSmtpRuntimeConfig,
  runtime: ImapSmtpAdapterRuntime = {},
): Promise<ImapSmtpConnectionTestResult> {
  if (isRuntimeConfig(input)) return runtimeAdapter(input).testConnection()
  const connection: ImapSmtpConnectionConfig = {
    provider: IMAP_PROVIDER_ID,
    accountEmail: input.accountEmail,
    displayName: input.displayName,
    imap: {
      host: input.imapHost,
      port: input.imapPort,
      security: input.imapSecurity,
      username: input.imapUsername,
    },
    smtp: {
      host: input.smtpHost,
      port: input.smtpPort,
      security: input.smtpSecurity,
      username: input.smtpUsername,
    },
  }
  return createImapSmtpAdapter(
    connection,
    { imapPassword: input.imapPassword, smtpPassword: input.smtpPassword },
    createHash('sha256').update('openexpert/imap/connection-test/v1').digest('hex'),
    runtime,
  ).testConnection()
}

export async function fetchImapSmtpThreadPage(
  config: ImapSmtpRuntimeConfig,
  input: {
    folder: MailFolderId
    query?: string
    participantEmails?: string[]
    pageToken?: string
    maxResults?: number
  },
): Promise<MailThreadListPayload> {
  const adapter = runtimeAdapter(config)
  const folder = normalizeProviderFolder(input.folder)
  const participantEmails = normalizeParticipantEmails(input.participantEmails ?? [])
  const queryValue = String(input.query ?? '').trim()
  if (queryValue && participantEmails.length) {
    throw new TypeError('Nie można łączyć typów wyszukiwania IMAP.')
  }
  const query = participantEmails.length
    ? participantSearchBinding(participantEmails)
    : queryValue ? normalizeSearchQuery(queryValue) : ''
  const requestedPageSize = boundedInteger(
    input.maxResults,
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE,
    'maxResults',
  )
  const imapFolders = await adapter.listFolderSummaries()
  const folders = providerFolderSummaries(imapFolders)
  const selected = providerMailbox(imapFolders, folder, config.connection.sentMailbox)
  const flaggedOnly = folder === 'STARRED'
  const starredFallback = flaggedOnly
    && !['\\all', '\\flagged'].includes(selected?.specialUse ?? '')

  if (!selected) {
    if (input.pageToken) throw new TypeError('Kursor strony IMAP jest nieprawidłowy.')
    return {
      data: [],
      folders,
      nextPageToken: null,
      resultSizeEstimate: 0,
      partialFailureCount: flaggedOnly ? 1 : 0,
    }
  }

  let offset = 0
  let pageSize = requestedPageSize
  if (input.pageToken) {
    const cursor = openImapPageCursor(input.pageToken, config.referenceSecret)
    if (
      cursor.folder !== folder
      || cursor.mailbox !== selected.path
      || cursor.query !== query
      || cursor.flaggedOnly !== flaggedOnly
      || (input.maxResults !== undefined && cursor.pageSize !== requestedPageSize)
    ) {
      throw new TypeError('Kursor strony IMAP jest nieprawidłowy.')
    }
    offset = cursor.offset
    pageSize = cursor.pageSize
  }

  const page = participantEmails.length
    ? await adapter.searchMessagesByParticipants({
        mailbox: selected.path,
        participantEmails,
        offset,
        pageSize,
        flaggedOnly,
      })
    : query
      ? await adapter.searchMessages({
          mailbox: selected.path,
          query,
          offset,
          pageSize,
          flaggedOnly,
        })
      : await adapter.listMessages({
          mailbox: selected.path,
          offset,
          pageSize,
          flaggedOnly,
        })
  return {
    data: page.data,
    folders,
    nextPageToken: page.nextOffset === null
      ? null
      : sealImapPageCursor({
          folder,
          mailbox: selected.path,
          offset: page.nextOffset,
          pageSize,
          query,
          flaggedOnly,
        }, config.referenceSecret),
    resultSizeEstimate: page.resultSizeEstimate,
    partialFailureCount: starredFallback ? 1 : 0,
  }
}

export async function fetchImapSmtpThread(
  config: ImapSmtpRuntimeConfig,
  reference: string,
): Promise<MailThreadDetail> {
  return runtimeAdapter(config).getThreadDetail(reference)
}

export async function fetchImapSmtpReplyContext(
  config: ImapSmtpRuntimeConfig,
  reference: string,
): Promise<ImapReplyContext> {
  return runtimeAdapter(config).getReplyContext(reference)
}

export async function sendImapSmtpMessage(
  config: ImapSmtpRuntimeConfig,
  input: ImapSmtpSendInput,
): Promise<ImapSmtpSendResult> {
  return runtimeAdapter(config).sendMessage(input)
}

export async function findImapSmtpSentMessage(
  config: ImapSmtpRuntimeConfig,
  messageId: string,
): Promise<ImapSmtpSentMessage | null> {
  return runtimeAdapter(config).findSentMessage(messageId)
}

function isRuntimeConfig(
  value: ImapSmtpConnectionInput | ImapSmtpRuntimeConfig,
): value is ImapSmtpRuntimeConfig {
  return Boolean(value && typeof value === 'object' && 'connection' in value)
}

function runtimeAdapter(config: ImapSmtpRuntimeConfig) {
  return createImapSmtpAdapter(
    config.connection,
    config.secrets,
    config.referenceSecret,
    config.runtime,
  )
}

function normalizeProviderFolder(value: MailFolderId): MailFolderId {
  if (!['INBOX', 'STARRED', 'SENT', 'DRAFT'].includes(String(value))) {
    throw new ImapSmtpConfigurationError('Folder poczty jest nieprawidłowy.')
  }
  return value
}

function providerFolderSummaries(values: ImapFolderSummary[]): MailFolderSummary[] {
  const inbox = values.find(folder => folder.role === 'inbox')
  const sent = values.find(folder => folder.role === 'sent')
  const drafts = values.find(folder => folder.role === 'drafts')
  return [
    providerFolderSummary('INBOX', 'Odebrane', inbox),
    {
      id: 'STARRED',
      label: 'Oznaczone',
      messagesTotal: null,
      messagesUnread: null,
    },
    providerFolderSummary('SENT', 'Wysłane', sent),
    providerFolderSummary('DRAFT', 'Szkice', drafts),
  ]
}

function providerFolderSummary(
  id: MailFolderId,
  label: string,
  source: ImapFolderSummary | undefined,
): MailFolderSummary {
  return {
    id,
    label,
    messagesTotal: source?.messagesTotal ?? null,
    messagesUnread: source?.messagesUnread ?? null,
  }
}

function providerMailbox(
  values: ImapFolderSummary[],
  folder: MailFolderId,
  configuredSentMailbox: string | undefined,
): ImapFolderSummary | null {
  if (folder === 'STARRED') {
    return values.find(value => value.specialUse === '\\flagged')
      ?? values.find(value => value.specialUse === '\\all')
      ?? values.find(value => value.role === 'inbox')
      ?? null
  }
  if (folder === 'INBOX') return values.find(value => value.role === 'inbox') ?? null
  if (folder === 'DRAFT') return values.find(value => value.role === 'drafts') ?? null
  if (configuredSentMailbox) {
    const configured = values.find(value => value.path === configuredSentMailbox)
    if (configured) return configured
  }
  return values.find(value => value.role === 'sent') ?? null
}

export function imapClientOptions(
  endpointConfig: ImapAccountEndpointConfig,
  password: string,
  resolved: ResolvedMailEndpoint,
): Record<string, unknown> {
  return {
    // Pin the actual socket to the validated address. `servername` retains
    // SNI and certificate verification against the user's DNS hostname.
    host: resolved.address,
    port: resolved.port,
    secure: resolved.security === 'tls',
    ...(resolved.security === 'starttls' ? { doSTARTTLS: true } : {}),
    servername: resolved.servername,
    auth: { user: endpointConfig.username, pass: password },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      servername: resolved.servername,
    },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    maxLineLength: MAX_IMAP_LINE_BYTES,
    maxLiteralSize: MAX_IMAP_LITERAL_BYTES,
    disableAutoIdle: true,
    disableCompression: true,
    logger: false,
    emitLogs: false,
    logRaw: false,
  }
}

export function smtpTransportOptions(
  endpointConfig: SmtpAccountEndpointConfig,
  password: string,
  resolved: ResolvedMailEndpoint,
): Record<string, unknown> {
  return {
    host: resolved.address,
    port: resolved.port,
    secure: resolved.security === 'tls',
    servername: resolved.servername,
    requireTLS: resolved.security === 'starttls',
    ignoreTLS: false,
    opportunisticTLS: false,
    auth: { user: endpointConfig.username, pass: password },
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: true,
      servername: resolved.servername,
    },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    dnsTimeout: CONNECTION_TIMEOUT_MS,
    pool: false,
    logger: false,
    debug: false,
    transactionLog: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  }
}

/** Encrypts and authenticates a route-safe reference; mailbox names never enter URLs raw. */
export function sealImapMessageReference(
  input: ImapMessageReference,
  secret: string,
): string {
  assertReferenceSecret(secret)
  const normalized = normalizeMessageReference(input)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', referenceKey(secret), iv)
  cipher.setAAD(REFERENCE_AAD)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ v: 1, ...normalized }), 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([1]), iv, tag, encrypted]).toString('base64url')
}

export function openImapMessageReference(
  value: string,
  secret: string,
): ImapMessageReference {
  assertReferenceSecret(secret)
  if (!/^[A-Za-z0-9_-]{40,4096}$/u.test(value)) {
    throw new TypeError('Nieprawidłowy identyfikator wiadomości IMAP.')
  }
  try {
    const envelope = Buffer.from(value, 'base64url')
    if (envelope.toString('base64url') !== value) throw new Error('non-canonical envelope')
    if (envelope.length < 1 + 12 + 16 + 2 || envelope[0] !== 1) throw new Error('bad envelope')
    const iv = envelope.subarray(1, 13)
    const tag = envelope.subarray(13, 29)
    const ciphertext = envelope.subarray(29)
    const decipher = createDecipheriv('aes-256-gcm', referenceKey(secret), iv)
    decipher.setAAD(REFERENCE_AAD)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const parsed = JSON.parse(plaintext.toString('utf8')) as ImapMessageReference & { v?: number }
    if (parsed.v !== 1) throw new Error('bad version')
    return normalizeMessageReference(parsed)
  } catch {
    throw new TypeError('Nieprawidłowy identyfikator wiadomości IMAP.')
  }
}

export function sealImapPageCursor(input: ImapPageCursor, secret: string): string {
  assertReferenceSecret(secret)
  const normalized = normalizePageCursor(input)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', referenceKey(secret), iv)
  cipher.setAAD(PAGE_CURSOR_AAD)
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ v: 1, ...normalized }), 'utf8'),
    cipher.final(),
  ])
  return Buffer.concat([
    Buffer.from([1]),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]).toString('base64url')
}

export function openImapPageCursor(value: string, secret: string): ImapPageCursor {
  assertReferenceSecret(secret)
  if (!/^[A-Za-z0-9_-]{40,4096}$/u.test(value)) {
    throw new TypeError('Kursor strony IMAP jest nieprawidłowy.')
  }
  try {
    const envelope = Buffer.from(value, 'base64url')
    if (envelope.toString('base64url') !== value) throw new Error('non-canonical envelope')
    if (envelope.length < 1 + 12 + 16 + 2 || envelope[0] !== 1) throw new Error('bad envelope')
    const decipher = createDecipheriv(
      'aes-256-gcm',
      referenceKey(secret),
      envelope.subarray(1, 13),
    )
    decipher.setAAD(PAGE_CURSOR_AAD)
    decipher.setAuthTag(envelope.subarray(13, 29))
    const parsed = JSON.parse(Buffer.concat([
      decipher.update(envelope.subarray(29)),
      decipher.final(),
    ]).toString('utf8')) as ImapPageCursor & { v?: number }
    if (parsed.v !== 1) throw new Error('bad version')
    return normalizePageCursor(parsed)
  } catch {
    throw new TypeError('Kursor strony IMAP jest nieprawidłowy.')
  }
}

function normalizePageCursor(input: ImapPageCursor): ImapPageCursor {
  const folder = normalizeProviderFolder(input.folder)
  const mailbox = normalizeMailbox(input.mailbox)
  const offset = boundedInteger(input.offset, 0, 0, 1_000_000, 'offset')
  const pageSize = boundedInteger(input.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE, 'pageSize')
  const rawQuery = String(input.query ?? '').trim()
  const query = rawQuery ? normalizeSearchQuery(rawQuery) : ''
  const flaggedOnly = input.flaggedOnly === true
  if (flaggedOnly !== (folder === 'STARRED')) {
    throw new TypeError('Kursor strony IMAP jest nieprawidłowy.')
  }
  return { folder, mailbox, offset, pageSize, query, flaggedOnly }
}

function normalizeConnectionConfig(input: ImapSmtpConnectionConfig): ImapSmtpConnectionConfig & {
  imap: ImapAccountEndpointConfig & NormalizedMailEndpoint
  smtp?: SmtpAccountEndpointConfig & NormalizedMailEndpoint
} {
  if (input.provider !== IMAP_PROVIDER_ID) {
    throw new ImapSmtpConfigurationError('Nieprawidłowy typ połączenia pocztowego.')
  }
  const accountEmail = normalizeEmail(input.accountEmail, 'Adres konta')
  const imap = {
    ...normalizeMailEndpoint('imap', input.imap),
    username: normalizeUsername(input.imap.username, 'Użytkownik IMAP'),
  }
  const smtp = input.smtp
    ? {
        ...normalizeMailEndpoint('smtp', input.smtp),
        username: normalizeUsername(input.smtp.username, 'Użytkownik SMTP'),
      }
    : undefined
  const displayName = normalizeDisplayName(input.displayName)
  const sentMailbox = input.sentMailbox ? normalizeMailbox(input.sentMailbox) : undefined
  const trustedAuthenticationResultsHost = input.trustedAuthenticationResultsHost
    ? normalizeMailHostname(input.trustedAuthenticationResultsHost)
    : undefined
  return {
    provider: IMAP_PROVIDER_ID,
    accountEmail,
    ...(displayName ? { displayName } : {}),
    imap,
    ...(smtp ? { smtp } : {}),
    ...(sentMailbox ? { sentMailbox } : {}),
    ...(trustedAuthenticationResultsHost ? { trustedAuthenticationResultsHost } : {}),
  }
}

function normalizeConnectionSecrets(input: ImapSmtpConnectionSecrets): ImapSmtpConnectionSecrets {
  const imapPassword = normalizePassword(input.imapPassword, 'Hasło aplikacji IMAP')
  const smtpPassword = input.smtpPassword === undefined
    ? undefined
    : normalizePassword(input.smtpPassword, 'Hasło aplikacji SMTP')
  return { imapPassword, ...(smtpPassword ? { smtpPassword } : {}) }
}

function normalizePassword(value: string, field: string): string {
  if (
    typeof value !== 'string'
    || !value
    || value.length > 4_096
    || /[\u0000\r\n]/u.test(value)
  ) {
    throw new ImapSmtpConfigurationError(`${field} jest nieprawidłowe.`)
  }
  return value
}

function normalizeUsername(value: string, field: string): string {
  const username = typeof value === 'string' ? value.trim() : ''
  if (!username || username.length > 320 || /[\u0000-\u001F\u007F]/u.test(username)) {
    throw new ImapSmtpConfigurationError(`${field} jest nieprawidłowy.`)
  }
  return username
}

function normalizeDisplayName(value: string | undefined): string {
  const name = stripUnsafeMailDisplayControls(String(value ?? '')).trim()
  if (name.length > 128 || /[<>\r\n]/u.test(name)) {
    throw new ImapSmtpConfigurationError('Nazwa nadawcy jest nieprawidłowa.')
  }
  return name
}

function normalizeMailbox(value: string): string {
  const mailbox = stripUnsafeMailDisplayControls(String(value ?? '')).trim()
  if (!mailbox || mailbox.length > MAX_MAILBOX_LENGTH || /[\u0000\r\n]/u.test(mailbox)) {
    throw new ImapSmtpConfigurationError('Nazwa folderu IMAP jest nieprawidłowa.')
  }
  return mailbox
}

function normalizeSearchQuery(value: string): string {
  const query = String(value ?? '').trim()
  if (!query || query.length > MAX_SEARCH_LENGTH || /[\u0000-\u001F\u007F]/u.test(query)) {
    throw new ImapSmtpConfigurationError('Zapytanie wyszukiwania jest nieprawidłowe.')
  }
  return query
}

function normalizeParticipantEmails(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > 12) {
    throw new ImapSmtpConfigurationError('Lista uczestników wyszukiwania jest nieprawidłowa.')
  }
  return [...new Set(values.map(value => normalizeEmail(value, 'Uczestnik').toLowerCase()))]
}

function participantSearchBinding(emails: string[]): string {
  return `context-participants:${createHash('sha256')
    .update(emails.join('\0'), 'utf8')
    .digest('hex')}`
}

function normalizeMessageReference(input: ImapMessageReference): ImapMessageReference {
  const mailbox = normalizeMailbox(input.mailbox)
  const uidValidity = String(input.uidValidity ?? '')
  const uid = Number(input.uid)
  const messageId = normalizeMessageId(input.messageId)
  if (!/^\d{1,40}$/u.test(uidValidity) || !Number.isSafeInteger(uid) || uid < 1) {
    throw new TypeError('Nieprawidłowe dane wiadomości IMAP.')
  }
  return { mailbox, uidValidity, uid, messageId }
}

function assertReferenceSecret(value: string): void {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32) {
    throw new ImapSmtpConfigurationError('Sekret identyfikatorów IMAP musi mieć co najmniej 32 bajty.')
  }
}

function referenceKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

function normalizeMessageId(value: unknown): string | null {
  const messageId = String(value ?? '').trim()
  if (!messageId || messageId.length > 998 || /[\u0000\r\n]/u.test(messageId)) return null
  const match = messageId.match(/<[^<>\s]{1,240}>/u)
  return match?.[0] ?? null
}

function requiredMessageId(value: unknown, field: string): string {
  const input = String(value ?? '').trim()
  const messageId = normalizeMessageId(input)
  if (!messageId || input !== messageId) {
    throw new ImapSmtpConfigurationError(`${field} jest nieprawidłowy.`)
  }
  return messageId
}

function currentUidValidity(client: ImapClientLike): string {
  const value = String((client.mailbox && client.mailbox.uidValidity) || '')
  if (!/^\d{1,40}$/u.test(value)) {
    throw new Error('Serwer IMAP nie zwrócił UIDVALIDITY folderu.')
  }
  return value
}

function assertUidValidity(client: ImapClientLike, expected: string): void {
  if (currentUidValidity(client) !== expected) {
    throw new ImapSmtpMailboxStateError(
      'UIDVALIDITY_CHANGED',
      'Folder IMAP zmienił UIDVALIDITY; odśwież listę wiadomości.',
    )
  }
}

function requiredUid(value: unknown): number {
  const uid = Number(value)
  if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('Serwer IMAP zwrócił nieprawidłowy UID.')
  return uid
}

function folderSummary(folder: any): ImapFolderSummary {
  const path = normalizeMailbox(String(folder.path ?? ''))
  const status = folder.status ?? {}
  return {
    id: Buffer.from(path, 'utf8').toString('base64url'),
    path,
    name: stripUnsafeMailDisplayControls(String(folder.name || path)).trim() || path,
    role: folderRole(folder),
    specialUse: safeSpecialUse(folder.specialUse),
    messagesTotal: nullableCount(status.messages ?? folder.messages),
    messagesUnread: nullableCount(status.unseen ?? folder.unseen),
  }
}

function safeSpecialUse(value: unknown): string | null {
  const specialUse = String(value ?? '').trim().toLowerCase()
  return /^\\[a-z]{1,32}$/u.test(specialUse) ? specialUse : null
}

function folderRole(folder: any): ImapFolderRole {
  const rawSpecialUse = String(folder?.specialUse ?? '').trim()
  const specialUse = safeSpecialUse(folder?.specialUse)
  const path = normalizeStandardFolderName(folder?.path)
  if (specialUse === '\\inbox') return 'inbox'
  if (specialUse === '\\sent') return 'sent'
  if (specialUse === '\\drafts') return 'drafts'
  if (specialUse === '\\archive' || specialUse === '\\all') return 'archive'
  if (specialUse === '\\trash') return 'trash'
  if (specialUse === '\\junk') return 'spam'
  // SPECIAL-USE is authoritative. Name heuristics are deliberately exact and
  // are used only for older servers that expose no role metadata at all.
  if (rawSpecialUse) return 'other'

  const names = new Set([
    path,
    normalizeStandardFolderName(folder?.name),
  ].filter(Boolean))
  if (matchesStandardFolderName(names, 'inbox')) return 'inbox'
  if (matchesStandardFolderName(names, 'sent')) return 'sent'
  if (matchesStandardFolderName(names, 'drafts')) return 'drafts'
  if (matchesStandardFolderName(names, 'archive')) return 'archive'
  if (matchesStandardFolderName(names, 'trash')) return 'trash'
  if (matchesStandardFolderName(names, 'spam')) return 'spam'
  return 'other'
}

const STANDARD_FOLDER_NAMES: Readonly<Record<Exclude<ImapFolderRole, 'other'>, ReadonlySet<string>>> = {
  inbox: new Set(['inbox', 'odebrane', 'skrzynka odbiorcza']),
  sent: new Set([
    'sent',
    'sent items',
    'sent mail',
    'sent messages',
    'wyslane',
    'elementy wyslane',
    'gmail sent mail',
    'google mail sent mail',
    'inbox sent',
    'inbox sent items',
    'inbox wyslane',
  ]),
  drafts: new Set([
    'draft',
    'drafts',
    'szkice',
    'robocze',
    'elementy robocze',
    'gmail drafts',
    'google mail drafts',
    'inbox drafts',
    'inbox szkice',
  ]),
  archive: new Set([
    'archive',
    'archives',
    'archiwum',
    'all mail',
    'gmail all mail',
    'google mail all mail',
  ]),
  trash: new Set([
    'trash',
    'deleted',
    'deleted items',
    'kosz',
    'elementy usuniete',
    'gmail trash',
    'google mail trash',
  ]),
  spam: new Set([
    'spam',
    'junk',
    'junk email',
    'niechciane',
    'poczta niechciana',
    'wiadomosci smieci',
    'gmail spam',
    'google mail spam',
  ]),
}

function matchesStandardFolderName(
  values: ReadonlySet<string>,
  role: Exclude<ImapFolderRole, 'other'>,
): boolean {
  const allowed = STANDARD_FOLDER_NAMES[role]
  return [...values].some(value => allowed.has(value))
}

function normalizeStandardFolderName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[\[\](){}]/gu, ' ')
    .replace(/[\\/._-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase()
}

function compareFolders(left: ImapFolderSummary, right: ImapFolderSummary): number {
  const order: ImapFolderRole[] = ['inbox', 'sent', 'drafts', 'archive', 'spam', 'trash', 'other']
  return order.indexOf(left.role) - order.indexOf(right.role)
    || left.name.localeCompare(right.name, 'pl')
}

function nullableCount(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : null
}

function messageSummary(message: any, reference: string, accountEmail: string): MailThreadSummary {
  const envelope = message.envelope ?? {}
  const flags = normalizedFlags(message.flags)
  const participants = summaryParticipants(envelope, accountEmail)
  return {
    id: reference,
    messageCount: 1,
    participants,
    participantsLabel: participantLabel(participants),
    subject: safeText(envelope.subject, 500) || '(bez tematu)',
    snippet: '',
    latestAt: normalizeDate(message.internalDate ?? envelope.date),
    unread: !flags.has('\\seen'),
    starred: flags.has('\\flagged'),
    important: flags.has('$important') || flags.has('\\important'),
    draft: flags.has('\\draft'),
    hasAttachments: bodyStructureAttachments(message.bodyStructure).length > 0,
  }
}

function messageDetail(
  reference: string,
  decoded: ImapMessageReference,
  fetched: any,
  parsed: any,
  sourceWasCapped: boolean,
  trustedAuthenticationResultsHost: string | undefined,
): ImapMessageDetail {
  const envelope = fetched.envelope ?? {}
  const flags = normalizedFlags(fetched.flags)
  const headers = Array.isArray(parsed.headers) ? parsed.headers : []
  const messageId = normalizeMessageId(parsed.messageId ?? envelope.messageId ?? decoded.messageId)
  const providerHtml = String(parsed.html ?? '')
  const sanitizedHtml = providerHtml.trim()
    ? sanitizeMailHtml(providerHtml)
    : { html: null, hasRemoteImages: false, truncated: false }
  const body = parsed.text
    ? safeBody(parsed.text)
    : safeBody(htmlToPlainText(sanitizedHtml.html || providerHtml))
  const references = boundedReferences([
    ...normalizeReferenceValues(parsed.references),
    ...normalizeReferenceValues(headerValues(headers, 'references')),
  ])
  return {
    reference,
    messageId,
    references,
    inReplyTo: normalizeMessageId(parsed.inReplyTo ?? envelope.inReplyTo),
    from: parsedAddresses(parsed.from ?? envelope.from)[0] ?? null,
    replyTo: parsedAddresses(parsed.replyTo),
    to: parsedAddresses(parsed.to ?? envelope.to),
    cc: parsedAddresses(parsed.cc ?? envelope.cc),
    subject: safeText(parsed.subject ?? envelope.subject, 500) || '(bez tematu)',
    sentAt: normalizeDate(parsed.date ?? fetched.internalDate ?? envelope.date),
    unread: !flags.has('\\seen'),
    bodyText: body.slice(0, IMAP_MAX_BODY_CHARACTERS).trimEnd(),
    bodyHtml: sanitizedHtml.html,
    bodyHtmlTruncated: sourceWasCapped || sanitizedHtml.truncated,
    hasRemoteImages: sanitizedHtml.hasRemoteImages,
    bodyTruncated: sourceWasCapped || body.length > IMAP_MAX_BODY_CHARACTERS,
    attachments: bodyStructureAttachments(fetched.bodyStructure),
    security: messageSecurity(
      headers,
      parsed.from ?? envelope.from,
      parsed.replyTo,
      trustedAuthenticationResultsHost,
    ),
  }
}

function bodyStructureAttachments(node: any): MailAttachment[] {
  const attachments: MailAttachment[] = []
  const visit = (part: any, depth = 0) => {
    if (!part || depth > 32 || attachments.length >= 100) return
    const disposition = String(part.disposition ?? '').toLowerCase()
    const type = String(part.type ?? '').toLowerCase()
    const filename = part.dispositionParameters?.filename || part.parameters?.name
    if (
      filename
      || disposition === 'attachment'
      || (type && !type.startsWith('text/') && !type.startsWith('multipart/') && disposition !== 'inline')
    ) {
      attachments.push({
        id: part.part ? String(part.part) : null,
        filename: safeText(filename || 'załącznik', 255) || 'załącznik',
        mimeType: /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(type)
          ? type
          : 'application/octet-stream',
        size: Math.max(0, Number(part.size) || 0),
      })
    }
    for (const child of part.childNodes ?? []) visit(child, depth + 1)
  }
  visit(node)
  return attachments
}

function parsedAddresses(value: any): MailAddress[] {
  const values = Array.isArray(value) ? value : value ? [value] : []
  const flattened = values.flatMap((entry) => {
    if (Array.isArray(entry?.group)) return entry.group
    if (Array.isArray(entry?.value)) return entry.value
    return [entry]
  })
  return flattened.slice(0, 50).map((entry): MailAddress | null => {
    const email = normalizeOptionalEmail(entry?.address ?? entry?.email)
    const name = safeText(entry?.name, 128)
    const label = name || email || ''
    return label ? { name, email, label } : null
  }).filter((entry): entry is MailAddress => Boolean(entry))
}

function summaryParticipants(envelope: any, accountEmail: string): MailAddress[] {
  const account = accountEmail.toLowerCase()
  return uniqueAddresses([
    ...parsedAddresses(envelope.from),
    ...parsedAddresses(envelope.to),
    ...parsedAddresses(envelope.cc),
    ...parsedAddresses(envelope.bcc),
  ].filter(address => address.email?.toLowerCase() !== account))
}

function uniqueAddresses(values: MailAddress[]): MailAddress[] {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = value.email || value.label.toLocaleLowerCase('pl')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function participantLabel(values: MailAddress[]): string {
  if (!values.length) return 'Nieznany nadawca'
  const visible = values.slice(0, 3).map(value => value.label)
  return values.length > visible.length
    ? `${visible.join(', ')} +${values.length - visible.length}`
    : visible.join(', ')
}

function normalizedFlags(value: unknown): Set<string> {
  const flags = value instanceof Set ? [...value] : Array.isArray(value) ? value : []
  return new Set(flags.map(flag => String(flag).toLowerCase()))
}

function messageTimestamp(message: any): number {
  return Date.parse(String(message.internalDate ?? message.envelope?.date ?? '')) || Number(message.uid) || 0
}

function messageSecurity(
  headers: any[],
  from: any,
  replyTo: any,
  trustedAuthenticationResultsHost: string | undefined,
): MailMessageSecurity {
  const results = trustedAuthenticationResultsHost
    ? headerValues(headers, 'authentication-results')
        .filter(value => authenticationResultsHost(value) === trustedAuthenticationResultsHost)
        .join(' ')
        .toLowerCase()
    : ''
  const mechanisms = new Map<string, string>()
  for (const match of results.matchAll(/\b(spf|dkim|dmarc)=([a-z_-]+)/gu)) {
    if (match[1] && match[2] && !mechanisms.has(match[1])) mechanisms.set(match[1], match[2])
  }
  const dmarc = mechanisms.get('dmarc')
  const spf = mechanisms.get('spf')
  const dkim = mechanisms.get('dkim')
  const authentication = dmarc === 'pass'
    ? 'pass'
    : dmarc === 'fail'
      ? 'fail'
      : spf === 'pass' || dkim === 'pass'
        ? 'pass'
        : [spf, dkim].some(status => ['fail', 'softfail', 'permerror'].includes(status || ''))
          ? 'fail'
          : 'unknown'
  const fromDomain = emailDomain(parsedAddresses(from)[0]?.email)
  const replyDomains = parsedAddresses(replyTo).map(address => emailDomain(address.email)).filter(Boolean)
  return {
    authentication,
    replyToMismatch: Boolean(
      fromDomain && replyDomains.length && replyDomains.some(domain => domain !== fromDomain),
    ),
  }
}

function authenticationResultsHost(value: string): string {
  const candidate = value.trim().match(/^([a-z0-9.-]{1,253})(?:\s|;|$)/iu)?.[1]
  if (!candidate) return ''
  try {
    return normalizeMailHostname(candidate)
  } catch {
    return ''
  }
}

function headerValues(headers: any[], name: string): string[] {
  return headers
    .filter(header => String(header?.key ?? '').toLowerCase() === name)
    .map(header => String(header?.value ?? '').trim())
    .filter(Boolean)
}

function emailDomain(value: string | null | undefined): string {
  return value?.split('@').at(-1)?.toLowerCase() ?? ''
}

async function safeParseMime(source: Uint8Array, runtime: ImapSmtpAdapterRuntime): Promise<any> {
  try {
    if (runtime.parseMime) return await runtime.parseMime(source)
    const module = await import('postal-mime')
    const PostalMime = module.default
    return await PostalMime.parse(source, {
      attachmentEncoding: 'base64',
      maxNestingDepth: 32,
      maxHeadersSize: 256 * 1024,
      rfc822Attachments: true,
    })
  } catch {
    return {}
  }
}

async function defaultCreateImapClient(options: Record<string, unknown>): Promise<ImapClientLike> {
  const module = await import('imapflow')
  return new module.ImapFlow(options as any) as unknown as ImapClientLike
}

async function defaultCreateSmtpTransport(
  options: Record<string, unknown>,
): Promise<SmtpTransportLike> {
  const module = await import('nodemailer')
  const api = (module as any).default ?? module
  return api.createTransport(options as any) as unknown as SmtpTransportLike
}

async function defaultCompileMime(message: Record<string, unknown>): Promise<CompiledMimeMessage> {
  const module = await import('nodemailer')
  const api = (module as any).default ?? module
  const compiler = api.createTransport({
    streamTransport: true,
    buffer: true,
  } as any)
  try {
    const info = await compiler.sendMail(message as any) as any
    const compiled = Buffer.isBuffer(info.message) ? info.message : Buffer.from(info.message ?? '')
    return {
      message: compiled,
      messageId: String(info.messageId ?? message.messageId ?? ''),
      envelope: {
        from: String(info.envelope?.from ?? (message.envelope as any)?.from ?? ''),
        to: normalizeProviderAddresses(info.envelope?.to ?? (message.envelope as any)?.to),
      },
    }
  } finally {
    compiler.close()
  }
}

function assertCompiledMimeHeaders(source: Buffer, expectedMessageId: string): void {
  const prefix = source.subarray(0, Math.min(source.length, MAX_IMAP_LINE_BYTES + 4))
  let headerEnd = prefix.indexOf('\r\n\r\n')
  let separatorBytes = 4
  if (headerEnd < 0) {
    headerEnd = prefix.indexOf('\n\n')
    separatorBytes = 2
  }
  if (headerEnd < 1 || headerEnd > MAX_IMAP_LINE_BYTES) {
    throw new ImapSmtpConfigurationError('Nagłówki wygenerowanej wiadomości MIME są nieprawidłowe.')
  }
  const headerBlock = prefix.subarray(0, headerEnd + separatorBytes).toString('utf8')
  if (headerBlock.includes('\0')) {
    throw new ImapSmtpConfigurationError('Nagłówki wygenerowanej wiadomości MIME są nieprawidłowe.')
  }
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/gu, ' ')
  if (/^(?:bcc|resent-bcc)\s*:/imu.test(unfolded)) {
    throw new ImapSmtpConfigurationError('Wygenerowana wiadomość MIME ujawnia odbiorców Bcc.')
  }
  const messageIds = [...unfolded.matchAll(/^message-id\s*:\s*([^\r\n]+)$/gimu)]
    .map(match => match[1]?.trim())
    .filter(Boolean)
  if (messageIds.length !== 1 || messageIds[0] !== expectedMessageId) {
    throw new ImapSmtpConfigurationError('Wygenerowana wiadomość MIME ma nieprawidłowy Message-ID.')
  }
}

function normalizeSendInput(input: ImapSmtpSendInput) {
  const idempotencyKey = String(input.idempotencyKey ?? '').trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._:/-]{0,255}$/u.test(idempotencyKey)) {
    throw new ImapSmtpConfigurationError('Identyfikator wysyłki jest nieprawidłowy.')
  }
  const messageId = input.messageId === undefined
    ? stableMessageId(idempotencyKey)
    : requiredMessageId(input.messageId, 'Message-ID')
  let to = normalizeRecipients(input.to)
  let cc = normalizeRecipients(input.cc)
  let bcc = normalizeRecipients(input.bcc)
  const seen = new Set<string>()
  const unique = (values: string[]) => values.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  to = unique(to)
  cc = unique(cc)
  bcc = unique(bcc)
  if (!to.length || to.length + cc.length + bcc.length > MAX_RECIPIENTS) {
    throw new ImapSmtpConfigurationError('Wiadomość musi mieć 1–50 odbiorców.')
  }

  const subject = String(input.subject ?? '').trim()
  if (!subject || subject.length > MAX_SUBJECT_LENGTH || /[\u0000\r\n]/u.test(subject)) {
    throw new ImapSmtpConfigurationError('Temat wiadomości jest nieprawidłowy.')
  }
  const text = String(input.text ?? '')
  if (text.length > MAX_BODY_LENGTH || text.includes('\0')) {
    throw new ImapSmtpConfigurationError('Treść wiadomości jest zbyt długa.')
  }
  const attachments = normalizeSendAttachments(input.attachments)
  if (!text.trim() && !attachments.length) {
    throw new ImapSmtpConfigurationError('Dodaj treść wiadomości lub załącznik.')
  }
  return {
    idempotencyKey,
    messageId,
    to,
    cc,
    bcc,
    subject,
    text,
    attachments,
    inReplyTo: normalizeMessageId(input.inReplyTo) ?? '',
    references: boundedReferences(input.references ?? []),
  }
}

function normalizeSendAttachments(
  values: readonly ImapSmtpSendAttachment[] | undefined,
): ImapSmtpSendAttachment[] {
  const attachments = values ? [...values] : []
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new ImapSmtpConfigurationError(`Możesz dodać maksymalnie ${MAX_ATTACHMENTS} załączników.`)
  }
  let total = 0
  return attachments.map((attachment, index) => {
    const filename = safeText(attachment.filename, 180)
    if (!filename || /[/\\]/u.test(filename)) {
      throw new ImapSmtpConfigurationError(`Załącznik ${index + 1} ma nieprawidłową nazwę.`)
    }
    if (!(attachment.data instanceof Uint8Array) || !attachment.data.byteLength) {
      throw new ImapSmtpConfigurationError(`Załącznik ${index + 1} jest pusty.`)
    }
    if (attachment.data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new ImapSmtpConfigurationError('Pojedynczy załącznik nie może przekraczać 10 MB.')
    }
    total += attachment.data.byteLength
    if (total > MAX_ATTACHMENTS_BYTES) {
      throw new ImapSmtpConfigurationError('Załączniki nie mogą przekraczać 16 MB łącznie.')
    }
    const mimeType = String(attachment.mimeType ?? '').trim().toLowerCase()
    return {
      filename,
      mimeType: /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(mimeType)
        ? mimeType
        : 'application/octet-stream',
      data: attachment.data,
    }
  })
}

function normalizeRecipients(value: string | readonly string[] | undefined): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value]
  return raw.flatMap(entry => String(entry).split(/[;,\n]+/u))
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => normalizeEmail(entry, 'Odbiorca'))
}

function normalizeEmail(value: string, field: string): string {
  const email = String(value ?? '').trim()
  if (email.length > 254 || /[\s\u0000-\u001F\u007F]/u.test(email)) {
    throw new ImapSmtpConfigurationError(`${field} ma nieprawidłowy adres e-mail.`)
  }
  const separator = email.lastIndexOf('@')
  if (separator < 1 || separator !== email.indexOf('@')) {
    throw new ImapSmtpConfigurationError(`${field} ma nieprawidłowy adres e-mail.`)
  }
  const local = email.slice(0, separator)
  const domain = email.slice(separator + 1).toLowerCase()
  const valid = local.length <= 64
    && !local.startsWith('.')
    && !local.endsWith('.')
    && !local.includes('..')
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu.test(local)
    && domain.length <= 253
    && domain.split('.').length >= 2
    && domain.split('.').every(label => (
      label.length >= 1
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
    ))
  if (!valid) throw new ImapSmtpConfigurationError(`${field} ma nieprawidłowy adres e-mail.`)
  return `${local}@${domain}`
}

function normalizeOptionalEmail(value: unknown): string | null {
  try {
    return value ? normalizeEmail(String(value), 'Adres') : null
  } catch {
    return null
  }
}

function stableMessageId(idempotencyKey: string): string {
  return `<${createHash('sha256').update(idempotencyKey, 'utf8').digest('hex')}@mail.openexpert.app>`
}

function stableImapSentReference(messageId: string, secret: string): string {
  return `imap_${createHmac('sha256', referenceKey(secret))
    .update('openexpert/imap-sent-fallback/v1\0', 'utf8')
    .update(messageId, 'utf8')
    .digest('base64url')}`
}

function mailboxLabel(
  displayName: string | undefined,
  email: string,
): string | { name: string; address: string } {
  return displayName ? { name: displayName, address: email } : email
}

function smtpDeliveryError(error: unknown): ImapSmtpDeliveryError {
  if (error instanceof ImapSmtpDeliveryError) return error
  const code = String((error as { code?: unknown })?.code ?? '').toUpperCase()
  const command = String((error as { command?: unknown })?.command ?? '').toUpperCase()
  const message = String((error as { message?: unknown })?.message ?? '')
  const confirmedBeforeData = [
    'CERT_HAS_EXPIRED',
    'CERT_NOT_YET_VALID',
    'CERT_REVOKED',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'EAI_AGAIN',
    'EAUTH',
    'ECONNREFUSED',
    'EENVELOPE',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'ERR_SSL_CERTIFICATE_VERIFY_FAILED',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'ERR_TLS_CERT_ALTNAME_INVALID',
    'ERR_TLS_HANDSHAKE_TIMEOUT',
    'ETLS',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_GET_ISSUER_CERT',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  ].includes(code)
    || ['AUTH', 'MAIL FROM', 'RCPT TO'].some(stage => command.startsWith(stage))
    || (
      command === 'CONN'
      && /\b(?:ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|certificate|self[- ]signed)\b/iu
        .test(message)
    )
  return new ImapSmtpDeliveryError(
    confirmedBeforeData
      ? 'Serwer SMTP odrzucił wiadomość przed wysyłką.'
      : 'Nie udało się potwierdzić wysyłki. Sprawdź folder Wysłane przed ponowieniem.',
    !confirmedBeforeData,
    { cause: error },
  )
}

/**
 * Address failover is allowed only before a provider accepted message data.
 * This helper is used while establishing IMAP or SMTP sessions; authentication
 * failures are account-wide and should be surfaced without hammering every IP.
 */
function mayRetryDifferentAddress(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current = error
  for (let depth = 0; depth < 5 && current && !seen.has(current); depth += 1) {
    seen.add(current)
    const record = current as {
      authenticationFailed?: unknown
      code?: unknown
      command?: unknown
      cause?: unknown
      message?: unknown
      responseCode?: unknown
    }
    const code = String(record.code ?? record.responseCode ?? '').trim().toUpperCase()
    const command = String(record.command ?? '').trim().toUpperCase()
    const message = String(record.message ?? '')
    if (
      record.authenticationFailed === true
      || ['AUTHENTICATIONFAILED', 'EAUTH', 'LOGINFAILED', 'NOAUTH'].includes(code)
      || command === 'AUTH'
      || /\b(?:authentication failed|invalid credentials|login failed)\b/iu.test(message)
    ) return false
    current = record.cause
  }
  return true
}

function normalizeProviderAddresses(values: unknown): string[] {
  const entries = Array.isArray(values) ? values : values === undefined ? [] : [values]
  return entries.map((entry) => {
    if (typeof entry === 'string') return entry
    return String((entry as { address?: unknown })?.address ?? entry ?? '')
  }).map(value => value.trim().toLowerCase()).filter(Boolean).slice(0, MAX_RECIPIENTS)
}

function normalizeReferenceValues(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value ? [value] : []
  return entries.flatMap(entry => String(entry).match(/<[^<>\s]{1,240}>/gu) ?? [])
}

function boundedReferences(values: readonly unknown[]): string[] {
  const unique = [...new Set(values.flatMap(normalizeReferenceValues))].slice(-20)
  const result: string[] = []
  let bytes = 0
  for (const value of unique.reverse()) {
    const next = Buffer.byteLength(value, 'utf8') + 1
    if (bytes + next > 850) break
    result.unshift(value)
    bytes += next
  }
  return result
}

function replySubject(value: string): string {
  const subject = safeText(value, MAX_SUBJECT_LENGTH) || '(bez tematu)'
  return /^(?:re|odp):/iu.test(subject) ? subject : `Re: ${subject}`.slice(0, MAX_SUBJECT_LENGTH)
}

function safeText(value: unknown, maximum: number): string {
  return stripUnsafeMailDisplayControls(String(value ?? ''))
    .replace(/\r?\n[ \t]*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum)
}

function safeBody(value: unknown): string {
  return stripUnsafeMailDisplayControls(String(value ?? ''))
    .replace(/&(?:zwnj|zwj);/giu, '')
    .replace(/\r\n?|\u2028|\u2029/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
}

function htmlToPlainText(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/giu, '')
    .replace(/<!--[^]*?-->/gu, '')
    .replace(/<(?:br|hr)\b[^>]*\/?\s*>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|tr|h[1-6])\s*>/giu, '\n\n')
    .replace(/<li\b[^>]*>/giu, '\n• ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, '\'')
}

function normalizeDate(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ''))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ImapSmtpConfigurationError(`Pole ${field} jest nieprawidłowe.`)
  }
  return value
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(
      Object.assign(new Error(message), { code: 'ETIMEDOUT' }),
    ), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}
