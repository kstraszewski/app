import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
  type OpenExpertAuthRateLimitDecision,
} from '@openexpert/auth/server'
import type { H3Event } from 'h3'
import { serverAuth } from './platform-auth.ts'

/**
 * Atomically reserve one real provider-send attempt before an idempotency row
 * is inserted or a failed attempt is reclaimed. PostgreSQL upserts serialize
 * concurrent requests for each bucket across all serverless instances.
 */
export async function consumeMailSendRateLimit(
  event: H3Event,
  userId: string,
): Promise<OpenExpertAuthRateLimitDecision> {
  const runtime = serverAuth(event)
  const ipAddress = getOpenExpertTrustedClientIp({
    headers: event.headers,
    directAddress: event.node.req.socket.remoteAddress,
    trustedHeaderNames: runtime.config.ipAddressHeaders,
  })
  const common = {
    pool: runtime.pool,
    databaseSchema: runtime.config.databaseSchema,
    keySecret: runtime.config.secret,
    ipAddress,
    identifier: userId,
  }
  const minute = await consumeOpenExpertAuthRateLimit({
    ...common,
    scope: 'crm:mail-send-minute',
    windowMs: 60_000,
    pairMax: 10,
    identifierMax: 10,
    ipMax: 100,
  })
  if (!minute.allowed) return minute

  return consumeOpenExpertAuthRateLimit({
    ...common,
    scope: 'crm:mail-send-hour',
    windowMs: 60 * 60_000,
    pairMax: 100,
    identifierMax: 100,
    ipMax: 1_000,
  })
}
