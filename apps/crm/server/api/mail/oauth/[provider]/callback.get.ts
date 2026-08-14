import { randomUUID } from 'node:crypto'
import { serverDataBackend } from '~~/server/utils/data-api'
import {
  deleteCookie,
  getCookie,
  getQuery,
  sendRedirect,
  type H3Event,
} from 'h3'
import type { MailProviderId } from '../../../../../shared/types/mail.ts'
import {
  getRequiredParam,
  requireCrmSession,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import {
  MAIL_OAUTH_COOKIE,
  decodeMailOAuthFlow,
  legacyMailOAuthCookieOptions,
  mailOAuthFlowCookieName,
  mailOAuthCookieOptions,
} from '~~/server/utils/mail-connections'
import {
  encryptMailSecret,
  mailConnectionSecretContext,
} from '~~/server/utils/mail-crypto'
import {
  exchangeMailOAuthCode,
  fetchMailProviderIdentity,
  mailTokenIncludesReadAccess,
  mailTokenIncludesSendAccess,
  revokeMailOAuthToken,
  type MailOAuthTokenSet,
} from '~~/server/utils/mail-providers'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'

type OAuthMailProvider = Extract<MailProviderId, 'google' | 'microsoft'>
type OAuthStatus = 'connected' | 'cancelled' | 'permission_missing' | 'account_mismatch' | 'error'

interface OAuthMailIdentity {
  accountId: string
  email: string
  displayName?: string | null
}

export default defineEventHandler(async (event) => {
  setPrivateMailResponseHeaders(event)
  const provider = getRequiredParam(event, 'provider') as OAuthMailProvider
  if (!['google', 'microsoft'].includes(provider)) {
    throw createError({ statusCode: 404, statusMessage: 'Mail provider not found' })
  }

  const query = getQuery(event)
  const state = textValue(query.state)
  if (!state) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth state is missing' })
  }
  const flowCookieName = mailOAuthFlowCookieName(state)
  const keyedFlow = getCookie(event, flowCookieName)
  const legacyFlow = keyedFlow ? undefined : getCookie(event, MAIL_OAUTH_COOKIE)
  const flow = decodeMailOAuthFlow(event, keyedFlow || legacyFlow, state)
  deleteCookie(
    event,
    keyedFlow ? flowCookieName : MAIL_OAUTH_COOKIE,
    keyedFlow ? mailOAuthCookieOptions(event) : legacyMailOAuthCookieOptions(event),
  )
  if (flow.provider !== provider) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth provider does not match the request' })
  }
  if (!state || state !== flow.state) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth state does not match the request' })
  }
  if (flow.expiresAt < Date.now()) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth request expired' })
  }

  const session = await requireCrmSession(event, flow.organizationSlug)
  if (session.userId !== flow.ownerUserId) {
    throw createError({ statusCode: 403, statusMessage: 'Mail OAuth user does not match the current session' })
  }
  if (textValue(query.error)) {
    return redirectWithStatus(event, flow.returnTo, provider, 'cancelled')
  }
  const code = textValue(query.code)
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth code is missing' })
  }

  let token: MailOAuthTokenSet | null = null
  try {
    token = await exchangeProviderCode(event, provider, code, flow.codeVerifier)
    if (!tokenIncludesRequiredAccess(provider, token.scopes)) {
      await revokeRejectedMailToken(provider, token)
      throw createError({
        statusCode: 403,
        statusMessage: 'Mail read and send access was not granted',
      })
    }
    const identity = await fetchProviderIdentity(provider, token.accessToken)
    if (flow.expectedAccountId && identity.accountId !== flow.expectedAccountId) {
      await revokeRejectedMailToken(provider, token)
      throw createError({
        statusCode: 409,
        statusMessage: 'Reconnect the same mail account to extend its permissions',
      })
    }

    const backendData = serverDataBackend(event) as any
    const existingByAccount = await backendData
      .from('mail_connections')
      .select('id, account_id, encrypted_refresh_token')
      .eq('organization_id', session.organizationId)
      .eq('owner_user_id', session.userId)
      .eq('provider', provider)
      .eq('account_id', identity.accountId)
      .maybeSingle()
    throwDbError(existingByAccount.error)

    let replacement: {
      id: string
      account_id: string
      encrypted_refresh_token: string | null
    } | null = null
    if (flow.replacementConnectionId) {
      const result = await backendData
        .from('mail_connections')
        .select('id, account_id, encrypted_refresh_token')
        .eq('organization_id', session.organizationId)
        .eq('owner_user_id', session.userId)
        .eq('provider', provider)
        .eq('id', flow.replacementConnectionId)
        .maybeSingle()
      throwDbError(result.error)
      replacement = result.data
      if (!replacement) {
        throw createError({ statusCode: 404, statusMessage: 'Mail connection not found' })
      }
    }
    const existing = replacement || existingByAccount.data
    const connectionId = existing?.id || randomUUID()
    const refreshContext = mailConnectionSecretContext({
      organizationId: session.organizationId,
      ownerUserId: session.userId,
      connectionId,
      purpose: 'refresh-token',
    })
    const accessContext = mailConnectionSecretContext({
      organizationId: session.organizationId,
      ownerUserId: session.userId,
      connectionId,
      purpose: 'access-token',
    })
    const encryptedRefreshToken = token.refreshToken
      ? encryptMailSecret(event, token.refreshToken, refreshContext)
      : existing?.account_id === identity.accountId
        ? existing.encrypted_refresh_token ?? null
        : null
    if (!encryptedRefreshToken) {
      await revokeRejectedMailToken(provider, token)
      throw createError({
        statusCode: 409,
        statusMessage: 'Mail provider returned no refresh token; reconnect with consent',
      })
    }

    const values = {
      id: connectionId,
      organization_id: session.organizationId,
      owner_user_id: session.userId,
      provider,
      account_id: identity.accountId,
      account_email: identity.email.trim().toLowerCase(),
      display_name: identity.displayName?.trim().slice(0, 120) || null,
      auth_type: 'oauth2',
      encrypted_access_token: encryptMailSecret(event, token.accessToken, accessContext),
      encrypted_refresh_token: encryptedRefreshToken,
      encrypted_credentials: null,
      token_expires_at: token.expiresAt,
      scopes: token.scopes,
      status: 'active',
      last_error: null,
      last_verified_at: new Date().toISOString(),
    }
    const result = existing?.id
      ? await backendData
          .from('mail_connections')
          .update(values)
          .eq('organization_id', session.organizationId)
          .eq('owner_user_id', session.userId)
          .eq('id', existing.id)
      : await backendData.from('mail_connections').insert(values)
    throwDbError(result.error)

    return redirectWithStatus(
      event,
      flow.returnTo,
      provider,
      'connected',
      connectionId,
    )
  }
  catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode)
    const statusMessage = String(
      (error as { statusMessage?: string })?.statusMessage ?? '',
    )
    if (statusCode === 403 && statusMessage.includes('read and send access')) {
      return redirectWithStatus(event, flow.returnTo, provider, 'permission_missing')
    }
    if (statusCode === 409 && statusMessage.includes('same mail account')) {
      return redirectWithStatus(event, flow.returnTo, provider, 'account_mismatch')
    }
    return redirectWithStatus(event, flow.returnTo, provider, 'error')
  }
})

async function exchangeProviderCode(
  event: H3Event,
  provider: OAuthMailProvider,
  code: string,
  codeVerifier: string,
): Promise<MailOAuthTokenSet> {
  if (provider === 'google') return exchangeMailOAuthCode(event, code, codeVerifier)
  const module = await import('~~/server/utils/mail-microsoft-runtime')
  return module.exchangeMicrosoftMailRuntimeCode(event, code, codeVerifier)
}

async function fetchProviderIdentity(
  provider: OAuthMailProvider,
  accessToken: string,
): Promise<OAuthMailIdentity> {
  if (provider === 'google') return fetchMailProviderIdentity(accessToken)
  const module = await import('~~/server/utils/mail-microsoft')
  return module.fetchMicrosoftMailIdentity(accessToken)
}

function tokenIncludesRequiredAccess(
  provider: OAuthMailProvider,
  scopes: string[],
): boolean {
  if (provider === 'google') {
    return mailTokenIncludesReadAccess(scopes) && mailTokenIncludesSendAccess(scopes)
  }
  const normalized = new Set(scopes.map(scope => scope.toLowerCase()))
  return (
    normalized.has('mail.readwrite')
    && normalized.has('mail.send')
    && normalized.has('user.read')
  )
}

async function revokeRejectedMailToken(
  provider: OAuthMailProvider,
  token: Pick<MailOAuthTokenSet, 'accessToken' | 'refreshToken'>,
): Promise<void> {
  if (provider !== 'google') return
  try {
    await revokeMailOAuthToken(token.refreshToken || token.accessToken)
  }
  catch {
    // A rejected token is never persisted. Google revocation is best-effort.
  }
}

function redirectWithStatus(
  event: H3Event,
  returnTo: string,
  provider: OAuthMailProvider,
  status: OAuthStatus,
  connectionId?: string,
) {
  const parsed = new URL(returnTo, 'https://openexpert.invalid')
  parsed.searchParams.set('mailStatus', status)
  parsed.searchParams.set('mailProvider', provider)
  if (connectionId) parsed.searchParams.set('account', connectionId)
  return sendRedirect(event, `${parsed.pathname}${parsed.search}`, 302)
}
