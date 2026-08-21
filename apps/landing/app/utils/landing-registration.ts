export const APPLICATION_BILLING_PLANS = {
  individual: {
    code: 'individual',
    label: 'Indywidualny',
    seatPricePln: 200,
    minSeats: 1,
    maxSeats: 1,
  },
  team: {
    code: 'team',
    label: 'Zespół',
    seatPricePln: 150,
    minSeats: 3,
    maxSeats: 100,
  },
} as const

export type ApplicationBillingPlanCode = keyof typeof APPLICATION_BILLING_PLANS
export const APPLICATION_SEAT_MAX = 100
export const APPLICATION_BILLING_VAT_RATE_PERCENT = 23

export function applicationBillingGrossPricePln(netAmountPln: number): number {
  return Math.round(netAmountPln * (100 + APPLICATION_BILLING_VAT_RATE_PERCENT)) / 100
}

export function normalizeApplicationSeatCount(
  value: unknown,
  plan: ApplicationBillingPlanCode = 'individual',
): number {
  const offer = APPLICATION_BILLING_PLANS[plan]
  const numericValue = typeof value === 'number'
    ? value
    : Number.parseInt(String(value), 10)

  if (!Number.isFinite(numericValue)) return offer.minSeats

  return Math.min(
    offer.maxSeats,
    Math.max(offer.minSeats, Math.trunc(numericValue)),
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
  plan: ApplicationBillingPlanCode,
  seatCount: unknown,
): string {
  const url = registrationUrl(crmBaseUrl)
  url.searchParams.set('kind', 'application')
  url.searchParams.set('plan', plan)
  url.searchParams.set('seats', String(normalizeApplicationSeatCount(seatCount, plan)))
  url.searchParams.set('source', 'landing_pricing')
  return url.toString()
}
