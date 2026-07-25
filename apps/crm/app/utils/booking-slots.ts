export const BOOKING_WEEK_DAYS = 7
export const NEXT_AVAILABLE_SLOT_SEARCH_DAYS = 31

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
