type ZonedDateParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function zonedDateParts(value: Date, timezone: string): ZonedDateParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

export function addDaysToDateKey(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day! + days, 12))
  return date.toISOString().slice(0, 10)
}

export function instantDateKeyInTimezone(
  value: Date | string,
  timezone: string,
): string {
  const parts = zonedDateParts(
    value instanceof Date ? value : new Date(value),
    timezone,
  )
  return [
    String(parts.year).padStart(4, '0'),
    String(parts.month).padStart(2, '0'),
    String(parts.day).padStart(2, '0'),
  ].join('-')
}

export function startOfDateInTimezone(value: string, timezone: string): string {
  const [year, month, day] = value.split('-').map(Number)
  const targetWallClock = Date.UTC(year!, month! - 1, day!)
  let candidate = targetWallClock

  // Intl exposes the wall clock for an instant, so converge from a UTC guess
  // to the instant whose wall clock is 00:00:00 in the requested timezone.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = zonedDateParts(new Date(candidate), timezone)
    const observedWallClock = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    )
    const correction = targetWallClock - observedWallClock
    if (correction === 0) break
    candidate += correction
  }

  const resolved = zonedDateParts(new Date(candidate), timezone)
  if (
    resolved.year !== year
    || resolved.month !== month
    || resolved.day !== day
    || resolved.hour !== 0
    || resolved.minute !== 0
    || resolved.second !== 0
  ) {
    throw new RangeError(`Local date ${value} has no midnight in ${timezone}`)
  }
  return new Date(candidate).toISOString()
}
