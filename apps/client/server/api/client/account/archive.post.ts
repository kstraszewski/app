import {
  consumeOpenExpertAuthRateLimit,
  getOpenExpertTrustedClientIp,
  isOpenExpertSameOriginJsonRequest,
} from '@openexpert/auth/server'
import { createError, readBody, setHeader } from 'h3'
import { serverDataBackend } from '~~/server/utils/data-api'
import { serverAuth, serverAuthSession } from '~~/server/utils/platform-auth'
import {
  asRecord,
  requirePortalIdentity,
  requiredUuid,
} from '~~/server/utils/portal-auth'
import { isValidPortalAccountArchiveConfirmation } from '../../../../shared/utils/portal-account.ts'

function errorStatus(error: unknown): number {
  const candidate = error as { status?: unknown, statusCode?: unknown } | null
  const value = Number(candidate?.statusCode ?? candidate?.status)
  return Number.isInteger(value) ? value : 0
}

function requireFreshSession(
  session: Awaited<ReturnType<typeof serverAuthSession>>,
  freshAgeSeconds: number,
): void {
  if (freshAgeSeconds === 0) return
  const createdAt = new Date(session?.session?.createdAt ?? Number.NaN).getTime()
  const isFresh = Number.isFinite(createdAt)
    && Date.now() - createdAt < freshAgeSeconds * 1_000

  if (!isFresh) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Fresh authentication required',
      data: { code: 'FRESH_AUTHENTICATION_REQUIRED' },
    })
  }
}

function throwArchiveMutationError(
  error: { code?: string } | null | undefined,
): never {
  const code = String(error?.code ?? '')

  if (code === 'P0002') {
    throw createError({
      statusCode: 404,
      statusMessage: 'Client portal account not found',
      data: { code: 'PORTAL_ACCOUNT_NOT_FOUND' },
    })
  }
  if (code === '23505') {
    throw createError({
      statusCode: 409,
      statusMessage: 'This request key has already been used',
      data: { code: 'IDEMPOTENCY_KEY_REUSED' },
    })
  }
  if (code === '22023') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid account archive request',
      data: { code: 'INVALID_REQUEST' },
    })
  }

  console.error('[client-portal] account archive failed', { code })
  throw createError({
    statusCode: 500,
    statusMessage: 'Client portal account could not be archived',
  })
}

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'private, no-store')

  const runtime = serverAuth(event)
  if (!isOpenExpertSameOriginJsonRequest(event.headers, runtime.config.baseURL)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }

  const identity = await requirePortalIdentity(event)
  const body = asRecord(await readBody(event))
  if (!isValidPortalAccountArchiveConfirmation(body.confirmation)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Account archive confirmation does not match',
      data: { code: 'CONFIRMATION_MISMATCH' },
    })
  }
  const idempotencyKey = requiredUuid(body.idempotencyKey, 'idempotencyKey')

  const credential = await runtime.pool.query(
    `select 1
       from ${runtime.config.databaseSchema}.accounts
      where user_id = $1
        and provider_id = 'credential'
        and password is not null
      limit 1`,
    [identity.userId],
  )

  if (credential.rowCount) {
    const password = typeof body.password === 'string' ? body.password : ''
    if (!password || password.length > runtime.config.maxPasswordLength) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Current password is required',
        data: { code: 'CURRENT_PASSWORD_REQUIRED' },
      })
    }

    const rateLimit = await consumeOpenExpertAuthRateLimit({
      pool: runtime.pool,
      databaseSchema: runtime.config.databaseSchema,
      keySecret: runtime.config.secret,
      scope: 'client:account-archive-password',
      ipAddress: getOpenExpertTrustedClientIp({
        headers: event.headers,
        directAddress: event.node.req.socket.remoteAddress,
        trustedHeaderNames: runtime.config.ipAddressHeaders,
      }),
      identifier: identity.userId,
    })
    if (!rateLimit.allowed) {
      setHeader(event, 'Retry-After', rateLimit.retryAfterSeconds)
      setHeader(event, 'X-Retry-After', String(rateLimit.retryAfterSeconds))
      throw createError({
        statusCode: 429,
        statusMessage: 'Too many password verification attempts',
        data: { code: 'PASSWORD_VERIFICATION_RATE_LIMITED' },
      })
    }

    try {
      await runtime.auth.api.verifyPassword({
        body: { password },
        headers: event.headers,
      })
    }
    catch (error) {
      const status = errorStatus(error)
      if (status === 400) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Current password is incorrect',
          data: { code: 'INVALID_CURRENT_PASSWORD' },
        })
      }
      if (status === 401 || status === 403) {
        throw createError({
          statusCode: 401,
          statusMessage: 'Authentication required',
        })
      }
      throw error
    }
  }
  else {
    const authSession = await serverAuthSession(event)
    requireFreshSession(authSession, runtime.config.sessionFreshAge)
  }

  const backend = serverDataBackend(event) as any
  const result = await backend.rpc('archive_client_portal_account', {
    p_auth_user_id: identity.userId,
    p_idempotency_key: idempotencyKey,
    p_reason: 'self_service_request',
  })
  if (result.error) throwArchiveMutationError(result.error)

  return { data: result.data }
})
