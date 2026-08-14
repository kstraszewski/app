import { serverDataBackend } from '~~/server/utils/data-api'
import {
  createError,
  deleteCookie,
  getCookie,
  getHeader,
  getRequestURL,
  type H3Event,
} from 'h3'
import type {
  MailConnectionStatus,
  MailProviderId,
  MailTransportSecurity,
} from '../../shared/types/mail.ts'
import type { CrmSession } from './crm.ts'
import { throwDbError } from './crm.ts'
import {
  decryptMailSecret,
  encryptMailSecret,
  mailConnectionSecretContext,
} from './mail-crypto.ts'
import {
  LEGACY_MAIL_OAUTH_COOKIE,
  mailOAuthCookieName,
  mailOAuthCookieNames,
  mailOAuthFlowSecretContext,
  mailOAuthStateFromCookieName,
  MAX_ACTIVE_MAIL_OAUTH_FLOWS,
  validatedMailOAuthFlow,
  type MailOAuthFlow,
} from './mail-oauth-flow.ts'
import {
  coordinatedMailOAuthAccessToken,
  freshMailOAuthAccessToken,
  type MailOAuthRefreshedTokenSet,
  type MailOAuthRefreshFailure,
  type MailOAuthRefreshState,
} from './mail-oauth-refresh-cas.ts'
import { refreshMailOAuthToken } from './mail-providers.ts'

export interface MailConnectionRow {
  id: string
  organization_id: string
  owner_user_id: string
  provider: MailProviderId
  account_id: string
  account_email: string
  display_name: string | null
  auth_type: 'oauth2' | 'password'
  encrypted_access_token: string | null
  encrypted_refresh_token: string | null
  encrypted_credentials: string | null
  token_expires_at: string | null
  scopes: string[] | null
  imap_host: string | null
  imap_port: number | null
  imap_security: MailTransportSecurity | null
  imap_username: string | null
  smtp_host: string | null
  smtp_port: number | null
  smtp_security: MailTransportSecurity | null
  smtp_username: string | null
  status: MailConnectionStatus
  last_error: string | null
  last_verified_at: string | null
  created_at: string
  updated_at: string
}

export interface ImapSmtpStoredCredentials {
  imapPassword: string
  smtpPassword: string
}

export const MAIL_OAUTH_COOKIE = LEGACY_MAIL_OAUTH_COOKIE

export function mailOAuthCookieOptions(event: H3Event) {
  const forwardedProto = event.headers.get('x-forwarded-proto')
  const secure = forwardedProto
    ? forwardedProto === 'https'
    : getRequestURL(event).protocol === 'https:'
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    // The start endpoint lives under /api/org while callbacks live under
    // /api/mail/oauth. /api is the narrowest shared path and lets a later
    // start request prune the bounded set of state-keyed cookies.
    path: '/api',
    maxAge: 10 * 60,
  }
}

export function legacyMailOAuthCookieOptions(event: H3Event) {
  return {
    ...mailOAuthCookieOptions(event),
    path: '/api/mail/oauth',
  }
}

export function encodeMailOAuthFlow(event: H3Event, flow: MailOAuthFlow): string {
  const validated = validatedMailOAuthFlow(flow)
  const encrypted = encryptMailSecret(
    event,
    JSON.stringify(validated),
    mailOAuthFlowSecretContext(validated.state),
  )
  if (!encrypted) {
    throw createError({ statusCode: 500, statusMessage: 'Mail OAuth flow could not be secured' })
  }
  return encrypted
}

export function decodeMailOAuthFlow(
  event: H3Event,
  value: string | undefined,
  expectedState?: string,
): MailOAuthFlow {
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth flow cookie is missing' })
  }
  try {
    let decrypted: string | null = null
    if (expectedState) {
      try {
        decrypted = decryptMailSecret(
          event,
          value,
          mailOAuthFlowSecretContext(expectedState),
        )
      }
      catch (error) {
        if (Number((error as { statusCode?: number })?.statusCode) === 503) throw error
        // Legacy v2 flows used the default AAD. This fallback can be removed
        // after the ten-minute OAuth window following deployment.
        decrypted = decryptMailSecret(event, value)
      }
    }
    else {
      decrypted = decryptMailSecret(event, value)
    }
    return validatedMailOAuthFlow(JSON.parse(decrypted || ''), expectedState)
  }
  catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 503) throw error
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth flow cookie is invalid' })
  }
}

export function mailOAuthFlowCookieName(state: string): string {
  try {
    return mailOAuthCookieName(state)
  }
  catch {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth state is invalid' })
  }
}

/**
 * Keep at most four live state-bound flows. Each flow has its own cookie, so
 * independent tabs and providers cannot overwrite one another.
 */
export function pruneMailOAuthFlowCookies(event: H3Event): void {
  const active: Array<{ name: string; expiresAt: number }> = []
  for (const name of mailOAuthCookieNames(getHeader(event, 'cookie'))) {
    const state = mailOAuthStateFromCookieName(name)
    const value = getCookie(event, name)
    if (!state || !value) continue
    try {
      const flow = decodeMailOAuthFlow(event, value, state)
      if (flow.expiresAt <= Date.now()) {
        deleteCookie(event, name, mailOAuthCookieOptions(event))
      }
      else {
        active.push({ name, expiresAt: flow.expiresAt })
      }
    }
    catch (error) {
      if (Number((error as { statusCode?: number })?.statusCode) === 503) throw error
      deleteCookie(event, name, mailOAuthCookieOptions(event))
    }
  }

  active.sort((left, right) => left.expiresAt - right.expiresAt)
  while (active.length >= MAX_ACTIVE_MAIL_OAUTH_FLOWS) {
    const oldest = active.shift()
    if (oldest) deleteCookie(event, oldest.name, mailOAuthCookieOptions(event))
  }
}

export async function loadUserMailConnections(
  event: H3Event,
  session: CrmSession,
): Promise<{ backendData: any; connections: MailConnectionRow[] }> {
  const backendData = serverDataBackend(event) as any
  const { data, error } = await backendData
    .from('mail_connections')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .order('created_at', { ascending: true })
  throwDbError(error)
  return {
    backendData,
    connections: (data ?? []) as MailConnectionRow[],
  }
}

export async function loadUserMailConnection(
  event: H3Event,
  session: CrmSession,
  connectionId: string,
): Promise<{ backendData: any; connection: MailConnectionRow | null }> {
  if (!isUuid(connectionId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid mail connection ID' })
  }
  const backendData = serverDataBackend(event) as any
  const { data, error } = await backendData
    .from('mail_connections')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('id', connectionId)
    .maybeSingle()
  throwDbError(error)
  return {
    backendData,
    connection: data ? data as MailConnectionRow : null,
  }
}

export async function requireUserMailConnection(
  event: H3Event,
  session: CrmSession,
  connectionId: string,
): Promise<{ backendData: any; connection: MailConnectionRow }> {
  const loaded = await loadUserMailConnection(event, session, connectionId)
  if (!loaded.connection) {
    throw createError({ statusCode: 404, statusMessage: 'Mail connection not found' })
  }
  return {
    backendData: loaded.backendData,
    connection: loaded.connection,
  }
}

export async function activeMailAccessToken(
  event: H3Event,
  backendData: any,
  connection: MailConnectionRow,
): Promise<string> {
  if (connection.provider === 'imap') {
    throw createError({ statusCode: 400, statusMessage: 'This mail connection does not use OAuth' })
  }
  const accessContext = tokenSecretContext(connection, 'access-token')
  const refreshContext = tokenSecretContext(connection, 'refresh-token')
  const accessToken = decryptMailSecret(
    event,
    connection.encrypted_access_token,
    accessContext,
  )
  const initial = oauthRefreshState(
    event,
    connection,
    accessToken,
    refreshContext,
  )
  const currentAccessToken = freshMailOAuthAccessToken(initial)
  if (currentAccessToken) return currentAccessToken

  return coordinatedMailOAuthAccessToken(initial, {
    loadCurrent: async () => {
      const current = await loadCurrentOAuthConnection(backendData, connection)
      return current
        ? oauthRefreshState(event, current, undefined, refreshContext)
        : null
    },
    refresh: refreshToken => connection.provider === 'google'
      ? refreshMailOAuthToken(event, refreshToken)
      : refreshMicrosoftToken(event, refreshToken),
    compareAndSwap: (expected, refreshed) => persistRefreshedOAuthToken(
      event,
      backendData,
      connection,
      expected,
      refreshed,
      accessContext,
      refreshContext,
    ),
    compareAndSetFailure: (expected, failure) => markOAuthRefreshFailure(
      backendData,
      connection,
      expected,
      failure,
    ),
    describeFailure: error => ({
      status: Number((error as { statusCode?: number })?.statusCode) === 409
        ? 'revoked'
        : 'error',
      message: error instanceof Error
        ? error.message.slice(0, 500)
        : `${providerLabel(connection.provider)} token refresh failed`,
    }),
    missingRefreshTokenFailure: {
      status: 'revoked',
      message: `${providerLabel(connection.provider)} connection must be reconnected`,
    },
    missingRefreshTokenError: () => createError({
      statusCode: 409,
      statusMessage: `Połącz ponownie konto ${providerLabel(connection.provider)}.`,
    }),
    missingConnectionError: () => createError({
      statusCode: 404,
      statusMessage: 'Mail connection not found',
    }),
    contentionError: () => createError({
      statusCode: 503,
      statusMessage: 'Trwa odświeżanie połączenia pocztowego. Spróbuj ponownie.',
    }),
  })
}

type MailConnectionOAuthRefreshState = MailOAuthRefreshState<MailConnectionRow>

function oauthRefreshState(
  event: H3Event,
  connection: MailConnectionRow,
  accessToken: string | null | undefined,
  refreshContext: string,
): MailConnectionOAuthRefreshState {
  return {
    source: connection,
    accessToken: accessToken === undefined
      ? decryptMailSecret(
          event,
          connection.encrypted_access_token,
          tokenSecretContext(connection, 'access-token'),
        )
      : accessToken,
    refreshToken: decryptMailSecret(
      event,
      connection.encrypted_refresh_token,
      refreshContext,
    ),
    expiresAt: connection.token_expires_at,
  }
}

async function loadCurrentOAuthConnection(
  backendData: any,
  expected: MailConnectionRow,
): Promise<MailConnectionRow | null> {
  const result = await backendData
    .from('mail_connections')
    .select('*')
    .eq('organization_id', expected.organization_id)
    .eq('owner_user_id', expected.owner_user_id)
    .eq('id', expected.id)
    .eq('provider', expected.provider)
    .maybeSingle()
  throwDbError(result.error)
  return result.data ? result.data as MailConnectionRow : null
}

async function persistRefreshedOAuthToken(
  event: H3Event,
  backendData: any,
  connection: MailConnectionRow,
  expected: MailConnectionOAuthRefreshState,
  refreshed: MailOAuthRefreshedTokenSet,
  accessContext: string,
  refreshContext: string,
): Promise<boolean> {
  const encryptedAccessToken = encryptMailSecret(
    event,
    refreshed.accessToken,
    accessContext,
  )
  const encryptedRefreshToken = encryptMailSecret(
    event,
    refreshed.refreshToken,
    refreshContext,
  )
  if (!encryptedAccessToken || !encryptedRefreshToken) {
    throw createError({ statusCode: 500, statusMessage: 'Mail OAuth token could not be secured' })
  }

  const result = await backendData
    .from('mail_connections')
    .update({
      encrypted_access_token: encryptedAccessToken,
      encrypted_refresh_token: encryptedRefreshToken,
      token_expires_at: refreshed.expiresAt,
      scopes: refreshed.scopes.length ? refreshed.scopes : expected.source.scopes,
      status: 'active',
      last_error: null,
      last_verified_at: new Date().toISOString(),
    })
    .eq('organization_id', connection.organization_id)
    .eq('owner_user_id', connection.owner_user_id)
    .eq('id', connection.id)
    .eq('provider', connection.provider)
    // updated_at is a non-secret row version maintained by the existing
    // trigger. Do not place encrypted refresh tokens in Data API query URLs.
    .eq('updated_at', expected.source.updated_at)
    .select('id')
    .maybeSingle()
  throwDbError(result.error)
  return Boolean(result.data)
}

async function markOAuthRefreshFailure(
  backendData: any,
  connection: MailConnectionRow,
  expected: MailConnectionOAuthRefreshState,
  failure: MailOAuthRefreshFailure,
): Promise<boolean> {
  const result = await backendData
    .from('mail_connections')
    .update({
      status: failure.status,
      last_error: failure.message.slice(0, 500),
    })
    .eq('organization_id', connection.organization_id)
    .eq('owner_user_id', connection.owner_user_id)
    .eq('id', connection.id)
    .eq('provider', connection.provider)
    .eq('updated_at', expected.source.updated_at)
    .select('id')
    .maybeSingle()
  throwDbError(result.error)
  return Boolean(result.data)
}

export function decryptImapSmtpCredentials(
  event: H3Event,
  connection: MailConnectionRow,
): ImapSmtpStoredCredentials {
  if (connection.provider !== 'imap' || !connection.encrypted_credentials) {
    throw createError({ statusCode: 500, statusMessage: 'Mail credentials are unavailable' })
  }
  const decrypted = decryptMailSecret(
    event,
    connection.encrypted_credentials,
    tokenSecretContext(connection, 'credentials'),
  )
  try {
    const parsed = JSON.parse(decrypted || '') as Partial<ImapSmtpStoredCredentials>
    if (!parsed.imapPassword || !parsed.smtpPassword) throw new Error('missing credentials')
    return {
      imapPassword: parsed.imapPassword,
      smtpPassword: parsed.smtpPassword,
    }
  }
  catch {
    throw createError({ statusCode: 500, statusMessage: 'Stored mail credentials are invalid' })
  }
}

export async function markMailConnectionStatus(
  backendData: any,
  connection: MailConnectionRow,
  status: MailConnectionStatus,
  errorMessage: string | null,
  verified = false,
): Promise<void> {
  const result = await backendData
    .from('mail_connections')
    .update({
      status,
      last_error: errorMessage?.slice(0, 500) ?? null,
      ...(verified ? { last_verified_at: new Date().toISOString() } : {}),
    })
    .eq('organization_id', connection.organization_id)
    .eq('owner_user_id', connection.owner_user_id)
    .eq('id', connection.id)
  throwDbError(result.error)
}

function tokenSecretContext(
  connection: MailConnectionRow,
  purpose: 'credentials' | 'access-token' | 'refresh-token',
): string {
  return mailConnectionSecretContext({
    organizationId: connection.organization_id,
    ownerUserId: connection.owner_user_id,
    connectionId: connection.id,
    purpose,
  })
}

async function refreshMicrosoftToken(event: H3Event, refreshToken: string) {
  const module = await import('./mail-microsoft-runtime.ts')
  return module.refreshMicrosoftMailRuntimeToken(event, refreshToken)
}

function providerLabel(provider: MailProviderId): string {
  if (provider === 'google') return 'Gmail'
  if (provider === 'microsoft') return 'Outlook'
  return 'IMAP/SMTP'
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(value)
}
