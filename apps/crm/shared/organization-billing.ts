export const ORGANIZATION_KINDS = ['intermediary', 'application'] as const
export type OrganizationKind = typeof ORGANIZATION_KINDS[number]

export const BILLING_ACCESS_STATES = [
  'not_required',
  'subscription_required',
  'active',
  'grace',
  'blocked',
] as const
export type BillingAccessState = typeof BILLING_ACCESS_STATES[number]

export const APPLICATION_BILLING_PLAN_CODES = [
  'individual',
  'team',
  'legacy_per_seat',
] as const
export type ApplicationBillingPlanCode = typeof APPLICATION_BILLING_PLAN_CODES[number]

export const APPLICATION_BILLING_VAT_RATE_PERCENT = 23

export const PUBLIC_APPLICATION_BILLING_PLAN_CODES = ['individual', 'team'] as const
export type PublicApplicationBillingPlanCode = typeof PUBLIC_APPLICATION_BILLING_PLAN_CODES[number]

export const APPLICATION_BILLING_PLANS = {
  individual: {
    code: 'individual',
    stripePlanCode: 'application_individual_monthly',
    name: 'Indywidualny',
    currency: 'pln',
    unitAmount: 20_000,
    interval: 'month',
    intervalCount: 1,
    minSeats: 1,
    maxSeats: 1,
    taxBehavior: 'exclusive',
  },
  team: {
    code: 'team',
    stripePlanCode: 'application_team_monthly',
    name: 'Zespół',
    currency: 'pln',
    unitAmount: 15_000,
    interval: 'month',
    intervalCount: 1,
    minSeats: 3,
    maxSeats: 1_000,
    taxBehavior: 'exclusive',
  },
  legacy_per_seat: {
    code: 'legacy_per_seat',
    stripePlanCode: 'application_monthly',
    name: 'Aplikacja (plan historyczny)',
    currency: 'pln',
    unitAmount: 20_000,
    interval: 'month',
    intervalCount: 1,
    minSeats: 1,
    maxSeats: 1_000,
    taxBehavior: 'inclusive',
  },
} as const satisfies Record<ApplicationBillingPlanCode, {
  code: ApplicationBillingPlanCode
  stripePlanCode: string
  name: string
  currency: 'pln'
  unitAmount: number
  interval: 'month'
  intervalCount: 1
  minSeats: number
  maxSeats: number
  taxBehavior: 'exclusive' | 'inclusive'
}>

export function isApplicationBillingPlanCode(
  value: unknown,
): value is ApplicationBillingPlanCode {
  return typeof value === 'string'
    && (APPLICATION_BILLING_PLAN_CODES as readonly string[]).includes(value)
}

export function isPublicApplicationBillingPlanCode(
  value: unknown,
): value is PublicApplicationBillingPlanCode {
  return typeof value === 'string'
    && (PUBLIC_APPLICATION_BILLING_PLAN_CODES as readonly string[]).includes(value)
}

export function applicationBillingPlanSeatCountIsValid(
  planCode: ApplicationBillingPlanCode,
  seatCount: number,
): boolean {
  const plan = APPLICATION_BILLING_PLANS[planCode]
  return Number.isSafeInteger(seatCount)
    && seatCount >= plan.minSeats
    && seatCount <= plan.maxSeats
}

export function addApplicationBillingVat(amountMinor: number): number {
  return Math.round(amountMinor * (100 + APPLICATION_BILLING_VAT_RATE_PERCENT) / 100)
}

export function applicationBillingGrossAmount(
  amountMinor: number,
  planCode: ApplicationBillingPlanCode,
): number {
  return APPLICATION_BILLING_PLANS[planCode].taxBehavior === 'inclusive'
    ? amountMinor
    : addApplicationBillingVat(amountMinor)
}

// Compatibility alias for organizations that subscribed before the public
// Indywidualny/Zespół offer. It is not selectable by new customers.
export const APPLICATION_MONTHLY_PLAN = {
  code: APPLICATION_BILLING_PLANS.legacy_per_seat.stripePlanCode,
  name: APPLICATION_BILLING_PLANS.legacy_per_seat.name,
  currency: APPLICATION_BILLING_PLANS.legacy_per_seat.currency,
  unitAmount: APPLICATION_BILLING_PLANS.legacy_per_seat.unitAmount,
  interval: APPLICATION_BILLING_PLANS.legacy_per_seat.interval,
  intervalCount: APPLICATION_BILLING_PLANS.legacy_per_seat.intervalCount,
} as const

export function isOrganizationKind(value: unknown): value is OrganizationKind {
  return typeof value === 'string'
    && (ORGANIZATION_KINDS as readonly string[]).includes(value)
}

export function isBillingAccessGranted(state: BillingAccessState): boolean {
  return state === 'not_required' || state === 'active' || state === 'grace'
}

export function stripeSubscriptionAccessState(status: string): BillingAccessState {
  if (status === 'active' || status === 'trialing') return 'active'
  if (status === 'past_due') return 'grace'
  if (status === 'incomplete') return 'subscription_required'
  return 'blocked'
}
