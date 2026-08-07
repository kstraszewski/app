import { eveChannel } from 'eve/channels/eve'
import {
  extractBearerToken,
  ForbiddenError,
  type AuthFn,
  UnauthenticatedError,
} from 'eve/channels/auth'
import { verifyDataApiToken } from '@openexpert/data-api/token'
import {
  createAgentUserDataApiClient,
  getAgentDataApiVerificationOptions,
} from '../lib/data-api'

const organizationSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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
    try {
      const claims = verifyDataApiToken(accessToken, {
        ...verificationOptions,
        expectedRole: 'authenticated',
      })
      userId = claims.sub?.trim() ?? ''
      if (!userId) throw new TypeError('Authenticated Data API JWT is missing sub')
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
      .select('id, slug')
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
      },
    }
  }
}

export default eveChannel({
  auth: [dataApiCrmSession()],
  uploadPolicy: 'disabled',
})
