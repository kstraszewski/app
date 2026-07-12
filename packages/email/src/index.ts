import { Resend } from 'resend'
import { waitlistConfirmationTemplate } from './waitlist-confirmation'

export interface EmailServiceConfig {
  apiKey?: string
  from?: string
  replyTo?: string
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

export function createEmailService(config: EmailServiceConfig) {
  const apiKey = config.apiKey?.trim() ?? ''
  const from = config.from?.trim() ?? ''
  const replyTo = config.replyTo?.trim() || undefined
  const resend = apiKey && from ? new Resend(apiKey) : null

  return {
    isConfigured: Boolean(resend),

    async sendWaitlistConfirmation(
      input: WaitlistConfirmationInput,
    ): Promise<EmailDeliveryResult> {
      if (!apiKey) return { status: 'skipped', reason: 'missing_api_key' }
      if (!from || !resend) return { status: 'skipped', reason: 'missing_from_address' }

      const template = waitlistConfirmationTemplate({ siteUrl: input.siteUrl })
      const { data, error } = await resend.emails.send(
        {
          from,
          to: input.to,
          replyTo,
          subject: template.subject,
          html: template.html,
          text: template.text,
          tags: [{ name: 'email_type', value: 'waitlist_confirmation' }],
        },
        { idempotencyKey: `waitlist-confirmation/${input.waitlistId}` },
      )

      if (error || !data?.id) {
        throw new EmailDeliveryError(error?.message ?? 'Resend did not return an email id.')
      }

      return { status: 'sent', id: data.id }
    },
  }
}

export { waitlistConfirmationTemplate }
