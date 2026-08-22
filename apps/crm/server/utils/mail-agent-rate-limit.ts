import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
} from '@openexpert/auth/server'
import {
  createError,
  setHeader,
  type H3Event,
} from 'h3'
import {
  crmAgentMailRateLimitPolicy,
  type CrmAgentMailRateLimitOperation,
} from './mail-agent-rate-limit-core.ts'
import { serverAuth } from './platform-auth.ts'

export async function assertCrmAgentMailRateLimit(
  event: H3Event,
  userId: string,
  operation: CrmAgentMailRateLimitOperation,
): Promise<void> {
  const runtime = serverAuth(event)
  const ipAddress = getOpenExpertTrustedClientIp({
    headers: event.headers,
    directAddress: event.node.req.socket.remoteAddress,
    trustedHeaderNames: runtime.config.ipAddressHeaders,
  })
  const policy = crmAgentMailRateLimitPolicy(operation)
  const common = {
    pool: runtime.pool,
    databaseSchema: runtime.config.databaseSchema,
    keySecret: runtime.config.secret,
    ipAddress,
    identifier: userId,
  }
  const minute = await consumeOpenExpertAuthRateLimit({
    ...common,
    scope: `crm:agent-mail-${operation}-minute`,
    ...policy.minute,
  })
  const decision = minute.allowed
    ? await consumeOpenExpertAuthRateLimit({
        ...common,
        scope: `crm:agent-mail-${operation}-hour`,
        ...policy.hour,
      })
    : minute
  if (decision.allowed) return

  setHeader(event, 'Retry-After', decision.retryAfterSeconds)
  throw createError({
    statusCode: 429,
    statusMessage: 'Limit odczytów poczty przez Agenta AI został chwilowo wyczerpany.',
  })
}
