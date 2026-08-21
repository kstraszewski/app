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

export const APPLICATION_MONTHLY_PLAN = {
  code: 'application_monthly',
  name: 'Aplikacja',
  currency: 'pln',
  unitAmount: 20_000,
  interval: 'month',
  intervalCount: 1,
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
