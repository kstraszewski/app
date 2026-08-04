import { createHash } from 'node:crypto'
import { Resend } from 'resend'
import { waitlistConfirmationTemplate } from './waitlist-confirmation.ts'

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000
const MAX_REQUEST_TIMEOUT_MS = 30_000
const MAX_RETRIES = 4
const MAX_RETRY_DELAY_MS = 10_000
const MAX_RECIPIENTS = 50
const MAX_SUBJECT_LENGTH = 998
const MAILBOX_MAX_LENGTH = 320
const EMAIL_MAX_LENGTH = 254
const LOCAL_PART_MAX_LENGTH = 64

const CONTROL_CHARACTERS_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/u
const BIDI_CONTROL_CHARACTERS_PATTERN = /[\u202A-\u202E\u2066-\u2069]/u
const LOCAL_PART_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu
const IDEMPOTENCY_KEY_PATTERN = /^[A-Z0-9][A-Z0-9._:/-]*$/iu
const TAG_PATTERN = /^[A-Z0-9_-]+$/iu

export interface SmtpEmailConfig {
  host: string
  port?: number
  secure?: boolean
  user?: string
  password?: string
}

export interface EmailServiceConfig {
  apiKey?: string
  from?: string
  replyTo?: string
  smtp?: SmtpEmailConfig
  /** Timeout applied separately to every Resend or SMTP attempt. */
  requestTimeoutMs?: number
  /** Number of retries after the first Resend attempt. Bounded to 0-4. */
  maxRetries?: number
  /** Base delay for exponential Resend retry backoff. */
  retryBaseDelayMs?: number
}

export interface TransactionalEmailInput {
  to: string | string[]
  subject: string
  html: string
  text: string
  idempotencyKey: string
  tags?: Array<{ name: string, value: string }>
}

export interface WaitlistConfirmationInput {
  to: string
  waitlistId: string
  siteUrl?: string
}

export interface EmailSenderRuntime {
  random?: () => number
  sleep?: (delayMs: number) => Promise<void>
}

export type EmailDeliveryResult =
  | { status: 'sent', id: string }
  | { status: 'skipped', reason: 'missing_api_key' | 'missing_from_address' }

interface EmailDeliveryErrorOptions {
  cause?: unknown
  provider?: 'resend' | 'smtp'
  retryable?: boolean
  statusCode?: number
}

export class EmailDeliveryError extends Error {
  readonly provider?: 'resend' | 'smtp'
  readonly retryable: boolean
  readonly statusCode?: number

  constructor(message: string, options: EmailDeliveryErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'EmailDeliveryError'
    this.provider = options.provider
    this.retryable = options.retryable ?? false
    this.statusCode = options.statusCode
  }
}

export class EmailConfigurationError extends EmailDeliveryError {
  constructor(message: string) {
    super(message)
    this.name = 'EmailConfigurationError'
  }
}

function containsUnsafeHeaderCharacters(value: string): boolean {
  return CONTROL_CHARACTERS_PATTERN.test(value)
    || BIDI_CONTROL_CHARACTERS_PATTERN.test(value)
}

function normalizeEmailAddress(value: string, field: string): string {
  const address = value.trim()
  if (!address || address.length > EMAIL_MAX_LENGTH || containsUnsafeHeaderCharacters(address)) {
    throw new EmailDeliveryError(`${field} must be a valid email address.`)
  }

  const separator = address.lastIndexOf('@')
  if (separator <= 0 || separator !== address.indexOf('@')) {
    throw new EmailDeliveryError(`${field} must be a valid email address.`)
  }

  const localPart = address.slice(0, separator)
  const domain = address.slice(separator + 1).toLowerCase()
  const labels = domain.split('.')
  const validDomain = domain.length <= 253
    && labels.length >= 2
    && labels.every(label => (
      label.length >= 1
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label)
    ))
    && !/^\d+$/u.test(labels.at(-1) ?? '')

  if (
    localPart.length > LOCAL_PART_MAX_LENGTH
    || !LOCAL_PART_PATTERN.test(localPart)
    || localPart.startsWith('.')
    || localPart.endsWith('.')
    || localPart.includes('..')
    || !validDomain
  ) {
    throw new EmailDeliveryError(`${field} must be a valid email address.`)
  }

  return `${localPart}@${domain}`
}

export function normalizeTransactionalEmailAddress(value: string): string {
  return normalizeEmailAddress(value, 'Email address')
}

function normalizeMailbox(value: string, field: string): string {
  const mailbox = value.trim()
  if (!mailbox || mailbox.length > MAILBOX_MAX_LENGTH || containsUnsafeHeaderCharacters(mailbox)) {
    throw new EmailDeliveryError(`${field} must be a valid mailbox.`)
  }

  const openingBracket = mailbox.indexOf('<')
  const closingBracket = mailbox.lastIndexOf('>')

  if (openingBracket === -1 && closingBracket === -1) {
    return normalizeEmailAddress(mailbox, field)
  }

  if (
    openingBracket <= 0
    || closingBracket !== mailbox.length - 1
    || openingBracket !== mailbox.lastIndexOf('<')
    || closingBracket !== mailbox.indexOf('>')
  ) {
    throw new EmailDeliveryError(`${field} must be a single valid mailbox.`)
  }

  const displayName = mailbox.slice(0, openingBracket).trim()
  if (
    !displayName
    || displayName.length > 128
    || displayName.includes(',')
    || displayName.includes('"')
    || displayName.includes('<')
    || displayName.includes('>')
  ) {
    throw new EmailDeliveryError(`${field} contains an invalid display name.`)
  }

  const address = normalizeEmailAddress(
    mailbox.slice(openingBracket + 1, closingBracket),
    field,
  )
  return `${displayName} <${address}>`
}

function normalizeRecipients(input: string | string[]): string[] {
  const values = Array.isArray(input) ? input : [input]
  if (!values.length || values.length > MAX_RECIPIENTS) {
    throw new EmailDeliveryError(`Email must contain 1-${MAX_RECIPIENTS} recipients.`)
  }

  const recipients = values.map((value, index) => {
    if (typeof value !== 'string') {
      throw new EmailDeliveryError(`Recipient ${index + 1} must be a valid mailbox.`)
    }
    return normalizeMailbox(value, `Recipient ${index + 1}`)
  })
  const seen = new Set<string>()
  const uniqueRecipients = recipients.filter((recipient) => {
    const key = recipient.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (!uniqueRecipients.length) {
    throw new EmailDeliveryError('At least one recipient is required.')
  }
  return uniqueRecipients
}

function validateIdempotencyKey(value: string): string {
  if (typeof value !== 'string') {
    throw new EmailDeliveryError('Email idempotency key must be a string.')
  }
  const normalized = value.trim()
  if (
    !normalized
    || normalized.length > 256
    || !IDEMPOTENCY_KEY_PATTERN.test(normalized)
  ) {
    throw new EmailDeliveryError(
      'Email idempotency key must contain 1-256 safe ASCII characters.',
    )
  }
  return normalized
}

function validateSubject(value: string): string {
  if (typeof value !== 'string') {
    throw new EmailDeliveryError('Email subject must be a string.')
  }
  const subject = value.trim()
  if (
    !subject
    || subject.length > MAX_SUBJECT_LENGTH
    || containsUnsafeHeaderCharacters(subject)
  ) {
    throw new EmailDeliveryError(`Email subject must contain 1-${MAX_SUBJECT_LENGTH} safe characters.`)
  }
  return subject
}

function validateBody(value: string, field: 'HTML' | 'plain-text'): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new EmailDeliveryError(`Email ${field} body is required.`)
  }
  return value
}

function normalizeTags(tags?: Array<{ name: string, value: string }>) {
  if (!tags) return undefined
  if (!Array.isArray(tags) || tags.length > 10) {
    throw new EmailDeliveryError('Email may contain at most 10 tags.')
  }

  return tags.map((tag, index) => {
    const name = typeof tag?.name === 'string' ? tag.name.trim() : ''
    const value = typeof tag?.value === 'string' ? tag.value.trim() : ''
    if (
      !name
      || !value
      || name.length > 256
      || value.length > 256
      || !TAG_PATTERN.test(name)
      || !TAG_PATTERN.test(value)
    ) {
      throw new EmailDeliveryError(`Email tag ${index + 1} is invalid.`)
    }
    return { name, value }
  })
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new EmailConfigurationError(`${field} must be an integer between ${minimum} and ${maximum}.`)
  }
  return value
}

function normalizeSmtpHost(value?: string): string {
  const host = value?.trim() ?? ''
  if (
    host
    && (host.length > 253 || containsUnsafeHeaderCharacters(host) || /\s/u.test(host))
  ) {
    throw new EmailConfigurationError('SMTP host is invalid.')
  }
  return host
}

function normalizeApiKey(value?: string): string {
  const apiKey = value?.trim() ?? ''
  if (apiKey && containsUnsafeHeaderCharacters(apiKey)) {
    throw new EmailConfigurationError('Resend API key is invalid.')
  }
  return apiKey
}

function isRetryableStatus(statusCode: number | null | undefined): statusCode is number {
  return statusCode === 429 || (typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600)
}

function retryDelay(
  attempt: number,
  baseDelayMs: number,
  random: () => number,
): number {
  const exponentialDelay = Math.min(baseDelayMs * (2 ** attempt), MAX_RETRY_DELAY_MS)
  const randomValue = Math.max(0, Math.min(1, random()))
  return Math.round(exponentialDelay * (0.5 + randomValue * 0.5))
}

function sleep(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

/**
 * One transactional transport for production (Resend) and local development
 * (Mailpit over SMTP). It is intentionally server-only.
 */
export function createTransactionalEmailSender(
  config: EmailServiceConfig,
  runtime: EmailSenderRuntime = {},
) {
  const apiKey = normalizeApiKey(config.apiKey)
  const from = config.from?.trim()
    ? normalizeMailbox(config.from, 'Sender')
    : ''
  const replyTo = config.replyTo?.trim()
    ? normalizeMailbox(config.replyTo, 'Reply-To')
    : undefined
  const smtpHost = normalizeSmtpHost(config.smtp?.host)
  const smtpUser = config.smtp?.user?.trim() ?? ''
  if (smtpUser && containsUnsafeHeaderCharacters(smtpUser)) {
    throw new EmailConfigurationError('SMTP username is invalid.')
  }
  const smtpPort = smtpHost
    ? boundedInteger(config.smtp?.port, 1025, 1, 65_535, 'SMTP port')
    : 1025
  const requestTimeoutMs = boundedInteger(
    config.requestTimeoutMs,
    DEFAULT_REQUEST_TIMEOUT_MS,
    1,
    MAX_REQUEST_TIMEOUT_MS,
    'Email request timeout',
  )
  const maxRetries = boundedInteger(
    config.maxRetries,
    DEFAULT_MAX_RETRIES,
    0,
    MAX_RETRIES,
    'Email maximum retries',
  )
  const retryBaseDelayMs = boundedInteger(
    config.retryBaseDelayMs,
    DEFAULT_RETRY_BASE_DELAY_MS,
    1,
    MAX_RETRY_DELAY_MS,
    'Email retry base delay',
  )
  const resend = apiKey && from ? new Resend(apiKey) : null
  const random = runtime.random ?? Math.random
  const wait = runtime.sleep ?? sleep

  return {
    isConfigured: Boolean(from && (resend || smtpHost)),
    provider: resend ? 'resend' as const : smtpHost ? 'smtp' as const : null,

    async send(input: TransactionalEmailInput): Promise<EmailDeliveryResult> {
      if (!from) return { status: 'skipped', reason: 'missing_from_address' }

      const recipients = normalizeRecipients(input.to)
      const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)
      const subject = validateSubject(input.subject)
      const html = validateBody(input.html, 'HTML')
      const text = validateBody(input.text, 'plain-text')
      const tags = normalizeTags(input.tags)

      if (resend) {
        const payload = {
          from,
          to: recipients,
          replyTo,
          subject,
          html,
          text,
          tags,
        }

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), requestTimeoutMs)

          let response: Awaited<ReturnType<typeof resend.emails.send>>
          let requestError: unknown
          try {
            const requestOptions: NonNullable<Parameters<typeof resend.emails.send>[1]>
              & { signal: AbortSignal } = {
                idempotencyKey,
                signal: controller.signal,
            }
            response = await resend.emails.send(payload, requestOptions)
          } catch (error) {
            requestError = error
          } finally {
            clearTimeout(timeout)
          }

          if (requestError || controller.signal.aborted) {
            if (attempt < maxRetries) {
              await wait(retryDelay(attempt, retryBaseDelayMs, random))
              continue
            }
            throw new EmailDeliveryError(
              controller.signal.aborted
                ? `Resend request timed out after ${requestTimeoutMs} ms.`
                : 'Resend network request failed.',
              {
                cause: requestError,
                provider: 'resend',
                retryable: true,
              },
            )
          }

          const { data, error } = response!
          if (!error && data?.id) {
            return { status: 'sent', id: data.id }
          }
          if (!error) {
            throw new EmailDeliveryError('Resend did not return an email id.', {
              provider: 'resend',
            })
          }

          const statusCode = typeof error.statusCode === 'number'
            ? error.statusCode
            : undefined
          // The SDK reports DNS/connection/abort failures as application
          // errors without an HTTP status. A stable idempotency key makes an
          // ambiguous retry safe even if the provider accepted the first try.
          const retryable = statusCode === undefined
            || isRetryableStatus(statusCode)
          if (!retryable || attempt === maxRetries) {
            throw new EmailDeliveryError(`Resend rejected the email: ${error.message}`, {
              provider: 'resend',
              retryable,
              statusCode,
            })
          }

          await wait(retryDelay(attempt, retryBaseDelayMs, random))
        }

        throw new EmailDeliveryError('Resend email delivery failed.', {
          provider: 'resend',
        })
      }

      if (!smtpHost) return { status: 'skipped', reason: 'missing_api_key' }

      const { createTransport } = await import('nodemailer')
      const transport = createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: config.smtp?.secure ?? false,
        requireTLS: Boolean(smtpUser) && !(config.smtp?.secure ?? false),
        connectionTimeout: requestTimeoutMs,
        greetingTimeout: requestTimeoutMs,
        socketTimeout: requestTimeoutMs,
        auth: smtpUser
          ? {
              user: smtpUser,
              pass: config.smtp?.password ?? '',
            }
          : undefined,
      })

      try {
        const result = await transport.sendMail({
          from,
          to: recipients,
          replyTo,
          subject,
          html,
          text,
          disableFileAccess: true,
          disableUrlAccess: true,
          // Stable Message-ID makes local retries visible and traceable in
          // Mailpit. Resend provides actual deduplication in production.
          messageId: `<${createHash('sha256').update(idempotencyKey).digest('hex')}@openexpert.local>`,
          headers: {
            'X-OpenExpert-Idempotency-Key': idempotencyKey,
          },
        })

        if (!result.messageId) {
          throw new EmailDeliveryError('SMTP did not return a message id.', {
            provider: 'smtp',
          })
        }
        return {
          status: 'sent',
          id: result.messageId,
        }
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error
        throw new EmailDeliveryError('SMTP email delivery failed.', {
          cause: error,
          provider: 'smtp',
        })
      } finally {
        transport.close()
      }
    },
  }
}

export function createEmailService(config: EmailServiceConfig) {
  const transactional = createTransactionalEmailSender(config)

  return {
    isConfigured: transactional.isConfigured,

    async sendWaitlistConfirmation(
      input: WaitlistConfirmationInput,
    ): Promise<EmailDeliveryResult> {
      const template = waitlistConfirmationTemplate({ siteUrl: input.siteUrl })
      return transactional.send({
        to: input.to,
        subject: template.subject,
        html: template.html,
        text: template.text,
        tags: [{ name: 'email_type', value: 'waitlist_confirmation' }],
        idempotencyKey: `waitlist-confirmation/${input.waitlistId}`,
      })
    },
  }
}

export { waitlistConfirmationTemplate }
