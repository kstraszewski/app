import type { MailAddress } from '../../shared/types/mail.ts'

// Symbol keys survive internal object spreads but are ignored by JSON.stringify,
// so exact participant matching can use BCC without exposing blind recipients
// through the public mail or EVE DTOs.
const blindRecipients = Symbol('openexpert.mail.blind-recipients')
const blindThreadParticipants = Symbol('openexpert.mail.blind-thread-participants')

export function withMailMessageBlindRecipients<T extends object>(
  message: T,
  recipients: MailAddress[],
): T {
  if (!recipients.length) return message
  Object.defineProperty(message, blindRecipients, {
    configurable: false,
    enumerable: true,
    value: recipients,
    writable: false,
  })
  return message
}

export function mailMessageBlindRecipients(message: object): MailAddress[] {
  const recipients = (message as Record<symbol, unknown>)[blindRecipients]
  return Array.isArray(recipients) ? recipients as MailAddress[] : []
}

export function withMailThreadBlindParticipants<T extends object>(
  thread: T,
  participants: MailAddress[],
): T {
  if (!participants.length) return thread
  Object.defineProperty(thread, blindThreadParticipants, {
    configurable: false,
    enumerable: true,
    value: participants,
    writable: false,
  })
  return thread
}

export function mailThreadBlindParticipants(thread: object): MailAddress[] {
  const participants = (thread as Record<symbol, unknown>)[blindThreadParticipants]
  return Array.isArray(participants) ? participants as MailAddress[] : []
}
