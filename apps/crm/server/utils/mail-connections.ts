import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, getRequestURL, type H3Event } from 'h3'
import type { CrmSession } from './crm.ts'
import { throwDbError } from './crm.ts'
import {
  decryptMailSecret,
  encryptMailSecret,
  refreshMailOAuthToken,
} from './mail-providers.ts'

export interface MailOAuthFlow {
  state: string
  provider: 'google'
  organizationSlug: string
  ownerUserId: string
  returnTo: string
  codeVerifier: string
  expiresAt: number
  expectedAccountId?: string
}

export interface MailConnectionRow {
  id: string
  organization_id: string
  owner_user_id: string
  provider: 'google'
  account_id: string
  account_email: string
  encrypted_access_token: string | null
  encrypted_refresh_token: string | null
  token_expires_at: string | null
  scopes: string[] | null
  status: 'active' | 'error' | 'revoked'
  last_error: string | null
  updated_at: string
}

export const MAIL_OAUTH_COOKIE = 'openexpert-mail-oauth'

export function mailOAuthCookieOptions(event: H3Event) {
  const forwardedProto = event.headers.get('x-forwarded-proto')
  const secure = forwardedProto
    ? forwardedProto === 'https'
    : getRequestURL(event).protocol === 'https:'
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/api/mail/oauth',
    maxAge: 10 * 60,
  }
}

export function encodeMailOAuthFlow(event: H3Event, flow: MailOAuthFlow): string {
  const encrypted = encryptMailSecret(event, JSON.stringify(flow))
  if (!encrypted) {
    throw createError({ statusCode: 500, statusMessage: 'Mail OAuth flow could not be secured' })
  }
  return encrypted
}

export function decodeMailOAuthFlow(
  event: H3Event,
  value: string | undefined,
): MailOAuthFlow {
  if (!value) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth flow cookie is missing' })
  }
  try {
    const decrypted = decryptMailSecret(event, value)
    const parsed = JSON.parse(decrypted || '') as MailOAuthFlow
    if (
      !parsed.state
      || parsed.provider !== 'google'
      || !parsed.organizationSlug
      || !parsed.ownerUserId
      || !parsed.returnTo
      || !parsed.codeVerifier
      || !parsed.expiresAt
      || (
        parsed.expectedAccountId !== undefined
        && (
          typeof parsed.expectedAccountId !== 'string'
          || !parsed.expectedAccountId
          || parsed.expectedAccountId.length > 500
        )
      )
    ) {
      throw new Error('invalid flow')
    }
    return parsed
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'statusCode' in error
      && Number((error as { statusCode?: number }).statusCode) >= 500
    ) {
      throw error
    }
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth flow cookie is invalid' })
  }
}

export async function loadUserMailConnection(
  event: H3Event,
  session: CrmSession,
): Promise<{ backendData: any; connection: MailConnectionRow | null }> {
  const backendData = serverDataBackend(event) as any
  const { data, error } = await backendData
    .from('mail_connections')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('owner_user_id', session.userId)
    .eq('provider', 'google')
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
): Promise<{ backendData: any; connection: MailConnectionRow }> {
  const loaded = await loadUserMailConnection(event, session)
  if (!loaded.connection) {
    throw createError({ statusCode: 409, statusMessage: 'Connect Gmail to continue' })
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
  const accessToken = decryptMailSecret(event, connection.encrypted_access_token)
  const expiresAt = connection.token_expires_at
    ? new Date(connection.token_expires_at).getTime()
    : 0
  if (accessToken && expiresAt > Date.now() + 2 * 60 * 1000) return accessToken

  const refreshToken = decryptMailSecret(event, connection.encrypted_refresh_token)
  if (!refreshToken) {
    await markMailConnectionStatus(
      backendData,
      connection,
      'revoked',
      'Gmail connection must be reconnected',
    )
    throw createError({ statusCode: 409, statusMessage: 'Reconnect Gmail to continue' })
  }

  try {
    const refreshed = await refreshMailOAuthToken(event, refreshToken)
    const update = await backendData
      .from('mail_connections')
      .update({
        encrypted_access_token: encryptMailSecret(event, refreshed.accessToken),
        encrypted_refresh_token: encryptMailSecret(event, refreshed.refreshToken),
        token_expires_at: refreshed.expiresAt,
        scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes,
        status: 'active',
        last_error: null,
      })
      .eq('organization_id', connection.organization_id)
      .eq('owner_user_id', connection.owner_user_id)
      .eq('id', connection.id)
    throwDbError(update.error)
    return refreshed.accessToken
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode)
    await markMailConnectionStatus(
      backendData,
      connection,
      statusCode === 409 ? 'revoked' : 'error',
      error instanceof Error ? error.message.slice(0, 500) : 'Gmail token refresh failed',
    )
    throw error
  }
}

export async function markMailConnectionStatus(
  backendData: any,
  connection: MailConnectionRow,
  status: MailConnectionRow['status'],
  errorMessage: string | null,
): Promise<void> {
  const result = await backendData
    .from('mail_connections')
    .update({
      status,
      last_error: errorMessage?.slice(0, 500) ?? null,
    })
    .eq('organization_id', connection.organization_id)
    .eq('owner_user_id', connection.owner_user_id)
    .eq('id', connection.id)
  throwDbError(result.error)
}
