import { createHash } from 'node:crypto'
import {
  createOpenExpertAuth,
  getOpenExpertSession,
  type OpenExpertAuthRuntime,
} from '@openexpert/auth/server'
import {
  createTransactionalEmailSender,
  EmailDeliveryError,
} from '@openexpert/email'
import { getRequestHeaders, type H3Event } from 'h3'

interface PlatformAuthRuntimeConfig {
  baseUrl: string
  basePath: string
  databaseUrl: string
  databaseSchema: string
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function emailContent(kind: 'email-verification' | 'magic-link' | 'password-reset', url: string) {
  const safeUrl = escapeHtml(url)
  if (kind === 'password-reset') {
    return {
      subject: 'Ustaw nowe hasło w OpenExpert',
      text: `Otwórz ten link, aby ustawić nowe hasło:\n\n${url}\n\nJeśli to nie Ty, zignoruj tę wiadomość.`,
      html: `<p>Otwórz poniższy link, aby ustawić nowe hasło w OpenExpert.</p><p><a href="${safeUrl}">Ustaw nowe hasło</a></p><p>Jeśli to nie Ty, zignoruj tę wiadomość.</p>`,
    }
  }
  if (kind === 'magic-link') {
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
      cookiePrefix: auth.cookiePrefix,
      cookieDomain: auth.cookieDomain || undefined,
      trustedOrigins: auth.trustedOrigins
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
    },
    emailSender: {
      async send(message) {
        const content = emailContent(message.kind, message.url)
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
  const fullName = String(session.user.name || '').trim()
  return {
    id: session.user.id,
    sub: session.user.id,
    role: 'authenticated',
    email: session.user.email,
    email_verified: session.user.emailVerified,
    email_confirmed_at: session.user.emailVerified
      ? new Date(session.user.updatedAt).toISOString()
      : null,
    phone: '',
    user_metadata: { full_name: fullName },
  }
}
