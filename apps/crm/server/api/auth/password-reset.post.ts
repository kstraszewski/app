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

interface PasswordResetBody {
  email?: unknown
  redirectTo?: unknown
}

function resetCallback(value: unknown, baseURL: string): string {
  const base = new URL(baseURL)
  const fallback = new URL('/reset-password', base)
  if (typeof value !== 'string' || value.length > MAX_CALLBACK_LENGTH) {
    return fallback.href
  }

  try {
    const callback = new URL(value, base)
    if (
      callback.origin !== base.origin
      || callback.pathname !== '/reset-password'
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
    const body = await readBody<PasswordResetBody>(event)
    const email = typeof body?.email === 'string'
      ? body.email.trim().toLowerCase().slice(0, 320)
      : ''
    const rateLimit = await consumeOpenExpertAuthRateLimit({
      pool: runtime.pool,
      databaseSchema: runtime.config.databaseSchema,
      keySecret: runtime.config.secret,
      scope: 'crm:password-reset-email',
      ipAddress: getOpenExpertTrustedClientIp({
        headers: event.headers,
        directAddress: event.node.req.socket.remoteAddress,
        trustedHeaderNames: runtime.config.ipAddressHeaders,
      }),
      identifier: email,
    })

    if (!rateLimit.allowed) {
      setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many password-reset requests',
      })
    }

    const redirectTo = resetCallback(body.redirectTo, runtime.config.baseURL)
    const requestHeaders = new Headers(event.headers)
    const sendTask = (async () => {
      if (email) {
        await runtime.auth.api.requestPasswordReset({
          body: {
            email,
            redirectTo,
          },
          headers: requestHeaders,
        })
      }
    })().catch((error) => {
      // Never reveal whether an identity exists or whether the delivery
      // provider accepted this specific address.
      console.error('Unable to process a password-reset email request', {
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
