import { createError, type H3Event } from 'h3'
import type { CrmSession } from './crm.ts'
import { cleanupOpenExpertMockBankPayloads } from './openexpert-mock-bank-cleanup.ts'
import { deliverOpenExpertMockBankDocument } from './openexpert-mock-bank-delivery.ts'
import {
  assertOpenExpertMockBankDispatchClaim,
  finalizeOpenExpertMockBankDispatch,
  reserveOpenExpertMockBankDispatch,
} from './openexpert-mock-bank-dispatch.ts'
import {
  assertOpenExpertMockBankRequestId,
  type OpenExpertMockBankDocumentKind,
} from './openexpert-mock-bank-documents.ts'
import type { OpenExpertMockBankContext } from './openexpert-mock-bank-service.ts'

export interface OpenExpertMockBankActionResult {
  alreadySent: boolean
  data: {
    applicationNumber: string
    kind: OpenExpertMockBankDocumentKind
    generation: number
    providerMessageId: string | null
    sentAt: string | null
    archiveFileName?: string
    pdfFileName?: string
    issueDate?: string
    validUntil?: string | null
  }
}

function safeDispatchFailureCode(error: unknown): string {
  const status = Number((error as { statusCode?: unknown })?.statusCode)
  if (status === 503) return 'email_service_unavailable'
  if (status === 502) return 'email_provider_rejected'
  return 'document_delivery_failed'
}

export async function dispatchOpenExpertMockBankDocument(input: {
  event: H3Event
  session: CrmSession
  caseId: string
  context: OpenExpertMockBankContext
  kind: OpenExpertMockBankDocumentKind
  requestId: string
  recipient: { connectionId: string, email: string }
  forceResend?: boolean
}): Promise<OpenExpertMockBankActionResult> {
  const requestId = assertOpenExpertMockBankRequestId(input.requestId)
  const reservation = await reserveOpenExpertMockBankDispatch({
    event: input.event,
    session: input.session,
    caseId: input.caseId,
    applicationId: input.context.applicationId,
    kind: input.kind,
    requestId,
    recipientConnectionId: input.recipient.connectionId,
    forceResend: input.forceResend,
  })
  assertOpenExpertMockBankDispatchClaim(reservation, {
    applicationId: input.context.applicationId,
    applicationNumber: input.context.applicationNumber,
    kind: input.kind,
  })
  if (!reservation.shouldSend && reservation.state === 'sent') {
    await cleanupOpenExpertMockBankPayloads(input.event, { suppressClaimErrors: true })
    return {
      alreadySent: true,
      data: {
        applicationNumber: reservation.applicationNumber,
        kind: reservation.kind,
        generation: reservation.generation,
        providerMessageId: reservation.providerMessageId,
        sentAt: reservation.sentAt,
      },
    }
  }
  if (!reservation.shouldSend) {
    throw createError({ statusCode: 409, statusMessage: 'Wysyłka dokumentu nie została zarezerwowana.' })
  }
  if (reservation.recipientConnectionId !== input.recipient.connectionId) {
    throw createError({ statusCode: 409, statusMessage: 'Ta generacja wiadomości jest przypisana do innej skrzynki.' })
  }
  let delivery
  try {
    delivery = await deliverOpenExpertMockBankDocument({
      event: input.event,
      organizationId: input.session.organizationId,
      context: input.context,
      kind: input.kind,
      recipientEmail: input.recipient.email,
      reservation,
      requestId,
    })
  }
  catch (error) {
    try {
      await finalizeOpenExpertMockBankDispatch({
        event: input.event,
        dispatchId: reservation.dispatchId,
        requestId,
        status: 'failed',
        errorCode: safeDispatchFailureCode(error),
      })
    }
    catch (finalizeError) {
      console.error('[openexpert-mock-bank] failed to finalize a failed dispatch', {
        applicationId: input.context.applicationId,
        kind: input.kind,
        error: finalizeError instanceof Error ? finalizeError.name : 'unknown',
      })
    }
    throw error
  }

  const finalized = await finalizeOpenExpertMockBankDispatch({
    event: input.event,
    dispatchId: reservation.dispatchId,
    requestId,
    status: 'sent',
    providerMessageId: delivery.providerMessageId,
  })
  // The sent transition atomically records the CRM activity and enqueues both
  // private payload objects. Deletion failure is durable and never changes the
  // already committed delivery result.
  await cleanupOpenExpertMockBankPayloads(input.event, { suppressClaimErrors: true })

  return {
    alreadySent: false,
    data: {
      applicationNumber: input.context.applicationNumber,
      kind: input.kind,
      generation: finalized.generation,
      providerMessageId: delivery.providerMessageId,
      sentAt: finalized.sentAt,
      archiveFileName: delivery.archiveFileName,
      pdfFileName: delivery.pdfFileName,
      issueDate: delivery.issueDate,
      validUntil: delivery.validUntil,
    },
  }
}
