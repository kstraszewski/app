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
import {
  bookingMagicLinkResponseDelay,
  buildBookingMagicLinkCallbackPath,
  parseBookingMagicLinkIntent,
} from '~~/server/utils/booking-magic-link'
import { serverDataBackend } from '~~/server/utils/data-api'
import { serverAuth } from '~~/server/utils/platform-auth'

interface BookingMagicLinkBody {
  email?: unknown
  widgetKey?: unknown
  expertId?: unknown
  serviceId?: unknown
  date?: unknown
}

async function waitForResponseFloor(startedAt: number): Promise<void> {
  const delay = bookingMagicLinkResponseDelay(startedAt)
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const runtime = serverAuth(event)
    if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
      throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }

    const body = await readBody<BookingMagicLinkBody>(event)
    const intent = parseBookingMagicLinkIntent(body)
    const rateLimit = await consumeOpenExpertAuthRateLimit({
      pool: runtime.pool,
      databaseSchema: runtime.config.databaseSchema,
      keySecret: runtime.config.secret,
      scope: 'client:booking-magic-link',
      ipAddress: getOpenExpertTrustedClientIp({
        headers: event.headers,
        directAddress: event.node.req.socket.remoteAddress,
        trustedHeaderNames: runtime.config.ipAddressHeaders,
      }),
      identifier: intent?.email ?? 'invalid',
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
      if (!intent) return

      const backend = serverDataBackend(event) as any
      const catalogResult = await backend.rpc('get_booking_widget_catalog', {
        p_widget_token: intent.widgetKey,
      })
      if (catalogResult.error || !catalogResult.data) return

      const callbackPath = buildBookingMagicLinkCallbackPath(
        intent,
        catalogResult.data,
      )
      if (!callbackPath) return
      const callbackURL = new URL(callbackPath, runtime.config.baseURL).href

      // The client auth runtime disables password sign-up but intentionally
      // keeps magic-link sign-up enabled. Clicking this one-time link therefore
      // creates and verifies a new client identity when necessary.
      await runtime.auth.api.signInMagicLink({
        body: {
          email: intent.email,
          callbackURL,
          newUserCallbackURL: callbackURL,
          errorCallbackURL: callbackURL,
          metadata: {
            clientPortalBooking: true,
            widgetKey: intent.widgetKey,
          },
        },
        headers: requestHeaders,
      })
    })().catch((error) => {
      console.error('Unable to send a client booking magic link', {
        name: error instanceof Error ? error.name : 'UnknownError',
      })
    })
    scheduleOpenExpertBackgroundTask(sendTask, event.waitUntil.bind(event))

    // Invalid emails, missing/inactive widgets and delivery errors deliberately
    // share this response so the endpoint reveals no account or widget state.
    return { status: true }
  }
  finally {
    await waitForResponseFloor(startedAt)
  }
})
