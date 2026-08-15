import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
} from '@openexpert/auth/server'
import { useRuntimeConfig } from '#imports'
import { createError, setHeader, type H3Event } from 'h3'
import { ceidgRateLimitBucketMaxima } from '#shared/utils/ceidg-rate-limit-policy'
import { serverAuth } from './platform-auth'

interface CeidgRateLimitPolicy {
  hour: number
  minute: number
}

async function consumeCeidgBucket(
  event: H3Event,
  identifier: string,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const runtime = serverAuth(event)
  // The shared auth limiter rejects bucket maxima above 10,000. Keep every
  // derived value within that contract, including configurable global limits.
  const maxima = ceidgRateLimitBucketMaxima(identifier, limit)
  return consumeOpenExpertAuthRateLimit({
    pool: runtime.pool,
    databaseSchema: runtime.config.databaseSchema,
    keySecret: runtime.config.secret,
    scope,
    ipAddress: getOpenExpertTrustedClientIp({
      headers: event.headers,
      directAddress: event.node.req.socket.remoteAddress,
      trustedHeaderNames: runtime.config.ipAddressHeaders,
    }),
    identifier,
    windowMs,
    ...maxima,
  })
}

/** Limits calls that consume the single server-side CEIDG provider quota. */
export async function assertCeidgLookupRateLimit(
  event: H3Event,
  userId?: string,
): Promise<void> {
  const identifier = userId || 'anonymous'
  const policy: CeidgRateLimitPolicy = userId
    ? { minute: 30, hour: 300 }
    : { minute: 10, hour: 100 }

  const minute = await consumeCeidgBucket(
    event,
    identifier,
    'crm:ceidg-minute',
    policy.minute,
    60_000,
  )
  const userDecision = minute.allowed
    ? await consumeCeidgBucket(
        event,
        identifier,
        'crm:ceidg-hour',
        policy.hour,
        60 * 60_000,
      )
    : minute

  if (!userDecision.allowed) {
    setHeader(event, 'Retry-After', userDecision.retryAfterSeconds)
    throw createError({
      statusCode: 429,
      statusMessage: 'Zbyt wiele zapytań do CEIDG. Spróbuj ponownie później.',
    })
  }

  const config = useRuntimeConfig(event).ceidg as {
    globalHourlyLimit?: number | string
    globalMinuteLimit?: number | string
  }
  const configuredMinuteLimit = Number(config.globalMinuteLimit)
  const configuredHourlyLimit = Number(config.globalHourlyLimit)
  const globalMinuteLimit = Number.isSafeInteger(configuredMinuteLimit) && configuredMinuteLimit > 0
    ? configuredMinuteLimit
    : 120
  const globalHourlyLimit = Number.isSafeInteger(configuredHourlyLimit) && configuredHourlyLimit > 0
    ? configuredHourlyLimit
    : 1_000
  const globalMinute = await consumeCeidgBucket(
    event,
    'shared-token',
    'crm:ceidg-global-minute',
    globalMinuteLimit,
    60_000,
  )
  const decision = globalMinute.allowed
    ? await consumeCeidgBucket(
        event,
        'shared-token',
        'crm:ceidg-global-hour',
        globalHourlyLimit,
        60 * 60_000,
      )
    : globalMinute

  if (decision.allowed) return
  setHeader(event, 'Retry-After', decision.retryAfterSeconds)
  throw createError({
    statusCode: 429,
    statusMessage: 'Zbyt wiele zapytań do CEIDG. Spróbuj ponownie później.',
  })
}
