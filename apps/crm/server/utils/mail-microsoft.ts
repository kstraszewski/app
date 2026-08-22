import {
  createHash,
  createHmac,
  timingSafeEqual,
} from 'node:crypto'
import type {
  MailAddress,
  MailAttachment,
  MailFolderId,
  MailFolderSummary,
  MailMessageDetail,
  MailMessageSecurity,
  MailThreadDetail,
  MailThreadListPayload,
  MailThreadSummary,
} from '../../shared/types/mail.ts'
import { stripUnsafeMailDisplayControls } from '../../shared/utils/mail-security.ts'
import { sanitizeMailHtml } from './mail-html.ts'
import {
  withMailMessageBlindRecipients,
  withMailThreadBlindParticipants,
} from './mail-message-blind-recipients.ts'
import { withMailMessageDraftState } from './mail-message-draft-state.ts'

export const MICROSOFT_MAIL_SCOPES = [
  'offline_access',
  'User.Read',
  'Mail.ReadWrite',
  'Mail.Send',
] as const

export const MICROSOFT_SIMPLE_ATTACHMENT_LIMIT_BYTES = 3 * 1024 * 1024
export const MICROSOFT_LARGE_ATTACHMENT_LIMIT_BYTES = 150 * 1024 * 1024
export const MICROSOFT_MAIL_CURSOR_MAX_LENGTH = 4_096
export const MICROSOFT_RECEIVED_ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024

const GRAPH_ORIGIN = 'https://graph.microsoft.com'
const GRAPH_API_PREFIX = '/v1.0/me/'
const OUTLOOK_UPLOAD_HOST = 'outlook.office.com'
const MICROSOFT_UPLOAD_CHUNK_BYTES = 12 * 320 * 1024
const MAX_LIST_RESULTS = 25
const MAX_THREAD_MESSAGES = 20
const MAX_CONVERSATION_MESSAGES = 200
const MAX_MESSAGE_BODY_CHARACTERS = 160_000
const MAX_THREAD_BODY_CHARACTERS = 500_000
const MAX_THREAD_HTML_CHARACTERS = 1_000_000
const MAX_CURSOR_URL_LENGTH = 16_384
const MAX_THREAD_REFERENCE_LENGTH = 6_000
const MICROSOFT_ATTACHMENT_JSON_OVERHEAD_BYTES = 64 * 1024

const GRAPH_LIST_FIELDS = [
  'id',
  'conversationId',
  'subject',
  'from',
  'toRecipients',
  'ccRecipients',
  'bccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'createdDateTime',
  'lastModifiedDateTime',
  'bodyPreview',
  'isRead',
  'flag',
  'importance',
  'hasAttachments',
  'isDraft',
  'webLink',
] as const

const GRAPH_DETAIL_FIELDS = [
  'id',
  'conversationId',
  'subject',
  'from',
  'replyTo',
  'toRecipients',
  'ccRecipients',
  'bccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'createdDateTime',
  'lastModifiedDateTime',
  'isRead',
  'isDraft',
  'hasAttachments',
  'body',
  'internetMessageId',
  'internetMessageHeaders',
  'webLink',
] as const

const MICROSOFT_FOLDER_PATH: Partial<Record<MailFolderId, string>> = {
  INBOX: 'inbox',
  SENT: 'sentitems',
  DRAFT: 'drafts',
}

export interface MicrosoftMailOAuthConfig {
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  tenant?: string
}

export interface MicrosoftMailDependencies {
  fetch?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
  now?: () => number
  random?: () => number
}

export interface MicrosoftMailOAuthTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scopes: string[]
}

export interface MicrosoftMailIdentity {
  accountId: string
  email: string
  displayName: string
}

export interface MicrosoftGraphEmailAddress {
  name?: string | null
  address?: string | null
}

export interface MicrosoftGraphRecipient {
  emailAddress?: MicrosoftGraphEmailAddress | null
}

export interface MicrosoftGraphInternetHeader {
  name?: string | null
  value?: string | null
}

export interface MicrosoftGraphAttachment {
  '@odata.type'?: string | null
  id?: string | null
  name?: string | null
  contentType?: string | null
  contentBytes?: string | null
  size?: number | null
  isInline?: boolean | null
}

export interface MicrosoftMailAttachmentDownloadInput {
  messageId: string
  attachmentId: string
  maxBytes: number
}

export interface MicrosoftGraphMessage {
  id?: string | null
  conversationId?: string | null
  subject?: string | null
  from?: MicrosoftGraphRecipient | null
  sender?: MicrosoftGraphRecipient | null
  replyTo?: MicrosoftGraphRecipient[] | null
  toRecipients?: MicrosoftGraphRecipient[] | null
  ccRecipients?: MicrosoftGraphRecipient[] | null
  bccRecipients?: MicrosoftGraphRecipient[] | null
  receivedDateTime?: string | null
  sentDateTime?: string | null
  createdDateTime?: string | null
  lastModifiedDateTime?: string | null
  bodyPreview?: string | null
  body?: { contentType?: string | null; content?: string | null } | null
  internetMessageId?: string | null
  internetMessageHeaders?: MicrosoftGraphInternetHeader[] | null
  isRead?: boolean | null
  isDraft?: boolean | null
  hasAttachments?: boolean | null
  flag?: { flagStatus?: string | null } | null
  importance?: string | null
  webLink?: string | null
}

export interface MicrosoftMailThreadReference {
  conversationId: string | null
  anchorMessageId: string
}

export interface MicrosoftMailReferenceOptions {
  /** Per-connection secret derived by the caller; never persisted in a route reference. */
  referenceSecret: string
}

export interface MicrosoftMailThreadWindowOptions extends MicrosoftMailReferenceOptions {
  cursor?: string
  maxMessages?: number
  newerMessageCount?: number
  providerMessageCount?: number
}

export interface MicrosoftMailHeader {
  name: string
  value: string
}

export interface MicrosoftMailMessageDetail extends MailMessageDetail {
  internetMessageId: string | null
  headers: MicrosoftMailHeader[]
  webLink: string | null
}

export interface MicrosoftMailThreadDetail extends Omit<MailThreadDetail, 'messages'> {
  messages: MicrosoftMailMessageDetail[]
}

export interface MicrosoftMailReplyContext {
  messageId: string
  threadId: string
  subject: string
  recipients: MailAddress[]
}

export interface MicrosoftMailSendAttachment {
  filename: string
  mimeType: string
  data: Uint8Array
}

export interface MicrosoftMailSendInput {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  text: string
  /** Stable RFC 5322 Message-ID stored by the caller before sending. */
  messageId: string
  /** Signed thread reference returned by this adapter. */
  threadId?: string
  attachments?: MicrosoftMailSendAttachment[]
}

export interface MicrosoftMailSendOptions extends MicrosoftMailReferenceOptions {
  accountEmail?: string
  onDraftCreated?: (draft: MicrosoftMailSendResult) => void | Promise<void>
}

export interface MicrosoftMailSendResult {
  id: string
  threadId: string
}

export interface MicrosoftMailMessageLookup {
  id: string
  threadId: string
}

export class MicrosoftMailError extends Error {
  readonly statusCode: number
  readonly statusMessage: string
  readonly code: string
  readonly deliveryAmbiguous: boolean
  readonly data?: { deliveryAmbiguous: true }

  constructor(
    statusCode: number,
    code: string,
    message: string,
    options: { cause?: unknown; deliveryAmbiguous?: boolean } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'MicrosoftMailError'
    this.statusCode = statusCode
    this.statusMessage = message
    this.code = code
    this.deliveryAmbiguous = Boolean(options.deliveryAmbiguous)
    if (this.deliveryAmbiguous) this.data = { deliveryAmbiguous: true }
  }
}

export function microsoftMailProviderAvailability(config: MicrosoftMailOAuthConfig): boolean {
  return Boolean(cleanConfigText(config.clientId) && cleanConfigText(config.clientSecret))
}

export function microsoftMailAuthorizationUrl(
  config: MicrosoftMailOAuthConfig,
  input: {
    state: string
    codeChallenge: string
    redirectUri?: string
    loginHint?: string
    prompt?: 'select_account' | 'consent' | 'login'
  },
): string {
  const required = requiredMicrosoftConfig(config, input.redirectUri)
  const state = boundedRequiredText(input.state, 'OAuth state', 1_024)
  const codeChallenge = boundedRequiredText(input.codeChallenge, 'OAuth PKCE challenge', 256)
  if (!/^[A-Za-z0-9_-]{43,128}$/u.test(codeChallenge)) {
    throw new MicrosoftMailError(500, 'OAUTH_PKCE_INVALID', 'Microsoft OAuth PKCE challenge is invalid')
  }
  const prompt = input.prompt ?? 'select_account'
  if (!['select_account', 'consent', 'login'].includes(prompt)) {
    throw new MicrosoftMailError(400, 'OAUTH_PROMPT_INVALID', 'Microsoft OAuth prompt is invalid')
  }

  const query = new URLSearchParams({
    client_id: required.clientId,
    redirect_uri: required.redirectUri,
    response_type: 'code',
    response_mode: 'query',
    scope: MICROSOFT_MAIL_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt,
  })
  const loginHint = cleanConfigText(input.loginHint)
  if (loginHint) query.set('login_hint', boundedRequiredText(loginHint, 'OAuth login hint', 320))

  return `${microsoftIdentityOrigin(required.tenant)}/oauth2/v2.0/authorize?${query}`
}

export async function exchangeMicrosoftMailOAuthCode(
  config: MicrosoftMailOAuthConfig,
  input: {
    code: string
    codeVerifier: string
    redirectUri?: string
  },
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailOAuthTokenSet> {
  const required = requiredMicrosoftConfig(config, input.redirectUri)
  const codeVerifier = boundedRequiredText(input.codeVerifier, 'OAuth PKCE verifier', 256)
  if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(codeVerifier)) {
    throw new MicrosoftMailError(400, 'OAUTH_PKCE_INVALID', 'Microsoft OAuth PKCE verifier is invalid')
  }
  const body = new URLSearchParams({
    client_id: required.clientId,
    client_secret: required.clientSecret,
    redirect_uri: required.redirectUri,
    grant_type: 'authorization_code',
    code: boundedRequiredText(input.code, 'OAuth code', 8_192),
    code_verifier: codeVerifier,
    scope: MICROSOFT_MAIL_SCOPES.join(' '),
  })
  return microsoftTokenRequest(required.tenant, body, null, dependencies)
}

export async function refreshMicrosoftMailOAuthToken(
  config: MicrosoftMailOAuthConfig,
  refreshToken: string,
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailOAuthTokenSet> {
  const required = requiredMicrosoftClientConfig(config)
  const previousRefreshToken = boundedRequiredText(refreshToken, 'OAuth refresh token', 32_768)
  const body = new URLSearchParams({
    client_id: required.clientId,
    client_secret: required.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: previousRefreshToken,
    scope: MICROSOFT_MAIL_SCOPES.join(' '),
  })
  return microsoftTokenRequest(required.tenant, body, previousRefreshToken, dependencies)
}

export function microsoftMailTokenIncludesReadAccess(scopes: readonly string[] | null | undefined): boolean {
  const normalized = normalizedScopes(scopes)
  return normalized.has('mail.read') || normalized.has('mail.readwrite')
}

export function microsoftMailTokenIncludesSendAccess(scopes: readonly string[] | null | undefined): boolean {
  return normalizedScopes(scopes).has('mail.send')
}

export function microsoftMailTokenIncludesRequiredAccess(
  scopes: readonly string[] | null | undefined,
): boolean {
  const normalized = normalizedScopes(scopes)
  return normalized.has('user.read')
    && normalized.has('mail.readwrite')
    && normalized.has('mail.send')
}

export async function fetchMicrosoftMailIdentity(
  accessToken: string,
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailIdentity> {
  const query = new URLSearchParams({
    '$select': 'id,displayName,mail,userPrincipalName',
  })
  const profile = await graphJson<{
    id?: string
    displayName?: string
    mail?: string
    userPrincipalName?: string
  }>(
    `${GRAPH_ORIGIN}/v1.0/me?${query}`,
    { headers: graphHeaders(accessToken) },
    'Microsoft profile',
    dependencies,
  )
  const accountId = cleanProviderIdentifier(profile.id, 'Microsoft account ID')
  const email = normalizeEmail(profile.mail || profile.userPrincipalName || '')
  if (!email) {
    throw new MicrosoftMailError(502, 'IDENTITY_EMAIL_MISSING', 'Microsoft returned no mailbox address')
  }
  return {
    accountId,
    email,
    displayName: cleanDisplayText(profile.displayName || email) || email,
  }
}

/** Downloads a Graph fileAttachment as decoded bytes with a hard caller limit. */
export async function fetchMicrosoftMailAttachmentBytes(
  accessToken: string,
  input: MicrosoftMailAttachmentDownloadInput,
  dependencies: MicrosoftMailDependencies = {},
): Promise<Uint8Array> {
  const messageId = cleanCallerProviderIdentifier(input.messageId, 'Microsoft message ID')
  const attachmentId = cleanCallerProviderIdentifier(input.attachmentId, 'Microsoft attachment ID')
  const maxBytes = microsoftReceivedAttachmentMaxBytes(input.maxBytes)
  const query = new URLSearchParams({
    '$select': 'id,name,contentType,size,isInline,contentBytes',
  })
  const attachment = await graphBoundedJson<MicrosoftGraphAttachment>(
    `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}?${query}`,
    { headers: graphHeaders(accessToken, { Prefer: 'IdType="ImmutableId"' }) },
    'Microsoft attachment download',
    dependencies,
    encodedMicrosoftAttachmentBudget(maxBytes) + MICROSOFT_ATTACHMENT_JSON_OVERHEAD_BYTES,
  )

  const attachmentType = cleanConfigText(attachment['@odata.type']).toLowerCase()
  if (attachmentType && attachmentType !== '#microsoft.graph.fileattachment') {
    throw new MicrosoftMailError(
      409,
      'ATTACHMENT_TYPE_UNSUPPORTED',
      'This Microsoft attachment type cannot be downloaded',
    )
  }
  const declaredSize = nonNegativeIntegerOrNull(attachment.size)
  if (declaredSize !== null && declaredSize > maxBytes) {
    throw microsoftReceivedAttachmentTooLarge()
  }
  if (typeof attachment.contentBytes !== 'string') {
    throw new MicrosoftMailError(
      409,
      'ATTACHMENT_CONTENT_UNAVAILABLE',
      'Microsoft attachment content is unavailable',
    )
  }

  const decodedSize = decodedMicrosoftBase64Size(attachment.contentBytes)
  if (decodedSize > maxBytes) throw microsoftReceivedAttachmentTooLarge()
  const bytes = Buffer.from(attachment.contentBytes, 'base64')
  if (bytes.byteLength > maxBytes) throw microsoftReceivedAttachmentTooLarge()
  return new Uint8Array(bytes)
}

export function encodeMicrosoftThreadReference(
  input: MicrosoftMailThreadReference,
  referenceSecret: string,
): string {
  const anchorMessageId = cleanProviderIdentifier(input.anchorMessageId, 'Microsoft message ID')
  const conversationId = input.conversationId === null
    ? null
    : cleanProviderIdentifier(input.conversationId, 'Microsoft conversation ID')
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    p: 'microsoft',
    c: conversationId,
    m: anchorMessageId,
  }), 'utf8')
  const signature = referenceSignature(payload, referenceSecret)
  return Buffer.concat([Buffer.from([1]), signature, payload]).toString('base64url')
}

export function decodeMicrosoftThreadReference(
  value: string,
  referenceSecret: string,
): MicrosoftMailThreadReference {
  if (
    typeof value !== 'string'
    || value.length > MAX_THREAD_REFERENCE_LENGTH
    || !/^[A-Za-z0-9_-]{40,6000}$/u.test(value)
  ) {
    throw new MicrosoftMailError(400, 'THREAD_REFERENCE_INVALID', 'Microsoft thread reference is invalid')
  }
  try {
    const envelope = Buffer.from(value, 'base64url')
    if (envelope.toString('base64url') !== value || envelope.length < 35 || envelope[0] !== 1) {
      throw new Error('invalid thread reference envelope')
    }
    const signature = envelope.subarray(1, 33)
    const payload = envelope.subarray(33)
    const expected = referenceSignature(payload, referenceSecret)
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new Error('invalid thread reference signature')
    }
    const parsed = JSON.parse(
      payload.toString('utf8'),
    ) as Record<string, unknown>
    if (
      parsed.v !== 1
      || parsed.p !== 'microsoft'
      || typeof parsed.m !== 'string'
      || (parsed.c !== null && typeof parsed.c !== 'string')
    ) throw new Error('invalid thread reference')
    return {
      conversationId: parsed.c === null
        ? null
        : cleanProviderIdentifier(parsed.c, 'Microsoft conversation ID'),
      anchorMessageId: cleanProviderIdentifier(parsed.m, 'Microsoft message ID'),
    }
  } catch (error) {
    throw new MicrosoftMailError(
      400,
      'THREAD_REFERENCE_INVALID',
      'Microsoft thread reference is invalid',
      { cause: error },
    )
  }
}

export function sealMicrosoftMailCursor(
  nextLink: string,
  binding: string,
  secret: string,
): string {
  const url = validatedGraphNextLink(nextLink).toString()
  const normalizedBinding = requiredCursorBinding(binding)
  const urlBytes = Buffer.from(url, 'utf8')
  const signature = cursorSignature(urlBytes, normalizedBinding, secret)
  const cursor = Buffer.concat([Buffer.from([1]), signature, urlBytes]).toString('base64url')
  if (cursor.length > MICROSOFT_MAIL_CURSOR_MAX_LENGTH) {
    throw new MicrosoftMailError(
      502,
      'CURSOR_TOO_LARGE',
      'Microsoft returned a pagination cursor that is too large',
    )
  }
  return cursor
}

export function openMicrosoftMailCursor(
  cursor: string,
  binding: string,
  secret: string,
): string {
  if (
    typeof cursor !== 'string'
    || cursor.length > MICROSOFT_MAIL_CURSOR_MAX_LENGTH
    || !/^[A-Za-z0-9_-]{44,4096}$/u.test(cursor)
  ) {
    throw new MicrosoftMailError(400, 'CURSOR_INVALID', 'Microsoft mail cursor is invalid')
  }

  try {
    const envelope = Buffer.from(cursor, 'base64url')
    if (envelope.toString('base64url') !== cursor || envelope.length < 35 || envelope[0] !== 1) {
      throw new Error('invalid cursor envelope')
    }
    const signature = envelope.subarray(1, 33)
    const urlBytes = envelope.subarray(33)
    const expected = cursorSignature(urlBytes, requiredCursorBinding(binding), secret)
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new Error('invalid cursor signature')
    }
    const url = urlBytes.toString('utf8')
    if (!Buffer.from(url, 'utf8').equals(urlBytes)) throw new Error('invalid cursor encoding')
    return validatedGraphNextLink(url).toString()
  } catch (error) {
    if (error instanceof MicrosoftMailError) throw error
    throw new MicrosoftMailError(400, 'CURSOR_INVALID', 'Microsoft mail cursor is invalid', { cause: error })
  }
}

export async function fetchMicrosoftMailFolderSummaries(
  accessToken: string,
  dependencies: MicrosoftMailDependencies = {},
): Promise<MailFolderSummary[]> {
  const requested: Array<{ id: MailFolderId; path: string; label: string }> = [
    { id: 'INBOX', path: 'inbox', label: 'Odebrane' },
    { id: 'SENT', path: 'sentitems', label: 'Wysłane' },
    { id: 'DRAFT', path: 'drafts', label: 'Szkice' },
  ]
  const settled = await Promise.allSettled(requested.map(async (folder) => {
    const query = new URLSearchParams({
      '$select': 'id,totalItemCount,unreadItemCount',
    })
    const result = await graphJson<{
      totalItemCount?: number
      unreadItemCount?: number
    }>(
      `${GRAPH_ORIGIN}/v1.0/me/mailFolders/${folder.path}?${query}`,
      { headers: graphHeaders(accessToken) },
      `Microsoft ${folder.label} folder`,
      dependencies,
    )
    return {
      id: folder.id,
      label: folder.label,
      messagesTotal: nonNegativeIntegerOrNull(result.totalItemCount),
      messagesUnread: nonNegativeIntegerOrNull(result.unreadItemCount),
    } satisfies MailFolderSummary
  }))
  const byId = new Map<MailFolderId, MailFolderSummary>()
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') byId.set(requested[index]!.id, result.value)
  })
  return [
    byId.get('INBOX') ?? emptyFolderSummary('INBOX', 'Odebrane'),
    {
      id: 'STARRED',
      label: 'Oznaczone',
      messagesTotal: null,
      messagesUnread: null,
    },
    byId.get('SENT') ?? emptyFolderSummary('SENT', 'Wysłane'),
    byId.get('DRAFT') ?? emptyFolderSummary('DRAFT', 'Szkice'),
  ]
}

export async function fetchMicrosoftMailThreadPage(
  accessToken: string,
  accountEmail: string,
  options: {
    folder: MailFolderId
    query?: string
    cursor?: string
    referenceSecret: string
    maxResults?: number
    excludeDrafts?: boolean
  },
  dependencies: MicrosoftMailDependencies = {},
): Promise<MailThreadListPayload> {
  const queryText = validateSearchQuery(options.query)
  if (options.folder === 'STARRED' && queryText) {
    throw new MicrosoftMailError(
      400,
      'SEARCH_WITH_FLAG_UNSUPPORTED',
      'Microsoft nie obsługuje jednoczesnego wyszukiwania pełnotekstowego i filtra oznaczonych wiadomości.',
    )
  }
  const binding = pageCursorBinding(options.folder, queryText)
  const url = options.cursor
    ? openMicrosoftMailCursor(options.cursor, binding, options.referenceSecret)
    : microsoftMessageListUrl(options.folder, queryText, options.maxResults)

  const [page, folders] = await Promise.all([
    graphJson<MicrosoftGraphCollection<MicrosoftGraphMessage>>(
      url,
      {
        headers: graphHeaders(accessToken, {
          Prefer: 'IdType="ImmutableId"',
        }),
      },
      'Microsoft message list',
      dependencies,
    ),
    fetchMicrosoftMailFolderSummaries(accessToken, dependencies),
  ])
  const messages = (page.value ?? []).filter(hasMicrosoftMessageId)
  const data = microsoftThreadSummaries(
    options.excludeDrafts ? messages.filter(message => message.isDraft !== true) : messages,
    accountEmail,
    options.referenceSecret,
  )
  const nextLink = cleanConfigText(page['@odata.nextLink'])
  return {
    data,
    folders,
    nextPageToken: nextLink
      ? sealMicrosoftMailCursor(nextLink, binding, options.referenceSecret)
      : null,
    resultSizeEstimate: nonNegativeIntegerOrNull(page['@odata.count']) ?? data.length,
    partialFailureCount: 0,
    providerMessageCountOnPage: messages.length,
  }
}

export async function fetchMicrosoftMailThread(
  accessToken: string,
  accountEmail: string,
  threadReference: string,
  options: MicrosoftMailThreadWindowOptions,
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailThreadDetail> {
  const reference = decodeMicrosoftThreadReference(threadReference, options.referenceSecret)
  const conversation = await fetchMicrosoftConversationWindow(
    accessToken,
    reference,
    threadReference,
    GRAPH_DETAIL_FIELDS,
    options,
    dependencies,
  )
  const messages = conversation.messages
  if (!messages.length) {
    throw new MicrosoftMailError(404, 'THREAD_NOT_FOUND', 'Microsoft mail thread was not found')
  }
  const sorted = sortMicrosoftMessages(messages)
  const attachmentsByMessage = new Map<string, MailAttachment[]>()
  await mapWithConcurrency(
    sorted.filter(message => Boolean(message.hasAttachments)),
    3,
    async (message) => {
      attachmentsByMessage.set(
        String(message.id),
        await fetchMicrosoftMessageAttachments(accessToken, String(message.id), dependencies),
      )
    },
  )

  let remainingCharacters = MAX_THREAD_BODY_CHARACTERS
  const details = sorted.map(message => microsoftMessageDetail(
    message,
    attachmentsByMessage.get(String(message.id)) ?? [],
  ))
  // Preserve the newest content when the whole conversation exceeds the UI
  // budget; older quoted history is less useful than the current decision.
  for (let index = details.length - 1; index >= 0; index -= 1) {
    const detail = details[index]!
    if (detail.bodyText.length <= remainingCharacters) {
      remainingCharacters -= detail.bodyText.length
      continue
    }
    details[index] = {
      ...detail,
      bodyText: detail.bodyText.slice(0, remainingCharacters).trimEnd(),
      bodyTruncated: true,
    }
    remainingCharacters = 0
  }
  let remainingHtmlCharacters = MAX_THREAD_HTML_CHARACTERS
  for (let index = details.length - 1; index >= 0; index -= 1) {
    const detail = details[index]!
    if (!detail.bodyHtml) continue
    if (detail.bodyHtml.length <= remainingHtmlCharacters) {
      remainingHtmlCharacters -= detail.bodyHtml.length
      continue
    }
    details[index] = {
      ...detail,
      bodyHtml: null,
      bodyHtmlTruncated: true,
    }
    remainingHtmlCharacters = 0
  }
  const latest = sorted.at(-1)!
  return {
    id: threadReference,
    subject: cleanDisplayText(latest.subject || details.at(-1)?.subject || '') || '(bez tematu)',
    messages: details,
    messageWindowStart: conversation.windowStart,
    newerMessageCount: conversation.newerMessageCount,
    providerMessageCount: conversation.totalCount,
    nextPageToken: conversation.nextPageToken,
    omittedMessageCount: conversation.windowStart,
    externalUrl: safeMicrosoftWebLink(latest.webLink),
  }
}

export async function fetchMicrosoftMailMessageDetail(
  accessToken: string,
  messageId: string,
  threadReference: string,
  options: MicrosoftMailReferenceOptions,
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailMessageDetail> {
  const reference = decodeMicrosoftThreadReference(threadReference, options.referenceSecret)
  const query = new URLSearchParams({ '$select': GRAPH_DETAIL_FIELDS.join(',') })
  const message = await graphJson<MicrosoftGraphMessage>(
    `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(messageId)}?${query}`,
    {
      headers: graphHeaders(accessToken, {
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"',
      }),
    },
    'Microsoft message detail',
    dependencies,
  )
  const actualMessageId = cleanProviderIdentifier(message.id, 'Microsoft message ID')
  const actualConversationId = cleanOptionalProviderIdentifier(message.conversationId)
  if (
    actualMessageId !== messageId
    || (reference.conversationId
      ? actualConversationId !== reference.conversationId
      : actualMessageId !== reference.anchorMessageId)
  ) {
    throw new MicrosoftMailError(409, 'MESSAGE_THREAD_MISMATCH', 'Microsoft message no longer belongs to this thread')
  }
  const attachments = message.hasAttachments
    ? await fetchMicrosoftMessageAttachments(accessToken, actualMessageId, dependencies)
    : []
  return microsoftMessageDetail(message, attachments)
}

export async function fetchMicrosoftMailReplyContext(
  accessToken: string,
  accountEmail: string,
  threadReference: string,
  options: MicrosoftMailReferenceOptions,
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailReplyContext> {
  const reference = decodeMicrosoftThreadReference(threadReference, options.referenceSecret)
  const fields = [
    'id',
    'conversationId',
    'subject',
    'from',
    'replyTo',
    'receivedDateTime',
    'sentDateTime',
    'createdDateTime',
    'lastModifiedDateTime',
  ] as const
  const messages = sortMicrosoftMessages(await fetchMicrosoftConversationMessages(
    accessToken,
    reference,
    fields,
    dependencies,
  ))
  const normalizedAccount = normalizeEmail(accountEmail)
  const target = [...messages].reverse().find((message) => {
    const from = microsoftAddress(message.from)?.email
    return Boolean(from && from !== normalizedAccount)
  })
  if (!target?.id) {
    throw new MicrosoftMailError(
      409,
      'REPLY_TARGET_MISSING',
      'Ten wątek Microsoft nie zawiera wiadomości, na którą można odpowiedzieć.',
    )
  }
  const recipients = microsoftAddresses(target.replyTo)
  const fallback = microsoftAddress(target.from)
  if (!recipients.length && fallback) recipients.push(fallback)
  return {
    messageId: target.id,
    threadId: encodeMicrosoftThreadReference({
      conversationId: cleanOptionalProviderIdentifier(target.conversationId),
      anchorMessageId: target.id,
    }, options.referenceSecret),
    subject: cleanDisplayText(target.subject || '') || '(bez tematu)',
    recipients,
  }
}

export async function sendMicrosoftMailMessage(
  accessToken: string,
  input: MicrosoftMailSendInput,
  options: MicrosoftMailSendOptions,
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailSendResult> {
  const normalized = validateSendInput(input)
  let replyToMessageId: string | null = null
  if (normalized.threadId) {
    const accountEmail = normalizeEmail(options.accountEmail || '')
    if (!accountEmail) {
      throw new MicrosoftMailError(
        500,
        'ACCOUNT_EMAIL_REQUIRED',
        'Microsoft account email is required to send a reply',
      )
    }
    replyToMessageId = (await fetchMicrosoftMailReplyContext(
      accessToken,
      accountEmail,
      normalized.threadId,
      options,
      dependencies,
    )).messageId
  }
  let draft: MicrosoftGraphMessage | null = null
  try {
    if (replyToMessageId) {
      draft = await graphJson<MicrosoftGraphMessage>(
        `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(replyToMessageId)}/createReply`,
        {
          method: 'POST',
          headers: graphHeaders(accessToken, {
            'content-type': 'application/json',
            Prefer: 'IdType="ImmutableId"',
          }),
          body: '{}',
        },
        'Microsoft reply draft creation',
        dependencies,
      )
    }
    else {
      draft = await graphJson<MicrosoftGraphMessage>(
        `${GRAPH_ORIGIN}/v1.0/me/messages`,
        {
          method: 'POST',
          headers: graphHeaders(accessToken, {
            'content-type': 'application/json',
            Prefer: 'IdType="ImmutableId"',
          }),
          body: JSON.stringify(microsoftDraftPayload(normalized, false)),
        },
        'Microsoft draft creation',
        dependencies,
      )
    }

    const draftId = cleanProviderIdentifier(draft.id, 'Microsoft draft ID')
    const conversationId = cleanOptionalProviderIdentifier(draft.conversationId)
    const draftResult: MicrosoftMailSendResult = {
      id: draftId,
      threadId: encodeMicrosoftThreadReference({
        conversationId,
        anchorMessageId: draftId,
      }, options.referenceSecret),
    }
    await options.onDraftCreated?.(draftResult)

    if (replyToMessageId) {
      const updated = await graphJson<MicrosoftGraphMessage>(
        `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(draftId)}`,
        {
          method: 'PATCH',
          headers: graphHeaders(accessToken, {
            'content-type': 'application/json',
            Prefer: 'IdType="ImmutableId"',
          }),
          body: JSON.stringify(microsoftDraftPayload(normalized, true)),
        },
        'Microsoft reply draft update',
        dependencies,
      )
      draft = { ...draft, ...updated }
    }

    for (const attachment of normalized.attachments) {
      await attachMicrosoftDraftFile(accessToken, draftId, attachment, dependencies)
    }

    await graphNoContent(
      `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(draftId)}/send`,
      {
        method: 'POST',
        headers: graphHeaders(accessToken, {
          'content-length': '0',
          Prefer: 'IdType="ImmutableId"',
        }),
      },
      'Microsoft draft send',
      dependencies,
      true,
    )
    return draftResult
  }
  catch (error) {
    const ambiguous = error instanceof MicrosoftMailError && error.deliveryAmbiguous
    // Once the caller opts into durable draft persistence, keep the immutable
    // provider object on every failure: the callback may have committed even
    // when its response was lost, and recovery must still be able to find it.
    if (draft?.id && !ambiguous && !options.onDraftCreated) {
      await deleteMicrosoftDraftBestEffort(accessToken, String(draft.id), dependencies)
    }
    throw error
  }
}

export async function findMicrosoftSentMessage(
  accessToken: string,
  messageId: string,
  options: MicrosoftMailReferenceOptions & {
    accountEmail?: string
    providerMessageId?: string
  },
  dependencies: MicrosoftMailDependencies = {},
): Promise<MicrosoftMailMessageLookup | null> {
  const internetMessageId = validateInternetMessageId(messageId)
  if (options.providerMessageId) {
    const providerMessageId = cleanCallerProviderIdentifier(
      options.providerMessageId,
      'Microsoft provider message ID',
    )
    const select = new URLSearchParams({
      '$select': 'id,conversationId,isDraft',
    })
    try {
      const stored = await graphJson<MicrosoftGraphMessage>(
        `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(providerMessageId)}?${select}`,
        { headers: graphHeaders(accessToken, { Prefer: 'IdType="ImmutableId"' }) },
        'Microsoft persisted message lookup',
        dependencies,
      )
      if (stored.isDraft !== false) return null
      const id = cleanProviderIdentifier(stored.id, 'Microsoft sent message ID')
      return microsoftMessageLookup(id, stored.conversationId, options.referenceSecret)
    }
    catch (error) {
      if (!(error instanceof MicrosoftMailError) || error.statusCode !== 404) throw error
      // A legacy/non-immutable ID can disappear after the Drafts -> Sent move.
      // Fall back to the deterministic RFC Message-ID in that case only.
    }
  }
  const query = new URLSearchParams({
    '$filter': `internetMessageId eq '${escapeODataString(internetMessageId)}'`,
    '$select': 'id,conversationId,internetMessageId,isDraft,from,sentDateTime,createdDateTime,lastModifiedDateTime',
    '$top': '10',
  })
  const result = await graphJson<MicrosoftGraphCollection<MicrosoftGraphMessage>>(
    `${GRAPH_ORIGIN}/v1.0/me/messages?${query}`,
    { headers: graphHeaders(accessToken, { Prefer: 'IdType="ImmutableId"' }) },
    'Microsoft sent message lookup',
    dependencies,
  )
  const normalizedAccount = normalizeEmail(options.accountEmail || '')
  const candidates = sortMicrosoftMessages((result.value ?? []).filter((message) => {
    if (!message.id || message.internetMessageId !== internetMessageId) return false
    if (!normalizedAccount) return true
    return microsoftAddress(message.from)?.email === normalizedAccount
  }))
  const message = candidates.filter(candidate => candidate.isDraft === false).at(-1)
  if (!message?.id) return null
  return microsoftMessageLookup(message.id, message.conversationId, options.referenceSecret)
}

function microsoftMessageLookup(
  messageId: string,
  conversationIdValue: unknown,
  referenceSecret: string,
): MicrosoftMailMessageLookup {
  const conversationId = cleanOptionalProviderIdentifier(conversationIdValue)
  return {
    id: messageId,
    threadId: encodeMicrosoftThreadReference({
      conversationId,
      anchorMessageId: messageId,
    }, referenceSecret),
  }
}

export function microsoftMessageSecurity(message: MicrosoftGraphMessage): MailMessageSecurity {
  // Graph exposes RFC 5322 headers and may also return custom headers supplied
  // by an application. It does not identify which Authentication-Results
  // instance was stamped at Microsoft's trusted transport boundary, and
  // Microsoft's documented header examples do not expose a stable authserv-id.
  // Treating any matching text as authoritative would let a sender forge
  // `dmarc=pass`, so Graph authentication deliberately fails closed.
  // https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0
  const authentication = 'unknown' as const
  const fromDomain = addressDomain(microsoftAddress(message.from)?.email)
  const replyDomains = microsoftAddresses(message.replyTo)
    .map(address => addressDomain(address.email))
    .filter(Boolean)
  return {
    authentication,
    replyToMismatch: Boolean(
      fromDomain
      && replyDomains.length
      && replyDomains.some(domain => domain !== fromDomain),
    ),
  }
}

interface MicrosoftGraphCollection<T> {
  value?: T[]
  '@odata.nextLink'?: string
  '@odata.count'?: number
}

interface NormalizedSendInput {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  text: string
  messageId: string
  threadId: string | null
  attachments: MicrosoftMailSendAttachment[]
}

function requiredMicrosoftConfig(
  config: MicrosoftMailOAuthConfig,
  redirectUriOverride?: string,
): {
  clientId: string
  clientSecret: string
  redirectUri: string
  tenant: string
} {
  const client = requiredMicrosoftClientConfig(config)
  const redirectUri = cleanConfigText(redirectUriOverride || config.redirectUri)
  if (!redirectUri) {
    throw new MicrosoftMailError(503, 'OAUTH_NOT_CONFIGURED', 'Microsoft mail OAuth is not configured')
  }
  let parsedRedirect: URL
  try {
    parsedRedirect = new URL(redirectUri)
  } catch {
    throw new MicrosoftMailError(500, 'OAUTH_REDIRECT_INVALID', 'Microsoft OAuth redirect URI is invalid')
  }
  if (
    parsedRedirect.username
    || parsedRedirect.password
    || parsedRedirect.hash
    || !(
      parsedRedirect.protocol === 'https:'
      || (parsedRedirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsedRedirect.hostname))
    )
  ) {
    throw new MicrosoftMailError(500, 'OAUTH_REDIRECT_INVALID', 'Microsoft OAuth redirect URI is invalid')
  }
  return {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    redirectUri: parsedRedirect.toString(),
    tenant: client.tenant,
  }
}

function requiredMicrosoftClientConfig(config: MicrosoftMailOAuthConfig): {
  clientId: string
  clientSecret: string
  tenant: string
} {
  const clientId = cleanConfigText(config.clientId)
  const clientSecret = cleanConfigText(config.clientSecret)
  if (!clientId || !clientSecret) {
    throw new MicrosoftMailError(503, 'OAUTH_NOT_CONFIGURED', 'Microsoft mail OAuth is not configured')
  }
  return {
    clientId,
    clientSecret,
    tenant: cleanConfigText(config.tenant) || 'common',
  }
}

function microsoftIdentityOrigin(tenant: string): string {
  if (!/^[A-Za-z0-9.-]{1,253}$/u.test(tenant)) {
    throw new MicrosoftMailError(500, 'OAUTH_TENANT_INVALID', 'Microsoft OAuth tenant is invalid')
  }
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant)}`
}

async function microsoftTokenRequest(
  tenant: string,
  body: URLSearchParams,
  previousRefreshToken: string | null,
  dependencies: MicrosoftMailDependencies,
): Promise<MicrosoftMailOAuthTokenSet> {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  let response: Response
  try {
    response = await fetchImpl(`${microsoftIdentityOrigin(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new MicrosoftMailError(502, 'OAUTH_NETWORK_ERROR', 'Microsoft OAuth could not be reached', { cause: error })
  }
  const token = await response.json().catch(() => ({})) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
  }
  if (!response.ok || !token.access_token) {
    const providerCode = cleanConfigText(token.error)
    const reconnect = ['invalid_grant', 'interaction_required', 'consent_required', 'login_required']
      .includes(providerCode)
    throw new MicrosoftMailError(
      reconnect ? 409 : response.status === 429 ? 429 : 502,
      reconnect ? 'OAUTH_RECONNECT_REQUIRED' : 'OAUTH_TOKEN_ERROR',
      reconnect
        ? 'Microsoft authorization expired; reconnect the mailbox'
        : `Microsoft OAuth token request failed with HTTP ${response.status}`,
    )
  }
  const expiresIn = Number(token.expires_in)
  const now = dependencies.now?.() ?? Date.now()
  const returnedScopes = String(token.scope || '')
    .split(/\s+/u)
    .map(canonicalMicrosoftScope)
    .filter(Boolean)
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || previousRefreshToken,
    expiresAt: Number.isFinite(expiresIn)
      ? new Date(now + Math.max(0, expiresIn - 60) * 1_000).toISOString()
      : null,
    // Microsoft documents `scope` as optional: omission means the access
    // token has the scopes requested in the authorization/token request.
    scopes: returnedScopes.length
      ? returnedScopes
      : MICROSOFT_MAIL_SCOPES.map(canonicalMicrosoftScope),
  }
}

function microsoftMessageListUrl(
  folder: MailFolderId,
  search: string,
  requestedMaxResults: number | undefined,
): string {
  const maxResults = Math.min(
    MAX_LIST_RESULTS,
    Math.max(1, Math.trunc(requestedMaxResults ?? 20)),
  )
  const path = folder === 'STARRED'
    || folder === 'ALL'
    ? '/v1.0/me/messages'
    : `/v1.0/me/mailFolders/${MICROSOFT_FOLDER_PATH[folder]}/messages`
  if (folder !== 'STARRED' && folder !== 'ALL' && !MICROSOFT_FOLDER_PATH[folder]) {
    throw new MicrosoftMailError(400, 'FOLDER_INVALID', 'Microsoft mail folder is invalid')
  }
  const query = new URLSearchParams({
    '$select': GRAPH_LIST_FIELDS.join(','),
    '$top': String(maxResults),
  })
  if (search) {
    query.set('$search', `"${escapeKqlPhrase(search)}"`)
  }
  else if (folder === 'STARRED') {
    query.set('$filter', "flag/flagStatus eq 'flagged'")
  }
  else {
    query.set('$orderby', folder === 'ALL'
      ? 'createdDateTime desc'
      : folder === 'SENT'
      ? 'sentDateTime desc'
      : folder === 'DRAFT'
        ? 'lastModifiedDateTime desc'
        : 'receivedDateTime desc')
  }
  return `${GRAPH_ORIGIN}${path}?${query}`
}

function microsoftThreadSummaries(
  messages: MicrosoftGraphMessage[],
  accountEmail: string,
  referenceSecret: string,
): MailThreadSummary[] {
  // Graph pages messages, not conversations. Grouping is intentionally local
  // to this page; carrying every previously seen conversation in a cursor
  // would make the signed cursor unbounded and still could not guarantee a
  // stable mailbox-wide grouping while new mail arrives.
  const groups = new Map<string, MicrosoftGraphMessage[]>()
  for (const message of messages) {
    const key = cleanOptionalProviderIdentifier(message.conversationId) || `message:${message.id}`
    const group = groups.get(key) ?? []
    group.push(message)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(group => microsoftThreadSummary(group, accountEmail, referenceSecret))
    .sort((left, right) => String(right.latestAt || '').localeCompare(String(left.latestAt || '')))
}

function microsoftThreadSummary(
  input: MicrosoftGraphMessage[],
  accountEmail: string,
  referenceSecret: string,
): MailThreadSummary {
  const messages = sortMicrosoftMessages(input)
  const latest = messages.at(-1)!
  const participants = microsoftThreadParticipants(messages, accountEmail)
  return withMailThreadBlindParticipants({
    id: encodeMicrosoftThreadReference({
      conversationId: cleanOptionalProviderIdentifier(latest.conversationId),
      anchorMessageId: cleanProviderIdentifier(latest.id, 'Microsoft message ID'),
    }, referenceSecret),
    latestMessageId: cleanProviderIdentifier(latest.id, 'Microsoft message ID'),
    messageCount: messages.length,
    participants,
    participantsLabel: participantLabel(participants),
    subject: cleanDisplayText(latest.subject || messages[0]?.subject || '') || '(bez tematu)',
    snippet: normalizeSnippet(latest.bodyPreview || ''),
    latestAt: microsoftMessageDate(latest),
    unread: messages.some(message => message.isRead === false),
    starred: messages.some(message => String(message.flag?.flagStatus || '').toLowerCase() === 'flagged'),
    important: messages.some(message => String(message.importance || '').toLowerCase() === 'high'),
    draft: messages.some(message => Boolean(message.isDraft)),
    hasAttachments: messages.some(message => Boolean(message.hasAttachments)),
  }, microsoftThreadBlindParticipants(messages, accountEmail))
}

function microsoftMessageDetail(
  message: MicrosoftGraphMessage,
  attachments: MailAttachment[],
): MicrosoftMailMessageDetail {
  const providerBody = String(message.body?.content || message.bodyPreview || '')
  const providerBodyIsHtml = String(message.body?.contentType || '').toLowerCase() === 'html'
  const sanitizedHtml = providerBodyIsHtml
    ? sanitizeMailHtml(providerBody)
    : { html: null, hasRemoteImages: false, truncated: false }
  const rawBodyLimit = MAX_MESSAGE_BODY_CHARACTERS * 4
  const rawBody = providerBody.slice(0, rawBodyLimit)
  const normalizedBody = providerBodyIsHtml
    ? htmlToText(sanitizedHtml.html || rawBody)
    : normalizeBody(rawBody)
  const bodyTruncated = providerBody.length > rawBodyLimit
    || normalizedBody.length > MAX_MESSAGE_BODY_CHARACTERS
  return withMailMessageDraftState(withMailMessageBlindRecipients({
    id: cleanProviderIdentifier(message.id, 'Microsoft message ID'),
    from: microsoftAddress(message.from),
    replyTo: microsoftAddresses(message.replyTo),
    to: microsoftAddresses(message.toRecipients),
    cc: microsoftAddresses(message.ccRecipients),
    subject: cleanDisplayText(message.subject || '') || '(bez tematu)',
    sentAt: microsoftMessageDate(message),
    unread: message.isRead === false,
    bodyText: bodyTruncated
      ? normalizedBody.slice(0, MAX_MESSAGE_BODY_CHARACTERS).trimEnd()
      : normalizedBody,
    bodyHtml: sanitizedHtml.html,
    bodyHtmlTruncated: sanitizedHtml.truncated,
    hasRemoteImages: sanitizedHtml.hasRemoteImages,
    bodyTruncated,
    attachments,
    security: microsoftMessageSecurity(message),
    internetMessageId: cleanOptionalInternetMessageId(message.internetMessageId),
    headers: microsoftDisplayHeaders(message.internetMessageHeaders),
    webLink: optionalSafeMicrosoftWebLink(message.webLink),
  }, microsoftAddresses(message.bccRecipients)), message.isDraft === true)
}

/**
 * Loads only the newest detail window. Microsoft recommends keeping `$select`
 * and `$top` small for message bodies; combining `$filter` and `$orderby`
 * additionally requires the ordered property to appear first in `$filter`.
 *
 * @see https://learn.microsoft.com/en-us/graph/api/user-list-messages?view=graph-rest-1.0
 */
async function fetchMicrosoftConversationWindow(
  accessToken: string,
  reference: MicrosoftMailThreadReference,
  threadReference: string,
  fields: readonly string[],
  options: MicrosoftMailThreadWindowOptions,
  dependencies: MicrosoftMailDependencies,
): Promise<{
  messages: MicrosoftGraphMessage[]
  totalCount: number
  newerMessageCount: number
  windowStart: number
  nextPageToken: string | null
}> {
  const maxMessages = Math.min(
    MAX_THREAD_MESSAGES,
    Math.max(1, Math.trunc(options.maxMessages ?? MAX_THREAD_MESSAGES)),
  )
  if (!reference.conversationId) {
    if (options.cursor || options.newerMessageCount || options.providerMessageCount) {
      throw new MicrosoftMailError(409, 'THREAD_WINDOW_STALE', 'Microsoft thread continuation is stale')
    }
    const query = new URLSearchParams({ '$select': fields.join(',') })
    const message = await graphJson<MicrosoftGraphMessage>(
      `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(reference.anchorMessageId)}?${query}`,
      {
        headers: graphHeaders(accessToken, {
          Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"',
        }),
      },
      'Microsoft message',
      dependencies,
    )
    return {
      messages: message.id ? [message] : [],
      totalCount: message.id ? 1 : 0,
      newerMessageCount: 0,
      windowStart: 0,
      nextPageToken: null,
    }
  }

  // v2 requires `isDraft` (and the hidden BCC boundary) on every page. Reject
  // older sealed nextLinks whose `$select` predates those fail-closed fields.
  const binding = `microsoft-mail-thread-window-v2\0${createHash('sha256').update(threadReference).digest('hex')}`
  const url = options.cursor
    ? openMicrosoftMailCursor(options.cursor, binding, options.referenceSecret)
    : (() => {
        const query = new URLSearchParams({
          // `createdDateTime` exists for received, sent, and draft messages.
          '$filter': `createdDateTime ge 1900-01-01T00:00:00Z and conversationId eq '${escapeODataString(reference.conversationId!)}'`,
          '$orderby': 'createdDateTime desc',
          '$select': fields.join(','),
          '$top': String(maxMessages),
          '$count': 'true',
        })
        return `${GRAPH_ORIGIN}/v1.0/me/messages?${query}`
      })()
  const page = await graphJson<MicrosoftGraphCollection<MicrosoftGraphMessage>>(
    url,
    {
      headers: graphHeaders(accessToken, {
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"',
      }),
    },
    'Microsoft conversation detail',
    dependencies,
  )
  const messages = (page.value ?? []).filter(hasMicrosoftMessageId)
  if (messages.length > maxMessages) {
    throw new MicrosoftMailError(502, 'GRAPH_WINDOW_TOO_LARGE', 'Microsoft returned too many conversation messages')
  }
  const reportedTotalCount = nonNegativeIntegerOrNull(page['@odata.count'])
  const expectedTotalCount = options.providerMessageCount
  if (reportedTotalCount === null && expectedTotalCount === undefined) {
    // The UI type requires an exact omitted count. Returning zero when Graph
    // supplied a next page would under-report older mail, so fail closed.
    throw new MicrosoftMailError(
      502,
      'GRAPH_COUNT_MISSING',
      'Microsoft returned no conversation message count',
    )
  }
  const totalCount = expectedTotalCount ?? reportedTotalCount!
  if (
    totalCount > 100_000
    || (reportedTotalCount !== null && reportedTotalCount !== totalCount)
  ) {
    throw new MicrosoftMailError(409, 'THREAD_WINDOW_STALE', 'Microsoft thread changed during continuation')
  }
  const newerMessageCount = Math.max(0, Math.trunc(options.newerMessageCount ?? 0))
  const windowStart = totalCount - newerMessageCount - messages.length
  if (windowStart < 0) {
    throw new MicrosoftMailError(409, 'THREAD_WINDOW_STALE', 'Microsoft thread continuation is stale')
  }
  const nextLink = cleanConfigText(page['@odata.nextLink'])
  if (windowStart > 0 && messages.length === 0) {
    throw new MicrosoftMailError(
      502,
      'GRAPH_WINDOW_INCOMPLETE',
      'Microsoft returned an empty conversation window before the end of the thread',
    )
  }
  if ((windowStart > 0) !== Boolean(nextLink)) {
    throw new MicrosoftMailError(502, 'GRAPH_WINDOW_INCOMPLETE', 'Microsoft returned an incomplete conversation window')
  }
  return {
    messages,
    totalCount,
    newerMessageCount,
    windowStart,
    nextPageToken: nextLink
      ? sealMicrosoftMailCursor(nextLink, binding, options.referenceSecret)
      : null,
  }
}

async function fetchMicrosoftConversationMessages(
  accessToken: string,
  reference: MicrosoftMailThreadReference,
  fields: readonly string[],
  dependencies: MicrosoftMailDependencies,
): Promise<MicrosoftGraphMessage[]> {
  if (!reference.conversationId) {
    const query = new URLSearchParams({ '$select': fields.join(',') })
    const message = await graphJson<MicrosoftGraphMessage>(
      `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(reference.anchorMessageId)}?${query}`,
      {
        headers: graphHeaders(accessToken, {
          Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"',
        }),
      },
      'Microsoft message',
      dependencies,
    )
    return message.id ? [message] : []
  }

  const query = new URLSearchParams({
    '$filter': `createdDateTime ge 1900-01-01T00:00:00Z and conversationId eq '${escapeODataString(reference.conversationId)}'`,
    '$orderby': 'createdDateTime desc',
    '$select': fields.join(','),
    '$top': '100',
  })
  let url: string | null = `${GRAPH_ORIGIN}/v1.0/me/messages?${query}`
  const messages: MicrosoftGraphMessage[] = []
  while (url && messages.length < MAX_CONVERSATION_MESSAGES) {
    const page: MicrosoftGraphCollection<MicrosoftGraphMessage> = await graphJson(
      url,
      {
        headers: graphHeaders(accessToken, {
          Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"',
        }),
      },
      'Microsoft conversation',
      dependencies,
    )
    messages.push(...(page.value ?? []).filter(hasMicrosoftMessageId))
    const nextLink = cleanConfigText(page['@odata.nextLink'])
    url = nextLink ? validatedGraphNextLink(nextLink).toString() : null
  }
  return messages.slice(0, MAX_CONVERSATION_MESSAGES)
}

async function fetchMicrosoftMessageAttachments(
  accessToken: string,
  messageId: string,
  dependencies: MicrosoftMailDependencies,
): Promise<MailAttachment[]> {
  const query = new URLSearchParams({
    '$select': 'id,name,contentType,size,isInline',
    '$top': '100',
  })
  let url: string | null = `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(messageId)}/attachments?${query}`
  const attachments: MailAttachment[] = []
  while (url && attachments.length < 100) {
    const page: MicrosoftGraphCollection<MicrosoftGraphAttachment> = await graphJson(
      url,
      { headers: graphHeaders(accessToken, { Prefer: 'IdType="ImmutableId"' }) },
      'Microsoft attachment metadata',
      dependencies,
    )
    for (const attachment of page.value ?? []) {
      if (attachment.isInline) continue
      const filename = cleanDisplayText(attachment.name || '') || 'załącznik'
      attachments.push({
        id: cleanConfigText(attachment.id) || null,
        filename,
        mimeType: safeMimeType(attachment.contentType),
        size: nonNegativeIntegerOrNull(attachment.size) ?? 0,
      })
      if (attachments.length >= 100) break
    }
    const nextLink = cleanConfigText(page['@odata.nextLink'])
    url = nextLink ? validatedGraphNextLink(nextLink).toString() : null
  }
  return attachments
}

function microsoftDraftPayload(input: NormalizedSendInput, reply: boolean): Record<string, unknown> {
  return {
    ...(!reply ? { subject: input.subject } : {}),
    body: { contentType: 'Text', content: input.text },
    toRecipients: input.to.map(graphRecipient),
    ccRecipients: input.cc.map(graphRecipient),
    bccRecipients: input.bcc.map(graphRecipient),
    internetMessageId: input.messageId,
    ...(!reply ? {
      internetMessageHeaders: [{
        name: 'x-openexpert-idempotency-key',
        value: input.messageId,
      }],
    } : {}),
  }
}

async function attachMicrosoftDraftFile(
  accessToken: string,
  draftId: string,
  attachment: MicrosoftMailSendAttachment,
  dependencies: MicrosoftMailDependencies,
): Promise<void> {
  if (attachment.data.byteLength < MICROSOFT_SIMPLE_ATTACHMENT_LIMIT_BYTES) {
    await graphJson<MicrosoftGraphAttachment>(
      `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(draftId)}/attachments`,
      {
        method: 'POST',
        headers: graphHeaders(accessToken, { 'content-type': 'application/json' }),
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachment.filename,
          contentType: attachment.mimeType,
          contentBytes: Buffer.from(attachment.data).toString('base64'),
        }),
      },
      'Microsoft attachment creation',
      dependencies,
    )
    return
  }

  const session = await graphJson<{ uploadUrl?: string }>(
    `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(draftId)}/attachments/createUploadSession`,
    {
      method: 'POST',
      headers: graphHeaders(accessToken, { 'content-type': 'application/json' }),
      body: JSON.stringify({
        AttachmentItem: {
          attachmentType: 'file',
          name: attachment.filename,
          size: attachment.data.byteLength,
          contentType: attachment.mimeType,
        },
      }),
    },
    'Microsoft attachment upload session',
    dependencies,
  )
  const uploadUrl = validatedOutlookUploadUrl(session.uploadUrl)
  for (let offset = 0; offset < attachment.data.byteLength; offset += MICROSOFT_UPLOAD_CHUNK_BYTES) {
    const endExclusive = Math.min(
      attachment.data.byteLength,
      offset + MICROSOFT_UPLOAD_CHUNK_BYTES,
    )
    const chunk = attachment.data.slice(offset, endExclusive)
    await externalUploadRequest(
      uploadUrl,
      {
        method: 'PUT',
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(chunk.byteLength),
          'content-range': `bytes ${offset}-${endExclusive - 1}/${attachment.data.byteLength}`,
        },
        body: chunk as unknown as BodyInit,
      },
      dependencies,
    )
  }
}

async function deleteMicrosoftDraftBestEffort(
  accessToken: string,
  draftId: string,
  dependencies: MicrosoftMailDependencies,
): Promise<void> {
  try {
    await graphNoContent(
      `${GRAPH_ORIGIN}/v1.0/me/messages/${encodeURIComponent(draftId)}`,
      { method: 'DELETE', headers: graphHeaders(accessToken) },
      'Microsoft draft cleanup',
      dependencies,
      false,
    )
  }
  catch {
    // A failed local operation must preserve the original provider error.
  }
}

async function graphJson<T>(
  url: string,
  init: RequestInit,
  operation: string,
  dependencies: MicrosoftMailDependencies,
): Promise<T> {
  const response = await graphResponse(url, init, operation, dependencies)
  try {
    return await response.json() as T
  }
  catch (error) {
    throw new MicrosoftMailError(
      502,
      'GRAPH_INVALID_RESPONSE',
      `${operation} returned an invalid response`,
      { cause: error },
    )
  }
}

async function graphBoundedJson<T>(
  url: string,
  init: RequestInit,
  operation: string,
  dependencies: MicrosoftMailDependencies,
  maxResponseBytes: number,
): Promise<T> {
  const response = await graphResponse(url, init, operation, dependencies)
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    await response.body?.cancel().catch(() => {})
    throw microsoftReceivedAttachmentTooLarge()
  }

  const bytes = await readBoundedGraphResponse(response, maxResponseBytes)
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as T
  }
  catch (error) {
    throw new MicrosoftMailError(
      502,
      'GRAPH_INVALID_RESPONSE',
      `${operation} returned an invalid response`,
      { cause: error },
    )
  }
}

async function readBoundedGraphResponse(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw microsoftReceivedAttachmentTooLarge()
      }
      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function graphNoContent(
  url: string,
  init: RequestInit,
  operation: string,
  dependencies: MicrosoftMailDependencies,
  deliveryAmbiguous: boolean,
): Promise<void> {
  try {
    await graphResponse(url, init, operation, dependencies)
  }
  catch (error) {
    if (
      deliveryAmbiguous
      && error instanceof MicrosoftMailError
      && (error.code === 'GRAPH_NETWORK_ERROR' || error.statusCode >= 500)
    ) {
      throw new MicrosoftMailError(
        error.statusCode,
        error.code,
        'Nie udało się potwierdzić wysyłki Microsoft. Sprawdź folder Wysłane przed ponowieniem.',
        { cause: error, deliveryAmbiguous: true },
      )
    }
    throw error
  }
}

async function graphResponse(
  rawUrl: string,
  init: RequestInit,
  operation: string,
  dependencies: MicrosoftMailDependencies,
): Promise<Response> {
  const url = validatedGraphUrl(rawUrl).toString()
  const method = String(init.method ?? 'GET').toUpperCase()
  const maxAttempts = ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'].includes(method) ? 3 : 1
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(20_000),
      })
    }
    catch (error) {
      if (attempt + 1 < maxAttempts) {
        await waitForRetry(attempt, null, dependencies)
        continue
      }
      throw new MicrosoftMailError(
        502,
        'GRAPH_NETWORK_ERROR',
        `${operation} could not reach Microsoft Graph`,
        { cause: error },
      )
    }
    if (response.ok) return response
    const payload = await response.json().catch(() => ({})) as {
      error?: { code?: string }
    }
    const retryable = response.status === 429 || response.status >= 500
    if (retryable && attempt + 1 < maxAttempts) {
      await waitForRetry(attempt, response.headers.get('retry-after'), dependencies)
      continue
    }
    throw microsoftGraphError(response.status, payload.error?.code, operation)
  }
  throw new MicrosoftMailError(502, 'GRAPH_ERROR', `${operation} failed`)
}

async function externalUploadRequest(
  uploadUrl: string,
  init: RequestInit,
  dependencies: MicrosoftMailDependencies,
): Promise<void> {
  const validatedUrl = validatedOutlookUploadUrl(uploadUrl)
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response
    try {
      response = await fetchImpl(validatedUrl, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(30_000),
      })
    }
    catch (error) {
      if (attempt < 2) {
        await waitForRetry(attempt, null, dependencies)
        continue
      }
      throw new MicrosoftMailError(
        502,
        'ATTACHMENT_UPLOAD_NETWORK_ERROR',
        'Microsoft attachment upload failed',
        { cause: error },
      )
    }
    if (response.ok) return
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await response.text().catch(() => '')
      await waitForRetry(attempt, response.headers.get('retry-after'), dependencies)
      continue
    }
    await response.text().catch(() => '')
    throw new MicrosoftMailError(
      response.status === 429 ? 429 : response.status >= 500 ? 503 : 502,
      'ATTACHMENT_UPLOAD_ERROR',
      `Microsoft attachment upload failed with HTTP ${response.status}`,
    )
  }
}

function microsoftGraphError(
  httpStatus: number,
  providerCodeValue: string | undefined,
  operation: string,
): MicrosoftMailError {
  const providerCode = cleanConfigText(providerCodeValue)
  if (httpStatus === 401 || providerCode === 'InvalidAuthenticationToken') {
    return new MicrosoftMailError(401, 'GRAPH_AUTH_EXPIRED', 'Microsoft authorization expired')
  }
  if (providerCode === 'MailboxNotEnabledForRESTAPI') {
    return new MicrosoftMailError(
      409,
      'MAILBOX_UNAVAILABLE',
      'To konto Microsoft nie ma skrzynki obsługiwanej przez Microsoft Graph.',
    )
  }
  if (httpStatus === 403) {
    return new MicrosoftMailError(
      403,
      'GRAPH_ACCESS_DENIED',
      'Microsoft odmówił dostępu do tej skrzynki. Może być wymagana zgoda administratora.',
    )
  }
  if (httpStatus === 404) {
    return new MicrosoftMailError(404, 'GRAPH_NOT_FOUND', `${operation} was not found`)
  }
  if (httpStatus === 429) {
    return new MicrosoftMailError(429, 'GRAPH_THROTTLED', 'Microsoft Graph rate limit was reached')
  }
  return new MicrosoftMailError(
    httpStatus >= 500 ? 503 : httpStatus === 400 ? 400 : 502,
    providerCode ? `GRAPH_${safeErrorCode(providerCode)}` : 'GRAPH_ERROR',
    `${operation} failed with HTTP ${httpStatus}`,
  )
}

function validatedGraphUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  }
  catch {
    throw new MicrosoftMailError(400, 'GRAPH_URL_INVALID', 'Microsoft Graph URL is invalid')
  }
  if (
    parsed.origin !== GRAPH_ORIGIN
    || parsed.username
    || parsed.password
    || parsed.hash
    || !parsed.pathname.startsWith('/v1.0/me')
    || (parsed.pathname !== '/v1.0/me' && !parsed.pathname.startsWith(GRAPH_API_PREFIX))
  ) {
    throw new MicrosoftMailError(400, 'GRAPH_URL_INVALID', 'Microsoft Graph URL is invalid')
  }
  return parsed
}

function validatedGraphNextLink(value: string): URL {
  if (!value || value.length > MAX_CURSOR_URL_LENGTH) {
    throw new MicrosoftMailError(400, 'CURSOR_URL_INVALID', 'Microsoft Graph cursor URL is invalid')
  }
  return validatedGraphUrl(value)
}

function validatedOutlookUploadUrl(value: unknown): string {
  let parsed: URL
  try {
    parsed = new URL(String(value ?? ''))
  }
  catch {
    throw new MicrosoftMailError(502, 'UPLOAD_URL_INVALID', 'Microsoft returned an invalid upload URL')
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== OUTLOOK_UPLOAD_HOST
    || parsed.username
    || parsed.password
    || parsed.hash
    || parsed.toString().length > MAX_CURSOR_URL_LENGTH
  ) {
    throw new MicrosoftMailError(502, 'UPLOAD_URL_INVALID', 'Microsoft returned an invalid upload URL')
  }
  return parsed.toString()
}

function graphHeaders(
  accessToken: string,
  extras: Record<string, string> = {},
): Record<string, string> {
  return {
    authorization: `Bearer ${boundedRequiredText(accessToken, 'Microsoft access token', 32_768)}`,
    accept: 'application/json',
    ...extras,
  }
}

function graphRecipient(address: string): MicrosoftGraphRecipient {
  return { emailAddress: { address } }
}

function microsoftAddress(recipient: MicrosoftGraphRecipient | null | undefined): MailAddress | null {
  const rawAddress = cleanDisplayText(recipient?.emailAddress?.address || '')
  const email = normalizeEmail(rawAddress)
  const name = cleanDisplayText(recipient?.emailAddress?.name || '')
  const label = name || email || rawAddress
  return label ? { name, email: email || null, label } : null
}

function microsoftAddresses(recipients: MicrosoftGraphRecipient[] | null | undefined): MailAddress[] {
  return uniqueAddresses((recipients ?? [])
    .slice(0, 50)
    .map(microsoftAddress)
    .filter((address): address is MailAddress => Boolean(address)))
}

function microsoftThreadParticipants(
  messages: MicrosoftGraphMessage[],
  accountEmail: string,
): MailAddress[] {
  const normalizedAccount = normalizeEmail(accountEmail)
  return uniqueAddresses(messages.flatMap(message => [
    ...(microsoftAddress(message.from) ? [microsoftAddress(message.from)!] : []),
    ...microsoftAddresses(message.toRecipients),
    ...microsoftAddresses(message.ccRecipients),
  ])).filter(address => address.email !== normalizedAccount)
}

function microsoftThreadBlindParticipants(
  messages: MicrosoftGraphMessage[],
  accountEmail: string,
): MailAddress[] {
  const normalizedAccount = normalizeEmail(accountEmail)
  return uniqueAddresses(messages.flatMap(message => (
    microsoftAddresses(message.bccRecipients)
  ))).filter(address => address.email !== normalizedAccount)
}

function uniqueAddresses(addresses: MailAddress[]): MailAddress[] {
  const seen = new Set<string>()
  return addresses.filter((address) => {
    const key = address.email || address.label.toLocaleLowerCase('pl')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function participantLabel(participants: MailAddress[]): string {
  if (!participants.length) return 'Nieznany nadawca'
  const visible = participants.slice(0, 3).map(participant => participant.label)
  const remaining = participants.length - visible.length
  return remaining > 0 ? `${visible.join(', ')} +${remaining}` : visible.join(', ')
}

function sortMicrosoftMessages(messages: MicrosoftGraphMessage[]): MicrosoftGraphMessage[] {
  return [...messages].sort((left, right) => (
    microsoftMessageTimestamp(left) - microsoftMessageTimestamp(right)
  ))
}

function microsoftMessageTimestamp(message: MicrosoftGraphMessage): number {
  for (const candidate of [
    message.sentDateTime,
    message.receivedDateTime,
    message.lastModifiedDateTime,
    message.createdDateTime,
  ]) {
    const timestamp = Date.parse(String(candidate || ''))
    if (!Number.isNaN(timestamp)) return timestamp
  }
  return 0
}

function microsoftMessageDate(message: MicrosoftGraphMessage): string | null {
  const timestamp = microsoftMessageTimestamp(message)
  return timestamp > 0 ? new Date(timestamp).toISOString() : null
}

function hasMicrosoftMessageId(message: MicrosoftGraphMessage): boolean {
  return Boolean(cleanConfigText(message.id))
}

function validateSendInput(input: MicrosoftMailSendInput): NormalizedSendInput {
  const seen = new Set<string>()
  const recipients = (values: string[] | undefined, label: string): string[] => (
    (values ?? []).map((value) => {
      const normalized = normalizeEmail(value)
      if (!normalized || !validEmailAddress(normalized)) {
        throw new MicrosoftMailError(400, 'RECIPIENT_INVALID', `${label}: nieprawidłowy adres e-mail.`)
      }
      return normalized
    }).filter((value) => {
      if (seen.has(value)) return false
      seen.add(value)
      return true
    })
  )
  const to = recipients(input.to, 'Do')
  const cc = recipients(input.cc, 'DW')
  const bcc = recipients(input.bcc, 'UDW')
  if (!to.length || to.length + cc.length + bcc.length > 50) {
    throw new MicrosoftMailError(400, 'RECIPIENTS_INVALID', 'Wiadomość wymaga od 1 do 50 odbiorców.')
  }
  const subject = String(input.subject ?? '').trim()
  if (!subject || subject.length > 500 || /[\0\r\n]/u.test(subject)) {
    throw new MicrosoftMailError(400, 'SUBJECT_INVALID', 'Temat wiadomości jest nieprawidłowy.')
  }
  const text = String(input.text ?? '')
  if (text.length > 200_000 || text.includes('\0')) {
    throw new MicrosoftMailError(400, 'BODY_INVALID', 'Treść wiadomości jest nieprawidłowa.')
  }
  const attachments = (input.attachments ?? []).map((attachment, index) => {
    const filename = cleanDisplayText(attachment.filename).replace(/[\\/]/gu, '_')
    if (!filename || Buffer.byteLength(filename, 'utf8') > 180) {
      throw new MicrosoftMailError(400, 'ATTACHMENT_NAME_INVALID', `Załącznik ${index + 1} ma nieprawidłową nazwę.`)
    }
    if (!(attachment.data instanceof Uint8Array) || !attachment.data.byteLength) {
      throw new MicrosoftMailError(400, 'ATTACHMENT_EMPTY', `Załącznik ${filename} jest pusty.`)
    }
    if (attachment.data.byteLength > MICROSOFT_LARGE_ATTACHMENT_LIMIT_BYTES) {
      throw new MicrosoftMailError(413, 'ATTACHMENT_TOO_LARGE', `Załącznik ${filename} przekracza limit Microsoft.`)
    }
    return {
      filename,
      mimeType: safeMimeType(attachment.mimeType),
      data: attachment.data,
    }
  })
  const totalAttachmentBytes = attachments.reduce(
    (total, attachment) => total + attachment.data.byteLength,
    0,
  )
  if (totalAttachmentBytes > MICROSOFT_LARGE_ATTACHMENT_LIMIT_BYTES) {
    throw new MicrosoftMailError(
      413,
      'ATTACHMENTS_TOO_LARGE',
      'Łączny rozmiar załączników przekracza limit Microsoft.',
    )
  }
  if (attachments.length > 10 || (!text.trim() && !attachments.length)) {
    throw new MicrosoftMailError(400, 'MESSAGE_CONTENT_INVALID', 'Dodaj treść lub maksymalnie 10 załączników.')
  }
  return {
    to,
    cc,
    bcc,
    subject,
    text,
    messageId: validateInternetMessageId(input.messageId),
    threadId: input.threadId ? String(input.threadId) : null,
    attachments,
  }
}

function validateInternetMessageId(value: string): string {
  const exact = String(value ?? '')
  if (!/^<[^<>\s\0\r\n]{1,240}>$/u.test(exact)) {
    throw new MicrosoftMailError(400, 'MESSAGE_ID_INVALID', 'Internet Message-ID is invalid')
  }
  return exact
}

function validEmailAddress(value: string): boolean {
  if (value.length > 254 || /\s/u.test(value)) return false
  const at = value.lastIndexOf('@')
  if (at <= 0 || at === value.length - 1) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (
    local.length > 64
    || local.startsWith('.')
    || local.endsWith('.')
    || local.includes('..')
    || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu.test(local)
    || domain.length > 253
  ) return false
  const labels = domain.split('.')
  return labels.length >= 2 && labels.every(label => (
    label.length >= 1
    && label.length <= 63
    && /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/iu.test(label)
  ))
}

function safeMimeType(value: unknown): string {
  const mimeType = String(value ?? '').trim().toLowerCase()
  return mimeType.length <= 100
    && /^[A-Z0-9!#$&^_.+-]+\/[A-Z0-9!#$&^_.+-]+$/iu.test(mimeType)
    ? mimeType
    : 'application/octet-stream'
}

function microsoftDisplayHeaders(
  headers: MicrosoftGraphInternetHeader[] | null | undefined,
): MicrosoftMailHeader[] {
  return (headers ?? []).slice(0, 200).flatMap((header) => {
    const name = String(header.name ?? '').trim()
    if (
      !name
      || name.length > 100
      || !/^[!#$%&'*+.^_`|~0-9A-Z-]+$/iu.test(name)
    ) return []
    const value = cleanDisplayText(String(header.value ?? '').slice(0, 8_192))
    return value ? [{ name, value }] : []
  })
}

function cleanOptionalInternetMessageId(value: unknown): string | null {
  const normalized = cleanDisplayText(value).slice(0, 512)
  return normalized || null
}

function optionalSafeMicrosoftWebLink(value: unknown): string | null {
  try {
    const parsed = new URL(String(value ?? ''))
    if (
      parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && [
        'outlook.live.com',
        'outlook.office.com',
        'outlook.office365.com',
      ].includes(parsed.hostname.toLowerCase())
      && parsed.toString().length <= 8_192
    ) return parsed.toString()
  }
  catch {
    // Ignore malformed provider links.
  }
  return null
}

function safeMicrosoftWebLink(value: unknown): string {
  return optionalSafeMicrosoftWebLink(value) ?? 'https://outlook.office.com/mail/'
}

function pageCursorBinding(folder: MailFolderId, query: string): string {
  return `microsoft-mail-page-v1\0${folder}\0${createHash('sha256').update(query).digest('hex')}`
}

function requiredCursorBinding(binding: string): string {
  if (typeof binding !== 'string' || !binding || binding.length > 1_024) {
    throw new MicrosoftMailError(500, 'CURSOR_BINDING_INVALID', 'Microsoft mail cursor binding is invalid')
  }
  return binding
}

function cursorSignature(
  urlBytes: Uint8Array,
  binding: string,
  secret: string,
): Buffer {
  const bindingBytes = Buffer.from(binding, 'utf8')
  const bindingLength = Buffer.allocUnsafe(4)
  bindingLength.writeUInt32BE(bindingBytes.length)
  return createHmac('sha256', requiredCursorSecret(secret))
    .update('microsoft-mail-cursor-v1\0', 'utf8')
    .update(bindingLength)
    .update(bindingBytes)
    .update(urlBytes)
    .digest()
}

function requiredCursorSecret(secret: string): string {
  const value = String(secret ?? '')
  if (Buffer.byteLength(value, 'utf8') < 16) {
    throw new MicrosoftMailError(500, 'CURSOR_SECRET_INVALID', 'Microsoft mail cursor secret is not configured')
  }
  return value
}

function referenceSignature(payload: Uint8Array, secret: string): Buffer {
  return createHmac('sha256', requiredReferenceSecret(secret))
    .update('microsoft-mail-thread-v1\0', 'utf8')
    .update(payload)
    .digest()
}

function requiredReferenceSecret(secret: string): string {
  const value = String(secret ?? '')
  if (Buffer.byteLength(value, 'utf8') < 16) {
    throw new MicrosoftMailError(
      500,
      'REFERENCE_SECRET_INVALID',
      'Microsoft mail reference secret is not configured',
    )
  }
  return value
}

function validateSearchQuery(value: string | undefined): string {
  const query = String(value ?? '').trim()
  if (query.length > 500 || /[\u0000-\u001F\u007F]/u.test(query)) {
    throw new MicrosoftMailError(400, 'SEARCH_INVALID', 'Microsoft mail search query is invalid')
  }
  return query
}

function escapeKqlPhrase(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')
}

function escapeODataString(value: string): string {
  return value.replace(/'/gu, "''")
}

function cleanProviderIdentifier(value: unknown, label: string): string {
  const identifier = String(value ?? '').trim()
  if (!identifier || identifier.length > 2_048 || /[\u0000-\u001F\u007F]/u.test(identifier)) {
    throw new MicrosoftMailError(502, 'PROVIDER_ID_INVALID', `${label} is invalid`)
  }
  return identifier
}

function cleanCallerProviderIdentifier(value: unknown, label: string): string {
  try {
    return cleanProviderIdentifier(value, label)
  }
  catch (error) {
    throw new MicrosoftMailError(400, 'PROVIDER_ID_INVALID', `${label} is invalid`, { cause: error })
  }
}

function microsoftReceivedAttachmentMaxBytes(value: unknown): number {
  const maxBytes = Number(value)
  if (
    !Number.isSafeInteger(maxBytes)
    || maxBytes < 1
    || maxBytes > MICROSOFT_RECEIVED_ATTACHMENT_MAX_BYTES
  ) {
    throw new MicrosoftMailError(
      400,
      'ATTACHMENT_LIMIT_INVALID',
      'Microsoft attachment byte limit is invalid',
    )
  }
  return maxBytes
}

function microsoftReceivedAttachmentTooLarge(): MicrosoftMailError {
  return new MicrosoftMailError(
    413,
    'ATTACHMENT_TOO_LARGE',
    'Microsoft attachment exceeds the download limit',
  )
}

function encodedMicrosoftAttachmentBudget(maxBytes: number): number {
  return Math.ceil((maxBytes + 1) / 3) * 4 + 2
}

function decodedMicrosoftBase64Size(value: string): number {
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new MicrosoftMailError(
      502,
      'ATTACHMENT_CONTENT_INVALID',
      'Microsoft attachment returned invalid content',
    )
  }
  const unpaddedLength = value.replace(/=+$/u, '').length
  const paddingLength = value.length - unpaddedLength
  const remainder = unpaddedLength % 4
  const expectedPadding = remainder === 0 ? 0 : 4 - remainder
  if (
    remainder === 1
    || (paddingLength > 0 && (value.length % 4 !== 0 || paddingLength !== expectedPadding))
  ) {
    throw new MicrosoftMailError(
      502,
      'ATTACHMENT_CONTENT_INVALID',
      'Microsoft attachment returned invalid content',
    )
  }
  return Math.floor(unpaddedLength * 3 / 4)
}

function cleanOptionalProviderIdentifier(value: unknown): string | null {
  const identifier = String(value ?? '').trim()
  if (!identifier) return null
  return cleanProviderIdentifier(identifier, 'Microsoft provider ID')
}

function cleanConfigText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedRequiredText(value: unknown, label: string, maxLength: number): string {
  const text = cleanConfigText(value)
  if (!text || text.length > maxLength || /[\u0000-\u001F\u007F]/u.test(text)) {
    throw new MicrosoftMailError(400, 'VALUE_INVALID', `${label} is invalid`)
  }
  return text
}

function normalizedScopes(scopes: readonly string[] | null | undefined): Set<string> {
  return new Set((scopes ?? []).map(canonicalMicrosoftScope).filter(Boolean))
}

function canonicalMicrosoftScope(value: string): string {
  let scope = String(value ?? '').trim()
  try {
    if (scope.includes('%')) scope = decodeURIComponent(scope)
  }
  catch {
    return ''
  }
  return scope
    .toLowerCase()
    .replace(/^https:\/\/graph\.microsoft\.com\//u, '')
}

function normalizeEmail(value: string): string {
  const normalized = cleanDisplayText(value).toLowerCase()
  return validEmailAddress(normalized) ? normalized : ''
}

function cleanDisplayText(value: unknown): string {
  return stripUnsafeMailDisplayControls(String(value ?? ''))
    .replace(/\r?\n[ \t]*/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function normalizeSnippet(value: string): string {
  return cleanDisplayText(decodeHtmlEntities(value))
}

function normalizeBody(value: string): string {
  return stripUnsafeMailDisplayControls(decodeHtmlEntities(value))
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{4,}/gu, '\n\n\n')
    .trim()
}

function htmlToText(value: string): string {
  const withoutActiveContent = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/giu, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/giu, '')
    .replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/giu, '')
    .replace(/<!--[\s\S]*?-->/gu, '')
  const withLineBreaks = withoutActiveContent
    .replace(/<(?:br|hr)\b[^>]*\/?>/giu, '\n')
    .replace(/<\/(?:p|div|section|article|header|footer|tr|h[1-6])\s*>/giu, '\n\n')
    .replace(/<li\b[^>]*>/giu, '\n• ')
    .replace(/<\/(?:li|td|th)\s*>/giu, ' ')
  return normalizeBody(
    withLineBreaks
      .replace(/<[^>]+>/gu, ' ')
      .replace(/[ \t]+/gu, ' ')
      .replace(/[ \t]*\n[ \t]*/gu, '\n')
      .replace(/\s+([.,!?;:])/gu, '$1'),
  )
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: '\'',
    bull: '•',
    gt: '>',
    hellip: '…',
    lt: '<',
    mdash: '—',
    middot: '·',
    nbsp: ' ',
    ndash: '–',
    quot: '"',
    zwnj: '',
    zwj: '',
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (entity, key: string) => {
    if (key.startsWith('#x')) {
      const code = Number.parseInt(key.slice(2), 16)
      return validUnicodeCodePoint(code) ? String.fromCodePoint(code) : entity
    }
    if (key.startsWith('#')) {
      const code = Number.parseInt(key.slice(1), 10)
      return validUnicodeCodePoint(code) ? String.fromCodePoint(code) : entity
    }
    return named[key.toLowerCase()] ?? entity
  })
}

function validUnicodeCodePoint(value: number): boolean {
  return Number.isInteger(value)
    && value >= 0
    && value <= 0x10FFFF
    && !(value >= 0xD800 && value <= 0xDFFF)
}

function nonNegativeIntegerOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

function emptyFolderSummary(id: MailFolderId, label: string): MailFolderSummary {
  return { id, label, messagesTotal: null, messagesUnread: null }
}

function addressDomain(email: string | null | undefined): string {
  const at = email?.lastIndexOf('@') ?? -1
  return at >= 0 ? email!.slice(at + 1).toLowerCase() : ''
}

function safeErrorCode(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/gu, '_').slice(0, 100).toUpperCase()
}

async function waitForRetry(
  attempt: number,
  retryAfter: string | null,
  dependencies: MicrosoftMailDependencies,
): Promise<void> {
  const delay = providerRetryDelay(attempt, retryAfter, dependencies)
  await (dependencies.sleep ?? defaultSleep)(delay)
}

function providerRetryDelay(
  attempt: number,
  retryAfter: string | null,
  dependencies: MicrosoftMailDependencies,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(10_000, Math.max(1_000, seconds * 1_000))
    }
    const date = Date.parse(retryAfter)
    const now = dependencies.now?.() ?? Date.now()
    if (!Number.isNaN(date)) return Math.min(10_000, Math.max(1_000, date - now))
  }
  const random = dependencies.random?.() ?? Math.random()
  return Math.min(4_000, 1_000 * (2 ** attempt) + Math.floor(random * 250))
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    let current: number
    while ((current = index++) < values.length) await task(values[current]!)
  })
  await Promise.all(workers)
}
