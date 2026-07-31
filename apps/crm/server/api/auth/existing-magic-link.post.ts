import { createHash } from 'node:crypto'
import {
  createError,
  getRequestIP,
  readBody,
  setHeader,
  type H3Event,
} from 'h3'
import {
  serverAuth,
  serverAuthUserExistsByEmail,
} from '~~/server/utils/platform-auth'

const RESPONSE_FLOOR_MS = 600
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_MAX_KEYS = 5_000

interface AttemptWindow {
  count: number
  expiresAt: number
}

interface ExistingMagicLinkBody {
  email?: unknown
  callbackURL?: unknown
  errorCallbackURL?: unknown
}

const attempts = new Map<string, AttemptWindow>()

function confirmationCallback(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /%5c/iu.test(value)
  ) return '/confirm'

  const url = new URL(value, 'https://openexpert.invalid')
  if (url.origin !== 'https://openexpert.invalid' || url.pathname !== '/confirm') {
    return '/confirm'
  }
  return `${url.pathname}${url.search}${url.hash}`
}

function rateLimitKey(event: H3Event, email: string): string {
  const address = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  return createHash('sha256').update(`${address}\0${email}`).digest('base64url')
}

function takeAttempt(event: H3Event, email: string): boolean {
  const now = Date.now()
  if (attempts.size >= RATE_LIMIT_MAX_KEYS) {
    for (const [key, attempt] of attempts) {
      if (attempt.expiresAt <= now) attempts.delete(key)
    }
    while (attempts.size >= RATE_LIMIT_MAX_KEYS) {
      const oldestKey = attempts.keys().next().value
      if (typeof oldestKey !== 'string') break
      attempts.delete(oldestKey)
    }
  }

  const key = rateLimitKey(event, email)
  const current = attempts.get(key)
  if (!current || current.expiresAt <= now) {
    attempts.set(key, { count: 1, expiresAt: now + RATE_LIMIT_WINDOW_MS })
    return true
  }
  current.count += 1
  return current.count <= RATE_LIMIT_MAX
}

async function waitForResponseFloor(startedAt: number): Promise<void> {
  const remaining = RESPONSE_FLOOR_MS - (Date.now() - startedAt)
  if (remaining > 0) {
    await new Promise(resolve => setTimeout(resolve, remaining))
  }
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    const body = await readBody<ExistingMagicLinkBody>(event)
    const email = typeof body?.email === 'string'
      ? body.email.trim().toLowerCase().slice(0, 320)
      : ''

    if (!takeAttempt(event, email)) {
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many magic-link requests',
      })
    }

    if (email && await serverAuthUserExistsByEmail(event, email)) {
      const callbackURL = confirmationCallback(body.callbackURL)
      const errorCallbackURL = confirmationCallback(body.errorCallbackURL)
      try {
        await serverAuth(event).auth.api.signInMagicLink({
          body: {
            email,
            callbackURL,
            errorCallbackURL,
          },
          headers: event.headers,
        })
      }
      catch (error) {
        console.error('Unable to send an existing-user magic link', error)
      }
    }

    return { status: true }
  }
  finally {
    await waitForResponseFloor(startedAt)
  }
})
