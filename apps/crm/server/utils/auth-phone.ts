import { createError, type H3Event } from 'h3'
import { resolveAuthSmsConfig, type AuthSmsRuntimeConfig } from './auth-sms'
import { serverAuth } from './platform-auth'

type AuthApiError = {
  status?: unknown
  statusCode?: unknown
  code?: unknown
  message?: unknown
  body?: {
    code?: unknown
    message?: unknown
  }
}

export function throwAuthPhoneError(error: unknown): never {
  const candidate = (error && typeof error === 'object' ? error : {}) as AuthApiError
  const rawStatus = candidate.statusCode ?? candidate.status
  const statusCode = typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : 400
  const code = String(candidate.body?.code ?? candidate.code ?? 'PHONE_AUTH_FAILED')
  const statusMessage = String(
    candidate.body?.message
    ?? candidate.message
    ?? 'Phone authentication failed',
  ).slice(0, 300)
  throw createError({
    statusCode,
    statusMessage,
    data: { code },
  })
}

export async function requireFreshPhoneSession(event: H3Event) {
  const runtime = serverAuth(event)
  try {
    await runtime.auth.api.listSessions({ headers: event.headers })
  }
  catch (error) {
    throwAuthPhoneError(error)
  }
  return runtime
}

export function phoneDemoEnabled(event: H3Event): boolean {
  if (process.env.NODE_ENV === 'production') return false
  const config = resolveAuthSmsConfig(
    useRuntimeConfig(event).authSms as AuthSmsRuntimeConfig,
  )
  return config.enabled && config.provider === 'local' && config.demoAutoFill
}

export async function latestDevelopmentPhoneOtp(
  event: H3Event,
  identifier: string,
): Promise<string | null> {
  if (!phoneDemoEnabled(event)) return null
  const runtime = serverAuth(event)
  const result = await runtime.pool.query<{ value: string }>(
    `select value
       from ${runtime.config.databaseSchema}.verifications
      where identifier = $1
        and expires_at > now()
      order by created_at desc, id desc
      limit 1`,
    [identifier],
  )
  const [code = ''] = String(result.rows[0]?.value || '').split(':', 1)
  return /^\d{6}$/.test(code) ? code : null
}
