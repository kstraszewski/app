import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  directoryLocalIsoDate,
  summarizeDirectoryAvailability,
} from '../server/utils/directory-availability.ts'

const EXPERT_ID = '11111111-1111-4111-8111-111111111111'

function slot(startsAt: string, expertId = EXPERT_ID) {
  return {
    starts_at: startsAt,
    expert_user_id: expertId,
  }
}

describe('directoryLocalIsoDate', () => {
  it('uses the facility timezone when a UTC timestamp crosses midnight', () => {
    assert.equal(
      directoryLocalIsoDate('2026-08-12T22:30:00.000Z', 'Europe/Warsaw'),
      '2026-08-13',
    )
  })

  it('rejects malformed timestamps and falls back from an invalid timezone', () => {
    assert.equal(directoryLocalIsoDate('not-a-date', 'Europe/Warsaw'), null)
    assert.equal(
      directoryLocalIsoDate('2026-08-12T22:30:00.000Z', 'Invalid/Timezone'),
      '2026-08-13',
    )
  })
})

describe('summarizeDirectoryAvailability', () => {
  it('keeps the earliest slot for three unique local dates across services', () => {
    const result = summarizeDirectoryAvailability([
      {
        serviceId: 'service-b',
        ok: true,
        slots: [
          slot('2026-08-14T10:00:00.000Z'),
          slot('2026-08-13T09:00:00.000Z'),
          slot('2026-08-15T08:00:00.000Z'),
        ],
      },
      {
        serviceId: 'service-a',
        ok: true,
        slots: [
          slot('2026-08-13T08:00:00.000Z'),
          slot('2026-08-13T08:00:00.000Z'),
          slot('2026-08-16T08:00:00.000Z'),
        ],
      },
    ], {
      expertId: EXPERT_ID,
      timezone: 'Europe/Warsaw',
      now: '2026-08-12T08:00:00.000Z',
      limitDates: 3,
    })

    assert.equal(result.status, 'available')
    assert.deepEqual(result.dates, [
      {
        localDate: '2026-08-13',
        startsAt: '2026-08-13T08:00:00.000Z',
        serviceId: 'service-a',
      },
      {
        localDate: '2026-08-14',
        startsAt: '2026-08-14T10:00:00.000Z',
        serviceId: 'service-b',
      },
      {
        localDate: '2026-08-15',
        startsAt: '2026-08-15T08:00:00.000Z',
        serviceId: 'service-b',
      },
    ])
  })

  it('ignores malformed, past, and other-expert slots', () => {
    const result = summarizeDirectoryAvailability([{
      serviceId: 'service-a',
      ok: true,
      slots: [
        slot('not-a-date'),
        slot('2026-08-11T10:00:00.000Z'),
        slot('2026-08-13T10:00:00.000Z', 'other-expert'),
      ],
    }], {
      expertId: EXPERT_ID,
      timezone: 'Europe/Warsaw',
      now: '2026-08-12T08:00:00.000Z',
    })

    assert.deepEqual(result, {
      status: 'none',
      timezone: 'Europe/Warsaw',
      dates: [],
    })
  })

  it('distinguishes confirmed empty availability from a failed lookup', () => {
    const empty = summarizeDirectoryAvailability([{
      serviceId: 'service-a',
      ok: true,
      slots: [],
    }], {
      expertId: EXPERT_ID,
      timezone: 'Europe/Warsaw',
      now: '2026-08-12T08:00:00.000Z',
    })
    const unknown = summarizeDirectoryAvailability([{
      serviceId: 'service-a',
      ok: false,
      slots: [],
    }], {
      expertId: EXPERT_ID,
      timezone: 'Europe/Warsaw',
      now: '2026-08-12T08:00:00.000Z',
    })

    assert.equal(empty.status, 'none')
    assert.equal(unknown.status, 'unknown')
  })

  it('does not claim the dates are nearest when another service lookup fails', () => {
    const result = summarizeDirectoryAvailability([
      { serviceId: 'service-a', ok: false, slots: [] },
      {
        serviceId: 'service-b',
        ok: true,
        slots: [slot('2026-08-13T08:00:00.000Z')],
      },
    ], {
      expertId: EXPERT_ID,
      timezone: 'Europe/Warsaw',
      now: '2026-08-12T08:00:00.000Z',
    })

    assert.equal(result.status, 'unknown')
    assert.deepEqual(result.dates, [])
  })
})
