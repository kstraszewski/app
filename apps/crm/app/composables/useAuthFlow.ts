import type { AccountContexts } from '~/types/account'
import { getPasswordIssue } from '~/utils/password-validation'

interface AuthErrorLike {
  message?: string
  code?: string
  status?: number
  statusCode?: number
  data?: {
    message?: string
    code?: string
  }
}

export function useAuthFlow() {
  const user = useAuthUser()
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

  function callbackUrl(path: string, next?: unknown) {
    const url = new URL(safeRedirect(path, '/'), 'https://openexpert.invalid')
    if (next !== undefined) url.searchParams.set('next', safeRedirect(next))
    return `${url.pathname}${url.search}${url.hash}`
  }

  async function resolvePostAuthPath(value?: unknown) {
    const requested = safeRedirect(value, '')

    const legacyOrganizationPath = /^\/(calculator|dashboard|clients|cases|facilities|mortgages|settings|teams)(\/|$)/.test(requested)
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
    return getPasswordIssue(password)
  }

  function errorMessage(error: AuthErrorLike | null | undefined) {
    const code = String(error?.code || error?.data?.code || '').toUpperCase()
    const originalMessage = error?.message || error?.data?.message || ''
    const message = originalMessage.toLowerCase()
    if (
      code === 'INVALID_EMAIL_OR_PASSWORD'
      || message.includes('invalid email or password')
      || message.includes('invalid login credentials')
    ) {
      return 'Nieprawidłowy email lub hasło.'
    }
    if (code === 'INVALID_EMAIL' || message === 'invalid email') {
      return 'Podaj poprawny adres email.'
    }
    if (
      code === 'INVALID_PHONE_NUMBER'
      || message.includes('invalid phone number')
    ) {
      return 'Podaj poprawny numer telefonu z kodem kraju.'
    }
    if (code === 'PHONE_NUMBER_EXIST') {
      return 'Ten numer telefonu jest już połączony z innym kontem.'
    }
    if (
      code === 'INVALID_OTP'
      || message.includes('invalid otp')
    ) {
      return 'Kod jest nieprawidłowy. Sprawdź SMS i spróbuj ponownie.'
    }
    if (
      code === 'OTP_EXPIRED'
      || code === 'OTP_NOT_FOUND'
      || message.includes('otp expired')
      || message.includes('otp not found')
    ) {
      return 'Kod wygasł. Wyślij nowy kod i spróbuj ponownie.'
    }
    if (
      code === 'TOO_MANY_ATTEMPTS'
      || message.includes('too many attempts')
    ) {
      return 'Przekroczono limit prób. Wyślij nowy kod.'
    }
    if (
      code === 'SEND_OTP_NOT_IMPLEMENTED'
      || message.includes('phone authentication is not configured')
    ) {
      return 'Logowanie telefonem jest chwilowo niedostępne.'
    }
    if (
      code === 'EMAIL_NOT_VERIFIED'
      || message.includes('email not verified')
      || message.includes('email not confirmed')
    ) {
      return 'Najpierw potwierdź adres email.'
    }
    if (
      code === 'SESSION_NOT_FRESH'
      || message.includes('session is not fresh')
    ) {
      return 'Dla bezpieczeństwa zaloguj się ponownie, a następnie ponów operację.'
    }
    if (
      code === 'AUTH_CANCELLED'
      || code === 'REGISTRATION_CANCELLED'
      || message.includes('the operation either timed out or was not allowed')
      || message.includes('notallowederror')
    ) {
      return 'Operacja klucza dostępu została anulowana.'
    }
    if (code === 'PREVIOUSLY_REGISTERED') {
      return 'Ten klucz dostępu jest już dodany do konta.'
    }
    if (
      code === 'CHALLENGE_NOT_FOUND'
      || code === 'AUTHENTICATION_FAILED'
      || code === 'FAILED_TO_VERIFY_REGISTRATION'
      || code === 'UNABLE_TO_CREATE_SESSION'
    ) {
      return 'Nie udało się zweryfikować klucza dostępu. Spróbuj ponownie.'
    }
    if (code === 'SESSION_REQUIRED') {
      return 'Dla bezpieczeństwa zaloguj się ponownie przed dodaniem klucza dostępu.'
    }
    if (
      code === 'USER_ALREADY_EXISTS'
      || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'
      || message.includes('user already exists')
      || message.includes('user already registered')
    ) {
      return 'Konto z tym adresem już istnieje.'
    }
    if (
      code === 'PASSWORD_TOO_SHORT'
      || code === 'PASSWORD_TOO_LONG'
      || code === 'INVALID_PASSWORD'
      || message.includes('password')
    ) {
      return 'Hasło nie spełnia wymagań bezpieczeństwa.'
    }
    if (
      code === 'INVALID_TOKEN'
      || code === 'TOKEN_EXPIRED'
      || message.includes('invalid token')
      || message.includes('token expired')
    ) {
      return 'Link jest nieprawidłowy albo wygasł. Poproś o nowy link.'
    }
    if (
      error?.status === 429
      || error?.statusCode === 429
      || message.includes('rate limit')
      || message.includes('too many requests')
    ) {
      return 'Za dużo prób. Odczekaj chwilę i spróbuj ponownie.'
    }
    if (
      code.startsWith('FAILED_TO_')
      || code === 'INVALID_ORIGIN'
      || code === 'INVALID_CALLBACK_URL'
      || code === 'INVALID_ERROR_CALLBACK_URL'
      || code === 'INVALID_NEW_USER_CALLBACK_URL'
      || code === 'NEW_USER_SIGNUP_DISABLED'
    ) {
      return 'Nie udało się wykonać operacji. Spróbuj ponownie.'
    }
    return originalMessage || 'Nie udało się wykonać operacji. Spróbuj ponownie.'
  }

  async function syncAuthenticatedUser() {
    user.value = await refreshAuthUser()
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
