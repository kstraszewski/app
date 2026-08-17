import { scheduleOpenExpertBackgroundTask } from '@openexpert/auth/server'
import {
  createError,
  getHeader,
  type H3Event,
} from 'h3'
import type {
  MailContextScope,
  MailSendPayload,
} from '../../../../../shared/types/mail.ts'
import type { ImapSmtpSendResult } from '~~/server/utils/mail-imap-smtp'
import { gmailBlockedAttachmentExtension } from '../../../../../shared/utils/mail-security.ts'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
  type MailConnectionRow,
} from '~~/server/utils/mail-connections'
import {
  buildGmailSendPayload,
  parseGmailRecipientList,
  type GmailSendAttachment,
} from '~~/server/utils/gmail-send'
import { imapSmtpRuntimeForConnection } from '~~/server/utils/mail-imap-runtime'
import {
  imapSmtpConnectionFailureReason,
  safeImapSmtpError,
} from '~~/server/utils/mail-imap-errors'
import {
  readBoundedMultipartFormData,
  type MailMultipartPart,
} from '~~/server/utils/mail-multipart'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'
import {
  claimRateLimitedMailSendRequest,
  mailSendRequestHash,
  markMailSendRequestOutcome,
  markMailSendRequestProviderAccepted,
  markMailSendRequestSent,
  type MailSendRequestRow,
} from '~~/server/utils/mail-send-requests'
import {
  fetchGmailReplyContext,
  findGmailSentMessage,
  mailTokenIncludesSendAccess,
  sendGmailMessage,
} from '~~/server/utils/mail-providers'
import { connectionReferenceSecret } from '~~/server/utils/mail-thread-page'
import {
  resolveMailContextScopes,
  upsertMailContextThreadLink,
} from '~~/server/utils/mail-context'
import {
  parseMailContextScope,
  parseMailContextScopes,
} from '~~/server/utils/mail-context-core'

// Vercel Functions reject request bodies above 4.5 MB before the handler runs.
// Keep the complete multipart envelope at 4 MiB and reserve enough headroom for
// a 200k-character UTF-8 body, recipients, filenames and multipart boundaries.
const MAX_REQUEST_BYTES = 4 * 1024 * 1024
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 3 * 1024 * 1024
const MAX_GMAIL_RAW_CHARACTERS = 30 * 1024 * 1024
const MAX_ATTACHMENTS = 10
const MAX_BODY_CHARACTERS = 200_000
const MAX_SUBJECT_CHARACTERS = 500
const MAX_THREAD_REFERENCE_CHARACTERS = 4_096
const SMTP_PARTIAL_DELIVERY_ERROR_CODE = 'SMTP_PARTIAL_DELIVERY'

type ProviderRuntime =
  | {
      provider: 'google'
      accessToken: string
      referenceSecret: string
    }
  | {
      provider: 'microsoft'
      accessToken: string
      referenceSecret: string
    }
  | { provider: 'imap'; config: ReturnType<typeof imapSmtpRuntimeForConnection> }

interface ReplyContext {
  subject: string
  inReplyTo?: string
  references?: string[]
}

export default defineEventHandler(async (event): Promise<MailSendPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMultipartRequest(event)
  const session = await requireCrmSession(event)

  const contentLengthHeader = getHeader(event, 'content-length')?.trim() || ''
  const contentLength = Number(contentLengthHeader)
  if (
    contentLengthHeader
    && (
      !/^\d+$/u.test(contentLengthHeader)
      || !Number.isSafeInteger(contentLength)
    )
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Nagłówek rozmiaru wiadomości jest nieprawidłowy.',
    })
  }
  if (contentLength > MAX_REQUEST_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Wiadomość z załącznikami nie może przekraczać 4 MiB.',
    })
  }

  const parts = await readBoundedMultipartFormData(event, MAX_REQUEST_BYTES)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: 'Wymagany jest formularz wiadomości.' })
  }
  if (parts.length > MAX_ATTACHMENTS + 11) {
    throw createError({ statusCode: 400, statusMessage: 'Formularz zawiera zbyt wiele pól.' })
  }

  const connectionId = multipartText(parts, 'connectionId')
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'Wybierz konto, z którego wysyłasz wiadomość.' })
  }
  const { backendData, connection } = await requireUserMailConnection(
    event,
    session,
    connectionId,
  )
  if (connection.status === 'revoked') {
    throw reconnectError(connection)
  }

  const contextInput = multipartMailContextScopes(parts)
  const mailContexts = await resolveMailContextScopes(session, contextInput.scopes)

  const idempotencyKey = multipartText(parts, 'idempotencyKey').toLowerCase()
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      .test(idempotencyKey)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Brakuje prawidłowego identyfikatora wysyłki.',
    })
  }

  let to = parseRecipients(multipartText(parts, 'to'), 'Do')
  let cc = parseRecipients(multipartText(parts, 'cc'), 'DW')
  let bcc = parseRecipients(multipartText(parts, 'bcc'), 'UDW')
  ;({ to, cc, bcc } = uniqueRecipientGroups(to, cc, bcc))
  if (!to.length) {
    throw createError({ statusCode: 400, statusMessage: 'Podaj co najmniej jednego odbiorcę.' })
  }
  if (to.length + cc.length + bcc.length > 50) {
    throw createError({ statusCode: 400, statusMessage: 'Wiadomość ma zbyt wielu odbiorców.' })
  }

  const threadId = multipartText(parts, 'threadId')
  if (
    threadId
    && !new RegExp(`^[A-Za-z0-9_-]{1,${MAX_THREAD_REFERENCE_CHARACTERS}}$`, 'u').test(threadId)
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Nieprawidłowy identyfikator wątku.' })
  }
  let subject = multipartText(parts, 'subject')
  if (!threadId && !subject) {
    throw createError({ statusCode: 400, statusMessage: 'Podaj temat wiadomości.' })
  }
  if (subject.length > MAX_SUBJECT_CHARACTERS || /[\0\r\n]/u.test(subject)) {
    throw createError({ statusCode: 400, statusMessage: 'Temat wiadomości jest nieprawidłowy.' })
  }

  const body = multipartValue(parts, 'body')
  if (body.length > MAX_BODY_CHARACTERS || body.includes('\0')) {
    throw createError({ statusCode: 400, statusMessage: 'Treść wiadomości jest zbyt długa.' })
  }

  const fileParts = parts.filter(part => part.name === 'attachment' && part.filename)
  if (fileParts.length > MAX_ATTACHMENTS) {
    throw createError({
      statusCode: 413,
      statusMessage: `Możesz dodać maksymalnie ${MAX_ATTACHMENTS} załączników.`,
    })
  }
  let attachmentsBytes = 0
  const attachments: GmailSendAttachment[] = fileParts.map((part, index) => {
    if (!part.data.length) {
      throw createError({ statusCode: 400, statusMessage: 'Załącznik nie może być pusty.' })
    }
    if (part.data.length > MAX_ATTACHMENT_BYTES) {
      throw createError({
        statusCode: 413,
        statusMessage: 'Pojedynczy załącznik nie może przekraczać 3 MiB.',
      })
    }
    attachmentsBytes += part.data.length
    const filename = safeAttachmentFilename(part.filename, index)
    if (connection.provider === 'google') {
      const blockedExtension = gmailBlockedAttachmentExtension(filename)
      if (blockedExtension) {
        throw createError({
          statusCode: 400,
          statusMessage: `Gmail blokuje załączniki .${blockedExtension}. Wybierz bezpieczny format pliku.`,
        })
      }
    }
    return {
      filename,
      mimeType: safeAttachmentMimeType(part.type),
      data: part.data,
    }
  })
  if (attachmentsBytes > MAX_ATTACHMENTS_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Łączny rozmiar załączników nie może przekraczać 3 MiB.',
    })
  }
  if (!body.trim() && !attachments.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dodaj treść wiadomości lub co najmniej jeden załącznik.',
    })
  }

  let claimedRequest: MailSendRequestRow | null = null
  let providerObjectPersisted = false
  try {
    const runtime = await providerRuntime(event, backendData, connection)
    const reply = threadId
      ? await providerReplyContext(runtime, connection, threadId)
      : null
    if (reply) subject = reply.subject

    const requestHash = mailSendRequestHash({
      to,
      cc,
      bcc,
      subject,
      body,
      threadId,
      attachments,
      ...(contextInput.hasContextsField
        ? { contexts: mailContexts }
        : mailContexts[0] ? { context: mailContexts[0] } : {}),
    })
    const claim = await claimRateLimitedMailSendRequest(
      event,
      backendData,
      session,
      connection,
      idempotencyKey,
      requestHash,
    )
    if (!claim.claimed) {
      const existing = await resolveExistingSendRequest(
        backendData,
        claim.row,
        runtime,
        connection,
      )
      await linkSentContextsBestEffort(
        event,
        backendData,
        session,
        connection,
        mailContexts,
        existing.threadId,
      )
      return {
        data: existing,
      }
    }
    claimedRequest = claim.row

    const sent = await sendProviderMessage({
      runtime,
      connection,
      to,
      cc,
      bcc,
      subject,
      body,
      threadId,
      idempotencyKey,
      attachments,
      reply,
      messageId: claim.row.message_id_header,
      onProviderObjectCreated: async (providerMessageId, providerThreadId) => {
        await markMailSendRequestProviderAccepted(
          backendData,
          claim.row,
          providerMessageId,
          providerThreadId,
        )
        providerObjectPersisted = true
        if (claimedRequest) {
          claimedRequest.provider_message_id = providerMessageId
          claimedRequest.provider_thread_id = providerThreadId
        }
      },
    })
    try {
      await markMailSendRequestSent(
        backendData,
        claim.row,
        sent.id,
        sent.threadId,
      )
    }
    catch {
      throw createError({
        statusCode: 502,
        statusMessage: 'Wiadomość mogła zostać wysłana. Sprawdź folder Wysłane przed ponowieniem.',
        data: { deliveryAmbiguous: true },
      })
    }
    if (connection.status !== 'active') {
      try {
        await markMailConnectionStatus(backendData, connection, 'active', null, true)
      }
      catch {
        // Delivery is durable; a cosmetic connection status must not turn it into a retry.
      }
    }
    await linkSentContextsBestEffort(
      event,
      backendData,
      session,
      connection,
      mailContexts,
      sent.threadId,
    )
    return { data: sent }
  }
  catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode)
    const ambiguous = deliveryIsAmbiguous(error)
    if (claimedRequest) {
      try {
        await markMailSendRequestOutcome(
          backendData,
          claimedRequest,
          ambiguous ? 'unknown' : 'failed',
          providerErrorCode(error, statusCode, providerObjectPersisted),
        )
      }
      catch {
        // Preserve the provider error; stale pending rows are recovered on a later request.
      }
    }
    if (connection.provider !== 'imap' && (statusCode === 401 || statusCode === 403)) {
      await markMailConnectionStatus(
        backendData,
        connection,
        'revoked',
        `${providerLabel(connection)} no longer authorizes mailbox access`,
      )
      throw reconnectError(connection)
    }
    if (connection.provider === 'imap') {
      const failureReason = imapSmtpConnectionFailureReason(error)
      if (failureReason) {
        try {
          await markMailConnectionStatus(
            backendData,
            connection,
            'error',
            failureReason,
          )
        }
        catch {
          // Preserve the sanitized SMTP error if the status update fails.
        }
      }
    }
    throw error
  }
})

async function linkSentContextsBestEffort(
  event: H3Event,
  backendData: any,
  session: Awaited<ReturnType<typeof requireCrmSession>>,
  connection: MailConnectionRow,
  contexts: readonly MailContextScope[],
  threadReference: string,
): Promise<void> {
  if (!contexts.length) return

  let referenceSecret: string
  try {
    referenceSecret = connectionReferenceSecret(event, connection)
  }
  catch {
    // Delivery is already durable. Link metadata must never turn a successful
    // send (or an idempotent replay) into a delivery error.
    return
  }

  const link = (scope: MailContextScope) => upsertMailContextThreadLink(
    backendData,
    session,
    {
      connectionId: connection.id,
      provider: connection.provider,
      referenceSecret,
      scope,
      threadReference,
      linkSource: 'sent_from_context',
    },
  )
  const attempts = await Promise.allSettled(contexts.map(link))
  const failed = contexts.filter((_, index) => attempts[index]?.status === 'rejected')
  if (!failed.length) return

  try {
    const retry = Promise.allSettled(failed.map(link)).then(() => undefined)
    scheduleOpenExpertBackgroundTask(retry, event.waitUntil.bind(event))
  }
  catch {
    // The provider delivery remains successful even if retry scheduling fails.
  }
}

async function providerRuntime(
  event: Parameters<typeof imapSmtpRuntimeForConnection>[0],
  backendData: any,
  connection: MailConnectionRow,
): Promise<ProviderRuntime> {
  if (connection.provider === 'imap') {
    if (!connection.smtp_host) {
      throw createError({ statusCode: 409, statusMessage: 'Dla tej skrzynki nie skonfigurowano wysyłki SMTP.' })
    }
    try {
      return {
        provider: 'imap',
        config: imapSmtpRuntimeForConnection(event, connection),
      }
    }
    catch (error) {
      throw safeImapSmtpError(error, 'send')
    }
  }

  if (connection.provider === 'google') {
    if (!mailTokenIncludesSendAccess(connection.scopes)) throw reconnectError(connection)
  }
  else {
    const microsoft = await import('~~/server/utils/mail-microsoft')
    if (!microsoft.microsoftMailTokenIncludesSendAccess(connection.scopes)) {
      throw reconnectError(connection)
    }
  }
  return {
    provider: connection.provider,
    accessToken: await activeMailAccessToken(event, backendData, connection),
    referenceSecret: connectionReferenceSecret(event, connection),
  }
}

async function providerReplyContext(
  runtime: ProviderRuntime,
  connection: MailConnectionRow,
  threadId: string,
): Promise<ReplyContext> {
  if (runtime.provider === 'google') {
    return fetchGmailReplyContext(runtime.accessToken, threadId)
  }
  if (runtime.provider === 'microsoft') {
    const microsoft = await import('~~/server/utils/mail-microsoft')
    return microsoft.fetchMicrosoftMailReplyContext(
      runtime.accessToken,
      connection.account_email,
      threadId,
      { referenceSecret: runtime.referenceSecret },
    )
  }
  const config = runtime.config
  try {
    const imap = await import('~~/server/utils/mail-imap-smtp')
    return await imap.fetchImapSmtpReplyContext(config, threadId)
  }
  catch (error) {
    throw safeImapSmtpError(error, 'send')
  }
}

async function sendProviderMessage(input: {
  runtime: ProviderRuntime
  connection: MailConnectionRow
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  threadId: string
  idempotencyKey: string
  messageId: string
  attachments: GmailSendAttachment[]
  reply: ReplyContext | null
  onProviderObjectCreated: (messageId: string, threadId: string) => Promise<void>
}): Promise<MailSendPayload['data']> {
  const runtime = input.runtime
  if (runtime.provider === 'google') {
    let payload
    try {
      payload = buildGmailSendPayload({
        from: input.connection.account_email,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.body,
        attachments: input.attachments,
        messageId: input.messageId,
        threadId: input.threadId || undefined,
        inReplyTo: input.reply?.inReplyTo,
        references: input.reply?.references,
      })
    }
    catch {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nie udało się przygotować bezpiecznej wiadomości.',
      })
    }
    if (payload.raw.length > MAX_GMAIL_RAW_CHARACTERS) {
      throw createError({
        statusCode: 413,
        statusMessage: 'Wiadomość jest zbyt duża do wysłania przez Gmail.',
      })
    }
    return sendGmailMessage(runtime.accessToken, payload)
  }

  if (runtime.provider === 'microsoft') {
    const microsoft = await import('~~/server/utils/mail-microsoft')
    return microsoft.sendMicrosoftMailMessage(
      runtime.accessToken,
      {
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.body,
        messageId: input.messageId,
        threadId: input.threadId || undefined,
        attachments: input.attachments,
      },
      {
        referenceSecret: runtime.referenceSecret,
        accountEmail: input.connection.account_email,
        onDraftCreated: draft => input.onProviderObjectCreated(draft.id, draft.threadId),
      },
    )
  }

  const config = runtime.config
  let sent: ImapSmtpSendResult
  try {
    const imap = await import('~~/server/utils/mail-imap-smtp')
    sent = await imap.sendImapSmtpMessage(config, {
      idempotencyKey: input.idempotencyKey,
      messageId: input.messageId,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      text: input.body,
      attachments: input.attachments,
      inReplyTo: input.reply?.inReplyTo,
      references: input.reply?.references,
    })
  }
  catch (error) {
    throw safeImapSmtpError(error, 'send')
  }
  if (sent.partial || sent.rejected.length > 0) {
    try {
      await input.onProviderObjectCreated(sent.id, sent.threadId)
    }
    catch {
      // Some recipients already received the message. Preserve the explicit
      // partial-delivery outcome even if saving its Sent reference failed.
    }
    throw smtpPartialDeliveryError()
  }
  return { id: sent.id, threadId: sent.threadId }
}

async function resolveExistingSendRequest(
  backendData: any,
  row: MailSendRequestRow,
  runtime: ProviderRuntime,
  connection: MailConnectionRow,
): Promise<MailSendPayload['data']> {
  if (row.error_code === SMTP_PARTIAL_DELIVERY_ERROR_CODE) {
    // This is terminal for this idempotency key: retrying could duplicate the
    // message for recipients the SMTP server already accepted.
    throw smtpPartialDeliveryError()
  }
  if (
    row.status === 'sent'
    && row.provider_message_id
    && row.provider_thread_id
  ) {
    return {
      id: row.provider_message_id,
      threadId: row.provider_thread_id,
    }
  }
  if (row.status === 'sent') {
    throw createError({
      statusCode: 500,
      statusMessage: 'Zapisane potwierdzenie wysyłki jest niekompletne.',
    })
  }
  if (row.status === 'failed') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Poprzednia próba nie powiodła się. Spróbuj wysłać wiadomość ponownie.',
    })
  }

  const updatedAt = new Date(row.updated_at).getTime()
  if (
    row.status === 'pending'
    && Number.isFinite(updatedAt)
    && Date.now() - updatedAt < 2 * 60_000
  ) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ta wiadomość jest już wysyłana.',
    })
  }

  let found: MailSendPayload['data'] | null = null
  if (runtime.provider === 'google') {
    found = await findGmailSentMessage(runtime.accessToken, row.message_id_header)
  }
  else if (runtime.provider === 'microsoft') {
    const microsoft = await import('~~/server/utils/mail-microsoft')
    found = await microsoft.findMicrosoftSentMessage(
      runtime.accessToken,
      row.message_id_header,
      {
        referenceSecret: runtime.referenceSecret,
        accountEmail: connection.account_email,
        providerMessageId: row.provider_message_id || undefined,
      },
    )
  }
  else {
    const config = runtime.config
    try {
      const imap = await import('~~/server/utils/mail-imap-smtp')
      found = await imap.findImapSmtpSentMessage(config, row.message_id_header)
    }
    catch (error) {
      throw safeImapSmtpError(error, 'send')
    }
  }
  if (found) {
    await markMailSendRequestSent(
      backendData,
      row,
      found.id,
      found.threadId,
    )
    return found
  }
  if (row.status === 'pending') {
    await markMailSendRequestOutcome(
      backendData,
      row,
      'unknown',
      'STALE_PENDING',
    )
  }
  throw createError({
    statusCode: 409,
    statusMessage: 'Nie potwierdzono wysyłki. Sprawdź folder Wysłane przed ponowieniem.',
  })
}

function requireSameOriginMultipartRequest(event: Parameters<typeof requireSameOriginMailRequest>[0]): void {
  const contentType = getHeader(event, 'content-type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Wiadomość musi zostać przesłana jako formularz multipart.',
    })
  }
  requireSameOriginMailRequest(event)
}

function multipartValue(parts: MailMultipartPart[], name: string): string {
  const matches = parts.filter(part => part.name === name && !part.filename)
  if (matches.length > 1) {
    throw createError({ statusCode: 400, statusMessage: `Pole ${name} zostało powtórzone.` })
  }
  return matches[0]?.data.toString('utf8') ?? ''
}

function multipartText(parts: MailMultipartPart[], name: string): string {
  return multipartValue(parts, name).trim()
}

function multipartMailContextScopes(parts: MailMultipartPart[]): {
  scopes: MailContextScope[]
  hasContextsField: boolean
} {
  const hasContextsField = parts.some(part => part.name === 'contexts' && !part.filename)
  let scopes: MailContextScope[] = []
  if (hasContextsField) {
    const value = multipartText(parts, 'contexts')
    try {
      scopes = parseMailContextScopes(JSON.parse(value))
    }
    catch {
      throw createError({
        statusCode: 400,
        statusMessage: 'Nieprawidłowy kontekst poczty.',
      })
    }
  }

  // Keep the original pair for older composer clients. If both contracts are
  // present, merge and canonicalize them instead of creating duplicate links.
  const contextType = multipartText(parts, 'contextType')
  const contextId = multipartText(parts, 'contextId')
  if (Boolean(contextType) !== Boolean(contextId)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Kontekst wiadomości jest niekompletny.',
    })
  }
  if (contextType && contextId) {
    scopes.push(parseMailContextScope({ type: contextType, id: contextId }))
  }

  return {
    scopes: parseMailContextScopes(scopes),
    hasContextsField,
  }
}

function parseRecipients(value: string, label: string): string[] {
  try {
    return parseGmailRecipientList(value)
  }
  catch {
    throw createError({
      statusCode: 400,
      statusMessage: `${label}: podaj poprawne adresy e-mail oddzielone przecinkami.`,
    })
  }
}

function uniqueRecipientGroups(
  to: string[],
  cc: string[],
  bcc: string[],
): { to: string[]; cc: string[]; bcc: string[] } {
  const seen = new Set<string>()
  const unique = (values: string[]) => values.filter((value) => {
    const key = value.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { to: unique(to), cc: unique(cc), bcc: unique(bcc) }
}

function safeAttachmentFilename(value: string | undefined, index: number): string {
  const basename = String(value ?? '')
    .replace(/\\/gu, '/')
    .split('/')
    .at(-1)
    ?.replace(/[\u0000-\u001F\u007F]/gu, '_')
    .trim()
  return truncateUtf8(basename || `zalacznik-${index + 1}`, 180)
}

function safeAttachmentMimeType(value: string | undefined): string {
  const mimeType = String(value ?? '').trim().toLowerCase()
  return mimeType.length <= 100
    && /^[A-Z0-9!#$&^_.+-]+\/[A-Z0-9!#$&^_.+-]+$/iu.test(mimeType)
    ? mimeType
    : 'application/octet-stream'
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = ''
  for (const character of value) {
    if (Buffer.byteLength(result + character, 'utf8') > maxBytes) break
    result += character
  }
  return result || 'zalacznik'
}

function deliveryIsAmbiguous(error: unknown): boolean {
  const value = error as {
    deliveryAmbiguous?: boolean
    data?: { deliveryAmbiguous?: boolean }
  }
  return Boolean(value?.deliveryAmbiguous || value?.data?.deliveryAmbiguous)
}

function smtpPartialDeliveryError() {
  return createError({
    statusCode: 502,
    statusMessage: 'Serwer SMTP przyjął wiadomość tylko dla części odbiorców. Sprawdź adresy i folder Wysłane przed utworzeniem nowej wysyłki.',
    data: {
      deliveryAmbiguous: true,
      deliveryPartial: true,
    },
  })
}

function providerErrorCode(
  error: unknown,
  statusCode: number,
  providerObjectPersisted: boolean,
): string {
  if (Boolean((error as { data?: { deliveryPartial?: boolean } })?.data?.deliveryPartial)) {
    return SMTP_PARTIAL_DELIVERY_ERROR_CODE
  }
  const code = String((error as { code?: unknown })?.code || '').trim()
  if (code) return code.slice(0, 100)
  if (statusCode) return `HTTP_${statusCode}`
  return providerObjectPersisted ? 'SEND_ERROR_AFTER_PROVIDER_OBJECT' : 'SEND_ERROR'
}

function reconnectError(connection: MailConnectionRow) {
  return createError({
    statusCode: 409,
    statusMessage: `Połącz ponownie konto ${providerLabel(connection)} i zezwól na wysyłanie wiadomości.`,
  })
}

function providerLabel(connection: MailConnectionRow): string {
  if (connection.provider === 'google') return 'Gmail'
  if (connection.provider === 'microsoft') return 'Outlook'
  return 'IMAP/SMTP'
}
