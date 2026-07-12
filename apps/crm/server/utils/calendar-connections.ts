import { createError, getRequestURL, type H3Event } from 'h3'
import type { CrmSession } from './crm'
import {
  decryptCalendarToken,
  encryptCalendarToken,
  type CalendarProviderName,
} from './calendar-providers'
import { requireFacilityPermission } from './scheduling'

export type CalendarConnectionOwnerKind = 'facility' | 'expert'

export interface CalendarOAuthFlow {
  state: string
  provider: CalendarProviderName
  organizationSlug: string
  ownerKind: CalendarConnectionOwnerKind
  ownerId: string
  returnTo: string
  codeVerifier: string
  expiresAt: number
}

export const CALENDAR_OAUTH_COOKIE = 'openexpert-calendar-oauth'

export function calendarOAuthCookieOptions(event: H3Event) {
  const forwardedProto = event.headers.get('x-forwarded-proto')
  const secure = forwardedProto
    ? forwardedProto === 'https'
    : getRequestURL(event).protocol === 'https:'
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/api/calendar/oauth',
    maxAge: 10 * 60,
  }
}

export function encodeCalendarOAuthFlow(event: H3Event, flow: CalendarOAuthFlow): string {
  const encrypted = encryptCalendarToken(event, JSON.stringify(flow))
  if (!encrypted) throw createError({ statusCode: 500, statusMessage: 'Calendar OAuth flow could not be secured' })
  return encrypted
}

export function decodeCalendarOAuthFlow(event: H3Event, value: string | undefined): CalendarOAuthFlow {
  if (!value) throw createError({ statusCode: 400, statusMessage: 'Calendar OAuth flow cookie is missing' })
  try {
    const decrypted = decryptCalendarToken(event, value)
    const parsed = JSON.parse(decrypted || '') as CalendarOAuthFlow
    if (
      !parsed.state
      || !['google', 'microsoft'].includes(parsed.provider)
      || !parsed.organizationSlug
      || !['facility', 'expert'].includes(parsed.ownerKind)
      || !parsed.ownerId
      || !parsed.codeVerifier
      || !parsed.expiresAt
    ) throw new Error('invalid flow')
    return parsed
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Calendar OAuth flow cookie is invalid' })
  }
}

export async function requireCalendarOwnerManager(
  session: CrmSession,
  ownerKind: CalendarConnectionOwnerKind,
  ownerId: string,
): Promise<void> {
  if (ownerKind === 'expert') {
    if (ownerId !== session.userId && session.role !== 'admin') {
      throw createError({ statusCode: 403, statusMessage: 'You can connect only your own expert calendar' })
    }
    const { data, error } = await session.supabase
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', ownerId)
      .maybeSingle()
    if (error || !data) throw createError({ statusCode: 404, statusMessage: 'Expert not found' })
    return
  }

  await requireFacilityPermission(session, ownerId, 'manage')
}
