import { getHeader } from 'h3'
import type { MailBankAgentReanalysisRequestPayload } from '../../../../../shared/types/mail.ts'
import { dispatchBankMailReanalysis } from '~~/server/utils/bank-mail-reanalysis-dispatch'
import { gmailBankMailMessageDispatchInput } from '~~/server/utils/bank-mail-agent-ingestion'
import {
  parseBankMailReanalysisOperation,
  parseBankMailReanalysisRequest,
  publicBankMailReanalysisState,
} from '~~/server/utils/bank-mail-reanalysis-request-core'
import { requireCrmSession } from '~~/server/utils/crm'
import {
  activeMailAccessToken,
  markMailConnectionStatus,
  requireUserMailConnection,
} from '~~/server/utils/mail-connections'
import {
  requireSameOriginMailRequest,
  setPrivateMailResponseHeaders,
} from '~~/server/utils/mail-http'
import { readBoundedRequestBody } from '~~/server/utils/mail-multipart'
import { fetchGmailThread } from '~~/server/utils/mail-providers'
import { handleMailProviderError } from '~~/server/utils/mail-thread-page'

const MAX_REQUEST_BYTES = 32_000

export default defineEventHandler(async (event): Promise<MailBankAgentReanalysisRequestPayload> => {
  setPrivateMailResponseHeaders(event)
  requireSameOriginMailRequest(event)
  const session = await requireCrmSession(event)

  const contentType = getHeader(event, 'content-type')?.split(';')[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw createError({ statusCode: 415, statusMessage: 'Ponowna analiza wymaga formatu JSON.' })
  }
  const contentLength = Number(getHeader(event, 'content-length') || 0)
  if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > MAX_REQUEST_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'Zapytanie o ponowną analizę jest zbyt duże.' })
  }

  let input
  try {
    const rawBody = await readBoundedRequestBody(event, MAX_REQUEST_BYTES)
    input = parseBankMailReanalysisRequest(JSON.parse(rawBody.toString('utf8')))
  }
  catch (error) {
    if (Number((error as { statusCode?: number })?.statusCode) === 413) throw error
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error
        ? error.message
        : 'Nieprawidłowe zapytanie o ponowną analizę.',
    })
  }

  const { backendData, connection } = await requireUserMailConnection(
    event,
    session,
    input.connectionId,
  )
  if (connection.provider !== 'google') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ponowna analiza Eve jest obecnie dostępna dla wiadomości Gmail.',
    })
  }

  let thread
  try {
    thread = await fetchGmailThread(
      await activeMailAccessToken(event, backendData, connection),
      connection.account_email,
      input.threadId,
    )
    if (connection.status !== 'active') {
      await markMailConnectionStatus(backendData, connection, 'active', null, true)
    }
  }
  catch (error) {
    throw await handleMailProviderError(backendData, connection, error)
  }

  const message = thread.messages.find(candidate => candidate.id === input.messageId)
  if (!message) {
    throw createError({ statusCode: 404, statusMessage: 'Nie znaleziono wiadomości w tym wątku.' })
  }
  const dispatchInput = gmailBankMailMessageDispatchInput(event, {
    session,
    connection,
    thread,
    message,
  })
  if (!dispatchInput) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Ta wiadomość nie kwalifikuje się do analizy Eve.',
    })
  }

  const { data, error } = await session.dataApi.rpc('request_my_bank_mail_agent_reanalysis', {
    p_organization_id: session.organizationId,
    p_connection_id: connection.id,
    p_provider_message_id_hash: dispatchInput.providerMessageIdSha256,
    p_source_sha256: dispatchInput.sourceSha256,
  })
  if (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Nie udało się teraz zaplanować ponownej analizy Eve.',
    })
  }

  let operation
  try {
    operation = parseBankMailReanalysisOperation(data)
  }
  catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Usługa ponownej analizy zwróciła nieprawidłowy stan.',
    })
  }

  if (operation.shouldDispatch) {
    try {
      await dispatchBankMailReanalysis(event, {
        reanalysisRequestId: operation.requestId,
        intakeId: operation.intakeId,
        organizationId: dispatchInput.organizationId,
        organizationSlug: dispatchInput.organizationSlug,
        connectionId: dispatchInput.connectionId,
        mailboxOwnerUserId: dispatchInput.mailboxOwnerUserId,
        subject: dispatchInput.subject,
        bodyText: dispatchInput.bodyText,
        bodyTruncated: dispatchInput.bodyTruncated,
        attachments: dispatchInput.attachments,
      })
    }
    catch {
      throw createError({
        statusCode: 503,
        statusMessage: 'Eve nie mogła rozpocząć ponownej analizy. Spróbuj ponownie później.',
      })
    }
  }

  return {
    data: {
      accepted: operation.accepted,
      state: publicBankMailReanalysisState(operation.state),
      attemptNo: operation.attemptNo,
      retryAfterSeconds: operation.retryAfterSeconds,
    },
  }
})
