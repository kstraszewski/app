import { serverSupabaseServiceRole } from '#supabase/server'
import { getQuery } from 'h3'
import { requireCrmSession, textValue, throwDbError } from '~~/server/utils/crm'
import { requireFacilityPermission, uuidValue } from '~~/server/utils/scheduling'
import type { CalendarConnectionOwnerKind } from '~~/server/utils/calendar-connections'
import { calendarProviderAvailability, type CalendarProviderName } from '~~/server/utils/calendar-providers'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const query = getQuery(event)
  const ownerKind = (textValue(query.ownerKind) ?? 'facility') as CalendarConnectionOwnerKind
  if (!['facility', 'expert'].includes(ownerKind)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid calendar owner kind' })
  }
  const ownerId = uuidValue(query.ownerId, 'ownerId')

  let canManage = false
  if (ownerKind === 'facility') {
    const access = await requireFacilityPermission(session, ownerId, 'view')
    canManage = access.canManage
  } else {
    const { data: member, error } = await session.supabase
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', ownerId)
      .maybeSingle()
    throwDbError(error)
    if (!member) throw createError({ statusCode: 404, statusMessage: 'Expert not found' })
    canManage = ownerId === session.userId || session.role === 'admin'
    if (!canManage) throw createError({ statusCode: 403, statusMessage: 'Expert calendar access denied' })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  let connectionQuery = serviceRole
    .from('calendar_connections')
    .select('id, provider, account_email, selected_calendar_id, selected_calendar_name, status, last_synced_at, last_error, updated_at')
    .eq('organization_id', session.organizationId)
    .eq('owner_kind', ownerKind)
  connectionQuery = ownerKind === 'facility'
    ? connectionQuery.eq('facility_id', ownerId)
    : connectionQuery.eq('owner_user_id', ownerId)
  const { data: connections, error: connectionsError } = await connectionQuery.order('provider')
  throwDbError(connectionsError)

  const availability = calendarProviderAvailability(event)
  const providers = (['google', 'microsoft'] as CalendarProviderName[]).map(provider => ({
    provider,
    label: provider === 'google' ? 'Google Calendar' : 'Outlook / Microsoft 365',
    enabled: availability[provider],
    connectPath: canManage && availability[provider]
      ? `/api/org/${encodeURIComponent(session.organizationSlug)}/calendar-connections/${provider}/connect?ownerKind=${ownerKind}&ownerId=${encodeURIComponent(ownerId)}&returnTo=${encodeURIComponent(`/org/${session.organizationSlug}/facilities/${ownerId}?section=calendars`)}`
      : null,
  }))

  return {
    ownerKind,
    ownerId,
    canManage,
    data: (connections ?? []).map((connection: any) => ({
      id: String(connection.id),
      provider: connection.provider,
      status: connection.status,
      providerAccountEmail: connection.account_email,
      externalCalendarId: connection.selected_calendar_id,
      externalCalendarName: connection.selected_calendar_name,
      lastSyncedAt: connection.last_synced_at,
      errorMessage: connection.last_error,
      updatedAt: connection.updated_at,
    })),
    providers,
  }
})
