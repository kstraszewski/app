import type { SessionContext } from 'eve/context'
import type { CrmAgentCaseInvocation } from './invocation'
import { readCrmAgentInvocation } from './invocation'

export interface CrmAgentCaller {
  organizationId: string
  organizationSlug: string
  role: string
  userId: string
  canUseExperiments: boolean
  invocation: CrmAgentCaseInvocation | null
}

export function requireCrmAgentCaller(ctx: SessionContext): CrmAgentCaller {
  const caller = ctx.session.auth.current
  const organizationId = caller?.attributes.organizationId
  const organizationSlug = caller?.attributes.organizationSlug
  const role = caller?.attributes.role
  const canUseExperiments = caller?.attributes.canUseExperiments

  if (
    caller?.principalType !== 'user'
    || typeof organizationId !== 'string'
    || typeof organizationSlug !== 'string'
    || typeof role !== 'string'
    || typeof canUseExperiments !== 'boolean'
  ) {
    throw new Error('An authenticated CRM organization user is required.')
  }

  const invocation = readCrmAgentInvocation(ctx)
  if (invocation?.scope.type === 'mailbox') {
    throw new Error('Ten szkic wiadomości nie ma zweryfikowanego zakresu CRM. Narzędzia CRM są niedostępne.')
  }

  return {
    organizationId,
    organizationSlug,
    role,
    userId: caller.principalId,
    canUseExperiments,
    invocation,
  }
}
