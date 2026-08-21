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
import { createError, getRequestHeaders, type H3Event } from 'h3'
import { emailContent } from './auth-email-content'
import {
  resolveAuthSmsConfig,
  sendAuthSms,
  type AuthSmsRuntimeConfig,
} from './auth-sms'

interface PlatformAuthRuntimeConfig {
  baseUrl: string
  basePath: string
  databaseUrl: string
  databaseSchema: string
  ipAddressHeaders: string
  sessionFreshAge: number
  disableSignUp: boolean
  magicLinkDisableSignUp: boolean
  secret: string
  cookiePrefix: string
  cookieDomain: string
  trustedOrigins: string
  socialProviders?: {
    google?: { clientId?: string, clientSecret?: string }
    apple?: { clientId?: string, clientSecret?: string }
  }
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

interface PlatformAuthPasskeyConfig {
  enabled: boolean
  rpId: string
  rpName: string
  origin: string
}

interface OrganizationInvitationAuthConfig {
  enabled?: boolean
  baseUrl?: string
  basePath?: string
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
let cachedClientPortalRuntime:
  | { fingerprint: string, runtime: OpenExpertAuthRuntime }
  | undefined
let cachedOrganizationInvitationRuntime:
  | { fingerprint: string, runtime: OpenExpertAuthRuntime }
  | undefined

function requestHeaders(event: H3Event): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(getRequestHeaders(event))) {
    if (typeof value === 'string') result.set(name, value)
  }
  return result
}

function createPlatformAuthRuntime(
  auth: PlatformAuthRuntimeConfig,
  email: PlatformAuthEmailConfig,
  options: {
    baseUrl: string
    basePath?: string
    cookiePrefix?: string
    cookieDomain?: string
    trustedOrigins?: string[]
    portalOnly?: boolean
    organizationInvitationOnly?: boolean
    magicLinkTokenNamespace: string
    phone?: AuthSmsRuntimeConfig
    passkey?: PlatformAuthPasskeyConfig
  },
): OpenExpertAuthRuntime {
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
  if (options.organizationInvitationOnly && !sender.isConfigured) {
    console.error('[organization-invitations] email transport is not configured')
    throw createError({
      statusCode: 503,
      statusMessage: 'Registration email is temporarily unavailable',
    })
  }
  const runtime = createOpenExpertAuth({
    config: {
      baseURL: options.baseUrl,
      basePath: options.basePath || auth.basePath,
      secret: auth.secret,
      databaseURL: auth.databaseUrl,
      databaseSchema: auth.databaseSchema,
      ipAddressHeaders: auth.ipAddressHeaders
        .split(',')
        .map(header => header.trim().toLowerCase())
        .filter(Boolean),
      sessionFreshAge: auth.sessionFreshAge,
      cookiePrefix: options.cookiePrefix || auth.cookiePrefix,
      cookieDomain: options.cookieDomain || undefined,
      disableSignUp: options.portalOnly || options.organizationInvitationOnly
        ? true
        : auth.disableSignUp,
      magicLinkDisableSignUp: options.portalOnly || options.organizationInvitationOnly
        ? false
        : auth.magicLinkDisableSignUp,
      magicLinkTokenNamespace: options.magicLinkTokenNamespace,
      trustedOrigins: [...new Set([
        auth.baseUrl,
        options.baseUrl,
        ...(options.trustedOrigins ?? []),
        ...auth.trustedOrigins
          .split(',')
          .map(value => value.trim())
          .filter(Boolean),
      ])],
      socialProviders: {
        ...(auth.socialProviders?.google?.clientId && auth.socialProviders.google.clientSecret
          ? {
              google: {
                clientId: auth.socialProviders.google.clientId,
                clientSecret: auth.socialProviders.google.clientSecret,
                disableSignUp: true,
              },
            }
          : {}),
        ...(auth.socialProviders?.apple?.clientId && auth.socialProviders.apple.clientSecret
          ? {
              apple: {
                clientId: auth.socialProviders.apple.clientId,
                clientSecret: auth.socialProviders.apple.clientSecret,
                disableSignUp: true,
              },
            }
          : {}),
      },
    },
    emailSender: {
      async send(message) {
        const content = await emailContent(
          message.kind,
          message.url,
          message.kind === 'magic-link' ? message.metadata : undefined,
        )
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
    ...(options.phone
      ? {
          phone: {
            expiresIn: resolveAuthSmsConfig(options.phone, {
              production: process.env.NODE_ENV === 'production',
            }).ttlSeconds,
            allowedAttempts: resolveAuthSmsConfig(options.phone, {
              production: process.env.NODE_ENV === 'production',
            }).maxOtpAttempts,
            sender: {
              async send(message) {
                const config = resolveAuthSmsConfig(options.phone!, {
                  production: process.env.NODE_ENV === 'production',
                })
                await sendAuthSms(config, message)
              },
            },
          },
        }
      : {}),
    ...(options.passkey?.enabled
      ? {
          passkey: {
            rpID: options.passkey.rpId,
            rpName: options.passkey.rpName,
            origin: options.passkey.origin,
          },
        }
      : {}),
  })
  return runtime
}

export function serverAuth(event: H3Event): OpenExpertAuthRuntime {
  const runtimeConfig = useRuntimeConfig(event)
  const auth = runtimeConfig.auth as PlatformAuthRuntimeConfig
  const email = runtimeConfig.authEmail as PlatformAuthEmailConfig
  const phone = runtimeConfig.authSms as AuthSmsRuntimeConfig
  const passkey = runtimeConfig.authPasskey as PlatformAuthPasskeyConfig
  const phoneConfig = resolveAuthSmsConfig(phone, {
    production: process.env.NODE_ENV === 'production',
  })
  const fingerprint = JSON.stringify({ auth, email, phone, passkey })
  if (cachedRuntime?.fingerprint === fingerprint) return cachedRuntime.runtime

  const runtime = createPlatformAuthRuntime(auth, email, {
    baseUrl: auth.baseUrl,
    magicLinkTokenNamespace: 'crm-primary',
    cookieDomain: auth.cookieDomain || undefined,
    ...(phoneConfig.enabled ? { phone } : {}),
    ...(passkey.enabled ? { passkey } : {}),
  })
  cachedRuntime = { fingerprint, runtime }
  return runtime
}

/**
 * Issues portal magic links whose verification endpoint lives on the client
 * portal itself. The resulting session cookie is host-only, so activating a
 * client does not require a parent-domain cookie shared with the staff CRM.
 */
export function serverClientPortalAuth(event: H3Event): OpenExpertAuthRuntime {
  const runtimeConfig = useRuntimeConfig(event)
  const auth = runtimeConfig.auth as PlatformAuthRuntimeConfig
  const email = runtimeConfig.authEmail as PlatformAuthEmailConfig
  const portal = runtimeConfig.clientPortal as { baseUrl?: string, cookiePrefix?: string }
  const baseUrl = String(portal?.baseUrl || '').replace(/\/$/u, '')
  const cookiePrefix = String(portal?.cookiePrefix || '').trim()
  if (!baseUrl || !cookiePrefix) {
    throw new Error('Client portal auth configuration is invalid')
  }

  const fingerprint = JSON.stringify({ auth, email, baseUrl, cookiePrefix })
  if (cachedClientPortalRuntime?.fingerprint === fingerprint) {
    return cachedClientPortalRuntime.runtime
  }
  const runtime = createPlatformAuthRuntime(auth, email, {
    baseUrl,
    cookiePrefix,
    magicLinkTokenNamespace: 'client-portal',
    cookieDomain: undefined,
    trustedOrigins: [baseUrl],
    portalOnly: true,
  })
  cachedClientPortalRuntime = { fingerprint, runtime }
  return runtime
}

/**
 * Verifies purpose-specific organization invitation magic links. The runtime
 * shares the CRM session cookie, secret and identity schema, but its handler is
 * mounted under a separate GET-only base path. Password sign-up stays disabled;
 * possession of a server-issued magic link is the only way to create an
 * identity through this runtime.
 */
export function serverOrganizationInvitationAuth(event: H3Event): OpenExpertAuthRuntime {
  const runtimeConfig = useRuntimeConfig(event)
  const auth = runtimeConfig.auth as PlatformAuthRuntimeConfig
  const email = runtimeConfig.authEmail as PlatformAuthEmailConfig
  const invitations = runtimeConfig.organizationInvitations as OrganizationInvitationAuthConfig
  const enabled = invitations?.enabled === true
  const baseUrl = String(invitations?.baseUrl || auth.baseUrl).replace(/\/+$/u, '')
  const basePath = String(invitations?.basePath || '/api/organization-auth').trim()
  if (!enabled || !baseUrl || basePath !== '/api/organization-auth') {
    throw new Error('Organization invitation auth configuration is invalid')
  }

  const fingerprint = JSON.stringify({ auth, email, baseUrl, basePath })
  if (cachedOrganizationInvitationRuntime?.fingerprint === fingerprint) {
    return cachedOrganizationInvitationRuntime.runtime
  }

  const runtime = createPlatformAuthRuntime(auth, email, {
    baseUrl,
    basePath,
    magicLinkTokenNamespace: 'crm-organization-invitation',
    cookieDomain: auth.cookieDomain || undefined,
    trustedOrigins: [baseUrl],
    organizationInvitationOnly: true,
  })
  cachedOrganizationInvitationRuntime = { fingerprint, runtime }
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
  const phoneUser = session.user as typeof session.user & {
    phoneNumber?: unknown
    phoneNumberVerified?: unknown
  }
  const phoneNumber = phoneUser.phoneNumberVerified === true
    ? String(phoneUser.phoneNumber || '')
    : ''
  return {
    id: session.user.id,
    sub: session.user.id,
    role: 'authenticated',
    email: session.user.email,
    email_verified: session.user.emailVerified,
    email_confirmed_at: verifiedUser?.emailVerifiedAt
      ? new Date(verifiedUser.emailVerifiedAt).toISOString()
      : null,
    phone: phoneNumber,
    user_metadata: { full_name: fullName },
  }
}

export async function serverAuthUserById(event: H3Event, userId: string) {
  return getOpenExpertUserById(serverAuth(event), userId)
}

export async function serverAuthUserExistsByEmail(event: H3Event, email: string): Promise<boolean> {
  const runtime = serverAuth(event)
  const result = await runtime.pool.query(
    `select 1
       from ${runtime.config.databaseSchema}.users
      where email = $1
      limit 1`,
    [email.trim().toLowerCase()],
  )
  return result.rowCount === 1
}

export async function serverAuthUserExistsByPhone(event: H3Event, phoneNumber: string): Promise<boolean> {
  const runtime = serverAuth(event)
  const result = await runtime.pool.query(
    `select 1
       from ${runtime.config.databaseSchema}.users
      where phone_number = $1
        and phone_number_verified = true
      limit 1`,
    [phoneNumber],
  )
  return result.rowCount === 1
}
