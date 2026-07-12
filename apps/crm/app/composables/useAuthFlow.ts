interface AuthErrorLike {
  message?: string
  code?: string
}

export function useAuthFlow() {
  const supabase = useSupabaseClient()
  const user = useSupabaseUser()

  function safeRedirect(value: unknown, fallback = '/dashboard') {
    if (typeof value !== 'string') return fallback
    if (!value.startsWith('/') || value.startsWith('//')) return fallback
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
    if (requested && requested !== '/dashboard') return requested

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('organization_id')
      .single()
    if (profileError || !profile?.organization_id) throw profileError ?? new Error('Brak organizacji użytkownika.')

    const { data: organization, error: organizationError } = await supabase
      .from('organizations')
      .select('slug')
      .eq('id', profile.organization_id)
      .single()
    if (organizationError || !organization?.slug) throw organizationError ?? new Error('Brak organizacji użytkownika.')
    return `/org/${encodeURIComponent(organization.slug)}/dashboard`
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
