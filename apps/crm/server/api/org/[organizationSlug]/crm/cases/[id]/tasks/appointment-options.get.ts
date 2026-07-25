import { serverSupabaseServiceRole } from '#supabase/server'
import { createError, getQuery, setHeader } from 'h3'
import { caseUuidPattern } from '~~/server/utils/case-identifiers'
import {
  getRequiredParam,
  requireCrmSession,
  throwDbError,
} from '~~/server/utils/crm'
import {
  dateValue,
  findConfiguredGenericMeetingService,
  integerValue,
  listAccessibleFacilityIds,
  throwBookingError,
  uuidValue,
} from '~~/server/utils/scheduling'

type Row = Record<string, any>

function localDateRange(firstDate: string, days: number): string[] {
  const cursor = new Date(`${firstDate}T12:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(cursor)
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const caseId = getRequiredParam(event, 'id')
  if (!caseUuidPattern.test(caseId)) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }

  const query = getQuery(event)
  const assigneeUserId = uuidValue(
    query.assignee_user_id ?? query.assigneeUserId,
    'assignee_user_id',
  )
  const firstDate = dateValue(query.date)
  const days = query.days === undefined
    ? 7
    : integerValue(query.days, 'days', 1, 7)

  if (assigneeUserId === session.userId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A delegated task must be assigned to another person',
    })
  }

  const [caseResult, assigneeResult, accessibleFacilityIds] = await Promise.all([
    session.supabase
      .from('crm_cases')
      .select('id, client_id')
      .eq('organization_id', session.organizationId)
      .eq('id', caseId)
      .maybeSingle(),
    session.supabase
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', assigneeUserId)
      .maybeSingle(),
    listAccessibleFacilityIds(session),
  ])
  throwDbError(caseResult.error)
  throwDbError(assigneeResult.error)
  if (!caseResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Case not found' })
  }
  if (!assigneeResult.data) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Assignee must belong to this organization',
    })
  }
  if (!caseResult.data.client_id) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Link a client to the case before booking a meeting',
    })
  }

  const serviceRole = serverSupabaseServiceRole(event) as any
  const clientPersonResult = await serviceRole
    .from('crm_client_people')
    .select('id')
    .eq('organization_id', session.organizationId)
    .eq('client_id', caseResult.data.client_id)
    .limit(1)
    .maybeSingle()
  throwDbError(clientPersonResult.error)
  if (!clientPersonResult.data) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Add a contact person to the client before booking a meeting',
    })
  }

  const bookableMembershipsResult = await serviceRole
    .from('facility_memberships')
    .select('facility_id')
    .eq('organization_id', session.organizationId)
    .eq('user_id', assigneeUserId)
    .eq('is_bookable', true)
  throwDbError(bookableMembershipsResult.error)

  const accessibleSet = accessibleFacilityIds === null
    ? null
    : new Set(accessibleFacilityIds)
  const bookableFacilityIds: string[] = [
    ...new Set<string>(
      (bookableMembershipsResult.data ?? [])
        .map((membership: Row) => String(membership.facility_id))
        .filter((facilityId: string) => (
          accessibleSet === null || accessibleSet.has(facilityId)
        )),
    ),
  ]

  const dates = localDateRange(firstDate, days)
  if (!bookableFacilityIds.length) {
    setHeader(event, 'Cache-Control', 'no-store')
    return {
      date: firstDate,
      endDate: dates.at(-1) ?? firstDate,
      days,
      assigneeUserId,
      contexts: [],
    }
  }

  const [
    availabilityRulesResult,
    availabilityOverridesResult,
    openingHoursResult,
    openingOverridesResult,
  ] = await Promise.all([
    serviceRole
      .from('expert_availability_rules')
      .select('facility_id, valid_until')
      .eq('organization_id', session.organizationId)
      .eq('user_id', assigneeUserId)
      .eq('is_active', true)
      .in('facility_id', bookableFacilityIds),
    serviceRole
      .from('expert_availability_overrides')
      .select('facility_id')
      .eq('organization_id', session.organizationId)
      .eq('user_id', assigneeUserId)
      .eq('is_unavailable', false)
      .gte('local_date', firstDate)
      .in('facility_id', bookableFacilityIds),
    serviceRole
      .from('facility_opening_hours')
      .select('facility_id')
      .eq('organization_id', session.organizationId)
      .eq('is_active', true)
      .in('facility_id', bookableFacilityIds),
    serviceRole
      .from('facility_opening_overrides')
      .select('facility_id')
      .eq('organization_id', session.organizationId)
      .eq('is_closed', false)
      .gte('local_date', firstDate)
      .in('facility_id', bookableFacilityIds),
  ])
  throwDbError(availabilityRulesResult.error)
  throwDbError(availabilityOverridesResult.error)
  throwDbError(openingHoursResult.error)
  throwDbError(openingOverridesResult.error)

  const expertScheduleFacilityIds = new Set<string>([
    ...(availabilityRulesResult.data ?? [])
      .filter((rule: Row) => (
        !rule.valid_until || String(rule.valid_until) >= firstDate
      ))
      .map((rule: Row) => String(rule.facility_id)),
    ...(availabilityOverridesResult.data ?? [])
      .map((override: Row) => String(override.facility_id)),
  ])
  const facilityScheduleIds = new Set<string>([
    ...(openingHoursResult.data ?? [])
      .map((opening: Row) => String(opening.facility_id)),
    ...(openingOverridesResult.data ?? [])
      .map((override: Row) => String(override.facility_id)),
  ])
  const facilityIds = bookableFacilityIds.filter(facilityId => (
    expertScheduleFacilityIds.has(facilityId)
    && facilityScheduleIds.has(facilityId)
  ))
  if (!facilityIds.length) {
    setHeader(event, 'Cache-Control', 'no-store')
    return {
      date: firstDate,
      endDate: dates.at(-1) ?? firstDate,
      days,
      assigneeUserId,
      contexts: [],
    }
  }

  const facilitiesResult = await serviceRole
    .from('facilities')
    .select('id, name, timezone')
    .eq('organization_id', session.organizationId)
    .eq('is_active', true)
    .in('id', facilityIds)
    .order('name')
  throwDbError(facilitiesResult.error)

  const contexts: Array<Record<string, unknown>> = []
  for (const facility of (facilitiesResult.data ?? []) as Row[]) {
    const service = await findConfiguredGenericMeetingService(
      event,
      session.organizationId,
      String(facility.id),
      assigneeUserId,
    )
    if (!service) continue
    const slotResults = await Promise.all(dates.map(localDate => (
      serviceRole.rpc('get_staff_booking_slots', {
        p_organization_id: session.organizationId,
        p_facility_id: facility.id,
        p_service_id: service.id,
        p_local_date: localDate,
        p_expert_user_id: assigneeUserId,
      })
    )))

    const slots: Array<{ startsAt: string, endsAt: string }> = []
    for (const slotResult of slotResults) {
      throwBookingError(slotResult.error)
      for (const slot of (slotResult.data ?? []) as Row[]) {
        slots.push({
          startsAt: String(slot.starts_at ?? ''),
          endsAt: String(slot.ends_at ?? ''),
        })
      }
    }
    slots.sort((left, right) => left.startsAt.localeCompare(right.startsAt))

    contexts.push({
      facilityId: String(facility.id),
      facilityName: String(facility.name ?? ''),
      timezone: String(facility.timezone ?? 'Europe/Warsaw'),
      serviceId: String(service.id),
      serviceName: String(service.name ?? 'Spotkanie'),
      durationMinutes: Number(service.duration_minutes ?? 60),
      slots,
    })
  }

  setHeader(event, 'Cache-Control', 'no-store')
  return {
    date: firstDate,
    endDate: dates.at(-1) ?? firstDate,
    days,
    assigneeUserId,
    contexts,
  }
})
