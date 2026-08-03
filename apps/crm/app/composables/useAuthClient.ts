import { createOpenExpertAuthClient } from '@openexpert/auth/client'

export interface AuthenticatedUser {
  id: string
  sub: string
  name: string
  email: string
  emailVerified: boolean
  phoneNumber: string | null
  phoneNumberVerified: boolean
  user_metadata: {
    full_name: string
  }
}

export interface BetterAuthSessionResponse {
  user?: {
    id?: string
    name?: string
    email?: string
    emailVerified?: boolean
    phoneNumber?: string | null
    phoneNumberVerified?: boolean
  }
}

const authClient = createOpenExpertAuthClient()

export function useAuthClient() {
  return authClient
}

export function useAuthUser() {
  return useState<AuthenticatedUser | null>('openexpert-auth-user', () => null)
}

export function authenticatedUserFromSession(
  response: BetterAuthSessionResponse | null | undefined,
): AuthenticatedUser | null {
  const source = response?.user
  if (!source?.id || !source.email) return null

  const name = String(source.name || '').trim()
  return {
    id: source.id,
    sub: source.id,
    name,
    email: source.email,
    emailVerified: source.emailVerified === true,
    phoneNumber: typeof source.phoneNumber === 'string' ? source.phoneNumber : null,
    phoneNumberVerified: source.phoneNumberVerified === true,
    user_metadata: { full_name: name },
  }
}

export async function refreshAuthUser(): Promise<AuthenticatedUser | null> {
  const user = useAuthUser()
  const requestFetch = useRequestFetch()
  try {
    const response = await requestFetch<BetterAuthSessionResponse | null>(
      '/api/auth/get-session',
      { headers: { 'cache-control': 'no-cache' } },
    )
    user.value = authenticatedUserFromSession(response)
    return user.value
  }
  catch {
    user.value = null
    return null
  }
}

export async function signOutAuthenticatedUser(): Promise<void> {
  try {
    await authClient.signOut()
  }
  finally {
    useAuthUser().value = null
    clearNuxtData(key => (
      key === 'openexpert-organizations'
      || key.startsWith('account-contexts:')
      || key.startsWith('client-appointments:')
    ))
  }
}
