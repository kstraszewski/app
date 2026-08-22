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
  boundedMailAgentAddress,
  boundedMailAgentCount,
  boundedMailAgentNullableText,
  boundedMailAgentText,
} from './mail-agent-dto.ts'
import {
  denseMailBodyExcerpt,
  mailAgentCorrespondenceMessages,
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

const maximumMessagesPerProviderWindow = 12
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
  return boundedMailAgentAddress(value)
}

interface LoadedThread {
  rank: number
  connection: MailConnectionRow
  detail: Awaited<ReturnType<typeof fetchMailThreadDetailForConnection>>
  referenceSecret: string
  accessMode: MailAgentThreadAccessMode
  participantEmails: string[]
  threadId: string
  continuation: ReturnType<typeof openMailAgentThreadReference>['continuation']
  expiresAt: number
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
    threadId: payload.threadId,
    continuation: payload.continuation,
    expiresAt: payload.expiresAt,
    detail: await fetchMailThreadDetailForConnection(event, {
      backendData,
      session,
      connection,
      threadId: payload.threadId,
      observeBankMail: false,
      maxMessages: maximumMessagesPerProviderWindow,
      continuation: payload.continuation,
    }),
  }
}

function threadResult(
  session: CrmSession,
  loaded: LoadedThread,
  bodyLimit: number,
  question: string | undefined,
  attachmentBudget: { remaining: number },
): CrmAgentMailThreadReadResult {
  const providerMessages = [...loaded.detail.messages]
    .sort((left, right) => String(left.sentAt ?? '').localeCompare(String(right.sentAt ?? '')))
  const providerWindow = providerMessages
    .map((message, providerIndex) => ({ message, providerIndex }))
  const correspondenceMessages = new Set(mailAgentCorrespondenceMessages(providerMessages))
  const correspondenceWindow = providerWindow.filter(({ message }) => correspondenceMessages.has(message))
  const visibleMessages = loaded.accessMode === 'participants'
    ? correspondenceWindow.filter(({ message }) => (
        mailAgentMessageMatchesParticipants(
          message,
          loaded.participantEmails,
          loaded.connection.account_email,
        )
      ))
    : correspondenceWindow
  if (providerWindow.length > maximumMessagesPerProviderWindow) return invalidOrStaleReference()
  const providerMessageCount = boundedMailAgentCount(
    loaded.detail.providerMessageCount
      ?? providerWindow.length + loaded.detail.omittedMessageCount,
    100_000,
  )
  const newerMessageCount = boundedMailAgentCount(
    loaded.detail.newerMessageCount ?? 0,
    100_000,
  )
  const messageWindowStart = boundedMailAgentCount(
    loaded.detail.messageWindowStart ?? loaded.detail.omittedMessageCount,
    100_000,
  )
  if (
    messageWindowStart !== loaded.detail.omittedMessageCount
    || providerMessageCount !== newerMessageCount + messageWindowStart + providerWindow.length
  ) return invalidOrStaleReference()

  const messages = visibleMessages.map(({ message, providerIndex }) => {
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
        fileName: boundedMailAgentText(attachment.filename, 500),
        mimeType: boundedMailAgentText(attachment.mimeType, 255),
        sizeBytes: boundedMailAgentCount(attachment.size),
      }))
    attachmentBudget.remaining -= attachments.length
    const recipients = [...message.to, ...message.cc]
    return {
      ordinal: messageWindowStart + providerIndex + 1,
      direction: directionForMessage(loaded.connection, message.from?.email, recipients),
      from: message.from ? addressSummary(message.from) : null,
      to: message.to.slice(0, maximumRecipientsPerField).map(addressSummary),
      cc: message.cc.slice(0, maximumRecipientsPerField).map(addressSummary),
      subject: boundedMailAgentText(message.subject, 500),
      sentAt: boundedMailAgentNullableText(message.sentAt, 64),
      bodyExcerpt: body.text,
      bodyExcerptStart: body.start,
      bodyTruncated: message.bodyTruncated || body.truncated,
      authentication: message.security.authentication,
      replyToMismatch: message.security.replyToMismatch,
      attachments,
      omittedAttachmentCount: boundedMailAgentCount(
        message.attachments.length - attachments.length,
        10_000,
      ),
    }
  })

  let nextReference: string | null = null
  if (messageWindowStart > 0 && loaded.detail.nextPageToken) {
    try {
      nextReference = createMailAgentThreadReference({
        connectionId: loaded.connection.id,
        threadId: loaded.threadId,
        accessMode: loaded.accessMode,
        participantEmails: loaded.participantEmails,
        continuation: {
          cursor: loaded.detail.nextPageToken,
          newerMessageCount: newerMessageCount + providerWindow.length,
          providerMessageCount,
        },
        expiresAt: loaded.expiresAt,
      }, loaded.referenceSecret)
    }
    catch {
      nextReference = null
    }
  }

  const visibleSubject = visibleMessages.at(-1)?.message.subject

  return {
    rank: loaded.rank,
    mailbox: boundedMailAgentText(loaded.connection.account_email, 254),
    provider: loaded.connection.provider,
    subject: boundedMailAgentText(
      visibleSubject ?? '(brak korespondencji w tym oknie)',
      500,
    ),
    providerMessageCount,
    newerMessageCount,
    matchedMessageCountInWindow: visibleMessages.length,
    filteredMessageCount: providerWindow.length - visibleMessages.length,
    returnedMessageCount: messages.length,
    omittedMessageCount: messageWindowStart,
    nextReference,
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

  const selectedMessageCount = loaded.reduce(
    (sum, item) => {
      const correspondenceMessages = mailAgentCorrespondenceMessages(item.detail.messages)
      const visibleCount = item.accessMode === 'participants'
        ? correspondenceMessages.filter(message => (
            mailAgentMessageMatchesParticipants(
              message,
              item.participantEmails,
              item.connection.account_email,
            )
          )).length
        : correspondenceMessages.length
      return sum + visibleCount
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
      bodyLimit,
      question,
      attachmentBudget,
    ))

  return {
    data: {
      requestedThreadCount: references.length,
      readThreadCount: threads.length,
      failureCount,
      failedRanks: settled.flatMap((result, index) => (
        result.status === 'rejected' ? [index + 1] : []
      )),
      threads,
    },
  }
}
