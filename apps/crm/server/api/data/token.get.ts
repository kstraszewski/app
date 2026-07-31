import { createError, setHeader } from 'h3'
import { serverAuthClaims } from '~~/server/utils/platform-auth'
import { serverDataTokenSigner } from '~~/server/utils/platform-data'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')
  const claims = await serverAuthClaims(event)
  if (!claims) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  return {
    accessToken: serverDataTokenSigner(event).signUser(claims.sub),
    expiresIn: 60,
    tokenType: 'Bearer',
  }
})
