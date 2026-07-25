import { serverSupabaseServiceRole } from '#supabase/server'
import { requireCrmSession, textValue, throwDbError } from '~~/server/utils/crm'
import {
  enumValue,
  integerValue,
  isoDateTimeValue,
  listAccessibleFacilityIds,
  optionalUuidValue,
  requireFacilityPermission,
} from '~~/server/utils/scheduling'

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  event.node.res.setHeader('Cache-Control', 'no-store')
  const query = Object.fromEntries(
    new URL(event.node.req.url ?? '/', 'http://localhost').searchParams.entries(),
  )
  const facilityId = optionalUuidValue(query.facilityId ?? query.facility_id, 'facilityId')
  const clientId = optionalUuidValue(query.clientId ?? query.client_id, 'clientId')
  const expertUserId = optionalUuidValue(query.expertUserId ?? query.expert_user_id, 'expertUserId')
  const status = textValue(query.status)
    ? enumValue(query.status, 'status', ['hold', 'confirmed', 'cancelled'] as const)
    : null
  const limit = query.limit === undefined ? 100 : integerValue(query.limit, 'limit', 1, 200)
  const offset = query.offset === undefined ? 0 : integerValue(query.offset, 'offset', 0, 100_000)
  const defaultFrom = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString()
  const defaultBefore = new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString()
  const startsFrom = query.startsFrom === undefined && query.starts_from === undefined
    ? defaultFrom
    : isoDateTimeValue(query.startsFrom ?? query.starts_from, 'startsFrom')
  const startsBefore = query.startsBefore === undefined && query.starts_before === undefined
    ? defaultBefore
    : isoDateTimeValue(query.startsBefore ?? query.starts_before, 'startsBefore')
  if (startsFrom >= startsBefore) {
    throw createError({ statusCode: 400, statusMessage: 'startsBefore must be after startsFrom' })
  }
  if (new Date(startsBefore).valueOf() - new Date(startsFrom).valueOf() > 366 * 24 * 60 * 60 * 1_000) {
    throw createError({ statusCode: 400, statusMessage: 'Appointment range must not exceed 366 days' })
  }

  let facilityIds: string[] | null
  if (facilityId) {
    await requireFacilityPermission(session, facilityId, 'view')
    facilityIds = [facilityId]
  } else {
    facilityIds = await listAccessibleFacilityIds(session)
  }
  if (facilityIds?.length === 0) return { data: [], count: 0 }

  const serviceRole = serverSupabaseServiceRole(event) as any
  let request = serviceRole
    .from('appointments')
    .select('id, organization_id, client_id, client_person_id, facility_id, service_id, expert_user_id, widget_id, starts_at, ends_at, timezone, status, hold_expires_at, meeting_mode, meeting_url, customer_name, customer_email, customer_phone, notes, created_at, updated_at', { count: 'exact' })
    .eq('organization_id', session.organizationId)
    .gte('starts_at', startsFrom)
    .lt('starts_at', startsBefore)
    .order('starts_at')
    .range(offset, offset + limit - 1)
  if (facilityIds) request = request.in('facility_id', facilityIds)
  if (clientId) request = request.eq('client_id', clientId)
  if (expertUserId) request = request.eq('expert_user_id', expertUserId)
  if (status) request = request.eq('status', status)

  const { data: appointments, error, count } = await request
  throwDbError(error)
  const rows = appointments ?? []
  const foundFacilityIds = [...new Set(rows.map((row: any) => String(row.facility_id)))]
  const serviceIds = [...new Set(rows.map((row: any) => String(row.service_id)))]
  const expertIds = [...new Set(rows.map((row: any) => String(row.expert_user_id)))]

  const [facilitiesResult, servicesResult, expertsResult] = await Promise.all([
    foundFacilityIds.length
      ? serviceRole.from('facilities').select('id, name').eq('organization_id', session.organizationId).in('id', foundFacilityIds)
      : Promise.resolve({ data: [], error: null }),
    serviceIds.length
      ? serviceRole.from('booking_services').select('id, name').eq('organization_id', session.organizationId).in('id', serviceIds)
      : Promise.resolve({ data: [], error: null }),
    expertIds.length
      ? serviceRole.from('users').select('id, full_name, email').in('id', expertIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  throwDbError(facilitiesResult.error)
  throwDbError(servicesResult.error)
  throwDbError(expertsResult.error)

  const facilities = new Map((facilitiesResult.data ?? []).map((row: any) => [String(row.id), row]))
  const services = new Map((servicesResult.data ?? []).map((row: any) => [String(row.id), row]))
  const experts = new Map((expertsResult.data ?? []).map((row: any) => [String(row.id), row]))
  return {
    data: rows.map((row: any) => {
      const expert = experts.get(String(row.expert_user_id)) as any
      return {
        ...row,
        facilityName: (facilities.get(String(row.facility_id)) as any)?.name ?? '',
        serviceName: (services.get(String(row.service_id)) as any)?.name ?? '',
        expertName: expert?.full_name || expert?.email || '',
      }
    }),
    count: count ?? 0,
  }
})
