import { eveChannel } from 'eve/channels/eve'
import {
  extractBearerToken,
  ForbiddenError,
  type AuthFn,
  UnauthenticatedError,
} from 'eve/channels/auth'
import { verifyDataApiToken } from '@openexpert/data-api/token'
import { CRM_AGENT_INVOCATION_CLAIMS } from '../../shared/types/agent-invocation'
import { authoritativeAgentBillingAccessGranted } from '../lib/billing-access'
import {
  createAgentServiceClient,
  createAgentUserDataApiClient,
  getAgentDataApiVerificationOptions,
} from '../lib/data-api'

const organizationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function claimText(claims: Record<string, unknown>, name: string): string {
  const value = claims[name]
  return typeof value === 'string' ? value.trim() : ''
}

function invocationAttributes(claims: Record<string, unknown>): Record<string, string> {
  const preset = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.preset)
  if (!preset) return {}

  const modelProfile = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.modelProfile)
  const declaredScopeType = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.scopeType)
  const caseId = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.caseId)
  const caseTitle = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.caseTitle)
  const clientId = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.clientId)
  const clientName = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.clientName)
  const clientEmail = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.clientEmail)
  const clientPhone = claimText(claims, CRM_AGENT_INVOCATION_CLAIMS.clientPhone)
  if (preset !== 'mail-reply' || modelProfile !== 'flash-lite') {
    throw new ForbiddenError({ message: 'Nieprawidłowy preset uruchomienia Agenta AI.' })
  }

  if (declaredScopeType === 'mailbox') {
    if (caseId || caseTitle || clientId || clientName || clientEmail || clientPhone) {
      throw new ForbiddenError({ message: 'Nieprawidłowy zakres uruchomienia Agenta AI.' })
    }
    return {
      agentInvocationPreset: preset,
      agentInvocationModelProfile: modelProfile,
      agentInvocationScopeType: 'mailbox',
    }
  }

  // Tokens minted before scopeType was introduced remain valid during a rolling deploy.
  if (
    (declaredScopeType && declaredScopeType !== 'case')
    || !caseId
    || !caseTitle
    || !clientId
    || !clientName
  ) {
    throw new ForbiddenError({ message: 'Nieprawidłowy zakres uruchomienia Agenta AI.' })
  }

  return {
    agentInvocationPreset: preset,
    agentInvocationModelProfile: modelProfile,
    agentInvocationScopeType: 'case',
    agentInvocationCaseId: caseId,
    agentInvocationCaseTitle: caseTitle,
    agentInvocationClientId: clientId,
    agentInvocationClientName: clientName,
    agentInvocationClientEmail: clientEmail,
    agentInvocationClientPhone: clientPhone,
  }
}

function requestSessionId(request: Request): string | null {
  const match = new URL(request.url).pathname.match(/\/eve\/v1\/session\/([^/]+)/)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  }
  catch {
    throw new ForbiddenError({ message: 'Nieprawidłowy identyfikator sesji asystenta.' })
  }
}

async function requireOwnedSession(
  dataApi: ReturnType<typeof createAgentUserDataApiClient>,
  sessionId: string,
  userId: string,
  organizationId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await dataApi
      .from('crm_eve_sessions')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .maybeSingle()

    if (error) throw new ForbiddenError({ message: 'Nie można zweryfikować sesji asystenta.' })
    if (data) return
    if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 40))
  }

  throw new ForbiddenError({ message: 'Ta sesja asystenta nie należy do bieżącego użytkownika.' })
}

function dataApiCrmSession(): AuthFn<Request> {
  return async (request) => {
    const accessToken = extractBearerToken(request.headers.get('authorization'))
    if (!accessToken) {
      throw new UnauthenticatedError({
        code: 'authentication_required',
        message: 'Zaloguj się do CRM, aby użyć asystenta.',
      })
    }

    const organizationSlug = request.headers.get('x-openexpert-organization')?.trim() ?? ''
    if (!organizationSlugPattern.test(organizationSlug)) {
      throw new ForbiddenError({ message: 'Nie wybrano prawidłowej organizacji CRM.' })
    }

    const verificationOptions = getAgentDataApiVerificationOptions()
    let userId: string
    let tokenClaims: Record<string, unknown>
    try {
      const claims = verifyDataApiToken(accessToken, {
        ...verificationOptions,
        expectedRole: 'authenticated',
      })
      userId = claims.sub?.trim() ?? ''
      if (!userId) throw new TypeError('Authenticated Data API JWT is missing sub')
      tokenClaims = claims as Record<string, unknown>
    }
    catch {
      throw new UnauthenticatedError({
        code: 'invalid_session',
        message: 'Sesja CRM wygasła. Zaloguj się ponownie.',
      })
    }

    const dataApi = createAgentUserDataApiClient(accessToken)
    const { data: organization, error: organizationError } = await dataApi
      .from('organizations')
      .select('id, slug, kind')
      .eq('slug', organizationSlug)
      .maybeSingle()
    if (organizationError || !organization) {
      throw new ForbiddenError({ message: 'Organizacja jest niedostępna.' })
    }
    const { data: membership, error: membershipError } = await dataApi
      .from('organization_memberships')
      .select('role')
      .eq('organization_id', organization.id)
      .eq('user_id', userId)
      .maybeSingle()
    if (membershipError || !membership) {
      throw new ForbiddenError({ message: 'Nie masz dostępu do tej organizacji.' })
    }

    let billingAccessGranted = false
    try {
      const serviceDataApi = createAgentServiceClient()
      const { data: accessProjection, error: accessProjectionError } = await serviceDataApi.rpc(
        'get_organization_billing_access_v1',
        { p_organization_id: organization.id },
      )
      if (accessProjectionError) throw accessProjectionError
      billingAccessGranted = authoritativeAgentBillingAccessGranted(
        organization.kind,
        String(organization.id),
        accessProjection,
      )
    }
    catch {
      throw new ForbiddenError({ message: 'Nie można zweryfikować dostępu do subskrypcji.' })
    }
    if (!billingAccessGranted) {
      throw new ForbiddenError({ message: 'Ta organizacja wymaga aktywnej subskrypcji.' })
    }

    const { data: experimentsRole, error: experimentsRoleError } = await dataApi
      .from('organization_user_admin_roles')
      .select('role_key')
      .eq('organization_id', organization.id)
      .eq('user_id', userId)
      .eq('role_key', 'experiments_access')
      .maybeSingle()
    if (experimentsRoleError) {
      throw new ForbiddenError({ message: 'Nie można zweryfikować dostępu do eksperymentów.' })
    }

    const sessionId = requestSessionId(request)
    if (sessionId) {
      await requireOwnedSession(dataApi, sessionId, userId, String(organization.id))
    }

    return {
      authenticator: 'data-api',
      issuer: 'openexpert-crm',
      principalId: userId,
      principalType: 'user',
      subject: userId,
      attributes: {
        organizationId: String(organization.id),
        organizationSlug: String(organization.slug),
        role: String(membership.role ?? 'expert'),
        canUseExperiments: Boolean(experimentsRole),
        ...invocationAttributes(tokenClaims),
      },
    }
  }
}

export default eveChannel({
  auth: [dataApiCrmSession()],
  uploadPolicy: 'disabled',
})
