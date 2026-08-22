import { createError, type H3Event } from 'h3'
import type {
  CrmAgentMailAttachmentReadResponse,
  CrmAgentMailAttachmentReadStatus,
} from '../../shared/types/agent-mail.ts'
import type { MailThreadDetail } from '../../shared/types/mail.ts'
import type { CrmSession } from './crm.ts'
import {
  extractMailAgentAttachmentText,
  MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES,
  selectMailAgentAttachmentExcerpts,
  type MailAgentAttachmentTextReason,
  type MailAgentAttachmentTextResult,
} from './mail-agent-attachment-text.ts'
import {
  mailAgentAttachmentReferenceConnectionId,
  openMailAgentAttachmentReference,
  type MailAgentAttachmentReferencePayload,
} from './mail-agent-reference.ts'
import {
  boundedMailAgentCount,
  boundedMailAgentNullableText,
  boundedMailAgentText,
} from './mail-agent-dto.ts'
import {
  resolveMailAgentAttachment,
  type ResolvedMailAgentAttachment,
} from './mail-agent-attachment-selection.ts'
import {
  activeMailAccessToken,
  requireUserMailConnection,
  type MailConnectionRow,
} from './mail-connections.ts'
import { imapSmtpRuntimeForConnection } from './mail-imap-runtime.ts'
import {
  connectionReferenceSecret,
  handleMailProviderError,
} from './mail-thread-page.ts'

const extractionReasonLabels: Record<MailAgentAttachmentTextReason, string> = {
  empty_input: 'Plik jest pusty.',
  input_too_large: 'Plik przekracza bezpieczny limit 8 MB.',
  unsupported_type: 'Ten typ pliku nie jest obsługiwany.',
  legacy_office_not_supported: 'Stare formaty Worda i Excela nie są obsługiwane.',
  image_requires_ocr: 'Obraz lub skan wymaga OCR, którego ten odczyt nie wykonuje.',
  archive_not_supported: 'Archiwa nie są rozpakowywane.',
  encrypted_document: 'Dokument jest zaszyfrowany lub chroniony hasłem.',
  unreadable_document: 'Nie udało się bezpiecznie odczytać dokumentu.',
  no_extractable_text: 'Dokument nie zawiera możliwego do wydobycia tekstu.',
  archive_entry_limit: 'Dokument zawiera zbyt wiele elementów archiwum.',
  archive_size_limit: 'Rozpakowana zawartość dokumentu przekracza bezpieczny limit.',
  archive_xml_limit: 'Zawartość dokumentu przekracza bezpieczny limit ekstrakcji.',
  missing_document_xml: 'Dokument nie zawiera wymaganej struktury tekstowej.',
  text_limit: 'Tekst dokumentu został ograniczony do bezpiecznego rozmiaru.',
  page_limit: 'Odczyt został ograniczony do pierwszych 200 stron.',
}

function invalidOrStaleReference(): never {
  throw createError({
    statusCode: 409,
    statusMessage: 'Odnośnik do załącznika jest nieprawidłowy, wygasł albo plik został przeniesiony.',
  })
}

function providerStatusCode(error: unknown): number {
  return Number((error as { statusCode?: unknown })?.statusCode)
}

async function downloadAttachmentBytes(
  event: H3Event,
  backendData: any,
  connection: MailConnectionRow,
  payload: MailAgentAttachmentReferencePayload,
  resolved: ResolvedMailAgentAttachment,
): Promise<Uint8Array> {
  try {
    if (connection.provider === 'google') {
      const [{ fetchGmailAttachmentBytes }, accessToken] = await Promise.all([
        import('./mail-providers.ts'),
        activeMailAccessToken(event, backendData, connection),
      ])
      return fetchGmailAttachmentBytes(accessToken, {
        messageId: payload.messageId,
        attachmentId: resolved.attachment.id,
        attachmentIndex: payload.attachmentIndex,
        maxBytes: MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES,
      })
    }

    if (connection.provider === 'microsoft') {
      if (!resolved.attachment.id) return invalidOrStaleReference()
      const [{ fetchMicrosoftMailAttachmentBytes }, accessToken] = await Promise.all([
        import('./mail-microsoft.ts'),
        activeMailAccessToken(event, backendData, connection),
      ])
      return fetchMicrosoftMailAttachmentBytes(accessToken, {
        messageId: payload.messageId,
        attachmentId: resolved.attachment.id,
        maxBytes: MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES,
      })
    }

    if (!resolved.attachment.id) return invalidOrStaleReference()
    const { fetchImapSmtpAttachmentBytes } = await import('./mail-imap-smtp.ts')
    return fetchImapSmtpAttachmentBytes(
      imapSmtpRuntimeForConnection(event, connection),
      {
        messageReference: payload.messageId,
        partId: resolved.attachment.id,
        maxBytes: MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES,
      },
    )
  }
  catch (error) {
    const handled = await handleMailProviderError(backendData, connection, error)
    const statusCode = providerStatusCode(handled)
    if (statusCode === 413) throw createError({ statusCode: 413, statusMessage: 'Załącznik przekracza bezpieczny limit 8 MB.' })
    if (statusCode === 404 || statusCode === 409) return invalidOrStaleReference()
    throw handled
  }
}

function extractionStatus(result: MailAgentAttachmentTextResult): CrmAgentMailAttachmentReadStatus {
  if (result.status === 'ok') return 'extracted'
  return result.status
}

async function loadExactAttachmentMessage(
  event: H3Event,
  backendData: any,
  connection: MailConnectionRow,
  payload: MailAgentAttachmentReferencePayload,
): Promise<MailThreadDetail> {
  try {
    if (connection.provider === 'google') {
      const [{ fetchGmailMessageDetail }, accessToken] = await Promise.all([
        import('./mail-providers.ts'),
        activeMailAccessToken(event, backendData, connection),
      ])
      const message = await fetchGmailMessageDetail(
        accessToken,
        payload.messageId,
        payload.threadId,
      )
      return {
        id: payload.threadId,
        subject: message.subject,
        messages: [message],
        omittedMessageCount: 0,
        externalUrl: null,
      }
    }
    if (connection.provider === 'microsoft') {
      const [{ fetchMicrosoftMailMessageDetail }, accessToken] = await Promise.all([
        import('./mail-microsoft.ts'),
        activeMailAccessToken(event, backendData, connection),
      ])
      const message = await fetchMicrosoftMailMessageDetail(
        accessToken,
        payload.messageId,
        payload.threadId,
        { referenceSecret: connectionReferenceSecret(event, connection) },
      )
      return {
        id: payload.threadId,
        subject: message.subject,
        messages: [message],
        omittedMessageCount: 0,
        externalUrl: null,
      }
    }
    const { fetchImapSmtpThread } = await import('./mail-imap-smtp.ts')
    return fetchImapSmtpThread(
      imapSmtpRuntimeForConnection(event, connection),
      payload.messageId,
    )
  }
  catch (error) {
    const handled = await handleMailProviderError(backendData, connection, error)
    const statusCode = providerStatusCode(handled)
    if (statusCode === 404 || statusCode === 409) return invalidOrStaleReference()
    throw handled
  }
}

function responseForExtraction(input: {
  connection: MailConnectionRow
  resolved: ResolvedMailAgentAttachment
  extraction: MailAgentAttachmentTextResult
  sizeBytes: number
  question?: string
}): CrmAgentMailAttachmentReadResponse {
  const excerpts = selectMailAgentAttachmentExcerpts(
    input.extraction,
    input.question,
    {
      maxExcerpts: 5,
      maxExcerptCharacters: 1_600,
      maxTotalCharacters: 7_000,
    },
  )
  return {
    data: {
      fileName: boundedMailAgentText(input.resolved.attachment.filename, 500),
      mimeType: boundedMailAgentText(input.resolved.attachment.mimeType, 255),
      sizeBytes: boundedMailAgentCount(input.sizeBytes),
      source: {
        mailbox: boundedMailAgentText(input.connection.account_email, 254),
        sender: boundedMailAgentNullableText(input.resolved.message.from?.label, 500),
        subject: boundedMailAgentText(input.resolved.message.subject, 500),
        sentAt: boundedMailAgentNullableText(input.resolved.message.sentAt, 64),
      },
      extraction: {
        status: extractionStatus(input.extraction),
        kind: boundedMailAgentText(input.extraction.kind, 64),
        pageCount: input.extraction.pageCount === undefined || input.extraction.pageCount === null
          ? null
          : boundedMailAgentCount(input.extraction.pageCount, 100_000),
        truncated: input.extraction.truncated,
        reason: input.extraction.reason
          ? boundedMailAgentText(extractionReasonLabels[input.extraction.reason], 500)
          : null,
        excerpts: excerpts.map(excerpt => ({
          locator: boundedMailAgentText(`znaki ${excerpt.start + 1}-${excerpt.end}`, 100),
          text: boundedMailAgentText(excerpt.text, 1_600),
        })),
      },
    },
  }
}

function tooLargeExtraction(): MailAgentAttachmentTextResult {
  return {
    status: 'unsupported',
    kind: 'unknown',
    text: '',
    truncated: false,
    reason: 'input_too_large',
  }
}

export async function readMailAgentAttachment(
  event: H3Event,
  session: CrmSession,
  reference: string,
  question?: string,
): Promise<CrmAgentMailAttachmentReadResponse> {
  let connectionId: string
  try {
    connectionId = mailAgentAttachmentReferenceConnectionId(reference)
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

  let payload: MailAgentAttachmentReferencePayload
  try {
    payload = openMailAgentAttachmentReference(
      reference,
      connectionReferenceSecret(event, connection),
    )
  }
  catch {
    return invalidOrStaleReference()
  }

  const detail = await loadExactAttachmentMessage(event, backendData, connection, payload)
  const resolved = resolveMailAgentAttachment(detail, payload)

  if (resolved.attachment.size > MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES) {
    return responseForExtraction({
      connection,
      resolved,
      extraction: tooLargeExtraction(),
      sizeBytes: resolved.attachment.size,
      question,
    })
  }

  let bytes: Uint8Array
  try {
    bytes = await downloadAttachmentBytes(event, backendData, connection, payload, resolved)
  }
  catch (error) {
    if (providerStatusCode(error) !== 413) throw error
    return responseForExtraction({
      connection,
      resolved,
      extraction: tooLargeExtraction(),
      sizeBytes: Math.max(resolved.attachment.size, MAIL_AGENT_ATTACHMENT_MAX_INPUT_BYTES + 1),
      question,
    })
  }

  const extraction = await extractMailAgentAttachmentText({
    bytes,
    fileName: resolved.attachment.filename,
    mimeType: resolved.attachment.mimeType,
  })
  return responseForExtraction({
    connection,
    resolved,
    extraction,
    sizeBytes: bytes.byteLength,
    question,
  })
}
