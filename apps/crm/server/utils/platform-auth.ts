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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function emailContent(
  kind: 'email-verification' | 'magic-link' | 'password-reset',
  url: string,
  metadata?: Record<string, unknown>,
) {
  const safeUrl = escapeHtml(url)
  if (kind === 'password-reset') {
    return {
      subject: 'Ustaw nowe hasło w OpenExpert',
      text: `Otwórz ten link, aby ustawić nowe hasło:\n\n${url}\n\nJeśli to nie Ty, zignoruj tę wiadomość.`,
      html: `<p>Otwórz poniższy link, aby ustawić nowe hasło w OpenExpert.</p><p><a href="${safeUrl}">Ustaw nowe hasło</a></p><p>Jeśli to nie Ty, zignoruj tę wiadomość.</p>`,
    }
  }
  if (kind === 'magic-link') {
    if (metadata?.clientPortalInvitation === true) {
      return {
        subject: 'Aktywuj bezpieczny panel klienta OpenExpert',
        text: [
          'Twój ekspert udostępnił Ci bezpieczny panel klienta OpenExpert.',
          '',
          `Aktywuj panel, otwierając ten jednorazowy link (ważny przez 1 godzinę):`,
          url,
          '',
          'Link jest przeznaczony tylko dla Ciebie — nie przekazuj go dalej.',
          'Jeśli nie oczekujesz tej wiadomości, możesz ją zignorować.',
        ].join('\n'),
        html: `<p>Twój ekspert udostępnił Ci bezpieczny panel klienta OpenExpert.</p><p><a href="${safeUrl}">Aktywuj panel klienta</a></p><p>Link jest jednorazowy i ważny przez 1 godzinę. Jest przeznaczony tylko dla Ciebie — nie przekazuj go dalej.</p><p>Jeśli nie oczekujesz tej wiadomości, możesz ją zignorować.</p>`,
      }
    }
    if (metadata?.clientPortalBookingActivation === true) {
      return {
        subject: 'Aktywuj panel po rezerwacji w OpenExpert',
        text: [
          'Twoja konsultacja została zapisana.',
          '',
          'Otwórz poniższy jednorazowy link, aby aktywować panel klienta i zobaczyć termin:',
          url,
          '',
          'Link jest ważny przez 1 godzinę i przeznaczony tylko dla Ciebie.',
        ].join('\n'),
        html: `<p>Twoja konsultacja została zapisana.</p><p><a href="${safeUrl}">Aktywuj panel klienta</a></p><p>Link jest jednorazowy, ważny przez 1 godzinę i przeznaczony tylko dla Ciebie.</p>`,
      }
    }
    return {
      subject: 'Twój link logowania do OpenExpert',
      text: `Otwórz ten jednorazowy link, aby zalogować się do OpenExpert:\n\n${url}`,
      html: `<p>Otwórz poniższy jednorazowy link, aby zalogować się do OpenExpert.</p><p><a href="${safeUrl}">Zaloguj się</a></p>`,
    }
  }
  return {
    subject: 'Potwierdź adres email w OpenExpert',
    text: `Otwórz ten link, aby potwierdzić adres email:\n\n${url}`,
    html: `<p>Otwórz poniższy link, aby potwierdzić adres email w OpenExpert.</p><p><a href="${safeUrl}">Potwierdź email</a></p>`,
  }
}

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
    cookiePrefix?: string
    cookieDomain?: string
    trustedOrigins?: string[]
    portalOnly?: boolean
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
  const runtime = createOpenExpertAuth({
    config: {
      baseURL: options.baseUrl,
      basePath: auth.basePath,
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
      disableSignUp: options.portalOnly ? true : undefined,
      magicLinkDisableSignUp: options.portalOnly ? false : undefined,
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
        const content = emailContent(
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
    cookieDomain: undefined,
    trustedOrigins: [baseUrl],
    portalOnly: true,
  })
  cachedClientPortalRuntime = { fingerprint, runtime }
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
