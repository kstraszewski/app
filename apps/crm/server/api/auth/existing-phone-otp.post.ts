import { createHash } from 'node:crypto'
import { normalizeOpenExpertPhone } from '@openexpert/auth'
import {
  createError,
  getRequestIP,
  readBody,
  setHeader,
  type H3Event,
} from 'h3'
import { latestDevelopmentPhoneOtp } from '~~/server/utils/auth-phone'
import {
  serverAuth,
  serverAuthUserExistsByPhone,
} from '~~/server/utils/platform-auth'

const responseFloorMs = 600
const rateLimitWindowMs = 60_000
const rateLimitMax = 5
const rateLimitMaxKeys = 5_000

interface AttemptWindow {
  count: number
  expiresAt: number
}

const attempts = new Map<string, AttemptWindow>()

function rateLimitKey(event: H3Event, phoneNumber: string): string {
  const address = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  return createHash('sha256').update(`${address}\0${phoneNumber}`).digest('base64url')
}

function takeAttempt(event: H3Event, phoneNumber: string): boolean {
  const now = Date.now()
  if (attempts.size >= rateLimitMaxKeys) {
    for (const [key, attempt] of attempts) {
      if (attempt.expiresAt <= now) attempts.delete(key)
    }
    while (attempts.size >= rateLimitMaxKeys) {
      const oldestKey = attempts.keys().next().value
      if (typeof oldestKey !== 'string') break
      attempts.delete(oldestKey)
    }
  }

  const key = rateLimitKey(event, phoneNumber)
  const current = attempts.get(key)
  if (!current || current.expiresAt <= now) {
    attempts.set(key, { count: 1, expiresAt: now + rateLimitWindowMs })
    return true
  }
  current.count += 1
  return current.count <= rateLimitMax
}

async function waitForResponseFloor(startedAt: number): Promise<void> {
  const remaining = responseFloorMs - (Date.now() - startedAt)
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
}

export default defineEventHandler(async (event) => {
  const startedAt = Date.now()
  setHeader(event, 'Cache-Control', 'private, no-store')
  try {
    const body = await readBody<{ phoneNumber?: unknown }>(event)
    const rawPhone = typeof body?.phoneNumber === 'string'
      ? body.phoneNumber.slice(0, 50)
      : ''
    const phoneNumber = normalizeOpenExpertPhone(rawPhone)

    if (!takeAttempt(event, phoneNumber || rawPhone)) {
      throw createError({ statusCode: 429, statusMessage: 'Too many phone-code requests' })
    }

    let devOtp: string | null = null
    if (phoneNumber && await serverAuthUserExistsByPhone(event, phoneNumber)) {
      try {
        await serverAuth(event).auth.api.sendPhoneNumberOTP({
          body: { phoneNumber },
          headers: event.headers,
        })
        devOtp = await latestDevelopmentPhoneOtp(event, phoneNumber)
      }
      catch (error) {
        console.error('[auth-phone] unable to send existing-user OTP', {
          name: error instanceof Error ? error.name : 'UnknownError',
        })
      }
    }

    return {
      status: true,
      ...(devOtp ? { devOtp } : {}),
    }
  }
  finally {
    await waitForResponseFloor(startedAt)
  }
})
