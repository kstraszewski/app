import type {
  TeamCalendarAppointment,
  TeamCalendarMember,
  TeamCalendarPayload,
  TeamCalendarTimeOff,
} from '~/types/scheduling'

export interface TeamCalendarDayStats {
  confirmed: number
  hold: number
  cancelled: number
  scheduledMinutes: number
  timeOff: number
}

export interface TeamCalendarMemberStats {
  member: TeamCalendarMember
  confirmed: number
  hold: number
  cancelled: number
  scheduledMinutes: number
  online: number
  office: number
  nextAt: string | null
  byDay: Record<string, TeamCalendarDayStats>
}

export interface TeamCalendarSummary {
  confirmed: number
  hold: number
  cancelled: number
  scheduledMinutes: number
  activeMembers: number
}

export function teamCalendarDateKey(
  value: string | Date,
  timeZone = 'Europe/Warsaw',
): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find(item => item.type === type)?.value ?? ''
  )
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function teamCalendarDurationMinutes(
  appointment: Pick<TeamCalendarAppointment, 'startsAt' | 'endsAt'>,
): number {
  const startsAt = new Date(appointment.startsAt).valueOf()
  const endsAt = new Date(appointment.endsAt).valueOf()
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return 0
  return Math.round((endsAt - startsAt) / 60_000)
}

function emptyDayStats(): TeamCalendarDayStats {
  return {
    confirmed: 0,
    hold: 0,
    cancelled: 0,
    scheduledMinutes: 0,
    timeOff: 0,
  }
}

function addAppointment(
  stats: TeamCalendarMemberStats,
  appointment: TeamCalendarAppointment,
  timeZone: string,
  now: number,
) {
  const date = teamCalendarDateKey(appointment.startsAt, timeZone)
  const day = stats.byDay[date] ?? emptyDayStats()
  stats.byDay[date] = day

  if (appointment.status === 'confirmed') {
    const duration = teamCalendarDurationMinutes(appointment)
    stats.confirmed += 1
    stats.scheduledMinutes += duration
    day.confirmed += 1
    day.scheduledMinutes += duration
    if (appointment.meetingMode === 'online') stats.online += 1
    else stats.office += 1
  } else if (appointment.status === 'hold') {
    stats.hold += 1
    day.hold += 1
  } else {
    stats.cancelled += 1
    day.cancelled += 1
  }

  const startsAt = new Date(appointment.startsAt).valueOf()
  if (
    appointment.status === 'confirmed'
    && startsAt >= now
    && (!stats.nextAt || appointment.startsAt < stats.nextAt)
  ) {
    stats.nextAt = appointment.startsAt
  }
}

function addTimeOff(
  stats: TeamCalendarMemberStats,
  item: TeamCalendarTimeOff,
  timeZone: string,
  period: TeamCalendarPayload['period'],
) {
  const startsAt = Math.max(
    new Date(item.startsAt).valueOf(),
    new Date(period.startsFrom).valueOf(),
  )
  const endsBefore = Math.min(
    new Date(item.endsAt).valueOf(),
    new Date(period.startsBefore).valueOf(),
  )
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsBefore) || endsBefore <= startsAt) return

  let date = teamCalendarDateKey(new Date(startsAt), timeZone)
  const lastDate = teamCalendarDateKey(new Date(endsBefore - 1), timeZone)
  for (let safety = 0; date <= lastDate && safety < 32; safety += 1) {
    const day = stats.byDay[date] ?? emptyDayStats()
    day.timeOff += 1
    stats.byDay[date] = day
    const [year, month, dayOfMonth] = date.split('-').map(Number)
    date = new Date(Date.UTC(year!, month! - 1, dayOfMonth! + 1, 12))
      .toISOString()
      .slice(0, 10)
  }
}

export function buildTeamCalendarStats(
  payload: Pick<TeamCalendarPayload, 'period' | 'members' | 'appointments' | 'timeOff'>,
  options: {
    now?: string | Date
    timeZone?: string
  } = {},
): {
  members: TeamCalendarMemberStats[]
  summary: TeamCalendarSummary
} {
  const now = options.now === undefined
    ? Date.now()
    : new Date(options.now).valueOf()
  const timeZone = options.timeZone ?? 'Europe/Warsaw'
  const uniqueMembers = new Map(payload.members.map(member => [member.userId, member]))
  const statsByUser = new Map<string, TeamCalendarMemberStats>()

  for (const member of uniqueMembers.values()) {
    statsByUser.set(member.userId, {
      member,
      confirmed: 0,
      hold: 0,
      cancelled: 0,
      scheduledMinutes: 0,
      online: 0,
      office: 0,
      nextAt: null,
      byDay: {},
    })
  }

  for (const appointment of payload.appointments) {
    const stats = statsByUser.get(appointment.expertUserId)
    if (stats) addAppointment(stats, appointment, timeZone, now)
  }
  for (const item of payload.timeOff) {
    const stats = statsByUser.get(item.expertUserId)
    if (stats) addTimeOff(stats, item, timeZone, payload.period)
  }

  const members = [...statsByUser.values()].sort((left, right) => (
    right.confirmed - left.confirmed
    || right.hold - left.hold
    || (left.member.fullName || left.member.email)
      .localeCompare(right.member.fullName || right.member.email, 'pl')
  ))
  return {
    members,
    summary: {
      confirmed: members.reduce((sum, item) => sum + item.confirmed, 0),
      hold: members.reduce((sum, item) => sum + item.hold, 0),
      cancelled: members.reduce((sum, item) => sum + item.cancelled, 0),
      scheduledMinutes: members.reduce((sum, item) => sum + item.scheduledMinutes, 0),
      activeMembers: members.filter(item => item.confirmed + item.hold > 0).length,
    },
  }
}
