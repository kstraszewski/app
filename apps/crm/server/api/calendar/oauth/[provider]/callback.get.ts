import { serverSupabaseServiceRole } from '#supabase/server'
import { deleteCookie, getCookie, getQuery, sendRedirect } from 'h3'
import { requireCrmSession, getRequiredParam, textValue, throwDbError } from '~~/server/utils/crm'
import {
  CALENDAR_OAUTH_COOKIE,
  decodeCalendarOAuthFlow,
  requireCalendarOwnerManager,
} from '~~/server/utils/calendar-connections'
import {
  encryptCalendarToken,
  exchangeCalendarOAuthCode,
  fetchProviderIdentity,
  type CalendarProviderName,
} from '~~/server/utils/calendar-providers'

export default defineEventHandler(async (event) => {
  const provider = getRequiredParam(event, 'provider') as CalendarProviderName
  if (!['google', 'microsoft'].includes(provider)) {
    throw createError({ statusCode: 404, statusMessage: 'Calendar provider not found' })
  }

  const flow = decodeCalendarOAuthFlow(event, getCookie(event, CALENDAR_OAUTH_COOKIE))
  deleteCookie(event, CALENDAR_OAUTH_COOKIE, { path: '/api/calendar/oauth' })
  const query = getQuery(event)
  const state = textValue(query.state)
  if (flow.provider !== provider || !state || state !== flow.state || flow.expiresAt < Date.now()) {
    throw createError({ statusCode: 400, statusMessage: 'Calendar OAuth state is invalid or expired' })
  }

  const session = await requireCrmSession(event, flow.organizationSlug)
  await requireCalendarOwnerManager(session, flow.ownerKind, flow.ownerId)
  if (textValue(query.error)) {
    return redirectWithStatus(event, flow.returnTo, provider, 'cancelled')
  }
  const code = textValue(query.code)
  if (!code) throw createError({ statusCode: 400, statusMessage: 'Calendar OAuth code is missing' })

  try {
    const token = await exchangeCalendarOAuthCode(event, provider, code, flow.codeVerifier)
    const identity = await fetchProviderIdentity(provider, token.accessToken)
    const targetCalendar = identity.calendars.find(calendar => calendar.isPrimary && calendar.canWrite)
      ?? identity.calendars.find(calendar => calendar.canWrite)
    if (!targetCalendar) {
      throw createError({ statusCode: 409, statusMessage: 'Connected account has no writable calendar' })
    }

    const serviceRole = serverSupabaseServiceRole(event) as any
    let existingQuery = serviceRole
      .from('calendar_connections')
      .select('id, account_id, encrypted_refresh_token')
      .eq('organization_id', session.organizationId)
      .eq('owner_kind', flow.ownerKind)
      .eq('provider', provider)
    existingQuery = flow.ownerKind === 'facility'
      ? existingQuery.eq('facility_id', flow.ownerId).is('owner_user_id', null)
      : existingQuery.eq('owner_user_id', flow.ownerId).is('facility_id', null)
    const { data: existing, error: existingError } = await existingQuery.maybeSingle()
    throwDbError(existingError)

    const values = {
      organization_id: session.organizationId,
      owner_kind: flow.ownerKind,
      owner_user_id: flow.ownerKind === 'expert' ? flow.ownerId : null,
      facility_id: flow.ownerKind === 'facility' ? flow.ownerId : null,
      provider,
      account_id: identity.accountId || identity.email,
      account_email: identity.email.trim().toLowerCase() || null,
      encrypted_access_token: encryptCalendarToken(event, token.accessToken),
      encrypted_refresh_token: token.refreshToken
        ? encryptCalendarToken(event, token.refreshToken)
        : existing?.account_id === (identity.accountId || identity.email)
          ? existing.encrypted_refresh_token ?? null
          : null,
      token_expires_at: token.expiresAt,
      scopes: token.scopes,
      selected_calendar_id: targetCalendar.id,
      selected_calendar_name: targetCalendar.name,
      read_calendar_ids: [targetCalendar.id],
      status: 'active',
      last_error: null,
    }

    const result = existing?.id
      ? await serviceRole.from('calendar_connections').update(values).eq('id', existing.id)
      : await serviceRole.from('calendar_connections').insert(values)
    throwDbError(result.error)
    return redirectWithStatus(event, flow.returnTo, provider, 'connected')
  } catch {
    return redirectWithStatus(event, flow.returnTo, provider, 'error')
  }
})

function redirectWithStatus(
  event: Parameters<typeof sendRedirect>[0],
  returnTo: string,
  provider: CalendarProviderName,
  status: 'connected' | 'cancelled' | 'error',
) {
  const separator = returnTo.includes('?') ? '&' : '?'
  const target = `${returnTo}${separator}calendarProvider=${provider}&calendarStatus=${status}`
  return sendRedirect(event, target, 302)
}
