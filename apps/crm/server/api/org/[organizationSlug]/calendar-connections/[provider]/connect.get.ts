import { getQuery, sendRedirect, setCookie } from 'h3'
import { requireCrmSession, getRequiredParam, requiredText, textValue } from '~~/server/utils/crm'
import {
  CALENDAR_OAUTH_COOKIE,
  calendarOAuthCookieOptions,
  encodeCalendarOAuthFlow,
  requireCalendarOwnerManager,
  type CalendarConnectionOwnerKind,
} from '~~/server/utils/calendar-connections'
import {
  calendarAuthorizationUrl,
  calendarOAuthPkce,
  calendarOAuthState,
  type CalendarProviderName,
} from '~~/server/utils/calendar-providers'

export default defineEventHandler(async (event) => {
  const provider = getRequiredParam(event, 'provider') as CalendarProviderName
  if (!['google', 'microsoft'].includes(provider)) {
    throw createError({ statusCode: 404, statusMessage: 'Calendar provider not found' })
  }

  const session = await requireCrmSession(event)
  const query = getQuery(event)
  const ownerKind = (textValue(query.ownerKind) ?? 'facility') as CalendarConnectionOwnerKind
  if (!['facility', 'expert'].includes(ownerKind)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid calendar owner kind' })
  }
  const ownerId = requiredText(query.ownerId, 'ownerId')
  await requireCalendarOwnerManager(session, ownerKind, ownerId)

  const state = calendarOAuthState()
  const pkce = calendarOAuthPkce()
  const returnTo = textValue(query.returnTo)
  const safeReturnTo = returnTo?.startsWith(`/org/${session.organizationSlug}/`)
    ? returnTo
    : `/org/${encodeURIComponent(session.organizationSlug)}/facilities/${encodeURIComponent(ownerId)}?section=calendars`

  setCookie(
    event,
    CALENDAR_OAUTH_COOKIE,
    encodeCalendarOAuthFlow(event, {
      state,
      provider,
      organizationSlug: session.organizationSlug,
      ownerKind,
      ownerId,
      returnTo: safeReturnTo,
      codeVerifier: pkce.verifier,
      expiresAt: Date.now() + 10 * 60 * 1000,
    }),
    calendarOAuthCookieOptions(event),
  )

  return sendRedirect(event, calendarAuthorizationUrl(event, provider, state, pkce.challenge), 302)
})
