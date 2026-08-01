import { createError, type H3Event } from 'h3'
import { serverDataBackend } from './data-api'
import {
  loadPublicPortalExperts,
  portalExpertScopeKey,
} from './portal-experts'
import {
  normalizeClientEmail,
  throwPortalDbError,
  type ClientPortalSession,
} from './portal-auth'
import {
  chunkPortalQueryValues,
  enforcePortalRowLimit,
  runPortalQueryChunks,
} from './portal-query'

type Row = Record<string, any>

function indexById(rows: Row[]): Map<string, Row> {
  return new Map(rows.map(row => [String(row.id), row]))
}

function presentIds(rows: Row[], column: string): string[] {
  return [...new Set(rows.flatMap((row) => {
    const value = row[column]
    return typeof value === 'string' && value.trim() ? [value] : []
  }))]
}

async function loadLookupRows(
  backend: any,
  table: string,
  select: string,
  ids: string[],
  errorContext: string,
): Promise<Row[]> {
  if (!ids.length) return []
  const rowsByChunk = await runPortalQueryChunks(
    chunkPortalQueryValues(ids),
    async (chunk) => {
      const result = await backend.from(table).select(select).in('id', chunk)
      throwPortalDbError(result.error, errorContext)
      return (result.data ?? []) as Row[]
    },
  )
  return rowsByChunk.flat()
}

export async function loadPortalAppointments(
  event: H3Event,
  session: ClientPortalSession,
) {
  if (!session.links.length) return []
  const backend = serverDataBackend(event) as any
  const clientPersonIds = [...new Set(session.links.map(link => link.clientPersonId))]
  const linkByScope = new Map(session.links.map(link => [
    JSON.stringify([link.organizationId, link.clientId, link.clientPersonId]),
    link,
  ]))
  const pageSize = 500
  const maxRows = 1_000
  const visibleAfter = new Date().toISOString()
  const appointmentRows: Row[] = []
  for (const personIds of chunkPortalQueryValues(clientPersonIds)) {
      const rows: Row[] = []
      const chunkMaxRows = maxRows - appointmentRows.length
      for (let offset = 0; ;) {
        const remaining = chunkMaxRows - rows.length
        const requestedRows = Math.min(pageSize, remaining + 1)
        const result = await backend
          .from('appointments')
          .select(`
            id,
            organization_id,
            client_id,
            client_person_id,
            facility_id,
            service_id,
            expert_user_id,
            starts_at,
            ends_at,
            timezone,
            status,
            hold_expires_at,
            meeting_mode,
            customer_email
          `)
          .in('client_person_id', personIds)
          .eq('customer_email', session.identity.email)
          .neq('status', 'hold')
          .neq('status', 'cancelled')
          .gte('ends_at', visibleAfter)
          .order('starts_at', { ascending: false })
          .order('id', { ascending: true })
          .range(offset, offset + requestedRows - 1)
        throwPortalDbError(result.error, 'could not load client appointments')
        const page = (result.data ?? []) as Row[]
        if (rows.length + page.length > chunkMaxRows) {
          throw createError({
            statusCode: 503,
            statusMessage: 'Client portal data set is temporarily too large',
          })
        }
        rows.push(...page)
        if (page.length < requestedRows) break
        offset += page.length
      }
      appointmentRows.push(...rows)
  }
  enforcePortalRowLimit(appointmentRows, maxRows)

  const appointments = appointmentRows.filter((row) => {
    const link = linkByScope.get(JSON.stringify([
      String(row.organization_id),
      String(row.client_id),
      String(row.client_person_id),
    ]))
    return Boolean(link)
      && normalizeClientEmail(row.customer_email) === link?.verifiedEmail
      && (
        String(row.status) !== 'hold'
        || (
          Number.isFinite(Date.parse(String(row.hold_expires_at ?? '')))
          && Date.parse(String(row.hold_expires_at)) > Date.now()
        )
      )
  })
  if (!appointments.length) return []

  const facilityIds = presentIds(appointments, 'facility_id')
  const serviceIds = presentIds(appointments, 'service_id')
  const [facilityRows, serviceRows, experts] = await Promise.all([
    loadLookupRows(
      backend,
      'facilities',
      'id, name, city, address_line1, address_line2, postal_code',
      facilityIds,
      'could not load appointment facilities',
    ),
    loadLookupRows(
      backend,
      'booking_services',
      'id, name, duration_minutes',
      serviceIds,
      'could not load appointment services',
    ),
    loadPublicPortalExperts(event, appointments.flatMap((row) => {
      if (!row.organization_id || !row.expert_user_id) return []
      return [{
        organizationId: String(row.organization_id),
        userId: String(row.expert_user_id),
      }]
    })),
  ])
  const facilities = indexById(facilityRows)
  const services = indexById(serviceRows)

  return appointments.map((row) => {
    const facility = facilities.get(String(row.facility_id))
    const service = services.get(String(row.service_id))
    const expert = experts.get(portalExpertScopeKey(
      String(row.organization_id),
      String(row.expert_user_id),
    ))
    return {
      id: String(row.id),
      status: String(row.status),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      timezone: String(row.timezone),
      meetingMode: row.meeting_mode === 'online' ? 'online' : 'office',
      // Join URLs may contain provider-specific access tokens. The dashboard
      // only needs the meeting time and mode, so keep those URLs server-side.
      meetingUrl: null,
      facility: facility
        ? {
            id: String(facility.id),
            name: String(facility.name),
            city: facility.city ? String(facility.city) : null,
            addressLine1: facility.address_line1 ? String(facility.address_line1) : null,
            addressLine2: facility.address_line2 ? String(facility.address_line2) : null,
            postalCode: facility.postal_code ? String(facility.postal_code) : null,
          }
        : null,
      service: service
        ? {
            id: String(service.id),
            name: String(service.name),
            durationMinutes: Number(service.duration_minutes),
          }
        : null,
      expert: expert
        ? expert
        : null,
    }
  }).sort((left, right) => right.startsAt.localeCompare(left.startsAt))
}
