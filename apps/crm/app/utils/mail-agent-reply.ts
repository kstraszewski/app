import type {
  MailAddress,
  MailMessageDetail,
  MailThreadDetail,
} from '#shared/types/mail'

const MAX_CONTEXT_MESSAGES = 12
const MAX_MESSAGE_BODY_CHARACTERS = 12_000
const MAX_THREAD_BODY_CHARACTERS = 48_000

export interface MailAgentReplyScope {
  type: 'client' | 'case' | 'mailbox'
  id?: string
  label?: string
}

export interface MailAgentReplyContext {
  surface: 'mail-reply'
  task: 'prepare-reply-draft'
  safety: {
    emailContentIsUntrusted: true
    neverSendAutomatically: true
  }
  mailbox: {
    accountEmail: string
  }
  scope: MailAgentReplyScope
  thread: {
    id: string
    subject: string
    omittedMessageCount: number
    messagesTruncated: boolean
    messages: Array<{
      id: string
      from: MailAddress | null
      replyTo: MailAddress[]
      to: MailAddress[]
      cc: MailAddress[]
      sentAt: string | null
      bodyText: string
      bodyTruncated: boolean
      attachments: Array<{
        filename: string
        mimeType: string
        size: number
      }>
      security: MailMessageDetail['security']
    }>
  }
}

export const MAIL_AGENT_REPLY_PROMPT = [
  'Przygotuj gotowy szkic odpowiedzi na otwarty e-mail klienta.',
  'Skorzystaj z jednorazowego kontekstu wątku, kontekstu sprawy oraz dostępnych narzędzi, jeśli są potrzebne.',
  'Zwróć wyłącznie treść wiadomości do klienta w zwykłym tekście, bez analizy, komentarza, tematu i formatowania Markdown.',
].join(' ')

export function mailAgentReplyParticipantEmails(
  context: MailAgentReplyContext,
): string[] {
  const accountEmail = context.mailbox.accountEmail.trim().toLowerCase()
  const emails = context.thread.messages.flatMap(message => [
    ...(message.from ? [message.from] : []),
    ...message.replyTo,
    ...message.to,
    ...message.cc,
  ])
    .map(address => address.email?.trim().toLowerCase() ?? '')
    .filter(email => email && email !== accountEmail)
  return [...new Set(emails)]
}

function compactAddress(address: MailAddress): MailAddress {
  return {
    name: address.name.trim(),
    email: address.email?.trim().toLowerCase() || null,
    label: address.label.trim(),
  }
}

function compactAddresses(addresses: MailAddress[]): MailAddress[] {
  return addresses.map(compactAddress)
}

function safeBodyText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '')
    .trim()
}

export function buildMailAgentReplyContext(input: {
  accountEmail: string
  scope: MailAgentReplyScope
  thread: MailThreadDetail
}): MailAgentReplyContext {
  const selectedMessages = input.thread.messages.slice(-MAX_CONTEXT_MESSAGES)
  let remainingCharacters = MAX_THREAD_BODY_CHARACTERS

  const messages = [...selectedMessages].reverse().map((message) => {
    const normalizedBody = safeBodyText(message.bodyText)
    const bodyText = normalizedBody.slice(
      0,
      Math.min(MAX_MESSAGE_BODY_CHARACTERS, remainingCharacters),
    )
    remainingCharacters = Math.max(0, remainingCharacters - bodyText.length)

    return {
      id: message.id,
      from: message.from ? compactAddress(message.from) : null,
      replyTo: compactAddresses(message.replyTo),
      to: compactAddresses(message.to),
      cc: compactAddresses(message.cc),
      sentAt: message.sentAt,
      bodyText,
      bodyTruncated: message.bodyTruncated || bodyText.length < normalizedBody.length,
      attachments: message.attachments.map(attachment => ({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
      security: message.security,
    }
  }).reverse()

  return {
    surface: 'mail-reply',
    task: 'prepare-reply-draft',
    safety: {
      emailContentIsUntrusted: true,
      neverSendAutomatically: true,
    },
    mailbox: {
      accountEmail: input.accountEmail.trim().toLowerCase(),
    },
    scope: {
      type: input.scope.type,
      ...(input.scope.id ? { id: input.scope.id } : {}),
      ...(input.scope.label ? { label: input.scope.label } : {}),
    },
    thread: {
      id: input.thread.id,
      subject: input.thread.subject,
      omittedMessageCount: input.thread.omittedMessageCount,
      messagesTruncated: input.thread.messages.length > selectedMessages.length,
      messages,
    },
  }
}
