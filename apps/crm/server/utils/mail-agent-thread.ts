import { createError, type H3Event } from 'h3'
import type {
  CrmAgentMailAddressSummary,
  CrmAgentMailMessageDirection,
  CrmAgentMailThreadReadResponse,
  CrmAgentMailThreadReadResult,
} from '../../shared/types/agent-mail.ts'
import type { CrmSession } from './crm.ts'
import {
  createMailAgentAttachmentReference,
} from './mail-agent-reference.ts'
import {
  denseMailBodyExcerpt,
  mailAgentMessageMatchesParticipants,
} from './mail-agent-thread-core.ts'
import {
  mailAgentThreadReferenceConnectionId,
  openMailAgentThreadReference,
  type MailAgentThreadAccessMode,
} from './mail-agent-thread-reference.ts'
import {
  requireUserMailConnection,
  type MailConnectionRow,
} from './mail-connections.ts'
import { fetchMailThreadDetailForConnection } from './mail-thread-detail.ts'
import { connectionReferenceSecret } from './mail-thread-page.ts'

const maximumMessagesTotal = 48
const maximumBodyCharactersTotal = 60_000
const maximumBodyCharactersPerMessage = 2_400
const minimumBodyCharactersPerMessage = 600
const maximumRecipientsPerField = 10
const maximumAttachmentsPerMessage = 8
const maximumAttachmentsTotal = 30

function invalidOrStaleReference(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Odnośnik do wątku jest nieprawidłowy, wygasł albo wiadomość została przeniesiona.',
  })
}

function providerStatusCode(error: unknown): number {
  return Number((error as { statusCode?: unknown })?.statusCode)
}

function normalizedEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase()
}

function directionForMessage(
  connection: MailConnectionRow,
  fromEmail: string | null | undefined,
  recipients: Array<{ email: string | null }>,
): CrmAgentMailMessageDirection {
  const account = normalizedEmail(connection.account_email)
  if (normalizedEmail(fromEmail) === account) return 'sent'
  if (recipients.some(recipient => normalizedEmail(recipient.email) === account)) return 'received'
  return 'other'
}

function addressSummary(value: {
  name: string
  email: string | null
  label: string
}): CrmAgentMailAddressSummary {
  return {
    name: value.name,
    email: value.email,
    label: value.label,
  }
}

interface LoadedThread {
  rank: number
  connection: MailConnectionRow
  detail: Awaited<ReturnType<typeof fetchMailThreadDetailForConnection>>
  referenceSecret: string
  accessMode: MailAgentThreadAccessMode
  participantEmails: string[]
}

async function loadThread(
  event: H3Event,
  session: CrmSession,
  reference: string,
  rank: number,
): Promise<LoadedThread> {
  let connectionId: string
  try {
    connectionId = mailAgentThreadReferenceConnectionId(reference)
  }
  catch {
    return invalidOrStaleReference()
  }

  let loaded: Awaited<ReturnType<typeof requireUserMailConnection>>
  try {
    loaded = await requireUserMailConnection(event, session, connectionId)
  }
  catch (error) {
    if (providerStatusCode(error) === 404) return invalidOrStaleReference()
    throw error
  }
  const { backendData, connection } = loaded
  const referenceSecret = connectionReferenceSecret(event, connection)

  let payload: ReturnType<typeof openMailAgentThreadReference>
  try {
    payload = openMailAgentThreadReference(reference, referenceSecret)
  }
  catch {
    return invalidOrStaleReference()
  }

  return {
    rank,
    connection,
    referenceSecret,
    accessMode: payload.accessMode,
    participantEmails: payload.participantEmails,
    detail: await fetchMailThreadDetailForConnection(event, {
      backendData,
      session,
      connection,
      threadId: payload.threadId,
      observeBankMail: false,
    }),
  }
}

function threadResult(
  session: CrmSession,
  loaded: LoadedThread,
  messageLimit: number,
  bodyLimit: number,
  question: string | undefined,
  attachmentBudget: { remaining: number },
): CrmAgentMailThreadReadResult {
  const providerWindow = [...loaded.detail.messages]
    .sort((left, right) => String(left.sentAt ?? '').localeCompare(String(right.sentAt ?? '')))
    .map((message, providerIndex) => ({ message, providerIndex }))
  const visibleMessages = loaded.accessMode === 'participants'
    ? providerWindow.filter(({ message }) => (
        mailAgentMessageMatchesParticipants(
          message,
          loaded.participantEmails,
          loaded.connection.account_email,
        )
      ))
    : providerWindow
  const selectedMessages = visibleMessages.slice(-messageLimit)
  const locallyOmitted = visibleMessages.length - selectedMessages.length

  const messages = selectedMessages.map(({ message, providerIndex }) => {
    const body = denseMailBodyExcerpt(message.bodyText, bodyLimit, question)
    const availableAttachments = Math.min(
      maximumAttachmentsPerMessage,
      attachmentBudget.remaining,
    )
    const attachments = message.attachments
      .slice(0, availableAttachments)
      .map((attachment, attachmentIndex) => ({
        reference: createMailAgentAttachmentReference({
          connectionId: loaded.connection.id,
          threadId: loaded.detail.id,
          messageId: message.id,
          attachmentId: attachment.id,
          attachmentIndex,
        }, loaded.referenceSecret),
        fileName: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.size,
      }))
    attachmentBudget.remaining -= attachments.length
    const recipients = [...message.to, ...message.cc]
    return {
      ordinal: loaded.detail.omittedMessageCount + providerIndex + 1,
      direction: directionForMessage(loaded.connection, message.from?.email, recipients),
      from: message.from ? addressSummary(message.from) : null,
      to: message.to.slice(0, maximumRecipientsPerField).map(addressSummary),
      cc: message.cc.slice(0, maximumRecipientsPerField).map(addressSummary),
      subject: message.subject,
      sentAt: message.sentAt,
      bodyExcerpt: body.text,
      bodyExcerptStart: body.start,
      bodyTruncated: message.bodyTruncated || body.truncated,
      authentication: message.security.authentication,
      replyToMismatch: message.security.replyToMismatch,
      attachments,
      omittedAttachmentCount: Math.max(0, message.attachments.length - attachments.length),
    }
  })

  return {
    rank: loaded.rank,
    mailbox: loaded.connection.account_email,
    provider: loaded.connection.provider,
    subject: loaded.detail.subject,
    providerMessageCount: providerWindow.length + loaded.detail.omittedMessageCount,
    matchedMessageCountInWindow: visibleMessages.length,
    filteredMessageCount: providerWindow.length - visibleMessages.length,
    returnedMessageCount: messages.length,
    omittedMessageCount: loaded.detail.omittedMessageCount + locallyOmitted,
    messages,
    url: `/org/${encodeURIComponent(session.organizationSlug)}/mail`,
  }
}

export async function readMailAgentThreads(
  event: H3Event,
  session: CrmSession,
  references: string[],
  question?: string,
): Promise<CrmAgentMailThreadReadResponse> {
  const settled = await Promise.allSettled(
    references.map((reference, index) => loadThread(event, session, reference, index + 1)),
  )
  const loaded = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const failureCount = settled.length - loaded.length
  if (!loaded.length) {
    const failure = settled.find(result => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    return invalidOrStaleReference()
  }

  const messageLimit = Math.max(1, Math.floor(maximumMessagesTotal / loaded.length))
  const selectedMessageCount = loaded.reduce(
    (sum, item) => {
      const visibleCount = item.accessMode === 'participants'
        ? item.detail.messages.filter(message => (
            mailAgentMessageMatchesParticipants(
              message,
              item.participantEmails,
              item.connection.account_email,
            )
          )).length
        : item.detail.messages.length
      return sum + Math.min(messageLimit, visibleCount)
    },
    0,
  )
  const bodyLimit = Math.min(
    maximumBodyCharactersPerMessage,
    Math.max(
      minimumBodyCharactersPerMessage,
      Math.floor(maximumBodyCharactersTotal / Math.max(1, selectedMessageCount)),
    ),
  )
  const attachmentBudget = { remaining: maximumAttachmentsTotal }
  const threads = loaded
    .sort((left, right) => left.rank - right.rank)
    .map(item => threadResult(
      session,
      item,
      messageLimit,
      bodyLimit,
      question,
      attachmentBudget,
    ))

  return {
    data: {
      requestedThreadCount: references.length,
      readThreadCount: threads.length,
      failureCount,
      threads,
    },
  }
}
