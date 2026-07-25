import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  addDaysToDateKey,
  instantDateKeyInTimezone,
  startOfDateInTimezone,
} from '../shared/utils/zoned-date.ts'

describe('zoned calendar dates', () => {
  it('resolves midnight in the requested timezone', () => {
    assert.equal(
      startOfDateInTimezone('2026-07-25', 'Europe/Warsaw'),
      '2026-07-24T22:00:00.000Z',
    )
    assert.equal(
      startOfDateInTimezone('2026-07-25', 'America/New_York'),
      '2026-07-25T04:00:00.000Z',
    )
  })

  it('keeps all-day ranges correct across daylight-saving changes', () => {
    const startsAt = startOfDateInTimezone('2026-03-08', 'America/New_York')
    const endsAt = startOfDateInTimezone(
      addDaysToDateKey('2026-03-08', 1),
      'America/New_York',
    )
    assert.equal(
      new Date(endsAt).getTime() - new Date(startsAt).getTime(),
      23 * 60 * 60 * 1_000,
    )
  })

  it('maps an instant to the stored calendar timezone', () => {
    assert.equal(
      instantDateKeyInTimezone('2026-07-24T22:00:00.000Z', 'Europe/Warsaw'),
      '2026-07-25',
    )
    assert.equal(
      instantDateKeyInTimezone('2026-07-24T22:00:00.000Z', 'America/New_York'),
      '2026-07-24',
    )
  })
})
