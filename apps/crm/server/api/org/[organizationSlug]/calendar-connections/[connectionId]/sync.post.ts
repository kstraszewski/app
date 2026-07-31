import { serverDataBackend } from '~~/server/utils/data-api'
import { createHash } from 'node:crypto'
import { requireCrmSession, getRequiredParam, throwDbError } from '~~/server/utils/crm'
import {
  requireCalendarOwnerManager,
  type CalendarConnectionOwnerKind,
} from '~~/server/utils/calendar-connections'
import {
  decryptCalendarToken,
  encryptCalendarToken,
  fetchProviderBusyBlocks,
  refreshCalendarOAuthToken,
  writeProviderAppointmentEvent,
  deleteProviderAppointmentEvent,
  type CalendarProviderName,
} from '~~/server/utils/calendar-providers'
import { uuidValue } from '~~/server/utils/scheduling'

type ConnectionRow = {
  id: string
  organization_id: string
  owner_kind: CalendarConnectionOwnerKind
  owner_user_id: string | null
  facility_id: string | null
  provider: CalendarProviderName
  encrypted_access_token: string | null
  encrypted_refresh_token: string | null
  token_expires_at: string | null
  scopes: string[] | null
  selected_calendar_id: string | null
  read_calendar_ids: string[] | null
}

type AppointmentRow = {
  id: string
  facility_id: string
  service_id: string
  expert_user_id: string | null
  starts_at: string
  ends_at: string
  timezone: string
  status: string
  meeting_mode: 'office' | 'online'
  meeting_url: string | null
}

type FacilityInfo = {
  id: string
  name: string
  address_line1: string | null
  address_line2: string | null
  postal_code: string | null
  city: string | null
}

type EventLink = {
  id: string
  appointment_id: string
  calendar_id: string
  external_event_id: string
  provider_etag: string | null
  source_fingerprint: string | null
  sync_status: string
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const connectionId = uuidValue(getRequiredParam(event, 'connectionId'), 'connectionId')
  const backendData = serverDataBackend(event) as any
  const { data: connectionData, error: connectionError } = await backendData
    .from('calendar_connections')
    .select('*')
    .eq('organization_id', session.organizationId)
    .eq('id', connectionId)
    .maybeSingle()
  throwDbError(connectionError)
  if (!connectionData) throw createError({ statusCode: 404, statusMessage: 'Calendar connection not found' })
  const connection = connectionData as ConnectionRow
  const ownerId = connection.owner_kind === 'facility' ? connection.facility_id : connection.owner_user_id
  if (!ownerId) throw createError({ statusCode: 500, statusMessage: 'Calendar connection owner is invalid' })
  await requireCalendarOwnerManager(session, connection.owner_kind, ownerId)

  try {
    const accessToken = await activeAccessToken(event, backendData, connection)
    const horizonStart = new Date()
    horizonStart.setMinutes(horizonStart.getMinutes() - 5)
    const horizonEnd = new Date(horizonStart)
    horizonEnd.setUTCDate(horizonEnd.getUTCDate() + 730)
    const readCalendarIds = connection.read_calendar_ids?.length
      ? connection.read_calendar_ids
      : connection.selected_calendar_id ? [connection.selected_calendar_id] : []
    if (!connection.selected_calendar_id || !readCalendarIds.length) {
      throw createError({ statusCode: 409, statusMessage: 'No calendar is selected for synchronization' })
    }
    const selectedCalendarId = connection.selected_calendar_id

    const appointments = await loadConnectionAppointments(
      backendData,
      session.organizationId,
      connection.owner_kind,
      ownerId,
      horizonStart.toISOString(),
      horizonEnd.toISOString(),
    )

    const facilityIds = [...new Set(appointments.map(appointment => appointment.facility_id))]
    const [facilitiesResult, eventLinks] = await Promise.all([
      facilityIds.length
        ? backendData.from('facilities').select('id, name, address_line1, address_line2, postal_code, city').eq('organization_id', session.organizationId).in('id', facilityIds)
        : Promise.resolve({ data: [], error: null }),
      loadConnectionEventLinks(
        backendData,
        session.organizationId,
        connection.id,
        appointments.map(appointment => appointment.id),
      ),
    ])
    throwDbError(facilitiesResult.error)
    const facilities = new Map<string, FacilityInfo>(
      ((facilitiesResult.data ?? []) as FacilityInfo[]).map(row => [row.id, row]),
    )
    const links = new Map<string, EventLink>(
      eventLinks.map(row => [row.appointment_id, row]),
    )

    let eventsWritten = 0
    let eventsDeleted = 0
    let eventsUnchanged = 0
    const pendingAppointments = [...appointments]
    const syncWorkers = Array.from(
      { length: Math.min(5, pendingAppointments.length) },
      async () => {
        let appointment: AppointmentRow | undefined
        while ((appointment = pendingAppointments.shift())) {
          const link = links.get(appointment.id)
          if (appointment.status === 'cancelled') {
            if (link?.external_event_id && link.sync_status !== 'deleted') {
              await deleteProviderAppointmentEvent(
                connection.provider,
                accessToken,
                String(link.calendar_id),
                String(link.external_event_id),
              )
              const deleted = await backendData
                .from('appointment_calendar_events')
                .update({
                  sync_status: 'deleted',
                  source_fingerprint: appointmentFingerprint(appointment, null),
                  last_synced_at: new Date().toISOString(),
                  last_error: null,
                })
                .eq('id', link.id)
              throwDbError(deleted.error)
              eventsDeleted += 1
            }
            continue
          }

          const facility = facilities.get(appointment.facility_id)
          const location = appointment.meeting_mode === 'online'
            ? appointment.meeting_url || 'Spotkanie online'
            : facility
              ? [facility.name, facility.address_line1, facility.address_line2, facility.postal_code, facility.city].filter(Boolean).join(', ')
              : null
          const sourceFingerprint = appointmentFingerprint(appointment, location)
          if (link?.sync_status === 'synced' && link.source_fingerprint === sourceFingerprint) {
            eventsUnchanged += 1
            continue
          }
          const written = await writeProviderAppointmentEvent(connection.provider, accessToken, {
            appointmentId: appointment.id,
            calendarId: selectedCalendarId,
            externalEventId: link?.sync_status === 'deleted' ? null : link?.external_event_id,
            etag: link?.sync_status === 'deleted' ? null : link?.provider_etag,
            title: appointment.meeting_mode === 'online'
              ? 'OpenExpert: spotkanie online'
              : 'OpenExpert: spotkanie',
            startsAt: new Date(appointment.starts_at).toISOString(),
            endsAt: new Date(appointment.ends_at).toISOString(),
            timezone: appointment.timezone,
            location,
          })
          const linkValues = {
            organization_id: session.organizationId,
            appointment_id: appointment.id,
            connection_id: connection.id,
            calendar_id: selectedCalendarId,
            external_event_id: written.externalEventId,
            provider_etag: written.etag,
            source_fingerprint: sourceFingerprint,
            sync_status: 'synced',
            last_synced_at: new Date().toISOString(),
            last_error: null,
          }
          const saveLink = link?.id
            ? await backendData.from('appointment_calendar_events').update(linkValues).eq('id', link.id)
            : await backendData.from('appointment_calendar_events').insert(linkValues)
          throwDbError(saveLink.error)
          eventsWritten += 1
        }
      },
    )
    await Promise.all(syncWorkers)

    // Fetch once, after mirroring, so our cache reflects the final provider
    // state while a failed run preserves the previous complete cache.
    const busyBlocks = await fetchProviderBusyBlocks(
      connection.provider,
      accessToken,
      readCalendarIds,
      horizonStart.toISOString(),
      horizonEnd.toISOString(),
    )
    const finalizeBusy = await backendData.rpc('replace_calendar_busy_blocks', {
      p_organization_id: session.organizationId,
      p_connection_id: connection.id,
      p_blocks: busyBlocks,
    })
    throwDbError(finalizeBusy.error)

    const syncedAt = new Date().toISOString()
    const connectionUpdate = await backendData
      .from('calendar_connections')
      .update({ status: 'active', last_synced_at: syncedAt, last_error: null })
      .eq('id', connection.id)
    throwDbError(connectionUpdate.error)
    return { busyBlocks: busyBlocks.length, eventsWritten, eventsDeleted, eventsUnchanged, syncedAt }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Calendar synchronization failed'
    await backendData
      .from('calendar_connections')
      .update({ status: 'error', last_error: message })
      .eq('id', connection.id)
    throw error
  }
})

async function loadConnectionAppointments(
  backendData: any,
  organizationId: string,
  ownerKind: CalendarConnectionOwnerKind,
  ownerId: string,
  startsAt: string,
  endsAt: string,
): Promise<AppointmentRow[]> {
  const pageSize = 500
  const appointments: AppointmentRow[] = []
  for (let offset = 0; ; offset += pageSize) {
    let query = backendData
      .from('appointments')
      .select('id, facility_id, service_id, expert_user_id, starts_at, ends_at, timezone, status, meeting_mode, meeting_url')
      .eq('organization_id', organizationId)
      .gte('ends_at', startsAt)
      .lte('starts_at', endsAt)
      .in('status', ['confirmed', 'cancelled'])
      .order('starts_at')
      .order('id')
      .range(offset, offset + pageSize - 1)
    query = ownerKind === 'facility'
      ? query.eq('facility_id', ownerId)
      : query.eq('expert_user_id', ownerId)
    const { data, error } = await query
    throwDbError(error)
    const page = (data ?? []) as AppointmentRow[]
    appointments.push(...page)
    if (page.length < pageSize) return appointments
  }
}

async function loadConnectionEventLinks(
  backendData: any,
  organizationId: string,
  connectionId: string,
  appointmentIds: string[],
): Promise<EventLink[]> {
  if (!appointmentIds.length) return []
  const pageSize = 200
  const links: EventLink[] = []
  for (let offset = 0; offset < appointmentIds.length; offset += pageSize) {
    const { data, error } = await backendData
      .from('appointment_calendar_events')
      .select('id, appointment_id, calendar_id, external_event_id, provider_etag, source_fingerprint, sync_status')
      .eq('organization_id', organizationId)
      .eq('connection_id', connectionId)
      .in('appointment_id', appointmentIds.slice(offset, offset + pageSize))
    throwDbError(error)
    links.push(...(data ?? []) as EventLink[])
  }
  return links
}

function appointmentFingerprint(appointment: AppointmentRow, location: string | null): string {
  return createHash('sha256').update(JSON.stringify({
    status: appointment.status,
    startsAt: new Date(appointment.starts_at).toISOString(),
    endsAt: new Date(appointment.ends_at).toISOString(),
    timezone: appointment.timezone,
    location,
  })).digest('hex')
}

async function activeAccessToken(
  event: Parameters<typeof decryptCalendarToken>[0],
  backendData: any,
  connection: ConnectionRow,
): Promise<string> {
  const accessToken = decryptCalendarToken(event, connection.encrypted_access_token)
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0
  if (accessToken && expiresAt > Date.now() + 2 * 60 * 1000) return accessToken

  const refreshToken = decryptCalendarToken(event, connection.encrypted_refresh_token)
  if (!refreshToken) throw createError({ statusCode: 409, statusMessage: 'Calendar connection must be reconnected' })
  const refreshed = await refreshCalendarOAuthToken(event, connection.provider, refreshToken)
  const update = await backendData
    .from('calendar_connections')
    .update({
      encrypted_access_token: encryptCalendarToken(event, refreshed.accessToken),
      encrypted_refresh_token: encryptCalendarToken(event, refreshed.refreshToken),
      token_expires_at: refreshed.expiresAt,
      scopes: refreshed.scopes.length ? refreshed.scopes : connection.scopes,
      status: 'active',
      last_error: null,
    })
    .eq('id', connection.id)
  throwDbError(update.error)
  return refreshed.accessToken
}
