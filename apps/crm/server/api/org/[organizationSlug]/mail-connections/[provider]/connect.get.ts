import { getQuery, sendRedirect, setCookie } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  textValue,
} from '~~/server/utils/crm'
import {
  MAIL_OAUTH_COOKIE,
  encodeMailOAuthFlow,
  loadUserMailConnection,
  mailOAuthCookieOptions,
} from '~~/server/utils/mail-connections'
import {
  mailAuthorizationUrl,
  mailOAuthPkce,
  mailOAuthState,
} from '~~/server/utils/mail-providers'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'

export default defineEventHandler(async (event) => {
  setPrivateMailResponseHeaders(event)
  const provider = getRequiredParam(event, 'provider')
  if (provider !== 'google') {
    throw createError({ statusCode: 404, statusMessage: 'Mail provider not found' })
  }

  const session = await requireCrmSession(event)
  const defaultReturnTo = `/org/${encodeURIComponent(session.organizationSlug)}/mail`
  const returnTo = safeReturnTo(
    textValue(getQuery(event).returnTo),
    defaultReturnTo,
  )
  const state = mailOAuthState()
  const pkce = mailOAuthPkce()
  const { connection } = await loadUserMailConnection(event, session)

  setCookie(
    event,
    MAIL_OAUTH_COOKIE,
    encodeMailOAuthFlow(event, {
      state,
      provider: 'google',
      organizationSlug: session.organizationSlug,
      ownerUserId: session.userId,
      returnTo,
      codeVerifier: pkce.verifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
      expectedAccountId: connection?.account_id,
    }),
    mailOAuthCookieOptions(event),
  )

  return sendRedirect(
    event,
    mailAuthorizationUrl(
      event,
      state,
      pkce.challenge,
      connection?.account_email || session.email,
    ),
    302,
  )
})

function safeReturnTo(value: string | undefined, defaultReturnTo: string): string {
  if (!value) return defaultReturnTo
  try {
    const base = new URL('https://openexpert.invalid')
    const parsed = new URL(value, base)
    if (
      parsed.origin !== base.origin
      || parsed.pathname !== defaultReturnTo
    ) {
      return defaultReturnTo
    }
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return defaultReturnTo
  }
}
