import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
} from '@openexpert/auth/server'
import { createError, setHeader, type H3Event } from 'h3'
import { serverAuth } from './platform-auth.ts'

const MAIL_CONNECTION_WINDOW_MS = 60_000
const MAIL_CONNECTION_USER_MAX = 6
const MAIL_CONNECTION_IP_MAX = 30

/**
 * IMAP/SMTP verification opens two outbound sockets. Keep the limit in the
 * shared PostgreSQL-backed store so it applies across all serverless instances.
 */
export async function assertMailConnectionSetupRateLimit(
  event: H3Event,
  userId: string,
): Promise<void> {
  const runtime = serverAuth(event)
  const decision = await consumeOpenExpertAuthRateLimit({
    pool: runtime.pool,
    databaseSchema: runtime.config.databaseSchema,
    keySecret: runtime.config.secret,
    scope: 'crm:mail-connect',
    ipAddress: getOpenExpertTrustedClientIp({
      headers: event.headers,
      directAddress: event.node.req.socket.remoteAddress,
      trustedHeaderNames: runtime.config.ipAddressHeaders,
    }),
    identifier: userId,
    windowMs: MAIL_CONNECTION_WINDOW_MS,
    pairMax: MAIL_CONNECTION_USER_MAX,
    identifierMax: MAIL_CONNECTION_USER_MAX,
    ipMax: MAIL_CONNECTION_IP_MAX,
  })
  if (decision.allowed) return

  setHeader(event, 'Retry-After', decision.retryAfterSeconds)
  throw createError({
    statusCode: 429,
    statusMessage: 'Zbyt wiele prób połączenia z pocztą. Spróbuj ponownie za chwilę.',
  })
}
