export const APPLICATION_SEAT_PRICE_PLN = 200
export const APPLICATION_SEAT_MIN = 1
export const APPLICATION_SEAT_MAX = 100

export function normalizeApplicationSeatCount(value: unknown): number {
  const numericValue = typeof value === 'number'
    ? value
    : Number.parseInt(String(value), 10)

  if (!Number.isFinite(numericValue)) return APPLICATION_SEAT_MIN

  return Math.min(
    APPLICATION_SEAT_MAX,
    Math.max(APPLICATION_SEAT_MIN, Math.trunc(numericValue)),
  )
}

function registrationUrl(crmBaseUrl: string): URL {
  const normalizedBaseUrl = crmBaseUrl.endsWith('/')
    ? crmBaseUrl
    : `${crmBaseUrl}/`

  return new URL('/register', normalizedBaseUrl)
}

export function buildLoginUrl(crmBaseUrl: string): string {
  const normalizedBaseUrl = crmBaseUrl.endsWith('/')
    ? crmBaseUrl
    : `${crmBaseUrl}/`

  return new URL('/login', normalizedBaseUrl).toString()
}

export function buildApplicationRegistrationUrl(
  crmBaseUrl: string,
  seatCount: unknown,
): string {
  const url = registrationUrl(crmBaseUrl)
  url.searchParams.set('kind', 'application')
  url.searchParams.set('plan', 'application_monthly')
  url.searchParams.set('seats', String(normalizeApplicationSeatCount(seatCount)))
  url.searchParams.set('source', 'landing_pricing')
  return url.toString()
}
