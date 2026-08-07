import {
  verifyDataApiToken,
  type VerifyDataApiTokenOptions,
} from '@openexpert/data-api/token'

export const MULTIFORM_SERVICE_TOKEN_PURPOSE = 'openexpert:multiform-service'

export function multiformServiceUserId(
  authorization: string,
  verification: Pick<VerifyDataApiTokenOptions, 'audience' | 'issuer' | 'publicJwk'>,
) {
  const match = authorization.match(/^Bearer ([^\s,]+)$/i)
  if (!match) return null

  try {
    const claims = verifyDataApiToken(match[1]!, {
      ...verification,
      expectedRole: 'authenticated',
    })
    if (claims.purpose !== MULTIFORM_SERVICE_TOKEN_PURPOSE) return null
    const userId = claims.sub?.trim() ?? ''
    return userId || null
  }
  catch {
    return null
  }
}
