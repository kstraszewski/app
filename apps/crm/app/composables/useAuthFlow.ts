import type { AccountContexts } from '~/types/account'

interface AuthErrorLike {
  message?: string
  code?: string
}

export function useAuthFlow() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()
  const requestFetch = useRequestFetch()

  function safeRedirect(value: unknown, fallback = '/dashboard') {
    if (typeof value !== 'string') return fallback
    if (
      !value.startsWith('/')
      || value.startsWith('//')
      || value.includes('\\')
      || /%5c/iu.test(value)
    ) return fallback
    return value
  }

  function callbackUrl(path: string, next = '/dashboard') {
    if (import.meta.server) return path
    const url = new URL(path, window.location.origin)
    url.searchParams.set('next', safeRedirect(next))
    return url.toString()
  }

  async function resolvePostAuthPath(value?: unknown) {
    const requested = safeRedirect(value, '')

    const legacyOrganizationPath = /^\/(dashboard|clients|cases|facilities|mortgages|settings|teams)(\/|$)/.test(requested)
    if (requested && !legacyOrganizationPath) return requested

    const contexts = await requestFetch<AccountContexts>('/api/me/contexts')
    const defaultOrganization = contexts.staffOrganizations.find(organization => organization.isDefault)
      ?? contexts.staffOrganizations[0]

    if (legacyOrganizationPath && defaultOrganization) {
      return `/org/${encodeURIComponent(defaultOrganization.slug)}${requested}`
    }
    if (contexts.hasStaff && contexts.hasClient) return '/account'
    if (defaultOrganization) {
      return `/org/${encodeURIComponent(defaultOrganization.slug)}/dashboard`
    }
    if (contexts.hasClient) return '/client'
    return '/onboarding'
  }

  function passwordIssue(password: string) {
    if (password.length < 10) return 'Hasło musi mieć co najmniej 10 znaków.'
    if (!/[a-z]/.test(password)) return 'Dodaj do hasła małą literę.'
    if (!/[A-Z]/.test(password)) return 'Dodaj do hasła wielką literę.'
    if (!/[0-9]/.test(password)) return 'Dodaj do hasła cyfrę.'
    return null
  }

  function errorMessage(error: AuthErrorLike | null | undefined) {
    const message = error?.message?.toLowerCase() ?? ''
    if (message.includes('invalid login credentials')) {
      return 'Nieprawidłowy email lub hasło.'
    }
    if (message.includes('email not confirmed')) {
      return 'Najpierw potwierdź adres email.'
    }
    if (message.includes('user already registered')) {
      return 'Konto z tym adresem już istnieje.'
    }
    if (message.includes('password')) {
      return 'Hasło nie spełnia wymagań bezpieczeństwa.'
    }
    if (message.includes('rate limit')) {
      return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.'
    }
    return error?.message ?? 'Nie udało się wykonać operacji. Spróbuj ponownie.'
  }

  async function syncAuthenticatedUser() {
    const { data, error } = await supabase.auth.getClaims()
    if (error) throw error
    user.value = data?.claims ?? null
    return Boolean(user.value)
  }

  return {
    callbackUrl,
    errorMessage,
    passwordIssue,
    resolvePostAuthPath,
    safeRedirect,
    syncAuthenticatedUser,
  }
}
