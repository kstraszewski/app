import { createOpenExpertAuthClient } from '@openexpert/auth/client'

export interface AuthenticatedUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

interface BetterAuthSessionResponse {
  user?: {
    id?: string
    name?: string
    email?: string
    emailVerified?: boolean
  }
}

let authClient: ReturnType<typeof createOpenExpertAuthClient> | null = null

export function useAuthClient() {
  if (authClient) return authClient
  const configuredBaseUrl = String(
    useRuntimeConfig().public.openexpert.authBaseUrl || '',
  ).trim()
  authClient = createOpenExpertAuthClient(configuredBaseUrl
    ? { baseURL: configuredBaseUrl }
    : {})
  return authClient
}

export function useAuthUser() {
  return useState<AuthenticatedUser | null>('openexpert-client-auth-user', () => null)
}

export function authenticatedUserFromSession(
  response: BetterAuthSessionResponse | null | undefined,
): AuthenticatedUser | null {
  const source = response?.user
  if (!source?.id || !source.email) return null
  return {
    id: source.id,
    name: String(source.name || '').trim() || source.email.split('@')[0] || 'Klient',
    email: source.email,
    emailVerified: source.emailVerified === true,
  }
}

export async function refreshAuthUser() {
  const user = useAuthUser()
  try {
    const response = await useRequestFetch()<BetterAuthSessionResponse | null>(
      '/api/auth/get-session',
      { headers: { 'cache-control': 'no-cache' } },
    )
    user.value = authenticatedUserFromSession(response)
  }
  catch {
    user.value = null
  }
  return user.value
}

export async function signOutAuthenticatedUser() {
  try {
    await useAuthClient().signOut()
  }
  finally {
    useAuthUser().value = null
    clearNuxtData()
  }
}
