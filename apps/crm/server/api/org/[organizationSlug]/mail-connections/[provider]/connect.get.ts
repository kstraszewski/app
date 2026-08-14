import { getQuery, sendRedirect, setCookie } from 'h3'
import type { MailProviderId } from '../../../../../../shared/types/mail.ts'
import {
  getRequiredParam,
  requireCrmSession,
  textValue,
} from '~~/server/utils/crm'
import {
  encodeMailOAuthFlow,
  loadUserMailConnection,
  mailOAuthFlowCookieName,
  mailOAuthCookieOptions,
  pruneMailOAuthFlowCookies,
} from '~~/server/utils/mail-connections'
import {
  mailAuthorizationUrl,
  mailOAuthPkce,
  mailOAuthState,
} from '~~/server/utils/mail-providers'
import { safeMailOAuthReturnTo } from '~~/server/utils/mail-oauth-flow'
import { setPrivateMailResponseHeaders } from '~~/server/utils/mail-http'

type OAuthMailProvider = Extract<MailProviderId, 'google' | 'microsoft'>

export default defineEventHandler(async (event) => {
  setPrivateMailResponseHeaders(event)
  const provider = getRequiredParam(event, 'provider') as OAuthMailProvider
  if (!['google', 'microsoft'].includes(provider)) {
    throw createError({ statusCode: 404, statusMessage: 'Mail provider not found' })
  }

  const session = await requireCrmSession(event)
  const query = getQuery(event)
  const returnTo = safeMailOAuthReturnTo(
    textValue(query.returnTo),
    session.organizationSlug,
  )
  const replacementConnectionId = textValue(query.connectionId)
  const connection = replacementConnectionId
    ? (await loadUserMailConnection(event, session, replacementConnectionId)).connection
    : null
  if (replacementConnectionId && (!connection || connection.provider !== provider)) {
    throw createError({ statusCode: 404, statusMessage: 'Mail connection not found' })
  }

  const state = mailOAuthState()
  const pkce = mailOAuthPkce()
  pruneMailOAuthFlowCookies(event)
  setCookie(
    event,
    mailOAuthFlowCookieName(state),
    encodeMailOAuthFlow(event, {
      state,
      provider,
      organizationSlug: session.organizationSlug,
      ownerUserId: session.userId,
      returnTo,
      codeVerifier: pkce.verifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
      replacementConnectionId: connection?.id,
      expectedAccountId: connection?.account_id,
    }),
    mailOAuthCookieOptions(event),
  )

  const loginHint = connection?.account_email || session.email
  const authorizationUrl = provider === 'google'
    ? mailAuthorizationUrl(event, state, pkce.challenge, loginHint)
    : await microsoftAuthorizationUrl(event, state, pkce.challenge, loginHint)
  return sendRedirect(event, authorizationUrl, 302)
})

async function microsoftAuthorizationUrl(
  event: Parameters<typeof mailAuthorizationUrl>[0],
  state: string,
  codeChallenge: string,
  loginHint?: string,
): Promise<string> {
  const module = await import('~~/server/utils/mail-microsoft-runtime')
  return module.microsoftMailRuntimeAuthorizationUrl(
    event,
    state,
    codeChallenge,
    loginHint,
  )
}
