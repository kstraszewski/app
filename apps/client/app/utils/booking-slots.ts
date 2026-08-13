import type { PublicBookingSlot } from '../types/booking'

export const BOOKING_WEEK_DAYS = 7
export const NEXT_AVAILABLE_SLOT_SEARCH_DAYS = 31

export interface BookingWeekDay {
  date: string
  weekday: string
  dateLabel: string
  ariaLabel: string
  slots: PublicBookingSlot[]
}

export function bookingDateQueryValue(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return ''
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
    ? value
    : ''
}

export function addDaysToIsoDate(value: string, days: number): string {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

export function bookingDateRange(
  date: string,
  days = 1,
): { date: string, endDate: string } {
  if (!Number.isInteger(days) || days < 1 || days > BOOKING_WEEK_DAYS) {
    throw new RangeError(`Booking date range must cover between 1 and ${BOOKING_WEEK_DAYS} days`)
  }
  return {
    date,
    endDate: addDaysToIsoDate(date, days - 1),
  }
}

export function isoDateRange(date: string, days = 1): string[] {
  bookingDateRange(date, days)
  return Array.from({ length: days }, (_, index) => addDaysToIsoDate(date, index))
}

export function isoDateForTimestamp(
  value: string,
  timeZone: string,
): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const dateParts = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`
}

export function buildBookingWeekDays(
  startDate: string,
  slots: PublicBookingSlot[],
  timeZone: string,
): BookingWeekDay[] {
  const dates = isoDateRange(startDate, BOOKING_WEEK_DAYS)
  const slotsByDate = new Map(dates.map(date => [date, [] as PublicBookingSlot[]]))
  for (const slot of slots) {
    const date = isoDateForTimestamp(slot.startsAt, timeZone)
    slotsByDate.get(date)?.push(slot)
  }
  for (const daySlots of slotsByDate.values()) {
    daySlots.sort((left, right) => left.startsAt.localeCompare(right.startsAt))
  }
  return dates.map((date) => {
    const weekday = formatIsoDate(date, { weekday: 'short' })
    return {
      date,
      weekday: weekday.charAt(0).toLocaleUpperCase('pl-PL') + weekday.slice(1),
      dateLabel: formatIsoDate(date, {
        day: 'numeric',
        month: 'short',
      }).replace(/\.$/, ''),
      ariaLabel: formatIsoDate(date, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }),
      slots: slotsByDate.get(date) ?? [],
    }
  })
}

export function formatBookingWeekRange(startDate: string, endDate: string): string {
  if (!startDate || !endDate) return 'Najbliższe 7 dni'
  const start = dateFromIso(startDate)
  const end = dateFromIso(endDate)
  const withoutYear = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
  const withYear = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return start.getUTCFullYear() === end.getUTCFullYear()
    ? `${withoutYear.format(start)} – ${withYear.format(end)}`
    : `${withYear.format(start)} – ${withYear.format(end)}`
}

function dateFromIso(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

function formatIsoDate(
  value: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat('pl-PL', {
    ...options,
    timeZone: 'UTC',
  }).format(dateFromIso(value))
}
