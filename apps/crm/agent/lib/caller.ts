import type { SessionContext } from 'eve/context'

export interface CrmAgentCaller {
  organizationId: string
  organizationSlug: string
  role: string
  userId: string
}

export function requireCrmAgentCaller(ctx: SessionContext): CrmAgentCaller {
  const caller = ctx.session.auth.current
  const organizationId = caller?.attributes.organizationId
  const organizationSlug = caller?.attributes.organizationSlug
  const role = caller?.attributes.role

  if (
    caller?.principalType !== 'user'
    || typeof organizationId !== 'string'
    || typeof organizationSlug !== 'string'
    || typeof role !== 'string'
  ) {
    throw new Error('An authenticated CRM organization user is required.')
  }

  return {
    organizationId,
    organizationSlug,
    role,
    userId: caller.principalId,
  }
}
