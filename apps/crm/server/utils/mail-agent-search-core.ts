import type { CrmAgentMailFolder } from '../../shared/types/agent-mail.ts'
import type { MailMessageDetail } from '../../shared/types/mail.ts'

function normalizedEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

export function mailAgentMessageMatchesSearch(
  message: MailMessageDetail,
  input: {
    accountEmail: string
    folder: CrmAgentMailFolder
    participantEmail?: string
  },
): boolean {
  const sender = normalizedEmail(message.from?.email)
  const account = normalizedEmail(input.accountEmail)
  const participant = normalizedEmail(input.participantEmail)

  if (input.folder === 'sent') {
    if (!sender || sender !== account) return false
    return !participant || [...message.to, ...message.cc]
      .some(recipient => normalizedEmail(recipient.email) === participant)
  }

  if (sender === account) return false
  return !participant || sender === participant
}
