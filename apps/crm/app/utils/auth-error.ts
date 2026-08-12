type AuthErrorEnvelope = {
  code?: unknown
  message?: unknown
  data?: {
    code?: unknown
    message?: unknown
  }
}

function authErrorEnvelope(error: unknown): AuthErrorEnvelope | null {
  if (error == null || typeof error !== 'object') return null
  return error as AuthErrorEnvelope
}

export function authErrorCode(error: unknown): string {
  const candidate = authErrorEnvelope(error)
  return String(candidate?.code || candidate?.data?.code || '').toUpperCase()
}

export function authErrorText(error: unknown): string {
  const candidate = authErrorEnvelope(error)
  return String(candidate?.message || candidate?.data?.message || '')
}

export function isFreshSessionRequired(error: unknown): boolean {
  const code = authErrorCode(error)
  const message = authErrorText(error).toLowerCase()
  return code === 'SESSION_NOT_FRESH'
    || code === 'FRESH_AUTHENTICATION_REQUIRED'
    || message.includes('session is not fresh')
    || message.includes('fresh authentication required')
}
