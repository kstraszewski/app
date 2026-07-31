import { serverDataBackend } from '~~/server/utils/data-api'
import { createError, getQuery, setHeader } from 'h3'
import {
  getRequiredParam,
  requireCrmSession,
  requireTeamView,
  throwDbError,
} from '~~/server/utils/crm'
import {
  isoDateTimeValue,
  listAccessibleFacilityIds,
  uuidValue,
} from '~~/server/utils/scheduling'
import { resolveTeamScopeUserIds } from '~~/server/utils/sales'
import {
  addDaysToDateKey,
  instantDateKeyInTimezone,
  startOfDateInTimezone,
} from '#shared/utils/zoned-date'

type Row = Record<string, any>

const PAGE_SIZE = 500
const ID_BATCH_SIZE = 100
const MAXIMUM_RANGE_MILLISECONDS = 31 * 24 * 60 * 60 * 1_000
const TEAM_CALENDAR_TIMEZONE = 'Europe/Warsaw'

function chunks<T>(values: T[], size = ID_BATCH_SIZE): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function defaultPeriod() {
  const today = instantDateKeyInTimezone(new Date(), TEAM_CALENDAR_TIMEZONE)
  const [year, month, day] = today.split('-').map(Number)
  const weekdayOffset = (
    new Date(Date.UTC(year!, month! - 1, day!, 12)).getUTCDay() + 6
  ) % 7
  const weekStart = addDaysToDateKey(today, -weekdayOffset)
  return {
    startsFrom: startOfDateInTimezone(weekStart, TEAM_CALENDAR_TIMEZONE),
    startsBefore: startOfDateInTimezone(
      addDaysToDateKey(weekStart, 7),
      TEAM_CALENDAR_TIMEZONE,
    ),
  }
}

async function loadAppointments(
  backendData: any,
  organizationId: string,
  memberIds: string[],
  facilityIds: string[] | null,
  startsFrom: string,
  startsBefore: string,
): Promise<Row[]> {
  if (!memberIds.length || facilityIds?.length === 0) return []

  const rows: Row[] = []
  for (const memberBatch of chunks(memberIds)) {
    let offset = 0
    while (true) {
      let request = backendData
        .from('appointments')
        .select('id, expert_user_id, facility_id, service_id, starts_at, ends_at, status, hold_expires_at, meeting_mode, customer_name')
        .eq('organization_id', organizationId)
        .in('expert_user_id', memberBatch)
        .gte('starts_at', startsFrom)
        .lt('starts_at', startsBefore)
        .order('starts_at')
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1)
      if (facilityIds) request = request.in('facility_id', facilityIds)

      const result = await request
      throwDbError(result.error)
      const page = (result.data ?? []) as Row[]
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  }
  return rows.sort((left, right) => (
    String(left.starts_at).localeCompare(String(right.starts_at))
    || String(left.id).localeCompare(String(right.id))
  ))
}

async function loadTimeOff(
  backendData: any,
  organizationId: string,
  memberIds: string[],
  startsFrom: string,
  startsBefore: string,
): Promise<Row[]> {
  if (!memberIds.length) return []

  const rows: Row[] = []
  for (const memberBatch of chunks(memberIds)) {
    let offset = 0
    while (true) {
      const result = await backendData
        .from('expert_time_off')
        .select('id, expert_user_id, starts_at, ends_at, timezone')
        .eq('organization_id', organizationId)
        .eq('status', 'active')
        .in('expert_user_id', memberBatch)
        .lt('starts_at', startsBefore)
        .gt('ends_at', startsFrom)
        .order('starts_at')
        .order('id')
        .range(offset, offset + PAGE_SIZE - 1)

      throwDbError(result.error)
      const page = (result.data ?? []) as Row[]
      rows.push(...page)
      if (page.length < PAGE_SIZE) break
      offset += PAGE_SIZE
    }
  }
  return rows.sort((left, right) => (
    String(left.starts_at).localeCompare(String(right.starts_at))
    || String(left.id).localeCompare(String(right.id))
  ))
}

async function loadNamedRows(
  backendData: any,
  table: 'facilities' | 'booking_services',
  organizationId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  for (const idBatch of chunks([...new Set(ids.filter(Boolean))])) {
    const result = await backendData
      .from(table)
      .select('id, name')
      .eq('organization_id', organizationId)
      .in('id', idBatch)
    throwDbError(result.error)
    for (const row of result.data ?? []) {
      names.set(String(row.id), String(row.name ?? ''))
    }
  }
  return names
}

export default defineEventHandler(async (event) => {
  const session = await requireCrmSession(event)
  const teamId = uuidValue(getRequiredParam(event, 'teamId'), 'teamId')
  await requireTeamView(session, teamId)

  const query = getQuery(event)
  const defaults = defaultPeriod()
  const startsFrom = query.startsFrom === undefined && query.starts_from === undefined
    ? defaults.startsFrom
    : isoDateTimeValue(query.startsFrom ?? query.starts_from, 'startsFrom')
  const startsBefore = query.startsBefore === undefined && query.starts_before === undefined
    ? defaults.startsBefore
    : isoDateTimeValue(query.startsBefore ?? query.starts_before, 'startsBefore')
  const startsFromTime = new Date(startsFrom).valueOf()
  const startsBeforeTime = new Date(startsBefore).valueOf()
  if (startsFromTime >= startsBeforeTime) {
    throw createError({ statusCode: 400, statusMessage: 'startsBefore must be after startsFrom' })
  }
  if (startsBeforeTime - startsFromTime > MAXIMUM_RANGE_MILLISECONDS) {
    throw createError({ statusCode: 400, statusMessage: 'Team calendar range must not exceed 31 days' })
  }

  const teamResult = await session.dataApi
    .from('teams')
    .select('id, name')
    .eq('organization_id', session.organizationId)
    .eq('id', teamId)
    .maybeSingle()
  throwDbError(teamResult.error)
  if (!teamResult.data) {
    throw createError({ statusCode: 404, statusMessage: 'Team not found' })
  }

  const memberIds = await resolveTeamScopeUserIds(session, teamId)
  const backendData = serverDataBackend(event) as any
  const accessibleFacilityIds = await listAccessibleFacilityIds(session)

  const [membersResult, appointments, timeOff] = await Promise.all([
    memberIds.length
      ? backendData
          .from('organization_memberships')
          .select('user_id, user:users!organization_memberships_user_id_fkey!inner(email, full_name, avatar_url)')
          .eq('organization_id', session.organizationId)
          .in('user_id', memberIds)
      : Promise.resolve({ data: [], error: null }),
    loadAppointments(
      backendData,
      session.organizationId,
      memberIds,
      accessibleFacilityIds,
      startsFrom,
      startsBefore,
    ),
    loadTimeOff(
      backendData,
      session.organizationId,
      memberIds,
      startsFrom,
      startsBefore,
    ),
  ])
  throwDbError(membersResult.error)

  const visibleAppointments = appointments.filter(row => (
    row.status !== 'hold'
    || new Date(row.hold_expires_at).valueOf() > Date.now()
  ))
  const [facilityNames, serviceNames] = await Promise.all([
    loadNamedRows(
      backendData,
      'facilities',
      session.organizationId,
      visibleAppointments.map(row => String(row.facility_id)),
    ),
    loadNamedRows(
      backendData,
      'booking_services',
      session.organizationId,
      visibleAppointments.map(row => String(row.service_id)),
    ),
  ])

  const members = ((membersResult.data ?? []) as Row[])
    .map((membership) => {
      const user = Array.isArray(membership.user) ? membership.user[0] : membership.user
      return {
        userId: String(membership.user_id),
        email: String(user?.email ?? ''),
        fullName: String(user?.full_name ?? ''),
        avatarUrl: typeof user?.avatar_url === 'string' ? user.avatar_url : null,
      }
    })
    .sort((left, right) => (
      (left.fullName || left.email).localeCompare(right.fullName || right.email, 'pl')
    ))

  setHeader(event, 'Cache-Control', 'private, no-store')
  return {
    team: {
      id: String(teamResult.data.id),
      name: String(teamResult.data.name),
    },
    period: { startsFrom, startsBefore },
    members,
    appointments: visibleAppointments.map(row => ({
      id: String(row.id),
      expertUserId: String(row.expert_user_id),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      status: String(row.status),
      meetingMode: String(row.meeting_mode),
      customerName: String(row.customer_name ?? ''),
      facilityName: facilityNames.get(String(row.facility_id)) ?? '',
      serviceName: serviceNames.get(String(row.service_id)) ?? '',
    })),
    timeOff: timeOff.map(row => ({
      id: String(row.id),
      expertUserId: String(row.expert_user_id),
      startsAt: String(row.starts_at),
      endsAt: String(row.ends_at),
      timezone: String(row.timezone),
    })),
  }
})
