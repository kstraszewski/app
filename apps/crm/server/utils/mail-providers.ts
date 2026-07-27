import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { useRuntimeConfig } from '#imports'
import { createError, getHeader, getRequestURL, type H3Event } from 'h3'
import type {
  MailFolderId,
  MailFolderSummary,
  MailThreadDetail,
  MailThreadListPayload,
} from '../../shared/types/mail.ts'
import {
  gmailThreadDetail,
  gmailThreadSummary,
  messageHeader,
  type GmailThreadResource,
} from './gmail-message.ts'
import type { GmailSendPayload } from './gmail-send.ts'

export type MailProviderName = 'google'

interface MailOAuthClientConfig {
  clientId?: string
  clientSecret?: string
  redirectUri?: string
}

interface MailOAuthRuntimeConfig {
  encryptionKey?: string
  google?: MailOAuthClientConfig
}

export interface MailOAuthTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: string | null
  scopes: string[]
}

export interface MailProviderIdentity {
  accountId: string
  email: string
  messagesTotal: number
  threadsTotal: number
}

export interface GmailReplyContext {
  subject: string
  inReplyTo: string
  references: string[]
}

export interface GmailSendResult {
  id: string
  threadId: string
}

interface GoogleThreadListResponse {
  threads?: Array<{ id?: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

interface GoogleLabel {
  id?: string
  name?: string
  messagesTotal?: number
  messagesUnread?: number
}

const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const GMAIL_SEND_CAPABLE_SCOPES = new Set([
  GMAIL_SEND_SCOPE,
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://mail.google.com/',
])
const GOOGLE_MAIL_SCOPES = [
  'openid',
  'email',
  'profile',
  GMAIL_READONLY_SCOPE,
  GMAIL_SEND_SCOPE,
]
const FOLDER_LABELS: Array<{ id: MailFolderId; label: string }> = [
  { id: 'INBOX', label: 'Odebrane' },
  { id: 'STARRED', label: 'Oznaczone' },
  { id: 'SENT', label: 'Wysłane' },
  { id: 'DRAFT', label: 'Szkice' },
]

function mailConfig(event: H3Event): MailOAuthRuntimeConfig {
  return useRuntimeConfig(event).mailOAuth as MailOAuthRuntimeConfig
}

function providerConfig(event: H3Event) {
  const config = mailConfig(event)
  if (
    !config.google?.clientId
    || !config.google.clientSecret
    || !config.encryptionKey
  ) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Gmail OAuth is not configured',
    })
  }
  return {
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
    encryptionKey: config.encryptionKey,
  }
}

export function mailProviderAvailability(event: H3Event): boolean {
  const config = mailConfig(event)
  return Boolean(
    config.encryptionKey
    && config.google?.clientId
    && config.google.clientSecret,
  )
}

export function mailOAuthState(): string {
  return randomBytes(32).toString('base64url')
}

export function mailOAuthPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  return { verifier, challenge }
}

export function mailOAuthCallbackUrl(event: H3Event): string {
  const configured = mailConfig(event).google?.redirectUri
  if (configured) return configured

  const requestUrl = getRequestURL(event)
  const forwardedHost = getHeader(event, 'x-forwarded-host')
  const forwardedProto = getHeader(event, 'x-forwarded-proto')
  const origin = forwardedHost
    ? `${forwardedProto || requestUrl.protocol.replace(':', '')}://${forwardedHost}`
    : requestUrl.origin
  return `${origin}/api/mail/oauth/google/callback`
}

export function mailAuthorizationUrl(
  event: H3Event,
  state: string,
  codeChallenge: string,
  loginHint?: string,
): string {
  const config = providerConfig(event)
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: mailOAuthCallbackUrl(event),
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    scope: GOOGLE_MAIL_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  })
  if (loginHint) query.set('login_hint', loginHint)
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`
}

export async function exchangeMailOAuthCode(
  event: H3Event,
  code: string,
  codeVerifier: string,
): Promise<MailOAuthTokenSet> {
  const config = providerConfig(event)
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: mailOAuthCallbackUrl(event),
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
  })
  return exchangeGoogleToken(body, false)
}

export async function refreshMailOAuthToken(
  event: H3Event,
  refreshToken: string,
): Promise<MailOAuthTokenSet> {
  const config = providerConfig(event)
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const refreshed = await exchangeGoogleToken(body, true)
  return {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? refreshToken,
  }
}

export function mailTokenIncludesReadAccess(scopes: string[]): boolean {
  return scopes.includes(GMAIL_READONLY_SCOPE)
}

export function mailTokenIncludesSendAccess(scopes: string[] | null | undefined): boolean {
  return Boolean(scopes?.some(scope => GMAIL_SEND_CAPABLE_SCOPES.has(scope)))
}

export async function fetchMailProviderIdentity(
  accessToken: string,
): Promise<MailProviderIdentity> {
  const headers = { authorization: `Bearer ${accessToken}` }
  const [gmailProfile, googleProfile] = await Promise.all([
    providerJson<{
      emailAddress?: string
      messagesTotal?: number
      threadsTotal?: number
    }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      { headers },
      'Gmail profile',
    ),
    providerJson<{ sub?: string; email?: string }>(
      'https://www.googleapis.com/oauth2/v3/userinfo',
      { headers },
      'Google profile',
    ),
  ])

  const email = (gmailProfile.emailAddress || googleProfile.email || '').trim().toLowerCase()
  if (!email) {
    throw createError({ statusCode: 502, statusMessage: 'Google returned no Gmail address' })
  }

  return {
    accountId: googleProfile.sub || email,
    email,
    messagesTotal: Math.max(0, Number(gmailProfile.messagesTotal) || 0),
    threadsTotal: Math.max(0, Number(gmailProfile.threadsTotal) || 0),
  }
}

export async function fetchGmailThreadPage(
  accessToken: string,
  accountEmail: string,
  options: {
    folder: MailFolderId
    query?: string
    pageToken?: string
    maxResults?: number
  },
): Promise<MailThreadListPayload> {
  const query = new URLSearchParams({
    maxResults: String(Math.min(25, Math.max(1, options.maxResults ?? 20))),
    labelIds: options.folder,
  })
  if (options.query) query.set('q', options.query)
  if (options.pageToken) query.set('pageToken', options.pageToken)

  const headers = { authorization: `Bearer ${accessToken}` }
  const [listing, labelsResponse] = await Promise.all([
    providerJson<GoogleThreadListResponse>(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?${query}`,
      { headers },
      'Gmail thread list',
    ),
    providerJson<{ labels?: GoogleLabel[] }>(
      'https://gmail.googleapis.com/gmail/v1/users/me/labels',
      { headers },
      'Gmail label list',
    ),
  ])

  const threadIds = (listing.threads ?? [])
    .map(thread => String(thread.id ?? ''))
    .filter(Boolean)
  const threads = await mapWithConcurrency(threadIds, 5, async (threadId) => {
    const metadataQuery = new URLSearchParams({ format: 'metadata' })
    for (const header of ['From', 'To', 'Subject', 'Date']) {
      metadataQuery.append('metadataHeaders', header)
    }
    return providerJson<GmailThreadResource>(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?${metadataQuery}`,
      { headers },
      'Gmail thread metadata',
    )
  })

  return {
    data: threads
      .map(thread => gmailThreadSummary(thread, accountEmail))
      .filter(thread => thread.id),
    folders: mailFolderSummaries(labelsResponse.labels ?? []),
    nextPageToken: listing.nextPageToken || null,
    resultSizeEstimate: Math.max(0, Number(listing.resultSizeEstimate) || 0),
  }
}

export async function fetchGmailThread(
  accessToken: string,
  accountEmail: string,
  threadId: string,
): Promise<MailThreadDetail> {
  const headers = { authorization: `Bearer ${accessToken}` }
  const thread = await providerJson<GmailThreadResource>(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    { headers },
    'Gmail thread',
  )
  const externalUrl = `https://mail.google.com/mail/u/${encodeURIComponent(accountEmail)}/#all/${encodeURIComponent(threadId)}`
  return gmailThreadDetail(thread, accountEmail, externalUrl)
}

export async function fetchGmailReplyContext(
  accessToken: string,
  threadId: string,
): Promise<GmailReplyContext> {
  const query = new URLSearchParams({ format: 'metadata' })
  for (const header of ['Subject', 'Message-ID', 'References', 'In-Reply-To']) {
    query.append('metadataHeaders', header)
  }
  const thread = await providerJson<GmailThreadResource>(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?${query}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
    'Gmail reply context',
  )
  const latest = [...(thread.messages ?? [])]
    .sort((left, right) => Number(left.internalDate ?? 0) - Number(right.internalDate ?? 0))
    .at(-1)
  if (!latest) {
    throw createError({ statusCode: 409, statusMessage: 'Gmail thread has no messages' })
  }

  const inReplyTo = extractMessageIds(messageHeader(latest, 'message-id')).at(-1) ?? ''
  if (!inReplyTo) {
    throw createError({
      statusCode: 409,
      statusMessage: 'This Gmail thread cannot be replied to from the CRM',
    })
  }

  const references = boundedMessageReferences([
    ...extractMessageIds(messageHeader(latest, 'references')),
    ...extractMessageIds(messageHeader(latest, 'in-reply-to')),
    inReplyTo,
  ])
  const subject = messageHeader(latest, 'subject')
    .replace(/\r?\n[ \t]*/gu, ' ')
    .trim()

  return {
    subject: subject || '(bez tematu)',
    inReplyTo,
    references,
  }
}

export async function sendGmailMessage(
  accessToken: string,
  payload: GmailSendPayload,
): Promise<GmailSendResult> {
  let response: Response
  try {
    response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      },
    )
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Nie udało się potwierdzić wysyłki. Sprawdź folder Wysłane przed ponowieniem.',
      data: { deliveryAmbiguous: true },
    })
  }

  const data = await response.json().catch(() => ({})) as {
    id?: string
    threadId?: string
    error?: {
      errors?: Array<{ reason?: string }>
      status?: string
    }
  }
  if (!response.ok) {
    const reasons = new Set([
      ...(data.error?.errors ?? []).map(item => String(item.reason ?? '')),
      String(data.error?.status ?? ''),
    ])
    if (response.status === 401) {
      throw createError({ statusCode: 401, statusMessage: 'Gmail authorization expired' })
    }
    if (
      reasons.has('insufficientPermissions')
      || reasons.has('PERMISSION_DENIED')
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Połącz Gmail ponownie i zezwól na wysyłanie wiadomości.',
      })
    }
    if (
      response.status === 429
      || ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded']
        .some(reason => reasons.has(reason))
    ) {
      throw createError({
        statusCode: 429,
        statusMessage: 'Limit wysyłania Gmail został osiągnięty. Spróbuj ponownie później.',
      })
    }
    if (response.status >= 500) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Gmail jest chwilowo niedostępny. Sprawdź folder Wysłane przed ponowieniem.',
        data: { deliveryAmbiguous: true },
      })
    }
    throw createError({
      statusCode: response.status === 400 ? 400 : 502,
      statusMessage: response.status === 400
        ? 'Gmail odrzucił format wiadomości.'
        : 'Gmail odmówił wysłania wiadomości.',
    })
  }

  const id = String(data.id ?? '')
  const threadId = String(data.threadId ?? payload.threadId ?? '')
  if (!id || !threadId) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Gmail nie zwrócił potwierdzenia wysyłki.',
      data: { deliveryAmbiguous: true },
    })
  }
  return { id, threadId }
}

export async function findGmailSentMessage(
  accessToken: string,
  messageIdHeader: string,
): Promise<GmailSendResult | null> {
  const query = new URLSearchParams({
    maxResults: '1',
    q: `in:sent rfc822msgid:${messageIdHeader}`,
  })
  const result = await providerJson<{
    messages?: Array<{ id?: string; threadId?: string }>
  }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${query}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
    'Gmail sent message lookup',
  )
  const message = result.messages?.[0]
  const id = String(message?.id ?? '')
  const threadId = String(message?.threadId ?? '')
  return id && threadId ? { id, threadId } : null
}

export async function revokeMailOAuthToken(token: string): Promise<void> {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok && response.status !== 400) {
    throw createError({
      statusCode: 502,
      statusMessage: `Google token revocation failed with HTTP ${response.status}`,
    })
  }
}

export function encryptMailSecret(event: H3Event, value: string | null): string | null {
  if (!value) return null
  const secret = providerConfig(event).encryptionKey
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptMailSecret(
  event: H3Event,
  value: string | null | undefined,
): string | null {
  if (!value) return null
  const secret = providerConfig(event).encryptionKey
  const [version, ivValue, tagValue, encryptedValue] = value.split('.')
  if (version !== 'v1' || !ivValue || !tagValue || !encryptedValue) {
    throw createError({ statusCode: 500, statusMessage: 'Stored mail token has an invalid format' })
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(secret),
      Buffer.from(ivValue, 'base64url'),
    )
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw createError({ statusCode: 500, statusMessage: 'Stored mail token cannot be decrypted' })
  }
}

async function exchangeGoogleToken(
  body: URLSearchParams,
  refreshing: boolean,
): Promise<MailOAuthTokenSet> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const token = await response.json().catch(() => ({})) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    error?: string
  }
  if (!response.ok || !token.access_token) {
    if (refreshing && token.error === 'invalid_grant') {
      throw createError({
        statusCode: 409,
        statusMessage: 'Gmail authorization expired; reconnect the account',
      })
    }
    throw createError({
      statusCode: 502,
      statusMessage: `Gmail OAuth token exchange failed with HTTP ${response.status}`,
    })
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: token.expires_in
      ? new Date(Date.now() + Math.max(0, token.expires_in - 60) * 1000).toISOString()
      : null,
    scopes: (token.scope || '').split(/\s+/u).filter(Boolean),
  }
}

function mailFolderSummaries(labels: GoogleLabel[]): MailFolderSummary[] {
  const labelsById = new Map(labels.map(label => [String(label.id ?? ''), label]))
  return FOLDER_LABELS.map((folder) => {
    const label = labelsById.get(folder.id)
    return {
      id: folder.id,
      label: folder.label,
      messagesTotal: label?.messagesTotal === undefined
        ? null
        : Math.max(0, Number(label.messagesTotal) || 0),
      messagesUnread: label?.messagesUnread === undefined
        ? null
        : Math.max(0, Number(label.messagesUnread) || 0),
    }
  })
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

function extractMessageIds(value: string): string[] {
  return [...value.matchAll(/<[^<>\s]{1,240}>/gu)].map(match => match[0])
}

function boundedMessageReferences(values: string[]): string[] {
  const unique = [...new Set(values)].slice(-20)
  const selected: string[] = []
  let length = 0
  for (const value of unique.reverse()) {
    if (length + value.length + 1 > 850) break
    selected.unshift(value)
    length += value.length + 1
  }
  return selected
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      let index: number
      while ((index = nextIndex++) < values.length) {
        results[index] = await task(values[index]!)
      }
    },
  )
  await Promise.all(workers)
  return results
}

async function providerJson<T>(
  url: string,
  init: RequestInit,
  operation: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    await response.text().catch(() => '')
    const statusCode = response.status === 401 || response.status === 403
      ? response.status
      : response.status === 429 ? 503 : 502
    throw createError({
      statusCode,
      statusMessage: `${operation} failed with HTTP ${response.status}`,
    })
  }
  return await response.json() as T
}
