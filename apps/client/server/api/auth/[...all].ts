import { createError, getRouterParam, toWebRequest } from 'h3'
import { serverAuth } from '~~/server/utils/platform-auth'

export default defineEventHandler((event) => {
  const authPath = String(getRouterParam(event, 'all') || '').replace(/^\/+|\/+$/gu, '')

  // Public magic-link requests go through the existing-user endpoint, which
  // applies enumeration resistance and a distributed limiter. New portal
  // identities are provisioned only by the server-side invitation flow.
  if (
    event.method === 'POST'
    && (
      authPath === 'sign-in/magic-link'
      || authPath === 'request-password-reset'
      || authPath === 'send-verification-email'
    )
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  return serverAuth(event).auth.handler(toWebRequest(event))
})
