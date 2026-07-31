import { serverDataBackend } from '~~/server/utils/data-api'
import {
  deleteCookie,
  getCookie,
  getQuery,
  sendRedirect,
  type H3Event,
} from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  textValue,
  throwDbError,
} from '~~/server/utils/crm'
import {
  MAIL_OAUTH_COOKIE,
  decodeMailOAuthFlow,
} from '~~/server/utils/mail-connections'
import {
  encryptMailSecret,
  exchangeMailOAuthCode,
  fetchMailProviderIdentity,
  mailTokenIncludesReadAccess,
  mailTokenIncludesSendAccess,
} from '~~/server/utils/mail-providers'

export default defineEventHandler(async (event) => {
  const provider = getRequiredParam(event, 'provider')
  if (provider !== 'google') {
    throw createError({ statusCode: 404, statusMessage: 'Mail provider not found' })
  }

  const flow = decodeMailOAuthFlow(event, getCookie(event, MAIL_OAUTH_COOKIE))
  deleteCookie(event, MAIL_OAUTH_COOKIE, { path: '/api/mail/oauth' })
  const query = getQuery(event)
  const state = textValue(query.state)
  if (
    flow.provider !== provider
    || !state
    || state !== flow.state
    || flow.expiresAt < Date.now()
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth state is invalid or expired' })
  }

  const session = await requireCrmSession(event, flow.organizationSlug)
  if (session.userId !== flow.ownerUserId) {
    throw createError({ statusCode: 403, statusMessage: 'Mail OAuth user does not match the current session' })
  }
  if (textValue(query.error)) {
    return redirectWithStatus(event, flow.returnTo, 'cancelled')
  }
  const code = textValue(query.code)
  if (!code) {
    throw createError({ statusCode: 400, statusMessage: 'Mail OAuth code is missing' })
  }

  try {
    const token = await exchangeMailOAuthCode(event, code, flow.codeVerifier)
    if (
      !mailTokenIncludesReadAccess(token.scopes)
      || !mailTokenIncludesSendAccess(token.scopes)
    ) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Gmail read and send access was not granted',
      })
    }
    const identity = await fetchMailProviderIdentity(token.accessToken)
    if (
      flow.expectedAccountId
      && identity.accountId !== flow.expectedAccountId
    ) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Reconnect the same Gmail account to extend its permissions',
      })
    }
    const backendData = serverDataBackend(event) as any
    const { data: existing, error: existingError } = await backendData
      .from('mail_connections')
      .select('id, account_id, encrypted_refresh_token')
      .eq('organization_id', session.organizationId)
      .eq('owner_user_id', session.userId)
      .eq('provider', 'google')
      .maybeSingle()
    throwDbError(existingError)

    const encryptedRefreshToken = token.refreshToken
      ? encryptMailSecret(event, token.refreshToken)
      : existing?.account_id === identity.accountId
        ? existing.encrypted_refresh_token ?? null
        : null
    if (!encryptedRefreshToken) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Google returned no refresh token; reconnect Gmail with consent',
      })
    }

    const values = {
      organization_id: session.organizationId,
      owner_user_id: session.userId,
      provider: 'google',
      account_id: identity.accountId,
      account_email: identity.email,
      encrypted_access_token: encryptMailSecret(event, token.accessToken),
      encrypted_refresh_token: encryptedRefreshToken,
      token_expires_at: token.expiresAt,
      scopes: token.scopes,
      status: 'active',
      last_error: null,
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

    return redirectWithStatus(event, flow.returnTo, 'connected')
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode)
    const statusMessage = String(
      (error as { statusMessage?: string })?.statusMessage ?? '',
    )
    if (statusCode === 403 && statusMessage.includes('read and send access')) {
      return redirectWithStatus(event, flow.returnTo, 'permission_missing')
    }
    if (statusCode === 409 && statusMessage.includes('same Gmail account')) {
      return redirectWithStatus(event, flow.returnTo, 'account_mismatch')
    }
    return redirectWithStatus(event, flow.returnTo, 'error')
  }
})

function redirectWithStatus(
  event: H3Event,
  returnTo: string,
  status: 'connected' | 'cancelled' | 'permission_missing' | 'account_mismatch' | 'error',
) {
  const parsed = new URL(returnTo, 'https://openexpert.invalid')
  parsed.searchParams.set('mailStatus', status)
  return sendRedirect(event, `${parsed.pathname}${parsed.search}`, 302)
}
