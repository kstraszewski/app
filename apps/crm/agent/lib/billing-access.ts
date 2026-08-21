const BILLING_ACCESS_STATES = new Set([
  'subscription_required',
  'active',
  'grace',
  'blocked',
  'not_required',
])

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('The billing access projection is invalid.')
  }
  return value as Record<string, unknown>
}

export function authoritativeAgentBillingAccessGranted(
  organizationKind: unknown,
  organizationId: string,
  value: unknown,
): boolean {
  if (organizationKind !== 'application' && organizationKind !== 'intermediary') {
    throw new TypeError('The organization kind is invalid.')
  }

  const projection = record(value)
  const projectedOrganizationId = projection.organizationId
  const billingAccessState = projection.billingAccessState
  const entitled = projection.entitled
  if (
    projectedOrganizationId !== organizationId
    || typeof billingAccessState !== 'string'
    || !BILLING_ACCESS_STATES.has(billingAccessState)
    || typeof entitled !== 'boolean'
  ) {
    throw new TypeError('The billing access projection is invalid.')
  }

  const accessGranted = organizationKind === 'intermediary'
    ? billingAccessState === 'not_required'
    : billingAccessState === 'active' || billingAccessState === 'grace'
  if (entitled !== accessGranted) {
    throw new TypeError('The billing access projection is inconsistent.')
  }
  return accessGranted
}
