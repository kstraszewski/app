import { createError, getRouterParam, toWebRequest } from 'h3'
import { serverAuth } from '~~/server/utils/platform-auth'

export default defineEventHandler((event) => {
  const authPath = String(getRouterParam(event, 'all') || '').replace(/^\/+|\/+$/gu, '')

  // Public magic-link requests go through purpose-specific wrappers, which
  // apply enumeration resistance and distributed limits. New portal identities
  // are provisioned only by a valid invitation or booking-widget intent.
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
