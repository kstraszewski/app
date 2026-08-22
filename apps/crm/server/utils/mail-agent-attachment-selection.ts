import { createError } from 'h3'
import type {
  MailAttachment,
  MailMessageDetail,
  MailThreadDetail,
} from '../../shared/types/mail.ts'
import type { MailAgentAttachmentReferencePayload } from './mail-agent-reference.ts'
import { mailMessageIsDraft } from './mail-message-draft-state.ts'

export interface ResolvedMailAgentAttachment {
  message: MailMessageDetail
  attachment: MailAttachment
}

function invalidOrStaleReference(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Odnośnik do załącznika jest nieprawidłowy, wygasł albo plik został przeniesiony.',
  })
}

export function resolveMailAgentAttachment(
  detail: MailThreadDetail,
  payload: MailAgentAttachmentReferencePayload,
): ResolvedMailAgentAttachment {
  if (detail.id !== payload.threadId) return invalidOrStaleReference()
  const message = detail.messages.find(candidate => candidate.id === payload.messageId)
  const attachment = message?.attachments[payload.attachmentIndex]
  if (!message || !attachment || attachment.id !== payload.attachmentId) {
    return invalidOrStaleReference()
  }
  if (mailMessageIsDraft(message)) return invalidOrStaleReference()
  return { message, attachment }
}
