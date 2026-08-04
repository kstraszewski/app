import { normalizeOpenExpertPhone } from '@openexpert/auth'
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
    const body = await readBody<{ phoneNumber?: unknown }>(event)
    const rawPhone = typeof body?.phoneNumber === 'string'
      ? body.phoneNumber.slice(0, 50)
      : ''
    const phoneNumber = normalizeOpenExpertPhone(rawPhone)
    const rateLimit = await consumeOpenExpertAuthRateLimit({
      pool: runtime.pool,
      databaseSchema: runtime.config.databaseSchema,
      keySecret: runtime.config.secret,
      scope: 'crm:password-reset-phone',
      ipAddress: getOpenExpertTrustedClientIp({
        headers: event.headers,
        directAddress: event.node.req.socket.remoteAddress,
        trustedHeaderNames: runtime.config.ipAddressHeaders,
      }),
      identifier: phoneNumber || rawPhone,
    })

    if (!rateLimit.allowed) {
      setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many password-reset requests',
      })
    }

    const requestHeaders = new Headers(event.headers)
    const sendTask = (async () => {
      if (phoneNumber) {
        await runtime.auth.api.requestPasswordResetPhoneNumber({
          body: { phoneNumber },
          headers: requestHeaders,
        })
      }
    })().catch((error) => {
      console.error('Unable to process a phone password-reset request', {
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
