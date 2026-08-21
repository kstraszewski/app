import { createHash } from 'node:crypto'
import {
  createOpenExpertAuth,
  getOpenExpertSession,
  getOpenExpertUserById,
  type OpenExpertAuthRuntime,
} from '@openexpert/auth/server'
import {
  createTransactionalEmailSender,
  EmailDeliveryError,
} from '@openexpert/email'
import { getRequestHeaders, type H3Event } from 'h3'
import { renderLandingAuthEmail } from './auth-email-content'

interface PlatformAuthRuntimeConfig {
  baseUrl: string
  basePath: string
  databaseUrl: string
  databaseSchema: string
  ipAddressHeaders: string
  sessionFreshAge: number
  secret: string
  cookiePrefix: string
  cookieDomain: string
  trustedOrigins: string
}

interface PlatformAuthEmailConfig {
  apiKey: string
  from: string
  replyTo: string
  smtp: {
    host: string
    port: number
    secure: boolean
    user: string
    password: string
  }
}

export interface PlatformAuthClaims {
  id: string
  sub: string
  role: 'authenticated'
  email: string
  email_verified: boolean
  email_confirmed_at: string | null
  phone: string
  user_metadata: {
    full_name: string
  }
}

let cachedRuntime:
  | { fingerprint: string, runtime: OpenExpertAuthRuntime }
  | undefined

function requestHeaders(event: H3Event): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(getRequestHeaders(event))) {
    if (typeof value === 'string') result.set(name, value)
  }
  return result
}

export function serverAuth(event: H3Event): OpenExpertAuthRuntime {
  const runtimeConfig = useRuntimeConfig(event)
  const auth = runtimeConfig.auth as PlatformAuthRuntimeConfig
  const email = runtimeConfig.authEmail as PlatformAuthEmailConfig
  const fingerprint = JSON.stringify({ auth, email })
  if (cachedRuntime?.fingerprint === fingerprint) return cachedRuntime.runtime

  const sender = createTransactionalEmailSender({
    apiKey: email.apiKey,
    from: email.from,
    replyTo: email.replyTo,
    smtp: {
      host: email.smtp.host,
      port: email.smtp.port,
      secure: email.smtp.secure,
      user: email.smtp.user || undefined,
      password: email.smtp.password || undefined,
    },
  })
  const runtime = createOpenExpertAuth({
    config: {
      baseURL: auth.baseUrl,
      basePath: auth.basePath,
      secret: auth.secret,
      databaseURL: auth.databaseUrl,
      databaseSchema: auth.databaseSchema,
      ipAddressHeaders: auth.ipAddressHeaders
        .split(',')
        .map(header => header.trim().toLowerCase())
        .filter(Boolean),
      sessionFreshAge: auth.sessionFreshAge,
      cookiePrefix: auth.cookiePrefix,
      cookieDomain: auth.cookieDomain || undefined,
      magicLinkTokenNamespace: 'landing-primary',
      trustedOrigins: auth.trustedOrigins
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
    },
    emailSender: {
      async send(message) {
        const content = await renderLandingAuthEmail(message.kind, message.url)
        const result = await sender.send({
          to: message.to,
          ...content,
          idempotencyKey: `auth/${message.kind}/${createHash('sha256')
            .update(message.token)
            .digest('hex')}`,
          tags: [{ name: 'email_type', value: message.kind.replaceAll('-', '_') }],
        })
        if (result.status !== 'sent') {
          throw new EmailDeliveryError(`Auth email transport is not configured: ${result.reason}`)
        }
      },
    },
  })
  cachedRuntime = { fingerprint, runtime }
  return runtime
}

export async function serverAuthSession(event: H3Event) {
  return getOpenExpertSession(serverAuth(event), requestHeaders(event))
}

export async function serverAuthClaims(event: H3Event): Promise<PlatformAuthClaims | null> {
  const session = await serverAuthSession(event)
  if (!session) return null
  const verifiedUser = session.user.emailVerified
    ? await getOpenExpertUserById(serverAuth(event), session.user.id)
    : null
  const fullName = String(session.user.name || '').trim()
  return {
    id: session.user.id,
    sub: session.user.id,
    role: 'authenticated',
    email: session.user.email,
    email_verified: session.user.emailVerified,
    email_confirmed_at: verifiedUser?.emailVerifiedAt
      ? new Date(verifiedUser.emailVerifiedAt).toISOString()
      : null,
    phone: '',
    user_metadata: { full_name: fullName },
  }
}
