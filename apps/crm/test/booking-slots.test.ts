import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDaysToIsoDate,
  BOOKING_WEEK_DAYS,
  bookingDateRange,
  buildBookingWeekDays,
  formatBookingWeekRange,
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

test('booking week view groups and sorts slots in the facility timezone', () => {
  const days = buildBookingWeekDays(
    '2026-07-29',
    [
      {
        startsAt: '2026-07-30T09:00:00.000Z',
        endsAt: '2026-07-30T09:30:00.000Z',
        expertUserId: 'expert-1',
        expertName: 'Anna Nowak',
      },
      {
        startsAt: '2026-07-29T22:30:00.000Z',
        endsAt: '2026-07-29T23:00:00.000Z',
        expertUserId: 'expert-1',
        expertName: 'Anna Nowak',
      },
    ],
    'Europe/Warsaw',
  )

  assert.equal(days.length, BOOKING_WEEK_DAYS)
  assert.equal(days[1]?.date, '2026-07-30')
  assert.equal(days[1]?.weekday, 'Czw.')
  assert.equal(days[1]?.dateLabel, '30 lip')
  assert.deepEqual(
    days[1]?.slots.map(slot => slot.startsAt),
    ['2026-07-29T22:30:00.000Z', '2026-07-30T09:00:00.000Z'],
  )
  assert.match(days[1]?.ariaLabel ?? '', /30 lipca 2026/)
})

test('booking week range keeps the year visible and supports year boundaries', () => {
  assert.equal(
    formatBookingWeekRange('2026-07-29', '2026-08-04'),
    '29 lipca – 4 sierpnia 2026',
  )
  assert.equal(
    formatBookingWeekRange('2026-12-29', '2027-01-04'),
    '29 grudnia 2026 – 4 stycznia 2027',
  )
})
