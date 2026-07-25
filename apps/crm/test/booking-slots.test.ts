import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDaysToIsoDate,
  BOOKING_WEEK_DAYS,
  bookingDateRange,
  isoDateForTimestamp,
  isoDateRange,
  NEXT_AVAILABLE_SLOT_SEARCH_DAYS,
} from '../app/utils/booking-slots.ts'

test('next available slot search covers the following 31 days', () => {
  assert.equal(NEXT_AVAILABLE_SLOT_SEARCH_DAYS, 31)
  assert.equal(addDaysToIsoDate('2026-07-25', 31), '2026-08-25')
})

test('booking week range includes seven calendar days across a month boundary', () => {
  assert.equal(BOOKING_WEEK_DAYS, 7)
  assert.deepEqual(
    bookingDateRange('2026-07-29', BOOKING_WEEK_DAYS),
    { date: '2026-07-29', endDate: '2026-08-04' },
  )
  assert.deepEqual(
    isoDateRange('2026-07-29', BOOKING_WEEK_DAYS),
    [
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ],
  )
})

test('booking date range rejects unsafe lengths', () => {
  assert.throws(() => bookingDateRange('2026-07-25', 0), RangeError)
  assert.throws(() => bookingDateRange('2026-07-25', BOOKING_WEEK_DAYS + 1), RangeError)
})

test('slot timestamps are assigned to the facility local date', () => {
  assert.equal(
    isoDateForTimestamp('2026-07-31T22:30:00.000Z', 'Europe/Warsaw'),
    '2026-08-01',
  )
})
