import { createHash } from 'node:crypto'
import {
  createError,
  getHeader,
  getRequestIP,
  getRequestURL,
  readBody,
  setHeader,
  type H3Event,
} from 'h3'
import {
  assertDemoEnabled,
  demoPasswordMatches,
  startDemoSession,
} from '~~/server/utils/demo-auth'

const RESPONSE_FLOOR_MS = 450
const RATE_LIMIT_WINDOW_MS = 5 * 60_000
const RATE_LIMIT_MAX = 8
const RATE_LIMIT_MAX_KEYS = 1_000

interface DemoLoginBody {
  password?: unknown
}

interface AttemptWindow {
  count: number
  expiresAt: number
}

const attempts = new Map<string, AttemptWindow>()

function assertSameOrigin(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  if (!origin) return
  try {
    if (new URL(origin).origin === getRequestURL(event).origin) return
  }
  catch {
    // Fall through to the same generic rejection.
  }
  throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
}

function rateLimitKey(event: H3Event): string {
  const address = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  return createHash('sha256').update(address, 'utf8').digest('base64url')
}

function takeAttempt(event: H3Event): boolean {
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

  const key = rateLimitKey(event)
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
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  setHeader(event, 'Cache-Control', 'private, no-store')

  try {
    assertDemoEnabled(event)
    assertSameOrigin(event)
    if (!takeAttempt(event)) {
      setHeader(event, 'Retry-After', Math.ceil(RATE_LIMIT_WINDOW_MS / 1_000))
      throw createError({
        statusCode: 429,
        statusMessage: 'Zbyt wiele prób. Spróbuj ponownie za kilka minut.',
      })
    }

    const body = await readBody<DemoLoginBody>(event)
    const password = typeof body?.password === 'string'
      ? body.password.slice(0, 256)
      : ''
    if (!demoPasswordMatches(event, password)) {
      throw createError({
        statusCode: 401,
        statusMessage: 'Nieprawidłowe hasło do wersji demonstracyjnej.',
      })
    }

    attempts.delete(rateLimitKey(event))
    startDemoSession(event)
    return { ok: true }
  }
  finally {
    await waitForResponseFloor(startedAt)
  }
})
