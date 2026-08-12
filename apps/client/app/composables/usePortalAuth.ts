interface AuthErrorLike {
  message?: string
  code?: string
  status?: number
  statusCode?: number
  data?: {
    message?: string
    code?: string
    statusMessage?: string
    data?: { code?: string }
  }
}

export function portalAuthErrorCode(
  error: AuthErrorLike | null | undefined,
): string {
  return String(
    error?.code
    || error?.data?.code
    || error?.data?.data?.code
    || '',
  ).toUpperCase()
}

export function usePortalAuth() {
  function safeRedirect(value: unknown, fallback = '/') {
    if (typeof value !== 'string') return fallback
    if (
      !value.startsWith('/')
      || value.startsWith('//')
      || value.includes('\\')
      || /%5c/iu.test(value)
    ) return fallback
    return value
  }

  function absoluteCallback(path: string) {
    const origin = String(useRuntimeConfig().public.openexpert.portalBaseUrl || '')
      .replace(/\/+$/u, '')
    return origin ? `${origin}${safeRedirect(path)}` : safeRedirect(path)
  }

  function errorMessage(error: AuthErrorLike | null | undefined) {
    const code = portalAuthErrorCode(error)
    const source = String(error?.message || error?.data?.message || error?.data?.statusMessage || '')
    const message = source.toLowerCase()
    if (code === 'INVALID_EMAIL_OR_PASSWORD' || message.includes('invalid email or password')) {
      return 'Nieprawidłowy email lub hasło.'
    }
    if (code === 'EMAIL_NOT_VERIFIED' || message.includes('email not verified')) {
      return 'Najpierw potwierdź adres email linkiem wysłanym przez OpenExpert.'
    }
    if (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN' || message.includes('expired')) {
      return 'Link wygasł albo został już użyty. Poproś o nowy link.'
    }
    if (code === 'PORTAL_ACCOUNT_ARCHIVED') {
      return 'To konto panelu zostało zarchiwizowane. Skontaktuj się ze swoim ekspertem, jeśli potrzebujesz ponownie uzyskać dostęp.'
    }
    if (error?.status === 429 || error?.statusCode === 429) {
      return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.'
    }
    return source || 'Nie udało się wykonać operacji. Spróbuj ponownie.'
  }

  return {
    absoluteCallback,
    errorCode: portalAuthErrorCode,
    errorMessage,
    safeRedirect,
  }
}
