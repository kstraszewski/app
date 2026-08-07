export const MULTIFORM_SERVICE_TOKEN_PURPOSE = 'openexpert:multiform-service'

interface MultiformServiceTokenPayload {
  purpose?: unknown
  role?: unknown
  sub?: unknown
}

export interface MultiformServiceCredentials {
  token: string
  userId: string
}

/**
 * This only extracts the claimed identity and scope. The Data API verifies the
 * signature and applies user RLS before the caller is allowed to trust them.
 */
export function parseMultiformServiceCredentials(
  authorization: string,
): MultiformServiceCredentials | null {
  const match = authorization.match(/^Bearer ([^\s,]+)$/i)
  if (!match) return null

  try {
    const token = match[1]!
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some(part => !part)) return null
    const claims = JSON.parse(
      Buffer.from(parts[1]!, 'base64url').toString('utf8'),
    ) as MultiformServiceTokenPayload
    if (
      claims.purpose !== MULTIFORM_SERVICE_TOKEN_PURPOSE
      || claims.role !== 'authenticated'
      || typeof claims.sub !== 'string'
      || !claims.sub.trim()
    ) return null
    return { token, userId: claims.sub.trim() }
  }
  catch {
    return null
  }
}
