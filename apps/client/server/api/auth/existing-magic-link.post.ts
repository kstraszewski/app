import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
  isOpenExpertSameOriginJsonRequest,
  scheduleOpenExpertBackgroundTask,
} from '@openexpert/auth/server'
import {
  createError,
  readBody,
  setHeader,
} from 'h3'
import { serverAuth } from '~~/server/utils/platform-auth'

const RESPONSE_FLOOR_MS = 600
const MAX_CALLBACK_LENGTH = 2_048

interface ExistingMagicLinkBody {
  email?: unknown
  callbackURL?: unknown
  errorCallbackURL?: unknown
}

function localCallback(
  value: unknown,
  baseURL: string,
  fallbackPath: string,
): string {
  const base = new URL(baseURL)
  const fallback = new URL(fallbackPath, base)
  if (typeof value !== 'string' || value.length > MAX_CALLBACK_LENGTH) {
    return fallback.href
  }

  try {
    const callback = new URL(value, base)
    if (
      callback.origin !== base.origin
      || callback.username
      || callback.password
    ) return fallback.href
    return callback.href
  }
  catch {
    return fallback.href
  }
}

async function waitForResponseFloor(startedAt: number): Promise<void> {
  const remaining = RESPONSE_FLOOR_MS - (Date.now() - startedAt)
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const runtime = serverAuth(event)
    if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }
    const body = await readBody<ExistingMagicLinkBody>(event)
    const email = typeof body?.email === 'string'
      ? body.email.trim().toLowerCase().slice(0, 320)
      : ''
    const rateLimit = await consumeOpenExpertAuthRateLimit({
      pool: runtime.pool,
      databaseSchema: runtime.config.databaseSchema,
      keySecret: runtime.config.secret,
      scope: 'client:magic-link',
      ipAddress: getOpenExpertTrustedClientIp({
        headers: event.headers,
        directAddress: event.node.req.socket.remoteAddress,
        trustedHeaderNames: runtime.config.ipAddressHeaders,
      }),
      identifier: email,
    })

    if (!rateLimit.allowed) {
      const retryAfter = String(rateLimit.retryAfterSeconds)
      setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
      setHeader(event, 'X-Retry-After', retryAfter)
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many magic-link requests',
      })
    }

    const requestHeaders = new Headers(event.headers)
    const sendTask = (async () => {
      if (!email) return
      const user = await runtime.pool.query(
        `select 1
           from ${runtime.config.databaseSchema}.users
          where lower(email) = $1
          limit 1`,
        [email],
      )
      if (user.rowCount === 1) {
        await runtime.auth.api.signInMagicLink({
          body: {
            email,
            callbackURL: localCallback(
              body.callbackURL,
              runtime.config.baseURL,
              '/',
            ),
            errorCallbackURL: localCallback(
              body.errorCallbackURL,
              runtime.config.baseURL,
              '/login',
            ),
          },
          headers: requestHeaders,
        })
      }
    })().catch((error) => {
      console.error('Unable to send a client existing-user magic link', {
        name: error instanceof Error ? error.name : 'UnknownError',
      })
    })
    scheduleOpenExpertBackgroundTask(sendTask, event.waitUntil.bind(event))

    return { status: true }
  }
  finally {
    await waitForResponseFloor(startedAt)
  }
})
