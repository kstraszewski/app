import {
  createError,
  getHeader,
  getRequestURL,
  setResponseHeader,
  type H3Event,
} from 'h3'
import type { MailSendPayload } from '../../../../../shared/types/mail.ts'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
} from '~~/server/utils/mail-connections'
import {
  buildGmailSendPayload,
  parseGmailRecipientList,
  type GmailSendAttachment,
} from '~~/server/utils/gmail-send'
import {
  readBoundedMultipartFormData,
  type MailMultipartPart,
} from '~~/server/utils/mail-multipart'
import {
  claimMailSendRequest,
  enforceMailSendRateLimit,
  mailSendRequestHash,
  markMailSendRequestOutcome,
  markMailSendRequestSent,
  type MailSendRequestRow,
} from '~~/server/utils/mail-send-requests'
import {
  fetchGmailReplyContext,
  findGmailSentMessage,
  mailTokenIncludesSendAccess,
  sendGmailMessage,
} from '~~/server/utils/mail-providers'

const MAX_REQUEST_BYTES = 24 * 1024 * 1024
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_ATTACHMENTS_BYTES = 16 * 1024 * 1024
const MAX_GMAIL_RAW_CHARACTERS = 30 * 1024 * 1024
const MAX_ATTACHMENTS = 10
const MAX_BODY_CHARACTERS = 200_000
const MAX_SUBJECT_CHARACTERS = 500

export default defineEventHandler(async (event): Promise<MailSendPayload> => {
  setResponseHeader(event, 'cache-control', 'private, no-store')
  requireSameOriginMultipartRequest(event)
  const session = await requireCrmSession(event)
  const { serviceRole, connection } = await requireUserMailConnection(event, session)
  if (!mailTokenIncludesSendAccess(connection.scopes)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Połącz Gmail ponownie i zezwól na wysyłanie wiadomości.',
    })
  }

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
      statusMessage: 'Wiadomość z załącznikami nie może przekraczać 24 MB.',
    })
  }

  const parts = await readBoundedMultipartFormData(event, MAX_REQUEST_BYTES)
  if (!parts) {
    throw createError({ statusCode: 400, statusMessage: 'Wymagany jest formularz wiadomości.' })
  }
  if (parts.length > MAX_ATTACHMENTS + 8) {
    throw createError({ statusCode: 400, statusMessage: 'Formularz zawiera zbyt wiele pól.' })
  }
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
  if (threadId && !/^[A-Za-z0-9_-]{1,256}$/u.test(threadId)) {
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
        statusMessage: 'Pojedynczy załącznik nie może przekraczać 10 MB.',
      })
    }
    attachmentsBytes += part.data.length
    return {
      filename: safeAttachmentFilename(part.filename, index),
      mimeType: safeAttachmentMimeType(part.type),
      data: part.data,
    }
  })
  if (attachmentsBytes > MAX_ATTACHMENTS_BYTES) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Łączny rozmiar załączników nie może przekraczać 16 MB.',
    })
  }
  if (!body.trim() && !attachments.length) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Dodaj treść wiadomości lub co najmniej jeden załącznik.',
    })
  }

  const accessToken = await activeMailAccessToken(event, serviceRole, connection)
  let claimedRequest: MailSendRequestRow | null = null
  try {
    const reply = threadId
      ? await fetchGmailReplyContext(accessToken, threadId)
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
    })
    const claim = await claimMailSendRequest(
      serviceRole,
      session,
      connection,
      idempotencyKey,
      requestHash,
    )
    if (!claim.claimed) {
      return {
        data: await resolveExistingSendRequest(
          serviceRole,
          claim.row,
          accessToken,
        ),
      }
    }
    claimedRequest = claim.row
    await enforceMailSendRateLimit(serviceRole, session)

    let payload
    try {
      payload = buildGmailSendPayload({
        from: connection.account_email,
        to,
        cc,
        bcc,
        subject,
        text: body,
        attachments,
        messageId: claim.row.message_id_header,
        threadId: threadId || undefined,
        inReplyTo: reply?.inReplyTo,
        references: reply?.references,
      })
    } catch {
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

    const sent = await sendGmailMessage(accessToken, payload)
    try {
      await markMailSendRequestSent(
        serviceRole,
        claim.row,
        sent.id,
        sent.threadId,
      )
    } catch {
      throw createError({
        statusCode: 502,
        statusMessage: 'Wiadomość mogła zostać wysłana. Sprawdź folder Wysłane przed ponowieniem.',
        data: { deliveryAmbiguous: true },
      })
    }
    if (connection.status !== 'active') {
      try {
        await markMailConnectionStatus(serviceRole, connection, 'active', null)
      } catch {
        // The send result is durable; a cosmetic connection status must not turn it into a retry.
      }
    }
    return { data: sent }
  } catch (error) {
    const statusCode = Number((error as { statusCode?: number })?.statusCode)
    if (claimedRequest) {
      const ambiguous = Boolean(
        (error as { data?: { deliveryAmbiguous?: boolean } })?.data?.deliveryAmbiguous,
      )
      try {
        await markMailSendRequestOutcome(
          serviceRole,
          claimedRequest,
          ambiguous ? 'unknown' : 'failed',
          statusCode ? `HTTP_${statusCode}` : 'SEND_ERROR',
        )
      } catch {
        // Preserve the provider error; the next request will treat a stale pending row as unknown.
      }
    }
    if (statusCode === 401 || statusCode === 403) {
      await markMailConnectionStatus(
        serviceRole,
        connection,
        'revoked',
        'Google no longer authorizes access to this Gmail account',
      )
      throw createError({
        statusCode: 409,
        statusMessage: 'Połącz Gmail ponownie, aby wysyłać wiadomości.',
      })
    }
    throw error
  }
})

async function resolveExistingSendRequest(
  serviceRole: any,
  row: MailSendRequestRow,
  accessToken: string,
): Promise<MailSendPayload['data']> {
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

  const found = await findGmailSentMessage(accessToken, row.message_id_header)
  if (found) {
    await markMailSendRequestSent(
      serviceRole,
      row,
      found.id,
      found.threadId,
    )
    return found
  }
  if (row.status === 'pending') {
    await markMailSendRequestOutcome(
      serviceRole,
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

function requireSameOriginMultipartRequest(event: H3Event): void {
  const contentType = getHeader(event, 'content-type') || ''
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    throw createError({
      statusCode: 415,
      statusMessage: 'Wiadomość musi zostać przesłana jako formularz multipart.',
    })
  }
  const origin = getHeader(event, 'origin')
  if (!origin) {
    throw createError({ statusCode: 403, statusMessage: 'Brak nagłówka Origin.' })
  }
  const requestUrl = getRequestURL(event)
  const allowedOrigins = new Set([requestUrl.origin])
  const forwardedHost = getHeader(event, 'x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = getHeader(event, 'x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwardedHost && /^https?$/u.test(forwardedProto || '')) {
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`)
  }
  let normalizedOrigin = ''
  try {
    normalizedOrigin = new URL(origin).origin
  } catch {
    // Invalid origins are rejected below.
  }
  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (
    !allowedOrigins.has(normalizedOrigin)
    || (fetchSite && fetchSite !== 'same-origin')
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Żądanie wysyłki pochodzi z niedozwolonej strony.',
    })
  }
}

function multipartValue(
  parts: MailMultipartPart[],
  name: string,
): string {
  const matches = parts.filter(part => part.name === name && !part.filename)
  if (matches.length > 1) {
    throw createError({ statusCode: 400, statusMessage: `Pole ${name} zostało powtórzone.` })
  }
  return matches[0]?.data.toString('utf8') ?? ''
}

function multipartText(
  parts: MailMultipartPart[],
  name: string,
): string {
  return multipartValue(parts, name).trim()
}

function parseRecipients(value: string, label: string): string[] {
  try {
    return parseGmailRecipientList(value)
  } catch {
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
  return {
    to: unique(to),
    cc: unique(cc),
    bcc: unique(bcc),
  }
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
