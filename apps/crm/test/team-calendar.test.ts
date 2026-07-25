import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TeamCalendarPayload } from '../app/types/scheduling.ts'
import {
  buildTeamCalendarStats,
  teamCalendarDateKey,
  teamCalendarDurationMinutes,
} from '../app/utils/team-calendar.ts'

function payload(
  patch: Partial<TeamCalendarPayload> = {},
): TeamCalendarPayload {
  return {
    team: { id: 'team-1', name: 'Oddział Szczecin' },
    period: {
      startsFrom: '2026-07-19T22:00:00.000Z',
      startsBefore: '2026-07-26T22:00:00.000Z',
    },
    members: [
      { userId: 'user-1', email: 'jan@example.local', fullName: 'Jan Kowalski' },
      { userId: 'user-2', email: 'anna@example.local', fullName: 'Anna Nowak' },
    ],
    appointments: [],
    timeOff: [],
    ...patch,
  }
}

describe('team calendar statistics', () => {
  it('deduplicates members and separates confirmed, held and cancelled meetings', () => {
    const result = buildTeamCalendarStats(payload({
      members: [
        { userId: 'user-1', email: 'jan@example.local', fullName: 'Jan Kowalski' },
        { userId: 'user-1', email: 'jan@example.local', fullName: 'Jan Kowalski' },
        { userId: 'user-2', email: 'anna@example.local', fullName: 'Anna Nowak' },
      ],
      appointments: [
        {
          id: 'confirmed-1',
          expertUserId: 'user-1',
          startsAt: '2026-07-21T08:00:00.000Z',
          endsAt: '2026-07-21T09:00:00.000Z',
          status: 'confirmed',
          meetingMode: 'office',
          customerName: 'Klient',
          facilityName: 'Centrum',
          serviceName: 'Spotkanie',
        },
        {
          id: 'confirmed-2',
          expertUserId: 'user-1',
          startsAt: '2026-07-22T10:00:00.000Z',
          endsAt: '2026-07-22T10:30:00.000Z',
          status: 'confirmed',
          meetingMode: 'online',
          customerName: 'Klient',
          facilityName: 'Centrum',
          serviceName: 'Spotkanie',
        },
        {
          id: 'hold-1',
          expertUserId: 'user-1',
          startsAt: '2026-07-20T12:00:00.000Z',
          endsAt: '2026-07-20T13:00:00.000Z',
          status: 'hold',
          meetingMode: 'online',
          customerName: 'Klient',
          facilityName: 'Centrum',
          serviceName: 'Spotkanie',
        },
        {
          id: 'cancelled-1',
          expertUserId: 'user-1',
          startsAt: '2026-07-23T12:00:00.000Z',
          endsAt: '2026-07-23T13:00:00.000Z',
          status: 'cancelled',
          meetingMode: 'office',
          customerName: 'Klient',
          facilityName: 'Centrum',
          serviceName: 'Spotkanie',
        },
      ],
    }), {
      now: '2026-07-20T00:00:00.000Z',
      timeZone: 'Europe/Warsaw',
    })

    assert.equal(result.members.length, 2)
    assert.deepEqual(result.summary, {
      confirmed: 2,
      hold: 1,
      cancelled: 1,
      scheduledMinutes: 90,
      activeMembers: 1,
    })
    assert.equal(result.members[0]?.member.userId, 'user-1')
    assert.equal(result.members[0]?.online, 1)
    assert.equal(result.members[0]?.office, 1)
    assert.equal(result.members[0]?.nextAt, '2026-07-21T08:00:00.000Z')
    assert.equal(result.members[1]?.confirmed, 0)
  })

  it('marks every day covered by a multi-day time off within the requested period', () => {
    const result = buildTeamCalendarStats(payload({
      timeOff: [{
        id: 'vacation-1',
        expertUserId: 'user-1',
        startsAt: '2026-07-21T22:00:00.000Z',
        endsAt: '2026-07-24T22:00:00.000Z',
        timezone: 'Europe/Warsaw',
      }],
    }), { timeZone: 'Europe/Warsaw' })

    const days = result.members.find(item => item.member.userId === 'user-1')?.byDay
    assert.equal(days?.['2026-07-22']?.timeOff, 1)
    assert.equal(days?.['2026-07-23']?.timeOff, 1)
    assert.equal(days?.['2026-07-24']?.timeOff, 1)
    assert.equal(days?.['2026-07-25'], undefined)
  })

  it('maps instants and durations consistently for the team timezone', () => {
    assert.equal(
      teamCalendarDateKey('2026-07-19T22:30:00.000Z', 'Europe/Warsaw'),
      '2026-07-20',
    )
    assert.equal(teamCalendarDurationMinutes({
      startsAt: '2026-07-20T08:00:00.000Z',
      endsAt: '2026-07-20T09:15:00.000Z',
    }), 75)
  })
})
