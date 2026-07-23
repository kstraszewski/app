import { eveChannel } from 'eve/channels/eve'
import {
  extractBearerToken,
  ForbiddenError,
  type AuthFn,
  UnauthenticatedError,
} from 'eve/channels/auth'
import { createAgentUserClient } from '../lib/supabase'

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
  supabase: ReturnType<typeof createAgentUserClient>,
  sessionId: string,
  userId: string,
  organizationId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await supabase
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

function supabaseCrmSession(): AuthFn<Request> {
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

    const supabase = createAgentUserClient(accessToken)
    const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken)
    const user = userResult.user
    if (userError || !user) {
      throw new UnauthenticatedError({
        code: 'invalid_session',
        message: 'Sesja CRM wygasła. Zaloguj się ponownie.',
      })
    }

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('id, slug')
      .eq('slug', organizationSlug)
      .maybeSingle()
    if (organizationError || !organization) {
      throw new ForbiddenError({ message: 'Organizacja jest niedostępna.' })
    }

    const { data: membership, error: membershipError } = await supabase
      .from('organization_memberships')
      .select('role')
      .eq('organization_id', organization.id)
      .eq('user_id', user.id)
      .maybeSingle()
    if (membershipError || !membership) {
      throw new ForbiddenError({ message: 'Nie masz dostępu do tej organizacji.' })
    }

    const sessionId = requestSessionId(request)
    if (sessionId) {
      await requireOwnedSession(supabase, sessionId, user.id, String(organization.id))
    }

    return {
      authenticator: 'supabase',
      issuer: 'openexpert-crm',
      principalId: user.id,
      principalType: 'user',
      subject: user.id,
      attributes: {
        organizationId: String(organization.id),
        organizationSlug: String(organization.slug),
        role: String(membership.role ?? 'expert'),
      },
    }
  }
}

export default eveChannel({
  auth: [supabaseCrmSession()],
  uploadPolicy: 'disabled',
})
