import { createError, getRouterParam, toWebRequest } from 'h3'
import { serverAuth } from '~~/server/utils/platform-auth'

export default defineEventHandler((event) => {
  const authPath = String(getRouterParam(event, 'all') || '').replace(/^\/+|\/+$/gu, '')

  // Message delivery is exposed only through endpoints that prevent account
  // enumeration and apply the shared distributed limiter. Trusted invitation
  // flows call the server API directly and do not pass through this handler.
  if (
    event.method === 'POST'
    && (
      authPath === 'phone-number/send-otp'
      || authPath === 'sign-in/magic-link'
      || authPath === 'request-password-reset'
      || authPath === 'phone-number/request-password-reset'
      || authPath === 'send-verification-email'
    )
  ) {
    throw createError({ statusCode: 404, statusMessage: 'Not found' })
  }

  return serverAuth(event).auth.handler(toWebRequest(event))
})
