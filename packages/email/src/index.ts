import { Resend } from 'resend'
import { waitlistConfirmationTemplate } from './waitlist-confirmation'

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

export type EmailDeliveryResult =
  | { status: 'sent', id: string }
  | { status: 'skipped', reason: 'missing_api_key' | 'missing_from_address' }

export class EmailDeliveryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailDeliveryError'
  }
}

function normalizeRecipients(input: string | string[]): string[] {
  const values = (Array.isArray(input) ? input : [input])
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
  if (!values.length) throw new EmailDeliveryError('At least one recipient is required.')
  return values
}

function validateIdempotencyKey(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256) {
    throw new EmailDeliveryError('Email idempotency key must contain 1-256 characters.')
  }
  return normalized
}

/**
 * One transactional transport for production (Resend) and local development
 * (Mailpit over SMTP). It is intentionally server-only.
 */
export function createTransactionalEmailSender(config: EmailServiceConfig) {
  const apiKey = config.apiKey?.trim() ?? ''
  const from = config.from?.trim() ?? ''
  const replyTo = config.replyTo?.trim() || undefined
  const smtpHost = config.smtp?.host.trim() ?? ''
  const resend = apiKey && from ? new Resend(apiKey) : null

  return {
    isConfigured: Boolean(from && (resend || smtpHost)),
    provider: resend ? 'resend' as const : smtpHost ? 'smtp' as const : null,

    async send(input: TransactionalEmailInput): Promise<EmailDeliveryResult> {
      if (!from) return { status: 'skipped', reason: 'missing_from_address' }

      const recipients = normalizeRecipients(input.to)
      const idempotencyKey = validateIdempotencyKey(input.idempotencyKey)

      if (resend) {
        const { data, error } = await resend.emails.send(
          {
            from,
            to: recipients,
            replyTo,
            subject: input.subject,
            html: input.html,
            text: input.text,
            tags: input.tags,
          },
          { idempotencyKey },
        )

        if (error || !data?.id) {
          throw new EmailDeliveryError(error?.message ?? 'Resend did not return an email id.')
        }
        return { status: 'sent', id: data.id }
      }

      if (!smtpHost) return { status: 'skipped', reason: 'missing_api_key' }

      const { createTransport } = await import('nodemailer')
      const transport = createTransport({
        host: smtpHost,
        port: config.smtp?.port ?? 1025,
        secure: config.smtp?.secure ?? false,
        auth: config.smtp?.user
          ? {
              user: config.smtp.user,
              pass: config.smtp.password ?? '',
            }
          : undefined,
      })
      const result = await transport.sendMail({
        from,
        to: recipients,
        replyTo,
        subject: input.subject,
        html: input.html,
        text: input.text,
        // Stable Message-ID makes local retries visible and traceable in
        // Mailpit. Resend provides actual deduplication in production.
        messageId: `<${Buffer.from(idempotencyKey).toString('base64url')}@openexpert.local>`,
        headers: {
          'X-OpenExpert-Idempotency-Key': idempotencyKey,
        },
      })

      return {
        status: 'sent',
        id: result.messageId,
      }
    },
  }
}

export function createEmailService(config: EmailServiceConfig) {
  const apiKey = config.apiKey?.trim() ?? ''
  const from = config.from?.trim() ?? ''
  const transactional = createTransactionalEmailSender(config)

  return {
    isConfigured: transactional.isConfigured,

    async sendWaitlistConfirmation(
      input: WaitlistConfirmationInput,
    ): Promise<EmailDeliveryResult> {
      if (!apiKey && !config.smtp?.host) {
        return { status: 'skipped', reason: 'missing_api_key' }
      }
      if (!from) return { status: 'skipped', reason: 'missing_from_address' }

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
