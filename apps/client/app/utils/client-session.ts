export const CLIENT_SESSION_EXPIRED_REASON = 'session-expired'

function requestPath(request: unknown): string {
  if (typeof request === 'string') {
    try {
      return new URL(request, 'https://openexpert.invalid').pathname
    }
    catch {
      return request.split(/[?#]/u, 1)[0] || ''
    }
  }
  if (request instanceof Request) return new URL(request.url).pathname
  return ''
}

export function isProtectedClientApiRequest(request: unknown): boolean {
  const path = requestPath(request)
  return path === '/api/client' || path.startsWith('/api/client/')
}

export function isUnauthorizedRequestError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }
  return Number(
    candidate.statusCode
    ?? candidate.status
    ?? candidate.response?.status,
  ) === 401
}

export function clientSessionReturnPath(value: unknown): string {
  if (typeof value !== 'string') return '/'
  if (
    !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /%5c/iu.test(value)
  ) return '/'

  const path = value.split(/[?#]/u, 1)[0] || '/'
  if (
    path === '/login'
    || path === '/demo'
    || path.startsWith('/preview')
  ) return '/'
  return value
}
