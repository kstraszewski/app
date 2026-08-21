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
import { useRuntimeConfig } from '#imports'
import { getRequestHeaders, type H3Event } from 'h3'

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

function emailContent(
  kind: 'email-verification' | 'magic-link' | 'password-reset',
  url: string,
  metadata?: Record<string, unknown>,
) {
  const safeUrl = escapeHtml(url)
  if (kind === 'password-reset') {
    return {
      subject: 'Ustaw nowe hasło w panelu OpenExpert',
      text: `Otwórz ten link, aby ustawić nowe hasło:\n\n${url}\n\nJeśli to nie Ty, zignoruj tę wiadomość.`,
      html: `<p>Otwórz poniższy link, aby ustawić nowe hasło w panelu OpenExpert.</p><p><a href="${safeUrl}">Ustaw nowe hasło</a></p><p>Jeśli to nie Ty, zignoruj tę wiadomość.</p>`,
    }
  }
  if (kind === 'magic-link') {
    if (metadata?.clientPortalBooking === true) {
      return {
        subject: 'Potwierdź konto i dokończ rezerwację w OpenExpert',
        text: `Otwórz ten jednorazowy link, aby potwierdzić konto klienta i wrócić do rezerwacji spotkania:\n\n${url}\n\nLink wygasa po godzinie. Jeśli to nie Ty rozpocząłeś rezerwację, zignoruj tę wiadomość.`,
        html: `<p>Potwierdź konto klienta, aby bezpiecznie wrócić do rezerwacji spotkania.</p><p><a href="${safeUrl}">Potwierdź konto i kontynuuj</a></p><p>Link wygasa po godzinie. Jeśli to nie Ty rozpocząłeś rezerwację, zignoruj tę wiadomość.</p>`,
      }
    }
    return {
      subject: 'Twój link logowania do panelu OpenExpert',
      text: `Otwórz ten jednorazowy link, aby zalogować się do panelu OpenExpert:\n\n${url}\n\nLink wygasa po godzinie. Nie przekazuj go dalej.`,
      html: `<p>Otwórz poniższy jednorazowy link, aby zalogować się do panelu OpenExpert.</p><p><a href="${safeUrl}">Zaloguj się</a></p><p>Link wygasa po godzinie. Nie przekazuj go dalej.</p>`,
    }
  }
  return {
    subject: 'Potwierdź adres email w panelu OpenExpert',
    text: `Otwórz ten link, aby potwierdzić adres email:\n\n${url}`,
    html: `<p>Otwórz poniższy link, aby potwierdzić adres email.</p><p><a href="${safeUrl}">Potwierdź email</a></p>`,
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
      ipAddressHeaders: auth.ipAddressHeaders
        .split(',')
        .map(header => header.trim().toLowerCase())
        .filter(Boolean),
      sessionFreshAge: auth.sessionFreshAge,
      cookiePrefix: auth.cookiePrefix,
      cookieDomain: auth.cookieDomain || undefined,
      disableSignUp: true,
      magicLinkDisableSignUp: false,
      magicLinkTokenNamespace: 'client-portal',
      trustedOrigins: auth.trustedOrigins
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
      socialProviders: {
        ...(auth.socialProviders?.google?.clientId
          && auth.socialProviders.google.clientSecret
          ? {
              google: {
                clientId: auth.socialProviders.google.clientId,
                clientSecret: auth.socialProviders.google.clientSecret,
                disableSignUp: true,
              },
            }
          : {}),
        ...(auth.socialProviders?.apple?.clientId
          && auth.socialProviders.apple.clientSecret
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
          idempotencyKey: `client-auth/${message.kind}/${createHash('sha256')
            .update(message.token)
            .digest('hex')}`,
          tags: [{ name: 'email_type', value: `client_${message.kind.replaceAll('-', '_')}` }],
        })
        if (result.status !== 'sent') {
          throw new EmailDeliveryError(
            `Auth email transport is not configured: ${result.reason}`,
          )
        }
      },
    },
  })
  cachedRuntime = { fingerprint, runtime }
  return runtime
}

export function serverAuthSession(event: H3Event) {
  return getOpenExpertSession(serverAuth(event), requestHeaders(event))
}
